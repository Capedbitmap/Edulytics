// client/public/scripts/audioRecorder.js


/**
 * Handles audio recording, using WebSocket for real-time transcription initially,
 * and falling back to HTTP POST with MediaRecorder blobs if WebSocket fails.
 */
class WebSocketAudioRecorder {
    /**
     * @param {string} lectureCode - The unique code for the lecture.
     * @param {Object} options - Configuration options.
     */
    constructor(lectureCode, options = {}) {
        if (!lectureCode) {
            throw new Error("Lecture code is required for WebSocketAudioRecorder");
        }
        this.lectureCode = lectureCode;
        this.options = {
            serverUrl: window.location.origin.replace(/^http/, 'ws'), // ws:// or wss://
            sampleRate: 16000,   // Sample rate expected by backend/OpenAI (though MediaRecorder might use native)
            numChannels: 1,      // Mono
            bufferSize: 4096,    // Buffer size for ScriptProcessor (less relevant with MediaRecorder)
            fallbackSegmentDuration: 10000, // Max duration (ms) for fallback chunks (from Python: 10 seconds)
            fallbackAudioBitsPerSecond: 128000, // Bitrate for MediaRecorder (e.g., 128kbps)
            
            // Speech detection parameters from Python implementation
            speechEnergyThreshold: 0.05,  // Threshold for speech detection (0.05 is good)
            speechPaddingMs: 300,         // Milliseconds of audio to keep before/after speech
            minSpeechDurationMs: 300,     // Minimum duration to consider as speech
            silenceDurationToEndMs: 2000, // Duration of silence to end speech segment
            
            // Enable speech detection for fallback mode
            useSpeechDetection: true,     // Enable/disable speech detection
            ...options
        };

        // Core State
        this.ws = null;
        this.mediaStream = null;
        this.audioContext = null; // Still needed for initial mic access/graph in some cases? Maybe not.
        this.processor = null;    // ScriptProcessor - Primarily for WebSocket mode
        this.sourceNode = null;
        this.isRecording = false;      // User's intention to record
        this.isCapturing = false;      // Actively capturing audio (either via WS or MediaRecorder)
        this.isServerReady = false;    // Backend WS ready for OpenAI stream
        this.startTime = null;
        this.lastError = null;

        // WebSocket State
        this.sessionId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;

        // Fallback State (MediaRecorder)
        this.useFallbackMode = false;
        this.mediaRecorder = null;
        this.fallbackChunks = [];          // Stores blobs from MediaRecorder
        this.segmentTimeout = null;        // Timeout ID for fallback segment duration
        this.supportedMimeType = this._getBestSupportedMimeType(); // Determine best type upfront

        // Speech Detection State
        this.isSpeechActive = false;       // Whether speech is currently active
        this.speechAudioBuffer = [];       // Buffer for audio data during speech
        this.silenceBuffer = [];           // Buffer for recent audio to catch beginning of speech
        this.speechStartTime = null;       // When current speech segment started
        this.lastSpeechTime = null;        // Last time speech was detected
        this.energyValues = [];            // Recent energy values for smoothing
        this.rawAudioBuffer = [];          // Buffer for raw audio data

        // UI Callbacks
        this.onTranscription = null;
        this.onStatusChange = null;
        this.onTimerUpdate = null;
        this.timerInterval = null;

        console.log(`WebSocketAudioRecorder created for ${this.lectureCode}. Best fallback MIME type: ${this.supportedMimeType || 'None found'}`);
    }

    /** Determines the best supported MIME type for MediaRecorder */
    _getBestSupportedMimeType() {
        // Prioritize MP3 (more broadly supported by OpenAI) over WebM
        const typesToCheck = [
            'audio/mp3',
            'audio/mpeg',
            'audio/wav',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4'
        ];
        
        for (const type of typesToCheck) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        console.warn("No strongly preferred MIME type found for MediaRecorder, may default to browser's choice.");
        return undefined; // Let the browser decide if none are explicitly supported
    }

    /** Initialize microphone access */
    async init() {
        console.log("Initializing microphone access...");
        this.lastError = null;
        if (this.mediaStream) return true;
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.options.sampleRate, // Request preferred rate
                    channelCount: this.options.numChannels,
                    noiseSuppression: true,
                    echoCancellation: true
                }
            });
            console.log("Microphone access granted.");
            // Log actual track settings
            const track = this.mediaStream.getAudioTracks()[0];
            if (track?.getSettings) console.log("Actual Mic Settings:", track.getSettings());
            return true;
        } catch (error) {
            console.error('getUserMedia error:', error);
            this.lastError = `Microphone access error: ${error.name} - ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError });
            this._stopMediaStreamTracks();
            return false;
        }
    }

    /** Connect to WebSocket server (unless in fallback mode) */
    connect() {
        if (this.useFallbackMode) {
            console.log("Fallback Mode: Skipping WebSocket connection.");
            return Promise.resolve();
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve();
        }

        console.log("Attempting WebSocket connection...");
        this.isServerReady = false;

        return new Promise((resolve, reject) => {
            const wsUrl = `${this.options.serverUrl}?lecture_code=${this.lectureCode}`;
            try { this.ws = new WebSocket(wsUrl); }
            catch (error) {
                console.error("WebSocket constructor failed:", error);
                this._switchToFallbackMode('WebSocket constructor failed');
                resolve(); // Resolve as fallback is now active
                return;
            }

            this.ws.onopen = () => {
                console.log('WebSocket connected to backend.');
                this.reconnectAttempts = 0;
                if (this.onStatusChange) this.onStatusChange({ connected: true, status: 'backend_connected' });
                resolve();
            };

            this.ws.onerror = (event) => {
                console.error('WebSocket connection error:', event);
                this.isServerReady = false;
                this._stopAudioCaptureAndProcessing(); // Stop WS mode capture if running
                if (this.onStatusChange) this.onStatusChange({ connected: false, error: 'WebSocket connection error' });
                if (!this._handleReconnect(reject, 'WebSocket error')) {
                    this._switchToFallbackMode('WebSocket connection error');
                    resolve(); // Resolve as fallback is active
                }
            };

            this.ws.onclose = (event) => {
                const reason = event.reason || 'No reason provided';
                console.log(`WebSocket closed: ${event.code} - ${reason}`);
                this.isServerReady = false;
                this._stopAudioCaptureAndProcessing(); // Stop WS mode capture

                if (event.code === 4001 || reason.includes('FALLBACK_REQUIRED')) {
                    console.log("Fallback requested by server.");
                    this._switchToFallbackMode(`Server initiated (${reason})`);
                } else if (this.isRecording && !this.useFallbackMode && event.code !== 1000) {
                    if (!this._handleReconnect(() => {}, 'WebSocket closed')) {
                        this._switchToFallbackMode('WebSocket closed unexpectedly');
                    }
                } else if (!this.useFallbackMode && this.onStatusChange) {
                    this.onStatusChange({ connected: false, status: 'disconnected', code: event.code, reason });
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'error' && message.message?.includes('Transcription service') ||
                        message.type === 'status' && message.status === 'server_disconnected_openai') {
                        console.error("Backend indicates upstream transcription error:", message);
                        this._switchToFallbackMode('Upstream service error');
                        return;
                    }

                    if (message.type === 'status' && message.status === 'connected') {
                        console.log("Backend ready for OpenAI stream.");
                        this.isServerReady = true;
                        this.sessionId = message.session_id;
                        if (this.isRecording && !this.isCapturing) {
                            console.log("Starting WebSocket audio capture.");
                            this._startAudioCaptureAndProcessing(); // Start WS capture
                        }
                        if (this.onStatusChange) this.onStatusChange({ connected: true, status: 'server_ready' });
                    } else if (message.type === 'transcription') {
                        if (this.onTranscription) this.onTranscription(message);
                    } else if (message.type === 'pong') { /* Keepalive */ }

                } catch (error) { console.error('Error parsing backend message:', error, event.data); }
            };
        });
    }

    /** Switch to fallback mode (MediaRecorder + HTTP POST) */
    _switchToFallbackMode(reason = 'Unknown reason') {
        if (this.useFallbackMode) return;
        console.warn(`Switching to fallback mode. Reason: ${reason}`);
        this.useFallbackMode = true;
        this.lastError = `Switched to fallback: ${reason}`;

        // Clean up WebSocket
        this._cleanupWebSocket();
        this.isServerReady = false;
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent WS reconnects

        // Clean up ScriptProcessor if it was running
        this._stopAndCleanupScriptProcessor();

        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, recording: this.isRecording, status: 'fallback_mode', message: 'Using standard API.' });
        }

        // If recording is intended, start capture using MediaRecorder
        if (this.isRecording) {
            console.log("Restarting audio capture for fallback mode using MediaRecorder.");
            this._startAudioCaptureInFallbackMode(); // Start MediaRecorder capture
        }
    }

    /** Handle WebSocket reconnection attempts */
    _handleReconnect(reject, reason) {
        if (this.useFallbackMode) return false; // No reconnect in fallback
        if (this.isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            console.log(`Attempting WS reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms due to: ${reason}`);
            setTimeout(() => {
                if (this.isRecording && !this.useFallbackMode) {
                    console.log("Executing WS reconnect attempt...");
                    this.connect().catch((err) => {
                        console.error(`WS Reconnect attempt ${this.reconnectAttempts} failed:`, err);
                        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                            console.error("Max WS reconnections reached. Switching to fallback.");
                            this._switchToFallbackMode('Max WS reconnections failed');
                        }
                    });
                } else { console.log("WS Reconnect cancelled."); }
            }, delay);
            return true; // Reconnect scheduled
        } else {
            if (this.isRecording && !this.useFallbackMode) {
                 console.error(`Max WS reconnects reached or not recording. Will switch to fallback if recording.`);
            }
            return false; // No reconnect scheduled
        }
    }

    /** Start recording intention */
    async start() {
        console.log("start() called.");
        if (this.isRecording) { console.warn('Recording already active.'); return Promise.resolve(); }

        const micReady = await this.init();
        if (!micReady) return Promise.reject(new Error(this.lastError || "Mic init failed"));

        console.log("Setting recording intention: true.");
        this.isRecording = true;

        if (this.useFallbackMode) {
            console.log("Start: Already in fallback mode, ensuring capture.");
            if (!this.isCapturing) this._startAudioCaptureInFallbackMode(); // Start MediaRecorder
            if (this.onStatusChange) this.onStatusChange({ status: 'fallback_mode' });
            return Promise.resolve();
        } else {
            try {
                await this.connect(); // Attempt WS connection
                if (!this.useFallbackMode && this.onStatusChange) { // Check if connect switched to fallback
                     this.onStatusChange({ connected: this.isConnected(), status: this.isServerReady ? 'server_ready' : 'connecting' });
                }
                console.log("Start: WS connection process initiated/verified.");
                return Promise.resolve();
            } catch (error) {
                console.error("Start: Error during connection phase:", error);
                // If connect failed and switched to fallback
                if (this.useFallbackMode) {
                     console.log("Start: WS failed, starting fallback capture.");
                     if (!this.isCapturing) this._startAudioCaptureInFallbackMode();
                     if (this.onStatusChange) this.onStatusChange({ status: 'fallback_mode' });
                     return Promise.resolve();
                } else { // Connect failed without fallback switch
                     this.isRecording = false;
                     if (this.onStatusChange) this.onStatusChange({ error: `Start failed: ${error.message}` });
                     return Promise.reject(error);
                }
            }
        }
    }

    /** Start audio capture: Either via WebSocket (ScriptProcessor) or Fallback (MediaRecorder) */
    _startAudioCaptureAndProcessing() {
        if (this.isCapturing) return;
        if (!this.isRecording || !this.mediaStream) return;

        if (this.useFallbackMode) {
            this._startAudioCaptureInFallbackMode();
        } else {
            this._startAudioCaptureWithScriptProcessor();
        }
    }

    /** Start audio capture using ScriptProcessor for WebSocket streaming */
    _startAudioCaptureWithScriptProcessor() {
         if (this.isCapturing) return;
         // Requires server readiness in this mode
         if (!this.isServerReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log(`WS Mode: Postponing ScriptProcessor start - ServerReady=${this.isServerReady}, WSState=${this.ws?.readyState}.`);
            return;
         }

        console.log("Starting Audio Capture (WebSocket/ScriptProcessor mode)...");
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.options.sampleRate });
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processor = this.audioContext.createScriptProcessor(this.options.bufferSize, this.options.numChannels, this.options.numChannels);

            this.processor.onaudioprocess = (event) => {
                if (!this.isRecording || !this.isCapturing || this.useFallbackMode) return; // Stop if switched
                const inputData = event.inputBuffer.getChannelData(0);
                if (this.isServerReady && this.ws?.readyState === WebSocket.OPEN) {
                    try {
                        const pcmBuffer = this._floatTo16BitPCM(inputData);
                        this.ws.send(pcmBuffer);
                    } catch (sendError) {
                        console.error("WS send error:", sendError);
                        this._switchToFallbackMode('Error sending WS audio data'); // Switch on send error
                    }
                }
            };

            this.sourceNode.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            this.isCapturing = true;
            this.startTime = Date.now();
            this.startTimer();
            console.log("ScriptProcessor capture started.");
            if (this.onStatusChange) this.onStatusChange({ connected: true, recording: true, status: 'capturing' });
        } catch(error) {
             console.error('Error starting ScriptProcessor capture:', error);
             this._stopAndCleanupScriptProcessor(); // Clean up specific nodes
             this.isCapturing = false;
             this.lastError = `Audio capture error: ${error.message}`;
             if (this.onStatusChange) this.onStatusChange({ connected: this.isConnected(), recording: false, error: this.lastError });
             // Potentially try fallback if WS capture fails?
             // if (this.isRecording) this._switchToFallbackMode('ScriptProcessor init failed');
        }
    }

    /** Start audio capture using MediaRecorder for Fallback mode */
    _startAudioCaptureInFallbackMode() {
        if (this.isCapturing) { console.warn("Fallback capture already running."); return; }
        if (!this.mediaStream) { console.error("Cannot start fallback capture: MediaStream unavailable."); return; }

        try {
            const mimeType = this.supportedMimeType || undefined; // Let browser choose if no preferred type found
            const options = { audioBitsPerSecond: this.options.fallbackAudioBitsPerSecond };
            if (mimeType) options.mimeType = mimeType;

            console.log(`Starting MediaRecorder with options:`, options);
            
            // Initialize speech detection state
            this.isSpeechActive = false;
            this.speechAudioBuffer = [];
            this.silenceBuffer = [];
            this.speechStartTime = null;
            this.lastSpeechTime = null;
            this.energyValues = [];
            this.rawAudioBuffer = [];
            
            // Set up audio context and processor for speech detection
            if (this.options.useSpeechDetection) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.options.sampleRate
                });
                if (this.audioContext.state === 'suspended') this.audioContext.resume();
                
                this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
                this.processor = this.audioContext.createScriptProcessor(
                    this.options.bufferSize, 
                    this.options.numChannels, 
                    this.options.numChannels
                );
                
                // Process raw audio data for speech detection
                this.processor.onaudioprocess = (event) => {
                    if (!this.isRecording || !this.isCapturing || !this.useFallbackMode) return;
                    
                    const inputData = event.inputBuffer.getChannelData(0);
                    this._processSpeechDetection(inputData);
                };
                
                this.sourceNode.connect(this.processor);
                this.processor.connect(this.audioContext.destination);
            }

            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
            this.fallbackChunks = []; // Reset chunks array

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.fallbackChunks.push(event.data);
                } else {
                     console.log("MediaRecorder: received empty data chunk.");
                }
            };

            this.mediaRecorder.onstop = () => {
                 console.log("MediaRecorder stopped. Processing chunks...");
                 clearTimeout(this.segmentTimeout); // Clear segment timer
                 this.segmentTimeout = null;
                 this.isCapturing = false; // Mark capture stopped (for this segment)

                 if (this.fallbackChunks.length > 0) {
                     // Create blob from collected chunks
                     const audioBlob = new Blob(this.fallbackChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
                     console.log(`MediaRecorder created ${audioBlob.size} byte blob (type: ${audioBlob.type})`);

                     // Send blob for transcription
                     if (audioBlob.size > 100) { // Basic check for non-empty blob
                          this._sendAudioForTranscription(audioBlob);
                     } else {
                          console.log("Skipping empty audio blob transmission.");
                     }

                     // Clear chunks immediately after creating blob
                     this.fallbackChunks = [];
                 } else {
                     console.log("No audio chunks recorded in this segment.");
                 }

                 // If recording intention is still true, start the next segment
                 if (this.isRecording && this.useFallbackMode) {
                     if (this.options.useSpeechDetection) {
                         if (this.isSpeechActive) {
                             console.log("Speech still active, starting next recording segment...");
                             this._startMediaRecorder();
                         } else {
                             console.log("Waiting for speech to start next recording segment...");
                             this.isCapturing = true; // Still capturing, just not with MediaRecorder
                         }
                     } else {
                         console.log("Starting next fallback recording segment...");
                         this._startMediaRecorder();
                     }
                 } else {
                      // If stop() was called, isRecording will be false, so we just stop fully
                      console.log("Not starting next segment, recording intention is false.");
                      this.stopTimer(); // Ensure timer stops if stop() was called during segment processing
                 }
            };

             this.mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error:", event.error);
                this.lastError = `MediaRecorder error: ${event.error.name} - ${event.error.message}`;
                if (this.onStatusChange) this.onStatusChange({ error: this.lastError });
                // Attempt to stop and potentially restart? Or just stop?
                this.stop(); // Stop recording fully on MediaRecorder error
            };

            // Start recording - either immediately or when speech is detected
            if (!this.options.useSpeechDetection) {
                this._startMediaRecorder();
            } else {
                console.log("Speech detection enabled. Waiting for speech...");
                // MediaRecorder will be started when speech is detected
                this.isCapturing = true; // Mark as capturing even though MediaRecorder isn't running
            }
            
            if (!this.startTime) this.startTime = Date.now();
            this.startTimer();

            console.log(`Fallback mode initialized. Speech detection: ${this.options.useSpeechDetection ? 'enabled' : 'disabled'}.`);
            if (this.onStatusChange) {
                this.onStatusChange({ 
                    connected: false, 
                    recording: true, 
                    status: 'fallback_mode',
                    message: this.options.useSpeechDetection ? 'Listening for speech...' : 'Recording in fallback mode'
                });
            }

        } catch (error) {
            console.error('Error starting MediaRecorder:', error);
            this.lastError = `MediaRecorder start error: ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError, recording: false });
            this.isRecording = false; // Stop intention if capture fails
            this.isCapturing = false;
        }
    }

    /** Helper to start the MediaRecorder */
    _startMediaRecorder() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'recording') return;
        
        try {
            this.mediaRecorder.start();
            console.log(`MediaRecorder started (state: ${this.mediaRecorder.state}, type: ${this.mediaRecorder.mimeType}).`);
            
            // Set timeout to stop this segment after max duration
            this.segmentTimeout = setTimeout(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    console.log(`Fallback: Segment duration limit (${this.options.fallbackSegmentDuration}ms) reached. Stopping segment.`);
                    if (window.addSpeechDebugLog) window.addSpeechDebugLog("Max duration reached (MediaRecorder)");
                    this.mediaRecorder.stop();
                }
            }, this.options.fallbackSegmentDuration);
            
            // Update capturing state
            this.isCapturing = true;
            
            // Update status message if needed
            if (this.onStatusChange && this.options.useSpeechDetection) {
                this.onStatusChange({ 
                    connected: false, 
                    recording: true, 
                    status: 'fallback_mode',
                    message: 'Speech detected - recording'
                });
            }
            
        } catch (error) {
            console.error("Error starting MediaRecorder:", error);
            this.lastError = `Failed to start MediaRecorder: ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError });
        }
    }

    /** Process audio data for speech detection */
    _processSpeechDetection(audioData) {
        if (!this.useFallbackMode || !this.options.useSpeechDetection) return;
        
        // Calculate audio energy (RMS)
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const energy = Math.sqrt(sumSquares / audioData.length);
        
        // Add energy value to array for smoothing
        this.energyValues.push(energy);
        if (this.energyValues.length > 5) {
            this.energyValues.shift();
        }
        
        // Get average energy
        const avgEnergy = this.energyValues.reduce((sum, val) => sum + val, 0) / this.energyValues.length;
        
        // Determine if this is speech
        const isSpeech = avgEnergy > this.options.speechEnergyThreshold;
        const currentTime = Date.now();
        
        // Update UI if debug function exists
        if (window.updateSpeechDebugEnergyLevel) {
            window.updateSpeechDebugEnergyLevel(avgEnergy, isSpeech || this.isSpeechActive);
        }
        
        if (isSpeech) {
            // Store a copy of the audio data
            this.rawAudioBuffer.push(new Float32Array(audioData));
            
            // Update last speech time
            this.lastSpeechTime = currentTime;
            
            // If we weren't in active speech mode, start a new speech segment
            if (!this.isSpeechActive) {
                this.isSpeechActive = true;
                this.speechStartTime = currentTime;
                
                if (window.addSpeechDebugLog) {
                    window.addSpeechDebugLog("Speech started");
                }
                
                // Include buffered silence for context before speech
                for (const silence of this.silenceBuffer) {
                    this.speechAudioBuffer.push(silence);
                }
                this.silenceBuffer = [];
                
                // Add current audio to speech buffer
                this.speechAudioBuffer.push(new Float32Array(audioData));
                
                // Start MediaRecorder if not already recording
                if (this.mediaRecorder && this.mediaRecorder.state !== 'recording') {
                    this._startMediaRecorder();
                }
            } else {
                // Continue adding to speech buffer
                this.speechAudioBuffer.push(new Float32Array(audioData));
            }
        } else {
            // Not speech
            if (this.isSpeechActive) {
                // Store a copy of the audio data
                this.rawAudioBuffer.push(new Float32Array(audioData));
                
                // Add to speech buffer to maintain context during short pauses
                this.speechAudioBuffer.push(new Float32Array(audioData));
                
                // Check if silence has been long enough to end speech detection
                if (currentTime - this.lastSpeechTime > this.options.silenceDurationToEndMs) {
                    // End speech detection if the speech segment was long enough
                    if (this.speechStartTime && this.lastSpeechTime - this.speechStartTime > this.options.minSpeechDurationMs) {
                        if (window.addSpeechDebugLog) {
                            window.addSpeechDebugLog(`Speech ended (${Math.round((this.lastSpeechTime - this.speechStartTime)/100)/10}s)`);
                        }
                        
                        this.isSpeechActive = false;
                        
                        // Stop MediaRecorder to finalize the segment
                        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                            console.log("Stopping MediaRecorder due to end of speech");
                            this.mediaRecorder.stop();
                        }
                        
                        // Clear speech buffer
                        this.speechAudioBuffer = [];
                        
                        if (this.onStatusChange) {
                            this.onStatusChange({ 
                                connected: false, 
                                recording: true, 
                                status: 'fallback_mode',
                                message: 'Speech ended - processing' 
                            });
                            
                            // Update status after a short delay
                            setTimeout(() => {
                                if (this.isRecording && this.useFallbackMode && this.onStatusChange) {
                                    this.onStatusChange({
                                        connected: false,
                                        recording: true,
                                        status: 'fallback_mode',
                                        message: 'Listening for speech...'
                                    });
                                }
                            }, 2000);
                        }
                    } else {
                        // Speech segment too short, discard
                        if (window.addSpeechDebugLog) {
                            window.addSpeechDebugLog("Speech too short - discarded");
                        }
                        
                        this.isSpeechActive = false;
                        this.speechAudioBuffer = [];
                        
                        // Stop MediaRecorder if it was started for this segment
                        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                            console.log("Stopping MediaRecorder - speech too short");
                            this.mediaRecorder.stop();
                        }
                    }
                }
            } else {
                // Keep a small buffer of recent audio to catch the beginning of speech
                this.silenceBuffer.push(new Float32Array(audioData));
                
                // Calculate how many buffers to keep for the speech padding
                const bufferSizeMs = (this.options.bufferSize / this.options.sampleRate) * 1000;
                const maxBuffers = Math.ceil(this.options.speechPaddingMs / bufferSizeMs);
                
                // Limit the silence buffer size
                if (this.silenceBuffer.length > maxBuffers) {
                    this.silenceBuffer.shift();
                }
            }
        }
    }

    /** Send audio blob to fallback endpoint */
    _sendAudioForTranscription(audioBlob) {
        if (!this.useFallbackMode || !audioBlob || audioBlob.size === 0) {
             console.warn("Fallback: Skipping sending empty or invalid audio blob.");
             return;
        }

        console.log(`Fallback: Sending audio blob (${audioBlob.size} bytes, type: ${audioBlob.type}) to /fallback_transcription...`);
        if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Sending ${Math.round(audioBlob.size / 1024)}KB audio`);

        // Add a download link for debugging (keep this during debugging)
        try {
            const blobUrl = URL.createObjectURL(audioBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            const filename = `debug_${Date.now()}.${audioBlob.type.split('/')[1]?.split(';')[0] || 'webm'}`;
            link.download = filename;
            link.textContent = `Download ${filename} (DEBUG)`;
            link.style.cssText = "display:none;"; // Hide but keep accessible
            document.body.appendChild(link);
            // Uncomment to auto-download for debugging:
            // link.click();
            setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                link.remove();
            }, 60000);
        } catch(e) {
            console.error("DEBUG: Error creating download link:", e);
        }

        // Determine file extension based on MIME type
        const mimeType = audioBlob.type;
        let extension = 'webm'; // Default
        if (mimeType.includes('mp3') || mimeType.includes('mpeg')) extension = 'mp3';
        else if (mimeType.includes('mp4') || mimeType.includes('m4a')) extension = 'mp4';
        else if (mimeType.includes('wav')) extension = 'wav';
        else if (mimeType.includes('ogg')) extension = 'ogg';

        // Create a filename with the proper extension
        const filename = `rec_${Date.now()}.${extension}`;

        const formData = new FormData();
        formData.append('audio', audioBlob, filename);
        formData.append('lecture_code', this.lectureCode);

        if (this.onStatusChange) {
            this.onStatusChange({ status: 'processing_fallback', message: "Processing audio..." });
        }

        fetch('/fallback_transcription', { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) {
                 return response.json().catch(() => ({ error: `Server error ${response.status}` }))
                    .then(errorData => { throw new Error(errorData.error || `HTTP error ${response.status}`); });
            }
            return response.json();
        })
        .then(data => {
            console.log("Fallback: Received transcription response:", data);
            if (data.success && data.text) {
                 if (this.onTranscription) {
                     this.onTranscription({
                         type: 'transcription', event_type: 'fallback_transcription.completed',
                         text: data.text, timestamp: data.timestamp || Date.now(), source: 'fallback_api'
                     });
                 }
            } else if (data.success && !data.text) {
                 console.log("Fallback: Empty transcription received.");
            } else {
                 throw new Error(data.error || 'Unexpected fallback response');
            }
            // Revert status only if *still* recording and *still* in fallback mode
            if (this.onStatusChange && this.isRecording && this.useFallbackMode) {
                this.onStatusChange({ 
                    status: 'fallback_mode',
                    message: this.options.useSpeechDetection ? 'Listening for speech...' : 'Recording in fallback mode'
                });
            }
        })
        .catch(error => {
            console.error("Fallback: Transcription fetch error:", error);
            if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Fallback Error: ${error.message}`);
            if (this.onStatusChange) {
                const errorMessage = `Fallback error: ${error.message}`;
                 this.onStatusChange({ error: errorMessage });
                 // Revert status after showing error
                 setTimeout(() => {
                     if (this.isRecording && this.useFallbackMode && this.onStatusChange) {
                         this.onStatusChange({ 
                             status: 'fallback_mode',
                             message: this.options.useSpeechDetection ? 'Listening for speech...' : 'Recording in fallback mode'
                         });
                     }
                 }, 3000);
            }
        });
    }

    /** Stop ONLY the ScriptProcessor nodes and associated context/source. */
    _stopAndCleanupScriptProcessor() {
         if (!this.processor && !this.sourceNode && !this.audioContext) return;
         console.log("Cleaning up ScriptProcessor/AudioContext nodes...");
          try {
            if (this.processor) { this.processor.disconnect(); this.processor.onaudioprocess = null; this.processor = null; }
            if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.audioContext.close().catch(err=>console.warn("Minor error closing AC:",err)).finally(()=>this.audioContext=null);
            } else { this.audioContext = null; }
          } catch(e){ console.error("Error during ScriptProcessor cleanup:", e); }
          finally { this.processor = null; this.sourceNode = null; this.audioContext = null; }
    }

    /** Stop ONLY the MediaRecorder instance and segment timer. */
    _stopAndCleanupMediaRecorder() {
        if (!this.mediaRecorder) return;
        console.log("Cleaning up MediaRecorder...");
        clearTimeout(this.segmentTimeout); // Clear segment timer
        this.segmentTimeout = null;
        if (this.mediaRecorder.state === 'recording') {
             try { this.mediaRecorder.stop(); } catch(e){ console.error("Error stopping MediaRecorder:", e); }
        }
        // Remove listeners to prevent memory leaks
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.onerror = null;
        this.mediaRecorder = null;
        this.fallbackChunks = []; // Clear any remaining chunks
        
        // Clean up speech detection state
        this.isSpeechActive = false;
        this.speechAudioBuffer = [];
        this.silenceBuffer = [];
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.energyValues = [];
        this.rawAudioBuffer = [];
    }

    /** Stop audio capture (generalized). */
    _stopAudioCaptureAndProcessing() {
        if (!this.isCapturing) return;
        console.log("Stopping audio capture...");
        this.isCapturing = false;

        // Stop whichever mechanism was active
        this._stopAndCleanupScriptProcessor(); // Safe to call even if not used
        this._stopAndCleanupMediaRecorder();   // Safe to call even if not used

        this.stopTimer(); // Stop UI timer
        console.log("Audio capture stopped and cleaned up.");
    }

    /** Stop recording intention and cleanup */
    stop() {
        console.log("stop() called.");
        if (!this.isRecording) return false;
        this.isRecording = false; // Set intention flag

        this._stopAudioCaptureAndProcessing(); // Stop capture mechanisms

        // Close WebSocket cleanly if it was open
        this._cleanupWebSocket();

        // Reset speech detection state
        this.isSpeechActive = false;
        this.speechAudioBuffer = [];
        this.silenceBuffer = [];
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.energyValues = [];
        this.rawAudioBuffer = [];

        if (this.onStatusChange) this.onStatusChange({ connected: false, recording: false, status: 'stopped' });
        console.log("Recording fully stopped.");
        return true;
    }

    /** Stop microphone tracks */
     _stopMediaStreamTracks() {
         if (this.mediaStream) {
            console.log("Stopping media stream tracks.");
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
     }

     /** Clean up WebSocket instance and listeners */
     _cleanupWebSocket() {
         if (this.ws) {
            console.log("Cleaning up WebSocket instance.");
            this.ws.onopen = null; this.ws.onmessage = null; this.ws.onerror = null; this.ws.onclose = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, "Client cleanup");
            }
            this.ws = null;
         }
          this.isServerReady = false; // Reset flag
     }

    /** Release all resources */
    release() {
        console.log("release() called.");
        this.stop(); // Handles capture stop, WS close intention
        this._stopMediaStreamTracks(); // Stop mic access
        this._cleanupWebSocket(); // Ensure WS is definitely cleaned up
        this.useFallbackMode = false; // Reset mode on full release
        this.lastError = null;
        console.log("WebSocketAudioRecorder released.");
    }

    // Timer Methods
    startTimer() { this.stopTimer(); this.timerInterval = setInterval(() => { if (this.onTimerUpdate && this.startTime && this.isCapturing) this.onTimerUpdate(Date.now() - this.startTime); }, 1000); }
    stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }

    // Utility Methods
    isActive() { return this.isRecording || this.isCapturing; }
    isConnected() { return !this.useFallbackMode && this.ws?.readyState === WebSocket.OPEN; }
    isFallbackModeActive() { return this.useFallbackMode; }
    ping() { if (this.isConnected()) { console.debug("Sending ping."); try { this.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { console.error("Ping send error:", e); } } }

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
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketAudioRecorder;
}

// --- Debug Hooks (Keep - harmless if debug tools aren't loaded) ---
(function() {
    if (typeof WebSocketAudioRecorder === 'undefined' || WebSocketAudioRecorder.prototype._processSpeechDetection_original_vad) return;
    console.log("Attaching (now potentially unused) VAD debug hooks to WebSocketAudioRecorder.");
    // Store a reference with a unique name if needed, although the original methods are now removed
    WebSocketAudioRecorder.prototype._processSpeechDetection_original_vad = WebSocketAudioRecorder.prototype._processSpeechDetection;
    WebSocketAudioRecorder.prototype._processSpeechSegment_original_vad = WebSocketAudioRecorder.prototype._processSpeechSegment;
    // Add console logs or checks if these methods are unexpectedly called
    WebSocketAudioRecorder.prototype._processSpeechDetection = function(){ console.warn("Obsolete _processSpeechDetection called!"); if(this._processSpeechDetection_original_vad) this._processSpeechDetection_original_vad.apply(this, arguments); };
    WebSocketAudioRecorder.prototype._processSpeechSegment = function(){ console.warn("Obsolete _processSpeechSegment called!"); if(this._processSpeechSegment_original_vad) this._processSpeechSegment_original_vad.apply(this, arguments); };
})();