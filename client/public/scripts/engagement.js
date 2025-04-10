// client/public/scripts/engagement.js

(function() {
    "use strict";

    // --- Configuration ---
    const FACEAPI_MODEL_URL = '/models'; // Assumes models are served from /models relative to public root
    const FRAME_CAPTURE_INTERVAL = 1000; // ms (approx 1 per second)
    const IDB_NAME = 'EngagementData';
    const IDB_VERSION = 1;
    const IDB_STORE_NAME = 'engagementFrames';
    
    // Use tiny face detector instead of ssd_mobilenetv1 (more efficient for real-time)
    const FACE_DETECTION_OPTIONS = new faceapi.TinyFaceDetectorOptions({ 
        inputSize: 224,    // 128, 160, 224, 320, or 416, smaller = faster but less accurate
        scoreThreshold: 0.5 // Minimum confidence threshold
    });

    /* 
     * FACE-API.JS SETUP INSTRUCTIONS:
     * 
     * 1. Create a 'models' directory in your public folder:
     *    /client/public/models/
     * 
     * 2. Download the tiny_face_detector model files from:
     *    https://github.com/vladmandic/face-api/tree/master/model
     * 
     * 3. You need these specific files in the following structure:
     *    /models/tiny_face_detector_model-weights_manifest.json
     *    /models/tiny_face_detector_model-shard1
     * 
     * 4. Alternative download method:
     *    - Visit: https://github.com/vladmandic/face-api/tree/master/model
     *    - Download the 'tiny_face_detector_model' folder
     *    - Extract and place the contents in your /client/public/models/ directory
     * 
     * Note: Ensure the server is configured to serve static files from the public directory.
     */

    // --- State Variables ---
    let socket = null;
    let lectureCode = null;
    let faceApiLoaded = false;
    let consentGivenThisSession = false; // Tracks consent specifically for the current session activation
    let webcamStream = null;
    let captureIntervalId = null;
    let isCapturing = false;
    let db = null; // IndexedDB instance
    let modelsLoading = false; // Flag to prevent multiple load attempts
    let engagementDetectionEnabled = false;

    // --- DOM Elements ---
    const videoEl = document.getElementById('webcamFeed');
    const canvasEl = document.getElementById('captureCanvas');
    const indicatorEl = document.getElementById('engagementIndicator');
    const consentModalEl = document.getElementById('engagementConsentModal');
    const consentAcceptBtn = document.getElementById('consentAcceptBtn');
    const consentDenyBtn = document.getElementById('consentDenyBtn');

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', () => {
        console.log("[Engagement] DOMContentLoaded");

        // Extract lecture code
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length >= 3 && pathParts[1] === 'lecture') {
            lectureCode = pathParts[2].toUpperCase();
            console.log(`[Engagement] Lecture Code: ${lectureCode}`);
        } else {
            console.error("[Engagement] Could not extract lecture code from URL.");
            return; // Stop initialization if no lecture code
        }

        if (!videoEl || !canvasEl || !indicatorEl || !consentModalEl || !consentAcceptBtn || !consentDenyBtn) {
            console.error("[Engagement] Required DOM elements not found. Aborting.");
            return;
        }

        // Preload face-api models
        loadFaceApiModels();

        // Initialize IndexedDB
        initializeDB();

        // Initialize Socket.IO connection
        initializeSocketIO();

        // Add event listeners for consent
        consentAcceptBtn.addEventListener('click', handleConsentAccept);
        consentDenyBtn.addEventListener('click', handleConsentDeny);

        // Add cleanup listeners
        window.addEventListener('beforeunload', cleanup); // Tab/browser close
        // Consider adding listener for explicit logout if the main app has one

        // Initialize face detection after video element is created and ready
        function initializeFaceDetection() {
            const videoElement = document.getElementById('webcam-video');
            if (videoElement) {
                // Initialize the face detection module
                FaceDetection.init(videoElement);
                
                // Set initial state based on engagement status
                FaceDetection.setEngagementEnabled(engagementDetectionEnabled);
            } else {
                // If video element isn't ready yet, try again soon
                setTimeout(initializeFaceDetection, 500);
            }
        }
        
        // Start initialization after a short delay to ensure webcam is initialized
        setTimeout(initializeFaceDetection, 1000);
    });

    // --- IndexedDB Functions ---
    async function initializeDB() {
        return new Promise((resolve, reject) => {
            console.log("[Engagement] Initializing IndexedDB...");
            const request = indexedDB.open(IDB_NAME, IDB_VERSION);

            request.onerror = (event) => {
                console.error("[Engagement] IndexedDB error:", event.target.error);
                setIndicatorActive(false); // Ensure indicator is off on DB error
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                console.log("[Engagement] IndexedDB initialized successfully.");
                // Perform initial cleanup of any leftover data from previous crashes
                clearAllFrames().then(() => resolve(db));
            };

            request.onupgradeneeded = (event) => {
                console.log("[Engagement] IndexedDB upgrade needed.");
                const tempDb = event.target.result;
                if (!tempDb.objectStoreNames.contains(IDB_STORE_NAME)) {
                    tempDb.createObjectStore(IDB_STORE_NAME, { autoIncrement: true });
                    console.log(`[Engagement] Object store '${IDB_STORE_NAME}' created.`);
                }
            };
        });
    }

    async function saveFrame(blob) {
        if (!db) {
            console.error("[Engagement] DB not initialized, cannot save frame.");
            return Promise.reject("DB not initialized");
        }
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction([IDB_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(IDB_STORE_NAME);
                const request = store.add({ timestamp: Date.now(), frame: blob });

                request.onsuccess = () => {
                    // console.log("[Engagement] Frame saved to IndexedDB."); // Too noisy
                    resolve();
                };
                request.onerror = (event) => {
                    console.error("[Engagement] Error saving frame to IndexedDB:", event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                 console.error("[Engagement] Exception saving frame to IndexedDB:", error);
                 reject(error);
            }
        });
    }

    async function clearAllFrames() {
        if (!db) {
            console.warn("[Engagement] DB not initialized, cannot clear frames.");
            return Promise.resolve(); // Resolve silently if DB isn't ready
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
                    console.error("[Engagement] Error clearing frames from IndexedDB:", event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                 console.error("[Engagement] Exception clearing frames from IndexedDB:", error);
                 reject(error);
            }
        });
    }

    // --- FaceAPI Functions ---
    async function loadFaceApiModels() {
        if (faceApiLoaded || modelsLoading) return;
        modelsLoading = true;
        console.log("[Engagement] Loading face-api models...");
        try {
            // Load the Tiny Face Detector model
            await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL);
            faceApiLoaded = true;
            console.log("[Engagement] face-api models loaded successfully.");
        } catch (error) {
            console.error("[Engagement] Failed to load face-api models:", error);
            // Handle error appropriately - maybe disable the feature?
            showStatus("Error loading face detection models. Try refreshing the page.", "error");
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

            // Echo handler for testing
            socket.on('echo', (data) => {
                console.log('[Engagement] Received echo response:', data);
            });

            // Listen for the broadcast to all clients as a fallback
            socket.on('ALL_CLIENTS_engagement_status_update', (data) => {
                console.log('[Engagement] Received broadcast to ALL clients:', data);
                if (data.lecture_code === lectureCode) {
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
                // Handle disconnection - maybe stop capture?
                stopCapture();
            });

            socket.on('connect_error', (error) => {
                console.error('[Engagement] Socket.IO connection error:', error);
                showStatus("Real-time connection error.", "error");
                stopCapture(); // Stop if connection fails
            });

            // Listen for status updates from the instructor
            socket.on('engagement_status_update', handleEngagementStatusUpdate);
            
            // Try additional event naming patterns
            socket.on('engagement_status', (data) => {
                console.log('[Engagement] Received alternate event format (engagement_status):', data);
                handleEngagementStatusUpdate(data);
            });
            
            socket.on('engagement', (data) => {
                console.log('[Engagement] Received alternate event format (engagement):', data);
                handleEngagementStatusUpdate(data);
            });

            // Try a broader catch-all for any events containing engagement
            const originalOnEvent = socket.onevent;
            socket.onevent = function(packet) {
                const eventName = packet.data[0];
                if (typeof eventName === 'string' && eventName.includes('engagement')) {
                    console.log(`[Engagement] Caught event via onevent: ${eventName}`, packet.data.slice(1));
                }
                originalOnEvent.call(this, packet);
            };

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
            console.log(`[Engagement] Sending test echo #${testCount}...`);
            socket.emit('echo', { 
                test: `Echo test #${testCount}`,
                timestamp: Date.now(),
                lecture: lectureCode
            });
            
            // Stop testing after 5 attempts
            if (testCount >= 5) clearInterval(testInterval);
        }, 3000);
    }

    // --- Engagement Logic ---

    function handleEngagementStatusUpdate(data) {
        console.log("[Engagement] Received status update:", data);
        
        // Handle both direct boolean and object with enabled property
        const isEnabled = typeof data === 'boolean' ? data : data?.enabled;
        
        if (typeof isEnabled !== 'boolean') {
            console.warn("[Engagement] Invalid status update received:", data);
            return;
        }

        if (isEnabled) {
            // Instructor enabled the feature
            consentGivenThisSession = false; // Reset consent for each activation
            showConsentModal();
        } else {
            // Instructor disabled the feature
            console.log("[Engagement] Feature disabled by instructor.");
            stopCapture(); // Stop webcam, interval, etc.
            // No need to clear frames here, cleanup handles that on exit/logout
        }

        // Update face detection module with new engagement status
        if (typeof FaceDetection !== 'undefined' && FaceDetection.isInitialized()) {
            FaceDetection.setEngagementEnabled(data.enabled);
        }
    }

    function showConsentModal() {
        if (!consentModalEl) return;
        console.log("[Engagement] Showing consent modal.");
        consentModalEl.style.display = 'flex'; // Use flex for centering
        setTimeout(() => consentModalEl.classList.add('visible'), 10); // Add delay for transition
    }

    function hideConsentModal() {
        if (!consentModalEl) return;
        consentModalEl.classList.remove('visible');
        setTimeout(() => consentModalEl.style.display = 'none', 300); // Match CSS transition
    }

    function handleConsentAccept() {
        console.log("[Engagement] Consent accepted.");
        consentGivenThisSession = true;
        hideConsentModal();
        startWebcam(); // Proceed to activate webcam
    }

    function handleConsentDeny() {
        console.log("[Engagement] Consent denied.");
        consentGivenThisSession = false;
        hideConsentModal();
        stopCapture(); // Ensure everything is stopped if consent is denied
        showStatus("Engagement detection disabled (consent denied).", "info");
    }

    async function startWebcam() {
        if (webcamStream) {
            console.log("[Engagement] Webcam already active.");
            return; // Already running
        }
        if (!consentGivenThisSession) {
            console.warn("[Engagement] Cannot start webcam: Consent not given for this session.");
            return;
        }
        if (!faceApiLoaded) {
             console.warn("[Engagement] Cannot start webcam: FaceAPI models not loaded yet.");
             showStatus("Waiting for face detection models...", "info");
             // Optionally, retry after a delay or wait for modelsLoaded flag
             await loadFaceApiModels(); // Ensure models are loaded before proceeding
             if (!faceApiLoaded) {
                 showStatus("Failed to load face detection models. Cannot start.", "error");
                 return;
             }
        }

        console.log("[Engagement] Attempting to start webcam...");
        try {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 } }, // Request reasonable resolution
                audio: false
            });
            videoEl.srcObject = webcamStream;
            videoEl.onloadedmetadata = () => {
                console.log("[Engagement] Webcam stream started.");
                videoEl.play();
                startCaptureInterval(); // Start detection loop once video is playing
            };
        } catch (error) {
            console.error("[Engagement] Error accessing webcam:", error);
            showStatus(`Error accessing webcam: ${error.name}. Check browser permissions.`, "error");
            webcamStream = null;
            stopCapture(); // Ensure cleanup if webcam fails
        }
    }

    function stopWebcam() {
        if (webcamStream) {
            console.log("[Engagement] Stopping webcam stream.");
            webcamStream.getTracks().forEach(track => track.stop());
            webcamStream = null;
            videoEl.srcObject = null;
        }
    }

    function startCaptureInterval() {
        if (captureIntervalId) {
            console.log("[Engagement] Capture interval already running.");
            return; // Already running
        }
        if (!webcamStream || !faceApiLoaded) {
            console.warn("[Engagement] Cannot start capture: Webcam or FaceAPI not ready.");
            return;
        }
        console.log("[Engagement] Starting capture interval.");
        // Run immediately once, then set interval
        captureAndDetect();
        captureIntervalId = setInterval(captureAndDetect, FRAME_CAPTURE_INTERVAL);
    }

    function stopCaptureInterval() {
        if (captureIntervalId) {
            console.log("[Engagement] Stopping capture interval.");
            clearInterval(captureIntervalId);
            captureIntervalId = null;
            isCapturing = false;
            setIndicatorActive(false); // Ensure indicator is off
        }
    }

    async function captureAndDetect() {
        if (!webcamStream || videoEl.paused || videoEl.ended || !faceApiLoaded || !db) {
            // console.log("[Engagement] Capture condition not met (stream/video/models/db).");
            setIndicatorActive(false);
            return; // Ensure prerequisites are met
        }

        try {
            // Use tiny face detector instead of ssdMobilenetv1
            const detections = await faceapi.detectSingleFace(videoEl, FACE_DETECTION_OPTIONS);

            if (detections) {
                // Face detected - capture frame
                if (!isCapturing) {
                    isCapturing = true;
                    setIndicatorActive(true);
                }

                const context = canvasEl.getContext('2d');
                canvasEl.width = videoEl.videoWidth;
                canvasEl.height = videoEl.videoHeight;
                context.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

                canvasEl.toBlob(async (blob) => {
                    if (blob) {
                        try {
                            await saveFrame(blob);
                        } catch (saveError) {
                            console.error("[Engagement] Failed to save frame blob:", saveError);
                            // Optionally stop capture on persistent save errors
                        }
                    }
                }, 'image/jpeg', 0.8); // Use JPEG format, quality 0.8

            } else {
                // No face detected
                if (isCapturing) {
                    isCapturing = false;
                    setIndicatorActive(false);
                }
            }
        } catch (error) {
            console.error("[Engagement] Error during face detection:", error);
            // Consider stopping interval on repeated errors?
            setIndicatorActive(false);
        }
    }

    function setIndicatorActive(isActive) {
        if (!indicatorEl) return;
        if (isActive) {
            indicatorEl.style.display = 'inline-block';
            indicatorEl.classList.add('active');
        } else {
            indicatorEl.style.display = 'none';
            indicatorEl.classList.remove('active');
        }
    }

    // --- Cleanup ---
    function cleanup() {
        console.log("[Engagement] Cleanup triggered (e.g., page unload).");
        stopCapture(); // Stops webcam and interval
        // Clear stored frames asynchronously, don't wait for it on unload
        clearAllFrames().catch(err => console.error("[Engagement] Error during final cleanup:", err));
        if (socket) {
            socket.disconnect();
            socket = null;
        }
    }

    // --- Utility Functions ---
    function stopCapture() {
        stopCaptureInterval();
        stopWebcam();
        consentGivenThisSession = false; // Reset consent state on stop
        setIndicatorActive(false);
    }

    function showStatus(message, type = 'info') {
        // Use the existing status indicator logic from the main lecture script if available
        if (typeof window.showStatus === 'function') {
            window.showStatus(message, type);
        } else {
            // Fallback console log
            if (type === 'error') {
                console.error(`[Engagement Status] ${message}`);
            } else {
                console.log(`[Engagement Status] ${message}`);
            }
        }
    }

})(); // IIFE

// --- Existing code ---

// Update initialization for face detection to properly find the webcam element
document.addEventListener('DOMContentLoaded', function() {
    // --- Existing initialization code ---
    
    // Initialize face detection after video element is created and ready
    function initializeFaceDetection() {
        // The problem is likely here - we need to make sure the ID matches the actual video element
        const videoElement = document.querySelector('video') || document.getElementById('webcam-video');
        
        if (videoElement) {
            console.log('[Engagement] Found webcam video element, initializing face detection', videoElement);
            
            // Initialize the face detection module with the video element
            if (typeof FaceDetection !== 'undefined') {
                // Store a reference to the video globally to debug
                window.webcamVideoElement = videoElement;
                FaceDetection.init(videoElement);
                
                // Set initial state based on engagement status
                FaceDetection.setEngagementEnabled(engagementDetectionEnabled || false);
                
                console.log('[Engagement] Face detection initialized successfully');
            } else {
                console.error('[Engagement] FaceDetection module not found or not loaded');
            }
        } else {
            // If we don't find the element, log a more detailed message
            console.log('[Engagement] Webcam video element not found, retrying soon...', {
                'video elements': document.querySelectorAll('video').length,
                'webcam-video': document.getElementById('webcam-video'),
                'any video': document.querySelector('video')
            });
            setTimeout(initializeFaceDetection, 500);
        }
    }
    
    // Updated event handler for when webcam is initialized
    window.addEventListener('webcamReady', function(e) {
        console.log('[Engagement] webcamReady event received, video element:', e.detail?.videoElement);
        if (e.detail?.videoElement) {
            // Initialize face detection with the video element from the event
            if (typeof FaceDetection !== 'undefined') {
                FaceDetection.init(e.detail.videoElement);
                FaceDetection.setEngagementEnabled(engagementDetectionEnabled || false);
            }
        }
    });
    
    // Increase the delay before first initialization attempt
    setTimeout(initializeFaceDetection, 2000);
});

// Make sure we properly handle the engagement status updates
function handleEngagementStatusUpdate(data) {
    console.log('[Engagement] Received engagement status update:', data);
    
    // Update internal engagement status variable
    engagementDetectionEnabled = data.enabled;
    
    // Update UI to reflect engagement status
    const statusElement = document.getElementById('engagement-status');
    if (statusElement) {
        statusElement.textContent = engagementDetectionEnabled ? 
            'Engagement detection enabled' : 
            'Engagement detection disabled';
        statusElement.className = engagementDetectionEnabled ? 
            'status-enabled' : 
            'status-disabled';
    }
    
    // Ensure video element is properly initialized when engagement is enabled
    if (engagementDetectionEnabled && !document.getElementById('webcam-container')) {
        console.log('[Engagement] Creating webcam container for engagement detection');
        createWebcamContainer();
    }
    
    // Update face detection module with new engagement status
    if (typeof FaceDetection !== 'undefined' && FaceDetection.isInitialized()) {
        console.log('[Engagement] Updating face detection status to:', data.enabled);
        FaceDetection.setEngagementEnabled(data.enabled);
    } else {
        console.warn('[Engagement] FaceDetection module not ready, status update will be delayed');
        // If FaceDetection isn't ready yet, we'll retry initializing
        initializeWebcamAndFaceDetection(data.enabled);
    }
    
    // --- Rest of existing code ---
}

// Helper function to create webcam container if it doesn't exist
function createWebcamContainer() {
    if (document.getElementById('webcam-container')) return;
    
    const container = document.createElement('div');
    container.id = 'webcam-container';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.right = '0';
    container.style.width = '1px';
    container.style.height = '1px';
    container.style.overflow = 'hidden';
    
    // Create video element
    const video = document.createElement('video');
    video.id = 'webcam-video';
    video.autoplay = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    
    container.appendChild(video);
    document.body.appendChild(container);
    
    console.log('[Engagement] Webcam container created with video element');
    return video;
}

// Function to ensure webcam and face detection are properly initialized
function initializeWebcamAndFaceDetection(enabled) {
    const video = document.getElementById('webcam-video') || createWebcamContainer();
    
    // Start webcam if not already started
    if (enabled && !window.webcamStream) {
        console.log('[Engagement] Initializing webcam for face detection');
        startWebcam();
    }
    
    // Try to initialize face detection with the video element
    if (typeof FaceDetection !== 'undefined') {
        // Wait a moment for the video to be ready
        setTimeout(() => {
            FaceDetection.init(video);
            FaceDetection.setEngagementEnabled(enabled);
        }, 1000);
    }
}

// Ensure webcam is handled properly
function startWebcam() {
    const video = document.getElementById('webcam-video');
    if (!video) {
        console.error('[Engagement] Video element not found for webcam');
        return;
    }
    
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(function(stream) {
                video.srcObject = stream;
                window.webcamStream = stream;
                console.log('[Engagement] Webcam stream started successfully');
                
                // Dispatch event when webcam is ready
                video.onloadedmetadata = function() {
                    window.dispatchEvent(new CustomEvent('webcamReady', {
                        detail: { videoElement: video }
                    }));
                };
            })
            .catch(function(error) {
                console.error('[Engagement] Error accessing webcam:', error);
            });
    } else {
        console.error('[Engagement] getUserMedia not supported');
    }
}

// --- Rest of existing code ---