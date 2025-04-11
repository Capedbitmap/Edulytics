// client/public/scripts/engagement.js

(function() {
    "use strict";

    // --- Configuration ---
    const FACEAPI_MODEL_URL = '/models';
    // FRAME_CAPTURE_INTERVAL is now handled within faceDetection.js
    const IDB_NAME = 'EngagementData';
    const IDB_VERSION = 1;
    const IDB_STORE_NAME = 'engagementFrames';
    const FACE_DETECTION_OPTIONS = new faceapi.TinyFaceDetectorOptions({
        inputSize: 224, // Keep this relatively small for performance
        scoreThreshold: 0.5 // Confidence threshold
    });

    // --- State Variables ---
    let socket = null;
    let lectureCode = null;
    let faceApiLoaded = false; // Tracks if face-api models are loaded
    let modelsLoading = false;
    let consentGivenThisSession = false;
    let webcamStream = null;
    let videoEl = null; // Reference to the video element
    let db = null;
    // let captureInterval = null; // No longer needed here, FaceDetection handles its own interval
    let engagementDetectionEnabled = false; // **Define the variable here**
    let faceDetectionInitialized = false; // Track if FaceDetection module is initialized

    // --- DOM Elements ---
    const consentModal = document.getElementById('engagementConsentModal'); // Correct ID
    const consentAcceptBtn = document.getElementById('consentAcceptBtn'); // Correct ID
    const consentDeclineBtn = document.getElementById('consentDenyBtn');  // Correct ID
    // const statusIndicator = document.getElementById('engagement-indicator'); // No longer needed
    const statusMessage = document.getElementById('engagement-status-message'); // Optional status message area

    // --- IndexedDB Functions ---
     async function initDB() {
        return new Promise((resolve, reject) => {
            console.log("[Engagement] Initializing IndexedDB...");
            const request = indexedDB.open(IDB_NAME, IDB_VERSION);

            request.onerror = (event) => {
                console.error("[Engagement] IndexedDB error:", event.target.error);
                reject("IndexedDB error: " + event.target.error);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log("[Engagement] IndexedDB initialized successfully.");
                // Perform initial cleanup on successful connection
                clearAllFrames().then(resolve).catch(reject);
            };

            request.onupgradeneeded = (event) => {
                console.log("[Engagement] IndexedDB upgrade needed.");
                db = event.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                    db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    console.log(`[Engagement] Object store '${IDB_STORE_NAME}' created.`);
                }
            };
        });
    }

    async function saveFrameToDB(frameData) {
        // This function might be deprecated if FaceDetection handles frame storage internally
        if (!db) {
            console.warn("[Engagement] DB not initialized, cannot save frame.");
            return;
        }
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([IDB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(IDB_STORE_NAME);
            const frame = {
                timestamp: Date.now(),
                lectureCode: lectureCode,
                imageData: frameData // Assuming frameData is base64 or similar
            };
            const request = store.add(frame);

            request.onsuccess = () => {
                // console.log("[Engagement] Frame saved to IndexedDB successfully.");
                resolve();
            };
            request.onerror = (event) => {
                console.error("[Engagement] Error saving frame to IndexedDB:", event.target.error);
                reject(event.target.error);
            };
        });
    }


    async function clearAllFrames() {
        if (!db) {
             console.warn("[Engagement] DB not initialized, cannot clear frames.");
             return Promise.resolve(); // Or reject, depending on desired behavior
        }
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction([IDB_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(IDB_STORE_NAME);
                const request = store.clear();

                request.onsuccess = () => {
                    console.log("[Engagement] Cleared all frames from IndexedDB.");
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("[Engagement] Error clearing IndexedDB:", event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                 console.error("[Engagement] Error initiating clear transaction:", error);
                 // Handle cases where the object store might not exist yet during initialization
                 if (error.name === 'NotFoundError') {
                     console.warn("[Engagement] Object store not found during clear, likely first run.");
                     resolve(); // Resolve gracefully if store doesn't exist
                 } else {
                     reject(error);
                 }
            }
        });
    }


    // --- FaceAPI Functions ---
    async function loadFaceApiModels() {
        if (faceApiLoaded || modelsLoading) return;
        modelsLoading = true;
        console.log("[Engagement] Loading face-api models...");
        try {
            // Ensure faceapi is available globally
            if (typeof faceapi === 'undefined') {
                throw new Error("face-api.js library not loaded.");
            }
            await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL);
            faceApiLoaded = true;
            console.log("[Engagement] face-api models loaded successfully.");
            // **Notify FaceDetection module that models are ready**
            // Check if FaceDetection is defined on window now
            if (typeof window.FaceDetection !== 'undefined') {
                 window.FaceDetection.setModelsLoaded(true, FACE_DETECTION_OPTIONS);
                 // Try initializing FaceDetection again if video element is ready
                 if (videoEl && !faceDetectionInitialized) {
                     initializeFaceDetectionModule();
                 }
            } else {
                console.warn("[Engagement] FaceDetection module not found on window after models loaded.");
            }
        } catch (error) {
            console.error("[Engagement] Failed to load face-api models:", error);
            showStatus("Error loading face detection models.", "error");
             if (typeof window.FaceDetection !== 'undefined') {
                 window.FaceDetection.setModelsLoaded(false); // Notify failure
             }
        } finally {
            modelsLoading = false;
        }
    }

    // --- Socket.IO Functions ---
    function initializeSocketIO() {
         try {
            // Try to connect to the root namespace with explicit auth
            socket = io({
                // Include auth in connection params
                auth: { lecture: lectureCode },
                // Retry configuration to handle connection issues
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 5000
            });

            // Add a simple test - emit an event to self after connecting
            socket.on('connect', () => {
                console.log('[Engagement] Socket.IO connected:', socket.id);

                // Join room as soon as we connect
                if (lectureCode) {
                    joinLectureRoom();
                }

                // Test if we can receive our own events
                socket.emit('echo', { test: 'Can you hear me?', timestamp: Date.now() });
                console.log('[Engagement] Sent echo test event');
            });

            // If connection is lost, try to rejoin when reconnected
            socket.on('reconnect', () => {
                console.log('[Engagement] Socket.IO reconnected');
                if (lectureCode) {
                    joinLectureRoom();
                }
            });

             // Debug all incoming events
            socket.onAny((event, ...args) => {
                console.log(`[Engagement] Socket event received: ${event}`, args);
            });

            // Also log whenever we join a room (confirmation)
            socket.on('room_joined', (room) => {
                console.log(`[Engagement] Successfully joined room: ${room}`);
            });

            socket.on('disconnect', (reason) => {
                console.warn('[Engagement] Socket.IO disconnected:', reason);
                stopCapture(); // Stop webcam etc. on disconnect
            });

            socket.on('connect_error', (error) => {
                console.error('[Engagement] Socket.IO connection error:', error);
                showStatus("Real-time connection error.", "error");
                stopCapture(); // Stop if connection fails
            });

             // Echo handler for testing
            socket.on('echo', (data) => {
                console.log('[Engagement] Received echo response:', data);
            });

            // Listen for the broadcast to all clients as a fallback
            socket.on('ALL_CLIENTS_engagement_status_update', (data) => {
                console.log('[Engagement] Received broadcast to ALL clients:', data);
                 const currentLectureCode = getLectureCodeFromURL();
                if (currentLectureCode && data.lecture_code === currentLectureCode) {
                    handleEngagementStatusUpdate(data);
                }
            });

            // Test event reception
            socket.on('test_event', (data) => {
                console.log('[Engagement] Received test event:', data);
            });

            socket.on('room_test', (data) => {
                console.log('[Engagement] Received room test:', data);
            });


            // Listen for status updates from the instructor
            socket.on('engagement_status_update', handleEngagementStatusUpdate);
            socket.on('engagement_status', handleEngagementStatusUpdate); // Fallback name
            socket.on('engagement', handleEngagementStatusUpdate); // Another fallback

        } catch (error) {
            console.error('[Engagement] Failed to initialize Socket.IO:', error);
            showStatus("Failed to initialize real-time connection.", "error");
        }
    }

     // Helper function to join the lecture room
    function joinLectureRoom() {
        const roomName = `lecture-${lectureCode}`;

        // First attempt: Join with callback
        socket.emit('join_lecture_room', roomName, (response) => {
            if (response && response.success) {
                console.log(`[Engagement] Successfully joined room with callback: ${response.room} (${response.size} clients)`);
            } else {
                console.error(`[Engagement] Failed to join room: ${roomName}`, response);

                // If failed, try a simpler approach after a short delay
                setTimeout(() => {
                    console.log('[Engagement] Trying alternative join approach...');
                    socket.emit('join_room', roomName);
                }, 500);
            }
        });

        console.log(`[Engagement] Emitted join_lecture_room for ${roomName}`);

        // Also manually test event reception every few seconds to verify connectivity
        let testCount = 0;
        const testInterval = setInterval(() => {
            if (!socket || !socket.connected) {
                clearInterval(testInterval);
                return;
            }

            testCount++;
            // console.log(`[Engagement] Sending test echo #${testCount}...`); // Reduce noise
            socket.emit('echo', {
                test: `Echo test #${testCount}`,
                timestamp: Date.now(),
                lecture: lectureCode
            });

            // Stop testing after 5 attempts
            if (testCount >= 5) clearInterval(testInterval);
        }, 5000); // Increase interval
    }


    // --- UI Functions ---
    function showStatus(message, type = 'info') {
        // Use a dedicated status message area if available, otherwise log
        if (statusMessage) {
            statusMessage.textContent = message;
            statusMessage.className = `status-${type}`; // e.g., status-info, status-error
        } else {
            console.log(`[Status:${type}] ${message}`);
        }
         // Update FaceDetection module status as well
        if (type === 'error' && typeof window.FaceDetection !== 'undefined') {
            // Potentially disable or show error state in FaceDetection UI
        }
    }

    // function setIndicatorActive(isActive) { // No longer needed
    //     // We now rely on FaceDetection's float indicator primarily
    // }

    function showConsentModal() {
        if (consentModal) {
            consentModal.style.display = 'flex';
             // Ensure buttons are wired up correctly
             if (consentAcceptBtn) consentAcceptBtn.onclick = handleConsentAccepted;
             if (consentDeclineBtn) consentDeclineBtn.onclick = handleConsentDeclined;
             // Make modal visible smoothly
             setTimeout(() => consentModal.classList.add('visible'), 10);
        } else {
            console.warn("[Engagement] Consent modal not found. Assuming consent.");
            handleConsentAccepted(); // Assume consent if modal is missing
        }
    }

    function hideConsentModal() {
        if (consentModal) {
             consentModal.classList.remove('visible');
             setTimeout(() => { consentModal.style.display = 'none'; }, 300); // Match transition
        }
    }

    // --- Engagement Logic ---
    function handleEngagementStatusUpdate(data) {
        console.log('[Engagement] Received engagement status update:', data);
        const wasEnabled = engagementDetectionEnabled; // Store previous state
        engagementDetectionEnabled = data.enabled; // Update state **FIRST**

        console.log(`[Engagement] Status change: ${wasEnabled} -> ${engagementDetectionEnabled}`);

        if (engagementDetectionEnabled && !wasEnabled) {
            // Instructor enabled the feature
            console.log("[Engagement] Feature enabled by instructor.");
            consentGivenThisSession = false; // Reset consent
            showConsentModal(); // This will trigger webcam/detection start on accept
        } else if (!engagementDetectionEnabled && wasEnabled) {
            // Instructor disabled the feature
            console.log("[Engagement] Feature disabled by instructor.");
            stopCapture(); // Stop webcam, intervals, etc.
             if (typeof window.FaceDetection !== 'undefined' && window.FaceDetection.isInitialized()) {
                 const frames = window.FaceDetection.getStoredFrames();
                 if (frames && frames.length > 0) {
                     console.log(`[Engagement] Collected ${frames.length} frames. Clearing.`);
                     // TODO: Send frames for analysis here if needed
                     window.FaceDetection.clearStoredFrames();
                 }
                 // Explicitly tell FaceDetection module it's disabled
                 window.FaceDetection.setEngagementEnabled(false);
             }
        } else {
             // If status hasn't changed, still update FaceDetection module just in case
             if (typeof window.FaceDetection !== 'undefined' && window.FaceDetection.isInitialized()) {
                 window.FaceDetection.setEngagementEnabled(engagementDetectionEnabled);
             }
        }
    }


    function handleConsentAccepted() {
        console.log("[Engagement] Consent accepted.");
        hideConsentModal();
        consentGivenThisSession = true;
        // Start webcam and detection ONLY if engagement is currently enabled
        if (engagementDetectionEnabled) {
            initializeWebcamAndFaceDetection(true);
        } else {
             console.log("[Engagement] Consent accepted, but engagement is currently disabled by instructor.");
        }
    }

    function handleConsentDeclined() {
        console.log("[Engagement] Consent declined.");
        hideConsentModal();
        consentGivenThisSession = false;
        showStatus("Engagement tracking declined.", "warning");
        stopCapture(); // Ensure everything is stopped
         if (typeof window.FaceDetection !== 'undefined' && window.FaceDetection.isInitialized()) {
            window.FaceDetection.setEngagementEnabled(false); // Ensure FD module knows it's off
        }
    }

    /** Initialize Webcam and Face Detection Module */
    async function initializeWebcamAndFaceDetection(shouldEnable) {
        if (!videoEl) {
            videoEl = createVideoElement(); // Ensure video element exists
        }

        if (!webcamStream) {
            try {
                await startWebcam(); // Wait for webcam to start
            } catch (error) {
                console.error("[Engagement] Failed to start webcam for detection:", error);
                showStatus("Failed to start webcam.", "error");
                return; // Stop if webcam fails
            }
        }

        // Now that webcam is ready, initialize FaceDetection module if not already done
        if (!faceDetectionInitialized) {
            initializeFaceDetectionModule();
        }

        // Set the enabled state in FaceDetection module *after* it's initialized
        // Use window.FaceDetection
        if (faceDetectionInitialized && typeof window.FaceDetection !== 'undefined') {
             console.log(`[Engagement] Setting FaceDetection enabled state to: ${shouldEnable}`);
            window.FaceDetection.setEngagementEnabled(shouldEnable);
            if (shouldEnable) {
                console.log("[Engagement] FaceDetection module will handle detection and frame capture.");
            }
        } else {
             console.warn("[Engagement] Could not set FaceDetection enabled state - module not ready.");
        }
    }


    /** Create the hidden video element */
    function createVideoElement() {
        let video = document.getElementById('webcamFeed'); // Use existing ID if present
        if (!video) {
            console.log("[Engagement] Creating video element for webcam feed.");
            video = document.createElement('video');
            video.id = 'webcamFeed'; // Assign ID
            video.playsInline = true;
            video.autoplay = true;
            video.muted = true;
            // Make it visually hidden but accessible for detection
            video.style.position = 'absolute';
            video.style.top = '-9999px';
            video.style.left = '-9999px';
            video.style.width = '320px'; // Small size is fine
            video.style.height = '240px';
            document.body.appendChild(video);
        }
        return video;
    }

    /** Start webcam stream */
    function startWebcam() { // Make this return a promise
        // Use the globally referenced videoEl
        if (!videoEl) videoEl = createVideoElement();
        if (!videoEl) {
             console.error('[Engagement] Video element could not be created or found for webcam');
             return Promise.reject("Video element missing"); // Return rejected promise
        }

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            return navigator.mediaDevices.getUserMedia({ video: true }) // Return the promise
            .then(function(stream) {
                videoEl.srcObject = stream;
                webcamStream = stream;
                videoEl.play(); // Ensure video starts playing

                // Dispatch event when webcam is ready
                return new Promise((resolve) => { // Return promise that resolves when metadata loads
                    videoEl.onloadedmetadata = () => {
                        console.log("[Engagement] Webcam metadata loaded.");
                        window.dispatchEvent(new CustomEvent('webcamReady', {
                            detail: { videoElement: videoEl }
                        }));
                        resolve(); // Resolve the promise here
                    };
                });
            })
            .catch(function(error) {
                console.error('[Engagement] Error accessing webcam:', error);
                showStatus("Webcam access denied or unavailable.", "error");
                stopCapture(); // Stop everything if webcam fails
                throw error; // Re-throw error to be caught by caller
            });
    } else {
        console.error('[Engagement] getUserMedia not supported');
        return Promise.reject("getUserMedia not supported"); // Return a rejected promise
    }
    }

    /** Stop webcam stream and cleanup */
    function stopCapture() {
        console.log("[Engagement] Stopping capture...");
        // if (captureInterval) { // No longer needed here
        //     clearInterval(captureInterval);
        //     captureInterval = null;
        // }
        if (webcamStream) {
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
            console.log("[Engagement] Webcam stream stopped.");
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
         // Also inform FaceDetection module if it's initialized
        if (typeof window.FaceDetection !== 'undefined' && window.FaceDetection.isInitialized()) {
            window.FaceDetection.setEngagementEnabled(false);
        }
        // setIndicatorActive(false); // Remove call to redundant indicator function
    }

    /** Initialize the FaceDetection module if dependencies are ready */
    function initializeFaceDetectionModule() {
        if (faceDetectionInitialized) return; // Already done

        if (!videoEl || !faceApiLoaded || !FACE_DETECTION_OPTIONS) {
            // Log which dependency is missing
            if (!videoEl) console.warn("[Engagement] Cannot init FaceDetection: Video element missing or not ready.");
            if (!faceApiLoaded) console.warn("[Engagement] Cannot init FaceDetection: Models not loaded.");
            if (!FACE_DETECTION_OPTIONS) console.warn("[Engagement] Cannot init FaceDetection: Options not set.");
            return; // Don't initialize if dependencies aren't ready
        }

        console.log('[Engagement] Initializing FaceDetection module...');
        // Use window.FaceDetection now
        if (typeof window.FaceDetection !== 'undefined') {
            try {
                window.FaceDetection.init(videoEl, faceApiLoaded, FACE_DETECTION_OPTIONS);
                faceDetectionInitialized = true; // Mark as initialized *after* successful call
                console.log('[Engagement] FaceDetection module initialization called.');
                 // Immediately set the current engagement state after init
                 window.FaceDetection.setEngagementEnabled(engagementDetectionEnabled);
            } catch (error) {
                 console.error('[Engagement] Error during FaceDetection.init:', error);
                 faceDetectionInitialized = false; // Ensure it's marked as not initialized on error
            }
        } else {
            console.error('[Engagement] FaceDetection module is not defined on window!');
        }
    }


    // --- Initialization ---
    function init() {
        lectureCode = getLectureCodeFromURL();
        if (!lectureCode) {
            console.error("[Engagement] Lecture code not found in URL.");
            showStatus("Invalid lecture page.", "error");
            return;
        }
        console.log("[Engagement] Lecture Code:", lectureCode);

        // Ensure video element exists early
        videoEl = createVideoElement();

        // Initialize DB
        initDB().catch(error => {
             console.error("[Engagement] Failed to initialize DB:", error);
             showStatus("Database initialization failed.", "error");
        });
        // Load face-api models (this now notifies FaceDetection module)
        loadFaceApiModels();
        // Initialize Socket.IO
        initializeSocketIO();

        // Setup consent modal listeners
        if (consentAcceptBtn && consentDeclineBtn) {
            consentAcceptBtn.onclick = handleConsentAccepted;
            consentDeclineBtn.onclick = handleConsentDeclined;
        } else {
            console.warn("[Engagement] Consent buttons not found.");
        }

         // Add listener for webcam readiness (alternative init path)
         window.addEventListener('webcamReady', function(e) {
             console.log('[Engagement] webcamReady event received, ensuring FaceDetection init.');
             if (e.detail?.videoElement && !faceDetectionInitialized) {
                 initializeFaceDetectionModule();
             }
         });
    }

    // Helper to get lecture code
    function getLectureCodeFromURL() {
        const path = window.location.pathname;
        const match = path.match(/\/lecture\/([A-Z0-9]+)/i);
        return match ? match[1] : null;
    }

    // Start on DOMContentLoaded
    if (document.readyState === 'loading') {
        // Use 'DOMContentLoaded' which fires earlier than 'load'
        document.addEventListener('DOMContentLoaded', init, { passive: true });
    } else {
        // If already loaded, init with a small delay to allow other scripts
        setTimeout(init, 50); // Reduced delay
    }

})(); // IIFE