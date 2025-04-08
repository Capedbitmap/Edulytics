// client/public/scripts/instructor.js

// --- Initialization Flags ---
let instructorJsInitialized = false; // Prevent multiple initializations
let generateClickCounter = 0;       // Debug counter for generate button clicks

// --- Global State ---
let activeLecture = null;          // Holds { code, course, instructor, date, time } of the active lecture
let activeLectureCode = null;      // Stores just the code of the active lecture (redundant but used in places)
let isRecording = false;           // Tracks the user's intent/state of recording
let audioRecorder = null;          // Instance of RealtimeAudioRecorder
let visualizerAnimationTimeout = null; // Timeout ID for stopping the visualizer animation
let deleteMode = "";               // Tracks what is being deleted ('lecture', 'lectures', 'course', 'courses')
let deleteTarget = null;           // Holds the target data for deletion
let previousCourseCodes = [];      // Stores extracted course codes from previous lectures
let activeQuizzes = [];            // Stores the active quizzes for the current lecture
let quizRefreshInterval = null;    // Interval for refreshing quiz results
let quizPollingIntervals = {};     // Store intervals by quiz ID to avoid duplicates

// --- DOMContentLoaded Event Listener ---
document.addEventListener('DOMContentLoaded', function() {
    // Log DOMContentLoaded event and prevent re-initialization
    console.log('[instructor.js] DOMContentLoaded event fired.');
    if (instructorJsInitialized) {
        console.warn('[instructor.js] DOMContentLoaded fired again, skipping initialization.');
        return;
    }
    instructorJsInitialized = true;
    console.log('[instructor.js] Initializing instructor dashboard script...');

    // --- Element Selections ---
    // Lecture Generation Card
    const generateCodeBtn = document.getElementById('generate-code-btn');
    const codeDisplayContainer = document.getElementById('code-display-container');
    const lectureCodeDisplay = document.getElementById('lecture-code-display');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const activeLectureInfo = document.getElementById('active-lecture-info'); // Info box below generated code
    const instructorNameInput = document.getElementById('instructor-name'); // Instructor name input field
    const courseCodeInput = document.getElementById('course-code');
    const courseCodeOptions = document.getElementById('course-code-options');
    const lectureDateInput = document.getElementById('lecture-date');
    const lectureTimeInput = document.getElementById('lecture-time');
    const setActiveCheckbox = document.getElementById('set-active');

    // Recording Section Card
    const recordingSection = document.getElementById('recording-section');
    const recordingLectureTitle = document.getElementById('recording-lecture-title'); // Title within recording section
    const startRecordingBtn = document.getElementById('start-recording-btn');
    const stopRecordingBtn = document.getElementById('stop-recording-btn');
    const recordingTimer = document.getElementById('recording-timer');        // Timer display (e.g., 00:00:00)
    const recordingStatusEl = document.getElementById('recording-status');      // Text status display (e.g., "Recording...")
    const visualizerBars = document.getElementById('visualizer-bars');        // Container for visualizer bars
    const transcriptionPreview = document.getElementById('transcription-preview'); // Area to display transcriptions

    // Previous Lectures Card
    const lecturesContainer = document.getElementById('lectures-container');    // Container for listing previous lectures

    // General UI Elements
    const loadingElement = document.getElementById('loading');                // Loading spinner overlay
    const errorMessageElement = document.getElementById('error-message');     // Error message display area
    const userNameElement = document.getElementById('user-name');             // Header user name display
    const userAvatarElement = document.getElementById('user-avatar');         // Header user avatar display
    const logoutBtn = document.getElementById('logout-btn');                  // Header logout button

    // --- Delete Functionality Elements ---
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete');
    const cancelDeleteBtn = document.getElementById('cancel-delete');
    const confirmationMessage = document.getElementById('confirmation-message');

    // Quiz Management Elements
    const quizTypeSelect = document.getElementById('quiz-type');
    const quizOptionsContainer = document.getElementById('quiz-options-container');
    const shortAnswerContainer = document.getElementById('short-answer-container');
    const addOptionBtn = document.getElementById('add-option-btn');
    const createQuizBtn = document.getElementById('create-quiz-btn');
    const quizList = document.getElementById('quiz-list');
    const noQuizzesMessage = document.getElementById('no-quizzes-message');
    const quizQuestion = document.getElementById('quiz-question');
    const correctAnswer = document.getElementById('correct-answer');
    const timeLimit = document.getElementById('time-limit');
    const quizErrorMessage = document.getElementById('quiz-error-message');
    const activeLectureQuizContext = document.getElementById('active-lecture-quiz-context'); // Added for quiz context display
    const quizLectureDetails = document.getElementById('quiz-lecture-details'); // Added for quiz context display

    // --- State Variables (Local to DOMContentLoaded) ---
    let isGeneratingCode = false; // Flag to prevent multiple generate requests

    // --- Initialize UI Elements ---

    // Set default date in the date input field to today
    if (lectureDateInput) {
        try {
             const today = new Date();
             // Format as YYYY-MM-DD required by input type="date"
             const year = today.getFullYear();
             const month = (today.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed
             const day = today.getDate().toString().padStart(2, '0');
             lectureDateInput.value = `${year}-${month}-${day}`;
         } catch (e) { console.error("Failed to set default date:", e); }
    }

    // Create visualizer bars if the container exists
    if (visualizerBars) {
        visualizerBars.innerHTML = ''; // Clear any existing bars first
        const numBars = 50; // Number of bars for the visualizer
        for (let i = 0; i < numBars; i++) {
            const bar = document.createElement('div');
            bar.className = 'visualizer-bar';
            visualizerBars.appendChild(bar);
        }
    }
    // Select the bars *after* creating them
    const visualizerBarElements = document.querySelectorAll('.visualizer-bar');

    // Initialize course code dropdown and set last used value
    initializeCourseCodeDropdown();

    // Event listener for saving the selected course code
    if (courseCodeInput) {
        courseCodeInput.addEventListener('change', function() {
            // Save the selected course code to localStorage when changed
            const courseCode = this.value.trim();
            if (courseCode) {
                localStorage.setItem('lastCourseCode', courseCode);
            }
        });
    }

    // --- Event Listeners ---

    // Generate Lecture Code Button
    if (generateCodeBtn) {
        console.log('[instructor.js] Attaching click listener to #generate-code-btn.');
        generateCodeBtn.addEventListener('click', async function() {
            generateClickCounter++;
            console.log(`[instructor.js] #generate-code-btn click handler executed (Count: ${generateClickCounter})`);

            // Prevent multiple simultaneous requests
            if (isGeneratingCode) {
                console.warn("[instructor.js] Generate code request already in progress. Ignoring click.");
                return;
            }
            isGeneratingCode = true; // Set flag

            // Get input values
            const courseCode = courseCodeInput ? courseCodeInput.value.trim() : '';
            const instructorName = instructorNameInput ? instructorNameInput.value.trim() : '';
            const lectureDate = lectureDateInput ? lectureDateInput.value : '';
            const lectureTime = lectureTimeInput ? lectureTimeInput.value : '';
            const setActive = setActiveCheckbox ? setActiveCheckbox.checked : false;

            // Basic frontend validation
            if (!courseCode || !instructorName || !lectureDate || !lectureTime) {
                 showError('error-message', 'Please fill in all lecture details (Course Code, Instructor, Date, Time).');
                 isGeneratingCode = false; // Reset flag on validation failure
                 return;
             }

            // Show loading indicator and hide previous errors
            showLoading(true);
            if (errorMessageElement) errorMessageElement.style.display = 'none';

            try {
                console.log('[instructor.js] Sending request to /generate_lecture_code...');
                const response = await fetch('/generate_lecture_code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        course_code: courseCode,
                        instructor: instructorName,
                        date: lectureDate,
                        time: lectureTime,
                        set_active: setActive
                    })
                });

                // Check if the request was successful
                if (!response.ok) {
                    // Try to parse error message from server response
                    let errorMsg = `Failed to generate code (Status: ${response.status})`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || response.statusText;
                    } catch (parseError) { /* Ignore if response body isn't JSON */ }
                    throw new Error(errorMsg); // Throw error to be caught below
                }

                // Parse successful response
                const data = await response.json();
                console.log('[instructor.js] Received response from /generate_lecture_code:', data);

                if (data.success && data.lecture_code) {
                    // Update UI with generated code
                    if (lectureCodeDisplay) lectureCodeDisplay.textContent = data.lecture_code;
                    if (codeDisplayContainer) codeDisplayContainer.style.display = 'block';
                    if (activeLectureInfo) activeLectureInfo.style.display = setActive ? 'block' : 'none';

                    // Update global active lecture state
                    activeLecture = {
                        code: data.lecture_code,
                        course: courseCode,
                        instructor: instructorName,
                        date: lectureDate,
                        time: lectureTime
                    };
                    activeLectureCode = data.lecture_code; // Update simple code variable too

                    // Show/Hide recording section based on 'setActive'
                    if (setActive) {
                        if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${courseCode || 'N/A'}`;
                        if(recordingSection) recordingSection.style.display = 'block';
                        // Scroll to the recording section smoothly after a short delay
                        if(recordingSection) setTimeout(() => recordingSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
                        // Reset recording UI state for the newly activated lecture
                         resetRecordingUI();
                         releaseOldRecorder(); // Ensure any previous recorder instance is cleaned up
                         updateQuizContextDisplay(activeLecture); // Update quiz context display
                    } else {
                        updateQuizContextDisplay(null); // Hide quiz context if not set active
                        // If not set active, scroll to the code display area
                         if(codeDisplayContainer) codeDisplayContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                         // Check if the currently displayed recording section corresponds to a *different* lecture
                         // that might have just been deactivated implicitly.
                         if (recordingSection?.style.display === 'block' && activeLectureCode !== (await (await fetch('/active_lecture')).json())?.code) {
                             console.log("[instructor.js] Hiding recording section as a different lecture was generated without setting it active.");
                             recordingSection.style.display = 'none';
                             resetRecordingUI();
                             releaseOldRecorder();
                         }
                    }

                    // Refresh the list of previous lectures to include the new one
                    loadPreviousLectures();
                } else {
                    // Handle server-side error reported in successful response
                    showError('error-message', `Error: ${data.error || 'Unknown error generating code'}`);
                }
            } catch (error) {
                // Handle fetch errors or errors thrown from response check
                console.error('[instructor.js] Error generating lecture code:', error);
                showError('error-message', `Error: ${error.message}`);
            } finally {
                // Hide loading indicator and reset request flag
                showLoading(false);
                isGeneratingCode = false;
            }
        }); // End generateCodeBtn listener
    } else {
        console.error("[instructor.js] Could not find #generate-code-btn element!");
    }

    // Copy Lecture Code Button
    if (copyCodeBtn && lectureCodeDisplay) {
        copyCodeBtn.addEventListener('click', function() {
            const code = lectureCodeDisplay.textContent;
            if (!code) return;
            navigator.clipboard.writeText(code).then(() => {
                const originalText = copyCodeBtn.textContent;
                copyCodeBtn.textContent = 'Copied!';
                // Revert text after 2 seconds
                setTimeout(() => { copyCodeBtn.textContent = originalText; }, 2000);
            }).catch(err => {
                console.error('Could not copy text: ', err);
                showError('error-message', 'Failed to copy code.'); // Show error to user
            });
        });
    }

    // --- Recording Functionality Event Listeners ---

    // Start Recording Button
    if (startRecordingBtn) {
        startRecordingBtn.addEventListener('click', async function() {
            console.log('[instructor.js] #start-recording-btn clicked.');
            // Use the globally tracked active lecture code
            const currentLectureCodeToRecord = activeLecture?.code || activeLectureCode;

            if (!currentLectureCodeToRecord) {
                showError('error-message', 'No active lecture selected or generated. Please select or generate a lecture first.');
                return;
            }
            // Prevent starting if already recording or recorder is active
            if (isRecording || (audioRecorder && audioRecorder.isActive())) {
                console.warn("Start recording clicked, but recording is already active.");
                return;
            }

            showLoading(true); // Show loading overlay during initialization
            if(recordingStatusEl) recordingStatusEl.textContent = 'Initializing microphone...'; // Initial status

            try {
                // Initialize recorder if it doesn't exist OR if it's for a different lecture
                if (!audioRecorder || audioRecorder.lectureCode !== currentLectureCodeToRecord) {
                    releaseOldRecorder(); // Clean up any previous instance
                    console.log(`[instructor.js] Initializing RealtimeAudioRecorder for lecture ${currentLectureCodeToRecord}`);
                    // Ensure the RealtimeAudioRecorder class is loaded from audioRecorder.js
                    if (typeof RealtimeAudioRecorder === 'undefined') {
                        throw new Error("AudioRecorder class not found. Ensure audioRecorder.js is loaded.");
                    }
                    audioRecorder = new RealtimeAudioRecorder(currentLectureCodeToRecord);
                    setupRecorderEventHandlers(); // Attach necessary event listeners

                    // Attempt to initialize microphone access
                    const micInitialized = await audioRecorder.init();
                    if (!micInitialized) {
                        // init() logs error and might update status, throw error to stop process
                        throw new Error(audioRecorder.lastError || 'Failed to access microphone. Please check browser permissions.');
                    }
                }

                // Attempt to start the recording process (handles WS connection/fallback internally)
                console.log('[instructor.js] Calling audioRecorder.start()');
                await audioRecorder.start();
                isRecording = true; // Update local state flag

                // Update UI immediately to reflect attempting to start
                if (startRecordingBtn) startRecordingBtn.disabled = true;
                if (stopRecordingBtn) stopRecordingBtn.disabled = false;
                // Actual status text ("Connecting...", "Recording...", "Fallback...") updated by onStatusChange handler

                animateVisualizer(); // Start the visualizer animation
                console.log('[instructor.js] Recording process initiation requested.');

            } catch (error) {
                // Handle errors during initialization or start()
                console.error('[instructor.js] Error starting recording:', error);
                showError('error-message', `Failed to start recording: ${error.message}`);
                isRecording = false; // Reset state on failure
                resetRecordingUI();  // Reset buttons and status display
                releaseOldRecorder(); // Clean up potentially failed recorder instance
            } finally {
                showLoading(false); // Hide loading overlay
            }
        }); // End startRecordingBtn listener
    } else {
        console.warn("[instructor.js] #start-recording-btn not found.");
    }

    // Stop Recording Button
    if (stopRecordingBtn) {
        stopRecordingBtn.addEventListener('click', function() {
            console.log('[instructor.js] #stop-recording-btn clicked.');
            // Check local flag and recorder state
            if (!isRecording || !audioRecorder || !audioRecorder.isActive()) {
                 console.warn("Stop recording clicked, but not currently recording or recorder inactive.");
                 resetRecordingUI(); // Ensure UI is consistent
                 isRecording = false;
                 return;
            }

            console.log('[instructor.js] Calling audioRecorder.stop()');
            const stopped = audioRecorder.stop(); // stop() handles internal state and cleanup
            isRecording = false; // Update local flag immediately

            if (stopped) {
                 console.log('[instructor.js] Recording stop initiated successfully.');
                 // UI updates (button states, status text) are primarily handled by the onStatusChange handler listening for 'stopped' status
                 resetRecordingUI(); // Explicitly reset UI elements here as well
            } else {
                 console.error("[instructor.js] audioRecorder.stop() reported failure.");
                 showError('error-message', 'Failed to stop recording cleanly. Please try again.');
                 // Still attempt to reset UI even if stop failed
                 resetRecordingUI();
            }
            clearTimeout(visualizerAnimationTimeout); // Ensure visualizer animation stops
        }); // End stopRecordingBtn listener
    } else {
        console.warn("[instructor.js] #stop-recording-btn not found.");
    }

    // --- Delete Functionality Setup ---
    
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', function() {
            hideConfirmationModal();
        });
    }
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', function() {
            performDeletion();
        });
    }

    // Quiz Type Selection Event
    if (quizTypeSelect) {
        quizTypeSelect.addEventListener('change', function() {
            const isMultipleChoice = this.value === 'multiple_choice';
            
            if (quizOptionsContainer) {
                quizOptionsContainer.style.display = isMultipleChoice ? 'block' : 'none';
            }
            
            if (addOptionBtn) {
                addOptionBtn.style.display = isMultipleChoice ? 'block' : 'none';
            }
            
            if (shortAnswerContainer) {
                shortAnswerContainer.style.display = isMultipleChoice ? 'none' : 'block';
            }
        });
    }

    // Add Option Button
    if (addOptionBtn && quizOptionsContainer) {
        addOptionBtn.addEventListener('click', function() {
            const optionRows = quizOptionsContainer.querySelectorAll('.quiz-option-row');
            const newIndex = optionRows.length;
            
            if (newIndex >= 6) {
                // Limit to 6 options
                showError('quiz-error-message', 'Maximum 6 options allowed');
                return;
            }
            
            const newRow = document.createElement('div');
            newRow.className = 'quiz-option-row';
            newRow.innerHTML = `
                <input type="radio" name="correct-option" id="option-${newIndex}">
                <input type="text" class="form-control" placeholder="Option ${newIndex + 1}" data-option-index="${newIndex}">
                <button type="button" class="btn-small btn-danger remove-option-btn" data-option-index="${newIndex}">
                    <i class="fas fa-times"></i>
                </button>
            `;
            
            quizOptionsContainer.appendChild(newRow);
            
            // Show remove buttons when there are more than 2 options
            const removeButtons = quizOptionsContainer.querySelectorAll('.remove-option-btn');
            if (removeButtons.length > 2) {
                removeButtons.forEach(btn => btn.style.display = 'block');
            }
            
            // Add event listener to the new remove button
            const removeBtn = newRow.querySelector('.remove-option-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', handleRemoveOption);
            }
        });
    }
    
    // Delegate handler for remove option buttons
    function handleRemoveOption(event) {
        const rowToRemove = event.target.closest('.quiz-option-row');
        if (!rowToRemove) return;
        
        rowToRemove.remove();
        
        // Update indices and placeholders
        const optionRows = quizOptionsContainer.querySelectorAll('.quiz-option-row');
        optionRows.forEach((row, index) => {
            const radio = row.querySelector('input[type="radio"]');
            const input = row.querySelector('input[type="text"]');
            const removeBtn = row.querySelector('.remove-option-btn');
            
            radio.id = `option-${index}`;
            input.placeholder = `Option ${index + 1}`;
            input.dataset.optionIndex = index;
            removeBtn.dataset.optionIndex = index;
            
            // Hide remove buttons if only 2 options remain
            if (optionRows.length <= 2) {
                removeBtn.style.display = 'none';
            }
        });
    }

    // Create Quiz Button
    if (createQuizBtn) {
        createQuizBtn.addEventListener('click', async function() {
            try {
                if (!activeLecture || !activeLecture.code) {
                    showError('quiz-error-message', 'No active lecture selected. Please select a lecture first.');
                    return;
                }
                
                const question = quizQuestion.value.trim();
                if (!question) {
                    showError('quiz-error-message', 'Please enter a question.');
                    return;
                }
                
                const quizType = quizTypeSelect.value;
                let options = [];
                let correctAnswerValue = '';
                
                if (quizType === 'multiple_choice') {
                    // Get all options
                    const optionInputs = quizOptionsContainer.querySelectorAll('input[type="text"]');
                    options = Array.from(optionInputs).map(input => input.value.trim());
                    
                    // Validate options
                    if (options.some(opt => !opt)) {
                        showError('quiz-error-message', 'All options must be filled.');
                        return;
                    }
                    
                    // Get selected correct answer
                    const selectedRadio = quizOptionsContainer.querySelector('input[type="radio"]:checked');
                    if (!selectedRadio) {
                        showError('quiz-error-message', 'Please select a correct answer.');
                        return;
                    }
                    
                    const selectedIndex = parseInt(selectedRadio.id.replace('option-', ''));
                    correctAnswerValue = options[selectedIndex];
                } else {
                    // Short answer
                    correctAnswerValue = correctAnswer.value.trim();
                    if (!correctAnswerValue) {
                        showError('quiz-error-message', 'Please enter the correct answer.');
                        return;
                    }
                }
                
                const timeLimitValue = parseInt(timeLimit.value);
                if (isNaN(timeLimitValue) || timeLimitValue < 10 || timeLimitValue > 600) {
                    showError('quiz-error-message', 'Time limit must be between 10 and 600 seconds.');
                    return;
                }
                
                // Show loading while creating quiz
                showLoading(true);
                
                // Create the quiz via API
                const response = await fetch('/create_quiz', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        lecture_code: activeLecture.code,
                        question: question,
                        type: quizType,
                        options: quizType === 'multiple_choice' ? options : null,
                        correctAnswer: correctAnswerValue,
                        timeLimit: timeLimitValue
                    })
                });
                
                if (!response.ok) {
                    let errorMsg = `Failed to create quiz: ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorMsg;
                    } catch (e) {}
                    throw new Error(errorMsg);
                }
                
                const data = await response.json();
                
                if (data.success) {
                    // Clear form
                    quizQuestion.value = '';
                    if (correctAnswer) correctAnswer.value = '';
                    const optionInputs = quizOptionsContainer.querySelectorAll('input[type="text"]');
                    optionInputs.forEach((input, i) => {
                        if (i < 2) {
                            input.value = ''; // Clear only the first two default inputs
                        } else {
                            input.closest('.quiz-option-row').remove(); // Remove additional rows
                        }
                    });
                    
                    // Reset radio button selection
                    const firstRadio = document.getElementById('option-0');
                    if (firstRadio) firstRadio.checked = true;
                    
                    // Hide remove buttons for the default two rows
                    const removeButtons = quizOptionsContainer.querySelectorAll('.remove-option-btn');
                    removeButtons.forEach(btn => btn.style.display = 'none');
                    
                    // Load quizzes
                    loadQuizzes(activeLecture.code);
                    
                    // Show success message
                    showSuccessMessage('Quiz created successfully!');
                }
            } catch (error) {
                console.error('Error creating quiz:', error);
                showError('quiz-error-message', `Error creating quiz: ${error.message}`);
            } finally {
                showLoading(false);
            }
        });
    }

    // --- Initialize quiz management when an active lecture is selected or changed ---
    function handleLectureActivation(lecture) {
        if (lecture && lecture.code) {
            loadQuizzes(lecture.code);
            updateQuizContextDisplay(lecture); // Update quiz context when lecture activates
        } else {
            updateQuizContextDisplay(null); // Hide quiz context if no lecture is active
        }
    }

    // Modify the handlePreviousLectureClick function to call handleLectureActivation
    const originalHandlePreviousLectureClick = handlePreviousLectureClick;
    handlePreviousLectureClick = function(lecture) {
        originalHandlePreviousLectureClick.call(this, lecture);
        handleLectureActivation(lecture);
    };

    // Add a function to show success messages
    function showSuccessMessage(message) {
        const quizError = document.getElementById('quiz-error-message');
        if (quizError) {
            quizError.textContent = message;
            quizError.style.display = 'block';
            quizError.style.backgroundColor = '#d4edda';
            quizError.style.color = '#155724';
            quizError.style.borderColor = '#c3e6cb';
            
            setTimeout(() => {
                quizError.style.display = 'none';
            }, 5000);
        }
    }

    // --- Add Quiz Functions ---
    
    /**
     * Loads quizzes for a specific lecture.
     */
    async function loadQuizzes(lectureCode) {
        if (!quizList || !noQuizzesMessage) return;
        
        try {
            // Clear existing quizzes and polling intervals
            quizList.querySelectorAll('.quiz-item').forEach(item => item.remove());
            clearAllQuizPolling();
            
            // Fetch quizzes from server API instead of direct Firebase access
            const response = await fetch(`/get_lecture_quizzes?lecture_code=${lectureCode}`);
            
            if (!response.ok) {
                throw new Error(`Failed to load quizzes: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success || !data.quizzes || Object.keys(data.quizzes).length === 0) {
                noQuizzesMessage.style.display = 'block';
                return;
            }
            
            noQuizzesMessage.style.display = 'none';
            
            // Sort quizzes by creation time (newest first)
            const sortedQuizzes = Object.values(data.quizzes).sort((a, b) => b.created_at - a.created_at);
            
            // Render each quiz
            sortedQuizzes.forEach(quiz => {
                renderQuizItem(quiz);
                
                // If the quiz is active, start polling for results
                if (quiz.status === 'active') {
                    startQuizResultsPolling(lectureCode, quiz.id);
                }
            });
        } catch (error) {
            console.error('Error loading quizzes:', error);
            showError('quiz-error-message', `Error loading quizzes: ${error.message}`);
        }
    }
    
    /**
     * Renders a single quiz item in the list.
     */
    function renderQuizItem(quiz) {
        const quizItem = document.createElement('div');
        quizItem.className = 'quiz-item';
        quizItem.id = `quiz-${quiz.id}`;
        
        let statusClass = '';
        let statusText = 'Draft';
        
        if (quiz.status === 'active') {
            statusClass = 'active';
            statusText = 'Active';
        } else if (quiz.status === 'completed') {
            statusClass = 'completed';
            statusText = 'Completed';
        }
        
        // Format options or correct answer for display
        let optionsHtml = '';
        if (quiz.type === 'multiple_choice' && quiz.options) {
            optionsHtml = quiz.options.map((option, i) => {
                const isCorrect = option === quiz.correctAnswer;
                return `<div>${i+1}. ${option} ${isCorrect ? '<strong>(Correct)</strong>' : ''}</div>`;
            }).join('');
        } else {
            optionsHtml = `<div>Correct answer: <strong>${quiz.correctAnswer}</strong></div>`;
        }
        
        // Calculate time remaining if active
        let timeRemainingHtml = '';
        if (quiz.status === 'active' && quiz.endTime) {
            const now = Date.now();
            const remaining = Math.max(0, quiz.endTime - now);
            const seconds = Math.ceil(remaining / 1000);
            timeRemainingHtml = `
                <div class="time-remaining">
                    Time remaining: <span id="time-remaining-${quiz.id}">${seconds}</span> seconds
                </div>
            `;
        }
        
        // Results section (shown if completed)
        let resultsHtml = '';
        if (quiz.status === 'completed' && quiz.responses) {
            const responses = quiz.responses ? Object.values(quiz.responses) : [];
            const totalResponses = responses.length;
            const correctResponses = responses.filter(r => r.correct).length;
            const correctPercentage = totalResponses > 0 ? Math.round((correctResponses / totalResponses) * 100) : 0;
            
            // Basic statistics
            resultsHtml = `
                <div class="quiz-results">
                    <h4>Results</h4>
                    <div class="results-summary">
                        <div><strong>Total Responses:</strong> ${totalResponses}</div>
                        <div><strong>Correct Answers:</strong> ${correctResponses} (${correctPercentage}%)</div>
                    </div>
                    
                    <h4>Student Responses</h4>
                    <div class="student-response-list">
            `;
            
            // List of student responses
            if (responses.length > 0) {
                responses.forEach(response => {
                    resultsHtml += `
                        <div class="student-response ${response.correct ? 'correct' : 'incorrect'}">
                            <div>
                                <strong>${response.student_name || 'Anonymous'}</strong> 
                                (${response.student_number || 'Unknown'})
                            </div>
                            <div>
                                ${response.answer} 
                                ${response.correct ? '<i class="fas fa-check" style="color: green;"></i>' : 
                                                   '<i class="fas fa-times" style="color: red;"></i>'}
                            </div>
                        </div>
                    `;
                });
            } else {
                resultsHtml += `<div>No student responses yet.</div>`;
            }
            
            resultsHtml += `</div>`;
            
            // For multiple choice, show distribution
            if (quiz.type === 'multiple_choice' && quiz.options) {
                resultsHtml += `<div class="results-distribution">
                    <h4>Answer Distribution</h4>`;
                
                const optionCounts = {};
                quiz.options.forEach(option => {
                    optionCounts[option] = 0;
                });
                
                responses.forEach(response => {
                    if (optionCounts[response.answer] !== undefined) {
                        optionCounts[response.answer]++;
                    }
                });
                
                quiz.options.forEach(option => {
                    const count = optionCounts[option] || 0;
                    const percentage = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
                    const isCorrect = option === quiz.correctAnswer;
                    
                    resultsHtml += `
                        <div class="distribution-item">
                            <div class="distribution-label">
                                <span>${option} ${isCorrect ? '<strong>(Correct)</strong>' : ''}</span>
                                <span>${count} (${percentage}%)</span>
                            </div>
                            <div class="distribution-bar" style="width: ${percentage}%;"></div>
                        </div>
                    `;
                });
                
                resultsHtml += `</div>`;
            }
            
            resultsHtml += `</div>`;
        }
        
        // Construct the quiz item HTML
        quizItem.innerHTML = `
            <div class="quiz-item-header">
                <div class="quiz-item-title">${quiz.question}</div>
                <span class="quiz-item-status ${statusClass}">${statusText}</span>
            </div>
            <div class="quiz-item-details">
                <div>Type: ${quiz.type === 'multiple_choice' ? 'Multiple Choice' : 'Short Answer'}</div>
                <div>Time Limit: ${quiz.timeLimit} seconds</div>
                <div>${optionsHtml}</div>
                ${timeRemainingHtml}
            </div>
            <div class="quiz-item-controls">
                ${quiz.status === 'draft' ? `<button class="btn btn-primary activate-quiz-btn" data-quiz-id="${quiz.id}">Activate</button>` : ''}
                <button class="btn btn-danger delete-quiz-btn" data-quiz-id="${quiz.id}">Delete</button>
            </div>
            ${resultsHtml}
        `;
        
        quizList.appendChild(quizItem);
        
        // Add event listeners to the buttons
        const activateBtn = quizItem.querySelector('.activate-quiz-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', () => activateQuiz(quiz.lecture_code, quiz.id));
        }
        
        const deleteBtn = quizItem.querySelector('.delete-quiz-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => deleteQuiz(quiz.lecture_code, quiz.id));
        }
        
        // Start countdown timer if active
        if (quiz.status === 'active' && quiz.endTime) {
            startQuizCountdown(quiz.id, quiz.endTime);
        }
    }
    
    /**
     * Activates a quiz, making it live for students.
     */
    async function activateQuiz(lectureCode, quizId) {
        try {
            showLoading(true);
            
            const response = await fetch('/activate_quiz', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lecture_code: lectureCode,
                    quiz_id: quizId
                })
            });
            
            if (!response.ok) {
                let errorMsg = `Failed to activate quiz: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {}
                throw new Error(errorMsg);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Reload quizzes to show updated status
                loadQuizzes(lectureCode);
                showSuccessMessage('Quiz activated successfully!');
            }
        } catch (error) {
            console.error('Error activating quiz:', error);
            showError('quiz-error-message', `Error activating quiz: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }
    
    /**
     * Deletes a quiz.
     */
    async function deleteQuiz(lectureCode, quizId) {
        if (!confirm('Are you sure you want to delete this quiz? This action cannot be undone.')) {
            return;
        }
        
        try {
            showLoading(true);
            
            const response = await fetch('/delete_quiz', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lecture_code: lectureCode,
                    quiz_id: quizId
                })
            });
            
            if (!response.ok) {
                let errorMsg = `Failed to delete quiz: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {}
                throw new Error(errorMsg);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Remove quiz item from UI
                const quizItem = document.getElementById(`quiz-${quizId}`);
                if (quizItem) {
                    quizItem.remove();
                }
                
                // Check if we need to show the "no quizzes" message
                if (quizList.querySelectorAll('.quiz-item').length === 0) {
                    noQuizzesMessage.style.display = 'block';
                }
                
                // Stop any polling for this quiz
                stopQuizResultsPolling(quizId);
                
                showSuccessMessage('Quiz deleted successfully!');
            }
        } catch (error) {
            console.error('Error deleting quiz:', error);
            showError('quiz-error-message', `Error deleting quiz: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }
    
    /**
     * Starts a countdown timer for an active quiz.
     */
    function startQuizCountdown(quizId, endTime) {
        const countdownElement = document.getElementById(`time-remaining-${quizId}`);
        if (!countdownElement) return;
        
        const intervalId = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            const seconds = Math.ceil(remaining / 1000);
            
            countdownElement.textContent = seconds;
            
            if (remaining <= 0) {
                clearInterval(intervalId);
                // Quiz completion and UI update will be handled by the polling mechanism
                // which detects the status change on the server. No need to call loadQuizzes here.
                console.log(`Countdown finished for quiz ${quizId}. Polling will handle UI update.`);
            }
        }, 1000);
        
        // Store interval ID to clear it when needed
        quizPollingIntervals[`countdown-${quizId}`] = intervalId;
    }
    
    /**
     * Starts polling for quiz results updates.
     */
    function startQuizResultsPolling(lectureCode, quizId) {
        // Stop existing polling for this quiz if it exists
        if (quizPollingIntervals[quizId]) {
            clearInterval(quizPollingIntervals[quizId]);
        }
        
        // Create new polling interval
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`/get_quiz_results?lecture_code=${lectureCode}&quiz_id=${quizId}`);
                
                if (!response.ok) {
                    throw new Error(`Failed to get quiz results: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success) {
                    updateQuizItem(data.quiz);
                    
                    // If quiz is no longer active, stop polling
                    if (data.quiz.status !== 'active') {
                        stopQuizResultsPolling(quizId);
                    }
                }
            } catch (error) {
                console.error(`Error polling quiz ${quizId} results:`, error);
            }
        }, 5000); // Poll every 5 seconds
        
        quizPollingIntervals[quizId] = intervalId;
    }
    
    /**
     * Stops polling for a specific quiz's results.
     */
    function stopQuizResultsPolling(quizId) {
        if (quizPollingIntervals[quizId]) {
            clearInterval(quizPollingIntervals[quizId]);
            delete quizPollingIntervals[quizId];
        }
        
        if (quizPollingIntervals[`countdown-${quizId}`]) {
            clearInterval(quizPollingIntervals[`countdown-${quizId}`]);
            delete quizPollingIntervals[`countdown-${quizId}`];
        }
    }
    
    /**
     * Clears all quiz polling intervals.
     */
    function clearAllQuizPolling() {
        Object.values(quizPollingIntervals).forEach(intervalId => {
            clearInterval(intervalId);
        });
        quizPollingIntervals = {};
    }
    
    /**
     * Updates an existing quiz item in the UI.
     */
    function updateQuizItem(quiz) {
        // Remove existing quiz item
        const existingItem = document.getElementById(`quiz-${quiz.id}`);
        if (existingItem) {
            existingItem.remove();
        }
        
        // Render updated quiz item
        renderQuizItem(quiz);
    }

    // Initialize quiz functionality if there's already an active lecture
    if (activeLecture && activeLecture.code) {
        handleLectureActivation(activeLecture);
    }

    // Clean up when unloading page
    window.addEventListener('beforeunload', () => {
        clearAllQuizPolling();
    });

    // --- Helper Functions ---

    /** Attaches event handlers to the audioRecorder instance. */
    function setupRecorderEventHandlers() {
        if (!audioRecorder) {
            console.error("Cannot setup event handlers: audioRecorder instance is null.");
            return;
        }

        // Handle incoming transcriptions (both realtime and fallback)
        audioRecorder.onTranscription = (data) => {
            // console.debug('[instructor.js] Transcription data received:', data);
            // Only display the final completed transcription to avoid duplicates from deltas
            if (transcriptionPreview && data.text &&
                (data.event_type === 'conversation.item.input_audio_transcription.completed' ||
                 data.event_type === 'fallback_transcription.completed')) // Also show fallback results
            {
                const p = document.createElement('p');
                p.textContent = data.text;
                if (data.source === 'fallback_api' || data.event_type === 'fallback_transcription.completed') {
                    p.classList.add('fallback-transcription'); // Style fallback differently if needed
                }
                transcriptionPreview.appendChild(p);
                transcriptionPreview.scrollTop = transcriptionPreview.scrollHeight; // Auto-scroll
            } else if (data.event_type === 'conversation.item.input_audio_transcription.delta') {
                 // Optionally handle delta updates here if needed (e.g., update the last paragraph)
                 // console.debug("Delta received:", data.text);
            }
        };

        // Handle status changes from the recorder (connection, recording state, errors)
        audioRecorder.onStatusChange = (status) => {
            console.log('[instructor.js] Recorder status change:', status);
            if (!recordingStatusEl) return; // Ensure status element exists

            // Clear previous dynamic classes for status styling
            recordingStatusEl.classList.remove('active', 'fallback', 'processing', 'error');

            if (status.error) {
                // Display error and reset UI
                recordingStatusEl.textContent = `Error: ${status.error}`;
                recordingStatusEl.classList.add('error'); // Add error class for styling
                showError('error-message', `Recorder Error: ${status.error}`); // Show error prominently
                resetRecordingUI();
                isRecording = false; // Sync local state
                // Consider releasing recorder on fatal errors? Depends on reconnect logic.
                // releaseOldRecorder();
            } else if (status.status === 'fallback_mode') {
                // Indicate recording in fallback mode
                recordingStatusEl.textContent = 'Recording (Fallback Mode)';
                recordingStatusEl.classList.add('active', 'fallback');
            } else if (status.status === 'processing_fallback') {
                // Indicate processing audio chunk in fallback mode
                 recordingStatusEl.textContent = 'Processing Audio...';
                 recordingStatusEl.classList.add('active', 'processing');
            } else if (status.recording && status.status === 'capturing') {
                // Normal recording via WebSocket is active
                recordingStatusEl.textContent = 'Recording in progress...';
                recordingStatusEl.classList.add('active');
            } else if (status.recording && (status.status === 'backend_connected' || status.status === 'connecting' || status.status === 'server_ready')) {
                // WebSocket connected, waiting for stream readiness or starting
                recordingStatusEl.textContent = 'Connecting transcription service...';
                // 'active' class usually added when 'capturing' status received
            } else if (!status.recording && status.status === 'stopped') {
                // Recording explicitly stopped
                recordingStatusEl.textContent = 'Recording stopped.';
                resetRecordingUI(); // Reset buttons, timer etc.
                isRecording = false; // Sync local state
            } else if (!status.connected && status.status === 'disconnected') {
                // WebSocket disconnected (and not in fallback)
                recordingStatusEl.textContent = `Disconnected (${status.code || 'No Code'})`;
                resetRecordingUI();
                isRecording = false; // Assume recording stopped on disconnect if not fallback
            } else {
                // Default or unknown state
                recordingStatusEl.textContent = status.message || 'Waiting...';
            }
        };

        // Handle timer updates for the UI display
        audioRecorder.onTimerUpdate = (elapsedMilliseconds) => {
            updateRecordingTimerDisplay(elapsedMilliseconds);
        };
    }

    /** Releases the current audioRecorder instance if it exists. */
    function releaseOldRecorder() {
        if (audioRecorder) {
            console.log("[instructor.js] Releasing previous audio recorder instance.");
            audioRecorder.release(); // Call the recorder's cleanup method
            audioRecorder = null;    // Clear the reference
        }
         // Ensure animation stops if recorder is released
        clearTimeout(visualizerAnimationTimeout);
        if (visualizerBarElements) visualizerBarElements.forEach(bar => { bar.style.height = '5px'; });
    }

    /** Resets the recording UI elements to their default (stopped) state. */
    function resetRecordingUI() {
        if (startRecordingBtn) startRecordingBtn.disabled = false;
        if (stopRecordingBtn) stopRecordingBtn.disabled = true;
        if (recordingStatusEl) {
            recordingStatusEl.textContent = 'Click Start Recording';
            recordingStatusEl.classList.remove('active', 'fallback', 'processing', 'error');
        }
        updateRecordingTimerDisplay(0); // Reset timer display to 00:00:00
        // Stop and reset visualizer animation
        clearTimeout(visualizerAnimationTimeout);
        if (visualizerBarElements) {
            visualizerBarElements.forEach(bar => { bar.style.height = '5px'; }); // Reset bar heights
        }
    }

    /** Updates the recording timer display (HH:MM:SS). */
    function updateRecordingTimerDisplay(elapsedMilliseconds) {
        if (!recordingTimer) return;
        const totalSeconds = Math.floor(elapsedMilliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        recordingTimer.textContent = `${hours}:${minutes}:${seconds}`;
    }

    /** Animates the visualizer bars randomly while recording. */
    function animateVisualizer() {
        clearTimeout(visualizerAnimationTimeout); // Clear previous scheduled animation frame

        // Check recorder state directly - animate only if actively capturing audio
        if (!audioRecorder || !audioRecorder.isCapturing) {
             // If not capturing, reset bars to minimum height and stop animating
             if (visualizerBarElements) {
                 visualizerBarElements.forEach(bar => { bar.style.height = '5px'; });
             }
             return; // Stop the animation loop
        }

        // If capturing, update bar heights randomly
        if (visualizerBarElements) {
            visualizerBarElements.forEach(bar => {
                // Randomly set height between 5px and 60px (adjust max height as needed)
                bar.style.height = `${5 + Math.random() * 55}px`;
            });
        }

        // Schedule the next animation frame
        visualizerAnimationTimeout = setTimeout(animateVisualizer, 150 + Math.random() * 100); // Vary update frequency slightly
    }

    /** Fetches and displays the list of previous lectures for the instructor, grouped by course code. */
    function loadPreviousLectures() {
        if (!lecturesContainer) {
            console.error("Cannot load lectures: #lectures-container element not found.");
            return;
        }
        console.log("[instructor.js] Loading previous lectures...");
        lecturesContainer.innerHTML = '<div class="loading-lectures">Loading lectures...</div>'; // Show loading state

        fetch('/get_instructor_lectures')
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load lectures: ${response.status} ${response.statusText}`);
                return response.json();
            })
            .then(data => {
                console.log("[instructor.js] Received previous lectures data:", data);
                lecturesContainer.innerHTML = ''; // Clear loading/previous content

                if (data.lectures && Array.isArray(data.lectures)) {
                    if (data.lectures.length === 0) {
                        lecturesContainer.innerHTML = '<div class="no-lectures">No previous lectures found.</div>'; // Style this class
                        return;
                    }

                    // Group lectures by course code (case insensitive)
                    const courseGroups = {};
                    
                    // First, group lectures by course code
                    data.lectures.forEach(lecture => {
                        const courseCode = (lecture.metadata?.course_code || 'Unknown').toUpperCase();
                        if (!courseGroups[courseCode]) {
                            courseGroups[courseCode] = [];
                        }
                        courseGroups[courseCode].push(lecture);
                    });
                    
                    // Sort each course's lectures by date/time (newest first)
                    Object.keys(courseGroups).forEach(courseCode => {
                        courseGroups[courseCode].sort((a, b) => {
                            // Compare dates first
                            const dateA = a.metadata?.date || '';
                            const dateB = b.metadata?.date || '';
                            const dateCompare = dateB.localeCompare(dateA); // newest first
                            
                            if (dateCompare !== 0) return dateCompare;
                            
                            // If dates are the same, compare times
                            const timeA = a.metadata?.time || '';
                            const timeB = b.metadata?.time || '';
                            return timeB.localeCompare(timeA); // latest time first
                        });
                    });
                    
                    // Sort course codes by their newest lecture date/time
                    const sortedCourseCodes = Object.keys(courseGroups).sort((codeA, codeB) => {
                        // Get the newest lecture from each course (already sorted)
                        const newestLectureA = courseGroups[codeA][0]?.metadata || {};
                        const newestLectureB = courseGroups[codeB][0]?.metadata || {};
                        
                        // Compare dates first
                        const dateA = newestLectureA.date || '';
                        const dateB = newestLectureB.date || '';
                        const dateCompare = dateB.localeCompare(dateA); // newest first
                        
                        if (dateCompare !== 0) return dateCompare;
                        
                        // If dates are the same, compare times
                        const timeA = newestLectureA.time || '';
                        const timeB = newestLectureB.time || '';
                        return timeB.localeCompare(timeA); // latest time first
                    });
                    
                    // Create course groups
                    sortedCourseCodes.forEach(courseCode => {
                        // Sort lectures already done above
                        const courseGroup = document.createElement('div');
                        courseGroup.className = 'course-group';
                        courseGroup.dataset.courseCode = courseCode;
                        
                        // Create course header (clickable to expand/collapse)
                        const courseHeader = document.createElement('div');
                        courseHeader.className = 'course-header';
                        courseHeader.dataset.courseCode = courseCode;
                        courseHeader.innerHTML = `
                            <div class="course-actions">
                                <div class="course-title">
                                    <i class="fas fa-book-open"></i> ${courseCode} 
                                    <span class="lecture-count">(${courseGroups[courseCode].length} ${courseGroups[courseCode].length === 1 ? 'lecture' : 'lectures'})</span>
                                </div>
                            </div>
                            <div class="course-toggle">
                                <button class="delete-btn course-delete-btn" data-course="${courseCode}">
                                    <i class="fas fa-trash"></i>
                                </button>
                                <i class="fas fa-chevron-down"></i>
                            </div>
                        `;
                        
                        // Create lectures container for this course
                        const courseLectures = document.createElement('div');
                        courseLectures.className = 'course-lectures';
                        
                        // Add the list header only to the first expanded course
                        const listHeader = document.createElement('div');
                        listHeader.className = 'lectures-list-header';
                        listHeader.innerHTML = `
                            <div>Date</div>
                            <div>Time</div>
                            <div>Code</div>
                            <div>Actions</div>
                        `;
                        courseLectures.appendChild(listHeader);
                        
                        // Add lectures to this course group
                        courseGroups[courseCode].forEach(lecture => {
                            const item = document.createElement('div');
                            item.className = 'lecture-item';
                            item.dataset.lectureCode = lecture.code;
                            item.innerHTML = `
                                <div>${formatDate(lecture.metadata?.date)}</div>
                                <div>${formatTime(lecture.metadata?.time)}</div>
                                <div><span class="lecture-code-badge">${lecture.code || 'N/A'}</span></div>
                                <div class="lecture-actions">
                                    <button class="delete-btn lecture-delete-btn" data-lecture="${lecture.code}">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                    <button class="btn btn-small btn-primary lecture-activate-btn">Activate</button>
                                </div>
                            `;
                            
                            // Find the activate button and attach click handler only to it
                            const activateBtn = item.querySelector('.lecture-activate-btn');
                            if (activateBtn) {
                                activateBtn.addEventListener('click', (e) => {
                                    e.stopPropagation(); // Prevent triggering any parent click handlers
                                    handlePreviousLectureClick(lecture);
                                });
                            }

                            // Add delete button handler
                            const deleteBtn = item.querySelector('.lecture-delete-btn');
                            if (deleteBtn) {
                                deleteBtn.addEventListener('click', (e) => {
                                    e.stopPropagation(); // Prevent triggering any parent click handlers
                                    showLectureDeletionConfirmation(lecture);
                                });
                            }

                            
                            courseLectures.appendChild(item);
                        });
                        
                        // Add course delete button handler
                        const courseDeleteBtn = courseHeader.querySelector('.course-delete-btn');
                        if (courseDeleteBtn) {
                            courseDeleteBtn.addEventListener('click', (e) => {
                                e.stopPropagation(); // Prevent triggering parent click handlers
                                showCourseDeletionConfirmation(courseCode, courseGroups[courseCode]);
                            });
                        }

                        
                        // Add elements to the DOM
                        courseGroup.appendChild(courseHeader);
                        courseGroup.appendChild(courseLectures);
                        lecturesContainer.appendChild(courseGroup);
                        
                        // Expand the first course group by default
                        if (sortedCourseCodes.indexOf(courseCode) === 0) {
                            courseHeader.classList.add('expanded');
                            courseLectures.classList.add('expanded');
                            // Use more specific selector to ensure we only target the chevron icon
                            const chevronIcon = courseHeader.querySelector('.course-toggle > i.fa-chevron-down');
                            if (chevronIcon) {
                                chevronIcon.classList.replace('fa-chevron-down', 'fa-chevron-up');
                            }
                        }
                    });
                } else {
                    console.warn("Received invalid data format for lectures:", data);
                    lecturesContainer.innerHTML = '<div class="load-error">Could not load lectures data.</div>';
                }
            })
            .catch(error => {
                console.error('[instructor.js] Error loading previous lectures:', error);
                if(lecturesContainer) lecturesContainer.innerHTML = `<div class="load-error">Error loading lectures: ${error.message}</div>`;
            });
    }

    /** Handles clicking on a lecture item in the 'Previous Lectures' list. */
    function handlePreviousLectureClick(lecture) {
         if (!lecture || !lecture.code) return;
         console.log(`[instructor.js] Previous lecture clicked: ${lecture.code}`);

         // 1. Stop any currently active recording before switching
         if (audioRecorder && audioRecorder.isActive()) {
             console.log("Stopping current recording before switching active lecture...");
             if(stopRecordingBtn) stopRecordingBtn.click(); // Programmatically click the stop button
             // Note: There might be a slight delay until the recorder fully stops.
             // Consider adding a small timeout or check before proceeding if issues arise.
         }

        // 2. Update the global active lecture state
        activeLecture = { // Store full details
            code: lecture.code,
            course: lecture.metadata?.course_code,
            instructor: lecture.metadata?.instructor,
            date: lecture.metadata?.date,
            time: lecture.metadata?.time
        };
        activeLectureCode = lecture.code; // Keep simple code variable updated

        // 3. Send request to server to set this lecture as active
        showLoading(true); // Show loading indicator
        fetch('/set_active_lecture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lecture_code: lecture.code })
        })
        .then(response => response.json())
        .then(setData => {
            if (setData.success) {
                console.log(`[instructor.js] Server successfully set active lecture to ${lecture.code}`);
                // 4. Update UI: Show recording section, update title, reset recording state
                if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${activeLecture.course || 'N/A'}`;
                if(recordingSection) recordingSection.style.display = 'block';
                // Scroll smoothly to the recording section
                if(recordingSection) setTimeout(() => recordingSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
                resetRecordingUI();      // Reset buttons, timer, status text
                releaseOldRecorder();    // Ensure any old recorder instance is fully cleaned up
                handleLectureActivation(activeLecture); // Call this to load quizzes and update context
            } else {
                 // Handle error from server setting active lecture
                 showError('error-message', setData.error || 'Failed to activate lecture on server.');
                 updateQuizContextDisplay(null); // Hide context on error
            }
        })
        .catch(err => {
             // Handle network or other fetch errors
             console.error('[instructor.js] Error setting active lecture via API:', err);
             showError('error-message', `Error activating lecture: ${err.message}`);
         })
        .finally(() => showLoading(false)); // Hide loading indicator
    }

    // --- UI Helper Functions ---

    /** Displays an error message in a designated element and hides it after a delay. */
    function showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
            // Automatically hide the error message after 7 seconds
            setTimeout(() => { if(el) el.style.display = 'none'; }, 7000);
        } else {
            console.error(`ShowError: Element with ID "${elementId}" not found. Message: ${message}`);
        }
    }

    /** Shows or hides the global loading overlay. */
    function showLoading(show) {
        if (loadingElement) {
            loadingElement.style.display = show ? 'flex' : 'none';
        }
    }

    /** Formats a date string (e.g., "YYYY-MM-DD") into a more readable format. */
    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        try {
            // Use consistent short format e.g., "Jan 15, 2025"
            const options = { year: 'numeric', month: 'short', day: 'numeric' };
            return new Date(dateString + 'T00:00:00').toLocaleDateString(undefined, options); // Add T00:00:00 to avoid timezone issues
        } catch (e) {
            return dateString; // Return original string if formatting fails
        }
    }

    /** Formats a time string (e.g., "HH:MM") into AM/PM format. */
    function formatTime(timeString) {
        if (!timeString) return 'N/A';
        try {
            const [hours, minutes] = timeString.split(':');
            const hour = parseInt(hours, 10);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12; // Convert 0 or 12 hour to 12
            return `${hour12}:${minutes} ${ampm}`;
        } catch (e) {
            return timeString; // Return original string if formatting fails
        }
    }

    // --- Deletion Related Functions ---


    /**
     * Show confirmation dialog for deleting a single lecture.
     */
    function showLectureDeletionConfirmation(lecture) {
        deleteMode = 'lecture';
        deleteTarget = lecture;
        
        const message = `Are you sure you want to delete lecture "${lecture.code}" from ${lecture.metadata?.course_code || 'Unknown course'}?`;
        showConfirmationModal(message);
    }

    /**
     * Show confirmation dialog for deleting a course and all its lectures.
     */
    function showCourseDeletionConfirmation(courseCode, lectures) {
        deleteMode = 'course';
        deleteTarget = {
            courseCode: courseCode,
            lectures: lectures
        };
        
        const message = `Are you sure you want to delete the entire course "${courseCode}" and all ${lectures.length} lecture(s)?`;
        showConfirmationModal(message);
    }


    /**
     * Show confirmation dialog for deleting a lecture, course, or multiple items.
     */
    function showConfirmationModal(message) {
        const confirmationModal = document.getElementById('confirmation-modal');
        const confirmationMessage = document.getElementById('confirmation-message');
        
        if (confirmationModal && confirmationMessage) {
            confirmationMessage.textContent = message;
            
            // Use the animated version if available
            if (typeof window.showConfirmationModalAnimated === 'function') {
                window.showConfirmationModalAnimated();
            } else {
                confirmationModal.style.display = 'flex';
            }
        }
    }

    /**
     * Hide the confirmation modal.
     */
    function hideConfirmationModal() {
        const confirmationModal = document.getElementById('confirmation-modal');
        
        if (confirmationModal) {
            // Use the animated version if available
            if (typeof window.hideConfirmationModalAnimated === 'function') {
                window.hideConfirmationModalAnimated();
            } else {
                confirmationModal.style.display = 'none';
            }
        }
    }

    /**
     * Perform the deletion based on the current delete mode.
     */
    function performDeletion() {
        showLoading(true);
        
        switch (deleteMode) {
            case 'lecture':
                deleteLecture(deleteTarget.code)
                    .then(() => {
                        hideConfirmationModal();
                        loadPreviousLectures(); // Reload the lectures list
                    })
                    .catch(error => {
                        showError('error-message', `Failed to delete lecture: ${error.message}`);
                    })
                    .finally(() => {
                        showLoading(false);
                    });
                break;
                
            case 'course':
                deleteCourse(deleteTarget.courseCode)
                    .then(() => {
                        hideConfirmationModal();
                        loadPreviousLectures(); // Reload the lectures list
                    })
                    .catch(error => {
                        showError('error-message', `Failed to delete course: ${error.message}`);
                    })
                    .finally(() => {
                        showLoading(false);
                    });
                break;
                
                break;
        }
    }

    /**
     * Delete a single lecture by code.
     */
    async function deleteLecture(lectureCode) {
        try {
            const response = await fetch(`/delete_lecture`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lecture_code: lectureCode
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }
            
            return data;
        } catch (error) {
            console.error('Error deleting lecture:', error);
            throw error;
        }
    }

    /**
     * Delete a course and all its lectures.
     */
    async function deleteCourse(courseCode) {
        try {
            const response = await fetch(`/delete_course`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    course_code: courseCode
                })
            });
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }
            
            return data;
        } catch (error) {
            console.error('Error deleting course:', error);
            throw error;
        }
    }

    /**
     * Extracts unique course codes from lectures and populates the course code dropdown.
     * Also sets the input value to the last used course code if available.
     */
    function initializeCourseCodeDropdown() {
        if (!courseCodeInput || !courseCodeOptions) {
            console.warn("[instructor.js] Course code input or datalist not found.");
            return;
        }

        // First, try to set the last used course code from localStorage
        const lastCourseCode = localStorage.getItem('lastCourseCode');
        if (lastCourseCode) {
            courseCodeInput.value = lastCourseCode;
        }

        // Fetch previous lectures to extract course codes
        fetch('/get_instructor_lectures')
            .then(response => {
                if (!response.ok) throw new Error(`Failed to load lectures: ${response.status} ${response.statusText}`);
                return response.json();
            })
            .then(data => {
                if (data.lectures && Array.isArray(data.lectures)) {
                    // Extract and deduplicate course codes
                    const courseCodes = new Set();
                    
                    data.lectures.forEach(lecture => {
                        const courseCode = lecture.metadata?.course_code;
                        if (courseCode && typeof courseCode === 'string' && courseCode.trim() !== '') {
                            courseCodes.add(courseCode.trim());
                        }
                    });
                    
                    // Convert Set to array and store globally
                    previousCourseCodes = Array.from(courseCodes);
                    
                    // Clear existing options
                    courseCodeOptions.innerHTML = '';
                    
                    // Add options to the datalist
                    previousCourseCodes.forEach(code => {
                        const option = document.createElement('option');
                        option.value = code;
                        courseCodeOptions.appendChild(option);
                    });
                    
                    console.log("[instructor.js] Populated course code dropdown with", previousCourseCodes.length, "options");
                }
            })
            .catch(error => {
                console.error('[instructor.js] Error loading course codes:', error);
            });
    }

    // --- Initial Page Load Setup ---

    // Fetch logged-in user's info to display name/avatar and pre-fill instructor field
    fetch('/get_user_info')
        .then(response => {
            if (!response.ok) throw new Error(`User info fetch failed: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.name && userNameElement) userNameElement.textContent = data.name;
            if (data.name && userAvatarElement) {
                // Generate initials for avatar
                const nameParts = data.name.trim().split(' ');
                let initials = (nameParts[0]?.[0] || '') + (nameParts.length > 1 ? nameParts[nameParts.length - 1]?.[0] || '' : '');
                userAvatarElement.textContent = initials.toUpperCase() || 'U'; // Default to 'U' if no initials
            }
            // Pre-fill instructor name input if it's empty
            if (instructorNameInput && !instructorNameInput.value && data.name) {
                instructorNameInput.value = data.name;
            }
        })
        .catch(error => console.error('[instructor.js] Error fetching user info:', error));

    // Load the list of previous lectures created by this instructor
    loadPreviousLectures();

    // Check if there's already an active lecture set on the server on page load
     fetch('/active_lecture')
         .then(response => response.ok ? response.json() : Promise.reject('Failed to fetch active lecture status'))
         .then(activeData => {
             if (activeData?.code) {
                 console.log(`[instructor.js] Found active lecture on page load: ${activeData.code}`);
                 // Fetch full metadata for the active lecture to update UI correctly
                 return fetch(`/get_lecture_info?code=${activeData.code}`)
                     .then(infoRes => infoRes.ok ? infoRes.json() : Promise.reject('Failed to fetch active lecture info'))
                     .then(infoData => {
                          if (infoData.success && infoData.metadata) {
                              // Update global active lecture state
                              activeLecture = { code: activeData.code, ...infoData.metadata };
                              activeLectureCode = activeData.code;
                              // Update UI elements for the active lecture
                              if(recordingLectureTitle) recordingLectureTitle.textContent = `Lecture: ${activeLecture.course_code || 'N/A'}`;
                              if(recordingSection) recordingSection.style.display = 'block';
                              resetRecordingUI(); // Ensure recording UI is in the default state for the active lecture
                              handleLectureActivation(activeLecture); // Call this to load quizzes and update context
                          } else {
                              // Handle case where info fetch fails for a supposedly active lecture
                              updateQuizContextDisplay(null); // Hide context if details fail
                              throw new Error(infoData.error || 'Could not retrieve details for the active lecture');
                          }
                      });
             } else {
                 // No active lecture set on the server
                 console.log("[instructor.js] No active lecture found on server during page load.");
                 if(recordingSection) recordingSection.style.display = 'none'; // Ensure recording section is hidden
                 updateQuizContextDisplay(null); // Ensure quiz context is hidden
             }
         })
         .catch(error => {
             console.error('[instructor.js] Error checking for active lecture on page load:', error);
             // Optionally show an error to the user, or just hide the recording section
             if(recordingSection) recordingSection.style.display = 'none';
             updateQuizContextDisplay(null); // Ensure quiz context is hidden on error
         });

    console.log('[instructor.js] Instructor dashboard script initialization complete.');

    // Initialize debug tools (optional, checks internally if needed)
    setTimeout(initializeSpeechDebugTools, 1000); // Delay slightly


    /** Updates the display showing the context (active lecture) for the quiz section. */
    function updateQuizContextDisplay(lecture) {
        // Ensure elements exist before trying to update them
        const contextContainer = document.getElementById('active-lecture-quiz-context');
        const detailsSpan = document.getElementById('quiz-lecture-details');

        if (contextContainer && detailsSpan) {
            if (lecture && lecture.code) {
                // Use optional chaining and provide defaults for robustness
                const course = lecture.course || lecture.course_code || 'N/A';
                // Ensure metadata exists before accessing nested properties
                const date = formatDate(lecture.date || lecture.metadata?.date);
                const time = formatTime(lecture.time || lecture.metadata?.time);
                const code = lecture.code;
                detailsSpan.innerHTML = `${course} (${date} ${time}) - Code: ${code}`;
                contextContainer.style.display = 'block';
            } else {
                // Hide the context display if no lecture is active
                contextContainer.style.display = 'none';
                detailsSpan.textContent = 'Loading...'; // Reset text
            }
        } else {
            // Log an error if elements are missing, helps debugging
            console.error("Quiz context display elements ('active-lecture-quiz-context' or 'quiz-lecture-details') not found in the DOM.");
        }
    }

    // --- Logout Functionality ---
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Logout initiated from instructor.js...");
            showLoading(true); // Use the showLoading function defined in this scope

            // Use Firebase Authentication to sign out
            firebase.auth().signOut().then(() => {
                console.log("Firebase sign-out successful.");
                // Clear any local storage related to the session if necessary (optional)
                // localStorage.removeItem('instructorToken'); // Example

                // Redirect to the instructor login page after successful logout
                window.location.href = '/instructor_login.html';
            }).catch((error) => {
                console.error('Firebase Logout Error:', error);
                // Display error to the user using the showError function from this scope
                showError('error-message', `Logout failed: ${error.message}`);
                showLoading(false); // Hide loading overlay on error
            });
        });
    } else {
        console.warn("[instructor.js] Logout button (#logout-btn) not found.");
    }

}); // --- END DOMContentLoaded ---


// --- Speech Detection Debug Tools (Included for completeness) ---
function initializeSpeechDebugTools() {
    // Only run in debug environments or if explicitly enabled via query param
    const isDebugMode = window.location.search.includes('DEBUG=true') || ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isDebugMode || document.getElementById('speech-debug-panel')) return; // Don't run in prod or if panel exists

    console.log("Initializing speech detection debug tools...");

    // Create panel elements (using concise style setting)
    const debugPanel = document.createElement('div');
    debugPanel.id = 'speech-debug-panel';
    debugPanel.style.cssText = `position:fixed; bottom:10px; right:10px; width:280px; background:rgba(0,0,0,0.85); color:#eee; border-radius:5px; padding:10px; font-family:monospace; font-size:11px; z-index:10000; max-height:250px; overflow-y:auto; border:1px solid #444; box-shadow: 0 2px 10px rgba(0,0,0,0.5);`;

    const header = document.createElement('div');
    header.textContent = "Fallback VAD Debug";
    header.style.cssText = `font-weight:bold; margin-bottom:8px; border-bottom:1px solid #555; padding-bottom:5px;`;
    debugPanel.appendChild(header);

    const controls = document.createElement('div');
    controls.style.marginBottom = '8px';

    // Threshold Slider
    const thresholdLabel = document.createElement('label'); thresholdLabel.textContent = "Threshold: ";
    const thresholdInput = document.createElement('input'); thresholdInput.type='range'; thresholdInput.min='0.001'; thresholdInput.max='0.1'; thresholdInput.step='0.001'; thresholdInput.value='0.01'; thresholdInput.style.cssText = `width:80px; vertical-align:middle; margin: 0 5px;`;
    const thresholdValue = document.createElement('span'); thresholdValue.textContent=thresholdInput.value; thresholdValue.style.cssText=`display:inline-block; min-width:40px;`;
    thresholdInput.addEventListener('input', function() {
        thresholdValue.textContent = this.value;
        // Update recorder's threshold if available (use window reference)
        if (window.audioRecorder?.speechParams) window.audioRecorder.speechParams.energyThreshold = parseFloat(this.value);
    });
    thresholdLabel.appendChild(thresholdInput); thresholdLabel.appendChild(thresholdValue); controls.appendChild(thresholdLabel); controls.appendChild(document.createElement('br'));

    // Energy Level Display
    const energyLevelLabel = document.createElement('div'); energyLevelLabel.textContent = "Energy: ";
    const energyLevelValue = document.createElement('span'); energyLevelValue.textContent="0.00000"; energyLevelLabel.appendChild(energyLevelValue); controls.appendChild(energyLevelLabel);

    // Energy Meter Bar
    const energyMeter = document.createElement('div'); energyMeter.style.cssText = `height:8px; width:100%; background:#333; margin-top:3px; position:relative; border-radius:4px; overflow:hidden;`;
    const energyIndicator = document.createElement('div'); energyIndicator.style.cssText = `height:100%; width:0%; background:#4CAF50; transition:width 0.1s ease;`; energyMeter.appendChild(energyIndicator);
    const thresholdIndicator = document.createElement('div'); thresholdIndicator.style.cssText = `position:absolute; height:100%; width:2px; background:red; left:10%; top:0;`; energyMeter.appendChild(thresholdIndicator); // Initial position
    controls.appendChild(energyMeter);

    // Speech Status Text
    const speechStatus = document.createElement('div'); speechStatus.style.marginTop='5px'; speechStatus.textContent="Status: Waiting..."; controls.appendChild(speechStatus);

    debugPanel.appendChild(controls);

    // Event Log Section
    const logSection = document.createElement('div'); logSection.style.cssText = `margin-top:8px; border-top:1px solid #555; padding-top:8px; max-height:100px; overflow-y:auto;`;
    const logHeader = document.createElement('div'); logHeader.textContent="Log:"; logHeader.style.cssText = `font-weight:bold; margin-bottom:3px;`; logSection.appendChild(logHeader);
    const logContent = document.createElement('div'); logContent.id='speech-debug-log'; logSection.appendChild(logContent);
    debugPanel.appendChild(logSection);

    // Add panel to the page body
    document.body.appendChild(debugPanel);

    // --- Global functions for updating the debug panel ---
    window.updateSpeechDebugEnergyLevel = function(level, isSpeech) {
        if (!energyLevelValue || !energyIndicator || !thresholdIndicator || !speechStatus) return; // Ensure elements exist
        energyLevelValue.textContent = level.toFixed(5);
        // Scale energy level for meter display (relative to max threshold 0.1)
        const energyPercentage = Math.min(level / 0.1 * 100, 100);
        energyIndicator.style.width = `${energyPercentage}%`;
        energyIndicator.style.backgroundColor = isSpeech ? '#FF9800' : '#4CAF50'; // Green=inactive, Orange=active
        // Update threshold marker position
        const thresholdPercentage = Math.min(parseFloat(thresholdInput.value) / 0.1 * 100, 100);
        thresholdIndicator.style.left = `${thresholdPercentage}%`;
        // Update status text
        speechStatus.textContent = `Status: ${isSpeech ? 'ACTIVE' : 'Inactive'}`;
        speechStatus.style.color = isSpeech ? '#FF9800' : '#eee';
    };

    window.addSpeechDebugLog = function(message) {
        if (!logContent) return;
        const entry = document.createElement('div');
        // Use simpler time format
        entry.textContent = `${new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}: ${message}`;
        logContent.insertBefore(entry, logContent.firstChild); // Add newest log at the top
        // Limit log entries to prevent excessive DOM size
        while (logContent.children.length > 25) {
            logContent.removeChild(logContent.lastChild);
        }
    };

    console.log("Speech detection debug tools attached.");
}

// --- Patch RealtimeAudioRecorder Prototype for Debug Hooks ---
// This adds hooks without modifying the original class file directly (if loaded afterwards)
(function() {
    // Ensure the class exists and hasn't been patched already
    if (typeof RealtimeAudioRecorder === 'undefined' || RealtimeAudioRecorder.prototype._processSpeechDetection_original) {
        if (typeof RealtimeAudioRecorder === 'undefined') console.warn("Cannot patch RealtimeAudioRecorder - class not found.");
        return;
    }
    console.log("Attaching RealtimeAudioRecorder debug hooks...");

    // Store original methods before overwriting
    RealtimeAudioRecorder.prototype._processSpeechDetection_original = RealtimeAudioRecorder.prototype._processSpeechDetection;
    RealtimeAudioRecorder.prototype._processSpeechSegment_original = RealtimeAudioRecorder.prototype._processSpeechSegment;

    // Overwrite _processSpeechDetection to add debug call
    RealtimeAudioRecorder.prototype._processSpeechDetection = function(audioData) {
        // Call the original logic first
        this._processSpeechDetection_original(audioData);
        // If the debug UI function exists AND we are in fallback mode, calculate energy and update UI
        if (window.updateSpeechDebugEnergyLevel && this.useFallbackMode) {
             let sumSquares = 0; for (let i = 0; i < audioData.length; i++) sumSquares += audioData[i] * audioData[i];
             const energy = Math.sqrt(sumSquares / audioData.length);
             window.updateSpeechDebugEnergyLevel(energy, this.isSpeechActive); // Call global debug function
         }
    };

    // Overwrite _processSpeechSegment to add debug log call
    RealtimeAudioRecorder.prototype._processSpeechSegment = function() {
        // Add debug log *before* processing starts
        if (window.addSpeechDebugLog && this.useFallbackMode) {
             // Estimate duration based on buffer before it might be cleared by original method
             const segmentData = this.speechBuffer || [];
             const totalLength = segmentData.reduce((s, b) => s + b.length, 0);
             const durationMs = totalLength / this.options.sampleRate * 1000;
             window.addSpeechDebugLog(`Processing ${durationMs.toFixed(0)}ms segment`);
        }
        // Call the original logic
        this._processSpeechSegment_original();
    };

    console.log("RealtimeAudioRecorder debug hooks added successfully.");
})();