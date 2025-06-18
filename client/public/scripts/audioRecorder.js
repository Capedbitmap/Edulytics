// client/public/scripts/audioRecorder.js

/**
 * Handles audio recording for real-time transcription.
 * Handles audio recording for real-time transcription using WebRTC for low-latency streaming to OpenAI Realtime API.
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
        // ─── instructor email ─────────────────────────────────────
// (we’ll pass this in when we instantiate the recorder)
this.instructorEmail = options.instructorEmail || "unknown_email"; console.log("✅ Extracted instructor email:", this.instructorEmail);
this.transcriptLines = []; // will store each chunk

        this.options = {
            // WebRTC specific
            realtimeApiUrl: "https://api.openai.com/v1/realtime",
            realtimeModel: "gpt-4o-transcribe", // Model for WebRTC transcription
            sessionEndpoint: "/session", // Endpoint to get ephemeral key

           sampleRate: 16000,   // Preferred sample rate
           numChannels: 1,      // Mono
           ...options
       };

        // Core State
        this.mediaStream = null;
        this.isRecording = false;      // User's intention to record
        this.isCapturing = false;      // Actively capturing audio (either via WebRTC track or MediaRecorder)
        this.startTime = null;
        this.lastError = null;

        //instructor
        this.videoStream = null;
        this.videoRecorder = null;
        this.videoChunks = [];


        // WebRTC State
        this.peerConnection = null; // RTCPeerConnection instance
        this.dataChannel = null;    // RTCDataChannel instance ('oai-events')
        this.ephemeralKey = null;   // Short-lived API key for WebRTC auth
        this.isWebRTCConnected = false; // Flag indicating successful WebRTC data channel connection

       // UI Callbacks
       this.onTranscription = null;
        this.onStatusChange = null;
        this.onTimerUpdate = null;
        this.timerInterval = null;

       console.log(`RealtimeAudioRecorder created for ${this.lectureCode}.`);
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
            // if (track?.getSettings) console.log("Actual Mic Settings:", track.getSettings()); // Debug log
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
           // Fallback removed - stop recording on critical failure
           console.error("WebRTC connection failed critically. Stopping recording.");
           this.stop();
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
                // console.debug("ICE gathering finished."); // Debug log
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection?.iceConnectionState;
            console.log(`ICE connection state changed: ${state}`);
            if (this.onStatusChange) this.onStatusChange({ status: `ice_${state}` });

           if (['failed', 'disconnected', 'closed'].includes(state)) {
               console.error(`ICE connection state indicates failure (${state}). Stopping recording.`);
               this.stop(); // Stop recording on ICE failure
           }
       };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log(`Peer connection state changed: ${state}`);
             if (this.onStatusChange) this.onStatusChange({ status: `peer_${state}` });

           if (['failed', 'disconnected', 'closed'].includes(state)) {
               console.error(`Peer connection state indicates failure (${state}). Stopping recording.`);
               this.stop(); // Stop recording on PeerConnection failure
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
           console.warn("Data channel closed unexpectedly. Stopping recording.");
           this.stop(); // Stop recording if data channel closes unexpectedly
           if (this.onStatusChange) this.onStatusChange({ connected: false, recording: this.isRecording, status: 'webrtc_closed' });
       };

        this.dataChannel.onerror = (event) => {
           console.error("WebRTC Data Channel error:", event.error);
           this.lastError = `Data channel error: ${event.error?.message || 'Unknown error'}`;
           console.error("Data channel error occurred. Stopping recording.");
           this.stop(); // Stop recording on data channel error
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
                   console.error("OpenAI reported an error via WebRTC. Stopping recording.");
                   this.stop(); // Stop recording if OpenAI reports an error
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
                    language: "en",
                    prompt: "Transcribe the audio in English only. Do not transcribe profanity or any words from languages other than English. The context is a university lecture." // Added prompt
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
           console.error("Failed to send WebRTC config. Stopping recording.");
           this.stop(); // Stop recording if config send fails
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
       await this._startVideoCapture();
       this.lastError = null;

       // Attempt WebRTC connection
       await this.connectWebRTC();

       // If connectWebRTC failed, it will call stop() internally.
       // If connectWebRTC succeeded, the data channel 'open' event will set isCapturing and start timer.
       // If connectWebRTC is still pending, we wait.

       // Update status based on current state after connection attempt
       if (this.isWebRTCConnected) {
            if (this.onStatusChange) this.onStatusChange({ status: 'webrtc_connected' });
       } else if (this.peerConnection) {
            if (this.onStatusChange) this.onStatusChange({ status: 'connecting_webrtc' });
       }

       return Promise.resolve();
   }

   /** Start audio capture: WebRTC capture starts implicitly when the track is added and connection established. */
   _startAudioCaptureAndProcessing() {
       if (this.isCapturing) return;
       if (!this.isRecording || !this.mediaStream) return;

       // WebRTC capture starts implicitly when the track is added and connection established.
       console.log("WebRTC mode: Audio capture managed by PeerConnection track.");
   }
   async _startVideoCapture() {
    try {
        this.videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.videoRecorder = new MediaRecorder(this.videoStream);
        this.videoChunks = [];

        this.videoRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.videoChunks.push(e.data);
        };

        this.videoRecorder.onstop = async () => {
            const videoBlob = new Blob(this.videoChunks, { type: 'video/mp4' });
        
            if (videoBlob.size > 1) {
                const fileName = `video.mp4`;
                const path = `instructorData/${this.instructorEmail}/${this.lectureCode}/${fileName}`;
                const videoRef = videoStorage.ref().child(path);
        
                await videoRef.put(videoBlob);
                console.log("✅ Video uploaded to Firebase Storage at:", path);
            } else {
                console.log("Video not uploaded: size less than 1 byte.");
            }
        };
        

        this.videoRecorder.start();
        console.log("🎥 Video recording started.");
    } catch (err) {
        console.error("Video capture failed:", err);
    }
}


   /** Stop audio capture (generalized). */
   _stopAudioCaptureAndProcessing() {
       if (!this.isCapturing) return;
       console.log("Stopping audio capture...");
       this.isCapturing = false;

       // WebRTC audio track is managed by the PeerConnection, stopping it here isn't needed.
       // Closing the PeerConnection handles track stopping.

       this.stopTimer(); // Stop UI timer
       console.log("Audio capture stopped.");
   }


   async _stopVideoCapture() {
    // ✅ Step 1: Stop camera immediately
    if (this.videoStream) {
        this.videoStream.getTracks().forEach(track => track.stop());
        this.videoStream = null;
        console.log("🎥 Camera stream stopped immediately.");
    }

    // ✅ Step 2: Then stop the recorder and wait for onstop
    if (this.videoRecorder && this.videoRecorder.state !== "inactive") {
        return new Promise((resolve) => {
            this.videoRecorder.onstop = async () => {
                const videoBlob = new Blob(this.videoChunks, { type: 'video/mp4' });

                // ✅ Step 3: Save if bigger than 1 byte
                if (videoBlob.size > 1) {
                    const path = `instructorData/${this.instructorEmail}/${this.lectureCode}/video.mp4`;
                    const videoRef = videoStorage.ref().child(path);

                    await videoRef.put(videoBlob);
                    
                    console.log("✅ Video uploaded to Firebase Storage.");
                } else {
                    console.log("⚠️ Video not uploaded: size less than 1 byte.");
                }

                resolve();
            };

            this.videoRecorder.stop(); // Triggers the upload logic above
        });
    }

    console.log("🎥 Video capture stopped.");
}




   /** Stop recording intention and cleanup */
   async stop() {
        console.log("stop() called.");
        if (!this.isRecording) return false;
        this.isRecording = false; // Set intention flag

        this._stopAudioCaptureAndProcessing(); // Stop capture mechanisms (MediaRecorder/VAD if active)
        await this._stopVideoCapture();

        // Clean up WebRTC resources if they exist
        this._cleanupWebRTC();

        // Stop the actual microphone stream
        this._stopMediaStreamTracks();

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
       this.stop(); // Handles capture stop, WebRTC cleanup
       this._stopMediaStreamTracks(); // Ensure mic access is stopped
       this.lastError = null;
       console.log("RealtimeAudioRecorder released.");
    }

    // Timer Methods
    startTimer() { this.stopTimer(); this.timerInterval = setInterval(() => { if (this.onTimerUpdate && this.startTime && this.isCapturing) this.onTimerUpdate(Date.now() - this.startTime); }, 1000); }
    stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }

    // Utility Methods
   isActive() { return this.isRecording || this.isCapturing; }
   isConnected() { return this.isWebRTCConnected; } // Check WebRTC connection status

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