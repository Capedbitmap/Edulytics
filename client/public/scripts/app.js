// client/public/scripts/app.js

document.addEventListener('DOMContentLoaded', function() {
  // --- Global Initializations ---
  const firebase = new FirebaseService(); // Assuming FirebaseService is defined elsewhere or globally
  let audioRecorder = null; // Specific to lecture page?

  // --- Global UI Elements & Logic ---
  const themeToggle = document.getElementById('theme-toggle');
  const userMenu = document.getElementById('userMenu');
  const dropdownMenu = document.getElementById('dropdownMenu');
  const logoutLink = document.getElementById('logout-link');
  const loadingOverlay = document.getElementById('loading-overlay');

  // Theme Toggle Logic
  const currentTheme = localStorage.getItem('theme');
  if (currentTheme === 'dark') {
      document.body.classList.add('dark-theme');
  }
  themeToggle?.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      let theme = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
      localStorage.setItem('theme', theme);
  });

  // User Dropdown Menu Logic
  userMenu?.addEventListener('click', function(event) {
      // Prevent closing if click is inside dropdown
      event.stopPropagation();
      dropdownMenu?.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function(event) {
      if (dropdownMenu?.classList.contains('show') && !userMenu?.contains(event.target)) {
          dropdownMenu.classList.remove('show');
      }
  });

  // Logout Link Logic
  logoutLink?.addEventListener('click', (e) => {
      e.preventDefault();
      console.log("Logout initiated via app.js...");
      showLoading(true); // Show loading overlay

      // Use Firebase Authentication to sign out
      firebase.auth().signOut().then(() => {
          console.log("Firebase sign-out successful.");
          // Clear any local storage related to the session if necessary (optional)
          // localStorage.removeItem('userToken'); // Example if using local storage

          // Determine redirect URL based on current page or user type (simple version: redirect to home)
          // More robust: check if on instructor page -> instructor login, else student login/home
          // For now, let's redirect based on a simple check or default to home/student login
          if (window.location.pathname.startsWith('/instructor')) {
               window.location.href = '/instructor_login.html'; // Or instructor login page
          } else {
               window.location.href = '/student_login.html'; // Default to student login
          }

      }).catch((error) => {
          console.error('Firebase Logout Error:', error);
          // Display error to the user (consider a more central error display)
          alert(`Logout failed: ${error.message}`); // Simple alert for now
          showLoading(false); // Hide loading overlay on error
      });
  });

  // --- Global Function to Update User Info in Header ---
  async function updateUserHeaderInfo() {
      const userNameEl = document.getElementById('userName');
      const userInitialEl = document.getElementById('userInitial');

      // Only proceed if the elements exist
      if (!userNameEl || !userInitialEl) {
          // console.log("User header elements not found on this page.");
          return;
      }

      try {
          // Use a generic endpoint if possible, or adapt based on user type later
          // Using /get_student_info for now as an example
          const response = await fetch('/get_student_info', { // TODO: Ensure this endpoint works for instructors too or create a generic one
              credentials: 'same-origin'
          });

          if (!response.ok) {
              // Don't redirect here, just log error or show placeholder
              console.error('Failed to load user header info, status:', response.status);
              userNameEl.textContent = 'User'; // Default placeholder
              userInitialEl.textContent = '?';
              return;
          }

          const data = await response.json();

          // Update header elements
          userNameEl.textContent = data.name || 'User';
          if (data.name && data.name.length > 0) {
              userInitialEl.textContent = data.name.charAt(0).toUpperCase();
          } else {
              userInitialEl.textContent = '?'; // Default
          }

      } catch (error) {
          console.error('Error loading user header info:', error);
          userNameEl.textContent = 'Error'; // Indicate error
          userInitialEl.textContent = '!';
      }
  }

  // Call the function to update header info on page load
  updateUserHeaderInfo();

  // --- Page Specific Elements & Logic ---
  // (Keep existing page-specific logic below, ensuring no conflicts)

  // Elements - Landing View (Example - keep if needed)
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
  
  // Elements - Loading (Already declared globally at the top)
  // const loadingOverlay = document.getElementById('loading-overlay');
  
  // State
  let activeLectureCode = null;
  let isInstructor = false;
  let isRecording = false;
  let transcriptionHistory = [];
  let lastTranscriptionTime = 0;
  let selectedText = '';
  let selectedOption = null;
  let recordingStartTime = null;
  let recordingTimerInterval = null;
  let partialTranscription = null;
  let lastClickedElement = null;
  
  // Set the default date to today
  const dateInput = document.getElementById('lecture-date');
  if (dateInput) {
    dateInput.valueAsDate = new Date();
  }
  
  // Format lectures codes as uppercase
  const joinCodeInput = document.getElementById('join-code');
  if (joinCodeInput) {
    joinCodeInput.addEventListener('input', function() {
      this.value = this.value.toUpperCase();
    });
  }
  
  /* If both app.js and instructor.js are loaded on instructor.html, and both contain
   code like generateCodeBtn.addEventListener('click', ...), then two listeners get attached 
   to the same button. When you click the button, both listeners fire, causing the fetch request
   to /generate_lecture_code to be sent twice, leading to the double lecture creation and the frontend getting confused
  // Generate Lecture Code
  if (generateCodeBtn) {
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
        const response = await fetch('/generate_lecture_code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            course_code: courseCode,
            instructor: instructorName,
            date: lectureDate,
            time: lectureTime,
            set_active: true
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
  } */
  
  // Copy Lecture Code
  if (copyCodeBtn) {
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
  }
  
  // Start Lecture (switch to lecture view)
  if (startLectureBtn) {
    startLectureBtn.addEventListener('click', function() {
      if (!activeLectureCode) return;
      
      showLectureView();
      
      // Load lecture data
      loadLecture(activeLectureCode, true);
    });
  }
  
  // Join Existing Lecture
  if (joinLectureBtn) {
    joinLectureBtn.addEventListener('click', async function() {
      const code = joinCodeInput.value.trim().toUpperCase();
      
      if (!code || code.length !== 6) {
        showError('join-lecture-error', 'Please enter a valid 6-character lecture code');
        return;
      }
      
      showLoading(true);
      
      try {
        // Check if lecture exists
        const response = await fetch('/join_lecture', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lecture_code: code
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          // Switch to lecture view
          activeLectureCode = code;
          isInstructor = false;
          showLectureView();
          
          // Load lecture data
          loadLecture(code, false);
        } else {
          showError('join-lecture-error', data.error || 'Invalid lecture code');
          showLoading(false);
        }
      } catch (error) {
        console.error('Error joining lecture:', error);
        showError('join-lecture-error', 'Error joining lecture. Please try again.');
        showLoading(false);
      }
    });
  }
  
  // Load lecture data and transcriptions
  async function loadLecture(code, showRecordingControls) {
    try {
      // Get lecture data
      const response = await fetch(`/join_lecture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lecture_code: code
        })
      });
      
      const lectureData = await response.json();
      
      if (!lectureData.success || !lectureData.metadata) {
        throw new Error('Lecture not found');
      }
      
      // Update UI with lecture info
      updateLectureInfo(lectureData.metadata, code);
      
      // Show recording controls if instructor
      if (showRecordingControls && recordingControls) {
        recordingControls.style.display = 'flex';
      } else if (recordingControls) {
        recordingControls.style.display = 'none';
      }
      
      // Load existing transcriptions
      loadTranscriptions(code);
      
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
      const response = await fetch(`/get_lecture_transcriptions?lecture_code=${code}`);
      const data = await response.json();
      
      if (!data.transcriptions || data.transcriptions.length === 0) {
        // No transcriptions yet
        if (noTranscriptions) {
          noTranscriptions.textContent = 'No transcriptions available yet. Start recording or wait for the instructor to begin.';
        }
        return;
      }
      
      // Clear existing content
      if (transcriptionContent) {
        transcriptionContent.innerHTML = '';
      }
      
      // Add each transcription
      data.transcriptions.forEach(transcription => {
        addTranscription(transcription.text, transcription.timestamp);
      });
      
      // Update last transcription time
      if (data.transcriptions.length > 0) {
        lastTranscriptionTime = data.transcriptions[data.transcriptions.length - 1].timestamp;
      }
    } catch (error) {
      console.error('Error loading transcriptions:', error);
    }
  }
  
  // Initialize the audio recorder
  async function initializeRecorder(lectureCode) {
    try {
      // Create new audio recorder
      audioRecorder = new WebSocketAudioRecorder(lectureCode);
      
      // Set up event handlers
      audioRecorder.onTranscription = (data) => {
        // Add transcription to UI
        if (data.text && data.text.trim().length > 0) {
          // This is a completed transcription
          addTranscription(data.text, data.timestamp);
        }
      };
      
      audioRecorder.onStatusChange = (status) => {
        // Update UI based on connection status
        if (status.connected) {
          statusMessage.textContent = 'Connected to transcription service';
        } else if (status.error) {
          statusMessage.textContent = `Error: ${status.error}`;
        } else {
          statusMessage.textContent = 'Disconnected from transcription service';
        }
      };
      
      audioRecorder.onTimerUpdate = (elapsed) => {
        // Update recording timer
        updateRecordingTimer(elapsed);
      };
      
      // Initialize the recorder
      const initialized = await audioRecorder.init();
      return initialized;
      
    } catch (error) {
      console.error('Error initializing recorder:', error);
      return false;
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
    if (noTranscriptions && noTranscriptions.parentNode) {
      transcriptionContent.removeChild(noTranscriptions);
    }
    
    // Create message elements
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper';
    
    const profilePic = document.createElement('div');
    profilePic.className = 'profile-picture';
    
    // Use first letter of instructor's name if available
    let instructorInitial = 'L'; // Default to 'L' for Lecturer
    if (lectureInstructor && lectureInstructor.textContent) {
      const name = lectureInstructor.textContent.trim();
      if (name && name.length > 0) {
        instructorInitial = name.charAt(0).toUpperCase();
      }
    }
    profilePic.textContent = instructorInitial;
    
    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';
    
    const textElement = document.createElement('div');
    textElement.className = 'transcription-text';
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
  
  // Update partial transcription
  function updatePartialTranscription(text) {
    // If no partial transcription exists yet, create one
    if (!partialTranscription) {
      partialTranscription = document.createElement('div');
      partialTranscription.className = 'message-wrapper partial';
      
      const profilePic = document.createElement('div');
      profilePic.className = 'profile-picture';
      profilePic.textContent = 'L';
      
      const messageBubble = document.createElement('div');
      messageBubble.className = 'message-bubble partial';
      
      const textElement = document.createElement('div');
      textElement.className = 'transcription-text';
      messageBubble.appendChild(textElement);
      
      partialTranscription.appendChild(profilePic);
      partialTranscription.appendChild(messageBubble);
      transcriptionContent.appendChild(partialTranscription);
    }
    
    // Update the text
    const textElement = partialTranscription.querySelector('.transcription-text');
    textElement.textContent = text;
    
    // Auto-scroll to bottom
    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
  }
  
  // Start Recording
  if (startRecordingBtn) {
    startRecordingBtn.addEventListener('click', async function() {
      if (!activeLectureCode || isRecording) return;
      
      // Initialize the recorder if needed
      if (!audioRecorder) {
        const initialized = await initializeRecorder(activeLectureCode);
        if (!initialized) {
          statusMessage.textContent = 'Error accessing microphone. Please check permissions.';
          return;
        }
      }
      
      // Start recording
      try {
        audioRecorder.start();
        isRecording = true;
        
        // Update UI
        this.disabled = true;
        stopRecordingBtn.disabled = false;
        statusMessage.textContent = 'Recording in progress...';
        if (liveIndicator) {
          liveIndicator.style.display = 'flex';
        }
        
        // Start recording timer
        recordingStartTime = Date.now();
      } catch (error) {
        console.error('Error starting recording:', error);
        statusMessage.textContent = `Error: ${error.message}`;
      }
    });
  }
  
  // Stop Recording
  if (stopRecordingBtn) {
    stopRecordingBtn.addEventListener('click', function() {
      if (!isRecording || !audioRecorder) return;
      
      // Stop recording
      audioRecorder.stop();
      isRecording = false;
      
      // Update UI
      this.disabled = true;
      startRecordingBtn.disabled = false;
      statusMessage.textContent = 'Recording stopped';
      if (liveIndicator) {
        liveIndicator.style.display = 'none';
      }
      
      // Clear partial transcription if any
      if (partialTranscription && partialTranscription.parentNode) {
        transcriptionContent.removeChild(partialTranscription);
        partialTranscription = null;
      }
    });
  }
  
  // Update recording timer display
  function updateRecordingTimer(elapsed) {
    if (!recordingTimer) return;
    
    const hours = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
    const minutes = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
    const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
    
    recordingTimer.textContent = `${hours}:${minutes}:${seconds}`;
  }
  
  // Explanation modal
  function openExplanationModal(text) {
    if (!modal) return;
    
    selectedText = text;
    modal.style.display = 'block';
    
    // Reset UI state
    if (modalTitle) modalTitle.textContent = 'Select an option';
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    if (explanationText) {
      explanationText.style.display = 'none';
      explanationText.innerHTML = '';
    }
    if (errorMessage) errorMessage.style.display = 'none';
    
    if (optionButtons) {
      optionButtons.forEach(btn => {
        btn.classList.remove('active');
      });
    }
  }
  
  // Close modal
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', function() {
      if (!modal) return;
      
      modal.style.display = 'none';
      
      if (lastClickedElement) {
        lastClickedElement.classList.remove('clicked');
        lastClickedElement = null;
      }
    });
  }
  
  // Get explanation
  if (optionButtons) {
    optionButtons.forEach(button => {
      button.addEventListener('click', function() {
        const option = this.dataset.option;
        selectedOption = option;
        
        // Update UI
        optionButtons.forEach(btn => btn.classList.remove('active'));
        this.classList.add('active');
        
        if (modalTitle) modalTitle.textContent = getOptionTitle(option);
        if (loadingSpinner) loadingSpinner.style.display = 'block';
        if (explanationText) explanationText.style.display = 'none';
        if (errorMessage) errorMessage.style.display = 'none';
        
        // Make API call for explanation
        getExplanation(selectedText, option);
      });
    });
  }
  
  // Get explanation from API
  async function getExplanation(text, option) {
    try {
      const response = await fetch('/get_explanation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, option })
      });
      
      const data = await response.json();
      
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      
      if (data.error) {
        showModalError(data.error);
      } else if (explanationText) {
        explanationText.style.display = 'block';
        // Use marked if available, otherwise raw HTML
        if (typeof marked !== 'undefined') {
          explanationText.innerHTML = marked.parse(data.explanation || 'No explanation available.');
        } else {
          explanationText.innerHTML = data.explanation || 'No explanation available.';
        }
      }
    } catch (error) {
      console.error('Error getting explanation:', error);
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      showModalError('Error getting explanation. Please try again.');
    }
  }
  
  // Get option title
  function getOptionTitle(option) {
    switch(option) {
      case 'define': return 'Definition';
      case 'explain': return 'Detailed Explanation';
      case 'examples': return 'Real-World Examples';
      case 'simplify': return 'Simplified Explanation';
      default: return 'Explanation';
    }
  }
  
  // Show modal error
  function showModalError(message) {
    if (!errorMessage) return;
    
    errorMessage.style.display = 'block';
    const p = errorMessage.querySelector('p');
    if (p) {
      p.textContent = message + ' ';
      if (retryButton) p.appendChild(retryButton);
    }
  }
  
  // Retry button
  if (retryButton) {
    retryButton.addEventListener('click', function() {
      if (selectedOption && selectedText) {
        getExplanation(selectedText, selectedOption);
      }
    });
  }
  
  // Summary buttons
  const summaryButtons = document.querySelectorAll('.summary-button');
  if (summaryButtons) {
    summaryButtons.forEach(button => {
      button.addEventListener('click', function() {
        const minutes = parseInt(this.dataset.minutes);
        getSummary(minutes);
      });
    });
  }
  
  // Get summary from API
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
    if (modal) modal.style.display = 'block';
    if (modalTitle) modalTitle.textContent = `Summary of Last ${minutes} Minute${minutes === 1 ? '' : 's'}`;
    if (loadingSpinner) loadingSpinner.style.display = 'block';
    if (explanationText) explanationText.style.display = 'none';
    if (errorMessage) errorMessage.style.display = 'none';
    
    // Hide option buttons for summaries
    const optionButtonsContainer = document.querySelector('.option-buttons');
    if (optionButtonsContainer) optionButtonsContainer.style.display = 'none';
    
    try {
      const response = await fetch('/get_summary', {
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
      
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      if (optionButtonsContainer) optionButtonsContainer.style.display = 'flex';
      
      if (data.error) {
        showModalError(data.error);
      } else if (explanationText) {
        explanationText.style.display = 'block';
        // Use marked if available, otherwise raw HTML
        if (typeof marked !== 'undefined') {
          explanationText.innerHTML = marked.parse(data.summary || 'No summary available.');
        } else {
          explanationText.innerHTML = data.summary || 'No summary available.';
        }
      }
    } catch (error) {
      console.error('Error getting summary:', error);
      if (loadingSpinner) loadingSpinner.style.display = 'none';
      if (optionButtonsContainer) optionButtonsContainer.style.display = 'flex';
      showModalError('Error getting summary. Please try again.');
    }
  }
  
  // Helper functions
  function showLectureView() {
    if (landingView) landingView.style.display = 'none';
    if (lectureView) lectureView.style.display = 'block';
    if (lectureInfo) lectureInfo.style.display = 'flex';
  }
  
  function updateLectureInfo(metadata, code) {
    const courseName = metadata.course_code || 'Untitled Lecture';
    
    if (headerLectureCode) headerLectureCode.textContent = code;
    if (lectureTitle) lectureTitle.textContent = courseName;
    if (lectureDateDisplay) lectureDateDisplay.textContent = formatDate(metadata.date);
    if (lectureTimeDisplay) lectureTimeDisplay.textContent = formatTime(metadata.time);
    if (lectureInstructor) lectureInstructor.textContent = metadata.instructor;
    if (lectureCode) lectureCode.textContent = code;
    
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
    if (!errorElement) return;
    
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 5000);
  }
  
  // Global showLoading function (ensure it's defined only once)
  function showLoading(show) {
    if (loadingOverlay) {
      loadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }
  
  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (audioRecorder) {
      audioRecorder.release();
    }
  });
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', function(event) {
    // Escape key closes modal
    if (event.key === 'Escape' && modal && modal.style.display === 'block') {
      closeModalBtn.click();
    }
  });
});