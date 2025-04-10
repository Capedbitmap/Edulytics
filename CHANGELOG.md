# Changelog for Lecture Assistant

This file documents all notable changes made to the Lecture Assistant application.

## Version 1.1.0 - 2025-04-12

### Face Detection Module Updates

#### Features
- Added fallback face detection for browsers without FaceDetector API support
- Implemented frame capture at 1 frame per second for future engagement analysis
- Added debug mode toggle (Cmd+Shift+F on macOS, Ctrl+Shift+F on other platforms)
- Added floating indicator in top-right to show face detection status

#### Enhancements
- Improved browser compatibility for Chrome on macOS
- Enhanced face detection accuracy with better detection algorithms
- Added visual indicator when face is detected
- Added storage of captured frames in IndexedDB for later analysis
- Frames now include metadata and timestamp information

#### Fixes
- Fixed status message that was stuck on "initializing"
- Fixed "browser not supported" message on Chrome despite working detection
- Fixed reference error for `engagementDetectionEnabled` variable
- Fixed inaccurate face detection in debug mode
- Fixed dot indicator to correctly show detection status

#### Technical Improvements
- Improved error handling for media devices
- Added better logging for debug purposes
- Enhanced socket connection reliability
- Improved cleanup when user leaves the page
- Added consent modal to comply with privacy requirements

### How to Use New Features

#### Debug Mode
- Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows/Linux) to toggle debug mode
- Click the floating indicator dot in the top-right corner to toggle debug mode
- Debug panel shows detection method, frame count, and live webcam feed with detection indicators

#### Face Detection Status
- Green dot: Face detected
- Red dot: No face detected
- Yellow dot: Initializing
- Status messages appear at the bottom of the screen when detection status changes

#### Privacy
- All processing happens locally in the browser
- No images are sent to the server
- Data is cleared when the page is closed
- User consent is required before enabling the feature

## Version 1.0.0 - 2025-03-15

### Initial Release
- Real-time lecture transcription via OpenAI Realtime API
- AI-powered explanations for lecture content
- Instructor dashboard for managing lectures
- Student lecture view with transcription display
- Lecture code generation for secure access
- Support for different course codes and metadata
- Mobile-responsive design