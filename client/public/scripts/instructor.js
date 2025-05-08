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
let socket = null;                 // Socket.IO connection instance
let _lastAttendanceKey = '';       // Last attendance key used for checking attendance 


// ────────────────────────────────────────────────────────────────────────────
// 1) Engagement scoring weights per mode
//    Tweak any numbers to suit your priorities.
const WEIGHTS_BY_MODE = {
    teaching: {
      gaze_center:      2,
      gaze_left:       -1,
      gaze_right:      -1,
      gaze_unknown:    -2,    // when face detected but not looking center/left/right
      hand_raised:      1,
      drowsy_awake:     1,
      drowsy_drowsy:   -2,
      yawn_not:         1,
      yawn_yawning:    -2,
      emotion_happy:    1,
      emotion_neutral:  0,
      emotion_surprise: 0,
      emotion_negative:-1,
      pose_forward:     1,
      pose_left:       -1,
      pose_right:      -1,
      pose_up:         -1,
      pose_down:       -1
    },
    class_discussion: {
      gaze_center:      1,
      gaze_left:        1,
      gaze_right:       1,
      gaze_unknown:    -1,
      hand_raised:      2,
      drowsy_awake:     1,
      drowsy_drowsy:   -2,
      yawn_not:         1,
      yawn_yawning:    -2,
      emotion_happy:    1,
      emotion_neutral:  0,
      emotion_surprise: 1,
      emotion_negative:-1,
      pose_forward:     1,
      pose_left:        0,
      pose_right:       0,
      pose_up:         -1,
      pose_down:       -1
    },
    group_work: {
      gaze_center:      0,
      gaze_left:       -1,
      gaze_right:      -1,
      gaze_unknown:    -2,
      hand_raised:      2,    // raising hand might signal wanting input
      drowsy_awake:     1,
      drowsy_drowsy:   -2,
      yawn_not:         1,
      yawn_yawning:    -2,
      emotion_happy:    1,
      emotion_neutral:  0,
      emotion_surprise: 0,
      emotion_negative:-1,
      pose_forward:     1,
      pose_left:        0,
      pose_right:       0,
      pose_up:         -1,
      pose_down:       -1
    },
    break: {
      gaze_center:     -2,
      gaze_left:       -2,
      gaze_right:      -2,
      gaze_unknown:    -2,
      hand_raised:     -1,
      drowsy_awake:     0,
      drowsy_drowsy:    1,   // a little drowsiness OK on break
      yawn_not:         0,
      yawn_yawning:     1,
      emotion_happy:    1,
      emotion_neutral:  0,
      emotion_surprise: 0,
      emotion_negative: 0,
      pose_forward:    -1,
      pose_left:       -1,
      pose_right:      -1,
      pose_up:         -1,
      pose_down:       -1
    },
    exam: {
      gaze_center:      1,
      gaze_left:        0,
      gaze_right:       0,
      gaze_unknown:    -1,
      hand_raised:      0,
      drowsy_awake:     1,
      drowsy_drowsy:   -2,
      yawn_not:         1,
      yawn_yawning:    -2,
      emotion_happy:    1,
      emotion_neutral:  0,
      emotion_surprise: 0,
      emotion_negative:-1,
      pose_forward:     2,
      pose_left:       -2,
      pose_right:      -2,
      pose_up:         -2,
      pose_down:       -2
    }
  };
  
  // ────────────────────────────────────────────────────────────────────────────
  // 2) Helpers
  
  // Parse a key like "2025-04-27_16-57-48" → millisecond timestamp
  function parseEngKey(key) {
    if (typeof key === 'string' && key.includes('_')) {
      const [date, time] = key.split('_');
      return new Date(`${date} ${time.replace(/-/g, ':')}`).getTime();
    } else {
      // assume it's a Unix timestamp string or number
      return parseInt(key);
    }
  }
  
  // Destroy an existing Chart.js instance on this canvas
  function destroyIfExists(canvasId) {
    const chart = Chart.getChart(canvasId);
    if (chart) chart.destroy();
  }
  
  // ────────────────────────────────────────────────────────────────────────────
  // 3) Combined feature‐based engagement evaluator
  
// ✅ USE THIS for now if you're showing Engaging vs Not Engaging:
function evaluateEngagement(record, mode) {
    const awake = record.drowsy_text === 'Awake';
    const notYawning = record.yawn_text === 'Not Yawning';
    const gazeCenter = record.gaze_text === 'Looking Center';
    const pose = record.pose_text;
    const poseGoodTeach = ['Forward', 'Looking Up'].includes(pose);
    const poseGoodExam = ['Forward', 'Looking Down'].includes(pose);
    const poseExists = pose !== 'Not Detected';
    const handNotRaised = record.hand_text === 'Not Raised';
    const emotion = record.emotion_text;
    const emotionOK = !['angry', 'sad', 'fear'].includes(emotion);
    const emotionNeutralOrFocused = ['neutral', 'focused'].includes(emotion);
  
    if (mode === 'break') return true;
  
    if (mode === 'teaching') {
      return awake && notYawning && gazeCenter && poseGoodTeach && emotionOK;
    }
  
    if (mode === 'discussion') {
      return awake && notYawning && poseExists && emotion !== 'angry';
    }
  
    if (mode === 'exam') {
      return awake && notYawning && gazeCenter && poseGoodExam && handNotRaised && emotionNeutralOrFocused;
    }
  
    return false;
  }
  


  function drawPieChart(good, bad) {
    const ctx = document.getElementById('behaviorPieChart').getContext('2d');
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Positive Behavior', 'Negative Behavior'],
            datasets: [{
                data: [good, bad],
                backgroundColor: ['#4CAF50', '#F44336']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function drawBarChart(modePerformance) {
    const ctx    = document.getElementById('behaviorBarChart').getContext('2d');
    const labels = Object.keys(modePerformance);
  
    // map to your engaging/disengaging keys:
    const goodData = labels.map(label => modePerformance[label].engaging  || 0);
    const badData  = labels.map(label => modePerformance[label].disengaging || 0);
  
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Positive', data: goodData, backgroundColor: '#4CAF50' },
          { label: 'Negative',  data: badData,  backgroundColor: '#F44336' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }


function drawPosePieChart(poseCounts) {
    const ctx = document.getElementById('posePieChart').getContext('2d');
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(poseCounts),
            datasets: [{
                data: Object.values(poseCounts),
                backgroundColor: ['#4caf50', '#2196f3', '#f44336', '#ffeb3b', '#9c27b0', '#9e9e9e']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function drawGazeDoughnutChart(gazeCounts) {
    const ctx = document.getElementById('gazeDoughnutChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(gazeCounts),
            datasets: [{
                data: Object.values(gazeCounts),
                backgroundColor: ['#4caf50', '#2196f3', '#f44336', '#9e9e9e']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function drawEmotionBarChart(emotionCounts) {
    const ctx = document.getElementById('emotionBarChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(emotionCounts),
            datasets: [{
                label: 'Emotions',
                data: Object.values(emotionCounts),
                backgroundColor: '#42a5f5'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function drawYawningPieChart(yawnCounts) {
    const ctx = document.getElementById('yawnPieChart').getContext('2d');
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(yawnCounts),
            datasets: [{
                data: Object.values(yawnCounts),
                backgroundColor: ['#4caf50', '#f44336']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}


function drawBehaviorPieOverlayChart(canvasId, engagingCount, disengagingCount) {
    destroyIfExists(canvasId); // Destroy existing chart on this canvas
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) {
        console.warn(`Canvas with ID ${canvasId} not found for student card pie overlay.`);
        return;
    }

    new Chart(ctx, {
       type: 'pie',
       data: {
           // labels: ['Engaging', 'Disengaging'], // Keep labels minimal or remove for small chart
           datasets: [{
               data: [engagingCount, disengagingCount],
               backgroundColor: ['#4CAF50', '#F44336'], // Green for engaging, Red for disengaging
               borderColor: 'rgba(255, 255, 255, 0.5)', // Optional: slight border for segments
               borderWidth: 1
           }]
       },
       options: {
           responsive: true,
           maintainAspectRatio: false, // Important for small canvas sizes
           plugins: {
               legend: {
                   display: false // No legend for this small overlay
               },
               tooltip: {
                   enabled: false // No tooltips for this small overlay
               }
           },
           animation: {
               duration: 0 // Disable animation for faster rendering if needed
           }
       }
   });
}

// … your parseEngKey / destroyIfExists / evaluateEngagement …

// 1) Nearest‐mode finder
function findNearestMode(behaviorTime, modesTimeline) {
    if (!modesTimeline.length) return null;
    let nearest = modesTimeline[0];
    for (const mode of modesTimeline) {
      if (mode.time <= behaviorTime) nearest = mode;
      else break;
    }
    return nearest;
  }
  
  // 2) Class‐mode setter (exposed on window)
  window.setClassMode = async function(mode) {
    const lectureCode = activeLecture?.code;
    if (!lectureCode) {
      return alert('Please generate or select a lecture first.');
    }
    try {
      const res = await fetch('/set_class_mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lecture_code: lectureCode, mode })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      // toggle active CSS on your mode buttons:
      document
        .querySelectorAll('#class-mode-buttons .mode-button')
        .forEach(btn => btn.classList.toggle(
          'active',
          btn.getAttribute('onclick')?.includes(`'${mode}'`)
        ));
    } catch (err) {
      console.error('Failed to save class mode:', err);
      alert('Error saving mode: ' + err.message);
    }
  };


  async function fetchAIRecommendations(name, metrics) {
    const res = await fetch("/api/generate-recommendation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, metrics })
    });
    if (!res.ok) throw new Error("AI fetch failed");
    const { recommendations } = await res.json();
    // split into lines, drop empty
    return recommendations.split(/\r?\n/).filter(l => l.trim());
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4) Full replacement openStudentModal()
  
  async function openStudentModal(name, id) {
    const modal      = document.getElementById('student-modal');
    const nameEl     = document.getElementById('student-modal-name');
    const idEl       = document.getElementById('student-modal-id');
    const checkinEl  = document.getElementById('student-modal-checkin');
    const checkoutEl = document.getElementById('student-modal-checkout');
    const engagingEl   = document.getElementById('engaging-percent');
    const disengagingEl = document.getElementById('disengaging-percent');
    const closeBtn   = document.getElementById('close-student-modal');
    const studentProfileImgEl = document.getElementById('student-modal-profile-img'); // Added for the header profile image
    // const studentNameVisualEl = document.getElementById('student-modal-name-visual'); // Removed
    // const studentImageVisualEl = document.getElementById('student-modal-profile-image-visual'); // Removed
 
     // show loading texts
    nameEl.textContent = name; // Keep this for the modal header
    idEl.textContent      = `${id}`;
    // if (studentNameVisualEl) studentNameVisualEl.textContent = name; // Removed
    if (studentProfileImgEl) studentProfileImgEl.src = 'images/default_student_avatar.png'; // Set default before loading
    checkinEl.textContent = 'Loading…';
    checkoutEl.textContent= 'Loading…';
    if (engagingEl)   engagingEl.textContent = '…';
    if (disengagingEl) disengagingEl.textContent = '…';
  
    modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
  
    try {
      const lectureCode = activeLecture.code;
      // fetch both engagement records and class modes in parallel
      const [studRes, modesRes] = await Promise.all([
        fetch(`/get_student_engagement?lecture_code=${lectureCode}&student_id=${id}`),
        fetch(`/get_class_modes?lecture_code=${lectureCode}`)
      ]);
      const studData  = await studRes.json();
      const modesData = await modesRes.json();
      if (!studData.success)  throw new Error(studData.error);
      if (!modesData.success) throw new Error(modesData.error);
  
      const engagementRecords = studData.engagement  || {};
      const atInfo           = studData.attendance  || {};
      const profileImageUrl  = studData.profileImageUrl;
 
      if (studentProfileImgEl) {
        studentProfileImgEl.src = profileImageUrl || 'images/default_student_avatar.png';
        studentProfileImgEl.onerror = () => {
            if (studentProfileImgEl) studentProfileImgEl.src = 'images/default_student_avatar.png';
        };
      }
 
      // update attendance times
      checkinEl.textContent  = `${atInfo.check_in_time || 'N/A'}`;
      checkoutEl.textContent = `${atInfo.check_out_time|| 'N/A'}`;
  
      // initialize tally counters
      const poseCounts = {
        'Forward':0, 'Looking Left':0, 'Looking Right':0,
        'Looking Up':0, 'Looking Down':0, 'Not Detected':0
      };
      const gazeCounts = {
        'Looking Center':0, 'Looking Left':0,
        'Looking Right':0, 'Not Detected':0
      };
      const emotionCounts = {
        'happy':0, 'neutral':0, 'surprise':0,
        'angry':0, 'sad':0, 'fear':0, 'Detecting...':0
      };
      const yawnCounts = {'Not Yawning':0, 'Yawning':0};
  
      // build a sorted timeline of class modes
      const modesTimeline = Object.entries(modesData.modes || {})
        .map(([ts,o]) => ({ time:+ts, mode:o.mode }))
        .sort((a,b)=>a.time-b.time);
  
      // overall engaging/disengaging tally
      let total = { engaging:0, disengaging:0 };
      const byMode = {}; // { teaching:{eng,dis}, discussion:{…}, … }
  
      for (const [key, rec] of Object.entries(engagementRecords)) {
        const ts = parseEngKey(key);
        // find the last mode whose timestamp ≤ this record
        const mObj = findNearestMode(ts, modesTimeline) || { mode: 'teaching' };
        const isEng = evaluateEngagement(rec, mObj.mode);
  
        // increment each feature counter
        poseCounts   [rec.pose_text]     = (poseCounts   [rec.pose_text]     || 0) + 1;
        gazeCounts   [rec.gaze_text]     = (gazeCounts   [rec.gaze_text]     || 0) + 1;
        emotionCounts[rec.emotion_text]  = (emotionCounts[rec.emotion_text]  || 0) + 1;
        yawnCounts   [rec.yawn_text]     = (yawnCounts   [rec.yawn_text]     || 0) + 1;
  
        // increment overall and per-mode
        total[isEng?'engaging':'disengaging']++;
        if (!byMode[mObj.mode]) byMode[mObj.mode] = { engaging:0, disengaging:0 };
        byMode[mObj.mode][isEng?'engaging':'disengaging']++;
      }
  
      // compute overall percentages
      const sum  = total.engaging + total.disengaging || 1;
      const pctE = (total.engaging/sum*100).toFixed(1);
      const pctD = (100 - pctE).toFixed(1);
      console.log(`openStudentModal(${name},${id}) →`, total, pctE, pctD);
      if (engagingEl)   engagingEl.textContent   = `${pctE}%`;
      if (disengagingEl) disengagingEl.textContent = `${pctD}%`;
  
      // clear any old charts
      ['behaviorPieChart','behaviorBarChart',
       'posePieChart','gazeDoughnutChart',
       'emotionBarChart','yawnPieChart']
       .forEach(id=>destroyIfExists(id));
  
      // draw all six
      drawPosePieChart(poseCounts);
      drawGazeDoughnutChart(gazeCounts);
      drawEmotionBarChart(emotionCounts);
      drawYawningPieChart(yawnCounts);
      drawPieChart(total.engaging, total.disengaging); // This is for the main modal chart
      drawBarChart(byMode);
      // drawBehaviorPieOverlayChart(total.engaging, total.disengaging); // This was for the old modal overlay, now handled per card
 
       // ➊ Prepare the container
         const recContainer = document.getElementById("recommendation-list");
        recContainer.innerHTML = "<li>Loading suggestions…</li>";

        // ➋ Call the AI endpoint
        try {
        const metrics = { total, byMode, poseCounts, gazeCounts /* etc */ };
        const recs = await fetchAIRecommendations(name, metrics);
        recContainer.innerHTML = recs
        .map(raw => {
          // 1) strip any leading “- ”, “* ”, or “# ”
          let text = raw.replace(/^[-*#]\s*/, "").trim();
    
          // 2) convert **bold** into <strong>…</strong>
          text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    
          // 3) if this line was a “- Action…” / “- Rationale…” / “- Example…”,
          //    render it without a bullet and indent it
          if (raw.trim().startsWith("-")) {
            return `<li style="list-style:none; margin-left:1.5em;">${text}</li>`;
          }
    
          // 4) otherwise it’s a “1.” / “2.” / “3.” line — bold its number
          text = text.replace(/^(\d+\.)\s*/, "<strong>$1</strong> ");
    
          // 5) wrap in <li> (it’ll get the normal bullet)
          return `<li>${text}</li>`;
        })
        .join("");
        } catch (e) {
        recContainer.innerHTML = "<li>Could not load AI recommendations.</li>";
        console.error(e);
        }
  
    } catch (err) {
      console.error('Error loading student analysis:', err);
      if (percentEl) percentEl.textContent = 'Error loading engagement';
    }
  }




// --- DOMContentLoaded Event Listener ---
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

    setInterval(() => {
        if (activeLecture && activeLecture.code) {
            loadStudentsAttended(activeLecture.code);
        }
    }, 10000); // Refresh every 10 seconds

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

    // Engagement Detection Elements
    const engagementToggle = document.getElementById('engagement-detection-toggle');
    const engagementStatusIndicator = document.getElementById('engagement-status-indicator');


    // --- State Variables (Local to DOMContentLoaded) ---
    let isGeneratingCode = false; // Flag to prevent multiple generate requests
    let currentHeatmapOverrideMode = null; // Track the user-selected mode for the heatmap

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

    // --- Initialize Socket.IO ---
    try {
        socket = io(); // Connect to the server hosting this page
        console.log('[instructor.js] Socket.IO connection initialized.');

        socket.on('connect', () => {
            console.log('[instructor.js] Socket.IO connected:', socket.id);
            // Optionally join a room based on instructor ID if needed later
        });

        socket.on('disconnect', (reason) => {
            console.warn('[instructor.js] Socket.IO disconnected:', reason);
        });

        socket.on('connect_error', (error) => {
            console.error('[instructor.js] Socket.IO connection error:', error);
            showError('error-message', 'Real-time connection failed. Some features might be unavailable.');
        });

    } catch (error) {
        console.error('[instructor.js] Failed to initialize Socket.IO:', error);
        showError('error-message', 'Failed to initialize real-time connection.');
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
                         resetEngagementDetectionUI(); // Reset toggle when new lecture is active

                         // **new**: record a default “teaching” mode immediately
                         window.setClassMode('teaching');

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
                
                // Show loading and disable button
                showLoading(true);
                createQuizBtn.disabled = true;
                createQuizBtn.textContent = 'Creating...';
                
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
                // Re-enable button and restore text
                createQuizBtn.disabled = false;
                createQuizBtn.textContent = 'Create Quiz';
            }
        });
    }

    // --- Initialize quiz management when an active lecture is selected or changed ---
    function handleLectureActivation(lecture) {
        if (lecture && lecture.code) {
            currentHeatmapOverrideMode = null; // Reset override on lecture change
            loadQuizzes(lecture.code);
            updateQuizContextDisplay(lecture);
            loadStudentsAttended(lecture.code); // <<<<< ADD THIS
            drawClassHeatmap(lecture.code); // Use historical modes on activation (override is null)

        } else {
            updateQuizContextDisplay(null);
            document.getElementById('students-attended-container').innerHTML = ''; // Clear students if no lecture
        }
    }

    setInterval(() => {
        if (activeLectureCode) {
          // re-fetch and redraw every 10 seconds using historical or override mode
          loadStudentsAttended(activeLectureCode);
          drawClassHeatmap(activeLectureCode, currentHeatmapOverrideMode); // Pass current override
        }
      }, 10000);

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

    // --- Engagement Detection Event Listener ---
    if (engagementToggle && engagementStatusIndicator) {
        engagementToggle.addEventListener('change', function() {
            const isEnabled = this.checked;

            if (!activeLecture || !activeLecture.code) {
                showError('error-message', 'Cannot toggle engagement detection: No active lecture.');
                this.checked = !isEnabled; // Revert the toggle
                return;
            }

            if (!socket || !socket.connected) {
                showError('error-message', 'Cannot toggle engagement detection: Real-time connection unavailable.');
                this.checked = !isEnabled; // Revert the toggle
                return;
            }

            // Update UI indicator
            engagementStatusIndicator.textContent = isEnabled ? '(Active)' : '(Inactive)';
            engagementStatusIndicator.classList.toggle('active', isEnabled);

            // Emit event to server
            const eventData = {
                lectureCode: activeLecture.code,
                enabled: isEnabled
            };
            socket.emit('engagement_detection_status', eventData, (ack) => {
                if (ack?.success) {
                    console.log(`[instructor.js] Engagement detection status for ${activeLecture.code} updated to ${isEnabled}`);
                } else {
                    console.error('[instructor.js] Failed to update engagement detection status on server:', ack?.error || 'No acknowledgement');
                    showError('error-message', `Failed to update status: ${ack?.error || 'Server error'}`);
                    // Revert UI on failure
                    this.checked = !isEnabled;
                    engagementStatusIndicator.textContent = !isEnabled ? '(Active)' : '(Inactive)';
                    engagementStatusIndicator.classList.toggle('active', !isEnabled);
                }
            });
        });
    } else {
        console.warn("[instructor.js] Engagement detection toggle or status indicator not found.");
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

       // Handle incoming transcriptions (WebRTC only)
       audioRecorder.onTranscription = (data) => {
           // console.debug('[instructor.js] Transcription data received:', data);
           // Only display the final completed transcription or deltas
           // Only display the final completed transcription
           if (transcriptionPreview && data.text &&
               data.event_type === 'conversation.item.input_audio_transcription.completed')
           {
               const p = document.createElement('p');
               p.textContent = data.text;
               // Removed fallback styling
               transcriptionPreview.appendChild(p);
               transcriptionPreview.scrollTop = transcriptionPreview.scrollHeight; // Auto-scroll
            }
        };

        // Handle status changes from the recorder (connection, recording state, errors)
        audioRecorder.onStatusChange = (status) => {
            console.log('[instructor.js] Recorder status change:', status);
            if (!recordingStatusEl) return; // Ensure status element exists

           // Clear previous dynamic classes for status styling
           recordingStatusEl.classList.remove('active', 'error'); // Removed fallback, processing

           if (status.error) {
               // Display error and reset UI
               recordingStatusEl.textContent = `Error: ${status.error}`;
               recordingStatusEl.classList.add('error'); // Add error class for styling
               showError('error-message', `Recorder Error: ${status.error}`); // Show error prominently
               resetRecordingUI();
               isRecording = false; // Sync local state
               releaseOldRecorder(); // Release recorder on error now that fallback is gone
           } else if (status.recording && (status.status === 'webrtc_connected' || status.status === 'peer_connected' || status.status === 'ice_connected')) {
               // WebRTC connected and likely capturing
               recordingStatusEl.textContent = 'Recording in progress...';
               recordingStatusEl.classList.add('active');
           } else if (status.recording && (status.status === 'connecting_webrtc' || status.status === 'peer_connecting' || status.status === 'ice_checking')) {
               // WebRTC connection in progress
               recordingStatusEl.textContent = 'Connecting transcription service...';
           } else if (!status.recording && status.status === 'stopped') {
               // Recording explicitly stopped
               recordingStatusEl.textContent = 'Recording stopped.';
               resetRecordingUI(); // Reset buttons, timer etc.
               isRecording = false; // Sync local state
           } else if (!status.connected && (status.status === 'webrtc_closed' || status.status === 'peer_disconnected' || status.status === 'ice_disconnected' || status.status === 'webrtc_failed')) {
               // WebRTC disconnected or failed
               recordingStatusEl.textContent = `Disconnected (${status.status})`;
               resetRecordingUI();
               isRecording = false; // Assume recording stopped on disconnect/failure
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
           recordingStatusEl.classList.remove('active', 'error'); // Removed fallback, processing
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
                resetEngagementDetectionUI(); // Reset toggle when activating a previous lecture
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

    /** Resets the Engagement Detection toggle and indicator to default (off). */
    function resetEngagementDetectionUI() {
        if (engagementToggle) {
            engagementToggle.checked = false;
        }
        if (engagementStatusIndicator) {
            engagementStatusIndicator.textContent = '(Inactive)';
            engagementStatusIndicator.classList.remove('active');
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

   // Removed debug tools initialization

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

    // --- Logout Functionality (REMOVED - Handled globally by app.js) ---
    // The logout link (#logout-link) in the header is now handled by app.js,
    // which includes both Firebase sign-out and server-side session destruction.
    // The old code targeting #logout-btn has been removed to prevent conflicts
    // and the "Logout button (#logout-btn) not found" warning.

    async function loadStudentsAttended(lectureCode) {
        console.log('[DEBUG] loadStudentsAttended CALLED for lecture:', lectureCode);
      
        const studentsAttendedContainer = document.getElementById('students-attended-container');
        if (!studentsAttendedContainer || !lectureCode) return;
      
        try {
          const attendanceResponse = await fetch(`/get_lecture_attendance?lecture_code=${lectureCode}`);
          const attendanceData = await attendanceResponse.json();
      
          if (!attendanceData.success || !attendanceData.attendance || Object.keys(attendanceData.attendance).length === 0) {
            console.warn('No attendance data found for this lecture or empty attendance.');
            studentsAttendedContainer.innerHTML = '<div style="width:100%; text-align:center; color: var(--secondary-text);">No students have joined this lecture yet.</div>';
            Chart.getChart('classHeatmapChart')?.destroy();
            const heatmapCanvas = document.getElementById('classHeatmapChart');
            if(heatmapCanvas) heatmapCanvas.style.display = 'none';
            const noDataMsg = document.getElementById('no-data-message');
            if(noDataMsg) noDataMsg.style.display = 'block';
            _lastAttendanceKey = '';
            return;
          }
      
          const attendance = attendanceData.attendance;
          const studentEntries = Object.entries(attendance); // Use entries to get both ID and data
          
          // Create a key based on student IDs and their profile image URLs + engagement summary to detect actual changes
          const currentAttendanceStateKey = studentEntries.map(([studentId, data]) =>
              `${studentId}_${data.profileImageUrl || 'default'}_${data.engagementSummary?.positive || 0}_${data.engagementSummary?.negative || 0}`
          ).sort().join('|');

          if (currentAttendanceStateKey === _lastAttendanceKey) {
            console.debug('Attendance data (including images/engagement) unchanged; skipping UI update.');
            return;
          }
          _lastAttendanceKey = currentAttendanceStateKey;
      
          studentsAttendedContainer.innerHTML = ''; // Clear previous cards
          
          for (const [studentId, studentData] of studentEntries) {
            const studentName = studentData.name || 'Unnamed Student';
            const studentNumber = studentData.student_number || studentId; // Use student_number if available
            const profileImageUrl = studentData.profileImageUrl || 'images/default_student_avatar.png';
            const engagementSummary = studentData.engagementSummary || { positive: 0, negative: 0 };

            const card = document.createElement('div');
            card.className = 'student-attended-card';
            card.dataset.studentId = studentNumber; // Use student_number for consistency if it's the primary ID
            card.dataset.studentName = studentName;

            const infoDiv = document.createElement('div');
            infoDiv.className = 'student-card-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'student-card-name';
            nameDiv.textContent = studentName;
            
            const idDiv = document.createElement('div');
            idDiv.className = 'student-card-id';
            idDiv.textContent = studentNumber;
            
            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(idDiv);
            
            const imageContainer = document.createElement('div');
            imageContainer.className = 'student-card-image-container';
            
            const img = document.createElement('img');
            img.className = 'student-card-profile-image';
            img.src = profileImageUrl;
            img.alt = `${studentName}'s profile picture`;
            img.onerror = () => { img.src = 'images/default_student_avatar.png'; }; // Fallback
            
            const pieOverlay = document.createElement('div');
            pieOverlay.className = 'student-card-pie-overlay';
            const canvas = document.createElement('canvas');
            const canvasId = `student-pie-${studentNumber}-${lectureCode}`; // Ensure unique ID
            canvas.id = canvasId;
            
            pieOverlay.appendChild(canvas);
            imageContainer.appendChild(img);
            imageContainer.appendChild(pieOverlay);
            
            card.appendChild(infoDiv);
            card.appendChild(imageContainer);
            
            card.addEventListener('click', () => {
              openStudentModal(studentName, studentNumber); // Pass studentNumber as ID
            });
            
            studentsAttendedContainer.appendChild(card);
            
            // Draw the pie chart for this student card
            // Ensure counts are numbers
            const positiveCount = Number(engagementSummary.positive) || 0;
            const negativeCount = Number(engagementSummary.negative) || 0;
            if (positiveCount > 0 || negativeCount > 0) {
                 // Delay slightly to ensure canvas is in DOM, though appendChild should be synchronous
                setTimeout(() => drawBehaviorPieOverlayChart(canvasId, positiveCount, negativeCount), 0);
            } else {
                // console.debug(`No engagement data for pie chart for student ${studentNumber}`);
                // Optionally hide pieOverlay if no data: pieOverlay.style.display = 'none';
            }
          }
      
          drawClassHeatmap(lectureCode);
      
        } catch (error) {
          console.error('Error loading attendance:', error);
          studentsAttendedContainer.innerHTML = '<div>Error loading students.</div>';
        }
      }



    // expose globally so inline onclicks can see it
  window.setClassMode = async function(mode) {
    const lectureCode = activeLecture?.code;
    if (!lectureCode) {
      return alert('Please generate or select a lecture first.');
    }
    try {
      const res = await fetch('/set_class_mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lecture_code: lectureCode, mode })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      console.log(`📚 Mode saved: ${mode} @ ${lectureCode}`);
      document
        .querySelectorAll('#class-mode-buttons .mode-button')
        .forEach(btn => btn.classList.toggle(
          'active',
          btn.getAttribute('onclick')?.includes(`'${mode}'`)
        ));
      // --- MODIFIED: Update override state and redraw heatmap ---
      currentHeatmapOverrideMode = mode; // Set the override mode
      drawClassHeatmap(lectureCode, currentHeatmapOverrideMode);
      // ------------------------------------------------------
    } catch (err) {
      console.error('Failed to save class mode:', err);
      alert('Error saving mode: ' + err.message);
    }
  };
    


/**
 * Build and render the “Class Engagement Over Time” heat-map.
 * Each row = a student; each column = a timestamp; green = engaged, red = not.
 */
/**
 * Render a “Class Engagement Over Time” heat-map.
 * Rows = students; columns = time-slots; green = engaged, red = not.
 */
/**
 * Render the “Class Engagement Over Time” heat-map.
 * Rows = students; columns = time-slots; green = engaged, red = not.
 */
async function drawClassHeatmap(lectureCode, overrideMode = null) { // Added overrideMode parameter
    if (!lectureCode) return;
    console.log(`[DEBUG] drawClassHeatmap called for ${lectureCode}, overrideMode: ${overrideMode}`); // Log override mode

    // 1) Load attendance
    const attRes = await fetch(
      `/get_lecture_attendance?lecture_code=${lectureCode}`
    );
    const { attendance = {} } = await attRes.json();
    const studentIds   = Object.keys(attendance);
    const studentNames = studentIds.map(id => attendance[id].name || id); // Use original order
  
    // 2) Fetch each student’s raw engagement map
    const rawMaps = await Promise.all(
      studentIds.map(id =>
        fetch(
          `/get_student_engagement?lecture_code=${lectureCode}&student_id=${id}`
        )
          .then(r => r.json())
          .then(d => d.engagement || {})
      )
    );
  
    // 2b) Fetch the class-mode timeline
    const modesRes = await fetch(
      `/get_class_modes?lecture_code=${lectureCode}`
    );
    const { modes = {} } = await modesRes.json();
    // convert to sorted [{ time: ms, mode }]
    const modesTimeline = Object.entries(modes)
      .map(([ts, o]) => ({ time: Number(ts), mode: o.mode }))
      .sort((a, b) => a.time - b.time);
  
    // — nothing to show?
    if (rawMaps.every(m => Object.keys(m).length === 0)) {
      Chart.getChart("classHeatmapChart")?.destroy();
      document.getElementById("classHeatmapChart").style.display = "none";
      document.getElementById("no-data-message").style.display   = "block";
      return;
    }
  
    // 3) For each student, build a sorted [ms, boolean] list
    const stateTimelines = rawMaps.map(map => {
      return Object.entries(map)
        .map(([msStr, rec]) => {
          const ms = Number(msStr) || Date.parse(msStr);
          // Use overrideMode if provided, otherwise find historical mode
          const evaluationMode = overrideMode || (findNearestMode(ms, modesTimeline)?.mode) || 'teaching';
          const engaged = evaluateEngagement(rec, evaluationMode);
          return [ms, engaged];
        })
        .filter(([ms]) => !isNaN(ms))
        .sort((a, b) => a[0] - b[0]);
    });
  
    // 4) Build a uniform time axis (1s steps) from first to last event
    const allMs = stateTimelines.flatMap(arr => arr.map(([ms]) => ms));
    const startMs = Math.min(...allMs);
    const endMs   = Math.max(...allMs);
    const stepMs  = 1000;  // 1-second resolution
    const allTimes = [];
    for (let t = startMs; t <= endMs; t += stepMs) {
      allTimes.push(new Date(t));
    }
  
    // 5) Walk through timeline + events to fill matrixData
    const matrixData = [];
    stateTimelines.forEach((events, rowIdx) => {
      let pointer   = 0;
      let lastState = events.length ? events[0][1] : false;
  
      allTimes.forEach(time => {
        const now = time.getTime();
  
        // advance pointer for every event at or before 'now'
        while (pointer < events.length && events[pointer][0] <= now) {
          lastState = events[pointer][1];
          pointer++;
        }
  
        matrixData.push({
          x: time,
          y: studentNames[rowIdx], // Use original order for data mapping
          v: lastState ? 1 : 0
        });
      });
    });
  
    // show canvas / hide “no data”
    document.getElementById("no-data-message").style.display   = "none";
    const heatmapCanvas = document.getElementById("classHeatmapChart");
    heatmapCanvas.style.display = "";

    // 6) Render or update the heatmap
    const existingChart = Chart.getChart("classHeatmapChart");
    const ctx = heatmapCanvas.getContext("2d");

    // Define the chart configuration
    const chartConfig = {
        type: 'matrix',
        data: {
            datasets: [{
                label: 'Engagement',
                data: matrixData,
                backgroundColor: ctx => {
                    // Ensure dataIndex is valid before accessing
                    if (ctx.dataIndex === undefined || !ctx.dataset.data[ctx.dataIndex]) {
                        return 'rgba(0,0,0,0.1)'; // Default/error color
                    }
                    const cell = ctx.dataset.data[ctx.dataIndex];
                    return cell.v ? '#4CAF50' : '#F44336'; // Green for engaged, Red for not
                },
                // Optional: Define cell dimensions if needed for matrix type
                // width: (ctx) => (ctx.chart.chartArea || {}).width / allTimes.length, // Keep width automatic
                height: (ctx) => {
                    const numStudents = studentNames.length;
                    if (!numStudents) return 10; // Default height if no students

                    const chartAreaHeight = (ctx.chart.chartArea || {}).height || 300; // Use available height or fallback

                    // --- Simplified Dynamic Row Height Calculation ---
                    const MAX_ROW_HEIGHT_PX = 60; // Max height per student
                    const MIN_ROW_HEIGHT_PX = 8;  // Min height per student

                    // Calculate height per student based on available space
                    let calculatedHeight = chartAreaHeight / numStudents;

                    // Clamp the height between min and max values
                    calculatedHeight = Math.max(MIN_ROW_HEIGHT_PX, Math.min(calculatedHeight, MAX_ROW_HEIGHT_PX));

                    return calculatedHeight;
                },
                anchorX: 'center',
                anchorY: 'bottom'  // Align cells to the bottom of their row space
            }]
        },
        options: {
            // maintainAspectRatio: false, // Revert this change
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } }, // Format time axis
                    title: { display: true, text: 'Time' },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 20 // Limit ticks for readability
                    },
                    min: startMs, // Explicitly set min/max for better update control
                    max: endMs
                },
                y: {
                    type: 'category',
                    labels: studentNames, // Use original order for labels
                    title: { display: true, text: 'Student' },
                    offset: true, // Revert to default: Center labels between grid lines
                    position: 'left'
                    // Removed reverse: true
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            // Ensure dataIndex is valid before accessing
                            if (ctx.dataIndex === undefined || !ctx.dataset.data[ctx.dataIndex]) {
                                return 'No data';
                            }
                            const { x, y, v } = ctx.dataset.data[ctx.dataIndex];
                            const t = new Date(x).toLocaleTimeString([], {
                                hour: '2-digit', minute: '2-digit', second: '2-digit' // Added seconds
                            });
                            // Use overrideMode for tooltip if provided, else historical
                            const displayMode = overrideMode || findNearestMode(x, modesTimeline)?.mode || 'teaching';
                            return `${y} @ ${t} [${displayMode}]: ${v ? 'Engaged' : 'Not Engaged'}`;
                        }
                    }
                },
                legend: {
                    display: false // Hide legend as colors are simple
                }
            },
            // Performance optimizations
            animation: false, // Disable animation for smoother updates
            parsing: false, // Data is already in {x, y, v} format
            onClick: async (event, elements) => {
                // Use existingChart if available, otherwise use chartConfig (for initial render)
                const chartInstance = Chart.getChart("classHeatmapChart"); // Get the chart instance directly
                if (!chartInstance) return; // Exit if chart not found

                if (elements.length > 0) {
                    const elementIndex = elements[0].index;
                    const datasetIndex = elements[0].datasetIndex;
                    // Access data directly from the live chart instance
                    const clickedData = chartInstance.data.datasets[datasetIndex].data[elementIndex];

                    if (clickedData) {
                        const studentName = clickedData.y;
                        const timestampMs = clickedData.x; // x is already a timestamp (ms) in matrix data

                        // Find student ID - Need studentIds and startMs in scope
                        // Let's fetch them again or ensure they are accessible
                        // For now, assuming studentIds and startMs are available from the outer scope of drawClassHeatmap
                        const studentIndex = studentNames.indexOf(studentName); // studentNames must be accessible
                        if (studentIndex !== -1 && typeof studentIds !== 'undefined' && typeof startMs !== 'undefined') {
                            const studentId = studentIds[studentIndex]; // studentIds must be accessible
                            const lectureStartTimeMs = startMs; // startMs must be accessible
                            const videoStartTimeSeconds = Math.max(0, Math.floor((timestampMs - lectureStartTimeMs) / 1000));

                            console.log(`Clicked on: Student ${studentName} (ID: ${studentId}), Time: ${new Date(timestampMs).toLocaleTimeString()}, Video Start: ${videoStartTimeSeconds}s`);

                            // Fetch video URL (Requires a new server endpoint)
                            try {
                                // Show loading indicator for the popup
                                const popup = document.getElementById('video-popup');
                                const loader = document.getElementById('video-popup-loader');
                                const iframe = document.getElementById('video-popup-iframe');
                                if (popup) popup.style.display = 'flex';
                                if (loader) loader.style.display = 'block';
                                if (iframe) iframe.style.display = 'none'; // Hide iframe while loading

                                const videoRes = await fetch(`/get_student_lecture_video?lecture_code=${lectureCode}&student_id=${studentId}`);
                                const videoData = await videoRes.json();

                                if (videoData.success && videoData.videoUrl) {
                                    showVideoPopup(videoData.videoUrl, videoStartTimeSeconds);
                                } else {
                                    if (popup) popup.style.display = 'none'; // Hide popup on error
                                    alert(`Could not find lecture video for ${studentName}. Error: ${videoData.error || 'Video URL not found in database.'}`);
                                }
                            } catch (err) {
                                console.error("Error fetching video URL:", err);
                                const popup = document.getElementById('video-popup');
                                if (popup) popup.style.display = 'none'; // Hide popup on error
                                alert(`Error fetching video URL for ${studentName}.`);
                            }
                        } else {
                             console.error("Could not find student index or studentIds/startMs not accessible in onClick scope.");
                             alert("Error retrieving student details for video playback.");
                        }
                    }
                }
            }
        }
    };

    if (existingChart) {
        // Update existing chart by replacing data and options
        console.log("[DEBUG] Updating existing heatmap chart by replacing data/options.");
        // Ensure studentIds and startMs are updated in the existing chart's scope if necessary,
        // though ideally they are fetched/calculated within drawClassHeatmap each time.
        existingChart.data = chartConfig.data;
        existingChart.options = chartConfig.options; // This should re-bind the onClick with the correct scope variables
        existingChart.update('none'); // Update the chart in place without animation
    } else {
        // Create new chart if it doesn't exist
        console.log("[DEBUG] Creating new heatmap chart.");
        new Chart(ctx, chartConfig);
    }
}
  

/**
 * Shows the video popup modal with the embedded YouTube player.
 * @param {string} videoUrl - The full YouTube watch URL.
 * @param {number} startTimeSeconds - The time in seconds to start the video.
 */
function showVideoPopup(videoUrl, startTimeSeconds) {
    console.log("[showVideoPopup] Called with URL:", videoUrl, "Start time:", startTimeSeconds); // DEBUG
    const popup = document.getElementById('video-popup');
    const iframe = document.getElementById('video-popup-iframe');
    const loader = document.getElementById('video-popup-loader');
    const closeBtn = document.getElementById('video-popup-close');

    // DEBUG: Check if elements were found
    console.log("[showVideoPopup] Found elements:", { popup, iframe, loader, closeBtn });

    if (!popup || !iframe || !loader || !closeBtn) {
        console.error("[showVideoPopup] ERROR: One or more video popup elements not found in the DOM!");
        alert("Could not display video player (UI elements missing).");
        // Attempt to hide popup just in case it was partially shown by onClick
        if(popup) popup.style.display = 'none';
        return;
    }

    // Extract YouTube Video ID
    let videoId = null;
    try {
        const url = new URL(videoUrl);
        if (url.hostname === 'youtu.be') {
            videoId = url.pathname.substring(1);
        } else if (url.hostname.includes('youtube.com') && url.searchParams.has('v')) {
            videoId = url.searchParams.get('v');
        }
    } catch (e) {
        console.error("Invalid video URL format:", videoUrl, e);
    }

    if (!videoId) {
        alert("Invalid YouTube URL provided for the video.");
        if (loader) loader.style.display = 'none';
        if (popup) popup.style.display = 'none'; // Keep popup hidden if URL is bad
        return;
    }

    // Construct embed URL
    const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${startTimeSeconds}&autoplay=1&rel=0`; // Added autoplay and rel=0

    // Set iframe source and display
    iframe.src = embedUrl;
    iframe.style.display = 'block'; // Show iframe
    loader.style.display = 'none';  // Hide loader
    popup.style.display = 'flex'; // Set display before adding class for transition
    // Use setTimeout to allow the display change to render before adding the class
    setTimeout(() => {
        popup.classList.add('active'); // Show popup using CSS class for transition
    }, 10); // Small delay

    // Function to handle closing the popup
    const closePopup = () => {
        popup.classList.remove('active'); // Start fade-out transition
        iframe.src = ''; // Stop video playback immediately
        // Set display: none after the transition completes (300ms)
        setTimeout(() => {
            popup.style.display = 'none';
        }, 300); // Match the CSS transition duration
    };

    // Close button functionality
    closeBtn.onclick = closePopup;

    // Optional: Close popup if clicked outside the video area
    popup.onclick = (event) => {
        if (event.target === popup) { // Check if the click is on the backdrop itself
            closePopup();
        }
    };
}


// --- Collapsible Card Functionality ---
    const liveQuizzesCard = document.getElementById('live-quizzes-card');
    if (liveQuizzesCard) {
        const quizHeader = liveQuizzesCard.querySelector('.collapsible-header');
        if (quizHeader) {
            quizHeader.addEventListener('click', () => {
                liveQuizzesCard.classList.toggle('collapsed');
            });
        } else {
            console.warn("[instructor.js] Collapsible header for quizzes not found.");
        }
    } else {
        console.warn("[instructor.js] Live quizzes card container not found.");
    }
}); // --- END DOMContentLoaded ---


// --- Fallback Speech Detection Debug Tools Removed ---

// --- RealtimeAudioRecorder Debug Hooks Removed ---