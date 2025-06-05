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
        // Configuration
        this.config = {
            video: {
                width: { ideal: 320 },
                height: { ideal: 240 },
                frameRate: { ideal: 10 }
            },
            captureInterval: 100, // ms (10 FPS)
            jpegQuality: 0.8
        };

        // State
        this.mediaStream = null;
        this.isActive = false;
        this.captureIntervalId = null;
        this.socket = null;
        this.lectureCode = null;

        // DOM Elements
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasContext = null;
        this.statusElements = {
            monitoring: null,
            statusText: null,
            webcamAccess: null
        };

        // Bind methods
        this.requestWebcamAccess = this.requestWebcamAccess.bind(this);
        this.startStreaming = this.startStreaming.bind(this);
        this.stopStreaming = this.stopStreaming.bind(this);
        this.captureFrame = this.captureFrame.bind(this);
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

        if (!this.videoElement || !this.canvasElement) {
            console.error('[EngagementStreamer] Required DOM elements not found');
            return;
        }

        // Setup canvas
        this.canvasElement.width = this.config.video.width.ideal;
        this.canvasElement.height = this.config.video.height.ideal;
        this.canvasContext = this.canvasElement.getContext('2d');

        // Setup Socket.IO connection if available
        if (window.io && window.lectureCode) {
            this.lectureCode = window.lectureCode;
            this.setupSocketConnection();
        }

        console.log('[EngagementStreamer] Initialization complete');
    };

    /**
     * Setup Socket.IO connection for streaming frames
     */
    EngagementStreamer.prototype.setupSocketConnection = function() {
        if (window.socket) {
            // Use existing socket connection
            this.socket = window.socket;
            console.log('[EngagementStreamer] Using existing socket connection');
        } else {
            // Create new socket connection if needed
            try {
                this.socket = io({
                    auth: { lecture: this.lectureCode },
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                    timeout: 5000
                });

                this.socket.on('connect', () => {
                    console.log('[EngagementStreamer] Socket connected:', this.socket.id);
                });

                this.socket.on('disconnect', () => {
                    console.log('[EngagementStreamer] Socket disconnected');
                    this.updateStatus('Connection lost', 'error');
                });

                this.socket.on('connect_error', (error) => {
                    console.error('[EngagementStreamer] Socket connection error:', error);
                    this.updateStatus('Connection error', 'error');
                });

            } catch (error) {
                console.error('[EngagementStreamer] Failed to create socket connection:', error);
            }
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
     * Start streaming video frames to the backend
     */
    EngagementStreamer.prototype.startStreaming = function() {
        if (this.isActive) {
            console.log('[EngagementStreamer] Streaming already active');
            return;
        }

        if (!this.mediaStream || !this.socket) {
            console.error('[EngagementStreamer] Cannot start streaming: missing stream or socket');
            this.updateStatus('Cannot start streaming: missing requirements', 'error');
            return;
        }

        console.log('[EngagementStreamer] Starting frame streaming...');
        this.isActive = true;

        // Start frame capture interval
        this.captureIntervalId = setInterval(() => {
            this.captureFrame();
        }, this.config.captureInterval);

        this.updateStatus('Engagement monitoring: Active', 'success');
        this.showMonitoringStatus();
    };

    /**
     * Stop streaming video frames
     */
    EngagementStreamer.prototype.stopStreaming = function() {
        if (!this.isActive) {
            console.log('[EngagementStreamer] Streaming already inactive');
            return;
        }

        console.log('[EngagementStreamer] Stopping frame streaming...');
        this.isActive = false;

        // Clear capture interval
        if (this.captureIntervalId) {
            clearInterval(this.captureIntervalId);
            this.captureIntervalId = null;
        }

        // Stop media stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                track.stop();
            });
            this.mediaStream = null;
            this.videoElement.srcObject = null;
        }

        this.updateStatus('Engagement monitoring: Inactive', 'info');
        this.hideMonitoringStatus();
    };

    /**
     * Capture a frame from the video and send to backend
     */
    EngagementStreamer.prototype.captureFrame = function() {
        if (!this.isActive || !this.mediaStream || !this.videoElement.videoWidth) {
            return;
        }

        try {
            // Draw current video frame to canvas
            this.canvasContext.drawImage(
                this.videoElement,
                0, 0,
                this.config.video.width.ideal,
                this.config.video.height.ideal
            );

            // Convert canvas to JPEG blob
            this.canvasElement.toBlob((blob) => {
                if (blob && this.socket && this.socket.connected) {
                    // Convert blob to base64 for transmission
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64Data = reader.result;
                        
                        // Send frame data to backend
                        this.socket.emit('engagement_frame', {
                            lectureCode: this.lectureCode,
                            timestamp: Date.now(),
                            frameData: base64Data,
                            studentId: window.currentUser?.uid || 'anonymous'
                        });
                    };
                    reader.readAsDataURL(blob);
                }
            }, 'image/jpeg', this.config.jpegQuality);

        } catch (error) {
            console.error('[EngagementStreamer] Frame capture error:', error);
        }
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

    // Auto-initialize when DOM is ready (if not already initialized)
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