// client/public/scripts/app.js
document.addEventListener('DOMContentLoaded', function() {
    // Initialize services
    const firebase = new FirebaseService();
    const audioRecorder = new AudioRecorder();
    
    // Elements - Landing View
    const landingView = document.getElementById('landing-view');
    const lectureView = document.getElementById('lecture-view');
    const generateCodeBtn = document.getElementById('generate-code-btn');
    const joinLectureBtn = document.getElementById('join-lecture-btn');
    const codeDisplayContainer = document.getElementById('code-display-container');
    const lectureCodeDisplay = document.getElementById('lecture-code-display');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const startLectureBtn = document.getElementById('start-lecture-btn');
    
    // Elements - Lecture View
    const lectureInfo = document.getElementById('lecture-info');
    const headerLectureCode = document.getElementById('headerLectureCode');
    const liveIndicator = document.getElementById('liveIndicator');
    const lectureTitle = document.getElementById('lecture-title');
    const lectureDateDisplay = document.getElementById('lecture-date-display');
    const lectureTimeDisplay = document.getElementById('lecture-time-display');
    const lectureInstructor = document.getElementById('lecture-instructor');
    const lectureCode = document.getElementById('lecture-code');
    const recordingControls = document.getElementById('recording-controls');
    const startRecordingBtn = document.getElementById('start-recording-btn');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const recordingTimer = document.getElementById('recording-timer');
    const statusMessage = document.getElementById('status-message');
    const transcriptionContent = document.getElementById('transcription-content');
    const noTranscriptions = document.getElementById('no-transcriptions');
    
    // Elements - Modal
    const modal = document.getElementById('explanation-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalTitle = document.getElementById('modal-title');
    const loadingSpinner = document.getElementById('loading-spinner');
    const explanationText = document.getElementById('explanation-text');
    const errorMessage = document.getElementById('error-message');
    const retryButton = document.getElementById('retry-button');
    const optionButtons = document.querySelectorAll('.option-button');
    
    // Elements - Loading
    const loadingOverlay = document.getElementById('loading-overlay');
    
    // State
    let activeLectureCode = null;
    let isInstructor = false;
    let isRecording = false;
    let transcriptionHistory = [];
    let lastTranscriptionTime = 0;
    let selectedText = '';
    let selectedOption = null;
    let unsubscribeFromTranscriptions = null;
    let lastClickedElement = null;
    
    // Set the default date to today
    document.getElementById('lecture-date').valueAsDate = new Date();
    
    // Format lectures codes as uppercase
    document.getElementById('join-code').addEventListener('input', function() {
      this.value = this.value.toUpperCase();
    });
    
    // Generate Lecture Code
    generateCodeBtn.addEventListener('click', async function() {
      const courseCode = document.getElementById('course-code').value;
      const instructorName = document.getElementById('instructor-name').value;
      const lectureDate = document.getElementById('lecture-date').value;
      const lectureTime = document.getElementById('lecture-time').value;
      
      if (!courseCode || !instructorName || !lectureDate || !lectureTime) {
        showError('create-lecture-error', 'Please fill in all fields');
        return;
      }
      
      showLoading(true);
      
      try {
        const response = await fetch(`${API_URL}/api/generate-lecture-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            course_code: courseCode,
            instructor: instructorName,
            date: lectureDate,
            time: lectureTime,
            user_id: 'anonymous' // In a real app, you'd have user authentication
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          // Display the generated code
          lectureCodeDisplay.textContent = data.lecture_code;
          codeDisplayContainer.style.display = 'block';
          
          // Store the code for later
          activeLectureCode = data.lecture_code;
          isInstructor = true;
        } else {
          showError('create-lecture-error', data.error || 'Error generating lecture code');
        }
      } catch (error) {
        console.error('Error:', error);
        showError('create-lecture-error', 'Network error. Please try again.');
      } finally {
        showLoading(false);
      }
    });
    
    // Copy Lecture Code
    copyCodeBtn.addEventListener('click', function() {
      const code = lectureCodeDisplay.textContent;
      navigator.clipboard.writeText(code)
        .then(() => {
          const originalText = this.textContent;
          this.textContent = 'Copied!';
          setTimeout(() => {
            this.textContent = originalText;
          }, 2000);
        })
        .catch(err => console.error('Could not copy text: ', err));
    });
    
    // Start Lecture (switch to lecture view)
    startLectureBtn.addEventListener('click', function() {
      if (!activeLectureCode) return;
      
      showLectureView();
      
      // Load lecture data
      loadLecture(activeLectureCode, true);
    });
    
    // Join Existing Lecture
    joinLectureBtn.addEventListener('click', async function() {
      const code = document.getElementById('join-code').value.trim().toUpperCase();
      
      if (!code || code.length !== 6) {
        showError('join-lecture-error', 'Please enter a valid 6-character lecture code');
        return;
      }
      
      showLoading(true);
      
      try {
        // Check if lecture exists
        const lecture = await firebase.getLecture(code);
        
        if (!lecture) {
          showError('join-lecture-error', 'Invalid lecture code. Please check and try again.');
          showLoading(false);
          return;
        }
        
        // Switch to lecture view
        activeLectureCode = code;
        isInstructor = false;
        showLectureView();
        
        // Load lecture data
        loadLecture(code, false);
      } catch (error) {
        console.error('Error joining lecture:', error);
        showError('join-lecture-error', 'Error joining lecture. Please try again.');
        showLoading(false);
      }
    });
    
    // Load lecture data and transcriptions
    async function loadLecture(code, showRecordingControls) {
      try {
        // Get lecture data
        const lecture = await firebase.getLecture(code);
        
        if (!lecture || !lecture.metadata) {
          throw new Error('Lecture not found');
        }
        
        // Update UI with lecture info
        updateLectureInfo(lecture.metadata, code);
        
        // Show recording controls if instructor
        if (showRecordingControls) {
          recordingControls.style.display = 'flex';
        } else {
          recordingControls.style.display = 'none';
        }
        
        // Load existing transcriptions
        loadTranscriptions(code);
        
        // Listen for new transcriptions
        if (unsubscribeFromTranscriptions) {
          unsubscribeFromTranscriptions();
        }
        
        unsubscribeFromTranscriptions = firebase.listenForTranscriptions(code, (data) => {
          if (data && data.text) {
            addTranscription(data.text, data.timestamp);
          }
        });
        
        showLoading(false);
      } catch (error) {
        console.error('Error loading lecture:', error);
        showError('lecture-error', 'Error loading lecture data. Please try again.');
        showLoading(false);
      }
    }
    
    // Load existing transcriptions
    async function loadTranscriptions(code) {
      try {
        const transcriptions = await firebase.getTranscriptions(code);
        
        if (transcriptions.length === 0) {
          // No transcriptions yet
          noTranscriptions.textContent = 'No transcriptions available yet. Start recording or wait for the instructor to begin.';
          return;
        }
        
        // Clear existing content
        transcriptionContent.innerHTML = '';
        
        // Add each transcription
        transcriptions.forEach(transcription => {
          addTranscription(transcription.text, transcription.timestamp);
        });
        
        // Update last transcription time
        if (transcriptions.length > 0) {
          lastTranscriptionTime = transcriptions[transcriptions.length - 1].timestamp;
        }
      } catch (error) {
        console.error('Error loading transcriptions:', error);
      }
    }
    
    // Add a transcription to the UI
    function addTranscription(text, timestamp) {
      // Add to history
      transcriptionHistory.push({
        text: text,
        timestamp: timestamp
      });
      
      // Remove placeholder if present
      if (noTranscriptions.parentNode) {
        transcriptionContent.removeChild(noTranscriptions);
      }
      
      // Create message elements
      const messageWrapper = document.createElement('div');
      messageWrapper.className = 'message-wrapper';
      
      const profilePic = document.createElement('div');
      profilePic.className = 'profile-picture';
      profilePic.textContent = 'P'; // First letter of the instructor's name
      
      const messageBubble = document.createElement('div');
      messageBubble.className = 'message-bubble';
      
      const textElement = document.createElement('div');
      textElement.textContent = text;
      
      messageBubble.appendChild(textElement);
      messageWrapper.appendChild(profilePic);
      messageWrapper.appendChild(messageBubble);
      
      // Add click handler for explanations
      messageBubble.addEventListener('click', function() {
        if (lastClickedElement) {
          lastClickedElement.classList.remove('clicked');
        }
        
        this.classList.add('clicked');
        lastClickedElement = this;
        
        // Open modal for explanation
        openExplanationModal(text);
      });
      
      transcriptionContent.appendChild(messageWrapper);
      
      // Auto-scroll to bottom
      transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
      
      // Update last timestamp
      if (timestamp > lastTranscriptionTime) {
        lastTranscriptionTime = timestamp;
      }
    }
    
    // Start Recording
    startRecordingBtn.addEventListener('click', async function() {
      if (!activeLectureCode || isRecording) return;
      
      // Initialize audio recorder if needed
      if (!audioRecorder.stream) {
        const initialized = await audioRecorder.init();
        if (!initialized) {
          statusMessage.textContent = 'Error accessing microphone. Please check permissions.';
          return;
        }
      }
      
      // Configure audio recorder
      audioRecorder.onDataAvailable = async (audioBlob) => {
        await sendAudioForTranscription(audioBlob);
      };
      
      audioRecorder.onTimerUpdate = (elapsed) => {
        updateRecordingTimer(elapsed);
      };
      
      // Start recording
      audioRecorder.start();
      isRecording = true;
      
      // Update UI
      this.disabled = true;
      stopRecordingBtn.disabled = false;
      statusMessage.textContent = 'Recording in progress...';
      liveIndicator.style.display = 'flex';
    });
    
    // Stop Recording
    stopRecordingBtn.addEventListener('click', async function() {
      if (!isRecording) return;
      
      // Stop recording
      const finalAudioBlob = await audioRecorder.stop();
      isRecording = false;
      
      // Send final chunk
      await sendAudioForTranscription(finalAudioBlob);
      
      // Update UI
      this.disabled = true;
      startRecordingBtn.disabled = false;
      statusMessage.textContent = 'Recording stopped';
      liveIndicator.style.display = 'none';
      
      // Reset timer display
      recordingTimer.textContent = '00:00:00';
    });
    
    // Send audio to server for transcription
    async function sendAudioForTranscription(audioBlob) {
      try {
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('lectureCode', activeLectureCode);
        
        const response = await fetch(`${API_URL}/api/transcribe`, {
          method: 'POST',
          body: formData
        });
        
        const result = await response.json();
        
        if (!result.success) {
          console.error('Transcription error:', result.error);
        }
      } catch (error) {
        console.error('Error sending audio for transcription:', error);
      }
    }
    
    // Update recording timer display
    function updateRecordingTimer(elapsed) {
      const hours = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
      const minutes = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
      const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
      
      recordingTimer.textContent = `${hours}:${minutes}:${seconds}`;
    }
    
    // Explanation modal
    function openExplanationModal(text) {
      selectedText = text;
      modal.style.display = 'block';
      
      // Reset UI state
      modalTitle.textContent = 'Select an option';
      loadingSpinner.style.display = 'none';
      explanationText.style.display = 'none';
      explanationText.innerHTML = '';
      errorMessage.style.display = 'none';
      
      optionButtons.forEach(btn => {
        btn.classList.remove('active');
      });
    }
    
    closeModalBtn.addEventListener('click', function() {
      modal.style.display = 'none';
      
      if (lastClickedElement) {
        lastClickedElement.classList.remove('clicked');
        lastClickedElement = null;
      }
    });
    
    // Get explanation
    optionButtons.forEach(button => {
      button.addEventListener('click', function() {
        const option = this.dataset.option;
        selectedOption = option;
        
        // Update UI
        optionButtons.forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
        
        modalTitle.textContent = getOptionTitle(option);
        loadingSpinner.style.display = 'block';
        explanationText.style.display = 'none';
        errorMessage.style.display = 'none';
        
        // Make API call for explanation
        getExplanation(selectedText, option);
      });
    });
    
    async function getExplanation(text, option) {
      try {
        const response = await fetch(`${API_URL}/api/explain`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text, option })
        });
        
        const data = await response.json();
        
        loadingSpinner.style.display = 'none';
        
        if (data.error) {
          showModalError(data.error);
        } else {
          explanationText.style.display = 'block';
          explanationText.innerHTML = marked.parse(data.explanation || 'No explanation available.');
        }
      } catch (error) {
        console.error('Error getting explanation:', error);
        loadingSpinner.style.display = 'none';
        showModalError('Error getting explanation. Please try again.');
      }
    }
    
    function getOptionTitle(option) {
      switch(option) {
        case 'define': return 'Definition';
        case 'explain': return 'Detailed Explanation';
        case 'examples': return 'Real-World Examples';
        case 'simplify': return 'Simplified Explanation';
        default: return 'Explanation';
      }
    }
    
    function showModalError(message) {
      errorMessage.style.display = 'block';
      errorMessage.querySelector('p').textContent = message + ' ';
      errorMessage.querySelector('p').appendChild(retryButton);
    }
    
    // Retry button
    retryButton.addEventListener('click', function() {
      if (selectedOption && selectedText) {
        getExplanation(selectedText, selectedOption);
      }
    });
    
    // Summary buttons
    document.querySelectorAll('.summary-button').forEach(button => {
      button.addEventListener('click', function() {
        const minutes = parseInt(this.dataset.minutes);
        getSummary(minutes);
      });
    });
    
    async function getSummary(minutes) {
      // Filter transcriptions by time
      const cutoffTime = Date.now() - (minutes * 60 * 1000);
      const relevantTranscriptions = transcriptionHistory
        .filter(item => item.timestamp > cutoffTime)
        .map(item => item.text)
        .join(' ');
      
      if (!relevantTranscriptions) {
        alert(`No transcriptions available for the last ${minutes} minute(s)`);
        return;
      }
      
      // Open modal with loading state
      modal.style.display = 'block';
      modalTitle.textContent = `Summary of Last ${minutes} Minute${minutes === 1 ? '' : 's'}`;
      loadingSpinner.style.display = 'block';
      explanationText.style.display = 'none';
      errorMessage.style.display = 'none';
      
      // Hide option buttons for summaries
      document.querySelector('.option-buttons').style.display = 'none';
      
      try {
        const response = await fetch(`${API_URL}/api/summarize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            text: relevantTranscriptions, 
            minutes: minutes 
          })
        });
        
        const data = await response.json();
        
        loadingSpinner.style.display = 'none';
        document.querySelector('.option-buttons').style.display = 'flex';
        
        if (data.error) {
          showModalError(data.error);
        } else {
          explanationText.style.display = 'block';
          explanationText.innerHTML = marked.parse(data.summary || 'No summary available.');
        }
      } catch (error) {
        console.error('Error getting summary:', error);
        loadingSpinner.style.display = 'none';
        document.querySelector('.option-buttons').style.display = 'flex';
        showModalError('Error getting summary. Please try again.');
      }
    }
    
    // Helper functions
    function showLectureView() {
      landingView.style.display = 'none';
      lectureView.style.display = 'block';
      lectureInfo.style.display = 'flex';
    }
    
    function updateLectureInfo(metadata, code) {
      const courseName = metadata.course_code || 'Untitled Lecture';
      
      headerLectureCode.textContent = code;
      lectureTitle.textContent = courseName;
      lectureDateDisplay.textContent = formatDate(metadata.date);
      lectureTimeDisplay.textContent = formatTime(metadata.time);
      lectureInstructor.textContent = metadata.instructor;
      lectureCode.textContent = code;
      
      document.title = `${courseName} - Lecture Assistant`;
    }
    
    function formatDate(dateString) {
      if (!dateString) return 'Date not available';
      
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      try {
        return new Date(dateString).toLocaleDateString(undefined, options);
      } catch (e) {
        return dateString;
      }
    }
  
    function formatTime(timeString) {
      if (!timeString) return 'Time not available';
      
      try {
        // Convert 24-hour format to 12-hour format
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        return `${hour12}:${minutes} ${ampm}`;
      } catch (e) {
        return timeString;
      }
    }
    
    function showError(elementId, message) {
      const errorElement = document.getElementById(elementId);
      errorElement.textContent = message;
      errorElement.style.display = 'block';
      
      // Hide after 5 seconds
      setTimeout(() => {
        errorElement.style.display = 'none';
      }, 5000);
    }
    
    function showLoading(show) {
      loadingOverlay.style.display = show ? 'flex' : 'none';
    }
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      if (unsubscribeFromTranscriptions) {
        unsubscribeFromTranscriptions();
      }
      
      if (audioRecorder.isActive()) {
        audioRecorder.stop();
      }
      
      audioRecorder.release();
    });
  });