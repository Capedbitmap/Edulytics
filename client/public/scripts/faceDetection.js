/**
 * Face Detection Module (using face-api.js)
 * Handles face detection and status messaging for lecture engagement
 */

// Assign the IIFE result to window.FaceDetection
window.FaceDetection = (function() {
    // Configuration
    const config = {
        detectionInterval: 500,      // How often to check for faces (ms)
        consecutiveFramesNeeded: 3,  // How many consecutive frames needed to change status
        debugMode: false,            // Debug mode flag (default off)
        frameCaptureInterval: 1000,  // How often to save frames (1 second)
        faceApiOptions: null         // Will be set during init
    };

    // State variables
    let initialized = false;
    let video = null;
    let canvas = null; // For debug view
    let canvasContext = null; // For debug view
    let debugPanel = null;
    let statusElement = null;
    let floatIndicator = null;
    let consecutiveDetections = 0;
    let consecutiveNonDetections = 0;
    let faceDetected = false;
    let detectionInterval = null;
    let frameCaptureInterval = null;
    let engagementEnabled = false;
    let debugModeEnabled = false;
    let framesArray = [];
    let lastFrameTime = 0;
    let faceApiLoaded = false; // Track if face-api models are loaded

    /**
     * Adds the necessary CSS styles
     */
    function addStyles() {
        if (document.getElementById('face-detection-styles')) return;
        const styleSheet = document.createElement('style');
        styleSheet.id = 'face-detection-styles';
        styleSheet.textContent = `
            /* Status Container */
            .face-status-container {
                position: fixed; bottom: 20px; right: 20px; background-color: rgba(0, 0, 0, 0.8);
                color: white; padding: 12px 16px; border-radius: 8px; display: flex;
                align-items: center; gap: 12px; z-index: 1000; font-family: 'Arial', sans-serif;
                box-shadow: 0 4px 8px rgba(0,0,0,0.25); transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 1; transform: translateY(0); max-width: 300px; pointer-events: none;
            }
            .face-status-container.hidden { opacity: 0; transform: translateY(20px); pointer-events: none; }
            .face-status-icon { width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; }
            .face-status-container.face-detected .face-status-icon { background-color: #4CAF50; box-shadow: 0 0 10px #4CAF50; animation: pulse-green 2s infinite; }
            .face-status-container.no-face .face-status-icon { background-color: #F44336; box-shadow: 0 0 10px #F44336; animation: pulse-red 2s infinite; }
            .face-status-container.initializing .face-status-icon { background-color: #FFC107; box-shadow: 0 0 10px #FFC107; }
            .face-status-message { font-size: 14px; line-height: 1.4; font-weight: 500; }

            /* Float Indicator */
            .face-float-indicator {
                position: fixed; top: 20px; right: 20px; width: 16px; height: 16px;
                border-radius: 50%; z-index: 1002; box-shadow: 0 0 5px rgba(0,0,0,0.5);
                transition: background-color 0.3s ease; cursor: pointer;
            }
            .face-float-indicator.detected { background-color: #4CAF50; }
            .face-float-indicator.not-detected { background-color: #F44336; }
            .face-float-indicator.initializing { background-color: #FFC107; }

            /* Debug Panel */
            .face-debug-panel {
                position: fixed; top: 50px; right: 20px; background-color: rgba(0, 0, 0, 0.85);
                color: white; padding: 15px; border-radius: 8px; z-index: 1001;
                font-family: 'Arial', sans-serif; box-shadow: 0 4px 8px rgba(0,0,0,0.25);
                transition: opacity 0.3s ease, transform 0.3s ease; display: flex;
                flex-direction: column; gap: 10px; min-width: 320px;
            }
            .face-debug-panel.hidden { opacity: 0; transform: translateY(-20px); pointer-events: none; }
            .face-debug-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
            .face-debug-header h3 { margin: 0; font-size: 16px; }
            .face-debug-toggle { font-size: 12px; padding: 6px 10px; background: #2196F3; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: bold; }
            .face-debug-toggle:hover { background: #0b7dda; }
            .face-debug-canvas { border: 2px solid #444; border-radius: 4px; width: 320px; height: 240px; background-color: #111; }
            .face-debug-info, .face-debug-frames-info { font-size: 12px; padding: 8px; background-color: #333; border-radius: 4px; line-height: 1.4; }

            /* Animations */
            @keyframes pulse-green { 0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(76, 175, 80, 0); } 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); } }
            @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(244, 67, 54, 0); } 100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0); } }

            /* Responsive */
            @media (max-width: 768px) {
                .face-status-container { bottom: 10px; right: 10px; padding: 8px 12px; }
                .face-status-message { font-size: 12px; }
                .face-debug-panel { min-width: 260px; top: 50px; } /* Adjust top position */
                .face-debug-canvas { width: 240px; height: 180px; }
            }
        `;
        document.head.appendChild(styleSheet);
        console.log('[FaceDetection] Styles added');
    }

    /**
     * Creates the status UI element
     */
    function createStatusElement() {
        if (document.getElementById('face-detection-status')) {
            statusElement = document.getElementById('face-detection-status');
            return;
        }
        statusElement = document.createElement('div');
        statusElement.id = 'face-detection-status';
        statusElement.className = 'face-status-container hidden'; // Start hidden
        const icon = document.createElement('div');
        icon.className = 'face-status-icon';
        const message = document.createElement('div');
        message.className = 'face-status-message';
        message.textContent = 'Initializing...';
        statusElement.appendChild(icon);
        statusElement.appendChild(message);
        document.body.appendChild(statusElement);
        addStyles(); // Ensure styles are added if not already
        console.log('[FaceDetection] Status element created');
    }

    /**
     * Creates a floating indicator that's always visible
     */
    function createFloatingIndicator() {
        const existing = document.getElementById('face-detection-float-indicator');
        if (existing) {
            floatIndicator = existing; // Assign existing to module variable
            return existing;
        }
        floatIndicator = document.createElement('div');
        floatIndicator.id = 'face-detection-float-indicator';
        floatIndicator.className = 'face-float-indicator initializing';
        floatIndicator.title = 'Face Detection Status (Click to toggle debug)';
        document.body.appendChild(floatIndicator);
        // NOTE: onclick listener is added in init() after toggleDebugMode is defined
        console.log('[FaceDetection] Floating indicator created');
        return floatIndicator;
    }

    /**
     * Creates the debug panel UI
     */
    function createDebugPanel() {
        const existing = document.getElementById('face-detection-debug');
        if (existing) {
            debugPanel = existing;
            return;
        }
        debugPanel = document.createElement('div');
        debugPanel.id = 'face-detection-debug';
        debugPanel.className = 'face-debug-panel hidden'; // Start hidden
        const header = document.createElement('div');
        header.className = 'face-debug-header';
        const title = document.createElement('h3');
        title.textContent = 'Face Detection Debug';
        header.appendChild(title);
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Hide Debug View';
        toggleBtn.className = 'face-debug-toggle';
        toggleBtn.addEventListener('click', toggleDebugMode); // Use event listener
        header.appendChild(toggleBtn);
        debugPanel.appendChild(header);
        canvas = document.createElement('canvas');
        canvas.className = 'face-debug-canvas';
        canvas.width = 320;
        canvas.height = 240;
        canvasContext = canvas.getContext('2d');
        debugPanel.appendChild(canvas);
        const debugInfo = document.createElement('div');
        debugInfo.className = 'face-debug-info';
        debugPanel.appendChild(debugInfo);
        const framesInfo = document.createElement('div');
        framesInfo.className = 'face-debug-frames-info';
        framesInfo.innerHTML = '<strong>Frames:</strong> 0 stored';
        debugPanel.appendChild(framesInfo);
        document.body.appendChild(debugPanel);
        console.log('[FaceDetection] Debug panel created');
    }

    /**
     * Toggle debug view on/off
     */
    function toggleDebugMode() {
        if (!debugPanel) createDebugPanel(); // Create if doesn't exist
        // Check current state *before* toggling class
        const isCurrentlyHidden = debugPanel.classList.contains('hidden');
        debugModeEnabled = isCurrentlyHidden; // If hidden, enabling; if visible, disabling

        debugPanel.classList.toggle('hidden');
        localStorage.setItem('faceDetectionDebugMode', debugModeEnabled); // Save the new state

        const toggleBtn = debugPanel.querySelector('.face-debug-toggle');
        if (toggleBtn) toggleBtn.textContent = debugModeEnabled ? 'Hide Debug View' : 'Show Debug View';
        console.log(`[FaceDetection] Debug mode ${debugModeEnabled ? 'enabled' : 'disabled'}`);
        updateDebugInfo(); // Update info when toggling
    }

    /**
     * Updates the status UI (bottom message)
     */
    function updateStatusUI() {
        if (!statusElement) createStatusElement(); // Ensure element exists
        statusElement.classList.toggle('hidden', !engagementEnabled);
        if (!engagementEnabled) return;

        statusElement.classList.remove('face-detected', 'no-face', 'initializing');
        const messageElement = statusElement.querySelector('.face-status-message');
        if (!messageElement) return;

        if (!faceApiLoaded) { // Check if face-api models are loaded
            statusElement.classList.add('initializing');
            messageElement.textContent = 'Initializing face detection...';
        } else if (faceDetected) {
            statusElement.classList.add('face-detected');
            messageElement.textContent = 'Face detected! Tracking active.';
        } else {
            statusElement.classList.add('no-face');
            messageElement.textContent = 'No face detected. Adjust camera.';
        }
    }

    /**
     * Updates the floating indicator (top-right dot)
     */
    function updateFloatingIndicator() {
        if (!floatIndicator) floatIndicator = createFloatingIndicator(); // Ensure element exists
        floatIndicator.classList.remove('detected', 'not-detected', 'initializing');

        if (!faceApiLoaded) { // Check if face-api models are loaded
            floatIndicator.classList.add('initializing');
            floatIndicator.title = 'Face Detection: Initializing';
        } else if (faceDetected) {
            floatIndicator.classList.add('detected');
            floatIndicator.title = 'Face Detected';
        } else {
            floatIndicator.classList.add('not-detected');
            floatIndicator.title = 'No Face Detected';
        }
    }

    /**
     * Updates the debug info display
     */
    function updateDebugInfo() {
        if (!debugPanel || !debugModeEnabled) return;
        const infoElement = debugPanel.querySelector('.face-debug-info');
        if (!infoElement) return;
        infoElement.innerHTML = `
            <div>Detection: ${engagementEnabled ? 'Enabled' : 'Disabled'}</div>
            <div>Face Detected: ${faceDetected ? 'YES' : 'NO'}</div>
            <div>Method: face-api.js (${faceApiLoaded ? 'Loaded' : 'Loading...'})</div>
            <div>Consecutive Hits: ${consecutiveDetections} / Misses: ${consecutiveNonDetections}</div>
            <div>Frame Capture: ${frameCaptureInterval ? 'Active' : 'Inactive'}</div>
            <div>Stored Frames: ${framesArray.length}</div>
            <div>Video: ${video ? `${video.videoWidth}x${video.videoHeight}` : 'Not Found'}</div>
        `;
        const framesInfo = debugPanel.querySelector('.face-debug-frames-info');
        if (framesInfo) {
            framesInfo.innerHTML = `<strong>Frames:</strong> ${framesArray.length} stored (${Math.round(framesArray.length * config.frameCaptureInterval / 1000)}s)`;
        }
    }

    /**
     * Renders the debug view with face indicators using face-api.js results
     */
    function renderDebugView(detections = []) {
        if (!canvasContext || !video || !debugModeEnabled || video.readyState < 2) return;
        const width = canvas.width;
        const height = canvas.height;
        canvasContext.clearRect(0, 0, width, height);
        canvasContext.drawImage(video, 0, 0, width, height); // Draw video frame

        if (detections.length > 0) {
            // Use face-api.js draw functions if available, otherwise draw simple box
            if (typeof faceapi !== 'undefined' && faceapi.draw) {
                 // Resize detections to match canvas size
                const resizedDetections = faceapi.resizeResults(detections, { width, height });
                faceapi.draw.drawDetections(canvas, resizedDetections);
            } else {
                // Simple fallback box drawing
                canvasContext.strokeStyle = '#4CAF50'; // Green box
                canvasContext.lineWidth = 2;
                detections.forEach(det => {
                    const box = det.detection ? det.detection.box : det.box; // Handle different detection structures
                    if (box) {
                         // Scale box coordinates
                        const scaleX = width / video.videoWidth;
                        const scaleY = height / video.videoHeight;
                        const x = box.x * scaleX;
                        const y = box.y * scaleY;
                        const w = box.width * scaleX;
                        const h = box.height * scaleY;
                        canvasContext.strokeRect(x, y, w, h);
                    }
                });
            }
        } else if (!faceDetected && engagementEnabled) { // Only show "No Face" if detection is active but no face found
             canvasContext.fillStyle = 'rgba(255, 0, 0, 0.3)';
             canvasContext.fillRect(0, 0, width, height);
             canvasContext.fillStyle = '#FFF';
             canvasContext.font = '20px Arial';
             canvasContext.textAlign = 'center';
             canvasContext.fillText('No Face Detected', width/2, height/2);
             canvasContext.textAlign = 'start';
        }
    }

    /**
     * Captures a frame from the video stream and stores it
     */
    function captureFrame() {
         if (!video || !engagementEnabled) return;

        const now = Date.now();
        // Check if a second has passed since the last capture
        if (now - lastFrameTime < config.frameCaptureInterval) return;

        try {
            // Only proceed if video is playing
            if (video.readyState < 2) return;

            // Create temporary canvas if needed
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 320;  // Smaller size for storage efficiency
            tempCanvas.height = 240;
            const tempCtx = tempCanvas.getContext('2d');


            // Draw the current video frame to the canvas
            tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

            // Convert to base64 data URL (as JPEG for smaller size)
            const dataURL = tempCanvas.toDataURL('image/jpeg', 0.7); // 0.7 quality for better compression

            // Create frame object with metadata
            const frame = {
                timestamp: now,
                dataURL: dataURL,
                faceDetected: faceDetected // Use the current state determined by face-api.js
            };

            // Add to frames array
            framesArray.push(frame);

            // Limit array size to prevent memory issues
            if (framesArray.length > 300) { // Store max 5 minutes (300 frames at 1fps)
                framesArray.shift(); // Remove oldest frame
            }

            // Update last capture time
            lastFrameTime = now;

            // Update debug info
            if (debugModeEnabled) {
                updateDebugInfo();
            }
        } catch (err) {
            console.error('[FaceDetection] Error capturing frame:', err);
        }
    }

    /**
     * Detects faces using face-api.js
     */
    async function detectFaces() {
        if (!video || !faceApiLoaded || !engagementEnabled || video.readyState < 2) {
             if (debugModeEnabled && canvasContext) renderDebugView([]); // Clear debug view if detection isn't running
            return;
        }

        try {
            // Use face-api.js for detection
            const detections = await faceapi.detectAllFaces(video, config.faceApiOptions);

            if (detections.length > 0) {
                consecutiveDetections++;
                consecutiveNonDetections = 0;
                if (!faceDetected && consecutiveDetections >= config.consecutiveFramesNeeded) {
                    faceDetected = true;
                    updateStatusUI(); // Update both status message and float indicator
                    console.log('[FaceDetection] Face detected via face-api.js');
                }
            } else {
                consecutiveNonDetections++;
                consecutiveDetections = 0;
                if (faceDetected && consecutiveNonDetections >= config.consecutiveFramesNeeded) {
                    faceDetected = false;
                    updateStatusUI(); // Update both status message and float indicator
                    console.log('[FaceDetection] No face detected via face-api.js');
                }
            }

            // Update debug view if enabled
            if (debugModeEnabled) {
                renderDebugView(detections);
            }

        } catch (err) {
            console.error('[FaceDetection] Error during face-api.js detection:', err);
             if (debugModeEnabled && canvasContext) renderDebugView([]); // Clear debug view on error
        }
    }

    /**
     * Starts face detection interval
     */
    function startDetection() {
        if (detectionInterval) return; // Already running
        if (!faceApiLoaded) {
            console.warn('[FaceDetection] Cannot start detection, face-api.js not loaded.');
            return;
        }
        detectionInterval = setInterval(detectFaces, config.detectionInterval);
        console.log('[FaceDetection] Face detection interval started');
    }

    /**
     * Stops face detection interval
     */
    function stopDetection() {
        if (detectionInterval) {
            clearInterval(detectionInterval);
            detectionInterval = null;
            console.log('[FaceDetection] Face detection interval stopped');
             if (debugModeEnabled && canvasContext) renderDebugView([]); // Clear debug view when stopped
        }
    }

    /**
     * Starts frame capture interval
     */
    function startFrameCapture() {
        if (frameCaptureInterval) return;
        framesArray = []; // Clear previous frames
        lastFrameTime = 0;
        frameCaptureInterval = setInterval(captureFrame, config.frameCaptureInterval / 2); // Check more often
        console.log('[FaceDetection] Frame capture started');
    }

    /**
     * Stops frame capture interval
     */
    function stopFrameCapture() {
        if (frameCaptureInterval) {
            clearInterval(frameCaptureInterval);
            frameCaptureInterval = null;
            console.log('[FaceDetection] Frame capture stopped');
        }
    }

    /**
     * Initializes the module
     */
    async function init(videoElement, faceApiModelLoaded, faceApiDetectionOptions) {
        console.log('[FaceDetection] Initializing with video element:', videoElement);
        if (initialized) {
             console.log('[FaceDetection] Already initialized.');
             // Update video ref if needed, though engagement.js should handle this
             if(videoElement) video = videoElement;
             return;
        }

        video = videoElement;
        faceApiLoaded = faceApiModelLoaded;
        config.faceApiOptions = faceApiDetectionOptions; // Store options passed from engagement.js

        if (!video) {
            console.error('[FaceDetection] No video element provided during init');
            return;
        }
        if (!faceApiLoaded) {
            console.error('[FaceDetection] face-api.js models not loaded during init');
            // Update UI to show loading state
             updateStatusUI();
             updateFloatingIndicator();
            return; // Cannot proceed without models
        }
         if (!config.faceApiOptions) {
            console.error('[FaceDetection] face-api.js options not provided during init');
            return; // Cannot proceed without options
        }

        // Create UI elements
        createStatusElement();
        createFloatingIndicator(); // Creates or gets the indicator

        // Check for debug mode in localStorage
        debugModeEnabled = localStorage.getItem('faceDetectionDebugMode') === 'true';
        if (debugModeEnabled) {
            createDebugPanel(); // Creates or gets the panel
            if(debugPanel) debugPanel.classList.remove('hidden'); // Ensure it's visible if enabled
        }

        initialized = true;
        updateStatusUI(); // Update UI now that we know models are loaded

        // Add keyboard shortcut listener
        document.addEventListener('keydown', (e) => {
            if ((navigator.platform.indexOf('Mac') > -1 ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key === 'F') {
                toggleDebugMode();
                e.preventDefault();
            }
        });

        // Add click listener to float indicator *after* toggleDebugMode is defined
        if (floatIndicator) {
            floatIndicator.onclick = toggleDebugMode; // Assign the function reference
        } else {
            console.error("[FaceDetection] Float indicator not found after creation.");
        }

        console.log('[FaceDetection] Initialization complete using face-api.js');
    }

    /**
     * Sets the engagement detection status
     */
    function setEngagementEnabled(enabled) {
        console.log('[FaceDetection] Setting engagement detection to:', enabled);
        if (!initialized) {
            console.warn('[FaceDetection] Cannot set engagement status, module not initialized.');
            return;
        }
        engagementEnabled = enabled;

        if (enabled) {
            if(statusElement) statusElement.classList.remove('hidden');
            startDetection();
            startFrameCapture();
        } else {
            stopDetection();
            stopFrameCapture();
            // Delay hiding status message
            setTimeout(() => {
                if (!engagementEnabled && statusElement) statusElement.classList.add('hidden');
            }, 3000);
        }
        updateStatusUI(); // Update UI immediately
    }

     /**
     * Notifies the module that face-api models are loaded
     */
    function setModelsLoaded(loaded, options) {
        console.log('[FaceDetection] Models loaded status:', loaded);
        faceApiLoaded = loaded;
        config.faceApiOptions = options; // Update options if provided again
        if (initialized) {
            updateStatusUI(); // Update UI state
            if (loaded && engagementEnabled) {
                startDetection(); // Start detection if it wasn't running
            }
        }
    }

    /**
     * Returns the stored frames array
     */
    function getStoredFrames() {
        return framesArray;
    }

    /**
     * Clears all stored frames
     */
    function clearStoredFrames() {
        framesArray = [];
        console.log('[FaceDetection] All stored frames cleared');
        if (debugModeEnabled) {
            updateDebugInfo();
        }
    }


    // Public API
    return {
        init,
        setEngagementEnabled,
        setModelsLoaded, // Add this method
        toggleDebugMode,
        isInitialized: () => initialized,
        isFaceDetected: () => faceDetected,
        isDebugModeEnabled: () => debugModeEnabled,
        getStoredFrames,
        clearStoredFrames
        // Removed isUsingFallbackDetection as it's no longer relevant
    };
})(); // IIFE closes here

// Export for ES modules (optional)
// if (typeof module !== 'undefined' && module.exports) {
//     module.exports = FaceDetection;
// }
