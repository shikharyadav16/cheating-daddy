# Cheating Daddy — Application Features & Architecture

**Cheating Daddy** is a real-time, discreet AI-powered assistant and on-screen teleprompter built with Electron. It captures screen content and dual-channel audio (microphone + system sound) to deliver instant, ready-to-speak responses during technical job interviews, coding rounds, business meetings, presentations, and exams.

---

## 1. Deepgram Voice Agent Pipeline

Cheating Daddy integrates with Deepgram's Voice Agent WebSocket API (`wss://agent.deepgram.com/v1/agent/converse`) to deliver sub-second, conversational AI responses.

- **Listen (Speech-to-Text)**:
  - Powered by Deepgram's conversational Flux STT (`flux-general-en`).
  - Automatic Voice Activity Detection (VAD) and Turn Detection (`UserStartedSpeaking`, `EndOfTurn`, `EagerEndOfTurn`).
  - Continuous streaming of 48 kHz Linear16 PCM audio.
- **Think (LLM Reasoning)**:
  - Powered by Google Gemini (`gemini-3.1-flash-lite`).
  - Dynamically injected system prompts tailored to candidate profile, resume context, and question category.
- **Speak (TTS Discarded on Server)**:
  - Deepgram Flux Kit TTS generates speech, but binary audio frames are discarded on the server side so the application operates silently as a teleprompter without interrupting the user.
- **Real-Time RMS Monitoring**:
  - Live Root Mean Square (RMS) audio energy diagnostics logged in the console to verify non-silent microphone capture in real time.

---

## 2. Structured Response Formatting

AI responses are dynamically categorized and formatted according to strict word count and structural guidelines:

| Category | Target Length | Structure & Style |
| :--- | :--- | :--- |
| **Simple Definition** | **20 – 40 words** | Direct, crisp definition with key technical terms in **bold**. Zero introductory filler. |
| **Technical Explanation** | **50 – 100 words** | Under-the-hood mechanism, why it is used, trade-offs/advantages, and a practical use case. |
| **Project & Experience** | **80 – 150 words** | **STAR** format (Situation, Task, Action, Result). Mentions tech stack, personal contribution, and quantifiable metrics (e.g. latency reduced by 65%). |
| **DSA & Coding Problems** | **Step-by-Step** | **1. Intuition & Approach** (pattern/technique)<br>**2. Step-by-Step Algorithm** (numbered steps)<br>**3. Complexity** (Time & Space $O(N)$)<br>**4. Clean Code Snippet** with comments |

---

## 3. Discreet Floating Teleprompter Window

Designed specifically for live interviews and screen sharing:

- **Frameless Transparent Overlay**:
  - Borderless, semi-transparent window that floats unobtrusively above IDEs, web browsers, and video conferencing software (Zoom, Google Meet, Teams).
- **Click-Through Mode (`Ctrl+M`)**:
  - When enabled, all mouse clicks pass directly through the teleprompter window to the underlying desktop, editor, or browser.
- **Quick Visibility Toggle (`Ctrl+\`)**:
  - Instantly hide or show the teleprompter overlay with a single keystroke.
- **Window Positioning (`Ctrl+Up` / `Down` / `Left` / `Right`)**:
  - Move the teleprompter across the screen in increments without focusing the window.
- **Emergency Erase (`Ctrl+Shift+E`)**:
  - Panic button that instantly wipes all visible responses, transcripts, and session logs in memory.
- **Always on Top**:
  - Ensures teleprompter notes remain visible regardless of which application has focus.

---

## 4. Dual-Stream Audio Capture

Cheating Daddy captures both sides of a conversation simultaneously:

- **Microphone Capture**:
  - Captures the candidate's speech via `navigator.mediaDevices.getUserMedia` with echo cancellation, noise suppression, and auto-gain control.
- **System Audio Capture (Loopback)**:
  - **Windows & Linux**: Captures interviewer audio directly from system output via `navigator.mediaDevices.getDisplayMedia`.
  - **macOS**: Native `SystemAudioDump` helper process captures CoreAudio system loopback output.
- **Unified 48 kHz Web Audio Mixer**:
  - Connects both audio sources to an `AudioContext` and `ScriptProcessorNode`.
  - Routes through a muted `GainNode` to prevent speaker feedback while keeping the Web Audio processing graph active.
  - Automatically handles Chromium autoplay policy (`audioContext.resume()` on window gestures).
- **Audio Modes Supported**:
  - `both` (Microphone + System Audio)
  - `mic_only` (Candidate microphone only)
  - `speaker_only` (Interviewer/system loopback only)

---

## 5. Visual Context & Screen Intelligence

- **Automated Screen Capture**:
  - Takes background screenshots of the selected display/window at user-defined intervals (e.g. every 5 seconds).
  - Supplies the AI model with real-time visual context of the coding question, slides, or documents on screen.
- **Manual Screenshot Trigger**:
  - High-priority trigger for instantly analyzing MCQs, complex coding problems, or system design diagrams.
- **Configurable Quality**:
  - Low, Medium, and High JPEG compression modes to optimize network throughput and response latency.

---

## 6. Profiles & Context Personalization

- **Specialized Profiles**:
  - **Interview** (Default): Optimized for technical, behavioral, and system design interviews.
  - **Sales**: Value-driven talking points, handling objections, and pricing negotiations.
  - **Meeting**: Action items, progress updates, and concise discussion contributions.
  - **Presentation**: Engaging narrative points, slide explanations, and Q&A responses.
  - **Negotiation**: Strategic counter-offers, scope adjustments, and win-win positioning.
  - **Exam**: Fast, direct multiple-choice and problem-solving answers.
- **User-Provided Context Injection**:
  - Enter custom context (resume, past projects, key skills, target job description) in settings.
  - The AI personalizes all answers using first-person perspective based on your experience.

---

## 7. Global Keyboard Shortcuts

| Shortcut | Function | Description |
| :--- | :--- | :--- |
| `Ctrl + \` | **Toggle Visibility** | Show or hide the teleprompter window |
| `Ctrl + M` | **Toggle Click-Through** | Allow mouse clicks to pass through to apps underneath |
| `Ctrl + Space` | **Toggle Voice** | Trigger manual recording / voice turn |
| `Ctrl + Up` | **Move Up** | Nudge the window upward |
| `Ctrl + Down` | **Move Down** | Nudge the window downward |
| `Ctrl + Left` | **Move Left** | Nudge the window left |
| `Ctrl + Right` | **Move Right** | Nudge the window right |
| `Ctrl + [` | **Previous Response** | Navigate to the previous AI response |
| `Ctrl + ]` | **Next Response** | Navigate to the next AI response |
| `Ctrl + Enter` | **Next Step** | Advance response or step |
| `Ctrl + Shift + Up` | **Scroll Up** | Scroll upward through long responses |
| `Ctrl + Shift + Down` | **Scroll Down** | Scroll downward through long responses |
| `Ctrl + Shift + E` | **Emergency Erase** | Instantly wipe all text and conversation turns |

*Note: On macOS, `Cmd` replaces `Ctrl` for standard shortcut bindings.*

---

## 8. Local Express HTTP & WebSocket Server

- **Local Server (`http://localhost:3000`)**:
  - Built-in Express server and WebSocket bridge (`ws://localhost:3000`).
- **Second-Screen Teleprompter**:
  - Open the web interface in `src/utils/public/index.html` from another device (iPad, tablet, smartphone, second monitor) on your local network.
  - View real-time AI transcripts and teleprompter notes on a completely separate device without installing software on it.

---

## 9. Security, Privacy & Storage

- **Local Credential Storage**:
  - API keys and user preferences stored locally in OS user data (`%APPDATA%\cheating-daddy-config` on Windows, `~/Library/Application Support/cheating-daddy-config` on macOS).
  - No third-party analytics or external telemetry.
- **Session History & Transport Logs**:
  - Turn-by-turn conversation logs saved locally per session for post-interview review.
  - Can be exported or deleted at any time.
