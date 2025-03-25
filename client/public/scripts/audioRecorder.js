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
      ...options
    };
    
    // State variables
    this.ws = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.isRecording = false;
    this.startTime = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000; // 2 seconds
    
    // Callback handlers
    this.onTranscription = null;
    this.onStatusChange = null;
    this.onTimerUpdate = null;
    this.timerInterval = null;
  }
  
  /**
   * Initialize the recorder by requesting microphone access and setting up WebSocket
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async init() {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: this.options.numChannels,
          sampleRate: this.options.sampleRate
        }
      });
      
      // Connect to WebSocket server
      await this.connectToServer();
      
      return true;
    } catch (error) {
      console.error('Error initializing recorder:', error);
      if (this.onStatusChange) {
        this.onStatusChange({
          connected: false,
          error: error.message
        });
      }
      return false;
    }
  }
  
  /**
   * Connect to the WebSocket server
   * @returns {Promise<void>}
   */
  async connectToServer() {
    return new Promise((resolve, reject) => {
      // Create WebSocket connection to our server
      const wsUrl = `${this.options.serverUrl}/ws?lecture_code=${this.lectureCode}`;
      this.ws = new WebSocket(wsUrl);
      
      // Handle connection open
      this.ws.onopen = () => {
        console.log('WebSocket connection established');
        this.reconnectAttempts = 0;
        
        if (this.onStatusChange) {
          this.onStatusChange({
            connected: true,
            status: 'connected'
          });
        }
        resolve();
      };
      
      // Handle connection error
      this.ws.onerror = (error) => {
        console.error('WebSocket connection error:', error);
        
        if (this.onStatusChange) {
          this.onStatusChange({
            connected: false,
            error: 'Connection error'
          });
        }
        
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection failed'));
        }
      };
      
      // Handle connection close
      this.ws.onclose = (event) => {
        console.log(`WebSocket connection closed: ${event.code} - ${event.reason}`);
        
        if (this.onStatusChange) {
          this.onStatusChange({
            connected: false,
            status: 'disconnected',
            code: event.code,
            reason: event.reason
          });
        }
        
        // Attempt to reconnect if still recording
        if (this.isRecording && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          
          setTimeout(() => {
            this.connectToServer().catch(() => {
              console.error('Reconnection failed');
            });
          }, this.reconnectDelay * this.reconnectAttempts);
        }
      };
      
      // Handle incoming messages
      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'transcription') {
            // Handle transcription events
            if (this.onTranscription) {
              this.onTranscription(message);
            }
          } else if (message.type === 'status') {
            // Handle status updates
            if (this.onStatusChange) {
              this.onStatusChange(message);
            }
          } else if (message.type === 'error') {
            console.error('Error from server:', message.message);
            if (this.onStatusChange) {
              this.onStatusChange({
                connected: true,
                error: message.message
              });
            }
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      };
    });
  }
  
  /**
   * Start recording audio and sending it to the server
   * @returns {boolean} - Whether recording was started successfully
   */
  start() {
    if (!this.mediaStream || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Recorder not initialized or WebSocket not connected');
    }
    
    if (this.isRecording) {
      return false;
    }
    
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.options.sampleRate
      });
      
      // Create source node
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create script processor node for raw PCM access
      // Note: This is deprecated but still widely supported
      // An alternative would be to use AudioWorklet, but it's more complex
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(
        bufferSize, 
        this.options.numChannels, 
        this.options.numChannels
      );
      
      // Process audio data
      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        
        // Get the raw audio data
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Convert to 16-bit PCM
        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Float32 to Int16 conversion
          pcmBuffer[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        
        // Send audio data to server
        this.ws.send(pcmBuffer.buffer);
      };
      
      // Connect the nodes
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      // Mark as recording
      this.isRecording = true;
      this.startTime = Date.now();
      
      // Start timer updates
      this.startTimer();
      
      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }
  
  /**
   * Stop recording audio
   * @returns {boolean} - Whether recording was stopped successfully
   */
  stop() {
    if (!this.isRecording) {
      return false;
    }
    
    try {
      // Stop recording
      this.isRecording = false;
      
      // Disconnect and clean up audio nodes
      if (this.processor) {
        this.processor.disconnect();
        this.processor = null;
      }
      
      if (this.audioContext) {
        this.audioContext.close().catch(console.error);
        this.audioContext = null;
      }
      
      // Stop timer
      this.stopTimer();
      
      return true;
    } catch (error) {
      console.error('Error stopping recording:', error);
      return false;
    }
  }
  
  /**
   * Release all resources and close connections
   */
  release() {
    // Stop recording if active
    if (this.isRecording) {
      this.stop();
    }
    
    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    // Close WebSocket connection
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || 
          this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    // Stop timer if running
    this.stopTimer();
  }
  
  /**
   * Start timer for recording duration updates
   */
  startTimer() {
    this.stopTimer(); // Clear any existing timer
    
    this.timerInterval = setInterval(() => {
      if (this.onTimerUpdate && this.startTime) {
        const elapsed = Date.now() - this.startTime;
        this.onTimerUpdate(elapsed);
      }
    }, 1000);
  }
  
  /**
   * Stop timer for recording duration updates
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
  
  /**
   * Check if currently recording
   * @returns {boolean} - Whether currently recording
   */
  isActive() {
    return this.isRecording;
  }
  
  /**
   * Send ping to server to keep connection alive
   */
  ping() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketAudioRecorder;
}