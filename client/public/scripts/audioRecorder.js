/**
 * WebSocket-based Audio Recorder for OpenAI Realtime Transcription API
 * This class handles capturing audio from the browser and streaming it to
 * the server via WebSocket for transcription.
 */
class WebSocketAudioRecorder {
  /**
   * Create a new WebSocketAudioRecorder
   * @param {string} lectureCode - The lecture code to associate with this recording
   * @param {Object} options - Configuration options
   */
  constructor(lectureCode, options = {}) {
      this.lectureCode = lectureCode;
      this.options = {
          serverUrl: window.location.origin.replace('http', 'ws'),
          sampleRate: 16000, // OpenAI expects audio at 16kHz
          numChannels: 1,     // Mono audio
          bitsPerSample: 16,  // 16-bit PCM
          bufferSize: 4096,   // Audio buffer size for processing
          ...options
      };

      // State variables
      this.ws = null;
      this.mediaStream = null;
      this.audioContext = null;
      this.processor = null;
      this.sourceNode = null; // Keep track of the source node
      this.isRecording = false;       // User intention to record
      this.isCapturing = false;       // Actively capturing/processing audio
      this.isServerReady = false;     // Backend confirmed ready for OpenAI stream
      this.sessionId = null;          // Session ID from backend
      this.startTime = null;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.reconnectDelay = 2000; // 2 seconds

      // Callback handlers
      this.onTranscription = null;
      this.onStatusChange = null;
      this.onTimerUpdate = null;
      this.timerInterval = null;

      console.log("WebSocketAudioRecorder created for lecture:", this.lectureCode);
  }

  /**
   * Initialize the recorder by requesting microphone access.
   * Does NOT connect to WebSocket yet.
   * @returns {Promise<boolean>} - Whether microphone access was granted
   */
  async init() {
      console.log("Initializing microphone access...");
      if (this.mediaStream) {
          console.log("Microphone access already granted.");
          return true; // Already initialized
      }
      try {
          // Request microphone access
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                  channelCount: this.options.numChannels,
                  sampleRate: this.options.sampleRate,
                  // Optional: Add constraints like echo cancellation if needed
                  // echoCancellation: true,
                  // noiseSuppression: true,
              }
          });
          console.log("Microphone access granted.");
          return true;
      } catch (error) {
          console.error('Error initializing recorder (getUserMedia):', error);
          if (this.onStatusChange) {
              this.onStatusChange({
                  connected: false, // Not connected to WS yet, but reflects mic failure
                  recording: false,
                  error: `Microphone access error: ${error.message}`
              });
          }
          // Clean up stream if partially obtained? (getUserMedia usually throws)
          this._stopMediaStreamTracks();
          return false;
      }
  }

  /**
   * Connect to the WebSocket server. Should be called by start() if needed.
   * @returns {Promise<void>} Resolves when connected, rejects on failure.
   */
  connect() {
      // If already connected or connecting, do nothing
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
          console.log(`WebSocket already ${this.ws.readyState === WebSocket.OPEN ? 'open' : 'connecting'}.`);
          // If open and server is ready, maybe start capture if recording intended?
          if (this.ws.readyState === WebSocket.OPEN && this.isServerReady && this.isRecording && !this.isCapturing) {
              this._startAudioCaptureAndProcessing();
          }
          return Promise.resolve(); // Indicate connection is okay or pending
      }

      console.log("Attempting to connect to WebSocket server...");
      this.isServerReady = false; // Reset readiness on new connection attempt

      return new Promise((resolve, reject) => {
          const wsUrl = `${this.options.serverUrl}?lecture_code=${this.lectureCode}`; // Removed /ws path part assuming direct connection
           console.log(`Connecting to: ${wsUrl}`);
          try {
              this.ws = new WebSocket(wsUrl);
          } catch (error) {
              console.error("WebSocket constructor failed:", error);
              reject(error);
              return;
          }


          // Handle connection open
          this.ws.onopen = () => {
              console.log('WebSocket connection established with backend.');
              this.reconnectAttempts = 0; // Reset on successful connection
              // DO NOT set isServerReady here. Wait for the confirmation message.
              // DO NOT start audio capture here. Wait for confirmation + start() intention.
              if (this.onStatusChange) {
                  this.onStatusChange({ connected: true, recording: this.isRecording, status: 'backend_connected' });
              }
              resolve(); // Resolve the promise indicating WS connection to *backend* is open
          };

          // Handle connection error
          this.ws.onerror = (error) => {
              console.error('WebSocket connection error:', error);
              this.isServerReady = false;
              this._stopAudioCaptureAndProcessing(); // Stop capture if it was running
              if (this.onStatusChange) {
                  this.onStatusChange({ connected: false, recording: false, error: 'WebSocket connection error' });
              }
              // Attempt to reconnect or reject
              if (!this._handleReconnect(reject, 'WebSocket error')) {
                  reject(new Error('WebSocket connection failed'));
              }
          };

          // Handle connection close
          this.ws.onclose = (event) => {
              console.log(`WebSocket connection closed: ${event.code} - ${event.reason || 'No reason provided'}`);
              this.isServerReady = false;
              this._stopAudioCaptureAndProcessing(); // Ensure capture stops
              if (this.onStatusChange) {
                  this.onStatusChange({ connected: false, recording: false, status: 'disconnected', code: event.code, reason: event.reason });
              }
              // Attempt to reconnect or handle final closure
              this._handleReconnect(() => { }, 'WebSocket closed'); // Don't reject on normal close/reconnect attempt
          };

          // Handle incoming messages
          this.ws.onmessage = (event) => {
              try {
                  const message = JSON.parse(event.data);
                  console.debug("Received message from backend:", message); // Use debug for potentially noisy messages

                  if (message.type === 'status' && message.status === 'connected') {
                      console.log("Received 'connected' status from backend. Server is ready for audio.");
                      this.isServerReady = true;
                      this.sessionId = message.session_id; // Store session ID
                      // If start() was already called (intention to record is true), start capture now
                      if (this.isRecording && !this.isCapturing) {
                          console.log("Recording intention was set, starting audio capture now.");
                          this._startAudioCaptureAndProcessing();
                      }
                      // Update overall status if callback exists
                      if (this.onStatusChange) {
                          this.onStatusChange({ connected: true, recording: this.isRecording, status: 'server_ready' });
                      }

                  } else if (message.type === 'status' && message.status === 'disconnected') {
                      // Server explicitly indicated disconnection from OpenAI side
                      console.warn("Received 'disconnected' status from backend:", message.reason);
                      this.isServerReady = false;
                      this._stopAudioCaptureAndProcessing();
                       if (this.onStatusChange) {
                          this.onStatusChange({ connected: true, recording: false, status: 'server_disconnected_openai', reason: message.reason });
                      }

                  } else if (message.type === 'transcription') {
                      if (this.onTranscription) {
                          this.onTranscription(message);
                      }
                  } else if (message.type === 'error') {
                      console.error('Error message from server:', message.message);
                      // Potentially stop recording or notify user based on severity
                      // this._stopAudioCaptureAndProcessing(); // Optionally stop on server error
                      if (this.onStatusChange) {
                          this.onStatusChange({ connected: true, recording: this.isCapturing, error: message.message });
                      }
                  } else if (message.type === 'pong') {
                      console.debug('Received pong from server.'); // Keepalive check
                  }
              } catch (error) {
                  console.error('Error parsing message from backend:', error, event.data);
              }
          };
      });
  }

  /**
   * Helper to handle reconnection logic.
   * @param {Function} reject - The reject function of the wrapping Promise.
   * @param {string} reason - Context for logging.
   * @returns {boolean} - True if a reconnect attempt is scheduled, false otherwise.
   */
  _handleReconnect(reject, reason) {
      if (this.isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms due to: ${reason}`);

          setTimeout(() => {
              // Re-check isRecording flag in case stop() was called during the delay
              if (this.isRecording) {
                  console.log("Executing reconnect attempt...");
                  this.connect().catch((err) => { // Try connecting again
                      console.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, err);
                      // If this was the last attempt, reject the original promise
                      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                          reject(new Error('WebSocket reconnection failed after multiple attempts'));
                           if (this.onStatusChange) {
                              this.onStatusChange({ connected: false, recording: false, error: 'Reconnection failed' });
                          }
                      }
                  });
              } else {
                   console.log("Reconnect cancelled because recording was stopped.");
              }
          }, delay);
          return true; // Reconnect attempt scheduled
      } else {
          if (this.isRecording) {
               console.error(`Max reconnection attempts reached (${this.maxReconnectAttempts}). Giving up.`);
               if (this.onStatusChange) {
                  this.onStatusChange({ connected: false, recording: false, error: 'Max reconnection attempts reached' });
               }
          } else {
              console.log("Not attempting reconnect as recording is not active.");
          }
          return false; // No reconnect attempt scheduled
      }
  }


  /**
   * Sets the intention to start recording. Connects WebSocket if needed.
   * Actual audio capture starts once server confirms readiness.
   * @returns {Promise<void>} Resolves when connection attempt is initiated (if needed), rejects on immediate error.
   */
  async start() {
      console.log("start() called.");
      if (this.isRecording) {
          console.warn('Recording is already marked as active.');
          return Promise.resolve();
      }

      // 1. Ensure microphone access is granted
      const micReady = await this.init(); // Ensures mediaStream is available
      if (!micReady) {
           console.error("Microphone initialization failed. Cannot start recording.");
           // onStatusChange likely already called by init()
           return Promise.reject(new Error("Microphone initialization failed"));
      }

      // 2. Set the recording intention flag
      console.log("Setting recording intention flag to true.");
      this.isRecording = true; // User wants to record

      // 3. Initiate WebSocket connection if not already open/connecting
      // connect() handles the logic of checking state and starting capture if server is already ready
      try {
           await this.connect(); // Establish or verify connection
           // Update status to indicate recording has been requested
           if (this.onStatusChange) {
               this.onStatusChange({ connected: this.ws?.readyState === WebSocket.OPEN, recording: true, status: this.isServerReady ? 'server_ready' : 'connecting' });
           }
           console.log("start() completed connection initiation (or verification).");
           return Promise.resolve();
      } catch (error) {
           console.error("Failed to connect WebSocket during start():", error);
           this.isRecording = false; // Reset intention if connection fails immediately
           if (this.onStatusChange) {
               this.onStatusChange({ connected: false, recording: false, error: `WebSocket connection failed: ${error.message}` });
           }
            return Promise.reject(error);
      }
  }


  /**
   * Sets up AudioContext and ScriptProcessor to start capturing and processing audio.
   * Should only be called when WebSocket connection is open AND server is ready.
   * @private Internal method
   */
  _startAudioCaptureAndProcessing() {
      if (this.isCapturing) {
          console.log("Audio capture and processing already active.");
          return; // Already capturing
      }
      if (!this.isRecording) {
           console.log("Not starting audio capture as recording intention is false.");
           return;
      }
      if (!this.isServerReady) {
          console.log("Not starting audio capture as server is not ready.");
          return;
      }
      if (!this.mediaStream) {
           console.error("Cannot start audio capture: MediaStream is not available.");
           return;
      }
       if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
           console.error("Cannot start audio capture: WebSocket is not open.");
           return; // Should not happen if isServerReady is true, but safety check
       }


      console.log("Starting AudioContext and ScriptProcessor...");
      try {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: this.options.sampleRate
          });

          // Prevent issues if context enters suspended state
           if (this.audioContext.state === 'suspended') {
              this.audioContext.resume();
          }

          this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

          this.processor = this.audioContext.createScriptProcessor(
              this.options.bufferSize,
              this.options.numChannels,
              this.options.numChannels
          );

          this.processor.onaudioprocess = (event) => {
              // Double-check flags before processing/sending
              if (!this.isRecording || !this.isCapturing || !this.isServerReady || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                  return;
              }

              const inputData = event.inputBuffer.getChannelData(0);
              const pcmBuffer = this._floatTo16BitPCM(inputData); // Use helper

              // Send binary audio data
              try {
                  this.ws.send(pcmBuffer); // Send ArrayBuffer directly
              } catch (sendError) {
                  console.error("Error sending audio data:", sendError);
                  // Consider stopping or attempting reconnect on send errors
                  this._stopAudioCaptureAndProcessing();
                   if (this.onStatusChange) {
                       this.onStatusChange({ connected: false, recording: false, error: 'Error sending audio data' });
                   }
              }
          };

          this.sourceNode.connect(this.processor);
          this.processor.connect(this.audioContext.destination);

          this.isCapturing = true; // Mark as actively capturing
          this.startTime = Date.now(); // Reset start time for timer
          this.startTimer(); // Start UI timer

          console.log("Audio capture and processing started successfully.");
           // Update status
          if (this.onStatusChange) {
              this.onStatusChange({ connected: true, recording: true, status: 'capturing' });
          }

      } catch (error) {
          console.error('Error starting audio capture/processing:', error);
           this._stopAudioCaptureAndProcessing(); // Attempt cleanup on error
           if (this.onStatusChange) {
              this.onStatusChange({ connected: this.ws?.readyState === WebSocket.OPEN, recording: false, error: `Audio capture error: ${error.message}` });
          }
      }
  }

  /**
  * Stops the audio capture and processing, cleaning up audio nodes and context.
  * @private Internal method
  */
  _stopAudioCaptureAndProcessing() {
      if (!this.isCapturing && !this.audioContext) {
          // console.log("Audio capture not active, nothing to stop.");
          return; // Nothing to stop
      }
      console.log("Stopping audio capture and processing...");
      this.isCapturing = false; // Mark as no longer capturing

      try {
          if (this.processor) {
              this.processor.disconnect(); // Disconnect from destination and source
              this.processor.onaudioprocess = null; // Remove handler
              this.processor = null;
              console.log("ScriptProcessor disconnected.");
          }
          if (this.sourceNode) {
              this.sourceNode.disconnect(); // Disconnect from processor
              this.sourceNode = null;
              console.log("SourceNode disconnected.");
          }
          if (this.audioContext) {
              // Close the context asynchronously
              this.audioContext.close().then(() => {
                  console.log("AudioContext closed.");
                  this.audioContext = null;
              }).catch(err => {
                  console.error("Error closing AudioContext:", err);
                  this.audioContext = null; // Ensure it's nulled even on error
              });
          }
      } catch (error) {
           console.error("Error during audio node cleanup:", error);
           // Ensure state is consistent even if cleanup has errors
           this.processor = null;
           this.sourceNode = null;
           this.audioContext = null;
      } finally {
           this.stopTimer(); // Ensure UI timer stops
           console.log("Audio capture cleanup finished.");
      }
  }


  /**
   * Stops recording intention and cleans up audio processing.
   * Does not necessarily close WebSocket or release microphone.
   * @returns {boolean} - Whether recording was stopped successfully
   */
  stop() {
      console.log("stop() called.");
      if (!this.isRecording) {
          console.warn('Recording is already marked as stopped.');
          return false;
      }

      this.isRecording = false; // Set intention to false

      // Stop the audio capture/processing part
      this._stopAudioCaptureAndProcessing();

      // Update status - Indicate recording stopped, but connection might still be open
      if (this.onStatusChange) {
          this.onStatusChange({ connected: this.ws?.readyState === WebSocket.OPEN, recording: false, status: 'stopped' });
      }
      console.log("Recording intention flag set to false.");
      return true;
  }

  /**
   * Stops microphone tracks. Call this when completely done, e.g., in release().
   * @private Internal method
   */
   _stopMediaStreamTracks() {
       if (this.mediaStream) {
          console.log("Stopping media stream tracks.");
          this.mediaStream.getTracks().forEach(track => track.stop());
          this.mediaStream = null;
      }
   }

  /**
   * Release all resources: stop recording, stop mic, close WebSocket.
   */
  release() {
      console.log("release() called. Cleaning up all resources.");
      // Stop recording intention and audio processing
      this.stop(); // This calls _stopAudioCaptureAndProcessing

      // Stop microphone tracks
      this._stopMediaStreamTracks();

      // Close WebSocket connection
      if (this.ws) {
          if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
              console.log("Closing WebSocket connection.");
              this.ws.close(1000, "Client released resources"); // Normal closure
          }
          // Remove listeners to prevent errors after release
          this.ws.onopen = null;
          this.ws.onmessage = null;
          this.ws.onerror = null;
          this.ws.onclose = null;
          this.ws = null;
      }

      this.isServerReady = false; // Reset server readiness

      console.log("WebSocketAudioRecorder released.");
  }

  // --- Timer Methods ---
  startTimer() { this.stopTimer(); this.timerInterval = setInterval(() => { if (this.onTimerUpdate && this.startTime && this.isCapturing) { this.onTimerUpdate(Date.now() - this.startTime); } }, 1000); }
  stopTimer() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } }

  // --- Utility Methods ---
  isActive() { return this.isRecording || this.isCapturing; } // Reflects user intention or active capture
  isConnected() { return this.ws && this.ws.readyState === WebSocket.OPEN; }
  isServerReadyForAudio() { return this.isServerReady; }

  ping() { if (this.ws && this.ws.readyState === WebSocket.OPEN) { console.debug("Sending ping."); this.ws.send(JSON.stringify({ type: 'ping' })); } }

  // Helper to convert Float32 Array to Int16 ArrayBuffer
  _floatTo16BitPCM(input) {
      const buffer = new ArrayBuffer(input.length * 2); // 2 bytes per Int16
      const view = new DataView(buffer);
      for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // true for little-endian
      }
      return buffer;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketAudioRecorder;
}