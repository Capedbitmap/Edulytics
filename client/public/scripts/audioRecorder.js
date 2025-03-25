// client/public/scripts/audioRecorder.js
class AudioRecorder {
    constructor(options = {}) {
      this.options = {
        timeSlice: 10000, // Default chunk size (10 seconds)
        mimeType: 'audio/webm',
        audioBitsPerSecond: 128000,
        ...options
      };
      
      this.mediaRecorder = null;
      this.audioChunks = [];
      this.stream = null;
      this.isRecording = false;
      this.startTime = null;
      this.onDataAvailable = null;
      this.timerInterval = null;
      this.onTimerUpdate = null;
    }
    
    async init() {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        return true;
      } catch (error) {
        console.error('Error accessing microphone:', error);
        return false;
      }
    }
    
    start() {
      if (!this.stream) {
        throw new Error('Recorder not initialized. Call init() first.');
      }
      
      this.audioChunks = [];
      this.isRecording = true;
      this.startTime = Date.now();
      
      const options = {
        mimeType: this.options.mimeType,
        audioBitsPerSecond: this.options.audioBitsPerSecond
      };
      
      try {
        this.mediaRecorder = new MediaRecorder(this.stream, options);
      } catch (error) {
        console.error('MediaRecorder error:', error);
        // Try with default options
        this.mediaRecorder = new MediaRecorder(this.stream);
      }
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          
          // If we have a callback and enough data, call it
          if (this.onDataAvailable && event.data.size > 1000) {
            const audioBlob = new Blob([event.data], { type: this.options.mimeType });
            this.onDataAvailable(audioBlob);
          }
        }
      };
      
      this.mediaRecorder.start(this.options.timeSlice);
      
      // Start timer
      this.startTimer();
      
      return true;
    }
    
    stop() {
      if (!this.isRecording || !this.mediaRecorder) {
        return false;
      }
      
      return new Promise((resolve) => {
        this.mediaRecorder.onstop = () => {
          this.isRecording = false;
          this.stopTimer();
          
          // Combine all audio chunks
          const audioBlob = new Blob(this.audioChunks, { type: this.options.mimeType });
          resolve(audioBlob);
        };
        
        this.mediaRecorder.stop();
      });
    }
    
    startTimer() {
      this.stopTimer(); // Clear any existing timer
      
      this.timerInterval = setInterval(() => {
        if (this.onTimerUpdate) {
          const elapsed = Date.now() - this.startTime;
          this.onTimerUpdate(elapsed);
        }
      }, 1000);
    }
    
    stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }
    
    release() {
      this.stopTimer();
      
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      
      this.mediaRecorder = null;
      this.isRecording = false;
    }
    
    isActive() {
      return this.isRecording;
    }
  }