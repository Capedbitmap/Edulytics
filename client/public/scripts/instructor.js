document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const generateCodeBtn = document.getElementById('generate-code-btn');
    const codeDisplayContainer = document.getElementById('code-display-container');
    const lectureCodeDisplay = document.getElementById('lecture-code-display');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const startLectureBtn = document.getElementById('start-lecture-btn');
    const loadingOverlay = document.getElementById('loading-overlay');
    const startRecordingBtn = document.getElementById('start-recording-btn');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const recordingTimer = document.getElementById('recording-timer');
    const statusMessage = document.getElementById('status-message');
    
    // State
    let activeLectureCode = null;
    let isRecording = false;
    let audioRecorder = null;
    let recordingStartTime = null;
    let recordingTimerInterval = null;
    
    // Generate Lecture Code
    if (generateCodeBtn) {
        generateCodeBtn.addEventListener('click', async function() {
            const courseCode = document.getElementById('course-code').value;
            const instructorName = document.getElementById('instructor-name').value;
            const lectureDate = document.getElementById('lecture-date').value;
            const lectureTime = document.getElementById('lecture-time').value;
            
            if (!courseCode || !instructorName || !lectureDate || !lectureTime) {
                showError('error-message', 'Please fill in all fields');
                return;
            }
            
            showLoading(true);
            
            try {
                console.log('Sending request to generate lecture code...');
                
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
                
                console.log('Received response status:', response.status);
                
                // Add timeout for fetch request
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Request timed out')), 10000);
                });
                
                // Race between fetch and timeout
                const data = await response.json();
                console.log('Received response data:', data);
                
                if (data.success) {
                    // Display the generated code
                    lectureCodeDisplay.textContent = data.lecture_code;
                    codeDisplayContainer.style.display = 'block';
                    
                    // Store the code for later
                    activeLectureCode = data.lecture_code;
                    
                    // Make the recording section visible
                    const recordingSection = document.getElementById('recording-section');
                    if (recordingSection) {
                        recordingSection.style.display = 'block';
                    }
                } else {
                    showError('error-message', data.error || 'Error generating lecture code');
                }
            } catch (error) {
                console.error('Error details:', error);
                
                if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
                    showError('error-message', 'Network error: Could not connect to server. Please check your connection.');
                } else {
                    showError('error-message', `Error: ${error.message}`);
                }
            } finally {
                showLoading(false);
            }
        });
    }
    
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
    
    // Start Lecture button
    if (startLectureBtn) {
        startLectureBtn.addEventListener('click', function() {
            if (!activeLectureCode) return;
            
            // Redirect to the lecture page
            window.location.href = `/lecture/${activeLectureCode}`;
        });
    }
    
    // Start Recording
    if (startRecordingBtn) {
        startRecordingBtn.addEventListener('click', async function() {
            if (!activeLectureCode || isRecording) return;
            
            // Initialize the recorder if needed
            if (!audioRecorder) {
                audioRecorder = new WebSocketAudioRecorder(activeLectureCode);
                
                // Set up event handlers
                audioRecorder.onTranscription = (data) => {
                    // Handle transcription data
                    console.log('Received transcription:', data);
                    
                    // Update transcription preview if available
                    const transcriptionPreview = document.getElementById('transcription-preview');
                    if (transcriptionPreview && data.text) {
                        const p = document.createElement('p');
                        p.textContent = data.text;
                        transcriptionPreview.appendChild(p);
                        transcriptionPreview.scrollTop = transcriptionPreview.scrollHeight;
                    }
                };
                
                audioRecorder.onStatusChange = (status) => {
                    console.log('Recorder status change:', status);
                    if (statusMessage) {
                        if (status.connected) {
                            statusMessage.textContent = 'Connected to transcription service';
                        } else if (status.error) {
                            statusMessage.textContent = `Error: ${status.error}`;
                        } else {
                            statusMessage.textContent = 'Disconnected from transcription service';
                        }
                    }
                };
                
                const initialized = await audioRecorder.init();
                if (!initialized) {
                    showError('error-message', 'Error accessing microphone. Please check permissions.');
                    return;
                }
            }
            
            // Start recording
            try {
                audioRecorder.start();
                isRecording = true;
                
                // Update UI
                this.disabled = true;
                if (stopRecordingBtn) stopRecordingBtn.disabled = false;
                if (statusMessage) statusMessage.textContent = 'Recording in progress...';
                
                // Start recording timer
                recordingStartTime = Date.now();
                recordingTimerInterval = setInterval(updateRecordingTimer, 1000);
                
                // Animate visualizer if present
                animateVisualizer();
                
                // Update recording status on server
                fetch('/start_recording', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        lecture_code: activeLectureCode
                    })
                }).catch(console.error);
                
            } catch (error) {
                console.error('Error starting recording:', error);
                if (statusMessage) statusMessage.textContent = `Error: ${error.message}`;
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
            if (startRecordingBtn) startRecordingBtn.disabled = false;
            if (statusMessage) statusMessage.textContent = 'Recording stopped';
            
            // Clear timer
            clearInterval(recordingTimerInterval);
            
            // Update recording status on server
            fetch('/stop_recording', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lecture_code: activeLectureCode
                })
            }).catch(console.error);
        });
    }
    
    // Update recording timer display
    function updateRecordingTimer() {
        if (!recordingTimer || !recordingStartTime) return;
        
        const elapsed = Date.now() - recordingStartTime;
        const hours = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
        const minutes = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
        
        recordingTimer.textContent = `${hours}:${minutes}:${seconds}`;
    }
    
    // Animate visualizer (if present)
    function animateVisualizer() {
        if (!isRecording) return;
        
        const visualizerBars = document.querySelectorAll('.visualizer-bar');
        if (visualizerBars.length > 0) {
            visualizerBars.forEach(bar => {
                // Generate random heights for visualization effect
                if (Math.random() > 0.5) {
                    const height = 5 + Math.random() * 55;
                    bar.style.height = `${height}px`;
                }
            });
            
            setTimeout(animateVisualizer, 100 + Math.random() * 100);
        }
    }
    
    // Load previous lectures
    function loadPreviousLectures() {
        const lecturesContainer = document.getElementById('lectures-container');
        if (!lecturesContainer) return;
        
        fetch('/get_instructor_lectures')
            .then(response => response.json())
            .then(data => {
                if (data.lectures && data.lectures.length > 0) {
                    lecturesContainer.innerHTML = '';
                    
                    // Sort lectures by date (newest first)
                    data.lectures.sort((a, b) => {
                        return b.metadata.created_at - a.metadata.created_at;
                    });
                    
                    data.lectures.forEach(lecture => {
                        const lectureItem = document.createElement('div');
                        lectureItem.className = 'lecture-item';
                        
                        const courseDiv = document.createElement('div');
                        courseDiv.textContent = lecture.metadata.course_code;
                        
                        const dateDiv = document.createElement('div');
                        dateDiv.textContent = formatDate(lecture.metadata.date);
                        
                        const timeDiv = document.createElement('div');
                        timeDiv.textContent = formatTime(lecture.metadata.time);
                        
                        const codeDiv = document.createElement('div');
                        const codeBadge = document.createElement('span');
                        codeBadge.className = 'lecture-code-badge';
                        codeBadge.textContent = lecture.code;
                        codeDiv.appendChild(codeBadge);
                        
                        lectureItem.appendChild(courseDiv);
                        lectureItem.appendChild(dateDiv);
                        lectureItem.appendChild(timeDiv);
                        lectureItem.appendChild(codeDiv);
                        
                        // Make the item clickable to activate this lecture
                        lectureItem.style.cursor = 'pointer';
                        lectureItem.addEventListener('click', function() {
                            activeLectureCode = lecture.code;
                            
                            // Show recording section
                            const recordingSection = document.getElementById('recording-section');
                            if (recordingSection) {
                                recordingSection.style.display = 'block';
                                // Update lecture title
                                const recordingLectureTitle = document.getElementById('recording-lecture-title');
                                if (recordingLectureTitle) {
                                    recordingLectureTitle.textContent = `Lecture: ${lecture.metadata.course_code}`;
                                }
                            }
                            
                            // Scroll to recording section
                            recordingSection.scrollIntoView({ behavior: 'smooth' });
                        });
                        
                        lecturesContainer.appendChild(lectureItem);
                    });
                } else {
                    lecturesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No previous lectures found</div>';
                }
            })
            .catch(error => {
                console.error('Error loading lectures:', error);
                lecturesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #d32f2f;">Error loading lectures</div>';
            });
    }
    
    // Helper functions
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
    
    function showLoading(show) {
        if (loadingOverlay) {
            loadingOverlay.style.display = show ? 'flex' : 'none';
        }
    }
    
    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        try {
            return new Date(dateString).toLocaleDateString(undefined, options);
        } catch (e) {
            return dateString;
        }
    }

    function formatTime(timeString) {
        if (!timeString) return 'N/A';
        
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
    
    // Set default date to today
    const dateInput = document.getElementById('lecture-date');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
    }
    
    // Load previous lectures on page load
    loadPreviousLectures();
    
    // Check for active lecture
    fetch('/active_lecture')
        .then(response => response.json())
        .then(data => {
            if (data && data.code) {
                activeLectureCode = data.code;
                
                // Show recording section if there's an active lecture
                const recordingSection = document.getElementById('recording-section');
                if (recordingSection) {
                    recordingSection.style.display = 'block';
                }
            }
        })
        .catch(console.error);
});