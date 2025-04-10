/**
 * Face Detection Module
 * Handles face detection and status messaging for lecture engagement
 */

const FaceDetection = (function() {
    // Configuration
    const config = {
        detectionInterval: 500,      // How often to check for faces (ms)
        consecutiveFramesNeeded: 3,  // How many consecutive frames needed to change status
        debugMode: false,            // Debug mode flag (default off)
        frameCaptureInterval: 1000,  // How often to save frames (1 second)
        maxStoredFrames: 300         // Maximum number of frames to store (5 minutes worth)
    };
    
    // State variables
    let initialized = false;
    let video = null;
    let faceDetector = null;
    let canvas = null;
    let canvasContext = null;
    let debugPanel = null;
    let statusElement = null;
    let consecutiveDetections = 0;
    let consecutiveNonDetections = 0;
    let faceDetected = false;
    let detectionInterval = null;
    let frameCaptureInterval = null;
    let engagementEnabled = false;
    let debugModeEnabled = false;
    let framesArray = [];
    let lastFrameTime = 0;
    let usingFallbackDetection = false;  // Flag to track if we're using fallback detection
    let faceAPIAvailable = false;        // Flag for face-api.js availability
    
    // Determine fallback method availability
    try {
        faceAPIAvailable = typeof faceapi !== 'undefined';
    } catch (e) {
        faceAPIAvailable = false;
    }
    
    /**
     * Creates the status UI element
     */
    function createStatusElement() {
        // Create the main status container if it doesn't exist
        if (document.getElementById('face-detection-status')) {
            statusElement = document.getElementById('face-detection-status');
            return;
        }
        
        // Create the main status container
        statusElement = document.createElement('div');
        statusElement.id = 'face-detection-status';
        statusElement.className = 'face-status-container';
        
        // Create the status icon
        const icon = document.createElement('div');
        icon.className = 'face-status-icon';
        
        // Create the status message
        const message = document.createElement('div');
        message.className = 'face-status-message';
        message.textContent = 'Initializing camera...';
        
        // Add elements to the container
        statusElement.appendChild(icon);
        statusElement.appendChild(message);
        
        // Add the container to the body
        document.body.appendChild(statusElement);
        
        // Add styles if they don't exist
        addStyles();
        
        console.log('[FaceDetection] Status element created');
    }
    
    /**
     * Creates a floating indicator that's always visible
     */
    function createFloatingIndicator() {
        // If it already exists, return it
        const existing = document.getElementById('face-detection-float-indicator');
        if (existing) return existing;
        
        // Create the indicator
        const indicator = document.createElement('div');
        indicator.id = 'face-detection-float-indicator';
        indicator.className = 'face-float-indicator initializing';
        indicator.title = 'Face Detection Status';
        
        // Add it to the body
        document.body.appendChild(indicator);
        
        console.log('[FaceDetection] Floating indicator created');
        return indicator;
    }
    
    /**
     * Creates the debug panel UI
     */
    function createDebugPanel() {
        // If debug panel already exists, return it
        const existing = document.getElementById('face-detection-debug');
        if (existing) {
            debugPanel = existing;
            return;
        }
        
        // Create the debug panel container
        debugPanel = document.createElement('div');
        debugPanel.id = 'face-detection-debug';
        debugPanel.className = 'face-debug-panel hidden';
        
        // Create header with title and toggle button
        const header = document.createElement('div');
        header.className = 'face-debug-header';
        
        const title = document.createElement('h3');
        title.textContent = 'Face Detection Debug';
        header.appendChild(title);
        
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Hide Debug View';
        toggleBtn.className = 'face-debug-toggle';
        toggleBtn.addEventListener('click', toggleDebugView);
        header.appendChild(toggleBtn);
        
        debugPanel.appendChild(header);
        
        // Create canvas for displaying the video stream with indicators
        canvas = document.createElement('canvas');
        canvas.className = 'face-debug-canvas';
        canvas.width = 320;
        canvas.height = 240;
        canvasContext = canvas.getContext('2d');
        debugPanel.appendChild(canvas);
        
        // Create debug info container
        const debugInfo = document.createElement('div');
        debugInfo.className = 'face-debug-info';
        debugPanel.appendChild(debugInfo);
        
        // Create frames info
        const framesInfo = document.createElement('div');
        framesInfo.className = 'face-debug-frames-info';
        framesInfo.innerHTML = '<strong>Frames:</strong> 0 stored';
        debugPanel.appendChild(framesInfo);
        
        // Add the panel to the body
        document.body.appendChild(debugPanel);
        
        console.log('[FaceDetection] Debug panel created');
        return debugPanel;
    }
    
    /**
     * Toggle debug view on/off
     */
    function toggleDebugView() {
        if (!debugPanel) return;
        
        const currentState = debugPanel.classList.contains('hidden');
        if (currentState) {
            // Show debug panel
            debugPanel.classList.remove('hidden');
            const toggleBtn = debugPanel.querySelector('.face-debug-toggle');
            if (toggleBtn) toggleBtn.textContent = 'Hide Debug View';
        } else {
            // Hide debug panel
            debugPanel.classList.add('hidden');
            const toggleBtn = debugPanel.querySelector('.face-debug-toggle');
            if (toggleBtn) toggleBtn.textContent = 'Show Debug View';
        }
    }
    
    /**
     * Updates the frames info in the debug panel
     */
    function updateFramesInfo() {
        if (!debugPanel || !debugModeEnabled) return;
        const framesInfo = debugPanel.querySelector('.face-debug-frames-info');
        if (framesInfo) {
            framesInfo.innerHTML = `<strong>Frames:</strong> ${framesArray.length} stored (${Math.round(framesArray.length * config.frameCaptureInterval / 1000)} seconds)`;
        }
    }
    
    /**
     * Adds the necessary CSS styles
     */
    function addStyles() {
        // Check if styles already exist
        if (document.getElementById('face-detection-styles')) return;
        
        const styleSheet = document.createElement('style');
        styleSheet.id = 'face-detection-styles';
        styleSheet.textContent = `
            .face-status-container {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 12px;
                z-index: 1000;
                font-family: 'Arial', sans-serif;
                box-shadow: 0 4px 8px rgba(0,0,0,0.25);
                transition: opacity 0.3s ease, transform 0.3s ease;
                opacity: 1;
                transform: translateY(0);
                max-width: 300px;
                pointer-events: none;
            }
            
            .face-status-container.hidden {
                opacity: 0;
                transform: translateY(20px);
                pointer-events: none;
            }
            
            .face-status-icon {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            
            .face-status-container.face-detected .face-status-icon {
                background-color: #4CAF50;
                box-shadow: 0 0 10px #4CAF50;
                animation: pulse-green 2s infinite;
            }
            
            .face-status-container.no-face .face-status-icon {
                background-color: #F44336;
                box-shadow: 0 0 10px #F44336;
                animation: pulse-red 2s infinite;
            }
            
            .face-status-container.initializing .face-status-icon {
                background-color: #FFC107;
                box-shadow: 0 0 10px #FFC107;
            }
            
            .face-status-message {
                font-size: 14px;
                line-height: 1.4;
                font-weight: 500;
            }
            
            /* Debug panel styles */
            .face-debug-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 15px;
                border-radius: 8px;
                z-index: 1001;
                font-family: 'Arial', sans-serif;
                box-shadow: 0 4px 8px rgba(0,0,0,0.25);
                transition: opacity 0.3s ease, transform 0.3s ease;
                display: flex;
                flex-direction: column;
                gap: 10px;
                min-width: 320px;
            }
            
            .face-debug-panel.hidden {
                opacity: 0;
                transform: translateY(-20px);
                pointer-events: none;
            }
            
            .face-debug-toggle {
                padding: 8px 12px;
                background: #2196F3;
                border: none;
                border-radius: 4px;
                color: white;
                cursor: pointer;
                font-weight: bold;
                align-self: flex-end;
            }
            
            .face-debug-toggle:hover {
                background: #0b7dda;
            }
            
            .face-debug-canvas {
                border: 2px solid #444;
                border-radius: 4px;
                width: 320px;
                height: 240px;
            }
            
            .face-debug-info, .face-debug-frames-info {
                font-size: 12px;
                padding: 5px;
                background-color: #333;
                border-radius: 4px;
            }
            
            @keyframes pulse-green {
                0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(76, 175, 80, 0); }
                100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
            }
            
            @keyframes pulse-red {
                0% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(244, 67, 54, 0); }
                100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0); }
            }
            
            /* Float indicator - Always visible */
            .face-float-indicator {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                z-index: 1002;
                box-shadow: 0 0 5px rgba(0,0,0,0.5);
                transition: background-color 0.3s ease;
            }
            
            .face-float-indicator.detected {
                background-color: #4CAF50;
            }
            
            .face-float-indicator.not-detected {
                background-color: #F44336;
            }
            
            .face-float-indicator.initializing {
                background-color: #FFC107;
            }
            
            @media (max-width: 768px) {
                .face-status-container {
                    bottom: 10px;
                    right: 10px;
                    padding: 8px 12px;
                }
                
                .face-status-message {
                    font-size: 12px;
                }
                
                .face-debug-panel {
                    min-width: 260px;
                }
                
                .face-debug-canvas {
                    width: 240px;
                    height: 180px;
                }
            }
        `;
        
        document.head.appendChild(styleSheet);
    }
    
    /**
     * Creates a small floating indicator for face detection status
     */
    function createFloatIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'face-float-indicator';
        indicator.className = 'face-float-indicator initializing';
        document.body.appendChild(indicator);
        
        // Add a title/tooltip
        indicator.title = 'Face Detection Status';
        
        return indicator;
    }
    
    /**
     * Updates the status UI with current face detection status
     */
    function updateStatusUI() {
        if (!statusElement) {
            createStatusElement();
        }
        
        // Update the floating indicator
        updateFloatingIndicator();
        
        // Make sure status is visible when engagement is enabled
        statusElement.classList.toggle('hidden', !engagementEnabled);
        
        // Update debug info if debug mode is enabled
        if (debugModeEnabled) {
            updateDebugInfo();
        }
        
        // No point updating status details if engagement is disabled
        if (!engagementEnabled) return;
        
        // Remove all status classes
        statusElement.classList.remove('face-detected', 'no-face', 'initializing');
        
        const messageElement = statusElement.querySelector('.face-status-message');
        if (!messageElement) return;
        
        if (!faceDetector && !usingFallbackDetection) {
            statusElement.classList.add('initializing');
            messageElement.textContent = 'Initializing face detection...';
        } else if (faceDetected) {
            statusElement.classList.add('face-detected');
            messageElement.textContent = 'Face detected! You are being tracked.';
        } else {
            statusElement.classList.add('no-face');
            messageElement.textContent = 'No face detected. Please adjust your camera position.';
        }
    }
    
    /**
     * Updates the floating indicator status
     */
    function updateFloatingIndicator() {
        const indicator = document.getElementById('face-detection-float-indicator') || createFloatingIndicator();
        
        indicator.classList.remove('detected', 'not-detected', 'initializing');
        
        if (!faceDetector && !usingFallbackDetection) {
            indicator.classList.add('initializing');
            indicator.title = 'Face Detection: Initializing';
        } else if (faceDetected) {
            indicator.classList.add('detected');
            indicator.title = 'Face Detected';
        } else {
            indicator.classList.add('not-detected');
            indicator.title = 'No Face Detected';
        }
        
        // Make the indicator show/hide debug panel on click
        indicator.onclick = function() {
            toggleDebugMode();
        };
    }
    
    /**
     * Updates the debug info display
     */
    function updateDebugInfo() {
        if (!debugPanel) {
            createDebugPanel();
        }
        
        const infoElement = debugPanel.querySelector('.face-debug-info');
        if (!infoElement) return;
        
        infoElement.innerHTML = `
            <div>Face Detection: ${engagementEnabled ? 'Enabled' : 'Disabled'}</div>
            <div>Face Detected: ${faceDetected ? 'YES' : 'NO'}</div>
            <div>Detection Method: ${usingFallbackDetection ? 'Fallback (Manual)' : (faceDetector ? 'FaceDetector API' : 'Initializing')}</div>
            <div>Consecutive Detections: ${consecutiveDetections}</div>
            <div>Consecutive Non-Detections: ${consecutiveNonDetections}</div>
            <div>Frame Capture: ${engagementEnabled ? 'Active' : 'Inactive'}</div>
            <div>Stored Frames: ${framesArray.length}</div>
            <div>Video Element: ${video ? 'Found' : 'Not Found'}</div>
        `;
        
        // Update frames count display
        const framesInfo = debugPanel.querySelector('.face-debug-frames-info');
        if (framesInfo) {
            framesInfo.innerHTML = `<strong>Frames:</strong> ${framesArray.length} stored (${Math.round(framesArray.length * config.frameCaptureInterval / 1000)} seconds)`;
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
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = 320;  // Smaller size for storage efficiency
                canvas.height = 240;
                canvasContext = canvas.getContext('2d');
            }
            
            // Draw the current video frame to the canvas
            canvasContext.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Convert to base64 data URL (as JPEG for smaller size)
            const dataURL = canvas.toDataURL('image/jpeg', 0.7); // 0.7 quality for better compression
            
            // Create frame object with metadata
            const frame = {
                timestamp: now,
                dataURL: dataURL,
                faceDetected: faceDetected
            };
            
            // Add to frames array
            framesArray.push(frame);
            
            // Limit array size to prevent memory issues
            if (framesArray.length > config.maxStoredFrames) {
                framesArray.shift(); // Remove oldest frame
            }
            
            // Update last capture time
            lastFrameTime = now;
            
            // Update debug info
            if (debugModeEnabled) {
                updateFramesInfo();
            }
            
            console.log(`[FaceDetection] Frame captured at ${new Date(now).toISOString()}, face: ${faceDetected}`);
        } catch (err) {
            console.error('[FaceDetection] Error capturing frame:', err);
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
        updateFramesInfo();
        console.log('[FaceDetection] All stored frames cleared');
    }
    
    /**
     * Renders the debug view with face indicators
     * @param {Array} faces - Array of detected faces
     */
    function renderDebugView(faces = []) {
        if (!canvas || !canvasContext || !video || !debugModeEnabled) return;
        
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear the canvas
        canvasContext.clearRect(0, 0, width, height);
        
        // Draw the video frame
        canvasContext.drawImage(video, 0, 0, width, height);
        
        // Draw rectangles around detected faces
        canvasContext.strokeStyle = faceDetected ? '#4CAF50' : '#F44336';
        canvasContext.lineWidth = 2;
        
        faces.forEach(face => {
            // Scale the face bounds to match our canvas size
            const boundingBox = face.boundingBox;
            const scaleX = width / video.videoWidth;
            const scaleY = height / video.videoHeight;
            
            const x = boundingBox.left * scaleX;
            const y = boundingBox.top * scaleY;
            const w = boundingBox.width * scaleX;
            const h = boundingBox.height * scaleY;
            
            // Draw the face rectangle
            canvasContext.strokeRect(x, y, w, h);
            
            // Add a label
            canvasContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
            canvasContext.fillRect(x, y - 20, 70, 20);
            canvasContext.fillStyle = '#FFF';
            canvasContext.font = '12px Arial';
            canvasContext.fillText('Face Detected', x + 5, y - 5);
        });
        
        // If no faces, add a "No Face" indicator
        if (faces.length === 0) {
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
     * Initializes face detection using the Face Detection API
     */
    async function initFaceDetection() {
        if (!('FaceDetector' in window)) {
            console.error('[FaceDetection] FaceDetector API not available in this browser');
            // Show error in status element
            if (statusElement) {
                const messageElement = statusElement.querySelector('.face-status-message');
                if (messageElement) {
                    messageElement.textContent = 'Face detection not supported in this browser';
                }
                statusElement.classList.remove('hidden');
            }
            // Fallback to assume face is always detected to not block functionality
            faceDetected = true;
            updateStatusUI();
            return false;
        }
        
        try {
            faceDetector = new FaceDetector({
                // We don't need high accuracy for simple presence detection
                maxDetectedFaces: 1,
                fastMode: true
            });
            return true;
        } catch (err) {
            console.error('[FaceDetection] Error initializing FaceDetector:', err);
            // Fallback to assume face is always detected
            faceDetected = true;
            updateStatusUI();
            return false;
        }
    }
    
    /**
     * Detects faces in the current video frame
     */
    async function detectFaces() {
        if (!video || !faceDetector || !engagementEnabled) return;
        
        try {
            // Only proceed if video is playing
            if (video.readyState < 2) return;
            
            const faces = await faceDetector.detect(video);
            
            // Update debug view with detected faces
            if (debugModeEnabled) {
                renderDebugView(faces);
            }
            
            if (faces.length > 0) {
                consecutiveDetections++;
                consecutiveNonDetections = 0;
                
                // Only change status after several consecutive detections
                if (!faceDetected && consecutiveDetections >= config.consecutiveFramesNeeded) {
                    faceDetected = true;
                    updateStatusUI();
                    console.log('[FaceDetection] Face detected');
                }
            } else {
                consecutiveNonDetections++;
                consecutiveDetections = 0;
                
                // Only change status after several consecutive non-detections
                if (faceDetected && consecutiveNonDetections >= config.consecutiveFramesNeeded) {
                    faceDetected = false;
                    updateStatusUI();
                    console.log('[FaceDetection] No face detected');
                }
                
                // Always render the debug view even without faces
                if (debugModeEnabled) {
                    renderDebugView([]);
                }
            }
        } catch (err) {
            console.error('[FaceDetection] Error detecting faces:', err);
            
            // Keep rendering debug view even on error
            if (debugModeEnabled) {
                renderDebugView([]);
            }
        }
    }
    
    /**
     * Starts face detection
     */
    function startDetection() {
        if (detectionInterval) return;
        
        detectionInterval = setInterval(detectFaces, config.detectionInterval);
        console.log('[FaceDetection] Face detection started');
    }
    
    /**
     * Stops face detection
     */
    function stopDetection() {
        if (detectionInterval) {
            clearInterval(detectionInterval);
            detectionInterval = null;
            console.log('[FaceDetection] Face detection stopped');
        }
    }
    
    /**
     * Starts frame capture
     */
    function startFrameCapture() {
        if (frameCaptureInterval) return;
        
        // Reset frames array
        framesArray = [];
        lastFrameTime = 0;
        
        frameCaptureInterval = setInterval(captureFrame, config.frameCaptureInterval / 2); // Check twice as often to ensure we capture exactly 1 FPS
        console.log('[FaceDetection] Frame capture started');
    }
    
    /**
     * Stops frame capture
     */
    function stopFrameCapture() {
        if (frameCaptureInterval) {
            clearInterval(frameCaptureInterval);
            frameCaptureInterval = null;
            console.log('[FaceDetection] Frame capture stopped');
        }
    }
    
    /**
     * Initializes the module with a video element
     * @param {HTMLVideoElement} videoElement - The video element to use for face detection
     */
    async function init(videoElement) {
        console.log('[FaceDetection] Initializing with video element:', videoElement);
        
        // Save reference to video element
        video = videoElement;
        
        if (!video) {
            console.error('[FaceDetection] No video element provided');
            return;
        }
        
        // Create UI elements whether initialized or not
        createStatusElement();
        createFloatingIndicator();
        
        // Check for debug mode in localStorage
        debugModeEnabled = localStorage.getItem('faceDetectionDebugMode') === 'true';
        if (debugModeEnabled) {
            createDebugPanel();
            debugPanel.classList.remove('hidden');
        }
        
        // Only initialize once
        if (initialized) {
            console.log('[FaceDetection] Already initialized, updating video reference');
            return;
        }
        
        // Initialize face detection
        const success = await initFaceDetection();
        
        if (success) {
            startDetection();
            console.log('[FaceDetection] Detection successfully initialized');
        }
        
        initialized = true;
        updateStatusUI();
        
        // Make status visible immediately for feedback
        statusElement.classList.remove('hidden');
        
        // Add developer keyboard shortcut for debug mode (Cmd+Shift+F for macOS, Ctrl+Shift+F for others)
        document.addEventListener('keydown', (e) => {
            if ((navigator.platform.indexOf('Mac') > -1 ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key === 'F') {
                toggleDebugMode();
                e.preventDefault();
            }
        });
        
        console.log('[FaceDetection] Initialization complete');
    }
    
    /**
     * Toggles debug mode on/off
     */
    function toggleDebugMode() {
        debugModeEnabled = !debugModeEnabled;
        
        // Save preference to localStorage
        localStorage.setItem('faceDetectionDebugMode', debugModeEnabled);
        
        if (debugModeEnabled) {
            console.log('[FaceDetection] Debug mode enabled');
            if (!debugPanel) {
                createDebugPanel();
            }
            debugPanel.classList.remove('hidden');
        } else {
            console.log('[FaceDetection] Debug mode disabled');
            if (debugPanel) {
                debugPanel.classList.add('hidden');
            }
        }
        
        updateStatusUI();
    }
    
    /**
     * Sets the engagement detection status
     * @param {boolean} enabled - Whether engagement detection is enabled
     */
    function setEngagementEnabled(enabled) {
        console.log('[FaceDetection] Setting engagement detection to:', enabled);
        engagementEnabled = enabled;
        
        if (enabled) {
            statusElement.classList.remove('hidden');
            startDetection();
            startFrameCapture();
        } else {
            // Don't hide status immediately - let user see status is disabled
            setTimeout(() => {
                if (!engagementEnabled) {
                    statusElement.classList.add('hidden');
                }
            }, 3000);
            stopDetection();
            stopFrameCapture();
        }
        
        updateStatusUI();
    }
    
    // Public API
    return {
        init,
        setEngagementEnabled,
        toggleDebugMode,
        isInitialized: () => initialized,
        isFaceDetected: () => faceDetected,
        isDebugModeEnabled: () => debugModeEnabled,
        getStoredFrames,
        clearStoredFrames,
        isUsingFallbackDetection: () => usingFallbackDetection
    };
})();

// Export for ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaceDetection;
}
