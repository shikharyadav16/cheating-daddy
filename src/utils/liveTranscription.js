const dns = require('dns');
try {
    if (typeof dns.setDefaultResultOrder === 'function') {
        dns.setDefaultResultOrder('ipv4first');
    }
} catch (e) {
    console.warn('⚠️ [DNS] Could not set ipv4first result order:', e.message);
}

require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const storage = require('../storage');
const { getSystemPrompt } = require('./prompts');

const PORT = process.env.PORT || 3000;
const DEEPGRAM_STT_URL =
    'wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=false&interim_results=true&endpointing=100&utterance_end_ms=1000&vad_events=true&encoding=linear16&sample_rate=48000';

const VALID_GROQ_MODELS = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';

const groqHttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    keepAliveMsecs: 10000,
    timeout: 30000,
});

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

// ─── Key Helpers ─────────────────────────────────────────────────────────────

function getEffectiveApiKey(overrideKey) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim()) {
        const trimmed = overrideKey.trim();
        if (!trimmed.startsWith('AQ.')) return trimmed;
    }
    if (process.env.STT_KEY && process.env.STT_KEY.trim()) {
        return process.env.STT_KEY.trim();
    }
    if (process.env.DEEPGRAM_API_KEY && process.env.DEEPGRAM_API_KEY.trim()) {
        return process.env.DEEPGRAM_API_KEY.trim();
    }
    try {
        if (storage && typeof storage.getApiKey === 'function') {
            const key = storage.getApiKey();
            if (key && key.trim() && !key.trim().startsWith('AQ.')) return key.trim();
        }
    } catch (e) {}
    return '';
}

function getEffectiveGroqKey() {
    if (process.env.GROQ_KEY && process.env.GROQ_KEY.trim()) {
        return process.env.GROQ_KEY.trim();
    }
    try {
        if (storage && typeof storage.getPreferences === 'function') {
            const prefs = storage.getPreferences();
            if (prefs && prefs.groqApiKey && prefs.groqApiKey.trim()) {
                return prefs.groqApiKey.trim();
            }
        }
    } catch (e) {}
    return '';
}

function getSelectedGroqModel() {
    try {
        if (storage && typeof storage.getPreferences === 'function') {
            const prefs = storage.getPreferences();
            if (prefs && prefs.liveTranscriptionModel && VALID_GROQ_MODELS.includes(prefs.liveTranscriptionModel.trim())) {
                return prefs.liveTranscriptionModel.trim();
            }
        }
    } catch (e) {}
    return DEFAULT_GROQ_MODEL;
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

// ─── Active Session State ───────────────────────────────────────────────────

let activeDeepgramWs = null;
let activeKeepAliveTimer = null;
let wsConnected = false;
let liveEnabled = false;
let isSessionActive = false;
let isConnecting = false;
let currentPrompt = '';
let accumulatedTranscript = '';
let currentGroqReq = null;

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

// ─── Groq Streaming Response Engine ──────────────────────────────────────────

function abortGroq() {
    if (currentGroqReq) {
        try {
            currentGroqReq._aborted = true;
            currentGroqReq.destroy();
        } catch (e) {}
        currentGroqReq = null;
    }
}

function streamGroqResponse(questionText) {
    abortGroq();

    const groqKey = getEffectiveGroqKey();
    if (!groqKey) {
        console.error('❌ [Groq] GROQ_KEY not found in .env or storage!');
        if (activeCallbacks.onError) activeCallbacks.onError('Groq API Key not found');
        return;
    }

    const cleanQuestion = (questionText || '').trim();
    if (!cleanQuestion) return;

    const systemPrompt = currentPrompt || getProjectSystemPrompt();
    const model = getSelectedGroqModel();

    console.log(`⚡ [Groq] Streaming response for "${cleanQuestion}" using [${model}]...`);
    if (activeCallbacks.onThinking) {
        activeCallbacks.onThinking('Groq answering...');
    }

    const payload = {
        model: model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleanQuestion },
        ],
        stream: true,
        temperature: 0.4,
        max_completion_tokens: 2048,
    };
    if (model.includes('gpt-oss')) {
        payload.reasoning_effort = 'low';
    }
    const postData = JSON.stringify(payload);

    let accumulatedText = '';

    const req = https.request(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',
            agent: groqHttpsAgent,
            headers: {
                Authorization: `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        },
        res => {
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', chunk => (errBody += chunk));
                res.on('end', () => {
                    console.error(`[Groq Error ${res.statusCode}]:`, errBody);
                    if (activeCallbacks.onError) activeCallbacks.onError(`Groq Error: ${res.statusCode}`);
                    if (activeCallbacks.onAgentDone) activeCallbacks.onAgentDone();
                });
                return;
            }

            let buffer = '';
            res.on('data', chunk => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                        try {
                            const parsed = JSON.parse(trimmed.slice(6));
                            const delta = parsed.choices?.[0]?.delta;
                            if (delta?.content) {
                                accumulatedText += delta.content;
                                if (activeCallbacks.onAssistantResponse) {
                                    activeCallbacks.onAssistantResponse(accumulatedText);
                                }
                            } else if (delta?.reasoning && !accumulatedText && activeCallbacks.onThinking) {
                                activeCallbacks.onThinking('Thinking...');
                            }
                        } catch (e) {}
                    }
                }
            });

            res.on('end', () => {
                currentGroqReq = null;
                console.log(`✅ [Groq] Response completed (${accumulatedText.split(/\s+/).length} words)`);
                if (accumulatedText && activeCallbacks.onAssistantResponse) {
                    activeCallbacks.onAssistantResponse(accumulatedText);
                }
                broadcastToBrowsers({
                    type: 'ConversationText',
                    role: 'assistant',
                    content: accumulatedText,
                });
                if (activeCallbacks.onAgentDone) {
                    activeCallbacks.onAgentDone(accumulatedText);
                }
            });

            res.on('error', err => {
                if (req._aborted || req.destroyed || err.name === 'AbortError' || err.code === 'ECONNRESET') {
                    currentGroqReq = null;
                    return;
                }
                console.error('[Groq Stream Error]:', err.message);
                currentGroqReq = null;
                if (activeCallbacks.onAgentDone) activeCallbacks.onAgentDone();
            });
        }
    );

    req.on('error', err => {
        if (req._aborted || req.destroyed || err.name === 'AbortError' || err.code === 'ECONNRESET') {
            currentGroqReq = null;
            return;
        }
        console.error('[Groq Request Error]:', err.message);
        if (activeCallbacks.onError) activeCallbacks.onError(`Groq Request Error: ${err.message}`);
        currentGroqReq = null;
        if (activeCallbacks.onAgentDone) activeCallbacks.onAgentDone();
    });

    currentGroqReq = req;
    req.write(postData);
    req.end();
}

// ─── Deepgram Nova-2 Connection ──────────────────────────────────────────────

function createDeepgramConnection(apiKey) {
    const key = getEffectiveApiKey(apiKey);
    if (!key) {
        console.error('❌ [Deepgram STT] API key not found.');
        return null;
    }

    console.log('🔌 Connecting to Deepgram Nova-2 STT...');
    const dgWs = new WebSocket(DEEPGRAM_STT_URL, {
        headers: { Authorization: `Token ${key}` },
    });

    let keepAliveTimer = null;

    dgWs.on('open', () => {
        console.log('✅ Connected to Deepgram Nova-2 STT.');
        wsConnected = true;
        isConnecting = false;
        isSessionActive = true;

        broadcastToBrowsers({ type: 'Ready', wsConnected: true, liveEnabled });

        // Send initial silence buffer so Deepgram registers audio within the initial 10s window (NET-0001)
        const silenceBuffer = Buffer.alloc(9600); // 100ms of 48kHz Linear16
        try {
            dgWs.send(silenceBuffer);
        } catch (e) {}

        // Keep-alive every 3 seconds to prevent timeout: sends KeepAlive JSON + periodic silence buffer
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
            if (dgWs.readyState === WebSocket.OPEN) {
                try {
                    dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
                    if (!liveEnabled) {
                        dgWs.send(silenceBuffer);
                    }
                } catch (e) {}
            }
        }, 3000);
        activeKeepAliveTimer = keepAliveTimer;

        if (activeCallbacks.onLog) activeCallbacks.onLog('Deepgram Nova-2 STT Connected');
    });

    dgWs.on('message', data => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        switch (msg.type) {
            case 'SpeechStarted': {
                console.log('🎙️ [Deepgram] Speech started');
                if (activeCallbacks.onUserStartedSpeaking) {
                    activeCallbacks.onUserStartedSpeaking();
                }
                break;
            }

            case 'Results': {
                const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim() || '';
                if (!transcript) return;

                if (msg.is_final) {
                    accumulatedTranscript = accumulatedTranscript ? `${accumulatedTranscript} ${transcript}` : transcript;

                    // Update live preview immediately (isFinal: false)
                    if (activeCallbacks.onUserTranscript) {
                        activeCallbacks.onUserTranscript(accumulatedTranscript, false);
                    }

                    if (msg.speech_final) {
                        const finalText = accumulatedTranscript.trim();
                        accumulatedTranscript = '';
                        console.log(`🎯 [Deepgram STT speech_final Committed]: "${finalText}"`);

                        broadcastToBrowsers({
                            type: 'ConversationText',
                            role: 'user',
                            content: finalText,
                        });

                        // Commit complete utterance (isFinal: true)
                        if (activeCallbacks.onUserTranscript) {
                            activeCallbacks.onUserTranscript(finalText, true);
                        }
                    }
                } else {
                    // Interim replaces the live preview immediately (isFinal: false)
                    const livePreview = accumulatedTranscript ? `${accumulatedTranscript} ${transcript}` : transcript;
                    if (activeCallbacks.onUserTranscript) {
                        activeCallbacks.onUserTranscript(livePreview, false);
                    }
                }
                break;
            }

            case 'UtteranceEnd': {
                const finalText = accumulatedTranscript.trim();
                if (finalText) {
                    accumulatedTranscript = '';
                    console.log(`🎯 [Deepgram STT UtteranceEnd Committed]: "${finalText}"`);

                    broadcastToBrowsers({
                        type: 'ConversationText',
                        role: 'user',
                        content: finalText,
                    });

                    // Commit complete utterance fallback (isFinal: true)
                    if (activeCallbacks.onUserTranscript) {
                        activeCallbacks.onUserTranscript(finalText, true);
                    }
                }
                break;
            }

            case 'Error': {
                console.error('[Deepgram Error]:', msg.description || msg.message || msg);
                if (activeCallbacks.onError) activeCallbacks.onError(msg.description || 'Deepgram error');
                break;
            }

            default:
                break;
        }
    });

    dgWs.on('error', err => {
        console.error('[Deepgram WS Error]:', err.message);
        if (activeCallbacks.onError) activeCallbacks.onError(`Deepgram WS Error: ${err.message}`);
    });

    dgWs.on('close', (code, reason) => {
        console.log(`[Deepgram WS Closed] (${code} ${reason})`);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = null;
        wsConnected = false;
        const wasActive = isSessionActive;
        isSessionActive = false;
        isConnecting = false;
        activeDeepgramWs = null;
        if (activeCallbacks.onStopped) {
            activeCallbacks.onStopped(code);
        }
        // Auto-reconnect if unexpectedly closed with timeout (1011 NET-0001)
        if (wasActive && code === 1011 && !isConnecting) {
            console.log('🔄 [Deepgram STT] Connection timed out, automatically reconnecting...');
            setTimeout(() => {
                startTranscription();
            }, 1000);
        }
    });

    return dgWs;
}

// ─── Local WebSocket Server Connections (Browser clients) ───────────────────

wss.on('connection', browserWs => {
    browserClients.add(browserWs);
    if (wsConnected) {
        browserWs.send(JSON.stringify({ type: 'Ready' }));
    }

    browserWs.on('message', (data, isBinary) => {
        if (isBinary) {
            if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN && liveEnabled) {
                activeDeepgramWs.send(data);
            }
            return;
        }

        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        if (msg.type === 'start') {
            startTranscription(msg);
        } else if (msg.type === 'stop') {
            stopTranscription();
        } else if (msg.type === 'InjectUserMessage') {
            streamGroqResponse(msg.content);
        }
    });

    browserWs.on('close', () => {
        browserClients.delete(browserWs);
    });
});

// ─── Start Express / HTTP Server ─────────────────────────────────────────────

let serverStarted = false;
function startServer() {
    if (serverStarted || (server && server.listening)) return;
    serverStarted = true;
    try {
        server.listen(PORT, () => {
            console.log(`Server on http://localhost:${PORT}`);
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

startServer();

// ─── Module Interface for Desktop App ────────────────────────────────────────

function ensure48kPcm(buffer, sampleRate = 48000) {
    if (!buffer || buffer.length === 0) return buffer;
    if (sampleRate === 24000) {
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
    startServer();

    if (callbacks) {
        activeCallbacks = { ...activeCallbacks, ...callbacks };
    }

    const apiKey = getEffectiveApiKey(options.apiKey || options.sttApiKey);
    if (!apiKey) {
        console.error('❌ [LiveTranscription] Deepgram API Key not configured!');
        if (activeCallbacks.onError) activeCallbacks.onError('Deepgram API key not configured');
        return false;
    }

    const groqKey = getEffectiveGroqKey();
    if (!groqKey) {
        console.error('❌ [LiveTranscription] Groq API Key not configured in .env or storage!');
        if (activeCallbacks.onError) activeCallbacks.onError('Groq API key not configured');
        return false;
    }

    if (activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN) {
        console.log('ℹ️ [LiveTranscription] Deepgram Nova-2 session already active');
        return true;
    }

    stopTranscription();

    isConnecting = true;
    currentPrompt = options.systemPrompt || getProjectSystemPrompt(options.profile, options.customPrompt);
    accumulatedTranscript = '';

    activeDeepgramWs = createDeepgramConnection(apiKey);
    if (!activeDeepgramWs) {
        isConnecting = false;
        return false;
    }

    // Wait up to 5 seconds for connection
    const timeout = Date.now() + 5000;
    while (!wsConnected && Date.now() < timeout) {
        if (!activeDeepgramWs || activeDeepgramWs.readyState === WebSocket.CLOSED) {
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    return wsConnected;
}

function sendAudio(pcmBuffer, sampleRate = 48000) {
    if (!activeDeepgramWs || activeDeepgramWs.readyState !== WebSocket.OPEN) {
        return;
    }
    if (!liveEnabled) {
        return; // Don't forward silence or unneeded audio to Deepgram
    }
    try {
        const audio48k = ensure48kPcm(pcmBuffer, sampleRate);
        activeDeepgramWs.send(audio48k);
    } catch (e) {
        console.error('[SendAudio Error]:', e.message);
    }
}

function sendTextMessage(content) {
    if (!content || !content.trim()) return false;
    streamGroqResponse(content.trim());
    return true;
}

function finalizeTranscription() {
    if (accumulatedTranscript && accumulatedTranscript.trim()) {
        const q = accumulatedTranscript.trim();
        accumulatedTranscript = '';
        if (activeCallbacks.onUserTranscript) activeCallbacks.onUserTranscript(q);
        streamGroqResponse(q);
    }
}

function stopTranscription() {
    abortGroq();
    if (activeKeepAliveTimer) {
        clearInterval(activeKeepAliveTimer);
        activeKeepAliveTimer = null;
    }
    if (activeDeepgramWs) {
        safeClose(activeDeepgramWs);
        activeDeepgramWs = null;
    }
    wsConnected = false;
    liveEnabled = false;
    isSessionActive = false;
    isConnecting = false;
    accumulatedTranscript = '';
}

function setLiveState(enabled) {
    liveEnabled = Boolean(enabled);
    if (!liveEnabled) {
        accumulatedTranscript = '';
    }
    console.log(`[Deepgram Agent] Live state: ${liveEnabled ? 'LIVE ON (Microphone Active)' : 'LIVE OFF (Silence Stream)'}`);
    broadcastToBrowsers({ type: 'LiveState', liveEnabled, wsConnected });
    return liveEnabled;
}

function isLiveEnabled() {
    return liveEnabled;
}

function isWsConnected() {
    return Boolean(wsConnected && activeDeepgramWs && activeDeepgramWs.readyState === WebSocket.OPEN);
}

function isAvailable() {
    return Boolean(getEffectiveApiKey() && getEffectiveGroqKey());
}

function getStatus() {
    return {
        wsConnected: isWsConnected(),
        liveEnabled: liveEnabled,
        isRunning: isWsConnected(),
        isConnecting,
        hasApiKey: isAvailable(),
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
    getEffectiveGroqKey,
    getProjectSystemPrompt,
};
