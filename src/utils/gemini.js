const dns = require('dns');
try {
    if (typeof dns.setDefaultResultOrder === 'function') {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch (e) {
    console.warn('⚠️ [DNS] Could not set ipv4first result order:', e.message);
}

const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const { getApiKey, getConfig, getPreferences } = require('../storage');
const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const liveTranscription = require('./liveTranscription');

// Conversation tracking variables
let currentSessionId = null;
let conversationHistory = [];
let screenAnalysisHistory = [];
let lastUserTranscript = '';

// Turn & Chunk management
let currentTurnEpoch = 0;
let currentQuestionText = '';
let currentQuestionChunks = [];
let isUserSpeaking = false;

// Live Voice Agent session state
let wsConnected = false;
let liveEnabled = false;
let isInitializingSession = false;
let currentProfile = 'interview';
let currentCustomPrompt = '';
let currentSystemPrompt = null;
let systemAudioProc = null;
let autoListening = true;
let autoListeningEnabled = true;

function isAutoListeningEnabled() {
    try {
        const prefs = getPreferences();
        if (prefs && typeof prefs.autoListening === 'boolean') {
            return prefs.autoListening;
        }
    } catch (e) {}
    return autoListening;
}

function setAutoListening(enabled) {
    if (typeof enabled !== 'boolean') return false;
    autoListening = enabled;
    autoListeningEnabled = enabled;
    return true;
}

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, data);
        }
    }
}

function setLiveState(enabled) {
    if (!wsConnected) {
        console.warn('[Audio] Cannot change live state: Deepgram WebSocket is not connected');
        return false;
    }
    liveEnabled = Boolean(enabled);
    liveTranscription.setLiveState(liveEnabled);
    console.log(`[Audio] Live state set to: ${liveEnabled ? 'LIVE ON (Microphone Active)' : 'LIVE OFF (Silence Stream)'}`);
    sendToRenderer('live-state-changed', { liveEnabled, wsConnected });
    sendToRenderer('manual-voice-state', liveEnabled);
    sendToRenderer('update-status', getIdleStatusMessage());
    return true;
}

function getIdleStatusMessage() {
    if (!wsConnected) return 'Voice agent disconnected';
    return liveEnabled ? '🔴 LIVE ON (Speaking...)' : 'WS Connected | LIVE OFF (Click "Start Live" or Ctrl+Space to speak)';
}

function shouldForwardCapturedAudio() {
    // When WebSocket is connected, forward all audio (real PCM when liveEnabled, silence PCM when Live OFF)
    return wsConnected;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    startTransportLog(currentSessionId);
    lastUserTranscript = '';
    currentTurnEpoch = 0;
    currentQuestionText = '';
    currentQuestionChunks = [];
    isUserSpeaking = false;
    conversationHistory = [];
    screenAnalysisHistory = [];
    audioChunkCounter = 0;
    lastAudioLogTime = 0;
    currentProfile = profile || 'interview';
    currentCustomPrompt = customPrompt || '';
    console.log('New conversation session started:', currentSessionId, 'profile:', currentProfile);

    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: currentProfile,
            customPrompt: currentCustomPrompt,
        });
    }
}

function formatFullTurn(question, chunks) {
    const answerBody = Array.isArray(chunks) ? chunks.join('\n\n') : chunks || '';
    if (question && question.trim()) {
        return `### 🎙️ ${question.trim()}\n\n${answerBody}`;
    }
    return answerBody;
}

function startNewQuestionTurn(questionText) {
    currentTurnEpoch++;
    currentQuestionText = (questionText || '').trim();
    currentQuestionChunks = [];
    isUserSpeaking = false;
    const initialPlaceholder = `### 🎙️ ${currentQuestionText}\n\n_Generating answer..._`;
    sendToRenderer('new-response', initialPlaceholder);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const cleanQuestion = (transcription || '').trim();
    const cleanAnswer = (aiResponse || '').trim();

    // Check if the last turn in conversationHistory belongs to the current question turn
    const lastTurn = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
    if (lastTurn && (lastTurn.turnEpoch === currentTurnEpoch || (cleanQuestion && lastTurn.transcription === cleanQuestion))) {
        lastTurn.ai_response = cleanAnswer;
        lastTurn.timestamp = Date.now();
        console.log('Updated conversation turn (appended chunk):', lastTurn);
        sendToRenderer('save-conversation-turn', {
            sessionId: currentSessionId,
            turn: lastTurn,
            fullHistory: conversationHistory,
        });
    } else {
        const conversationTurn = {
            turnEpoch: currentTurnEpoch,
            timestamp: Date.now(),
            transcription: cleanQuestion,
            ai_response: cleanAnswer,
        };
        conversationHistory.push(conversationTurn);
        console.log('Saved conversation turn:', conversationTurn);
        sendToRenderer('save-conversation-turn', {
            sessionId: currentSessionId,
            turn: conversationTurn,
            fullHistory: conversationHistory,
        });
    }
}

function saveScreenAnalysis(prompt, response, model = 'voice-agent') {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: (response || '').trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

// ─── Deepgram Voice Agent Session Initialization ─────────────────────────────

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US') {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    const prefs = getPreferences();
    const effectiveKey = apiKey || getApiKey() || '';
    const backendUrl = prefs.backendUrl || process.env.BACKEND_URL || 'http://13.233.70.37:3000';
    if (!effectiveKey && !backendUrl) {
        console.error('Deepgram API key or backend URL is not configured');
        sendToRenderer('update-status', 'Error: No Deepgram API key or backend URL configured');
        return false;
    }

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);

    currentProfile = profile || 'interview';
    currentCustomPrompt = customPrompt || '';

    // Build the system prompt present in the project
    const searchEnabled = prefs.googleSearchEnabled ?? false;
    currentSystemPrompt = getSystemPrompt(currentProfile, currentCustomPrompt, searchEnabled);

    initializeNewSession(currentProfile, currentCustomPrompt);
    autoListeningEnabled = isAutoListeningEnabled();

    const started = await liveTranscription.startTranscription(
        {
            apiKey: effectiveKey,
            backendUrl: backendUrl,
            systemPrompt: currentSystemPrompt,
            profile: currentProfile,
            customPrompt: currentCustomPrompt,
        },
        {
            onUserTranscript: (text, isFinal) => {
                if (!text || !wsConnected) return;

                lastUserTranscript = text.trim();

                sendToRenderer('live-transcript', {
                    text: lastUserTranscript,
                    timestamp: new Date().toISOString(),
                    isFinal: Boolean(isFinal),
                });

                if (isFinal) {
                    isUserSpeaking = false;
                    console.log(`[Voice Agent] Committed Staged: "${lastUserTranscript}"`);
                    sendToRenderer('staged-voice-text', lastUserTranscript);
                    sendToRenderer('update-status', `🎙️ Staged: "${lastUserTranscript}" — Click "Send to Groq"`);
                } else {
                    sendToRenderer('update-status', `🎙️ ${lastUserTranscript}`);
                }
            },
            onAssistantResponse: responseText => {
                if (!responseText) return;

                const answer = responseText.trim();
                if (!answer) return;

                if (!currentQuestionText) {
                    currentQuestionText = 'Question';
                }

                currentQuestionChunks = [answer];
                const fullFormatted = formatFullTurn(currentQuestionText, currentQuestionChunks);
                sendToRenderer('update-response', fullFormatted);
                saveConversationTurn(currentQuestionText, answer);
                sendToRenderer('update-status', '⚡ Answering...');
            },
            onAgentAudio: audioBuffer => {},
            onThinking: content => {
                sendToRenderer('update-status', content || 'Thinking...');
            },
            onUserStartedSpeaking: () => {
                if (!wsConnected) return;
                console.log('[Voice] 🎙️ User started speaking...');
                isUserSpeaking = true;
                sendToRenderer('update-status', '🎙️ Listening to you speak...');
            },
            onAgentDone: finalResponse => {
                console.log('[Groq] Response completed');
                if (finalResponse && typeof finalResponse === 'string' && finalResponse.trim()) {
                    const answer = finalResponse.trim();
                    currentQuestionChunks = [answer];
                    const fullFormatted = formatFullTurn(currentQuestionText || 'Question', currentQuestionChunks);
                    sendToRenderer('update-response', fullFormatted);
                    saveConversationTurn(currentQuestionText || 'Question', answer);
                }
                sendToRenderer('update-status', getIdleStatusMessage());
            },
            onError: err => {
                console.error('[Voice Agent Error]:', err);
                sendToRenderer('update-status', `Error: ${err}`);
            },
            onStopped: () => {
                wsConnected = false;
                liveEnabled = false;
                sendToRenderer('session-state', { wsConnected: false, liveEnabled: false });
                sendToRenderer('update-status', 'Voice agent disconnected');
            },
        }
    );

    isInitializingSession = false;
    sendToRenderer('session-initializing', false);

    if (started) {
        wsConnected = true;
        liveEnabled = false; // Session begins with Live OFF (mic closed, silence stream)
        liveTranscription.setLiveState(false);
        console.log('[Session] Voice Agent session successfully started (WS Connected, Live OFF)');
        sendToRenderer('session-state', { wsConnected: true, liveEnabled: false });
        sendToRenderer('update-status', getIdleStatusMessage());
        return {
            close: async () => {
                wsConnected = false;
                liveEnabled = false;
                liveTranscription.stopTranscription();
            },
        };
    } else {
        wsConnected = false;
        liveEnabled = false;
        console.error('[Session] Failed to connect Voice Agent');
        sendToRenderer('session-state', { wsConnected: false, liveEnabled: false });
        sendToRenderer('update-status', 'Failed to connect to Deepgram Voice Agent');
        return false;
    }
}

// ─── Audio Stream Forwarding ──────────────────────────────────────────────────

let audioChunkCounter = 0;
let lastAudioLogTime = 0;

function calculateRms(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;
    const samples = Math.floor(pcmBuffer.length / 2);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const val = pcmBuffer.readInt16LE(i * 2);
        sum += val * val;
    }
    return Math.sqrt(sum / samples);
}

function processGeminiBatchAudio(pcmBuffer, isSilence = false) {
    if (!wsConnected) return;

    if (liveEnabled && !isSilence) {
        audioChunkCounter++;
        const now = Date.now();
        // Log real audio activity on first chunk and every 4 seconds with RMS level
        if (audioChunkCounter === 1 || now - lastAudioLogTime > 4000) {
            lastAudioLogTime = now;
            const rms = calculateRms(pcmBuffer);
            console.log(
                `[Voice Audio] Forwarding real audio to Deepgram (chunk #${audioChunkCounter}, ${pcmBuffer.length} bytes, RMS: ${rms.toFixed(0)})`
            );
        }
        liveTranscription.sendAudio(pcmBuffer, 48000);
    } else {
        // Forward silence PCM to maintain the Deepgram live agent session without speech detection
        liveTranscription.sendAudio(pcmBuffer, 48000);
    }
}

async function startManualVoiceRecord() {
    setLiveState(true);
    return { success: true };
}

async function stopManualVoiceRecord() {
    setLiveState(false);
    return { success: true };
}

// ─── macOS Audio Capture via SystemAudioDump ─────────────────────────────────

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], { stdio: 'ignore' });
        killProc.on('close', () => resolve());
        killProc.on('error', () => resolve());
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture() {
    if (process.platform !== 'darwin') return false;
    await killExistingSystemAudioDump();

    const { app } = require('electron');
    const path = require('path');
    const systemAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'SystemAudioDump')
        : path.join(__dirname, '../assets', 'SystemAudioDump');

    systemAudioProc = spawn(systemAudioPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (!systemAudioProc.pid) return false;

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (shouldForwardCapturedAudio()) {
                liveTranscription.sendAudio(monoChunk, 24000);
            }
        }
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }
    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function setupGeminiIpcHandlers(geminiSessionRef) {
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    const handleAudioPayload = payload => {
        if (!payload || !payload.data || !wsConnected) return;
        try {
            let pcmBuffer;
            if (Buffer.isBuffer(payload.data)) {
                pcmBuffer = payload.data;
            } else if (payload.data instanceof ArrayBuffer) {
                pcmBuffer = Buffer.from(payload.data);
            } else if (ArrayBuffer.isView(payload.data)) {
                pcmBuffer = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength);
            } else if (typeof payload.data === 'string') {
                pcmBuffer = Buffer.from(payload.data, 'base64');
            } else {
                return;
            }
            processGeminiBatchAudio(pcmBuffer, Boolean(payload.isSilence));
        } catch (error) {}
    };

    ipcMain.on('send-audio-content', (event, payload) => {
        handleAudioPayload(payload);
    });

    ipcMain.handle('send-audio-content', async (event, payload) => {
        handleAudioPayload(payload);
        return { success: true };
    });

    ipcMain.handle('send-mic-audio-content', async (event, payload) => {
        if (!payload || !payload.data) return { success: false, error: 'Invalid audio data' };
        if (!wsConnected) return { success: true, ignored: true };

        try {
            let pcmBuffer;
            if (Buffer.isBuffer(payload.data)) {
                pcmBuffer = payload.data;
            } else if (payload.data instanceof ArrayBuffer) {
                pcmBuffer = Buffer.from(payload.data);
            } else if (ArrayBuffer.isView(payload.data)) {
                pcmBuffer = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength);
            } else if (typeof payload.data === 'string') {
                pcmBuffer = Buffer.from(payload.data, 'base64');
            } else {
                return { success: false, error: 'Unsupported audio data format' };
            }

            processGeminiBatchAudio(pcmBuffer, Boolean(payload.isSilence));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }
        console.log('Sending text to Voice Agent:', text);
        const trimmed = text.trim();
        startNewQuestionTurn(trimmed);
        const sent = liveTranscription.sendTextMessage(trimmed);
        if (sent) {
            sendToRenderer('update-status', 'Message sent to agent...');
            return { success: true };
        }
        return { success: false, error: 'Voice agent connection not active' };
    });

    ipcMain.handle('send-image-content', async (event, { prompt }) => {
        if (prompt && prompt.trim()) {
            const trimmed = prompt.trim();
            startNewQuestionTurn(trimmed);
            liveTranscription.sendTextMessage(trimmed);
            return { success: true };
        }
        return { success: false, error: 'Image analysis is not supported with Voice Agent' };
    });

    ipcMain.handle('set-live-state', async (event, enabled) => {
        const success = setLiveState(enabled);
        return { success, liveEnabled, wsConnected };
    });

    ipcMain.handle('toggle-live', async () => {
        const success = setLiveState(!liveEnabled);
        return { success, liveEnabled, wsConnected };
    });

    ipcMain.handle('get-live-state', async () => {
        return { liveEnabled, wsConnected };
    });

    ipcMain.handle('start-manual-voice-record', async () => {
        const success = setLiveState(true);
        return { success, liveEnabled, wsConnected };
    });

    ipcMain.handle('stop-manual-voice-record', async () => {
        const success = setLiveState(false);
        return { success, liveEnabled, wsConnected };
    });

    ipcMain.handle('toggle-manual-voice-record', async () => {
        return { success: setLiveState(!liveEnabled), liveEnabled, wsConnected };
    });

    ipcMain.handle('get-manual-voice-state', async () => {
        return { isRecording: liveEnabled, liveEnabled, wsConnected };
    });

    ipcMain.handle('update-auto-listening-setting', async (event, enabled) => {
        const success = setAutoListening(enabled);
        return { success, enabled: isAutoListeningEnabled() };
    });

    ipcMain.handle('get-auto-listening-setting', async () => {
        return { enabled: isAutoListeningEnabled() };
    });

    ipcMain.handle('start-macos-audio', async () => {
        if (process.platform !== 'darwin') return { success: false, error: 'Only available on macOS' };
        return { success: await startMacOSAudioCapture() };
    });

    ipcMain.handle('stop-macos-audio', async () => {
        stopMacOSAudioCapture();
        return { success: true };
    });

    ipcMain.handle('close-session', async () => {
        try {
            stopMacOSAudioCapture();
            wsConnected = false;
            liveEnabled = false;
            liveTranscription.stopTranscription();
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }
            closeTransportLog();
            sendToRenderer('session-state', { wsConnected: false, liveEnabled: false });
            sendToRenderer('update-status', 'Session closed');
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-current-session', async () => {
        return { success: true, data: getCurrentSessionData() };
    });

    ipcMain.handle('start-new-session', async () => {
        initializeNewSession();
        return { success: true, sessionId: currentSessionId };
    });

    ipcMain.handle('update-google-search-setting', async () => {
        return { success: true };
    });

    ipcMain.handle('live-transcription:status', async () => {
        return {
            success: true,
            data: {
                active: sessionActive,
                available: liveTranscription.isAvailable(),
                ...liveTranscription.getStatus(),
            },
        };
    });

    ipcMain.handle('live-transcription:start', async (event, opts) => {
        const started = await liveTranscription.startTranscription(opts || {});
        return { success: started };
    });

    ipcMain.handle('live-transcription:stop', async () => {
        liveTranscription.stopTranscription();
        return { success: true };
    });

    ipcMain.handle('live-transcription:get-models', async () => {
        return {
            success: true,
            models: [
                { id: 'openai/gpt-oss-120b', name: 'Groq: GPT-OSS 120B (High Quality)' },
                { id: 'qwen/qwen3.8-27b', name: 'Groq: Qwen 3.8 27B (Ultra Fast)' },
                { id: 'openai/gpt-oss-20b', name: 'Groq: GPT-OSS 20B (Fast)' },
            ],
        };
    });

    ipcMain.handle('live-transcription:set-model', async () => {
        return { success: true };
    });
}

module.exports = {
    initializeGeminiSession,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    startMacOSAudioCapture,
    stopMacOSAudioCapture,
    convertStereoToMono,
    setupGeminiIpcHandlers,
    setAutoListening,
    isAutoListeningEnabled,
    stopLiveTranscription: () => liveTranscription.stopTranscription(),
};
