/**
 * EngagementStreamer - Client-side webcam video capture and streaming to Node.js
 * 
 * This module implements Phase 1 of the Python Engagement Detection Integration Plan:
 * - Captures webcam video frames
 * - Converts frames to JPEG format
 * - Streams frames to Node.js backend via Socket.IO
 * - Manages UI feedback for engagement monitoring status
 */

(function(window) {
    'use strict';

    /**
     * EngagementStreamer Class
     * Handles webcam access, frame capture, and streaming
     */
    function EngagementStreamer() {
        // Configuration (Task 1.3 - Add missing properties)
        this.config = {
            video: {
                width: { ideal: 320 },
                height: { ideal: 240 },
                frameRate: { ideal: 10 }
            }
        };

        // Task 1.3 - Properties as specified in the plan
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasContext = null;
        this.frameIntervalId = null; // To store ID from setInterval
        this.targetFps = 10; // Target frames per second for streaming
        this.jpegQuality = 0.7; // JPEG quality (0.0 to 1.0)

        // Session state
        this.mediaStream = null;
        this.studentId = null;
        this.lectureCode = null;
        this.isActive = false;

        // Task 1.4 - Socket.IO for dedicated namespace
        this.socket = null; // Will be initialized for /engagement-stream namespace

        // DOM Elements for UI feedback
        this.statusElements = {
            monitoring: null,
            statusText: null,
            webcamAccess: null
        };

        // Bind methods
        this.requestWebcamAccess = this.requestWebcamAccess.bind(this);
        this.startStreaming = this.startStreaming.bind(this);
        this.stopStreaming = this.stopStreaming.bind(this);
        this.captureAndSendFrame = this.captureAndSendFrame.bind(this);
        this.updateStatus = this.updateStatus.bind(this);

        this.init();
    }

    /**
     * Initialize the EngagementStreamer
     */
    EngagementStreamer.prototype.init = function() {
        console.log('[EngagementStreamer] Initializing...');
        
        // Get DOM elements
        this.videoElement = document.getElementById('webcamFeed');
        this.canvasElement = document.getElementById('captureCanvas');
        this.statusElements.monitoring = document.getElementById('engagementMonitoringStatus');
        this.statusElements.statusText = document.getElementById('engagementStatusText');
        this.statusElements.webcamAccess = document.getElementById('webcamAccessStatus');

        if (!this.videoElement) {
            console.error('[EngagementStreamer] Required webcamFeed element not found');
            return;
        }

        // Create canvas element if it doesn't exist
        if (!this.canvasElement) {
            this.canvasElement = document.createElement('canvas');
            this.canvasElement.id = 'captureCanvas';
            this.canvasElement.style.display = 'none';
            document.body.appendChild(this.canvasElement);
        }

        console.log('[EngagementStreamer] Initialization complete');
    };

    /**
     * Task 1.4: Socket.IO Integration for Video Streaming
     * Initialize a Socket.IO client instance for the dedicated /engagement-stream namespace
     */
    EngagementStreamer.prototype.initializeSocket = function() {
        if (this.socket && this.socket.connected) {
            console.log('[EngagementStreamer] Socket already connected');
            return;
        }

        try {
            // Use dedicated namespace /engagement-stream with autoConnect: false
            this.socket = io('/engagement-stream', { autoConnect: false });

            // Add listeners for connect, disconnect, and connect_error events
            this.socket.on('connect', () => {
                console.log('[EngagementStreamer] Connected to /engagement-stream namespace:', this.socket.id);
                this.updateStatus('Connected to engagement service', 'success');
            });

            this.socket.on('disconnect', (reason) => {
                console.log('[EngagementStreamer] Disconnected from /engagement-stream namespace. Reason:', reason);
                this.updateStatus('Disconnected from engagement service', 'error');
            });

            this.socket.on('connect_error', (error) => {
                console.error('[EngagementStreamer] Connection error to /engagement-stream namespace:', error);
                this.updateStatus('Connection error to engagement service', 'error');
            });

            // Listen for system error messages from the server
            this.socket.on('engagement_system_error', (data) => {
                console.error('[EngagementStreamer] System error from server:', data);
                this.updateStatus(data.error || 'System error occurred', 'error');
            });

        } catch (error) {
            console.error('[EngagementStreamer] Failed to initialize socket:', error);
            this.updateStatus('Failed to initialize connection', 'error');
        }
    };

    /**
     * Request webcam access with specified parameters
     * @returns {Promise<MediaStream>} Promise resolving to MediaStream or rejecting with error
     */
    EngagementStreamer.prototype.requestWebcamAccess = async function() {
        console.log('[EngagementStreamer] Requesting webcam access...');
        
        try {
            // Hide any previous error messages
            this.hideWebcamAccessError();

            // Request media stream with specific parameters
            const stream = await navigator.mediaDevices.getUserMedia({
                video: this.config.video,
                audio: false // No audio needed for engagement detection
            });

            // Store the stream and attach to video element
            this.mediaStream = stream;
            this.videoElement.srcObject = stream;

            // Wait for video metadata to load
            await new Promise((resolve, reject) => {
                this.videoElement.onloadedmetadata = () => {
                    console.log('[EngagementStreamer] Video metadata loaded');
                    resolve();
                };
                this.videoElement.onerror = (error) => {
                    console.error('[EngagementStreamer] Video loading error:', error);
                    reject(error);
                };
            });

            console.log('[EngagementStreamer] Webcam access granted successfully');
            this.updateStatus('Webcam access granted', 'success');
            
            return stream;

        } catch (error) {
            console.error('[EngagementStreamer] Webcam access error:', error);
            
            // Handle different types of errors
            let errorMessage = 'Webcam access failed';
            
            switch (error.name) {
                case 'NotFoundError':
                    errorMessage = 'No webcam found';
                    break;
                case 'NotAllowedError':
                    errorMessage = 'Webcam access denied. Please check browser permissions.';
                    break;
                case 'AbortError':
                    errorMessage = 'Webcam access aborted';
                    break;
                case 'SecurityError':
                    errorMessage = 'Security error accessing webcam';
                    break;
                case 'TypeError':
                    errorMessage = 'Invalid webcam configuration';
                    break;
                default:
                    errorMessage = `Webcam error: ${error.message}`;
            }

            this.showWebcamAccessError(errorMessage);
            this.updateStatus(errorMessage, 'error');
            
            throw new Error(errorMessage);
        }
    };

    /**
     * Task 1.3: Start streaming video frames to the backend
     * @param {string} studentId - Student identifier
     * @param {string} lectureCode - Lecture code identifier
     */
    EngagementStreamer.prototype.startStreaming = async function(studentId, lectureCode) {
        console.log('[EngagementStreamer] Starting streaming for student:', studentId, 'lecture:', lectureCode);

        // Set studentId and lectureCode
        this.studentId = studentId;
        this.lectureCode = lectureCode;

        try {
            // Establish or ensure an active Socket.IO connection
            this.initializeSocket();
            if (!this.socket.connected) {
                this.socket.connect();
            }

            // Call requestWebcamAccess - if it fails, display error and abort streaming
            try {
                await this.requestWebcamAccess();
            } catch (error) {
                console.error('[EngagementStreamer] Failed to get webcam access:', error);
                this.updateStatus('Failed to access webcam', 'error');
                return;
            }

            // Wait for video metadata to be loaded and canvas setup
            await this.waitForVideoReady();

            // Setup canvas dimensions based on video
            this.canvasElement.width = this.videoElement.videoWidth;
            this.canvasElement.height = this.videoElement.videoHeight;
            this.canvasContext = this.canvasElement.getContext('2d');

            if (!this.canvasContext) {
                throw new Error('Failed to get canvas context');
            }

            // Emit initial event to Node.js to signal the start of a video session
            this.socket.emit('start_video_session', {
                studentId: this.studentId,
                lectureCode: this.lectureCode,
                frameWidth: this.canvasElement.width,
                frameHeight: this.canvasElement.height
            });

            // Start sending frames at the defined FPS
            this.frameIntervalId = setInterval(() => {
                this.captureAndSendFrame();
            }, 1000 / this.targetFps);

            this.isActive = true;
            this.updateStatus('Engagement monitoring active', 'success');
            this.showMonitoringStatus();

        } catch (error) {
            console.error('[EngagementStreamer] Failed to start streaming:', error);
            this.updateStatus('Failed to start engagement monitoring', 'error');
        }
    };

    /**
     * Wait for video element to be ready
     */
    EngagementStreamer.prototype.waitForVideoReady = function() {
        return new Promise((resolve, reject) => {
            const checkReady = () => {
                if (this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0) {
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    };

    /**
     * Task 1.3: Capture and send frame implementation
     * Checks readiness, draws video frame to canvas, converts to JPEG Blob, and emits via Socket.IO
     */
    EngagementStreamer.prototype.captureAndSendFrame = function() {
        // Check if videoElement.readyState >= HAVE_CURRENT_DATA, canvasContext exists, and socket is connected
        if (!this.videoElement || 
            this.videoElement.readyState < this.videoElement.HAVE_CURRENT_DATA ||
            !this.canvasContext || 
            !this.socket || 
            !this.socket.connected) {
            return;
        }

        try {
            // Draw the current video frame onto the canvas
            this.canvasContext.drawImage(
                this.videoElement, 
                0, 0, 
                this.canvasElement.width, 
                this.canvasElement.height
            );

            // Convert the canvas content to a JPEG Blob
            this.canvasElement.toBlob((jpegBlob) => {
                if (jpegBlob && this.socket && this.socket.connected) {
                    // Emit video_jpeg_frame event with the Blob directly (not base64)
                    this.socket.emit('video_jpeg_frame', {
                        studentId: this.studentId,
                        lectureCode: this.lectureCode,
                        frame_jpeg_blob: jpegBlob
                    });
                }
            }, 'image/jpeg', this.jpegQuality);

        } catch (error) {
            console.error('[EngagementStreamer] Frame capture error:', error);
        }
    };

    /**
     * Task 1.3: Stop streaming implementation
     * Clears interval, stops media stream, emits stop event, disconnects socket, clears video source
     */
    EngagementStreamer.prototype.stopStreaming = function() {
        console.log('[EngagementStreamer] Stopping streaming...');

        // Clear frame interval
        if (this.frameIntervalId) {
            clearInterval(this.frameIntervalId);
            this.frameIntervalId = null;
        }

        // Stop all media stream tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Emit stop_video_session event if socket is connected
        if (this.socket && this.socket.connected) {
            this.socket.emit('stop_video_session', {
                studentId: this.studentId,
                lectureCode: this.lectureCode
            });
        }

        // Disconnect the socket (optional, as mentioned in plan)
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        // Clear the webcamFeed video element's source
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }

        this.isActive = false;
        this.studentId = null;
        this.lectureCode = null;
        
        this.updateStatus('Engagement monitoring inactive', 'info');
        this.hideMonitoringStatus();
    };

    /**
     * Update status display
     * @param {string} message - Status message
     * @param {string} type - Status type: 'info', 'success', 'error'
     */
    EngagementStreamer.prototype.updateStatus = function(message, type) {
        console.log(`[EngagementStreamer] Status: ${message} (${type})`);
        
        if (this.statusElements.statusText) {
            this.statusElements.statusText.textContent = message;
        }

        // Update monitoring status styling based on type
        if (this.statusElements.monitoring) {
            this.statusElements.monitoring.className = 'status-message';
            if (type === 'success') {
                this.statusElements.monitoring.classList.add('success');
            } else if (type === 'error') {
                this.statusElements.monitoring.classList.add('error');
            }
        }
    };

    /**
     * Show monitoring status message
     */
    EngagementStreamer.prototype.showMonitoringStatus = function() {
        if (this.statusElements.monitoring) {
            this.statusElements.monitoring.style.display = 'flex';
        }
    };

    /**
     * Hide monitoring status message
     */
    EngagementStreamer.prototype.hideMonitoringStatus = function() {
        if (this.statusElements.monitoring) {
            this.statusElements.monitoring.style.display = 'none';
        }
    };

    /**
     * Show webcam access error message
     * @param {string} message - Error message
     */
    EngagementStreamer.prototype.showWebcamAccessError = function(message) {
        if (this.statusElements.webcamAccess) {
            const span = this.statusElements.webcamAccess.querySelector('span');
            if (span) {
                span.textContent = message;
            }
            this.statusElements.webcamAccess.style.display = 'flex';
            
            // Auto-hide after 10 seconds
            setTimeout(() => {
                this.hideWebcamAccessError();
            }, 10000);
        }
    };

    /**
     * Hide webcam access error message
     */
    EngagementStreamer.prototype.hideWebcamAccessError = function() {
        if (this.statusElements.webcamAccess) {
            this.statusElements.webcamAccess.style.display = 'none';
        }
    };

    /**
     * Check if webcam access is supported
     * @returns {boolean} True if getUserMedia is supported
     */
    EngagementStreamer.prototype.isWebcamSupported = function() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    };

    /**
     * Get current streaming status
     * @returns {boolean} True if currently streaming
     */
    EngagementStreamer.prototype.isStreaming = function() {
        return this.isActive;
    };

    /**
     * Cleanup resources
     */
    EngagementStreamer.prototype.cleanup = function() {
        console.log('[EngagementStreamer] Cleaning up...');
        this.stopStreaming();
    };

    // Expose EngagementStreamer to global scope
    window.EngagementStreamer = EngagementStreamer;

    // Task 1.5: Auto-initialize when DOM is ready (if not already initialized)
    // This creates a global instance that can be used by the main application
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            if (!window.engagementStreamer) {
                window.engagementStreamer = new EngagementStreamer();
            }
        });
    } else {
        // DOM is already ready
        if (!window.engagementStreamer) {
            window.engagementStreamer = new EngagementStreamer();
        }
    }

})(window); 