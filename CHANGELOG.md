# Changelog for Lecture Assistant

This file documents all notable changes made to the Lecture Assistant application.

## Version 1.1.0 - 2025-04-12

### Face Detection Module Updates

#### Features
- Added fallback face detection for browsers without FaceDetector API support (Note: Fallback later removed in favor of face-api.js).
- Implemented frame capture at 1 frame per second for future engagement analysis.
- Added debug mode toggle (Cmd+Shift+F on macOS, Ctrl+Shift+F on other platforms, or click top-right indicator).
- Added floating indicator in top-right and status message in bottom-right to show face detection status.

#### Enhancements
- Improved browser compatibility for Chrome on macOS.
- Added visual indicator when face is detected.
- Added storage of captured frames in memory for the current session.
- Frames now include metadata (timestamp, faceDetected status).

#### Fixes & Refactoring (2025-04-11)
- **Refactored face detection to exclusively use `face-api.js` library.** Removed reliance on native `FaceDetector` API to ensure consistency and fix related bugs.
- Fixed `ReferenceError` issues in `engagement.js` and `faceDetection.js` related to module scope and variable definitions (`FaceDetection`, `toggleDebugMode`, `engagementDetectionEnabled`).
- Corrected initialization timing: `engagement.js` now properly waits for `face-api.js` models to load before initializing the `FaceDetection` module.
- Fixed inconsistent status reporting: Both the bottom status message and top-right indicator now accurately reflect the detection state from `face-api.js`.
- Fixed inaccurate face detection in debug mode; it now correctly visualizes `face-api.js` results.
- Removed the "browser not supported" message related to the native `FaceDetector` API.
- Ensured `FaceDetection` module is correctly assigned to the global `window` object for accessibility.

#### Previous Fixes (Pre-Refactor)
- Fixed status message that was stuck on "initializing".
- Fixed dot indicator to correctly show detection status.

#### Technical Improvements
- Improved error handling for media devices.
- Added better logging for debug purposes.
- Enhanced socket connection reliability.
- Improved cleanup when user leaves the page.
- Added consent modal to comply with privacy requirements.

### How to Use New Features

#### Debug Mode
- Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows/Linux) to toggle debug mode.
- Click the floating indicator dot in the top-right corner to toggle debug mode.
- Debug panel shows detection method (`face-api.js`), frame count, and live webcam feed with detection indicators.

#### Face Detection Status
- Top-Right Dot & Bottom Message:
    - Green dot / "Face detected": Face detected by `face-api.js`.
    - Red dot / "No face detected": No face detected by `face-api.js`.
    - Yellow dot / "Initializing...": `face-api.js` models are loading.

#### Privacy
- All processing happens locally in the browser using `face-api.js`.
- No images are sent to the server.
- Captured frame data is stored temporarily in memory and cleared when the session ends or engagement is disabled.
- User consent is required before enabling the feature.

## Version 1.0.0 - 2025-03-15

### Initial Release
- Real-time lecture transcription via OpenAI Realtime API
- AI-powered explanations for lecture content
- Instructor dashboard for managing lectures
- Student lecture view with transcription display
- Lecture code generation for secure access
- Support for different course codes and metadata
- Mobile-responsive design