import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class MainView extends LitElement {
    static styles = css`
        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--space-xl) var(--space-lg);
            overflow-y: auto;
        }

        .form-wrapper {
            width: 100%;
            max-width: 440px;
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
        }

        .page-header {
            margin-bottom: var(--space-xs);
        }

        .page-title {
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .page-title .mode-suffix {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            background: rgba(59, 130, 246, 0.15);
            color: var(--accent);
            border: 1px solid rgba(59, 130, 246, 0.3);
        }

        .page-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            margin-top: var(--space-xs);
        }

        /* ── Card / Section container ── */

        .section-card {
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .section-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .status-badge {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            padding: 2px 8px;
            border-radius: 9999px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .status-badge.active {
            background: rgba(34, 197, 94, 0.12);
            color: var(--success);
            border: 1px solid rgba(34, 197, 94, 0.25);
        }

        .status-badge.required {
            background: rgba(212, 160, 23, 0.12);
            color: var(--warning);
            border: 1px solid rgba(212, 160, 23, 0.25);
        }

        /* ── Form Controls ── */

        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-md);
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .form-group.full-width {
            grid-column: 1 / -1;
        }

        .form-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .input-row {
            position: relative;
            display: flex;
            align-items: center;
        }

        input,
        select {
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            padding: 9px 12px;
            width: 100%;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            transition:
                border-color var(--transition),
                box-shadow var(--transition);
        }

        input:hover:not(:focus),
        select:hover:not(:focus) {
            border-color: var(--border-strong);
        }

        input:focus,
        select:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }

        input::placeholder {
            color: var(--text-muted);
        }

        input.error {
            border-color: var(--danger, #ef4444);
            box-shadow: 0 0 0 1px var(--danger, #ef4444);
        }

        select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
            background-position: right 8px center;
            background-repeat: no-repeat;
            background-size: 14px;
            padding-right: 28px;
        }

        .toggle-vis-btn {
            position: absolute;
            right: 8px;
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            border-radius: var(--radius-sm);
        }

        .toggle-vis-btn:hover {
            color: var(--text-primary);
        }

        .form-hint {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .form-hint span.link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .form-hint span.link:hover {
            text-decoration: underline;
        }

        /* ── Engine Info Banner ── */

        .engine-info {
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .engine-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: var(--font-size-xs);
        }

        .engine-label {
            color: var(--text-muted);
        }

        .engine-value {
            color: var(--text-secondary);
            font-family: var(--font-mono);
        }

        /* ── Start button ── */

        .start-button {
            position: relative;
            overflow: hidden;
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 12px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
            transition: opacity 0.2s;
        }

        .start-button canvas.btn-aurora {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            filter: blur(12px);
            opacity: 0.85;
            pointer-events: none;
        }

        .start-button canvas.btn-dither {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            opacity: 0.18;
            mix-blend-mode: overlay;
            image-rendering: pixelated;
            pointer-events: none;
        }

        .start-button .btn-label {
            position: relative;
            z-index: 2;
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .start-button:hover {
            opacity: 0.95;
        }

        .start-button.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .shortcut-hint {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            opacity: 0.6;
            font-family: var(--font-mono);
            font-size: var(--font-size-xs);
            margin-left: 4px;
        }
    `;

    static properties = {
        onStart: { type: Function },
        onExternalLink: { type: Function },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        onProfileChange: { type: Function },
        onLanguageChange: { type: Function },
        isInitializing: { type: Boolean },
        _apiKey: { state: true },
        _keyVisible: { state: true },
        _keyError: { state: true },
        _audioMode: { state: true },
        _backendUrl: { state: true },
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onExternalLink = () => {};
        this.selectedProfile = 'interview';
        this.selectedLanguage = 'en-US';
        this.onProfileChange = () => {};
        this.onLanguageChange = () => {};
        this.isInitializing = false;

        this._apiKey = '';
        this._keyVisible = false;
        this._keyError = false;
        this._audioMode = 'both';
        this._backendUrl = 'http://13.233.70.37:3000';

        this._animId = null;
        this._time = 0;
        this._mouseX = -1;
        this._mouseY = -1;

        this.boundKeydownHandler = this._handleKeydown.bind(this);
        this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            const [savedKey, prefs] = await Promise.all([
                cheatingDaddy.storage.getApiKey().catch(() => ''),
                cheatingDaddy.storage.getPreferences().catch(() => ({})),
            ]);
            this._apiKey = savedKey || '';
            if (prefs.selectedProfile) this.selectedProfile = prefs.selectedProfile;
            if (prefs.selectedLanguage) this.selectedLanguage = prefs.selectedLanguage;
            if (prefs.audioMode) this._audioMode = prefs.audioMode;
            if (prefs.backendUrl) this._backendUrl = prefs.backendUrl;
            this.requestUpdate();
        } catch (e) {
            console.error('Error loading MainView storage:', e);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('keydown', this.boundKeydownHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        document.removeEventListener('keydown', this.boundKeydownHandler);
        if (this._animId) cancelAnimationFrame(this._animId);
    }

    firstUpdated() {
        this._initButtonAurora();
    }

    _initButtonAurora() {
        const btn = this.shadowRoot ? this.shadowRoot.querySelector('.start-button') : null;
        const aurora = this.shadowRoot ? this.shadowRoot.querySelector('canvas.btn-aurora') : null;
        const dither = this.shadowRoot ? this.shadowRoot.querySelector('canvas.btn-dither') : null;
        if (!aurora || !dither || !btn) return;

        this._mouseX = -1;
        this._mouseY = -1;
        btn.addEventListener('mousemove', e => {
            const rect = btn.getBoundingClientRect();
            this._mouseX = (e.clientX - rect.left) / rect.width;
            this._mouseY = (e.clientY - rect.top) / rect.height;
        });
        btn.addEventListener('mouseleave', () => {
            this._mouseX = -1;
            this._mouseY = -1;
        });

        const blockSize = 8;
        const cols = Math.ceil((aurora.offsetWidth || 300) / blockSize);
        const rows = Math.ceil((aurora.offsetHeight || 44) / blockSize);
        dither.width = cols;
        dither.height = rows;
        const dCtx = dither.getContext('2d');
        if (dCtx) {
            const img = dCtx.createImageData(cols, rows);
            for (let i = 0; i < img.data.length; i += 4) {
                const v = Math.random() > 0.5 ? 255 : 0;
                img.data[i] = v;
                img.data[i + 1] = v;
                img.data[i + 2] = v;
                img.data[i + 3] = 255;
            }
            dCtx.putImageData(img, 0, 0);
        }

        const ctx = aurora.getContext('2d');
        if (!ctx) return;
        const scale = 0.4;
        aurora.width = Math.floor((aurora.offsetWidth || 300) * scale);
        aurora.height = Math.floor((aurora.offsetHeight || 44) * scale);

        const blobs = [
            { color: [120, 160, 230], x: 0.1, y: 0.3, vx: 0.25, vy: 0.2, phase: 0 },
            { color: [150, 120, 220], x: 0.8, y: 0.5, vx: -0.2, vy: 0.25, phase: 1.5 },
            { color: [200, 140, 210], x: 0.5, y: 0.6, vx: 0.18, vy: -0.22, phase: 3.0 },
            { color: [100, 190, 190], x: 0.3, y: 0.7, vx: 0.3, vy: 0.15, phase: 4.5 },
            { color: [220, 170, 130], x: 0.7, y: 0.4, vx: -0.22, vy: -0.25, phase: 6.0 },
        ];

        const draw = () => {
            this._time += 0.008;
            const w = aurora.width;
            const h = aurora.height;
            const maxDim = Math.max(w, h);

            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, w, h);

            const hovering = this._mouseX >= 0;

            for (const blob of blobs) {
                const t = this._time;
                const cx = (blob.x + Math.sin(t * blob.vx + blob.phase) * 0.4) * w;
                const cy = (blob.y + Math.cos(t * blob.vy + blob.phase * 0.7) * 0.4) * h;
                const r = maxDim * 0.45;

                let boost = 1;
                if (hovering) {
                    const dx = cx / w - this._mouseX;
                    const dy = cy / h - this._mouseY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    boost = 1 + 2.5 * Math.max(0, 1 - dist / 0.6);
                }

                const a0 = Math.min(1, 0.18 * boost);
                const a1 = Math.min(1, 0.08 * boost);
                const a2 = Math.min(1, 0.02 * boost);

                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                grad.addColorStop(0, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a0})`);
                grad.addColorStop(0.3, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a1})`);
                grad.addColorStop(0.6, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, ${a2})`);
                grad.addColorStop(1, `rgba(${blob.color[0]}, ${blob.color[1]}, ${blob.color[2]}, 0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }

            this._animId = requestAnimationFrame(draw);
        };

        draw();
    }

    _handleKeydown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            this._handleStart();
        }
    }

    async _saveApiKey(val) {
        this._apiKey = val;
        this._keyError = false;
        await cheatingDaddy.storage.setApiKey(val);
        this.requestUpdate();
    }

    async _handleProfileChange(val) {
        this.selectedProfile = val;
        await cheatingDaddy.storage.updatePreference('selectedProfile', val);
        this.onProfileChange(val);
        this.requestUpdate();
    }

    async _handleLanguageChange(val) {
        this.selectedLanguage = val;
        await cheatingDaddy.storage.updatePreference('selectedLanguage', val);
        this.onLanguageChange(val);
        this.requestUpdate();
    }

    async _handleAudioModeChange(val) {
        this._audioMode = val;
        await cheatingDaddy.storage.updatePreference('audioMode', val);
        await cheatingDaddy.refreshPreferencesCache();
        this.requestUpdate();
    }

    _handleStart() {
        if (this.isInitializing) return;

        const hasBackend = Boolean(this._backendUrl && this._backendUrl.trim());
        const hasKey = Boolean(this._apiKey && this._apiKey.trim());

        if (!hasBackend && !hasKey) {
            this._keyError = true;
            this.requestUpdate();
            return;
        }

        this.onStart();
    }

    triggerApiKeyError() {
        this._keyError = true;
        this.requestUpdate();
        setTimeout(() => {
            this._keyError = false;
            this.requestUpdate();
        }, 2000);
    }

    render() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const hasKey = Boolean(this._apiKey && this._apiKey.trim());

        const eyeIcon = this._keyVisible
            ? html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
              >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
              </svg>`
            : html`<svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
              >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
              </svg>`;

        const cmdIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path
                d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"
            />
        </svg>`;
        const ctrlIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M6 15l6-6 6 6" />
        </svg>`;
        const enterIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M9 10l-5 5 5 5" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>`;

        return html`
            <div class="form-wrapper">
                <div class="page-header">
                    <div class="page-title">
                        Cheating Daddy
                        <span class="mode-suffix">Voice Agent</span>
                    </div>
                    <div class="page-subtitle">Real-time interview and meeting assistant powered by Deepgram</div>
                </div>

                <!-- API Key Card -->
                <div class="section-card">
                    <div class="section-header">
                        <span class="section-title">Deepgram API Key</span>
                        <span class="status-badge ${hasKey ? 'active' : 'required'}"> ${hasKey ? '● Configured' : '● Key Required'} </span>
                    </div>

                    <div class="form-group">
                        <div class="input-row">
                            <input
                                type=${this._keyVisible ? 'text' : 'password'}
                                placeholder="Paste your Deepgram API Key here"
                                .value=${this._apiKey}
                                @input=${e => this._saveApiKey(e.target.value)}
                                class=${this._keyError ? 'error' : ''}
                            />
                            <button
                                class="toggle-vis-btn"
                                @click=${() => {
                                    this._keyVisible = !this._keyVisible;
                                    this.requestUpdate();
                                }}
                                title="${this._keyVisible ? 'Hide Key' : 'Show Key'}"
                            >
                                ${eyeIcon}
                            </button>
                        </div>
                        <div class="form-hint">
                            <span>API key is stored locally and securely.</span>
                            <span class="link" @click=${() => this.onExternalLink('https://console.deepgram.com')}> Get Deepgram key ↗ </span>
                        </div>
                    </div>
                </div>

                <!-- Session Options Card -->
                <div class="section-card">
                    <div class="section-header">
                        <span class="section-title">Session Configuration</span>
                    </div>

                    <div class="form-grid">
                        <!-- Role / Goal -->
                        <div class="form-group full-width">
                            <label class="form-label">Assistant Role & Goal</label>
                            <select .value=${this.selectedProfile} @change=${e => this._handleProfileChange(e.target.value)}>
                                <option value="interview" ?selected=${this.selectedProfile === 'interview'}>
                                    Job Interview (Technical & Behavioral)
                                </option>
                                <option value="meeting" ?selected=${this.selectedProfile === 'meeting'}>
                                    Business Meeting (Notes & Action Items)
                                </option>
                                <option value="sales" ?selected=${this.selectedProfile === 'sales'}>Sales Call (Pitches & Objection Handling)</option>
                                <option value="presentation" ?selected=${this.selectedProfile === 'presentation'}>
                                    Presentation (Q&A Defense & Flow)
                                </option>
                                <option value="negotiation" ?selected=${this.selectedProfile === 'negotiation'}>
                                    Negotiation (Counter-offers & Terms)
                                </option>
                                <option value="exam" ?selected=${this.selectedProfile === 'exam'}>Exam Assistant (Problem Solving & Logic)</option>
                            </select>
                        </div>

                        <!-- Audio Source -->
                        <div class="form-group">
                            <label class="form-label">Audio Input Source</label>
                            <select .value=${this._audioMode} @change=${e => this._handleAudioModeChange(e.target.value)}>
                                <option value="both" ?selected=${this._audioMode === 'both' || this._audioMode === 'mic_and_speaker'}>
                                    Microphone + System Audio (Recommended)
                                </option>
                                <option value="mic_only" ?selected=${this._audioMode === 'mic_only'}>Microphone Only (Self)</option>
                                <option value="speaker_only" ?selected=${this._audioMode === 'speaker_only'}>System Audio Only (Interviewer)</option>
                            </select>
                        </div>

                        <!-- Language -->
                        <div class="form-group">
                            <label class="form-label">Language</label>
                            <select .value=${this.selectedLanguage} @change=${e => this._handleLanguageChange(e.target.value)}>
                                <option value="en-US" ?selected=${this.selectedLanguage === 'en-US'}>English (US)</option>
                                <option value="en-GB" ?selected=${this.selectedLanguage === 'en-GB'}>English (UK)</option>
                                <option value="en-IN" ?selected=${this.selectedLanguage === 'en-IN'}>English (India)</option>
                                <option value="es-ES" ?selected=${this.selectedLanguage === 'es-ES'}>Spanish</option>
                                <option value="fr-FR" ?selected=${this.selectedLanguage === 'fr-FR'}>French</option>
                                <option value="de-DE" ?selected=${this.selectedLanguage === 'de-DE'}>German</option>
                                <option value="zh-CN" ?selected=${this.selectedLanguage === 'zh-CN'}>Chinese</option>
                                <option value="ja-JP" ?selected=${this.selectedLanguage === 'ja-JP'}>Japanese</option>
                            </select>
                        </div>
                    </div>

                    <!-- Engine Details -->
                    <div class="engine-info">
                        <div class="engine-row">
                            <span class="engine-label">Voice Pipeline</span>
                            <span class="engine-value">Deepgram Nova-3 (linear16, 48 kHz)</span>
                        </div>
                        <div class="engine-row">
                            <span class="engine-label">Reasoning LLM</span>
                            <span class="engine-value">Gemini 3.1 Flash Lite</span>
                        </div>
                        <div class="engine-row">
                            <span class="engine-label">Backend Server</span>
                            <span class="engine-value">${this._backendUrl || 'http://13.233.70.37:3000'}</span>
                        </div>
                    </div>
                </div>

                <!-- Start Button -->
                <button
                    class="start-button ${this.isInitializing ? 'disabled' : ''}"
                    ?disabled=${this.isInitializing}
                    @click=${() => this._handleStart()}
                >
                    <canvas class="btn-aurora"></canvas>
                    <canvas class="btn-dither"></canvas>
                    <span class="btn-label">
                        ${this.isInitializing ? 'Connecting to Voice Agent...' : 'Start Session'}
                        <span class="shortcut-hint">${isMac ? cmdIcon : ctrlIcon}${enterIcon}</span>
                    </span>
                </button>
            </div>
        `;
    }
}

customElements.define('main-view', MainView);
