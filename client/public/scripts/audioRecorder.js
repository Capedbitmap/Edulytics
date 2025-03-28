// client/public/scripts/audioRecorder.js

/**
 * WebSocket-based Audio Recorder for OpenAI Realtime Transcription API
 * With fallback to standard transcription API when realtime API fails
 */
class WebSocketAudioRecorder {
    /**
     * Create a new WebSocketAudioRecorder
     * @param {string} lectureCode - The lecture code to associate with this recording
     * @param {Object} options - Configuration options
     */
    constructor(lectureCode, options = {}) {
        if (!lectureCode) {
            throw new Error("Lecture code is required for WebSocketAudioRecorder");
        }
        this.lectureCode = lectureCode;
        this.options = {
            serverUrl: window.location.origin.replace(/^http/, 'ws'), // Derive WebSocket URL from HTTP origin
            sampleRate: 16000,   // OpenAI preferred sample rate
            numChannels: 1,      // Mono audio
            bitsPerSample: 16,   // 16-bit PCM is standard
            bufferSize: 4096,    // Size of audio chunks processed by ScriptProcessor
            ...options
        };

        // Core State variables
        this.ws = null;                // WebSocket connection instance
        this.mediaStream = null;       // MediaStream from microphone
        this.audioContext = null;      // Web Audio API context
        this.processor = null;         // ScriptProcessorNode for audio processing
        this.sourceNode = null;        // MediaStreamAudioSourceNode
        this.isRecording = false;      // User's intention to record
        this.isCapturing = false;      // Flag indicating if audio is actively being captured/processed
        this.isServerReady = false;    // Flag indicating if the backend WS confirmed readiness for OpenAI stream
        this.sessionId = null;         // Session ID provided by the backend
        this.startTime = null;         // Timestamp when recording/capture started
        this.reconnectAttempts = 0;    // Counter for WebSocket reconnect attempts
        this.maxReconnectAttempts = 5; // Maximum reconnect attempts before giving up/falling back
        this.reconnectDelay = 2000;    // Initial delay before first reconnect attempt (ms)
        this.lastError = null;         // Store last significant error message

        // Callback handlers (to be set by the consuming script, e.g., instructor.js)
        this.onTranscription = null;   // (data: {type, text, timestamp, ...}) => void
        this.onStatusChange = null;    // (status: {connected, recording, status, error?, message?, ...}) => void
        this.onTimerUpdate = null;     // (elapsedMilliseconds: number) => void
        this.timerInterval = null;     // Interval ID for the recording timer

        // Fallback Mode State variables
        this.useFallbackMode = false;              // Flag indicating if using HTTP fallback
        this.audioBuffer = [];                     // Stores recent audio chunks for padding before speech starts
        this.speechBuffer = [];                    // Stores audio chunks belonging to the current detected speech segment
        this.isSpeechActive = false;               // Voice Activity Detection (VAD) state
        this.speechStartTime = null;               // Timestamp when the current speech segment started
        this.lastSpeechTime = null;                // Timestamp when audio energy last exceeded the threshold
        this.fallbackProcessingInterval = null;    // Interval ID for checking end-of-speech in fallback mode

        // Speech Detection Parameters for Fallback Mode
        this.speechParams = {
            energyThreshold: 0.01,        // RMS energy level to consider as speech (adjust based on mic sensitivity)
            speechPaddingMs: 300,         // Milliseconds of audio to keep before speech starts
            minSpeechDurationMs: 300,     // Minimum duration (ms) for a segment to be considered valid speech
            silenceDurationToEndMs: 1500, // Duration of silence (ms) needed to end a speech segment
            chunkDuration: 10,            // Maximum duration (seconds) for a single fallback audio chunk sent via HTTP
            processingIntervalMs: 150     // How often (ms) to check for silence to end a segment in fallback mode
        };

        console.log(`WebSocketAudioRecorder created for lecture: ${this.lectureCode}`);
    }

    /** Initialize microphone access */
    async init() {
        console.log("Initializing microphone access...");
        this.lastError = null; // Clear previous error
        if (this.mediaStream) {
            console.log("Microphone access already granted.");
            return true; // Already initialized
        }
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: this.options.numChannels,
                    sampleRate: this.options.sampleRate,
                    // Optional constraints (might improve quality or compatibility)
                    // noiseSuppression: true,
                    // echoCancellation: true
                }
            });
            console.log("Microphone access granted.");
            return true;
        } catch (error) {
            console.error('Error initializing recorder (getUserMedia):', error);
            this.lastError = `Microphone access error: ${error.name} - ${error.message}`;
            if (this.onStatusChange) {
                this.onStatusChange({ connected: false, recording: false, error: this.lastError });
            }
            this._stopMediaStreamTracks(); // Clean up partially obtained stream if any
            return false;
        }
    }

    /** Connect to WebSocket server (unless in fallback mode) */
    connect() {
        if (this.useFallbackMode) {
            console.log("In fallback mode, skipping WebSocket connection attempt.");
            return Promise.resolve(); // Successfully "connected" in the sense that fallback is active
        }
        // If already connected or connecting, do nothing further
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.log(`WebSocket already ${this.ws.readyState === WebSocket.OPEN ? 'open' : 'connecting'}.`);
            return Promise.resolve();
        }

        console.log("Attempting to connect to WebSocket server...");
        this.isServerReady = false; // Reset server readiness state

        return new Promise((resolve, reject) => {
            const wsUrl = `${this.options.serverUrl}?lecture_code=${this.lectureCode}`;
            console.log(`Connecting to: ${wsUrl}`);
            try {
                this.ws = new WebSocket(wsUrl);
            } catch (error) {
                console.error("WebSocket constructor failed:", error);
                // Immediately switch to fallback if the constructor itself fails
                this._switchToFallbackMode('WebSocket constructor failed');
                resolve(); // Resolve because fallback is now the active state
                return;
            }

            // WebSocket Event Handlers
            this.ws.onopen = () => {
                console.log('WebSocket connection established with backend.');
                this.reconnectAttempts = 0; // Reset reconnect counter on success
                if (this.onStatusChange) {
                    // Notify that connection to *backend* is open, but not necessarily ready for OpenAI stream yet
                    this.onStatusChange({ connected: true, recording: this.isRecording, status: 'backend_connected' });
                }
                resolve(); // Resolve the promise indicating successful WS connection to backend
            };

            this.ws.onerror = (event) => { // Changed 'error' param to 'event' for consistency
                console.error('WebSocket connection error:', event); // Log the error event object
                this.isServerReady = false;
                this._stopAudioCaptureAndProcessing(); // Stop capture if it was running
                if (this.onStatusChange) {
                    this.onStatusChange({ connected: false, recording: false, error: 'WebSocket connection error' });
                }
                // Attempt to reconnect or switch to fallback mode
                if (!this._handleReconnect(reject, 'WebSocket error')) {
                    // If reconnect attempts exhausted or not applicable, switch to fallback
                    this._switchToFallbackMode('WebSocket connection error');
                    resolve(); // Resolve as fallback is now the intended state
                }
                // Note: If _handleReconnect schedules a retry, reject() won't be called here yet.
            };

            this.ws.onclose = (event) => {
                const reasonText = event.reason ? event.reason.toString() : 'No reason provided';
                console.log(`WebSocket connection closed: ${event.code} - ${reasonText}`);
                this.isServerReady = false;
                this._stopAudioCaptureAndProcessing(); // Ensure capture stops on close

                // Check if the server explicitly requested fallback mode
                if (event.code === 4001 || reasonText.includes('FALLBACK_REQUIRED')) {
                    console.log("Server requested fallback mode.");
                    this._switchToFallbackMode(`Server initiated (${reasonText})`);
                } else if (this.isRecording && !this.useFallbackMode && event.code !== 1000) { // If recording intended, not in fallback, and not a clean close (1000)
                    // Attempt to reconnect or switch to fallback if closed unexpectedly
                    if (!this._handleReconnect(() => {}, 'WebSocket closed')) {
                        // If reconnects fail or aren't attempted, switch to fallback
                        this._switchToFallbackMode('WebSocket closed unexpectedly');
                    }
                } else if (!this.useFallbackMode && this.onStatusChange) {
                    // If not switching to fallback, notify UI about the disconnection
                    this.onStatusChange({ connected: false, recording: false, status: 'disconnected', code: event.code, reason: reasonText });
                }
                // If already in fallback mode, this close event is expected after switching, do nothing extra.
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    // console.debug("Received message from backend:", message); // Use debug for less noise

                    // Check for specific error messages from backend indicating upstream problems
                    if (message.type === 'error' && message.message?.includes('Transcription service')) {
                        console.error("Backend reported transcription service error:", message.message);
                        this._switchToFallbackMode('Backend reported service error');
                        return; // Stop processing this message
                    }
                    // Check for status message indicating upstream disconnection
                    if (message.type === 'status' && message.status === 'server_disconnected_openai') {
                         console.warn("Backend reported disconnection from OpenAI:", message.reason);
                         this._switchToFallbackMode('Backend disconnected from OpenAI');
                         return;
                     }

                    // Handle normal status and transcription messages
                    if (message.type === 'status' && message.status === 'connected') {
                        console.log("Received 'connected' status from backend. Server ready for OpenAI stream.");
                        this.isServerReady = true;
                        this.sessionId = message.session_id; // Store session ID if needed
                        // If recording was intended, start audio capture now
                        if (this.isRecording && !this.isCapturing) {
                            console.log("Recording intention was set, starting WebSocket audio capture.");
                            this._startAudioCaptureAndProcessing();
                        }
                        if (this.onStatusChange) {
                            this.onStatusChange({ connected: true, recording: this.isRecording, status: 'server_ready' });
                        }
                    } else if (message.type === 'transcription') {
                        // Forward transcription data to the handler
                        if (this.onTranscription) {
                            this.onTranscription(message);
                        }
                    } else if (message.type === 'pong') {
                        console.debug('Received pong from server.'); // Keepalive response
                    }
                    // Handle other potential message types from backend if necessary
                } catch (error) {
                    console.error('Error parsing message from backend:', error, event.data);
                    // Consider if message parsing errors should trigger fallback
                }
            };
        });
    }

    /**
     * Switch to fallback mode (HTTP POST for transcription).
     * @param {string} reason - The reason for switching to fallback.
     * @private
     */
    _switchToFallbackMode(reason = 'Unknown reason') {
        if (this.useFallbackMode) return; // Already in fallback mode

        console.warn(`Switching to fallback mode. Reason: ${reason}`);
        this.useFallbackMode = true;
        this.lastError = `Switched to fallback: ${reason}`; // Store reason

        // Clean up WebSocket resources and state
        if (this.ws) {
            // Remove listeners to prevent further actions on the old socket
            this.ws.onopen = null; this.ws.onerror = null; this.ws.onclose = null; this.ws.onmessage = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, "Client switching to fallback mode"); // Clean close if possible
            }
            this.ws = null; // Clear the reference
        }
        this.isServerReady = false;
        // Prevent further WebSocket reconnection attempts for this recording session
        this.reconnectAttempts = this.maxReconnectAttempts;

        // Reset Voice Activity Detection (VAD) state for fallback mode
        this.audioBuffer = [];
        this.speechBuffer = [];
        this.isSpeechActive = false;
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.stopFallbackProcessingInterval(); // Ensure VAD interval is stopped

        // Notify the UI about the switch to fallback mode
        if (this.onStatusChange) {
            this.onStatusChange({
                connected: false, // WebSocket is disconnected
                recording: this.isRecording, // Reflect current recording intention
                status: 'fallback_mode',
                message: 'Using standard transcription API.'
            });
        }

        // If recording is intended, restart audio capture in fallback mode
        if (this.isRecording) {
            // Ensure any previous capture process is fully stopped first
            this._stopAudioCaptureAndProcessing();
            console.log("Restarting audio capture for fallback mode.");
            this._startAudioCaptureAndProcessing(); // Start capture with fallback logic
        }
    }

    /**
     * Handle WebSocket reconnection logic.
     * @param {Function} reject - The reject function of the wrapping Promise (from connect).
     * @param {string} reason - Context for logging.
     * @returns {boolean} - True if a reconnect attempt is scheduled, false otherwise.
     * @private
     */
    _handleReconnect(reject, reason) {
        // Don't attempt reconnect if already switched to fallback mode
        if (this.useFallbackMode) {
             console.log("In fallback mode, skipping WebSocket reconnect attempt.");
             return false;
        }

        // Only reconnect if recording is intended and attempts remain
        if (this.isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Exponential backoff for delay
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Attempting WS reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms due to: ${reason}`);

            setTimeout(() => {
                // Double-check state before attempting reconnect
                if (this.isRecording && !this.useFallbackMode) {
                    console.log("Executing WS reconnect attempt...");
                    this.connect().catch((err) => { // Attempt to connect again
                        console.error(`WS Reconnect attempt ${this.reconnectAttempts} failed:`, err);
                        // If this was the last attempt, switch to fallback
                        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                            console.error("Max WS reconnection attempts reached. Switching to fallback.");
                            this._switchToFallbackMode('Max WS reconnections failed');
                            // Don't reject the original promise, resolve because fallback is active
                        }
                    });
                } else {
                     console.log("WS Reconnect cancelled (recording stopped or fallback active).");
                }
            }, delay);
            return true; // Indicate that a reconnect attempt has been scheduled
        } else {
            // Conditions for not attempting reconnect
            if (this.isRecording && !this.useFallbackMode) {
                 console.error(`Max WS reconnection attempts reached (${this.maxReconnectAttempts}) or not recording. Will switch to fallback if recording.`);
            }
            return false; // No reconnect attempt scheduled
        }
    }

    /**
     * Set the intention to start recording and initiate the process.
     * @returns {Promise<void>} Resolves when the start process is initiated, rejects on immediate failure (e.g., mic).
     */
    async start() {
        console.log("start() called.");
        if (this.isRecording) {
            console.warn('Recording is already active or start() called multiple times.');
            return Promise.resolve(); // Indicate already started or starting
        }

        // 1. Ensure microphone access
        const micReady = await this.init();
        if (!micReady) {
            // Error already logged and potentially status updated by init()
            return Promise.reject(new Error(this.lastError || "Microphone initialization failed"));
        }

        // 2. Set recording intention flag
        console.log("Setting recording intention: true.");
        this.isRecording = true;

        // 3. Handle based on current mode (fallback or normal)
        if (this.useFallbackMode) {
            console.log("Already in fallback mode, ensuring audio capture is running.");
            if (!this.isCapturing) {
                this._startAudioCaptureAndProcessing(); // Start capture if not already running
            }
            // Update status explicitly for fallback start
            if (this.onStatusChange) {
                this.onStatusChange({ connected: false, recording: true, status: 'fallback_mode' });
            }
            return Promise.resolve(); // Start initiated in fallback mode
        } else {
            // 4. Normal Mode: Initiate WebSocket connection (or verify existing)
            try {
                await this.connect(); // Establishes or verifies WS connection
                // Check if connect() switched to fallback during the process
                if (!this.useFallbackMode && this.onStatusChange) {
                    // Update status based on current WS state after connect attempt
                    this.onStatusChange({ connected: this.ws?.readyState === WebSocket.OPEN, recording: true, status: this.isServerReady ? 'server_ready' : 'connecting' });
                }
                console.log("start() completed connection initiation/verification.");
                return Promise.resolve(); // WS connection process initiated
            } catch (error) {
                console.error("Error during start() connection phase:", error);
                // If connect() failed AND switched to fallback, start fallback capture
                if (this.useFallbackMode) {
                     console.log("WS connect failed, automatically starting capture in fallback mode.");
                     if (!this.isCapturing) {
                         this._startAudioCaptureAndProcessing();
                     }
                      if (this.onStatusChange) {
                          this.onStatusChange({ connected: false, recording: true, status: 'fallback_mode' });
                      }
                     return Promise.resolve(); // Fallback started successfully
                } else {
                     // If connect failed without switching (unlikely with current logic but possible)
                     this.isRecording = false; // Reset intention
                     if (this.onStatusChange) {
                         this.onStatusChange({ connected: false, recording: false, error: `Failed to start: ${error.message}` });
                     }
                     return Promise.reject(error); // Propagate the error
                }
            }
        }
    }

    /**
     * Sets up AudioContext and ScriptProcessorNode to capture and process audio.
     * Routes audio data to WebSocket or local VAD based on `useFallbackMode`.
     * @private
     */
    _startAudioCaptureAndProcessing() {
        if (this.isCapturing) { console.log("Audio capture already active."); return; }
        if (!this.isRecording) { console.log("Not starting capture: recording intention is false."); return; }
        if (!this.mediaStream) { console.error("Cannot start capture: MediaStream unavailable."); return; }

        // In normal mode, require server readiness and open WebSocket
        if (!this.useFallbackMode && (!this.isServerReady || !this.ws || this.ws.readyState !== WebSocket.OPEN)) {
            console.log(`WS Mode: Postponing capture start - ServerReady=${this.isServerReady}, WSState=${this.ws?.readyState}. Awaiting 'connected' message.`);
            // Capture will begin when the 'connected' status message is received from the backend.
            return;
        }

        console.log(`Starting Audio Capture (${this.useFallbackMode ? 'Fallback' : 'WebSocket'} mode)...`);
        try {
            // Create AudioContext
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.options.sampleRate
            });
            // Resume context if it starts suspended (common in some browsers)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(err => console.error("AudioContext resume failed:", err));
            }

            // Create source node from microphone stream
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create ScriptProcessorNode for raw audio data access
            // Note: createScriptProcessor is deprecated, AudioWorklet is preferred for future development
            this.processor = this.audioContext.createScriptProcessor(
                this.options.bufferSize,
                this.options.numChannels,
                this.options.numChannels
            );

            // --- Audio Processing Callback ---
            this.processor.onaudioprocess = (event) => {
                // Double-check flags on each process tick
                if (!this.isRecording || !this.isCapturing) return;

                // Get raw audio data (Float32Array)
                const inputData = event.inputBuffer.getChannelData(0);

                if (this.useFallbackMode) {
                    // === Fallback Mode: Perform local VAD ===
                    this._processSpeechDetection(new Float32Array(inputData)); // Process a copy
                } else if (this.isServerReady && this.ws?.readyState === WebSocket.OPEN) {
                    // === WebSocket Mode: Convert and send binary data ===
                    try {
                        // Convert Float32 to 16-bit PCM ArrayBuffer
                        const pcmBuffer = this._floatTo16BitPCM(inputData);
                        // Send directly over WebSocket
                        this.ws.send(pcmBuffer);
                    } catch (sendError) {
                        console.error("WebSocket send error:", sendError);
                        // Switch to fallback mode if sending fails
                        this._switchToFallbackMode('Error sending WebSocket audio data');
                    }
                }
                // If in WS mode but server isn't ready or WS closed unexpectedly, data is dropped here.
                // The onclose/onerror handlers should trigger fallback if this state persists.
            };

            // Connect the audio graph: MicSource -> Processor -> Destination (speakers/default output)
            this.sourceNode.connect(this.processor);
            this.processor.connect(this.audioContext.destination); // Connect to output to keep graph running

            this.isCapturing = true; // Mark as actively capturing
            this.startTime = Date.now(); // Record start time for timer
            this.startTimer(); // Start UI timer updates

            // Start VAD silence check interval only when in fallback mode
            if (this.useFallbackMode) {
                this.startFallbackProcessingInterval();
            }

            console.log("Audio capture and processing started successfully.");
            // Update overall status
            if (this.onStatusChange) {
                 this.onStatusChange({
                     connected: !this.useFallbackMode, // WS connected only in normal mode
                     recording: true,
                     status: this.useFallbackMode ? 'fallback_mode' : 'capturing'
                 });
            }

        } catch (error) {
            console.error('Error starting audio capture/processing:', error);
            this._stopAudioCaptureAndProcessing(); // Attempt cleanup on error
            this.lastError = `Audio capture error: ${error.message}`;
            if (this.onStatusChange) {
                 this.onStatusChange({ connected: false, recording: false, error: this.lastError });
            }
             // If fallback capture fails, stop the recording intention
             if (this.useFallbackMode) {
                  this.isRecording = false;
             }
        }
    }

    /** Start interval timer for checking end-of-speech in fallback mode */
    startFallbackProcessingInterval() {
        this.stopFallbackProcessingInterval(); // Clear any existing interval
        console.log("Started fallback processing interval.");
        this.fallbackProcessingInterval = setInterval(() => {
            this._checkSpeechEnd();
        }, this.speechParams.processingIntervalMs);
    }

    /** Stop interval timer for fallback processing */
    stopFallbackProcessingInterval() {
        if (this.fallbackProcessingInterval) {
            clearInterval(this.fallbackProcessingInterval);
            this.fallbackProcessingInterval = null;
            console.log("Stopped fallback processing interval.");
        }
    }

    /**
     * Checks if the current speech segment should end based on silence duration.
     * Called periodically by an interval timer ONLY in fallback mode.
     * @private
     */
    _checkSpeechEnd() {
        // Only run if in fallback mode, actively detecting speech, and have a last speech time
        if (!this.useFallbackMode || !this.isSpeechActive || !this.lastSpeechTime) return;

        const currentTime = Date.now();
        const silenceDuration = currentTime - this.lastSpeechTime;

        // Check if silence duration exceeds the threshold
        if (silenceDuration > this.speechParams.silenceDurationToEndMs) {
            const segmentDuration = this.lastSpeechTime - this.speechStartTime; // Duration of actual speech + pauses

            if (segmentDuration >= this.speechParams.minSpeechDurationMs) {
                console.log(`Fallback VAD: Speech ended due to silence (${silenceDuration}ms). Processing ${segmentDuration}ms segment.`);
                if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Silence end (${silenceDuration}ms)`);
                this._processSpeechSegment(); // Process the buffered speech
            } else {
                // Segment was too short (likely noise), discard it
                console.log(`Fallback VAD: Segment too short (${segmentDuration}ms) on silence end. Discarding.`);
                if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Segment too short on silence end`);
            }

            // Reset VAD state after processing or discarding
            this.isSpeechActive = false;
            this.speechBuffer = []; // Clear buffer
            this.speechStartTime = null;
            // Keep this.lastSpeechTime as is (it reflects the last *actual* speech energy)
        }
    }

    /**
     * Processes a chunk of audio data for Voice Activity Detection (VAD) in fallback mode.
     * Updates VAD state (isSpeechActive, speechStartTime, lastSpeechTime) and buffers audio.
     * @param {Float32Array} audioData - Raw audio data from ScriptProcessor.
     * @private
     */
    _processSpeechDetection(audioData) {
        if (!this.useFallbackMode) return; // Should not be called in WS mode

        // --- 1. Calculate Audio Energy (Root Mean Square - RMS) ---
        let sumSquares = 0.0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const energy = Math.sqrt(sumSquares / audioData.length);

        // --- 2. Determine if Speech is Present ---
        const currentTime = Date.now();
        const isSpeech = energy >= this.speechParams.energyThreshold; // Use >= for threshold inclusion

        // --- 3. Update Debug UI (if available) ---
        if (window.updateSpeechDebugEnergyLevel) {
            window.updateSpeechDebugEnergyLevel(energy, isSpeech);
        }

        // --- 4. Manage VAD State and Buffers ---
        if (isSpeech) {
            // --- Speech Detected ---
            this.lastSpeechTime = currentTime; // Update timestamp of last speech activity

            if (!this.isSpeechActive) {
                // --- Transition from Silence to Speech ---
                this.isSpeechActive = true;
                this.speechStartTime = currentTime; // Record segment start time
                console.log(`Fallback VAD: Speech detected at ${new Date(currentTime).toLocaleTimeString()}.`);
                if (window.addSpeechDebugLog) window.addSpeechDebugLog("Speech detected");

                // Prepend the padding buffer (audio recorded just before speech started)
                this.speechBuffer = [...this.audioBuffer];
                this.audioBuffer = []; // Clear the padding buffer
            }
            // Add the current audio data chunk to the active speech buffer
            this.speechBuffer.push(audioData); // Store the Float32Array directly

        } else {
            // --- Silence Detected ---
            if (this.isSpeechActive) {
                // --- Still considered in speech segment (during a pause) ---
                // Add the silence chunk to the buffer as well
                this.speechBuffer.push(audioData);

                // Note: The actual end-of-speech determination due to prolonged silence
                // is now handled by the `_checkSpeechEnd` method called by the interval timer.
            } else {
                // --- In Silence, Not currently in speech segment ---
                // Keep a rolling buffer of recent audio for padding
                this.audioBuffer.push(audioData);

                // Limit the size of the padding buffer based on time duration
                const bufferItemDurationMs = (this.options.bufferSize / this.options.sampleRate) * 1000;
                const maxBufferItems = Math.ceil(this.speechParams.speechPaddingMs / bufferItemDurationMs);
                while (this.audioBuffer.length > maxBufferItems) {
                    this.audioBuffer.shift(); // Remove oldest chunk if buffer is too large
                }
            }
        }

        // --- 5. Immediate Check for Maximum Segment Duration ---
        // This acts as a safeguard against extremely long segments if silence detection fails.
        if (this.isSpeechActive && this.speechStartTime) {
            const speechDuration = currentTime - this.speechStartTime;
            const maxDurationMs = this.speechParams.chunkDuration * 1000;
            if (speechDuration > maxDurationMs) {
                console.log(`Fallback VAD: Max duration (${this.speechParams.chunkDuration}s) reached. Processing current segment.`);
                 if (window.addSpeechDebugLog) window.addSpeechDebugLog("Max duration reached");
                this._processSpeechSegment(); // Process the segment collected so far

                // Reset state to start collecting the *next* segment immediately
                this.isSpeechActive = true; // Assume speech continues right after
                this.speechStartTime = currentTime; // Start time for the new segment
                this.speechBuffer = []; // Clear buffer for the new segment
                this.lastSpeechTime = currentTime; // Update last speech time for the new segment
            }
        }
    }

    /**
     * Processes a completed speech segment: combines audio chunks, creates WAV, sends for transcription.
     * Called by `_checkSpeechEnd` (on silence) or `_processSpeechDetection` (on max duration).
     * ONLY runs in fallback mode.
     * @private
     */
    _processSpeechSegment() {
        // Ensure we are in fallback mode and have data to process
        if (!this.useFallbackMode || !this.speechBuffer || this.speechBuffer.length === 0) return;

        // Create a snapshot of the buffer data to process, then clear the instance buffer immediately
        // This prevents race conditions if new audio arrives while this async operation is running.
        const segmentData = [...this.speechBuffer];
        this.speechBuffer = []; // Clear instance buffer for the next segment

        // Calculate total length and duration
        const totalLength = segmentData.reduce((sum, buf) => sum + buf.length, 0);
        const durationMs = (totalLength / this.options.sampleRate) * 1000;

        console.log(`Fallback: Processing segment - Duration: ${durationMs.toFixed(0)}ms, Chunks: ${segmentData.length}`);
        if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Processing ${durationMs.toFixed(0)}ms segment`);

        // Check against minimum speech duration threshold
        if (durationMs < this.speechParams.minSpeechDurationMs) {
            console.log(`Fallback: Segment too short (${durationMs.toFixed(0)}ms vs min ${this.speechParams.minSpeechDurationMs}ms). Discarding.`);
            if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Segment too short, discarding`);
            // Do not reset VAD state here, let the natural silence detection handle it
            return; // Stop processing this segment
        }

        try {
            // 1. Combine Float32Array chunks into a single Float32Array
            const combinedFloat32 = new Float32Array(totalLength);
            let offset = 0;
            segmentData.forEach(buf => {
                combinedFloat32.set(buf, offset);
                offset += buf.length;
            });

            // 2. Convert combined Float32Array to 16-bit PCM ArrayBuffer
            const pcmBuffer = this._floatTo16BitPCM(combinedFloat32);

            // 3. Create a WAV Blob from the PCM data
            const wavBlob = this._createWavBlob(pcmBuffer);

            // 4. Send the Blob to the backend fallback endpoint
            this._sendAudioForTranscription(wavBlob);

        } catch (error) {
             console.error("Error during fallback segment processing:", error);
             // Log error but don't necessarily stop recording unless it's critical
             if (this.onStatusChange) {
                 this.onStatusChange({ connected: false, recording: this.isRecording, error: `Fallback processing error: ${error.message}` });
             }
        }

        // Note: VAD state (isSpeechActive, speechStartTime) reset is handled by the calling context
        // (_checkSpeechEnd on silence, or _processSpeechDetection on max duration reset)
    }

    /**
     * Sends the prepared audio Blob to the backend's fallback transcription endpoint via HTTP POST.
     * @param {Blob} audioBlob - The WAV audio data as a Blob.
     * @private
     */
    _sendAudioForTranscription(audioBlob) {
        if (!this.useFallbackMode) return; // Should only be called in fallback

        console.log(`Fallback: Sending audio blob (${audioBlob.size} bytes) to /fallback_transcription...`);
        if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Sending ${Math.round(audioBlob.size / 1024)}KB audio`);

        // --- TEMPORARY DEBUGGING: SAVE BLOB ---
        // Uncomment these lines to get a download link for the generated WAV file
        
        try {
            const blobUrl = URL.createObjectURL(audioBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            const filename = `debug_fallback_${Date.now()}.wav`;
            link.download = filename;
            console.warn(`DEBUG: WAV blob created. Download link generated below (or uncomment link.click()). Filename: ${filename}`);
            // link.click(); // Uncomment to auto-download
            link.textContent = `Download ${filename} (DEBUG)`;
            link.style.cssText = "display:block; margin: 5px; padding: 5px; background: #ffc107; color: black; text-decoration: none; border-radius: 3px;";
            const previewEl = document.getElementById('transcription-preview'); // Or another suitable element
            if (previewEl) previewEl.appendChild(link);
            // Consider revoking URL later: setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch(e) {
            console.error("DEBUG: Error creating download link for blob:", e);
        }
        
        // --- END TEMPORARY DEBUGGING ---


        // Create FormData to send the Blob and lecture code
        const formData = new FormData();
        formData.append('audio', audioBlob, `speech_${Date.now()}.wav`); // Append Blob with a filename
        formData.append('lecture_code', this.lectureCode);

        // Update UI to indicate processing state
        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, recording: true, status: 'processing_fallback', message: "Processing audio..." });
        }

        // Use fetch API to send the POST request
        fetch('/fallback_transcription', { method: 'POST', body: formData })
        .then(response => {
            // Check if the request was successful (status code 2xx)
            if (!response.ok) {
                 // Try to parse error JSON from response, otherwise use status text
                 return response.json().catch(() => ({ error: `Server error ${response.status}: ${response.statusText}` }))
                    .then(errorData => { throw new Error(errorData.error || `HTTP error ${response.status}`); });
            }
            // Parse successful JSON response
            return response.json();
        })
        .then(data => {
            console.log("Fallback: Received transcription response:", data);
            // Check if the backend operation was successful and text exists
            if (data.success && data.text) {
                 // Trigger the transcription callback for the UI
                 if (this.onTranscription) {
                     this.onTranscription({
                         type: 'transcription',
                         event_type: 'fallback_transcription.completed', // Indicate source
                         text: data.text,
                         timestamp: data.timestamp || Date.now(), // Use server timestamp if available
                         source: 'fallback_api'
                     });
                 }
            } else if (data.success && !data.text) {
                 // Handle case where transcription was successful but yielded no text
                 console.log("Fallback: Empty transcription received.");
            } else {
                 // Handle cases where data.success might be false or structure is unexpected
                 throw new Error(data.error || 'Received unexpected response from fallback API');
            }
            // Update status back to 'fallback_mode' recording after processing is done (if still recording)
             if (this.onStatusChange && this.isRecording) {
                 this.onStatusChange({ connected: false, recording: true, status: 'fallback_mode' });
             }
        })
        .catch(error => {
            // Handle network errors or errors thrown from response checking
            console.error("Fallback: Error sending/receiving transcription:", error);
            if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Fallback Error: ${error.message}`);
            if (this.onStatusChange) {
                const errorMessage = `Fallback error: ${error.message}`;
                 this.onStatusChange({ connected: false, recording: this.isRecording, error: errorMessage });
                 // Optionally revert status back to 'fallback_mode' after showing error briefly
                 setTimeout(() => {
                     if (this.isRecording && this.useFallbackMode && this.onStatusChange) {
                         this.onStatusChange({ connected: false, recording: true, status: 'fallback_mode' });
                     }
                 }, 3000); // Show error for 3 seconds
            }
        });
    }

    /**
     * Creates a WAV file Blob from a 16-bit PCM ArrayBuffer.
     * @param {ArrayBuffer} pcmBuffer - The raw 16-bit PCM audio data.
     * @returns {Blob} A Blob object representing the WAV file.
     * @private
     */
    _createWavBlob(pcmBuffer) {
        // Create the WAV header + data ArrayBuffer using the existing helper
        const wavBuffer = this._createWavFile(pcmBuffer);
        if (!wavBuffer) {
             console.error("Failed to create WAV file buffer.");
             return null; // Return null if header creation failed
        }
        // Create and return a Blob from the ArrayBuffer
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    /**
     * Creates a complete WAV file structure (header + PCM data) in an ArrayBuffer.
     * Corrected version.
     * @param {ArrayBuffer} pcmBuffer - Raw 16-bit PCM audio data (must be ArrayBuffer).
     * @returns {ArrayBuffer | null} ArrayBuffer containing the full WAV file, or null on error.
     * @private
     */
    _createWavFile(pcmBuffer) {
        if (!(pcmBuffer instanceof ArrayBuffer)) {
            console.error("Cannot create WAV: Input pcmBuffer is not an ArrayBuffer.");
            // If it's a TypedArray, try getting its underlying buffer
            if (pcmBuffer.buffer instanceof ArrayBuffer) {
                pcmBuffer = pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + pcmBuffer.byteLength);
            } else {
                return null; // Indicate failure
            }
        }

        const numChannels = this.options.numChannels;       // e.g., 1
        const sampleRate = this.options.sampleRate;         // e.g., 16000
        const bitsPerSample = this.options.bitsPerSample;   // e.g., 16
        const bytesPerSample = bitsPerSample / 8;         // e.g., 2
        const blockAlign = numChannels * bytesPerSample;    // e.g., 2
        const byteRate = sampleRate * blockAlign;         // e.g., 32000
        const dataSize = pcmBuffer.byteLength;            // Size of the raw PCM data
        const headerSize = 44;                             // Standard WAV header size
        const fileSize = headerSize + dataSize;            // Total file size

        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // RIFF chunk descriptor (offset 0, size 12)
        this._writeString(view, 0, 'RIFF');           // ChunkID (4 bytes)
        view.setUint32(4, fileSize - 8, true);        // ChunkSize (4 bytes) - File size minus RIFF ID & ChunkSize field
        this._writeString(view, 8, 'WAVE');           // Format (4 bytes)

        // fmt sub-chunk (offset 12, size 24)
        this._writeString(view, 12, 'fmt ');          // Subchunk1ID (4 bytes)
        view.setUint32(16, 16, true);                 // Subchunk1Size (4 bytes) - 16 for standard PCM
        view.setUint16(20, 1, true);                  // AudioFormat (2 bytes) - 1 for PCM
        view.setUint16(22, numChannels, true);        // NumChannels (2 bytes)
        view.setUint32(24, sampleRate, true);         // SampleRate (4 bytes)
        view.setUint32(28, byteRate, true);           // ByteRate (4 bytes)
        view.setUint16(32, blockAlign, true);         // BlockAlign (2 bytes)
        view.setUint16(34, bitsPerSample, true);      // BitsPerSample (2 bytes)

        // data sub-chunk (offset 36, size 8 + dataSize)
        this._writeString(view, 36, 'data');          // Subchunk2ID (4 bytes)
        view.setUint32(40, dataSize, true);           // Subchunk2Size (4 bytes) - Size of the audio data

        // Write the actual PCM audio data (offset 44)
        new Uint8Array(buffer, headerSize).set(new Uint8Array(pcmBuffer));

        return buffer;
    }


    /**
     * Helper function to write a string into a DataView at a specific offset.
     * @param {DataView} view - The DataView target.
     * @param {number} offset - The byte offset to start writing.
     * @param {string} string - The string to write.
     * @private
     */
    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Converts a Float32Array audio buffer to a 16-bit PCM ArrayBuffer (Little-Endian).
     * @param {Float32Array} input - The input audio data ranging from -1.0 to 1.0.
     * @returns {ArrayBuffer} The audio data as 16-bit PCM.
     * @private
     */
    _floatTo16BitPCM(input) {
        const buffer = new ArrayBuffer(input.length * 2); // 2 bytes per sample (Int16)
        const view = new DataView(buffer);
        for (let i = 0; i < input.length; i++) {
            // Clamp the value between -1 and 1
            const s = Math.max(-1, Math.min(1, input[i]));
            // Convert to 16-bit integer range (-32768 to 32767)
            const intValue = s < 0 ? s * 0x8000 : s * 0x7FFF;
            // Write as Int16, little-endian format
            view.setInt16(i * 2, intValue, true);
        }
        return buffer;
    }

    /**
     * Stops audio capture, processing, and associated timers/intervals. Cleans up AudioContext.
     * @private
     */
    _stopAudioCaptureAndProcessing() {
        // Check if there's anything to stop
        if (!this.isCapturing && !this.audioContext && !this.fallbackProcessingInterval) {
             // console.log("Audio capture not active or already stopped.");
             return;
        }
        console.log("Stopping audio capture and processing...");
        this.isCapturing = false; // Mark as no longer capturing

        // Stop the fallback VAD interval timer if it's running
        this.stopFallbackProcessingInterval();

        try {
            // Disconnect and nullify ScriptProcessorNode
            if (this.processor) {
                this.processor.disconnect(); // Disconnect from source and destination
                this.processor.onaudioprocess = null; // Remove the processing callback
                this.processor = null;
                console.log("ScriptProcessor disconnected.");
            }
            // Disconnect and nullify MediaStreamAudioSourceNode
            if (this.sourceNode) {
                this.sourceNode.disconnect(); // Disconnect from processor
                this.sourceNode = null;
                console.log("SourceNode disconnected.");
            }
            // Close the AudioContext asynchronously
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.audioContext.close()
                    .then(() => console.log("AudioContext closed."))
                    .catch(err => console.error("Error closing AudioContext:", err))
                    .finally(() => this.audioContext = null); // Ensure reference is cleared
            } else {
                this.audioContext = null; // Already closed or never created
            }
        } catch (error) {
             console.error("Error during audio node cleanup:", error);
             // Ensure references are cleared even if disconnect fails
             this.processor = null;
             this.sourceNode = null;
             this.audioContext = null;
        } finally {
             // Clear fallback mode buffers regardless of errors
             this.audioBuffer = [];
             this.speechBuffer = [];
             this.isSpeechActive = false; // Reset VAD state

             // Stop the UI timer
             this.stopTimer();
             console.log("Audio capture cleanup finished.");
        }
    }

    /**
     * Sets the intention to stop recording and cleans up resources.
     * @returns {boolean} - True if stop was initiated, false if already stopped.
     */
    stop() {
        console.log("stop() called.");
        if (!this.isRecording) {
            console.warn('Recording is already stopped.');
            return false; // Indicate nothing was done
        }
        this.isRecording = false; // Set intention flag immediately

        // Stop the audio capture and processing loop (handles both modes)
        this._stopAudioCaptureAndProcessing(); // This stops timers/intervals too

        // If in normal WebSocket mode, close the connection cleanly
        if (!this.useFallbackMode && this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, "Recording stopped by user"); // Normal closure
            }
            // Let the 'onclose' handler manage final cleanup of 'ws' reference
        }
        // Reset VAD state explicitly on stop
         this.isSpeechActive = false;
         this.speechBuffer = [];
         this.audioBuffer = [];

        // Notify UI that recording has stopped
        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, recording: false, status: 'stopped' });
        }
        console.log("Recording intention stopped, capture process terminated.");
        return true; // Indicate stop was successful
    }

    /**
     * Stops the microphone tracks associated with the MediaStream.
     * Call this during release() or when microphone access is no longer needed at all.
     * @private
     */
     _stopMediaStreamTracks() {
         if (this.mediaStream) {
            console.log("Stopping media stream tracks.");
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null; // Clear the reference
        }
     }

    /**
     * Releases all resources: stops recording, stops microphone, closes WebSocket.
     * Should be called when the recorder instance is no longer needed.
     */
    release() {
        console.log("release() called. Cleaning up all resources.");
        // 1. Stop recording intention and audio processing (also stops timers/intervals)
        this.stop();

        // 2. Stop the microphone tracks completely
        this._stopMediaStreamTracks();

        // 3. Ensure WebSocket is fully cleaned up (listeners removed, reference nulled)
        if (this.ws) {
            this.ws.onopen = null; this.ws.onmessage = null; this.ws.onerror = null; this.ws.onclose = null;
            // Close might have been called by stop(), but ensure it's nullified
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                 this.ws.close(1001, "Client released resources"); // Going away
            }
            this.ws = null;
        }

        // 4. Reset all state flags
        this.isServerReady = false;
        this.useFallbackMode = false;
        this.lastError = null;
        // Buffers and VAD state reset by stop() -> _stopAudioCapture...

        console.log("WebSocketAudioRecorder released.");
    }

    // --- Timer Methods ---
    /** Starts the interval timer for updating the UI display. */
    startTimer() {
        this.stopTimer(); // Clear existing interval first
        this.timerInterval = setInterval(() => {
            // Only update if recording is active and a start time exists
            if (this.onTimerUpdate && this.startTime && this.isCapturing) {
                this.onTimerUpdate(Date.now() - this.startTime);
            }
        }, 1000); // Update every second
    }
    /** Stops the UI timer interval. */
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // --- Utility Methods ---
    /** Checks if the recorder intends to record or is actively capturing. */
    isActive() { return this.isRecording || this.isCapturing; }
    /** Checks if the WebSocket connection is currently open (only relevant in normal mode). */
    isConnected() { return !this.useFallbackMode && this.ws?.readyState === WebSocket.OPEN; }
    /** Checks if the recorder is operating in fallback mode. */
    isFallbackModeActive() { return this.useFallbackMode; }
    /** Sends a ping message over the WebSocket if connected (for keepalive). */
    ping() {
        if (this.isConnected()) { // Use isConnected() helper
            console.debug("Sending ping.");
            try {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            } catch (e) {
                console.error("Error sending ping:", e);
                 // Ping failure might indicate connection issues, could trigger fallback check
                 // this._switchToFallbackMode("Ping send failed");
            }
        }
    }

} // End class WebSocketAudioRecorder

// Export the class for use in other scripts (e.g., instructor.js)
// CommonJS style for Node.js compatibility (though this runs in browser)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketAudioRecorder;
}
// Ensure it's available globally if not using modules
// else {
//    window.WebSocketAudioRecorder = WebSocketAudioRecorder;
// }

// --- Add Debug Hooks (Optional but kept from previous step) ---
// This patches the prototype to allow external debug tools to monitor VAD
(function() {
    // Check if class exists and hasn't been patched already
    if (typeof WebSocketAudioRecorder === 'undefined' || WebSocketAudioRecorder.prototype._processSpeechDetection_original) {
        if (typeof WebSocketAudioRecorder === 'undefined') console.warn("Cannot patch WebSocketAudioRecorder - class not found.");
        return;
    }
    console.log("Attaching WebSocketAudioRecorder debug hooks.");

    // Store original methods before overwriting
    WebSocketAudioRecorder.prototype._processSpeechDetection_original = WebSocketAudioRecorder.prototype._processSpeechDetection;
    WebSocketAudioRecorder.prototype._processSpeechSegment_original = WebSocketAudioRecorder.prototype._processSpeechSegment;

    // Overwrite _processSpeechDetection to add debug call
    WebSocketAudioRecorder.prototype._processSpeechDetection = function(audioData) {
        // Call the original logic first
        this._processSpeechDetection_original(audioData);

        // Add debug hook call (only calculates energy if debug tool is active and in fallback)
        if (window.updateSpeechDebugEnergyLevel && this.useFallbackMode) {
             let sumSquares = 0; for (let i = 0; i < audioData.length; i++) sumSquares += audioData[i] * audioData[i];
             const energy = Math.sqrt(sumSquares / audioData.length);
             // Call the globally exposed debug function
             window.updateSpeechDebugEnergyLevel(energy, this.isSpeechActive);
         }
    };

    // Overwrite _processSpeechSegment to add debug log call
    WebSocketAudioRecorder.prototype._processSpeechSegment = function() {
        // Add debug log *before* processing starts
        if (window.addSpeechDebugLog && this.useFallbackMode) {
             // Estimate duration based on buffer before it might be cleared by original method
             const segmentData = this.speechBuffer || [];
             const totalLength = segmentData.reduce((s, b) => s + b.length, 0);
             const durationMs = totalLength / this.options.sampleRate * 1000;
             window.addSpeechDebugLog(`Processing ${durationMs.toFixed(0)}ms segment`);
        }
        // Call the original logic
        this._processSpeechSegment_original();
    };

    console.log("WebSocketAudioRecorder debug hooks added successfully.");
})();