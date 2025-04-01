// client/public/scripts/audioRecorder.js

/**
 * Handles audio recording for real-time transcription.
 * Attempts to use WebRTC for low-latency streaming to OpenAI Realtime API.
 * Falls back to the original MediaRecorder + HTTP POST mechanism if WebRTC fails.
 */
class RealtimeAudioRecorder {
    /**
     * @param {string} lectureCode - The unique code for the lecture.
     * @param {Object} options - Configuration options.
     */
    constructor(lectureCode, options = {}) {
        if (!lectureCode) {
            throw new Error("Lecture code is required for RealtimeAudioRecorder");
        }
        this.lectureCode = lectureCode;
        this.options = {
            // WebRTC specific
            realtimeApiUrl: "https://api.openai.com/v1/realtime",
            realtimeModel: "gpt-4o-mini-transcribe", // Model for WebRTC transcription
            sessionEndpoint: "/session", // Endpoint to get ephemeral key

            // Shared / Fallback specific
            sampleRate: 16000,   // Preferred sample rate
            numChannels: 1,      // Mono
            bufferSize: 4096,    // Buffer size for fallback VAD processing
            fallbackSegmentDuration: 10000, // Max duration (ms) for fallback chunks
            fallbackAudioBitsPerSecond: 128000, // Bitrate for MediaRecorder
            useSpeechDetection: true,     // Enable/disable speech detection in fallback mode
            speechEnergyThreshold: 0.05,
            speechPaddingMs: 300,
            minSpeechDurationMs: 300,
            silenceDurationToEndMs: 2000,
            chunkDuration: 20000,         // Fallback chunk duration
            minChunkSize: 1024,           // Minimum bytes for a fallback chunk
            ...options
        };

        // Core State
        this.mediaStream = null;
        this.isRecording = false;      // User's intention to record
        this.isCapturing = false;      // Actively capturing audio (either via WebRTC track or MediaRecorder)
        this.startTime = null;
        this.lastError = null;

        // WebRTC State
        this.peerConnection = null; // RTCPeerConnection instance
        this.dataChannel = null;    // RTCDataChannel instance ('oai-events')
        this.ephemeralKey = null;   // Short-lived API key for WebRTC auth
        this.isWebRTCConnected = false; // Flag indicating successful WebRTC data channel connection

        // Fallback State (MediaRecorder) - Largely unchanged logic
        this.useFallbackMode = false;
        this.mediaRecorder = null;
        this.fallbackChunks = [];          // Stores blobs from MediaRecorder
        this.chunkStartTime = null;        // When current chunk started recording
        this.segmentTimeout = null;        // Timeout ID for fallback segment duration
        this.supportedMimeType = this._getBestSupportedMimeType(); // Determine best type upfront
        this.audioContext = null;          // AudioContext for fallback VAD
        this.processor = null;             // ScriptProcessorNode for fallback VAD
        this.sourceNode = null;            // MediaStreamAudioSourceNode for fallback VAD

        // Speech Detection State (Used only in Fallback Mode)
        this.isSpeechActive = false;
        this.speechAudioBuffer = [];
        this.silenceBuffer = [];
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.energyValues = [];
        this.rawAudioBuffer = [];
        this.totalChunkDuration = 0;
        this.hasSpeechInCurrentChunk = false;

        // UI Callbacks
        this.onTranscription = null;
        this.onStatusChange = null;
        this.onTimerUpdate = null;
        this.timerInterval = null;

        console.log(`RealtimeAudioRecorder created for ${this.lectureCode}. Fallback MIME: ${this.supportedMimeType || 'Default'}`);
    }

    /** Determines the best supported MIME type for MediaRecorder (Fallback) */
    _getBestSupportedMimeType() {
        const typesToCheck = [
            'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/webm;codecs=opus',
            'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'
        ];
        for (const type of typesToCheck) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        console.warn("No strongly preferred MIME type found for MediaRecorder fallback.");
        return undefined;
    }

    /** Initialize microphone access */
    async init() {
        console.log("Initializing microphone access...");
        this.lastError = null;
        if (this.mediaStream) return true;
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.options.sampleRate,
                    channelCount: this.options.numChannels,
                    noiseSuppression: true,
                    echoCancellation: true
                }
            });
            console.log("Microphone access granted.");
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

    /** Attempt to connect using WebRTC */
    async connectWebRTC() {
        if (this.useFallbackMode) {
            console.log("Already in fallback mode, skipping WebRTC connection.");
            return; // Don't attempt if already in fallback
        }
        if (this.peerConnection || this.isWebRTCConnected) {
            console.log("WebRTC connection already exists or is in progress.");
            return; // Already connected or connecting
        }

        console.log("Attempting WebRTC connection...");
        this.isWebRTCConnected = false;
        this.lastError = null;
        if (this.onStatusChange) this.onStatusChange({ status: 'connecting_webrtc', message: 'Connecting...' });

        try {
            // 1. Get Ephemeral Key
            console.log(`Fetching ephemeral key from ${this.options.sessionEndpoint}...`);
            const tokenResponse = await fetch(this.options.sessionEndpoint);
            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                throw new Error(`Failed to get session token: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`);
            }
            const sessionData = await tokenResponse.json();
            this.ephemeralKey = sessionData?.client_secret?.value;
            if (!this.ephemeralKey) {
                throw new Error("Ephemeral key (client_secret) not found in session response.");
            }
            console.log("Ephemeral key obtained.");

            // 2. Create Peer Connection
            this.peerConnection = new RTCPeerConnection();
            this._setupPeerConnectionListeners(); // Attach error/state listeners

            // 3. Add Local Audio Track
            if (!this.mediaStream) {
                throw new Error("MediaStream not available to add audio track.");
            }
            const audioTrack = this.mediaStream.getAudioTracks()[0];
            if (!audioTrack) {
                throw new Error("No audio track found in MediaStream.");
            }
            this.peerConnection.addTrack(audioTrack, this.mediaStream);
            console.log("Audio track added to PeerConnection.");

            // 4. Create Data Channel
            this.dataChannel = this.peerConnection.createDataChannel("oai-events");
            this._setupDataChannelListeners(); // Attach message/state listeners
            console.log("Data channel 'oai-events' created.");

            // 5. Start SDP Offer/Answer Exchange
            console.log("Creating SDP offer...");
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            console.log("Local description (offer) set.");

            const sdpUrl = `${this.options.realtimeApiUrl}?model=${this.options.realtimeModel}&intent=transcription`;
            console.log(`Sending SDP offer to ${sdpUrl}...`);
            const sdpResponse = await fetch(sdpUrl, {
                method: "POST",
                body: offer.sdp,
                headers: {
                    Authorization: `Bearer ${this.ephemeralKey}`,
                    "Content-Type": "application/sdp"
                },
            });

            if (!sdpResponse.ok) {
                const errorText = await sdpResponse.text();
                throw new Error(`SDP exchange failed: ${sdpResponse.status} ${sdpResponse.statusText} - ${errorText}`);
            }

            const answerSdp = await sdpResponse.text();
            const answer = { type: "answer", sdp: answerSdp };
            await this.peerConnection.setRemoteDescription(answer);
            console.log("Remote description (answer) set. WebRTC negotiation complete.");

            // Note: Connection success is primarily determined by the data channel 'open' event.
            // We don't set isWebRTCConnected = true here.

        } catch (error) {
            console.error('WebRTC connection failed:', error);
            this.lastError = `WebRTC connection failed: ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError, status: 'webrtc_failed' });
            this._switchToFallbackMode(`WebRTC connection failed: ${error.message}`);
        }
    }

    /** Set up listeners for the RTCPeerConnection */
    _setupPeerConnectionListeners() {
        if (!this.peerConnection) return;

        this.peerConnection.onicecandidate = (event) => {
            // Usually handled automatically, but log for debugging
            if (event.candidate) {
                // console.debug("ICE candidate:", event.candidate);
            } else {
                console.debug("ICE gathering finished.");
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection?.iceConnectionState;
            console.log(`ICE connection state changed: ${state}`);
            if (this.onStatusChange) this.onStatusChange({ status: `ice_${state}` });

            if (['failed', 'disconnected', 'closed'].includes(state)) {
                if (!this.useFallbackMode) { // Only switch if not already in fallback
                    console.error(`ICE connection state indicates failure (${state}). Switching to fallback.`);
                    this._switchToFallbackMode(`ICE connection state: ${state}`);
                }
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log(`Peer connection state changed: ${state}`);
             if (this.onStatusChange) this.onStatusChange({ status: `peer_${state}` });

            if (['failed', 'disconnected', 'closed'].includes(state)) {
                 if (!this.useFallbackMode) { // Only switch if not already in fallback
                    console.error(`Peer connection state indicates failure (${state}). Switching to fallback.`);
                    this._switchToFallbackMode(`Peer connection state: ${state}`);
                }
            }
        };

        // Handle remote tracks if needed (e.g., for speech-to-speech, not transcription-only)
        // this.peerConnection.ontrack = (event) => {
        //     console.log("Remote track received:", event.track);
        // };
    }

    /** Set up listeners for the RTCDataChannel */
    _setupDataChannelListeners() {
        if (!this.dataChannel) return;

        this.dataChannel.onopen = () => {
            console.log("WebRTC Data Channel opened.");
            this.isWebRTCConnected = true;
            this.isCapturing = true; // Start considering capture active
            if (!this.startTime) this.startTime = Date.now();
            this.startTimer();
            if (this.onStatusChange) this.onStatusChange({ connected: true, recording: true, status: 'webrtc_connected', message: 'Realtime connected.' });

            // Send initial configuration to OpenAI over the data channel
            this._sendWebRTCConfig();
        };

        this.dataChannel.onclose = () => {
            console.log("WebRTC Data Channel closed.");
            this.isWebRTCConnected = false;
            this.isCapturing = false;
            this.stopTimer();
            if (!this.useFallbackMode) { // Only switch if not already in fallback
                console.warn("Data channel closed unexpectedly. Switching to fallback.");
                this._switchToFallbackMode("Data channel closed");
            }
             if (this.onStatusChange) this.onStatusChange({ connected: false, recording: this.isRecording, status: 'webrtc_closed' });
        };

        this.dataChannel.onerror = (event) => {
            console.error("WebRTC Data Channel error:", event.error);
            this.lastError = `Data channel error: ${event.error?.message || 'Unknown error'}`;
             if (!this.useFallbackMode) { // Only switch if not already in fallback
                this._switchToFallbackMode(`Data channel error: ${event.error?.message}`);
            }
             if (this.onStatusChange) this.onStatusChange({ error: this.lastError, status: 'webrtc_error' });
        };

        this.dataChannel.onmessage = (event) => {
            // Handle messages received from OpenAI (transcriptions)
            try {
                const message = JSON.parse(event.data);
                // console.debug("WebRTC message received:", message);

                // Handle errors reported by OpenAI first
                if (message.type?.includes('error')) {
                    console.error("OpenAI error received via WebRTC:", message);
                    this.lastError = `OpenAI error: ${message.error?.message || JSON.stringify(message)}`;
                    this._switchToFallbackMode(`OpenAI error via WebRTC: ${message.error?.code || 'Unknown'}`);
                    return;
                }

                // Handle transcription results
                if (message.type === 'conversation.item.input_audio_transcription.completed' ||
                   (message.type === 'conversation.item.input_audio_transcription.delta' && message.delta?.trim()))
                {
                    const text = message.type === 'conversation.item.input_audio_transcription.completed' ? message.transcript : message.delta;
                    const timestamp = Date.now(); // Use client timestamp for WebRTC events
                    const event_type = message.type;
                    const item_id = message.item_id;

                    // 1. Forward to UI callback (instructor view)
                    if (this.onTranscription) {
                        this.onTranscription({
                            type: 'transcription',
                            event_type: event_type,
                            text: text,
                            timestamp: timestamp,
                            item_id: item_id,
                            source: 'webrtc_api'
                        });
                    }

                    // 2. Send transcription data to server for saving to Firebase (student view)
                    this._saveTranscriptionToServer({
                        lecture_code: this.lectureCode,
                        text: text,
                        timestamp: timestamp,
                        event_type: event_type,
                        item_id: item_id
                    });
                }
                // Handle other potential OpenAI event types if needed
            } catch (error) {
                console.error('Error parsing or processing WebRTC message:', error, event.data);
            }
        };
    }

     /** Send initial configuration over the WebRTC data channel */
    _sendWebRTCConfig() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn("Cannot send WebRTC config: Data channel not open.");
            return;
        }

        const configPayload = {
            type: "session.update",
            session: {
                input_audio_format: "pcm16", // Assumes browser provides compatible audio via addTrack
                input_audio_transcription: {
                    model: this.options.realtimeModel,
                    language: "en"
                },
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 700
                },
                input_audio_noise_reduction: {
                    type: "near_field"
                },
            },
        };

        try {
            this.dataChannel.send(JSON.stringify(configPayload));
            console.log("Sent initial config over WebRTC data channel.");
        } catch (error) {
            console.error("Failed to send config over WebRTC data channel:", error);
            // Potentially trigger fallback if config send fails critically
            this._switchToFallbackMode("Failed to send WebRTC config");
        }
    }

    /** Switch to fallback mode (MediaRecorder + HTTP POST) */
    _switchToFallbackMode(reason = 'Unknown reason') {
        if (this.useFallbackMode) return; // Already in fallback
        console.warn(`Switching to fallback mode. Reason: ${reason}`);
        this.useFallbackMode = true;
        this.lastError = `Switched to fallback: ${reason}`;

        // Clean up WebRTC resources
        this._cleanupWebRTC();
        this.isWebRTCConnected = false;

        // Clean up any lingering fallback VAD resources just in case
        this._stopAndCleanupFallbackVADProcessor();

        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, recording: this.isRecording, status: 'fallback_mode', message: 'Using standard API.' });
        }

        // If recording is intended, start capture using MediaRecorder
        if (this.isRecording) {
            console.log("Restarting audio capture for fallback mode using MediaRecorder.");
            // Ensure mic stream is still available or re-initialize if necessary
            if (!this.mediaStream) {
                console.warn("MediaStream lost before fallback start, attempting re-init...");
                this.init().then(success => {
                    if (success) {
                        this._startAudioCaptureInFallbackMode();
                    } else {
                        console.error("Failed to re-initialize mic for fallback mode.");
                        this.stop(); // Stop fully if mic fails
                    }
                });
            } else {
                 this._startAudioCaptureInFallbackMode(); // Start MediaRecorder capture
            }
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
        this.useFallbackMode = false; // Reset fallback state on new start attempt
        this.lastError = null;

        // Attempt WebRTC connection first
        await this.connectWebRTC();

        // If connectWebRTC failed and switched to fallback, it will handle starting MediaRecorder.
        // If connectWebRTC succeeded, the data channel 'open' event will set isCapturing and start timer.
        // If connectWebRTC is still pending, we wait.

        // Update status based on current state after connection attempt
        if (this.useFallbackMode) {
             if (this.onStatusChange) this.onStatusChange({ status: 'fallback_mode' });
        } else if (this.isWebRTCConnected) {
             if (this.onStatusChange) this.onStatusChange({ status: 'webrtc_connected' });
        } else if (this.peerConnection) {
             if (this.onStatusChange) this.onStatusChange({ status: 'connecting_webrtc' });
        }

        return Promise.resolve();
    }

    /** Start audio capture: Only relevant for Fallback (MediaRecorder) */
    _startAudioCaptureAndProcessing() {
        if (this.isCapturing) return;
        if (!this.isRecording || !this.mediaStream) return;

        if (this.useFallbackMode) {
            this._startAudioCaptureInFallbackMode();
        } else {
            // WebRTC capture starts implicitly when the track is added and connection established.
            console.log("WebRTC mode: Audio capture managed by PeerConnection track.");
        }
    }

    /** Start audio capture using MediaRecorder for Fallback mode with chunking - UNCHANGED */
    _startAudioCaptureInFallbackMode() {
        if (this.isCapturing) { console.warn("Fallback capture already running."); return; }
        if (!this.mediaStream) { console.error("Cannot start fallback capture: MediaStream unavailable."); return; }

        try {
            const mimeType = this.supportedMimeType || undefined;
            const options = { audioBitsPerSecond: this.options.fallbackAudioBitsPerSecond };
            if (mimeType) options.mimeType = mimeType;

            console.log(`Starting MediaRecorder with options:`, options);

            // Initialize chunk and speech detection state
            this.totalChunkDuration = 0;
            this.hasSpeechInCurrentChunk = false;
            this.chunkStartTime = Date.now();
            this.isSpeechActive = false;
            this.speechAudioBuffer = [];
            this.silenceBuffer = [];
            this.speechStartTime = null;
            this.lastSpeechTime = null;
            this.energyValues = [];
            this.rawAudioBuffer = [];

            // Set up audio context and processor for speech detection (if enabled)
            if (this.options.useSpeechDetection) {
                 this._stopAndCleanupFallbackVADProcessor(); // Clean up previous VAD if exists
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

                 this.processor.onaudioprocess = (event) => {
                    if (!this.isRecording || !this.isCapturing || !this.useFallbackMode) return;
                    const inputData = event.inputBuffer.getChannelData(0);
                    this._processSpeechDetection(inputData); // Call UNCHANGED VAD logic
                 };

                 this.sourceNode.connect(this.processor);
                 this.processor.connect(this.audioContext.destination); // Connect to destination to keep graph running
                 console.log("Fallback VAD ScriptProcessor started.");
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
                 clearTimeout(this.segmentTimeout);
                 this.segmentTimeout = null;

                 if (this.fallbackChunks.length > 0) {
                     const audioBlob = new Blob(this.fallbackChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
                     console.log(`MediaRecorder created ${audioBlob.size} byte blob (type: ${audioBlob.type})`);

                     const elapsedTime = Date.now() - this.chunkStartTime;
                     console.log(`Chunk duration: ${elapsedTime}ms`);

                     if (audioBlob.size > this.options.minChunkSize &&
                         (!this.options.useSpeechDetection || this.hasSpeechInCurrentChunk)) {
                         this._sendAudioForTranscription(audioBlob); // Call UNCHANGED send logic
                     } else {
                         console.log(`Skipping chunk: ${!this.options.useSpeechDetection ? "Speech detection disabled" :
                                     (this.hasSpeechInCurrentChunk ? "Has speech" : "No speech detected")} - Size: ${audioBlob.size} bytes`);
                     }
                     this.fallbackChunks = [];
                 } else {
                     console.log("No audio chunks recorded in this segment.");
                 }

                 // If recording intention is still true, start the next chunk
                 if (this.isRecording && this.useFallbackMode) {
                     this.totalChunkDuration = 0;
                     this.hasSpeechInCurrentChunk = false;
                     this.chunkStartTime = Date.now();
                     console.log("Starting next chunk recording...");
                     this._startMediaRecorder(); // Restart recorder for next chunk
                     this.isCapturing = true;
                 } else {
                     console.log("Not starting next chunk, recording intention is false.");
                     this.isCapturing = false;
                     this.stopTimer();
                     this._stopAndCleanupFallbackVADProcessor(); // Clean up VAD processor when fully stopped
                 }
            };

             this.mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error:", event.error);
                this.lastError = `MediaRecorder error: ${event.error.name} - ${event.error.message}`;
                if (this.onStatusChange) this.onStatusChange({ error: this.lastError });
                this.stop(); // Stop recording fully on MediaRecorder error
            };

            // Start recording immediately for chunking
            this._startMediaRecorder();

            if (!this.startTime) this.startTime = Date.now();
            this.startTimer();

            console.log(`Fallback mode initialized with ${this.options.chunkDuration}ms chunks. Speech detection: ${this.options.useSpeechDetection ? 'enabled' : 'disabled'}.`);
            if (this.onStatusChange) {
                this.onStatusChange({
                    connected: false,
                    recording: true,
                    status: 'fallback_mode',
                    message: this.options.useSpeechDetection ? 'Recording with speech detection' : 'Recording in chunks'
                });
            }

        } catch (error) {
            console.error('Error starting MediaRecorder:', error);
            this.lastError = `MediaRecorder start error: ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError, recording: false });
            this.isRecording = false;
            this.isCapturing = false;
            this._stopAndCleanupFallbackVADProcessor(); // Clean up VAD processor on start error
        }
    }

    /** Helper to start the MediaRecorder - UNCHANGED */
    _startMediaRecorder() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'recording') return;

        try {
            this.mediaRecorder.start();
            console.log(`MediaRecorder started (state: ${this.mediaRecorder.state}, type: ${this.mediaRecorder.mimeType}).`);

            this.segmentTimeout = setTimeout(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    console.log(`Chunk duration limit (${this.options.chunkDuration}ms) reached. Stopping chunk.`);
                    if (window.addSpeechDebugLog) window.addSpeechDebugLog("Chunk duration reached");
                    this.mediaRecorder.stop();
                }
            }, this.options.chunkDuration);

            this.isCapturing = true;

            if (this.onStatusChange) {
                this.onStatusChange({
                    connected: false,
                    recording: true,
                    status: 'fallback_mode',
                    message: 'Recording chunk...'
                });
            }

        } catch (error) {
            console.error("Error starting MediaRecorder:", error);
            this.lastError = `Failed to start MediaRecorder: ${error.message}`;
            if (this.onStatusChange) this.onStatusChange({ error: this.lastError });
        }
    }

    /** Process audio data for speech detection (Fallback Mode Only) - UNCHANGED */
    _processSpeechDetection(audioData) {
        if (!this.useFallbackMode || !this.options.useSpeechDetection) return;

        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        const energy = Math.sqrt(sumSquares / audioData.length);

        this.energyValues.push(energy);
        if (this.energyValues.length > 5) this.energyValues.shift();
        const avgEnergy = this.energyValues.reduce((sum, val) => sum + val, 0) / this.energyValues.length;

        const isSpeech = avgEnergy > this.options.speechEnergyThreshold;
        const currentTime = Date.now();

        if (window.updateSpeechDebugEnergyLevel) {
            window.updateSpeechDebugEnergyLevel(avgEnergy, isSpeech || this.isSpeechActive);
        }

        if (isSpeech) {
            this.hasSpeechInCurrentChunk = true;
            this.lastSpeechTime = currentTime;
            if (!this.isSpeechActive) {
                this.isSpeechActive = true;
                this.speechStartTime = currentTime;
                if (window.addSpeechDebugLog) window.addSpeechDebugLog("Speech detected");
            }
        } else {
            if (this.isSpeechActive) {
                if (currentTime - this.lastSpeechTime > this.options.silenceDurationToEndMs) {
                    if (this.speechStartTime && this.lastSpeechTime - this.speechStartTime > this.options.minSpeechDurationMs) {
                        if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Speech ended (${Math.round((this.lastSpeechTime - this.speechStartTime)/100)/10}s)`);
                        this.isSpeechActive = false;
                    } else {
                        if (window.addSpeechDebugLog) window.addSpeechDebugLog("Speech too short - continuing chunk");
                        this.isSpeechActive = false;
                    }
                }
            }
        }
    }

    /** Send audio blob to fallback endpoint - UNCHANGED */
    _sendAudioForTranscription(audioBlob) {
        if (!this.useFallbackMode || !audioBlob || audioBlob.size === 0) {
             console.warn("Fallback: Skipping sending empty or invalid audio blob.");
             return;
        }

        console.log(`Fallback: Sending audio blob (${audioBlob.size} bytes, type: ${audioBlob.type}) to /fallback_transcription...`);
        if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Sending ${Math.round(audioBlob.size / 1024)}KB audio`);

        // Debug download link (optional)
        try {
            const blobUrl = URL.createObjectURL(audioBlob);
            const link = document.createElement('a');
            link.href = blobUrl;
            const filename = `debug_${Date.now()}.${audioBlob.type.split('/')[1]?.split(';')[0] || 'webm'}`;
            link.download = filename;
            link.textContent = `Download ${filename} (DEBUG)`;
            link.style.cssText = "display:none;";
            document.body.appendChild(link);
            setTimeout(() => { URL.revokeObjectURL(blobUrl); link.remove(); }, 60000);
        } catch(e) { console.error("DEBUG: Error creating download link:", e); }

        const mimeType = audioBlob.type;
        let extension = 'webm';
        if (mimeType.includes('mp3') || mimeType.includes('mpeg')) extension = 'mp3';
        else if (mimeType.includes('mp4') || mimeType.includes('m4a')) extension = 'mp4';
        else if (mimeType.includes('wav')) extension = 'wav';
        else if (mimeType.includes('ogg')) extension = 'ogg';
        const filename = `rec_${Date.now()}.${extension}`;

        const formData = new FormData();
        formData.append('audio', audioBlob, filename);
        formData.append('lecture_code', this.lectureCode);

        if (this.onStatusChange) {
            this.onStatusChange({ status: 'processing_fallback', message: "Processing audio chunk..." });
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
            if (this.onStatusChange && this.isRecording && this.useFallbackMode) {
                this.onStatusChange({
                    status: 'fallback_mode',
                    message: 'Recording next chunk...'
                });
            }
        })
        .catch(error => {
            console.error("Fallback: Transcription fetch error:", error);
            if (window.addSpeechDebugLog) window.addSpeechDebugLog(`Fallback Error: ${error.message}`);
            if (this.onStatusChange) {
                const errorMessage = `Fallback error: ${error.message}`;
                 this.onStatusChange({ error: errorMessage });
                 setTimeout(() => {
                     if (this.isRecording && this.useFallbackMode && this.onStatusChange) {
                         this.onStatusChange({
                             status: 'fallback_mode',
                             message: 'Recording next chunk...'
                         });
                     }
                 }, 3000);
            }
        });
    }

    /** Stop ONLY the ScriptProcessor nodes used for Fallback VAD. */
    _stopAndCleanupFallbackVADProcessor() {
         if (!this.processor && !this.sourceNode && !this.audioContext) return;
         console.log("Cleaning up Fallback VAD AudioContext nodes...");
          try {
            if (this.processor) { this.processor.disconnect(); this.processor.onaudioprocess = null; this.processor = null; }
            if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.audioContext.close().catch(err=>console.warn("Minor error closing VAD AC:",err)).finally(()=>this.audioContext=null);
            } else { this.audioContext = null; }
          } catch(e){ console.error("Error during Fallback VAD cleanup:", e); }
          finally { this.processor = null; this.sourceNode = null; this.audioContext = null; }
    }

    /** Stop ONLY the MediaRecorder instance and segment timer. */
    _stopAndCleanupMediaRecorder() {
        if (!this.mediaRecorder) return;
        console.log("Cleaning up MediaRecorder...");
        clearTimeout(this.segmentTimeout);
        this.segmentTimeout = null;
        if (this.mediaRecorder.state === 'recording') {
             try { this.mediaRecorder.stop(); } catch(e){ console.error("Error stopping MediaRecorder:", e); }
        }
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.onerror = null;
        this.mediaRecorder = null;
        this.fallbackChunks = [];

        // Clean up speech detection state associated with fallback
        this.isSpeechActive = false;
        this.speechAudioBuffer = [];
        this.silenceBuffer = [];
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.energyValues = [];
        this.rawAudioBuffer = [];
        this.hasSpeechInCurrentChunk = false;
        this.totalChunkDuration = 0;
    }

    /** Stop audio capture (generalized). */
    _stopAudioCaptureAndProcessing() {
        if (!this.isCapturing) return;
        console.log("Stopping audio capture...");
        this.isCapturing = false;

        // Stop fallback mechanisms if they were active
        this._stopAndCleanupMediaRecorder();   // Stops MediaRecorder and its timer
        this._stopAndCleanupFallbackVADProcessor(); // Stops VAD processor

        // WebRTC audio track is managed by the PeerConnection, stopping it here isn't needed.
        // Closing the PeerConnection handles track stopping.

        this.stopTimer(); // Stop UI timer
        console.log("Audio capture stopped and cleaned up.");
    }

    /** Stop recording intention and cleanup */
    stop() {
        console.log("stop() called.");
        if (!this.isRecording) return false;
        this.isRecording = false; // Set intention flag

        this._stopAudioCaptureAndProcessing(); // Stop capture mechanisms (MediaRecorder/VAD if active)

        // Clean up WebRTC resources if they exist
        this._cleanupWebRTC();

        // Stop the actual microphone stream
        this._stopMediaStreamTracks();

        // Reset speech detection state (primarily for fallback)
        this.isSpeechActive = false;
        this.speechAudioBuffer = [];
        this.silenceBuffer = [];
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.energyValues = [];
        this.rawAudioBuffer = [];
        this.hasSpeechInCurrentChunk = false;
        this.totalChunkDuration = 0;

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

     /** Clean up WebRTC resources */
     _cleanupWebRTC() {
         console.log("Cleaning up WebRTC resources...");
         // Close Data Channel
         if (this.dataChannel) {
             try {
                 this.dataChannel.close();
             } catch (e) { console.error("Error closing data channel:", e); }
             this.dataChannel.onopen = null;
             this.dataChannel.onclose = null;
             this.dataChannel.onerror = null;
             this.dataChannel.onmessage = null;
             this.dataChannel = null;
         }
         // Close Peer Connection
         if (this.peerConnection) {
             try {
                 this.peerConnection.close();
             } catch (e) { console.error("Error closing peer connection:", e); }
             this.peerConnection.onicecandidate = null;
             this.peerConnection.oniceconnectionstatechange = null;
             this.peerConnection.onconnectionstatechange = null;
             this.peerConnection.ontrack = null;
             this.peerConnection = null;
         }
         this.isWebRTCConnected = false;
         this.ephemeralKey = null; // Clear the key
         console.log("WebRTC resources cleaned up.");
     }

    /** Release all resources */
    release() {
        console.log("release() called.");
        this.stop(); // Handles capture stop, WebRTC/MediaRecorder cleanup
        this._stopMediaStreamTracks(); // Ensure mic access is stopped
        this.useFallbackMode = false; // Reset mode on full release
        this.lastError = null;
        console.log("RealtimeAudioRecorder released.");
    }

    // Timer Methods
    startTimer() { this.stopTimer(); this.timerInterval = setInterval(() => { if (this.onTimerUpdate && this.startTime && this.isCapturing) this.onTimerUpdate(Date.now() - this.startTime); }, 1000); }
    stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }

    // Utility Methods
    isActive() { return this.isRecording || this.isCapturing; }
    isConnected() { return this.isWebRTCConnected; } // Check WebRTC connection status
    isFallbackModeActive() { return this.useFallbackMode; }

    /** Sends transcription data to the server to be saved in Firebase */
    async _saveTranscriptionToServer(transcriptionData) {
        // console.debug("Sending transcription to server:", transcriptionData);
        try {
            const response = await fetch('/save_transcription', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // *** Add this line to send cookies ***
                body: JSON.stringify(transcriptionData)
            });

            if (!response.ok) {
                 // Try to get error details from response body
                 let errorMsg = `Server error ${response.status}`;
                 try {
                     const errorData = await response.json();
                     errorMsg = errorData.error || response.statusText;
                 } catch (e) { /* Ignore if body isn't JSON */ }
                 console.error(`Failed to save transcription to server: ${errorMsg}`);
                 // Decide if this failure warrants switching to fallback? Probably not,
                 // as transcription itself is working, just saving failed. Log it.
            } else {
                // console.debug("Transcription saved to server successfully.");
            }
        } catch (error) {
            console.error("Network error saving transcription to server:", error);
            // Network errors might be more serious, but still likely don't warrant fallback.
        }
    }

    // Removed _floatTo16BitPCM as WebRTC handles encoding via addTrack
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RealtimeAudioRecorder;
}

// Debug Hooks remain unchanged as they target fallback VAD logic
(function() {
    if (typeof RealtimeAudioRecorder === 'undefined') return;
    console.log("Checking for debug tools in RealtimeAudioRecorder...");
    if (RealtimeAudioRecorder.prototype._processSpeechDetection_original_vad) return;
    const originalProcess = RealtimeAudioRecorder.prototype._processSpeechDetection;
    const originalSegment = RealtimeAudioRecorder.prototype._processSpeechSegment; // This might not exist anymore, check needed
    if (typeof originalProcess === 'function') {
        RealtimeAudioRecorder.prototype._processSpeechDetection_original_vad = originalProcess;
        RealtimeAudioRecorder.prototype._processSpeechDetection = function(audioData) {
            return this._processSpeechDetection_original_vad.apply(this, arguments);
        };
    }
    if (typeof originalSegment === 'function') {
        RealtimeAudioRecorder.prototype._processSpeechSegment_original_vad = originalSegment;
        RealtimeAudioRecorder.prototype._processSpeechSegment = function() {
            return this._processSpeechSegment_original_vad.apply(this, arguments);
        };
    }
})();