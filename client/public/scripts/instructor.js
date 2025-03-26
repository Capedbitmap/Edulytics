// client/public/scripts/instructor.js

// Add a flag to prevent attaching listener multiple times in case DOMContentLoaded fires > 1
let instructorJsInitialized = false;
// Add a counter for the click handler execution
let generateClickCounter = 0;


document.addEventListener('DOMContentLoaded', function() {
    // Log when DOMContentLoaded fires
    console.log('[instructor.js] DOMContentLoaded event fired.');

    // Prevent re-initialization if DOMContentLoaded somehow fires multiple times
    if (instructorJsInitialized) {
        console.warn('[instructor.js] DOMContentLoaded fired again, skipping initialization.');
        return;
    }
    instructorJsInitialized = true;
    console.log('[instructor.js] Initializing...');


    // Elements
    const generateCodeBtn = document.getElementById('generate-code-btn');
    const codeDisplayContainer = document.getElementById('code-display-container');
    const lectureCodeDisplay = document.getElementById('lecture-code-display');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    // const startLectureBtn = document.getElementById('start-lecture-btn'); // Keep if element exists in HTML
    const loadingElement = document.getElementById('loading'); // Corrected variable name from loadingOverlay
    const errorMessageElement = document.getElementById('error-message'); // Corrected variable name
    const startRecordingBtn = document.getElementById('start-recording-btn');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const recordingTimer = document.getElementById('recording-timer');
    // const statusMessage = document.getElementById('status-message'); // Keep if element exists in HTML
    const recordingSection = document.getElementById('recording-section'); // Added element selection
    const recordingLectureTitle = document.getElementById('recording-lecture-title'); // Added element selection


    // State
    let activeLectureCode = null;
    let isRecording = false;
    let audioRecorder = null; // Ensure WebSocketAudioRecorder class is available via audioRecorder.js
    let recordingStartTime = null;
    let recordingTimerInterval = null;
    let recordingStatusInterval = null; // Added from instructor.html inline script
    let lastTranscriptionTime = 0; // Added from instructor.html inline script
    const visualizerBars = document.getElementById('visualizer-bars'); // Added element selection
    const visualizerBarElements = document.querySelectorAll('.visualizer-bar'); // Added element selection
    const transcriptionPreview = document.getElementById('transcription-preview'); // Added element selection

    // Generate Lecture Code
    if (generateCodeBtn) {
         // Log *before* attaching the listener
        console.log('[instructor.js] Attaching click listener to #generate-code-btn.');

        generateCodeBtn.addEventListener('click', async function() { // Ensure async for await
            generateClickCounter++;
            console.log(`[instructor.js] #generate-code-btn listener executed (Count: ${generateClickCounter})`); // Log execution

            const courseCode = document.getElementById('course-code').value;
            const instructorName = document.getElementById('instructor-name').value; // Use instructorName here for clarity, matches input ID
            const lectureDate = document.getElementById('lecture-date').value;
            const lectureTime = document.getElementById('lecture-time').value;
            const setActive = document.getElementById('set-active').checked;

            if (!courseCode) { showError('error-message', 'Please enter a course code'); return; }
            if (!lectureDate) { showError('error-message', 'Please select a date'); return; }
            if (!lectureTime) { showError('error-message', 'Please select a time'); return; }
            if (!instructorName) { showError('error-message', 'Please enter instructor name'); return; }

            showLoading(true);
            errorMessageElement.style.display = 'none'; // Hide previous errors

            try {
                console.log('[instructor.js] Sending request to /generate_lecture_code...');

                const response = await fetch('/generate_lecture_code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({
                        course_code: courseCode,
                        instructor: instructorName, // Send the instructor name
                        date: lectureDate,
                        time: lectureTime,
                        set_active: setActive
                    })
                });

                console.log('[instructor.js] Received response status:', response.status);

                // Temporarily removing timeout logic for debugging double request
                // const timeoutPromise = new Promise((_, reject) => {
                //     setTimeout(() => reject(new Error('Request timed out')), 10000);
                // });
                // const data = await Promise.race([response.json(), timeoutPromise]);

                 if (!response.ok) {
                    // Attempt to get error message from server response body
                    let errorMsg = `Failed to generate lecture code (Status: ${response.status})`;
                    try {
                        const errorData = await response.json();
                        errorMsg = `Error: ${errorData.error || response.statusText}`;
                    } catch (e) {
                         // Ignore if response body isn't valid JSON
                    }
                    throw new Error(errorMsg);
                 }

                const data = await response.json();
                console.log('[instructor.js] Received response data:', data);

                if (data.success && data.lecture_code) {
                    // Display the generated code
                    lectureCodeDisplay.textContent = data.lecture_code;
                    codeDisplayContainer.style.display = 'block';
                    // activeLectureInfo.style.display = setActive ? 'block' : 'none'; // Element from inline script needs selection

                    // Store active lecture info
                    activeLecture = { // Use activeLecture variable consistent with inline script
                        code: data.lecture_code,
                        course: courseCode,
                        instructor: instructorName,
                        date: lectureDate,
                        time: lectureTime
                    };
                     activeLectureCode = data.lecture_code; // Keep this separate for recording maybe?


                    if (setActive) {
                        // Show recording section
                        if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${courseCode}`; // Update title
                        if(recordingSection) recordingSection.style.display = 'block';

                        // Scroll to the recording section
                        setTimeout(() => {
                            if(recordingSection) recordingSection.scrollIntoView({ behavior: 'smooth' });
                        }, 500);
                    } else {
                        // Scroll to the code display if not showing recording section
                         if(codeDisplayContainer) codeDisplayContainer.scrollIntoView({ behavior: 'smooth' });
                    }

                    // Refresh the lectures list
                    loadPreviousLectures(); // Make sure this function is defined below or globally
                } else {
                    // Use the error from the response if available
                    showError('error-message', `Error: ${data.error || 'Unknown error generating code'}`);
                }
            } catch (error) {
                console.error('[instructor.js] Error in generate code fetch:', error);

                if (error.name === 'TypeError' && error.message.includes('NetworkError')) {
                    showError('error-message', 'Network error: Could not connect to server. Please check your connection.');
                } else {
                    // Show the error message caught from response.ok check or other issues
                    showError('error-message', error.message || 'An unexpected error occurred.');
                }
            } finally {
                showLoading(false);
            }
        }); // End addEventListener for generateCodeBtn

    } else {
         console.error("[instructor.js] Could not find #generate-code-btn element!");
    }


    // --- Copy Code Logic ---
    if (copyCodeBtn) {
         console.log('[instructor.js] Attaching click listener to #copy-code-btn.');
        copyCodeBtn.addEventListener('click', function() {
            // ... (keep existing copy logic) ...
            const code = lectureCodeDisplay.textContent;
            navigator.clipboard.writeText(code).then(function() {
                const originalText = copyCodeBtn.textContent;
                copyCodeBtn.textContent = 'Copied!';
                setTimeout(function() { copyCodeBtn.textContent = originalText; }, 2000);
            }).catch(function(err) { console.error('Could not copy text: ', err); });
        });
    }

    // --- Start Lecture Button Logic (If element exists) ---
    // if (startLectureBtn) { ... } // Keep if needed

    // --- Recording Functionality ---
    // Create visualizer bars (moved from inline script)
    const numBars = 50;
    if (visualizerBars) {
        visualizerBars.innerHTML = ''; // Clear any existing bars
        for (let i = 0; i < numBars; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            visualizerBars.appendChild(bar);
        }
    }
    // visualizerBarElements are selected above already

    if (startRecordingBtn) {
         console.log('[instructor.js] Attaching click listener to #start-recording-btn.');
        startRecordingBtn.addEventListener('click', async function() {
            console.log('[instructor.js] #start-recording-btn clicked.');
            if (!activeLecture && !activeLectureCode) { // Check both potentially
                showError('error-message', 'No active lecture selected. Please generate or select a lecture.');
                return;
            }
            if (isRecording) {
                 console.warn("Start recording clicked, but already recording.");
                 return;
            }

            const currentLectureCode = activeLecture ? activeLecture.code : activeLectureCode;
            if (!currentLectureCode) {
                 showError('error-message', 'Internal error: Active lecture code not found.');
                 return;
            }

            showLoading(true); // Show loading overlay

            // Initialize the recorder if needed
            if (!audioRecorder) {
                console.log(`[instructor.js] Initializing WebSocketAudioRecorder for ${currentLectureCode}`);
                audioRecorder = new WebSocketAudioRecorder(currentLectureCode); // Ensure class is loaded via audioRecorder.js

                // Set up event handlers
                audioRecorder.onTranscription = (data) => {
                    console.debug('[instructor.js] Received transcription:', data); // Use debug
                    if (transcriptionPreview && data.text) {
                        // Simple append for now, consider handling deltas vs completed differently
                        const p = document.createElement('p');
                        p.textContent = data.text;
                        // Add logic to potentially update last partial line vs append new full line
                        transcriptionPreview.appendChild(p);
                        transcriptionPreview.scrollTop = transcriptionPreview.scrollHeight;
                    }
                };

                audioRecorder.onStatusChange = (status) => {
                    console.log('[instructor.js] Recorder status change:', status);
                    const recordingStatusEl = document.getElementById('recording-status'); // Select inside handler
                    if (recordingStatusEl) {
                        if(status.error) {
                             recordingStatusEl.textContent = `Error: ${status.error}`;
                             recordingStatusEl.classList.remove('active');
                             // Potentially disable buttons on error
                             isRecording = false; // Update state on error
                             if(startRecordingBtn) startRecordingBtn.disabled = false;
                             if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                             clearInterval(recordingTimerInterval);
                             clearInterval(recordingStatusInterval);
                        } else if (status.recording && status.status === 'capturing') {
                            recordingStatusEl.textContent = 'Recording in progress...';
                            recordingStatusEl.classList.add('active');
                        } else if (status.recording && (status.status === 'backend_connected' || status.status === 'connecting')) {
                            recordingStatusEl.textContent = 'Connecting to transcription service...';
                             recordingStatusEl.classList.remove('active'); // Maybe indicate connecting state differently
                        } else if (!status.recording && status.status === 'stopped') {
                             recordingStatusEl.textContent = 'Recording stopped.';
                             recordingStatusEl.classList.remove('active');
                        } else if (!status.connected) {
                             recordingStatusEl.textContent = `Disconnected. ${status.reason || ''}`;
                             recordingStatusEl.classList.remove('active');
                             isRecording = false; // Update state on disconnect
                             if(startRecordingBtn) startRecordingBtn.disabled = false;
                             if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                             clearInterval(recordingTimerInterval);
                             clearInterval(recordingStatusInterval);
                        }
                    }
                };

                 audioRecorder.onTimerUpdate = (elapsed) => {
                     updateRecordingTimerDisplay(elapsed); // Call separate display update function
                 };

                // Initialize microphone access
                const micInitialized = await audioRecorder.init();
                if (!micInitialized) {
                    showError('error-message', audioRecorder.lastError || 'Error accessing microphone. Please check permissions.'); // Use potential error from recorder
                    showLoading(false);
                    audioRecorder = null; // Reset recorder if init failed
                    return;
                }
            }

            // Start recording (sets intention, connects WS, starts capture when ready)
            try {
                 console.log('[instructor.js] Calling audioRecorder.start()');
                await audioRecorder.start(); // Assuming start might be async due to connect()
                isRecording = true; // State reflecting user action + recorder intention

                // Update UI immediately for responsiveness
                if(startRecordingBtn) startRecordingBtn.disabled = true;
                if(stopRecordingBtn) stopRecordingBtn.disabled = false;
                const recordingStatusEl = document.getElementById('recording-status');
                if(recordingStatusEl) recordingStatusEl.textContent = 'Initializing recording...'; // Intermediate state

                // // Start UI Timer (moved inside audioRecorder's _startAudioCaptureAndProcessing)
                // recordingStartTime = Date.now(); // Reset start time
                // recordingTimerInterval = setInterval(updateRecordingTimerDisplayFromLocal, 1000);

                // Start fake visualizer animation
                animateVisualizer();

                // Optionally: Tell the server via REST endpoint too (redundant if WS handles all?)
                // fetch('/start_recording', { ... }).catch(console.error);
                console.log('[instructor.js] Recording process initiated.');

            } catch (error) {
                console.error('[instructor.js] Error calling audioRecorder.start():', error);
                showError('error-message', `Failed to start recording: ${error.message}`);
                isRecording = false; // Reset state
                if(startRecordingBtn) startRecordingBtn.disabled = false; // Re-enable button
                 if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                 // Ensure recorder is cleaned up if start failed badly
                 if (audioRecorder) {
                     audioRecorder.release();
                     audioRecorder = null;
                 }
            } finally {
                 showLoading(false); // Hide loading overlay once initiation attempt is done
            }
        }); // End addEventListener for startRecordingBtn
    }


    if (stopRecordingBtn) {
         console.log('[instructor.js] Attaching click listener to #stop-recording-btn.');
        stopRecordingBtn.addEventListener('click', function() {
            console.log('[instructor.js] #stop-recording-btn clicked.');
            // Check recorder state directly instead of only isRecording flag
            if (!audioRecorder || !audioRecorder.isActive()) {
                 console.warn("Stop recording clicked, but recorder is not active.");
                 // Ensure UI matches state
                 isRecording = false;
                 if(startRecordingBtn) startRecordingBtn.disabled = false;
                 if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                 const recordingStatusEl = document.getElementById('recording-status');
                 if(recordingStatusEl) {
                     recordingStatusEl.textContent = 'Recording stopped';
                     recordingStatusEl.classList.remove('active');
                 }
                 clearInterval(recordingTimerInterval); // Ensure timer stops
                return;
            }

            console.log('[instructor.js] Calling audioRecorder.stop()');
            const stopped = audioRecorder.stop(); // stop() should now handle cleanup and state
            isRecording = false; // Update local flag

            if (stopped) {
                // Update UI
                if(startRecordingBtn) startRecordingBtn.disabled = false;
                if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                const recordingStatusEl = document.getElementById('recording-status');
                 if(recordingStatusEl) {
                     recordingStatusEl.textContent = 'Recording stopped';
                     recordingStatusEl.classList.remove('active');
                 }

                // Clear timer is handled by recorder's stop/cleanup now
                // clearInterval(recordingTimerInterval);

                // Stop status polling (if it was used)
                // clearInterval(recordingStatusInterval);

                // Reset visualizer bars
                 if (visualizerBarElements) visualizerBarElements.forEach(bar => { bar.style.height = '5px'; });

                // Optionally tell server via REST (if needed)
                // fetch('/stop_recording', { ... }).catch(console.error);
                 console.log('[instructor.js] Recording stopped via recorder.');

            } else {
                 console.error("[instructor.js] audioRecorder.stop() reported failure.");
                 showError('error-message', 'Failed to stop recording cleanly.');
            }

            // Optionally release the recorder immediately after stopping
            // if (audioRecorder) {
            //    audioRecorder.release();
            //    audioRecorder = null;
            // }
        }); // End addEventListener for stopRecordingBtn
    }

    // --- Helper Functions (Defined within DOMContentLoaded scope) ---

     // Update recording timer display (called by recorder's onTimerUpdate)
     function updateRecordingTimerDisplay(elapsedMilliseconds) {
        if (!recordingTimer) return;
        const hours = Math.floor(elapsedMilliseconds / 3600000).toString().padStart(2, '0');
        const minutes = Math.floor((elapsedMilliseconds % 3600000) / 60000).toString().padStart(2, '0');
        const seconds = Math.floor((elapsedMilliseconds % 60000) / 1000).toString().padStart(2, '0');
        recordingTimer.textContent = `${hours}:${minutes}:${seconds}`;
    }

    // // Timer update based on local startTime (Alternative, use recorder's onTimerUpdate instead)
    // function updateRecordingTimerDisplayFromLocal() {
    //     if (!recordingStartTime || !isRecording) return;
    //     updateRecordingTimerDisplay(Date.now() - recordingStartTime);
    // }


    // Animate visualizer (fake animation)
    function animateVisualizer() {
        // Check recorder state instead of local isRecording flag
        if (!audioRecorder || !audioRecorder.isCapturing) { // Use isCapturing for active audio flow
             // Reset bars when capture stops
             if (visualizerBarElements) visualizerBarElements.forEach(bar => { bar.style.height = '5px'; });
             return;
        }
        if (visualizerBarElements && visualizerBarElements.length > 0) {
            visualizerBarElements.forEach(bar => {
                if (Math.random() > 0.5) {
                    const height = 5 + Math.random() * 55;
                    bar.style.height = `${height}px`;
                } else {
                     bar.style.height = `5px`; // Let some bars stay low
                }
            });
            setTimeout(animateVisualizer, 100 + Math.random() * 100); // Continue animation
        }
    }


    // Load previous lectures
    function loadPreviousLectures() {
        const lecturesContainer = document.getElementById('lectures-container');
        if (!lecturesContainer) {
             console.error("Could not find #lectures-container element.");
             return;
        }
        console.log("[instructor.js] Loading previous lectures...");

        fetch('/get_instructor_lectures')
            .then(response => {
                if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
                return response.json();
             })
            .then(data => {
                console.log("[instructor.js] Received previous lectures:", data);
                // Ensure data.lectures is an array (server now sends array)
                if (data.lectures && Array.isArray(data.lectures) && data.lectures.length > 0) {
                    lecturesContainer.innerHTML = ''; // Clear existing

                    // Sorting should already be done by server, but can re-sort if needed
                    // data.lectures.sort((a, b) => b.metadata.created_at - a.metadata.created_at);

                    data.lectures.forEach(lecture => {
                        const lectureItem = document.createElement('div');
                        lectureItem.className = 'lecture-item';
                        lectureItem.innerHTML = `
                            <div>${lecture.metadata.course_code || 'N/A'}</div>
                            <div>${formatDate(lecture.metadata.date)}</div>
                            <div>${formatTime(lecture.metadata.time)}</div>
                            <div><span class="lecture-code-badge">${lecture.code || 'N/A'}</span></div>
                        `;

                        lectureItem.style.cursor = 'pointer';
                        lectureItem.addEventListener('click', function() {
                             console.log(`[instructor.js] Previous lecture clicked: ${lecture.code}`);
                             // Stop current recording if active before switching
                             if (audioRecorder && audioRecorder.isActive()) {
                                 console.log("Stopping current recording before switching lecture...");
                                 if(stopRecordingBtn) stopRecordingBtn.click(); // Programmatically click stop
                             }

                            activeLecture = { // Update main activeLecture object
                                code: lecture.code,
                                course: lecture.metadata.course_code,
                                instructor: lecture.metadata.instructor,
                                date: lecture.metadata.date,
                                time: lecture.metadata.time
                            };
                            activeLectureCode = lecture.code; // Update simple code variable too

                            // Update the active lecture on the server
                            fetch('/set_active_lecture', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', },
                                body: JSON.stringify({ lecture_code: lecture.code })
                            }).then(response => response.json())
                            .then(setData => {
                                if (setData.success) {
                                    console.log(`[instructor.js] Server set active lecture to ${lecture.code}`);
                                    // Show recording section & update title
                                    if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${lecture.metadata.course_code || 'N/A'}`;
                                    if(recordingSection) recordingSection.style.display = 'block';
                                    if(recordingSection) recordingSection.scrollIntoView({ behavior: 'smooth' });

                                    // Reset recording UI state for the new lecture
                                     const recordingStatusEl = document.getElementById('recording-status');
                                     if(recordingStatusEl) recordingStatusEl.textContent = 'Click Start Recording to begin';
                                     updateRecordingTimerDisplay(0); // Reset timer display
                                     if(startRecordingBtn) startRecordingBtn.disabled = false;
                                     if(stopRecordingBtn) stopRecordingBtn.disabled = true;
                                     // Release old recorder instance if it exists
                                     if (audioRecorder) {
                                         audioRecorder.release();
                                         audioRecorder = null;
                                         console.log("[instructor.js] Previous audio recorder released.");
                                     }

                                } else {
                                     showError('error-message', setData.error || 'Failed to set active lecture on server.');
                                }
                            }).catch(err => {
                                 console.error('[instructor.js] Error setting active lecture:', err);
                                 showError('error-message', `Error activating lecture: ${err.message}`);
                             });
                        }); // End lecture item click listener

                        lecturesContainer.appendChild(lectureItem);
                    }); // End forEach lecture
                } else {
                    lecturesContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No previous lectures found</div>';
                }
            })
            .catch(error => {
                console.error('[instructor.js] Error loading lectures:', error);
                if(lecturesContainer) lecturesContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #d32f2f;">Error loading lectures: ${error.message}</div>`;
            });
    } // End loadPreviousLectures


    // Error and Loading Helpers
    function showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (!errorElement) return;
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        // Optional: Auto-hide after a delay
         setTimeout(() => { if(errorElement) errorElement.style.display = 'none'; }, 7000); // Increased duration
    }

    function showLoading(show) {
        // Use loadingElement selected at the top
        if (loadingElement) {
            loadingElement.style.display = show ? 'flex' : 'none';
        }
    }

    // Date/Time Format Helpers
    function formatDate(dateString) { /* ... keep existing ... */ if (!dateString) return 'N/A'; try { const options = { year: 'numeric', month: 'short', day: 'numeric' }; return new Date(dateString).toLocaleDateString(undefined, options); } catch (e) { return dateString; } }
    function formatTime(timeString) { /* ... keep existing ... */ if (!timeString) return 'N/A'; try { const [hours, minutes] = timeString.split(':'); const hour = parseInt(hours, 10); const ampm = hour >= 12 ? 'PM' : 'AM'; const hour12 = hour % 12 || 12; return `${hour12}:${minutes} ${ampm}`; } catch (e) { return timeString; } }


    // --- Initial Setup Calls ---

    // Set default date to today
    const dateInput = document.getElementById('lecture-date');
    if (dateInput) {
        try {
             // Format as YYYY-MM-DD
             const today = new Date();
             const year = today.getFullYear();
             const month = (today.getMonth() + 1).toString().padStart(2, '0');
             const day = today.getDate().toString().padStart(2, '0');
             dateInput.value = `${year}-${month}-${day}`;
         } catch (e) { console.error("Failed to set default date"); }
    }

    // Fetch user info on load
    fetch('/get_user_info')
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`User info fetch failed: ${response.status}`)))
        .then(data => {
            const userNameElement = document.getElementById('user-name');
            const userAvatarElement = document.getElementById('user-avatar');
            if (data.name && userNameElement) {
                userNameElement.textContent = data.name;
                // Set initial for avatar
                 if(userAvatarElement) {
                     const nameParts = data.name.trim().split(' ');
                     let initials = (nameParts[0]?.[0] || '') + (nameParts.length > 1 ? nameParts[nameParts.length - 1]?.[0] || '' : '');
                     userAvatarElement.textContent = initials.toUpperCase() || 'U';
                 }
                 // Pre-fill instructor name field?
                 const instructorNameInput = document.getElementById('instructor-name');
                 if (instructorNameInput && !instructorNameInput.value) {
                      instructorNameInput.value = data.name;
                 }
            }
        })
        .catch(error => console.error('[instructor.js] Error fetching user info:', error));


    // Load previous lectures on page load
    loadPreviousLectures();

    // Check for active lecture on page load (Simplified - relies on server state)
     fetch('/active_lecture')
         .then(response => response.ok ? response.json() : Promise.reject('Failed to fetch active lecture'))
         .then(data => {
             if (data && data.code) {
                 console.log(`[instructor.js] Found active lecture on load: ${data.code}`);
                 // Fetch full metadata to populate activeLecture object and UI
                 fetch(`/get_lecture_info?code=${data.code}`)
                     .then(infoResponse => infoResponse.ok ? infoResponse.json() : Promise.reject('Failed to fetch active lecture info'))
                     .then(lectureData => {
                         if (lectureData.success && lectureData.metadata) {
                             activeLecture = { // Set the main activeLecture object
                                 code: data.code,
                                 course: lectureData.metadata.course_code,
                                 instructor: lectureData.metadata.instructor,
                                 date: lectureData.metadata.date,
                                 time: lectureData.metadata.time
                             };
                             activeLectureCode = data.code; // Set the simple code variable

                             // Show recording section and update title
                             if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${activeLecture.course || 'N/A'}`;
                             if(recordingSection) recordingSection.style.display = 'block';
                         } else {
                              console.error("Failed to get metadata for active lecture:", lectureData.error);
                         }
                     })
                     .catch(error => console.error('[instructor.js] Error getting info for active lecture:', error));
             } else {
                 console.log("[instructor.js] No active lecture found on server load.");
                 if(recordingSection) recordingSection.style.display = 'none'; // Hide section if no active lecture
             }
         })
         .catch(error => console.error('[instructor.js] Error checking active lecture:', error));

    console.log('[instructor.js] Initialization complete.');

}); // End DOMContentLoaded