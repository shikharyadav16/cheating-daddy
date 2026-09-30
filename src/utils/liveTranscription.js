require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const storage = require('../storage');
const { getSystemPrompt } = require('./prompts');

const PORT = process.env.PORT || 3000;
const DEEPGRAM_WS_URL = 'wss://agent.deepgram.com/v1/agent/converse';

const app = express();
app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
    try {
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    } catch (e) {}
}
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on('error', err => {
    if (err.code !== 'EADDRINUSE') {
        console.error('[WSS Error]:', err.message);
    }
});

function getEffectiveApiKey(overrideKey) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim()) {
        return overrideKey.trim();
    }
    try {
        if (storage && typeof storage.getApiKey === 'function') {
            const key = storage.getApiKey();
            if (key && key.trim()) return key.trim();
        }
    } catch (e) {}
    if (process.env.DEEPGRAM_API_KEY && process.env.DEEPGRAM_API_KEY.trim()) {
        return process.env.DEEPGRAM_API_KEY.trim();
    }
    if (process.env.STT_KEY && process.env.STT_KEY.trim()) {
        return process.env.STT_KEY.trim();
    }
    return '';
}

function getProjectSystemPrompt(profile, customPrompt) {
    try {
        const prefs = storage.getPreferences ? storage.getPreferences() : {};
        const p = profile || prefs.selectedProfile || 'interview';
        const c = customPrompt !== undefined && customPrompt !== null ? customPrompt : prefs.customPrompt || '';
        const searchEnabled = prefs.googleSearchEnabled ?? false;
        return getSystemPrompt(p, c, searchEnabled);
    } catch (e) {
        console.error('Error loading project system prompt:', e);
        return getSystemPrompt('interview', '', false);
    }
}

function buildSettingsMessage(promptText) {
    return {
        type: 'Settings',
        audio: {
            input: { encoding: 'linear16', sample_rate: 48000 },
            output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
        },
        agent: {
            speak: {
                provider: { type: 'deepgram', version: 'v2', model: 'flux-kit-en', speed: 1.5 },
            },
            listen: {
                provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' },
            },
            think: {
                provider: { type: 'google', model: 'gemini-3.1-flash-lite' },
                prompt: promptText || getProjectSystemPrompt(),
            },
        },
    };
}

function getEffectiveBackendWsUrl(overrideUrl) {
    let url = overrideUrl || process.env.BACKEND_WS_URL || process.env.BACKEND_URL;
    if (!url) {
        try {
            if (storage && typeof storage.getBackendUrl === 'function') {
                url = storage.getBackendUrl();
            } else if (storage && typeof storage.getPreferences === 'function') {
                const prefs = storage.getPreferences();
                if (prefs && prefs.backendUrl) url = prefs.backendUrl;
            }
        } catch (e) {}
    }
    if (!url) {
        url = 'http://13.233.70.37:3000';
    }
    url = url.trim().replace(/\/+$/, '');
    if (url.startsWith('https://')) {
        return url.replace(/^https:\/\//, 'wss://');
    }
    if (url.startsWith('http://')) {
        return url.replace(/^http:\/\//, 'ws://');
    }
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
        return url;
    }
    return `ws://${url}`;
}

// Global active backend connection (for client mode)
let activeBackendWs = null;
let clientPingTimer = null;

// Global active Deepgram connection (for server mode / direct fallback)
let activeDeepgramWs = null;
let activeKeepAliveTimer = null;
let wsConnected = false;
let liveEnabled = false;
let isSessionActive = false;
let isConnecting = false;
let activeSettingsApplied = false;
let currentPrompt = '';

// Active callbacks for Electron main process / gemini.js
let activeCallbacks = {
    onUserTranscript: null,
    onAssistantResponse: null,
    onAgentAudio: null,
    onThinking: null,
    onUserStartedSpeaking: null,
    onAgentDone: null,
    onLog: null,
    onError: null,
    onStopped: null,
};

// Connected browser WS clients
const browserClients = new Set();

function broadcastToBrowsers(payload) {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    for (const client of browserClients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(raw);
            } catch (err) {
                console.error('[WS Broadcast Error]:', err.message);
            }
        }
    }
}

function safeClose(ws) {
    if (!ws) return;
    try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    } catch (e) {}
}

/**
 * Connect to Deepgram Voice Agent WebSocket
 */
function createDeepgramConnection(apiKey, promptText) {
    const key = getEffectiveApiKey(apiKey);
    if (!key) {
        console.error('❌ [Deepgram Agent] API key not found. Please configure in settings.');
        return null;
    }

    console.log('Connecting to Deepgram Voice Agent at', DEEPGRAM_WS_URL);
    const dgWs = new WebSocket(DEEPGRAM_WS_URL, {
        headers: { Authorization: `Token ${key}` },
    });

    let settingsApplied = false;
    let keepAliveTimer = null;
    const settingsMessage = buildSettingsMessage(promptText);

    dgWs.on('open', () => {
        console.log('Connected to Deepgram Voice Agent.');
        if (activeCallbacks.onLog) activeCallbacks.onLog('Connected to Deepgram Voice Agent');
    });

    dgWs.on('message', (data, isBinary) => {
        // Binary frames (TTS audio output from Deepgram)
        // User requested: "remove the voice no need of voice to be send to the user"
        if (isBinary) {
            return;
        }

        let message;
        try {
            message = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (message.type !== 'LatencyReport') {
            console.log('Deepgram →', message.type);
        }

        switch (message.type) {
            case 'Welcome': {
                dgWs.send(JSON.stringify(settingsMessage));
                break;
            }

            case 'SettingsApplied': {
                settingsApplied = true;
                activeSettingsApplied = true;
                wsConnected = true;
                isConnecting = false;
                isSessionActive = true;
                broadcastToBrowsers({ type: 'Ready', wsConnected: true, liveEnabled });

                // Keep the Deepgram connection alive during silence
                if (keepAliveTimer) clearInterval(keepAliveTimer);
                keepAliveTimer = setInterval(() => {
                    if (dgWs.readyState === WebSocket.OPEN) {
                        try {
                            dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
                            dgWs.ping();
                        } catch (e) {}
                    }
                }, 5000);
                activeKeepAliveTimer = keepAliveTimer;

                if (activeCallbacks.onLog) activeCallbacks.onLog('SettingsApplied: Voice Agent ready');
                break;
            }

            case 'ConversationText': {
                // Forward both user transcript and agent text to browser & Electron app
                broadcastToBrowsers({
                    type: 'ConversationText',
                    role: message.role,
                    content: message.content,
                });

                if (message.role === 'user') {
                    if (activeCallbacks.onUserTranscript) {
                        activeCallbacks.onUserTranscript(message.content);
                    }
                } else if (message.role === 'assistant') {
                    if (activeCallbacks.onAssistantResponse) {
                        activeCallbacks.onAssistantResponse(message.content);
                    }
                }
                break;
            }

            case 'AgentThinking': {
                broadcastToBrowsers({
                    type: 'AgentThinking',
                    content: message.content || '',
                });
                if (activeCallbacks.onThinking) {
                    activeCallbacks.onThinking(message.content || '');
                }
                break;
            }

            case 'UserStartedSpeaking': {
                broadcastToBrowsers({ type: 'UserStartedSpeaking' });
                if (activeCallbacks.onUserStartedSpeaking) {
                    activeCallbacks.onUserStartedSpeaking();
                }
                break;
            }

            case 'EndOfTurn':
            case 'EagerEndOfTurn': {
                broadcastToBrowsers({ type: message.type });
                if (activeCallbacks.onThinking) {
                    activeCallbacks.onThinking('Processing...');
                }
                break;
            }

            case 'AgentAudioDone': {
                broadcastToBrowsers({ type: 'AgentAudioDone' });
                if (activeCallbacks.onAgentDone) {
                    activeCallbacks.onAgentDone();
                }
                break;
            }

            case 'Error':
            case 'Warning': {
                console.error(`Deepgram ${message.type}:`, message.description || message.code || message);
                broadcastToBrowsers({
                    type: message.type,
                    description: message.description,
                    code: message.code,
                });
                if (activeCallbacks.onError) {
                    activeCallbacks.onError(message.description || message.type);
                }
                break;
            }

            default:
                break; // ignore AgentAudioDone, etc.
        }
    });

    dgWs.on('error', err => {
        console.error('Deepgram error:', err.message);
        broadcastToBrowsers({ type: 'Error', description: err.message });
        if (activeCallbacks.onError) {
            activeCallbacks.onError(err.message);
        }
    });

    dgWs.on('close', (code, reason) => {
        console.log(`Deepgram closed: ${code} ${reason}`);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        activeSettingsApplied = false;
        wsConnected = false;
        liveEnabled = false;
        isSessionActive = false;
        isConnecting = false;
        broadcastToBrowsers({ type: 'Disconnected', wsConnected: false, liveEnabled: false });
        if (activeCallbacks.onStopped) {
            activeCallbacks.onStopped(code);
        }
    });

    return dgWs;
}

// ─── WebSocket Server Connections (from Browser or local clients) ────────────
wss.on('connection', browserWs => {
    console.log('Browser connected.');
    browserClients.add(browserWs);

    // If an active session is already running, notify browser immediately
    if (activeSettingsApplied) {
        browserWs.send(JSON.stringify({ type: 'Ready' }));
    }

    // Messages from browser: binary = mic audio, text = control
    browserWs.on('message', (data, isBinary) => {
        if (isBinary) {
            // Forward raw PCM16 audio straight to Deepgram
            if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN && activeSettingsApplied) {
                activeDeepgramWs.send(data);
            }
            return;
        }

        // JSON control messages
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (msg.type === 'start') {
            const apiKey = getEffectiveApiKey(msg.apiKey);
            const prompt = msg.prompt || getProjectSystemPrompt(msg.profile, msg.customPrompt);
            startTranscription({ apiKey, systemPrompt: prompt });
        } else if (msg.type === 'stop') {
            stopTranscription();
        } else if (msg.type === 'InjectUserMessage') {
            if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN) {
                activeDeepgramWs.send(
                    JSON.stringify({
                        type: 'InjectUserMessage',
                        content: msg.content,
                    })
                );
            }
        } else if (msg.type === 'Close') {
            // User stopped speaking – flush the audio stream
            if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN) {
                try {
                    activeDeepgramWs.send(JSON.stringify({ type: 'Close' }));
                } catch (e) {}
            }
        }
    });

    browserWs.on('close', () => {
        console.log('Browser disconnected.');
        browserClients.delete(browserWs);
    });
});

// ─── Start Express / HTTP Server ─────────────────────────────────────────────
let serverStarted = false;
function startServer() {
    if (serverStarted) return;
    try {
        server.listen(PORT, () => {
            console.log(`Server on http://localhost:${PORT}`);
            serverStarted = true;
        });
        server.on('error', err => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[Server] Port ${PORT} already in use. Reusing existing port.`);
                serverStarted = true;
            } else {
                console.error('[Server Error]:', err.message);
            }
        });
    } catch (e) {
        console.error('[Server Start Error]:', e);
    }
}

// Automatically start server only if in server mode or run directly as script
const isServerMode = process.env.SERVER_MODE === 'true' || require.main === module;
if (isServerMode) {
    startServer();
}

// ─── Backend WebSocket Client (for connecting to remote backend e.g. 13.233.70.37:3000) ───

async function startBackendClient(backendWsUrl, options = {}) {
    if (activeBackendWs && activeBackendWs.readyState === WebSocket.OPEN && activeSettingsApplied) {
        console.log('ℹ️ [LiveTranscription] Backend connection already active');
        return true;
    }

    stopTranscription();
    isConnecting = true;
    activeSettingsApplied = false;
    wsConnected = false;

    console.log(`🔌 [LiveTranscription] Connecting to remote backend at ${backendWsUrl}...`);

    return new Promise(resolve => {
        let isResolved = false;
        const finish = result => {
            if (!isResolved) {
                isResolved = true;
                resolve(result);
            }
        };

        const timeout = setTimeout(() => {
            if (!activeSettingsApplied) {
                console.warn('[LiveTranscription] Connection to backend timed out (10s)');
                finish(false);
            }
        }, 10000);

        try {
            const ws = new WebSocket(backendWsUrl);
            activeBackendWs = ws;

            ws.on('open', () => {
                console.log(`✅ [LiveTranscription] Connected to remote backend at ${backendWsUrl}`);
                if (activeCallbacks.onLog) activeCallbacks.onLog(`Connected to backend: ${backendWsUrl}`);

                // Send start initialization message
                const apiKey = getEffectiveApiKey(options.apiKey || options.sttApiKey);
                const prompt = options.systemPrompt || getProjectSystemPrompt(options.profile, options.customPrompt);

                try {
                    ws.send(
                        JSON.stringify({
                            type: 'start',
                            apiKey,
                            prompt,
                            profile: options.profile,
                            customPrompt: options.customPrompt,
                        })
                    );
                } catch (e) {
                    console.error('[LiveTranscription] Failed to send start message:', e);
                }

                if (clientPingTimer) clearInterval(clientPingTimer);
                clientPingTimer = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.ping();
                        } catch (e) {}
                    }
                }, 10000);
            });

            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    // Audio playback from server is disabled per requirement
                    return;
                }

                let message;
                try {
                    message = JSON.parse(data.toString());
                } catch {
                    return;
                }

                if (message.type !== 'LatencyReport') {
                    console.log('[Backend → App]', message.type);
                }

                switch (message.type) {
                    case 'Ready': {
                        activeSettingsApplied = true;
                        wsConnected = true;
                        isConnecting = false;
                        isSessionActive = true;
                        clearTimeout(timeout);
                        if (activeCallbacks.onLog) activeCallbacks.onLog('Backend Voice Agent Ready');
                        finish(true);
                        break;
                    }

                    case 'ConversationText': {
                        if (message.role === 'user') {
                            if (activeCallbacks.onUserTranscript) {
                                activeCallbacks.onUserTranscript(message.content);
                            }
                        } else if (message.role === 'assistant') {
                            if (activeCallbacks.onAssistantResponse) {
                                activeCallbacks.onAssistantResponse(message.content);
                            }
                        }
                        break;
                    }

                    case 'AgentThinking': {
                        if (activeCallbacks.onThinking) {
                            activeCallbacks.onThinking(message.content || 'Thinking...');
                        }
                        break;
                    }

                    case 'UserStartedSpeaking': {
                        if (activeCallbacks.onUserStartedSpeaking) {
                            activeCallbacks.onUserStartedSpeaking();
                        }
                        break;
                    }

                    case 'EndOfTurn':
                    case 'EagerEndOfTurn': {
                        if (activeCallbacks.onThinking) {
                            activeCallbacks.onThinking('Processing...');
                        }
                        break;
                    }

                    case 'AgentAudioDone': {
                        if (activeCallbacks.onAgentDone) {
                            activeCallbacks.onAgentDone();
                        }
                        break;
                    }

                    case 'Error':
                    case 'Warning': {
                        console.error(`[Backend ${message.type}]:`, message.description || message.code || message);
                        if (activeCallbacks.onError) {
                            activeCallbacks.onError(message.description || message.type);
                        }
                        break;
                    }

                    case 'Disconnected': {
                        activeSettingsApplied = false;
                        wsConnected = false;
                        isSessionActive = false;
                        isConnecting = false;
                        if (activeCallbacks.onStopped) {
                            activeCallbacks.onStopped();
                        }
                        break;
                    }

                    default:
                        break;
                }
            });

            ws.on('error', err => {
                console.error('[LiveTranscription] Backend WS Error:', err.message);
                if (activeCallbacks.onError) {
                    activeCallbacks.onError(`Backend WS Error: ${err.message}`);
                }
                finish(false);
            });

            ws.on('close', (code, reason) => {
                console.log(`[LiveTranscription] Backend WS closed (${code} ${reason})`);
                if (clientPingTimer) clearInterval(clientPingTimer);
                clientPingTimer = null;
                activeSettingsApplied = false;
                wsConnected = false;
                isSessionActive = false;
                isConnecting = false;
                activeBackendWs = null;
                if (activeCallbacks.onStopped) {
                    activeCallbacks.onStopped(code);
                }
                finish(false);
            });
        } catch (err) {
            console.error('[LiveTranscription] Exception creating backend WS:', err);
            finish(false);
        }
    });
}

// ─── Module Interface for Cheating Daddy Desktop App ─────────────────────────

function ensure48kPcm(buffer, sampleRate = 48000) {
    if (!buffer || buffer.length === 0) return buffer;
    if (sampleRate === 24000) {
        // Upsample 24k -> 48k (duplicate each 16-bit linear sample)
        const samples = buffer.length / 2;
        const out = Buffer.alloc(samples * 4);
        for (let i = 0; i < samples; i++) {
            const val = buffer.readInt16LE(i * 2);
            out.writeInt16LE(val, i * 4);
            out.writeInt16LE(val, i * 4 + 2);
        }
        return out;
    }
    return buffer;
}

async function startTranscription(options = {}, callbacks = {}) {
    if (callbacks) {
        activeCallbacks = { ...activeCallbacks, ...callbacks };
    }

    const backendWsUrl = getEffectiveBackendWsUrl(options.backendUrl);
    if (backendWsUrl) {
        const connected = await startBackendClient(backendWsUrl, options);
        if (connected) return true;
        console.warn(`[LiveTranscription] Could not connect to remote backend at ${backendWsUrl}. Checking local fallback...`);
    }

    // Direct Deepgram connection fallback
    const apiKey = getEffectiveApiKey(options.apiKey || options.sttApiKey);
    if (!apiKey) {
        console.error('❌ [LiveTranscription] Deepgram API Key not configured and backend unreachable!');
        if (activeCallbacks.onError) activeCallbacks.onError('Deepgram API key not configured');
        return false;
    }

    if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN && activeSettingsApplied) {
        console.log('ℹ️ [LiveTranscription] Deepgram session already active');
        return true;
    }

    stopTranscription();

    isConnecting = true;
    currentPrompt = options.systemPrompt || getProjectSystemPrompt(options.profile, options.customPrompt);

    activeDeepgramWs = createDeepgramConnection(apiKey, currentPrompt);
    if (!activeDeepgramWs) {
        isConnecting = false;
        return false;
    }

    // Wait up to 10 seconds for SettingsApplied
    const timeout = Date.now() + 10000;
    while (!activeSettingsApplied && Date.now() < timeout) {
        if (!activeDeepgramWs || activeDeepgramWs.readyState === WebSocket.CLOSED) {
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    return activeSettingsApplied;
}

function sendAudio(pcmBuffer, sampleRate = 48000) {
    const audio48k = ensure48kPcm(pcmBuffer, sampleRate);
    if (!audio48k || audio48k.length === 0) return;

    if (activeBackendWs && activeBackendWs.readyState === WebSocket.OPEN) {
        try {
            activeBackendWs.send(audio48k);
        } catch (e) {
            console.error('[SendAudio to Backend Error]:', e.message);
        }
        return;
    }

    if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN && activeSettingsApplied) {
        try {
            activeDeepgramWs.send(audio48k);
        } catch (e) {
            console.error('[SendAudio Error]:', e.message);
        }
    }
}

function sendTextMessage(content) {
    if (activeBackendWs && activeBackendWs.readyState === WebSocket.OPEN) {
        try {
            activeBackendWs.send(
                JSON.stringify({
                    type: 'InjectUserMessage',
                    content,
                })
            );
            return true;
        } catch (e) {
            console.error('[SendTextMessage to Backend Error]:', e.message);
            return false;
        }
    }

    if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN) {
        try {
            activeDeepgramWs.send(
                JSON.stringify({
                    type: 'InjectUserMessage',
                    content,
                })
            );
            return true;
        } catch (e) {
            console.error('[SendTextMessage Error]:', e.message);
            return false;
        }
    }
    return false;
}

function finalizeTranscription() {
    // In Deepgram Voice Agent (Nova-3), natural turn-taking and end-of-turn detection
    // are automatically handled by the engine. Do not send invalid text frames.
}

function stopTranscription() {
    if (clientPingTimer) {
        clearInterval(clientPingTimer);
        clientPingTimer = null;
    }
    if (activeBackendWs) {
        try {
            if (activeBackendWs.readyState === WebSocket.OPEN) {
                activeBackendWs.send(JSON.stringify({ type: 'stop' }));
            }
        } catch (e) {}
        safeClose(activeBackendWs);
        activeBackendWs = null;
    }
    if (activeKeepAliveTimer) {
        clearInterval(activeKeepAliveTimer);
        activeKeepAliveTimer = null;
    }
    if (activeDeepgramWs) {
        safeClose(activeDeepgramWs);
        activeDeepgramWs = null;
    }
    activeSettingsApplied = false;
    wsConnected = false;
    liveEnabled = false;
    isSessionActive = false;
    isConnecting = false;
}

function setLiveState(enabled) {
    liveEnabled = Boolean(enabled);
    console.log(`[Deepgram Agent] Live state: ${liveEnabled ? 'LIVE ON (Microphone Active)' : 'LIVE OFF (Silence Stream)'}`);
    if (activeBackendWs && activeBackendWs.readyState === WebSocket.OPEN) {
        try {
            activeBackendWs.send(JSON.stringify({ type: 'LiveState', liveEnabled, wsConnected }));
        } catch (e) {}
    }
    broadcastToBrowsers({ type: 'LiveState', liveEnabled, wsConnected });
    return liveEnabled;
}

function isLiveEnabled() {
    return liveEnabled;
}

function isWsConnected() {
    if (activeBackendWs) {
        return Boolean(wsConnected && activeBackendWs.readyState === WebSocket.OPEN);
    }
    return Boolean(wsConnected && activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN);
}

function isAvailable() {
    return Boolean(getEffectiveBackendWsUrl() || getEffectiveApiKey());
}

function getStatus() {
    return {
        wsConnected: isWsConnected(),
        liveEnabled: liveEnabled,
        isRunning: isWsConnected(),
        isConnecting,
        settingsApplied: activeSettingsApplied,
        hasApiKey: isAvailable(),
        backendUrl: getEffectiveBackendWsUrl(),
        port: PORT,
    };
}

function shutdown(reason = '') {
    console.log(`[Shutdown LiveTranscription] ${reason}`);
    stopTranscription();
    try {
        for (const client of browserClients) {
            safeClose(client);
        }
        browserClients.clear();
        if (server && server.listening) {
            server.close();
        }
    } catch (e) {}
}

module.exports = {
    app,
    server,
    wss,
    startTranscription,
    stopTranscription,
    setLiveState,
    isLiveEnabled,
    isWsConnected,
    sendAudio,
    sendTextMessage,
    finalizeTranscription,
    isAvailable,
    getStatus,
    shutdown,
    getEffectiveApiKey,
    getProjectSystemPrompt,
    getEffectiveBackendWsUrl,
};
