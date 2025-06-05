# Python Engagement Detection Integration Plan

## 1. Introduction

This document outlines a detailed, multi-phased plan to integrate the existing Python-based student engagement detection script into the main web application. The goal is to enable real-time engagement monitoring using the student's webcam via the browser, process the video feed using the Python script, store engagement metrics in Firebase, and optionally upload session recordings to YouTube. The integration aims for minimal changes to the existing web app's core logic while ensuring a robust, performant, and scalable solution.

## 2. Overall Proposed Architecture

We propose a microservices-oriented architecture using Docker containers:

*   **Client (Browser):** Captures webcam video and sends frames via Socket.IO. Interacts with the Node.js backend for control signals.
*   **Node.js Backend (`server.js`):**
    *   Receives video frames from clients.
    *   Manages student sessions for engagement detection.
    *   Relays video frames and control data (student ID, lecture code, dev mode) to the Python Engagement Service via Socket.IO.
    *   Handles existing application logic (authentication, lecture management, etc.).
*   **Python Engagement Service:**
    *   A dedicated service (e.g., built with FastAPI/Flask and python-socketio) running the modified Python engagement script.
    *   Receives video frames and parameters from the Node.js backend.
    *   Performs engagement analysis.
    *   Sends engagement metrics directly to Firebase.
    *   Handles video recording, processing (slowing down), and uploading to YouTube (with a dev mode toggle).
*   **Firebase:** Continues to be the database for engagement metrics and other application data.
*   **YouTube:** Destination for video uploads.

```mermaid
graph TD
    subgraph Client Browser
        A[Webcam via JS] -->|Video Frames (Socket.IO)| B((Node.js Backend));
        A -->|Start/Stop Signals| B;
        B -->|Control UI| A;
    end

    subgraph Server Environment
        B -->|Video Frames, Params (Socket.IO)| C((Python Engagement Service));
        C -->|Engagement Metrics| D[(Firebase)];
        C -->|Video Upload| E[(YouTube)];
        B -->|App Data| D;
    end

    A ~~~ F[User];
    F <--> A;
    B <--> G{Existing App Logic};

    style C fill:#ccf,stroke:#333,stroke-width:2px;
    style B fill:#cff,stroke:#333,stroke-width:2px;
```

**Alternative: Single Container Approach**
While a single container (Node.js running Python as a child process) might seem simpler for deployment initially, it introduces complexities:
*   Managing Python's `venv` within the Node.js Docker image.
*   Inter-process communication (stdin/stdout) for video streams is less robust than network sockets for this use case.
*   Scalability and fault isolation are more challenging.
For these reasons, the two-container approach is recommended for better maintainability and robustness.

## 3. Phased Implementation Plan

### Phase 0: Preparation & Python Script Refactoring

*   **Objective:** Transform the standalone Python script into a modular, configurable, and headless service component, ready for integration. This involves parameterizing inputs, encapsulating core logic, adapting video input, overhauling YouTube authentication for server-side operation, and establishing robust dependency and configuration management.

*   **Detailed Key Tasks:**

    1.  **Parameterize Python Script for Headless Operation:**
        *   **Sub-task 1.1: Eliminate Interactive Inputs:**
            *   Remove `student_id = input(...)` and `lecture_code = input(...)`. These will be passed programmatically.
        *   **Sub-task 1.2: Introduce `dev_mode` Parameter:**
            *   Add a boolean parameter `dev_mode` to the main processing logic.
            *   If `dev_mode` is `True`, the YouTube upload functionality (including video slowing) must be skipped. Log a message indicating this.
            *   Example (conceptual):
              ```python
              # Inside the main processing logic, before YouTube upload section
              if not dev_mode:
                  try:
                      print("INFO: Production mode - attempting video processing and YouTube upload.")
                      # ... existing slow_down_video logic ...
                      # ... existing upload_to_youtube logic ...
                      print("INFO: YouTube upload process completed.")
                  except Exception as e:
                      print(f"ERROR: Failed to process/upload video in production mode: {e}")
              else:
                  print("INFO: Dev mode enabled - YouTube upload and video slowing skipped.")
              ```
        *   **Sub-task 1.3: Remove UI-Dependent OpenCV Calls:**
            *   Search for and remove all instances of `cv2.imshow(...)`.
            *   Search for and remove all instances of `cv2.waitKey(...)`.
            *   These functions are for displaying video frames and capturing key presses in a GUI environment, which is incompatible with a headless server. Replace with logging for debugging if necessary.

    2.  **Encapsulate Core Logic into a Reusable Structure (e.g., a Class):**
        *   **Sub-task 2.1: Design `EngagementProcessor` Class:**
            *   This class will manage the state and processing for a single student's engagement session.
            *   **Attributes:**
                *   `student_id`, `lecture_code`, `dev_mode`
                *   `firebase_ref_path_template` (e.g., `lectures/{lecture_code}/attendens/{student_id}/engagement/{timestamp}`)
                *   Detection models: `face_mesh_model`, `pose_model`, `emotion_detector_model`
                *   State variables: `yawn_counter`, `drowsy_counter`, `frame_counter`, `last_sent_status` (to avoid redundant Firebase writes), `dominant_emotion_cache`
                *   Video recording: `video_writer` instance, `temp_video_filename`, `output_video_fps`, `output_video_resolution`
            *   **Methods:**
                *   `__init__(self, student_id, lecture_code, dev_mode, firebase_creds_path, youtube_service_account_path, output_video_resolution=(640,480), output_video_fps=10)`:
                    *   Store parameters.
                    *   Initialize Firebase Admin SDK (if not already globally initialized, consider how to handle this for multiple instances – ideally initialize once globally).
                    *   Load and initialize `mp_face_mesh.FaceMesh`, `FER`, `mp_pose.Pose`.
                    *   Initialize `last_sent_status = {}`.
                *   `start_session(self, first_frame_for_resolution)`:
                    *   Determine `frame_width`, `frame_height` from `first_frame_for_resolution`.
                    *   Generate `temp_video_filename` (e.g., `f"{self.student_id}_{self.lecture_code}_{get_timestamp()}_temp.mp4"`).
                    *   Initialize `self.video_writer = cv2.VideoWriter(self.temp_video_filename, cv2.VideoWriter_fourcc(*'mp4v'), self.output_video_fps, (frame_width, frame_height))`.
                    *   Call `mark_attendance(self.student_id, self.lecture_code, "check_in_time")`.
                *   `process_frame(self, frame_bgr)`:
                    *   Takes a BGR NumPy array (`frame_bgr`).
                    *   Increment `self.frame_counter`.
                    *   Perform all detection logic (EAR, MAR, emotion, pose, gaze, hand raising) using the class's models and state.
                    *   Update `current_status` dictionary.
                    *   If `current_status != self.last_sent_status`:
                        *   Call `send_to_firebase(...)` with `current_status`.
                        *   `self.last_sent_status = current_status.copy()`.
                    *   If `self.video_writer` is initialized: `self.video_writer.write(frame_bgr)`.
                *   `end_session(self)`:
                    *   Call `mark_attendance(self.student_id, self.lecture_code, "check_out_time")`.
                    *   If `self.video_writer`: `self.video_writer.release()`.
                    *   If not `self.dev_mode` and `self.temp_video_filename` exists:
                        *   `slow_path = f"slow_{self.temp_video_filename}"`
                        *   Call `slow_down_video(self.temp_video_filename, slow_path, scale=4.0)`.
                        *   Call `upload_to_youtube(slow_path, self.student_id, self.lecture_code, self.youtube_service_account_path)`.
                        *   Update Firebase with YouTube link: `db.reference(f'lectures/{self.lecture_code}/attendens/{self.student_id}/lecture_video').set(youtube_link)`.
                        *   Clean up: `os.remove(slow_path)`.
                    *   If `self.temp_video_filename` exists: `os.remove(self.temp_video_filename)`.
                    *   Release models if necessary: `self.face_mesh_model.close()`, `self.pose_model.close()`.
                *   All existing helper functions (`get_timestamp`, `send_to_firebase`, `mark_attendance`, `eye_aspect_ratio`, etc.) should be methods of this class or static/utility functions called by its methods.
        *   **Sub-task 2.2: Global Initializations:**
            *   Firebase Admin SDK (`firebase_admin.initialize_app`) should ideally be called once when the Python service starts, not per `EngagementProcessor` instance. The `EngagementProcessor` can then use the default app.
            *   Consider if detection models can be loaded once globally and passed to instances if they are thread-safe and stateless for prediction. For simplicity, per-instance initialization is acceptable to start.

    3.  **Adapt Input Video Stream Handling:**
        *   **Sub-task 3.1: Remove Direct Webcam Capture:**
            *   Delete `cap = cv2.VideoCapture(0)` and the `while cap.isOpened(): ret, frame = cap.read()` loop.
            *   The `process_frame(self, frame_bgr)` method will now be the entry point for new video data.
        *   **Sub-task 3.2: `video_writer` Management:**
            *   As detailed in `EngagementProcessor.start_session()` and `EngagementProcessor.end_session()`. Frame dimensions for `VideoWriter` must be known when it's initialized, likely from the first frame received.

    4.  **Overhaul YouTube Authentication for Server-Side Use (CRITICAL):**
        *   **Sub-task 4.1: Create Google Cloud Service Account & Permissions:**
            *   Navigate to Google Cloud Console -> IAM & Admin -> Service Accounts.
            *   Click "Create Service Account".
            *   Name: e.g., `youtube-upload-service`.
            *   Grant necessary roles: "YouTube Data API v3" access. This is tricky. A service account acts on its own behalf. To upload to a *specific* YouTube channel:
                1.  The YouTube channel must be associated with the Google Cloud Project where the service account is created.
                2.  Alternatively (and more commonly for channels not directly owned by the GCP project), add the service account's email address as a "Manager" or "Editor" for the target YouTube channel in YouTube Studio settings (Permissions).
            *   Create and download a JSON key file (e.g., `youtube-service-account-credentials.json`). **Secure this file!**
        *   **Sub-task 4.2: Modify `upload_to_youtube` Function:**
            *   Remove `InstalledAppFlow`.
            *   Use `google.oauth2.service_account.Credentials`.
            *   The function signature should now accept the path to the service account JSON file.
            *   Updated `upload_to_youtube` (conceptual):
              ```python
              from google.oauth2 import service_account
              from googleapiclient.discovery import build
              from googleapiclient.http import MediaFileUpload
              import os # for get_simple_time if not already imported

              YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

              def upload_to_youtube(file_path, student_id, lecture_code, service_account_json_path):
                  # ... (title, description setup as before) ...
                  creds = service_account.Credentials.from_service_account_file(
                      service_account_json_path, scopes=YOUTUBE_SCOPES)
                  
                  youtube = build("youtube", "v3", credentials=creds)
                  
                  request_body = { # ... as before ... }
                  media = MediaFileUpload(file_path, resumable=True, mimetype="video/*")
                  # ... rest of upload logic ...
                  return f"https://www.youtube.com/watch?v={response['id']}"
              ```
        *   **Sub-task 4.3: Secure Credential File Management:**
            *   The `youtube-service-account-credentials.json` file must NOT be committed to version control.
            *   Its path will be provided to the Python service via an environment variable during deployment (see Phase 4).

    5.  **Establish Robust Dependency Management:**
        *   **Sub-task 5.1: Create/Update `requirements.txt`:**
            *   From within an activated virtual environment (`venv`):
                *   `pip install opencv-python mediapipe numpy scipy fer firebase-admin google-api-python-client google-auth`
                *   (Later, in Phase 2, add `python-socketio` and your chosen web framework like `fastapi` and `uvicorn`).
            *   Run `pip freeze > requirements.txt`.
            *   Review `requirements.txt` to ensure correct packages and consider pinning versions (e.g., `opencv-python==4.7.0.72`) for stable builds.

    6.  **Implement Virtual Environment (`venv`) Consistently:**
        *   **Sub-task 6.1: Setup `venv` (if not already done):**
            *   In the Python script's root directory: `python3 -m venv .venv` (or `python -m venv .venv`).
            *   Activate: `source .venv/bin/activate` (Linux/macOS) or `.venv\Scripts\activate` (Windows).
        *   **Sub-task 6.2: Add `.venv` to `.gitignore`:**
            *   Ensure the `.venv/` directory is not tracked by Git.
        *   **Sub-task 6.3: Always Develop with `venv` Activated:**
            *   All subsequent `pip install` commands and script executions during development should be done with the `venv` active.

    7.  **Centralize Configuration for Credentials and Paths:**
        *   **Sub-task 7.1: Load Firebase Credentials Path via Environment Variable:**
            *   Modify Firebase initialization:
              ```python
              import firebase_admin
              from firebase_admin import credentials, db
              import os

              FIREBASE_CREDENTIALS_PATH = os.getenv("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json") # Default for local dev
              DATABASE_URL = os.getenv("FIREBASE_DATABASE_URL", "YOUR_DEFAULT_DB_URL_HERE") # Add your actual default URL

              try:
                  cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
                  firebase_admin.initialize_app(cred, {'databaseURL': DATABASE_URL})
                  print("INFO: Firebase Admin SDK initialized successfully.")
              except Exception as e:
                  print(f"ERROR: Failed to initialize Firebase Admin SDK: {e}")
                  # Decide on error handling: exit, or let parts of the app run without Firebase?
              ```
        *   **Sub-task 7.2: Load YouTube Service Account Key Path via Environment Variable:**
            *   This path will be passed to the `EngagementProcessor` or directly to the `upload_to_youtube` function, originating from an environment variable read when the service starts.
            *   Example: `YOUTUBE_SA_PATH = os.getenv("YOUTUBE_SERVICE_ACCOUNT_PATH", "youtube-service-account-credentials.json")`

*   **Expected Outcome (Revised & More Detailed):**
    *   A Python script structured with an `EngagementProcessor` class that encapsulates all logic for a single student's session.
    *   The class is initializable with `student_id`, `lecture_code`, `dev_mode`, and paths to credential files.
    *   The class has methods like `start_session(first_frame)`, `process_frame(frame_bgr)`, and `end_session()`.
    *   All direct webcam interaction and UI display (`cv2.imshow`, `cv2.waitKey`, `input()`) are removed.
    *   YouTube upload uses Google Service Account credentials, with the path to the JSON key file configurable.
    *   A comprehensive `requirements.txt` is generated from an active `venv`.
    *   All credential paths are loaded from environment variables with sensible defaults for local development.

*   **Testing Strategy (Developer - Revised & More Detailed):**
    *   **Unit Tests for `EngagementProcessor` methods:**
        *   Mock Firebase interactions (e.g., using `unittest.mock.patch`).
        *   Test `process_frame` with sample image frames (NumPy arrays loaded from files or generated). Verify internal state changes (counters, `last_status`).
        *   Test `dev_mode` logic for `end_session` (i.e., YouTube upload is skipped/attempted correctly).
        *   Test video file creation and cleanup in `start_session` and `end_session`.
    *   **Local Script Execution (Simulating Service Calls):**
        *   Write a small wrapper script (e.g., `test_processor.py`) that:
            *   Instantiates `EngagementProcessor` with test data and paths to local credential files.
            *   Loads a sample video file using `cv2.VideoCapture("test_video.mp4")`.
            *   Calls `processor.start_session(first_frame_from_test_video)`.
            *   Loops through frames from `test_video.mp4`, calling `processor.process_frame(frame)`.
            *   Calls `processor.end_session()`.
        *   Verify:
            *   Correct data appears in Firebase.
            *   If `dev_mode` is `False`, a video appears on YouTube (check the channel associated with the service account).
            *   Temporary video files are created and deleted.
            *   No errors related to headless operation.
    *   **Environment Variable Testing:**
        *   Run the test wrapper script with environment variables set for credential paths to ensure they are picked up correctly.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **YouTube Service Account Permissions:** The most complex part. The service account might not have permission to upload to the *intended* YouTube channel, or it might upload to a channel associated with the service account itself.
        *   **Mitigation:** Test this early. Ensure the service account email is correctly added as a Manager/Editor to the target YouTube channel in YouTube Studio. Verify uploads go to the correct destination. Understand that service accounts authenticate as themselves, not as an end-user.
    *   **Firebase Initialization in a Multi-Instance Scenario:** If the Python service (Phase 2) runs multiple `EngagementProcessor` instances (e.g., in threads/async tasks), `firebase_admin.initialize_app()` should only be called once globally.
        *   **Mitigation:** Structure the Python service entry point to initialize Firebase once. `EngagementProcessor` instances can then use `db.reference()`.
    *   **State Management within `EngagementProcessor`:** Ensure all session-specific data (counters, video writer, etc.) is properly encapsulated within the class instance and reset/cleaned up correctly in `end_session()`.
        *   **Mitigation:** Thorough unit testing of session lifecycle.
    *   **Error Handling for External Services:** Network errors or API errors from Firebase/YouTube.
        *   **Mitigation:** Implement `try-except` blocks around all external calls. Log errors comprehensively. Decide on retry strategies or graceful failure. For example, if YouTube upload fails, the engagement metrics should still be in Firebase.
    *   **Resource Leaks:** Video writers or models not being released.
        *   **Mitigation:** Ensure `video_writer.release()`, `face_mesh.close()`, `pose.close()` are called in `end_session()`, possibly in a `finally` block if `end_session` itself can raise exceptions.

### Phase 1: Client-Side Video Capture & Streaming to Node.js

*   **Objective:** Implement robust client-side webcam video capture and efficient streaming of video frames to the Node.js backend using Socket.IO. This phase focuses on the browser-to-server data pipeline for video.

*   **Detailed Key Tasks:**

    1.  **Client-Side JavaScript Implementation (e.g., in a new `client/public/scripts/engagementStreaming.js` or integrated into existing `lecture.js`):**
        *   **Sub-task 1.1: UI Elements for Control & Feedback (HTML in `lecture.html`):**
            *   Add a placeholder ` <video id="webcamFeed" autoplay muted style="display:none;"></video> ` (muted and hidden, primarily for `MediaStream` source, not necessarily for user display unless for debugging).
            *   Add UI elements for status indication (e.g., "Engagement monitoring active/inactive", "Webcam access denied"). These could be simple text divs updated by JavaScript.
        *   **Sub-task 1.2: Webcam Access Logic:**
            *   Define a JavaScript module or class, e.g., `EngagementStreamer`.
            *   `EngagementStreamer.prototype.requestWebcamAccess = async function() { ... }`:
                *   Use `navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 10 } } })`. Request specific resolution (e.g., 640x480) and frame rate (e.g., 10 FPS) to manage bandwidth and processing load. Make these configurable if possible.
                *   Handle success: Store the `MediaStream` object (e.g., `this.mediaStream`). Optionally, attach it to the hidden `webcamFeed` video element: `document.getElementById('webcamFeed').srcObject = this.mediaStream;`.
                *   Handle errors (`NotFoundError`, `NotAllowedError`, `AbortError`, `SecurityError`, `TypeError` etc.):
                    *   Log detailed errors to the console.
                    *   Update UI to inform the user (e.g., "Webcam access denied. Please check browser permissions.").
                    *   Return a promise that resolves with the stream or rejects with an error.
        *   **Sub-task 1.3: Frame Extraction and Formatting Strategy:**
            *   **Chosen Method: `MediaRecorder` API (for simplicity and efficiency with binary data).**
                *   Rationale: `MediaRecorder` handles encoding and packaging video data into chunks (Blobs) suitable for network transmission. This is generally more efficient than repeatedly converting canvas frames to data URLs.
            *   Inside `EngagementStreamer`:
                *   `this.mediaRecorder = null;`
                *   `this.recordedChunks = [];`
                *   `EngagementStreamer.prototype.initializeMediaRecorder = function() { ... }`:
                    *   Check if `this.mediaStream` exists.
                    *   `const options = { mimeType: 'video/webm; codecs=vp8' };` // VP8 is widely supported. Alternatives: 'video/webm; codecs=vp9' or 'video/mp4' if browser support is better and Python side can handle.
                    *   Try creating `MediaRecorder`: `this.mediaRecorder = new MediaRecorder(this.mediaStream, options);`
                    *   Handle `ondataavailable` event:
                        ```javascript
                        this.mediaRecorder.ondataavailable = (event) => {
                            if (event.data && event.data.size > 0) {
                                // event.data is a Blob
                                // Send this Blob directly via Socket.IO
                                if (this.socket && this.socket.connected) {
                                    this.socket.emit('video_frame_chunk', {
                                        studentId: this.studentId, // Ensure these are set
                                        lectureCode: this.lectureCode,
                                        chunk: event.data
                                    });
                                }
                                this.recordedChunks.push(event.data); // Optional: for local recording/debugging
                            }
                        };
                        ```
                    *   Handle `onstop` event:
                        ```javascript
                        this.mediaRecorder.onstop = () => {
                            console.log("MediaRecorder stopped.");
                            // Optional: combine this.recordedChunks for a full local recording if needed for debugging
                            // this.recordedChunks = [];
                        };
                        ```
                    *   Handle errors during `MediaRecorder` setup or operation.
        *   **Sub-task 1.4: Socket.IO Integration for Video Streaming:**
            *   Initialize Socket.IO client within `EngagementStreamer` or globally if shared:
                *   `this.socket = io('/engagement-stream', { autoConnect: false });` (use a dedicated namespace, connect on demand).
                *   Add listeners for `connect`, `disconnect`, `connect_error` on `this.socket` for debugging.
            *   `EngagementStreamer.prototype.startStreaming = async function(studentId, lectureCode) { ... }`:
                *   `this.studentId = studentId; this.lectureCode = lectureCode;`
                *   Connect the socket: `if (!this.socket.connected) { this.socket.connect(); }`
                *   Wait for socket connection.
                *   Call `await this.requestWebcamAccess();`. If error, stop.
                *   Call `this.initializeMediaRecorder();`. If error, stop.
                *   Emit an initial event to Node.js: `this.socket.emit('start_video_session', { studentId: this.studentId, lectureCode: this.lectureCode });`
                *   Start `MediaRecorder`: `this.mediaRecorder.start(250);` // Collect 250ms of data per chunk (4 FPS). Adjust `timeslice` based on desired latency vs. overhead.
                *   Update UI: "Engagement monitoring active."
            *   `EngagementStreamer.prototype.stopStreaming = function() { ... }`:
                *   If `this.mediaRecorder` and `this.mediaRecorder.state === 'recording'`: `this.mediaRecorder.stop();`
                *   If `this.mediaStream`: `this.mediaStream.getTracks().forEach(track => track.stop()); this.mediaStream = null;`
                *   If `this.socket` and `this.socket.connected`: `this.socket.emit('stop_video_session', { studentId: this.studentId, lectureCode: this.lectureCode });`
                *   Optionally disconnect socket if no longer needed: `this.socket.disconnect();`
                *   Clear webcam feed: `document.getElementById('webcamFeed').srcObject = null;`
                *   Update UI: "Engagement monitoring inactive."
        *   **Sub-task 1.5: Control Logic Integration with Main Application:**
            *   An instance of `EngagementStreamer` should be created.
            *   Existing application logic (e.g., in [`client/public/scripts/lecture.js`](client/public/scripts/lecture.js)) will call `engagementStreamer.startStreaming(currentStudentId, currentLectureCode)` or `engagementStreamer.stopStreaming()` based on:
                *   Student successfully joining a lecture.
                *   Receiving a Socket.IO message from the server (e.g., `engagement_status_update` from instructor dashboard) indicating engagement detection should start/stop.
            *   Ensure `currentStudentId` and `currentLectureCode` are reliably available in the client-side JavaScript context.

    2.  **Node.js Backend Modifications ([`server/server.js`](server/server.js)):**
        *   **Sub-task 2.1: Create New Socket.IO Namespace for Video Streaming:**
            *   `const engagementStreamNsp = io.of('/engagement-stream');`
            *   `engagementStreamNsp.on('connection', (socket) => { ... });`
        *   **Sub-task 2.2: Handle Client Connection and Stream Lifecycle Events:**
            *   Inside `engagementStreamNsp.on('connection', ...)`:
                *   `console.log(\`Client \${socket.id} connected to /engagement-stream namespace.\`);`
                *   `let clientSessionInfo = { socketId: socket.id };` // Store studentId, lectureCode when 'start_video_session' received
                *   `socket.on('start_video_session', (data) => { ... });`
                    *   Validate `data.studentId` and `data.lectureCode`.
                    *   `clientSessionInfo.studentId = data.studentId;`
                    *   `clientSessionInfo.lectureCode = data.lectureCode;`
                    *   `console.log(\`[Node.js] Received 'start_video_session' from \${socket.id}: studentId=\${data.studentId}, lectureCode=\${data.lectureCode}\`);`
                    *   **Action for Phase 2:** This is the trigger to inform the Python Engagement Service to prepare for a new session for this student/lecture.
                *   `socket.on('video_frame_chunk', (payload) => { ... });`
                    *   The `payload` will be `{ studentId, lectureCode, chunk: Blob }`. The `chunk` itself will be an `ArrayBuffer` on the server-side after Socket.IO processes the Blob.
                    *   `const { studentId, lectureCode, chunk } = payload;`
                    *   `if (!(chunk instanceof ArrayBuffer)) { console.error('[Node.js] Received video_frame_chunk but chunk is not an ArrayBuffer:', typeof chunk); return; }`
                    *   `console.log(\`[Node.js] Received 'video_frame_chunk' from \${socket.id} for student \${studentId}, lecture \${lectureCode}. Chunk size: \${chunk.byteLength} bytes.\`);`
                    *   **Action for Phase 2:** Relay this `chunk` (ArrayBuffer) along with `studentId` and `lectureCode` to the Python Engagement Service.
                *   `socket.on('stop_video_session', (data) => { ... });`
                    *   `console.log(\`[Node.js] Received 'stop_video_session' from \${socket.id} for student \${data.studentId}, lecture \${data.lectureCode}\`);`
                    *   **Action for Phase 2:** Inform the Python Engagement Service to finalize and clean up the session for this student/lecture.
                *   `socket.on('disconnect', (reason) => { ... });`
                    *   `console.log(\`Client \${socket.id} disconnected from /engagement-stream. Reason: \${reason}\`);`
                    *   If `clientSessionInfo.studentId` exists (meaning a session was active):
                        *   `console.log(\`[Node.js] Handling disconnect for active session: studentId=\${clientSessionInfo.studentId}, lectureCode=\${clientSessionInfo.lectureCode}\`);`
                        *   **Action for Phase 2:** Treat this as an implicit `stop_video_session`. Inform Python service.
                    *   Clean up any server-side state associated with `socket.id`.
        *   **Sub-task 2.3: Data Buffering/Queueing (Consideration for Robustness):**
            *   If the Python service is temporarily slow or unavailable, Node.js might need a small in-memory buffer or queue per student session for incoming video chunks. This adds complexity.
            *   **Initial Approach:** Direct relay. If issues arise, implement a simple buffer with a size limit to avoid memory exhaustion.

*   **Expected Outcome (Revised & More Detailed):**
    *   A dedicated client-side JavaScript module (`EngagementStreamer` or similar) manages webcam access, `MediaRecorder` setup, and Socket.IO communication for video streaming.
    *   The client successfully requests webcam access, respecting user permissions, and provides UI feedback.
    *   Video frames are captured by `MediaRecorder`, packaged as Blobs, and sent as chunks via a dedicated Socket.IO namespace (`/engagement-stream`) to the Node.js backend. Each chunk is associated with `studentId` and `lectureCode`.
    *   The Node.js backend correctly handles connections on the `/engagement-stream` namespace.
    *   Node.js logs the receipt of `start_video_session`, `video_frame_chunk` (verifying ArrayBuffer type and size), and `stop_video_session` events, correctly associating them with specific client sockets and extracting `studentId`/`lectureCode`.
    *   Graceful handling of client disconnects is in place on the server-side.
    *   The system is robustly prepared for relaying this structured data to the Python service in Phase 2.

*   **Testing Strategy (Developer - Revised & More Detailed):**
    *   **Client-Side (`EngagementStreamer` module):**
        *   Unit test individual methods of `EngagementStreamer` where possible (e.g., mocking `navigator.mediaDevices`, `MediaRecorder`, `Socket.IO client`).
        *   Manual testing in browser:
            *   Trigger `engagementStreamer.startStreaming()` with test `studentId` and `lectureCode`.
            *   Verify webcam permission prompt. Test "Allow" and "Block" scenarios.
            *   Check browser console for logs from `EngagementStreamer` (e.g., "MediaRecorder started", "Sending chunk").
            *   Use browser developer tools (Network tab, filter by WS) to inspect Socket.IO messages. Verify `start_video_session` is sent, followed by binary messages for `video_frame_chunk`. Check payload structure.
            *   Trigger `engagementStreamer.stopStreaming()`. Verify `stop_video_session` is sent and webcam light turns off.
    *   **Node.js Backend (Socket.IO Namespace `/engagement-stream`):**
        *   With the client-side streaming active, monitor Node.js server logs extensively.
        *   Verify connection logs, `start_video_session` data, `video_frame_chunk` (log type and `byteLength`), and `stop_video_session` data.
        *   Test multiple client connections simultaneously (open multiple browser tabs) to ensure `socket.id` and `clientSessionInfo` correctly isolate sessions.
        *   Test client disconnects (close browser tab abruptly) and verify server-side disconnect handling.
    *   **Cross-Browser Testing:** Crucial for `getUserMedia` and `MediaRecorder`. Test on latest Chrome, Firefox, Safari, and Edge. Note any differences in `mimeType` support or event behavior.
    *   **Bandwidth/Latency Simulation:** Use browser dev tools (Network throttling) to simulate poor network conditions. Observe if chunks are still sent/received, and how delays impact the flow. This helps anticipate real-world issues.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **HTTPS Requirement for `getUserMedia`:** Most browsers require HTTPS for webcam access, except for `localhost`. **Mitigation:** Develop locally on `http://localhost`. For staging/production, ensure HTTPS is configured for the web application. Provide clear error messages if context is insecure.
    *   **`MediaRecorder` `mimeType` and `timeslice`:**
        *   `mimeType` support varies. `video/webm; codecs=vp8` is a good default. Have a fallback or log an error if a specific `mimeType` isn't supported.
        *   The `timeslice` in `mediaRecorder.start(timeslice)` affects chunk frequency and size. Too small: high overhead. Too large: high latency. **Mitigation:** Experiment to find a balance (e.g., 100-500ms).
    *   **Socket.IO Binary Data Transmission:** Socket.IO handles binary (ArrayBuffer, Blob) well, but ensure the receiving end (Node.js) correctly interprets it. Blobs sent from client often arrive as ArrayBuffers on the server.
        *   **Mitigation:** Explicitly check `chunk instanceof ArrayBuffer` on the server.
    *   **Client-Side Resource Management:** Ensure `mediaStream.getTracks().forEach(track => track.stop());` is called reliably in `stopStreaming()` and on page unload/beforeunload events to release the webcam.
        *   **Mitigation:** Add event listeners for `beforeunload` to attempt cleanup.
    *   **Server-Side State per Socket:** Storing `clientSessionInfo` (studentId, lectureCode) tied to a socket connection is vital. Ensure this state is cleaned up on disconnect to prevent memory leaks.
        *   **Mitigation:** Use a Map or object to store session info keyed by `socket.id`, and delete entries on disconnect.
    *   **Error Handling Chain:** Errors on the client (webcam access, MediaRecorder) should be handled gracefully and not crash the client script. Errors in Socket.IO communication should be logged.
        *   **Mitigation:** Comprehensive `try...catch` blocks and Socket.IO error event listeners (`connect_error`, etc.).

### Phase 2: Setting up the Python Engagement Service

*   **Objective:** Develop a standalone Python service that listens for commands and video data from the Node.js backend via Socket.IO, processes this data using the refactored `EngagementProcessor` (from Phase 0), and manages concurrent student engagement sessions.

*   **Detailed Key Tasks:**

    1.  **Python Web Framework and Socket.IO Server Setup:**
        *   **Sub-task 1.1: Choose Web Framework & ASGI/WSGI Server:**
            *   **Recommendation:** FastAPI (with Uvicorn as the ASGI server).
            *   Rationale: FastAPI is modern, high-performance, built on Starlette and Pydantic (for data validation), and integrates well with `asyncio` which is beneficial for I/O-bound tasks like network communication and concurrent session management. `python-socketio` supports ASGI.
            *   Alternative: Flask with `python-socketio` and a WSGI server like Gunicorn (with `eventlet` or `gevent` for async). FastAPI is generally preferred for new async projects.
        *   **Sub-task 1.2: Install Dependencies:**
            *   Activate `venv`: `source .venv/bin/activate` (assuming `.venv` is in the Python service's root directory).
            *   `pip install fastapi uvicorn[standard] python-socketio opencv-python numpy`
            *   Ensure other dependencies from Phase 0 (`mediapipe`, `scipy`, `fer`, `firebase-admin`, `google-api-python-client`, `google-auth`) are listed in `requirements.txt` (which should be in the Python service's root) and installed.
            *   Update `requirements.txt`: `pip freeze > requirements.txt`.
        *   **Sub-task 1.3: Basic FastAPI & Socket.IO Application Structure (e.g., in `python_engagement_service/main.py`):**
            *   Create a directory for the Python service, e.g., `python_engagement_service/`.
            *   Inside it, create `main.py` and `engagement_processor.py` (containing the `EngagementProcessor` class from Phase 0).
            ```python
            # python_engagement_service/main.py
            import socketio
            import uvicorn
            from fastapi import FastAPI
            import os
            import firebase_admin # Import at the top
            from firebase_admin import credentials as firebase_credentials # Alias to avoid conflict
            import asyncio
            import numpy as np
            import cv2

            # Assuming EngagementProcessor is in engagement_processor.py
            from .engagement_processor import EngagementProcessor

            # --- Global Initializations (from Phase 0, adapted for service context) ---
            FIREBASE_CREDENTIALS_PATH = os.getenv("FIREBASE_CREDENTIALS_PATH", "config/firebase-credentials.json") # Adjust path as needed
            DATABASE_URL = os.getenv("FIREBASE_DATABASE_URL") # Should be set in environment
            YOUTUBE_SA_PATH = os.getenv("YOUTUBE_SERVICE_ACCOUNT_PATH", "config/youtube-service-account-credentials.json") # Adjust path

            if not DATABASE_URL:
                print("ERROR: Python Service - FIREBASE_DATABASE_URL environment variable not set.")
                # Potentially exit or raise an error if Firebase is critical
            
            try:
                if not firebase_admin._apps: # Initialize only if no Firebase app (named '[DEFAULT]') exists
                    cred = firebase_credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
                    firebase_admin.initialize_app(cred, {'databaseURL': DATABASE_URL})
                    print("INFO: Python Service - Firebase Admin SDK initialized successfully.")
                else:
                    print("INFO: Python Service - Firebase Admin SDK already initialized.")
            except Exception as e:
                print(f"ERROR: Python Service - Failed to initialize Firebase Admin SDK: {e}")
                # Decide on error handling: service might not function correctly without Firebase.

            # --- Socket.IO Setup ---
            sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*') # Adjust CORS for production
            asgi_app = socketio.ASGIApp(sio) # Mounts Socket.IO at the root of this ASGI app

            # --- FastAPI Setup ---
            app = FastAPI(title="Python Engagement Service")
            app.mount("/ws", asgi_app) # Mount Socket.IO app at a subpath like /ws if FastAPI serves other routes
                                      # If only Socket.IO, can directly use asgi_app with Uvicorn.
                                      # For clarity with potential future HTTP routes, mounting is good.

            # --- Session Management ---
            active_sessions = {} # Key: session_key (e.g., f"{student_id}_{lecture_code}"), Value: EngagementProcessor instance

            print(f"INFO: Python Service starting. Listening for Node.js connections.")
            ```
            *   The `engagement_processor.py` would contain the class developed in Phase 0.
            *   Credential files (`firebase-credentials.json`, `youtube-service-account-credentials.json`) should be placed in a `config/` subdirectory within `python_engagement_service/` for local development, or their paths managed by environment variables for deployment.

    2.  **Define Socket.IO Event Handlers for Node.js Communication (in `python_engagement_service/main.py`):**
        *   **Sub-task 2.1: Handle `connect` and `disconnect` from Node.js service:**
            ```python
            @sio.event
            async def connect(sid, environ):
                # sid is the session ID of the connecting client (Node.js service's socket client instance)
                print(f"INFO: Python Service - Node.js service instance connected: sid={sid}")
                # Node.js service might send an identifier or auth token if multiple Node.js instances could connect.
                # For now, assume one trusted Node.js backend.

            @sio.event
            async def disconnect(sid):
                print(f"INFO: Python Service - Node.js service instance disconnected: sid={sid}")
                # This disconnect is for the Node.js-to-Python link.
                # It does NOT automatically clean up individual student sessions unless Node.js explicitly calls end_engagement_processing.
                # However, if the Node.js service dies, we might lose active student sessions if not handled.
            ```
        *   **Sub-task 2.2: Handle `start_engagement_processing` Event:**
            ```python
            @sio.on('start_engagement_processing')
            async def handle_start_engagement(sid, data):
                # data expected: { studentId: "...", lectureCode: "...", devMode: true/false }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')
                dev_mode = data.get('devMode', True) # Default to dev_mode True

                if not student_id or not lecture_code:
                    print(f"ERROR: Python Service - Missing studentId or lectureCode in start_engagement_processing from SID {sid}. Data: {data}")
                    await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': 'Missing parameters for start'}, room=sid)
                    return

                session_key = f"{student_id}_{lecture_code}"
                print(f"INFO: Python Service - Received 'start_engagement_processing' for session: {session_key}, dev_mode={dev_mode} from SID {sid}.")

                if session_key in active_sessions:
                    print(f"WARN: Python Service - Session {session_key} is already active. Ending existing one before restart.")
                    existing_processor = active_sessions.pop(session_key)
                    try:
                        # Ensure cleanup of the old session if it exists
                        await sio.loop.run_in_executor(None, existing_processor.end_session)
                    except Exception as e_old_end:
                        print(f"ERROR: Python Service - Error ending previous session {session_key} before restart: {e_old_end}")
                
                try:
                    processor = EngagementProcessor(
                        student_id=student_id,
                        lecture_code=lecture_code,
                        dev_mode=dev_mode,
                        firebase_creds_path=FIREBASE_CREDENTIALS_PATH,
                        youtube_service_account_path=YOUTUBE_SA_PATH
                        # output_video_resolution and fps can be added if configurable from Node.js
                    )
                    active_sessions[session_key] = processor
                    print(f"INFO: Python Service - EngagementProcessor instance created and stored for {session_key}.")
                    # The processor's start_session (which inits VideoWriter) will be called on the first frame.
                    await sio.emit('processing_started', {'studentId': student_id, 'lectureCode': lecture_code, 'message': f'Session for {session_key} initialized and ready for frames.'}, room=sid)
                except Exception as e:
                    print(f"ERROR: Python Service - Failed to create EngagementProcessor for {session_key}: {e}")
                    await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': f'Initialization failed: {str(e)}'}, room=sid)
            ```
        *   **Sub-task 2.3: Handle `video_frame_from_node` Event:**
            ```python
            @sio.on('video_frame_from_node')
            async def handle_video_frame(sid, data):
                # data expected: { studentId: "...", lectureCode: "...", frame_chunk: bytes (raw JPEG bytes) }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')
                frame_jpeg_bytes = data.get('frame_chunk')

                if not student_id or not lecture_code or not frame_jpeg_bytes:
                    print(f"ERROR: Python Service - Missing data in video_frame_from_node from SID {sid}. Keys: {data.keys() if isinstance(data, dict) else 'Not a dict'}")
                    return

                session_key = f"{student_id}_{lecture_code}"
                processor = active_sessions.get(session_key)

                if not processor:
                    print(f"WARN: Python Service - No active session for {session_key} to process frame. Frame ignored. SID: {sid}")
                    return
                
                # print(f"DEBUG: Python Service - Received frame for {session_key}, JPEG size: {len(frame_jpeg_bytes)} bytes from SID {sid}.")
                try:
                    # Decode JPEG bytes to OpenCV BGR frame
                    nparr = np.frombuffer(frame_jpeg_bytes, np.uint8)
                    bgr_frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if bgr_frame is None:
                        print(f"ERROR: Python Service - Failed to decode JPEG frame for {session_key}. Frame ignored. SID: {sid}")
                        return

                    # If it's the first frame for this processor instance, call start_session to init VideoWriter
                    if not processor.video_writer: # Check if video_writer is initialized
                        print(f"INFO: Python Service - First frame for {session_key}, calling start_session.")
                        # processor.start_session needs to be synchronous or handled carefully if async
                        # For simplicity, if start_session is sync:
                        sio.loop.run_in_executor(None, processor.start_session, bgr_frame)
                        # Allow some time for VideoWriter to initialize if it's slow, or make start_session async
                        # await asyncio.sleep(0.01) # Small delay, not ideal but can help for sync init

                    # Offload CPU-bound frame processing to an executor thread
                    await sio.loop.run_in_executor(None, processor.process_frame, bgr_frame)
                    # print(f"DEBUG: Python Service - Frame for {session_key} submitted for processing.")
                    # Optional: send an acknowledgement back to Node.js
                    # await sio.emit('frame_processed_ack', {'studentId': student_id, 'lectureCode': lectureCode, 'status': 'submitted'}, room=sid)

                except Exception as e:
                    print(f"ERROR: Python Service - Error processing frame for {session_key}: {e}")
                    # Optionally notify Node.js of frame processing error
                    # await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': f'Frame processing error: {str(e)}'}, room=sid)
            ```
        *   **Sub-task 2.4: Handle `end_engagement_processing` Event:**
            ```python
            @sio.on('end_engagement_processing')
            async def handle_end_engagement(sid, data):
                # data expected: { studentId: "...", lectureCode: "..." }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')

                if not student_id or not lecture_code:
                    print(f"ERROR: Python Service - Missing studentId or lectureCode in end_engagement_processing from SID {sid}. Data: {data}")
                    return

                session_key = f"{student_id}_{lecture_code}"
                print(f"INFO: Python Service - Received 'end_engagement_processing' for session: {session_key} from SID {sid}.")
                
                processor = active_sessions.pop(session_key, None) # Atomically get and remove
                if processor:
                    try:
                        print(f"INFO: Python Service - Calling end_session for {session_key}.")
                        # end_session can be long due to video processing/upload; run in executor
                        await sio.loop.run_in_executor(None, processor.end_session)
                        print(f"INFO: Python Service - Session for {session_key} ended and resources released.")
                        await sio.emit('processing_ended', {'studentId': student_id, 'lectureCode': lecture_code, 'message': f'Session {session_key} ended successfully.'}, room=sid)
                    except Exception as e:
                        print(f"ERROR: Python Service - Error during end_session for {session_key}: {e}")
                        await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': f'Session cleanup error: {str(e)}'}, room=sid)
                else:
                    print(f"WARN: Python Service - No active session found for {session_key} to end. SID: {sid}")
            ```

    3.  **Node.js Backend Modifications ([`server/server.js`](server/server.js)) - Client to Python Service:**
        *   **Sub-task 3.1: Implement Robust Socket.IO Client in Node.js:**
            *   Install `socket.io-client`: `npm install socket.io-client` (if not already done).
            *   Refine the connection logic from the previous phase's outline:
            ```javascript
            // In server.js
            const ioPythonClient = require('socket.io-client');
            const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001/ws'; // Target /ws where Socket.IO is mounted
            let pythonServiceSocket = null;
            let connectionInterval = null;

            function connectToPythonService() {
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    console.log('[Node.js] Already connected to Python Service.');
                    return;
                }

                // Clear any existing interval to prevent multiple connection attempts
                if (connectionInterval) clearInterval(connectionInterval);

                console.log(`[Node.js] Attempting to connect to Python Engagement Service at ${PYTHON_SERVICE_URL}...`);
                // Ensure previous socket listeners are removed if re-instantiating
                if (pythonServiceSocket) {
                    pythonServiceSocket.removeAllListeners();
                }
                pythonServiceSocket = ioPythonClient(PYTHON_SERVICE_URL, {
                    reconnectionAttempts: 5,
                    reconnectionDelay: 3000,
                    transports: ['websocket'] // Prefer websocket for inter-service
                });

                pythonServiceSocket.on('connect', () => {
                    console.log('[Node.js] Successfully connected to Python Engagement Service.');
                    if (connectionInterval) {
                        clearInterval(connectionInterval);
                        connectionInterval = null;
                    }
                });

                pythonServiceSocket.on('disconnect', (reason) => {
                    console.warn(`[Node.js] Disconnected from Python Engagement Service. Reason: ${reason}. Attempting to reconnect...`);
                    // Optional: Implement a more robust backoff strategy for retries
                    if (!connectionInterval) {
                       connectionInterval = setInterval(connectToPythonService, 5000); // Retry every 5s
                    }
                });

                pythonServiceSocket.on('connect_error', (err) => {
                    console.error(`[Node.js] Connection error with Python Service: ${err.message}. Will retry.`);
                    if (!connectionInterval && (!pythonServiceSocket || !pythonServiceSocket.connected)) {
                       connectionInterval = setInterval(connectToPythonService, 5000);
                    }
                });
                
                // Listen for custom events from Python service
                pythonServiceSocket.on('processing_started', (data) => console.log('[Node.js] Python service confirmed processing_started:', data));
                pythonServiceSocket.on('processing_ended', (data) => console.log('[Node.js] Python service confirmed processing_ended:', data));
                pythonServiceSocket.on('processing_error', (data) => console.error('[Node.js] Python service reported processing_error:', data));
                // pythonServiceSocket.on('frame_processed_ack', (data) => console.log('[Node.js] Python service acked frame:', data)); // If using ACKs
            }
            connectToPythonService(); // Initial connection attempt when Node.js starts
            ```
        *   **Sub-task 3.2: Refine Relaying Logic (within `/engagement-stream` namespace in Node.js):**
            *   On `start_video_session` from browser client:
                ```javascript
                // Inside engagementStreamNsp.on('connection', (socket) => { ... socket.on('start_video_session', (data) => { ...
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    const { studentId, lectureCode } = data; // from browser client
                    const devMode = process.env.ENGAGEMENT_DEV_MODE === 'true'; // Get from Node.js env
                    console.log(`[Node.js] Relaying 'start_engagement_processing' to Python for ${studentId}, ${lectureCode}, devMode: ${devMode}`);
                    pythonServiceSocket.emit('start_engagement_processing', { studentId, lectureCode, devMode });
                } else {
                    console.error('[Node.js] Cannot start engagement: Python service not connected.');
                    socket.emit('engagement_error', { error: 'Engagement service unavailable. Please try again later.' }); // Notify client
                }
                // ...
                ```
            *   On `video_frame_chunk` (ArrayBuffer) from browser client:
                ```javascript
                // Inside ... socket.on('video_frame_chunk', (payload) => { ...
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    const { studentId, lectureCode, chunk } = payload; // chunk is ArrayBuffer
                    // console.log(`[Node.js] Relaying 'video_frame_from_node' to Python for ${studentId}. Chunk size: ${chunk.byteLength}`);
                    pythonServiceSocket.emit('video_frame_from_node', { studentId, lectureCode, frame_chunk: chunk });
                } else {
                    // console.warn('[Node.js] Cannot relay frame: Python service not connected. Frame dropped.');
                    // Avoid flooding logs if connection is down for a while
                }
                // ...
                ```
            *   On `stop_video_session` or browser client `disconnect`:
                ```javascript
                // Inside ... socket.on('stop_video_session', (data) => { or socket.on('disconnect', ...
                if (pythonServiceSocket && pythonServiceSocket.connected && clientSessionInfo.studentId) { // Ensure session was active
                    console.log(`[Node.js] Relaying 'end_engagement_processing' to Python for ${clientSessionInfo.studentId}, ${clientSessionInfo.lectureCode}`);
                    pythonServiceSocket.emit('end_engagement_processing', {
                        studentId: clientSessionInfo.studentId,
                        lectureCode: clientSessionInfo.lectureCode
                    });
                } else if (clientSessionInfo.studentId) { // Session was active but Python service is down
                     console.error('[Node.js] Cannot end engagement cleanly: Python service not connected.');
                }
                // ...
                ```

*   **Expected Outcome (Revised & More Detailed):**
    *   A Python service (`main.py` using FastAPI/Uvicorn and `python-socketio`) is running, listening on a specific port (e.g., 5001) and Socket.IO path (e.g., `/ws`).
    *   The Python service correctly initializes Firebase Admin SDK and loads necessary configurations (credential paths) from environment variables.
    *   The Python service's Socket.IO event handlers (`connect`, `disconnect`, `start_engagement_processing`, `video_frame_from_node`, `end_engagement_processing`) are functional.
    *   Upon receiving `start_engagement_processing`, an `EngagementProcessor` instance is created, associated with a `session_key` (e.g., `studentId_lectureCode`), and stored in `active_sessions`.
    *   Video frames received as raw JPEG bytes in `video_frame_from_node` are successfully decoded into OpenCV BGR format.
    *   The `EngagementProcessor.start_session()` method is called with the first valid BGR frame to initialize its `VideoWriter`.
    *   Subsequent `EngagementProcessor.process_frame()` calls are made for each frame, executed in an executor thread to prevent blocking the `asyncio` event loop.
    *   Upon `end_engagement_processing`, the corresponding `EngagementProcessor.end_session()` is called (also in an executor), and the instance is removed from `active_sessions`.
    *   The Node.js backend has a robust `socket.io-client` instance that connects to the Python service (with reconnection logic) and reliably relays commands and video data (ArrayBuffers containing JPEG bytes).
    *   Communication between Node.js and Python service is logged, and basic error notifications (e.g., Python service unavailable) are sent back to the browser client if appropriate.
    *   Firebase updates (from `EngagementProcessor`) occur based on processed frames. YouTube uploads are triggered by `end_session` if not in `dev_mode`.

*   **Testing Strategy (Developer - Revised & More Detailed):**
    *   **Python Service Standalone (`python_engagement_service/main.py`):**
        *   Set necessary environment variables (`FIREBASE_CREDENTIALS_PATH`, `FIREBASE_DATABASE_URL`, `YOUTUBE_SERVICE_ACCOUNT_PATH`).
        *   Run: `cd python_engagement_service && uvicorn main:app --host 0.0.0.0 --port 5001 --reload` (`--reload` for development).
        *   Use a dedicated Python Socket.IO client script (`test_python_service_client.py`) to:
            *   Connect to `http://localhost:5001/ws`.
            *   Emit `start_engagement_processing` with mock `studentId`, `lectureCode`, `devMode`. Verify Python service logs and `processing_started` event.
            *   Load a sample JPEG image, convert to bytes, and emit `video_frame_from_node` with these bytes. Verify Python service logs frame receipt, decodes it (add a log to save the decoded frame temporarily for visual check), and that `EngagementProcessor.process_frame` is called. Check Firebase for metric updates.
            *   Send multiple frames.
            *   Emit `end_engagement_processing`. Verify Python service logs, `EngagementProcessor.end_session` is called (check for temp video file creation/deletion, YouTube upload attempt if `devMode` is false), and `processing_ended` event.
    *   **Node.js Backend (Relaying Logic - `server/server.js`):**
        *   Ensure the Python service is running and accessible from Node.js.
        *   Set `PYTHON_SERVICE_URL` environment variable for Node.js.
        *   In Node.js, manually trigger the functions that emit to `pythonServiceSocket` (e.g., by temporarily calling them in a test route or on server start).
        *   Verify logs on both Node.js (confirming emits) and Python service (confirming receives and correct data).
        *   Test Python service connection/disconnection resilience in Node.js (stop/start Python service while Node.js is running).
    *   **Integrated Test (Browser Client -> Node.js -> Python Service):**
        *   Run all components.
        *   Use the browser client (from Phase 1) to initiate video streaming.
        *   Trace logs across all three services:
            *   Browser: `startStreaming` called, frames sent via Socket.IO to Node.js.
            *   Node.js: Receives from browser, relays `start_engagement_processing` and `video_frame_from_node` (with ArrayBuffer of JPEG bytes) to Python.
            *   Python: Receives from Node.js, creates `EngagementProcessor`, decodes frames, processes, updates Firebase.
        *   Verify Firebase data. If `devMode` is false, check YouTube after stopping the stream.
    *   **Frame Integrity Test:**
        *   In Python's `handle_video_frame`, after `cv2.imdecode`, temporarily save the `bgr_frame` to a file (`cv2.imwrite("temp_decoded_frame.jpg", bgr_frame)`). Compare this with the frame captured on the client-side (if possible) to ensure no major corruption during transit/decoding.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **Python Service Port/Firewall:** Ensure the Python service port (e.g., 5001) is not blocked by a firewall if Node.js and Python are on different machines or in different Docker networks (relevant for Phase 4).
    *   **Socket.IO Path Mismatch:** If FastAPI mounts Socket.IO at `/ws` (i.e., `app.mount("/ws", asgi_app)`), the Node.js client must connect to `http://<python_host>:<port>/ws`.
        *   **Mitigation:** Double-check URLs and paths on both client and server.
    *   **Async/Await Issues in Python:** Forgetting `await` for async Socket.IO calls (`sio.emit`) or not properly running blocking code in an executor.
        *   **Mitigation:** Careful review of async code. Use linters that understand async Python. Test thoroughly.
    *   **Video Frame Data Type Mismatch (Node.js to Python):** Node.js sends an `ArrayBuffer`. Python's `python-socketio` should receive this as `bytes`. `np.frombuffer` expects bytes.
        *   **Mitigation:** Log `type(frame_jpeg_bytes)` in Python's `handle_video_frame` to confirm it's `bytes`.
    *   **JPEG Decoding Errors:** `cv2.imdecode` returning `None` if bytes are corrupted or not a valid JPEG.
        *   **Mitigation:** Ensure client sends valid JPEGs. Log errors robustly in Python.
    *   **`EngagementProcessor.start_session` Timing:** This method, which initializes `VideoWriter`, needs the first frame's dimensions. Ensure it's called *before* `process_frame` tries to write to `video_writer` if `video_writer` is not yet initialized.
        *   **Mitigation:** Add a flag like `self.session_started = False` in `EngagementProcessor.__init__`, set to `True` in `start_session`. In `process_frame`, check this flag before writing. The provided logic in `handle_video_frame` attempts to address this by calling `start_session` on the first frame.
    *   **Resource Management for `EngagementProcessor` Instances:** If Node.js disconnects abruptly without sending `end_engagement_processing`, `EngagementProcessor` instances in `active_sessions` might become orphaned.
        *   **Mitigation:** Implement a timeout mechanism in the Python service. If no frames are received for a session for X minutes, automatically call `end_session` and remove it. This is more advanced and can be a later enhancement. For now, rely on Node.js sending `end_engagement_processing` on client disconnect.
    *   **Global State in Python Service (Firebase Init):** Ensure `firebase_admin.initialize_app` is truly called only once. The `if not firebase_admin._apps:` check is a common way to handle this.
        *   **Mitigation:** Test by restarting the Python service multiple times or simulating multiple connections.

### Phase 3: Full End-to-End Flow & YouTube Integration

*   **Objective:** Achieve a fully operational end-to-end data pipeline from browser-based webcam capture through Node.js relay to Python processing, culminating in Firebase metric updates and conditional YouTube video uploads. This phase focuses on integrating all previously developed components and verifying the complete workflow, including the `dev_mode` functionality.

*   **Detailed Key Tasks:**

    1.  **Python Engagement Service (`python_engagement_service/engagement_processor.py` and `main.py`):**
        *   **Sub-task 1.1: Finalize `EngagementProcessor.end_session()` Logic:**
            *   Ensure `self.video_writer.release()` is called reliably, preferably in a `finally` block within `end_session` if video recording was active.
            *   **Conditional Video Processing & Upload:**
                ```python
                # Inside EngagementProcessor.end_session()
                # ... (mark_attendance, self.video_writer.release()) ...
                video_uploaded_link = None
                if not self.dev_mode and hasattr(self, 'temp_video_filename') and os.path.exists(self.temp_video_filename):
                    print(f"INFO ({self.session_key}): Production mode. Processing video '{self.temp_video_filename}' for YouTube upload.")
                    slow_path = f"slow_{os.path.basename(self.temp_video_filename)}" # Place slow video in same dir or configurable temp dir
                    try:
                        print(f"INFO ({self.session_key}): Slowing down video. Output: {slow_path}")
                        # Ensure slow_down_video is a method or accessible function
                        self.slow_down_video(self.temp_video_filename, slow_path, scale=4.0)

                        print(f"INFO ({self.session_key}): Uploading slowed video '{slow_path}' to YouTube.")
                        # Ensure upload_to_youtube is a method or accessible function, passing the SA key path
                        video_uploaded_link = self.upload_to_youtube(
                            slow_path, self.student_id, self.lecture_code, self.youtube_service_account_path
                        )
                        print(f"INFO ({self.session_key}): YouTube upload successful. Link: {video_uploaded_link}")
                        
                        # Update Firebase with the YouTube link
                        db.reference(f'lectures/{self.lecture_code}/attendens/{self.student_id}/lecture_video').set(video_uploaded_link)
                        print(f"INFO ({self.session_key}): YouTube link saved to Firebase.")

                    except Exception as e_video_processing:
                        print(f"ERROR ({self.session_key}): Failed during video processing/upload: {e_video_processing}")
                        # Log error, but don't let it stop cleanup of local files.
                    finally:
                        if os.path.exists(slow_path):
                            print(f"INFO ({self.session_key}): Cleaning up slowed video file: {slow_path}")
                            os.remove(slow_path)
                elif hasattr(self, 'temp_video_filename') and os.path.exists(self.temp_video_filename):
                    print(f"INFO ({self.session_key}): Dev mode enabled OR video file not found. YouTube upload skipped.")
                
                # Cleanup original temporary video file
                if hasattr(self, 'temp_video_filename') and os.path.exists(self.temp_video_filename):
                    print(f"INFO ({self.session_key}): Cleaning up original video file: {self.temp_video_filename}")
                    os.remove(self.temp_video_filename)
                
                # Release models (if initialized per instance and have a close method)
                if hasattr(self.face_mesh_model, 'close'): self.face_mesh_model.close()
                if hasattr(self.pose_model, 'close'): self.pose_model.close()
                print(f"INFO ({self.session_key}): EngagementProcessor session ended.")
                ```
            *   Ensure `slow_down_video` and `upload_to_youtube` (now using service account credentials) are correctly defined as methods within `EngagementProcessor` or are utility functions accessible to it, receiving all necessary parameters (like `self.youtube_service_account_path`).
        *   **Sub-task 1.2: Robust Error Handling for External Calls:**
            *   Wrap calls to Firebase, `slow_down_video`, `upload_to_youtube`, and `os.remove` in `try...except` blocks with specific exception handling where possible (e.g., `googleapiclient.errors.HttpError` for YouTube, `firebase_admin.FirebaseError`).
            *   Log errors comprehensively.
        *   **Sub-task 1.3: Temporary File Paths:**
            *   Ensure `temp_video_filename` and `slow_path` are written to a directory the Python service has write access to (e.g., a `/tmp` or a dedicated `data/` directory within the service's container/runtime environment). Make this configurable if needed.

    2.  **Node.js Backend ([`server/server.js`](server/server.js)):**
        *   **Sub-task 2.1: Determine and Pass `dev_mode` Flag:**
            *   The `dev_mode` flag needs to be determined by the Node.js backend when it initiates an engagement session with the Python service.
            *   **Source of `dev_mode`:**
                1.  **Environment Variable (Simplest for global dev/prod):**
                    ```javascript
                    // In server.js, when calling Python service
                    const devMode = process.env.ENGAGEMENT_DEV_MODE === 'true';
                    pythonServiceSocket.emit('start_engagement_processing', { studentId, lectureCode, devMode });
                    ```
                2.  **Per-Lecture/Instructor Setting (More Flexible):**
                    *   This would require fetching a setting from Firebase (e.g., `lectures/{lecture_code}/settings/engagementDevMode`) or an admin panel when the Node.js server handles the request to start engagement. This is more complex and can be a future enhancement if per-session `dev_mode` is needed.
                    *   **Initial Plan:** Use a global environment variable on the Node.js server for `ENGAGEMENT_DEV_MODE`.
        *   **Sub-task 2.2: Ensure All Necessary Data is Relayed:**
            *   Verify that `studentId` and `lectureCode` are correctly and consistently passed from the browser client, through Node.js, to the Python service for all relevant events (`start_engagement_processing`, `video_frame_from_node`, `end_engagement_processing`).

    3.  **Client-Side Triggering Logic (e.g., [`client/public/scripts/lecture.js`](client/public/scripts/lecture.js) or `engagementStreaming.js`):**
        *   **Sub-task 3.1: Integrate with "Student Enters Lecture":**
            *   When the client-side logic confirms a student has successfully joined a lecture (e.g., after authentication, loading lecture details, and joining relevant Socket.IO rooms for general lecture communication):
                *   Invoke `engagementStreamer.startStreaming(studentId, lectureCode);`
                *   The `studentId` and `lectureCode` must be available in the client's JavaScript context at this point.
        *   **Sub-task 3.2: Integrate with "Instructor Engagement Switch":**
            *   The client already listens for `engagement_detection_status` or `engagement_status_update` from the server (sent by the instructor dashboard via Node.js).
            *   Modify the handler for this event:
                ```javascript
                // Existing client-side Socket.IO listener for instructor commands
                socket.on('engagement_status_update', (data) => { // Or your existing event name
                    const { lectureCode: eventLectureCode,isEnabled } = data;
                    // Ensure this update is for the current student's lecture
                    if (currentLectureCode === eventLectureCode) {
                        if (isEnabled) {
                            console.log('Instructor enabled engagement detection. Starting stream...');
                            engagementStreamer.startStreaming(currentStudentId, currentLectureCode);
                        } else {
                            console.log('Instructor disabled engagement detection. Stopping stream...');
                            engagementStreamer.stopStreaming();
                        }
                    }
                });
                ```
        *   **Sub-task 3.3: Handle UI Feedback:**
            *   Provide visual feedback to the student (e.g., a small icon or text message) indicating whether engagement monitoring is active, inactive, or if there was an error (e.g., webcam access denied, service unavailable). This can be updated by `engagementStreamer` methods.

    4.  **End-to-End Data Flow Verification:**
        *   **Sub-task 4.1: Trace `studentId` and `lectureCode`:** Ensure these identifiers are correctly propagated through each layer (Client -> Node.js -> Python) and used for Firebase paths and YouTube video titles/descriptions.
        *   **Sub-task 4.2: Verify Frame Data Path:** Confirm that video frames (JPEGs) travel from browser `MediaRecorder`/Canvas -> Node.js (as ArrayBuffer) -> Python service (as bytes, then decoded to BGR).

*   **Expected Outcome (Revised & More Detailed):**
    *   A fully functional pipeline:
        1.  Browser client captures webcam, sends JPEG frames and session info (`studentId`, `lectureCode`) to Node.js via Socket.IO.
        2.  Node.js relays this data to the Python Engagement Service via a separate Socket.IO connection, including the `dev_mode` flag.
        3.  Python service's `EngagementProcessor` processes frames, updates Firebase with real-time engagement metrics.
        4.  On session end, `EngagementProcessor` assembles the video, optionally slows it down and uploads to YouTube (if `dev_mode` is `false`), and updates Firebase with the video link.
    *   The `dev_mode` (controlled by Node.js environment variable) correctly enables/disables the YouTube upload feature in the Python service.
    *   Temporary video files (`.mp4`, `slow_*.mp4`) are reliably created and cleaned up in the Python service's designated temporary directory.
    *   Error handling is implemented at each stage of the video processing and upload chain in the Python service, with informative logging.
    *   Client-side correctly starts/stops streaming based on lecture entry and instructor toggle commands.

*   **Testing Strategy (Developer - Revised & More Detailed):**
    *   **Full End-to-End Test Scenarios:**
        *   **Scenario 1: Happy Path (Production Mode):**
            *   Set `ENGAGEMENT_DEV_MODE=false` in Node.js environment.
            *   Student joins lecture, instructor toggles engagement ON.
            *   Verify: Webcam starts, frames flow, Firebase metrics update, student leaves/instructor toggles OFF, video is processed, uploaded to YouTube, link in Firebase, temp files cleaned.
        *   **Scenario 2: Happy Path (Dev Mode):**
            *   Set `ENGAGEMENT_DEV_MODE=true` in Node.js environment.
            *   Same student actions.
            *   Verify: Webcam starts, frames flow, Firebase metrics update, student leaves/instructor toggles OFF, YouTube upload is SKIPPED (check Python logs), temp video file (if created) is cleaned.
        *   **Scenario 3: Error - YouTube Upload Failure:**
            *   Set `ENGAGEMENT_DEV_MODE=false`.
            *   Simulate YouTube API failure (e.g., invalid service account key temporarily, or modify `upload_to_youtube` to throw an error).
            *   Verify: Firebase metrics still update, session ends, Python logs the upload error, local video files are still cleaned up, no crash.
        *   **Scenario 4: Error - Video Processing Failure (`slow_down_video`):**
            *   Set `ENGAGEMENT_DEV_MODE=false`.
            *   Simulate error in `slow_down_video`.
            *   Verify: Firebase metrics update, session ends, Python logs processing error, YouTube upload is skipped, files cleaned.
        *   **Scenario 5: Multiple Concurrent Students:**
            *   Open multiple browser windows, simulate different students in the same or different lectures.
            *   Verify: Each session is handled independently by the Python service, data goes to correct Firebase paths, videos (if applicable) are distinct.
    *   **Component-Level Verification during E2E Tests:**
        *   **Client-Side:** Use browser dev tools to monitor console logs, Socket.IO messages, and UI feedback.
        *   **Node.js Backend:** Monitor server logs for message relay, `dev_mode` determination, and communication with Python service.
        *   **Python Engagement Service:** Monitor logs extensively for session creation, frame reception/decoding, `EngagementProcessor` calls, Firebase updates, video file operations, YouTube API calls (or skipping them), and cleanup. Check the temporary file directory during a session.
    *   **Data Verification:**
        *   Manually inspect Firebase database for correct engagement metrics structure and values, and for the `lecture_video` link.
        *   Check the target YouTube channel for uploaded videos, verify titles, descriptions, and privacy status.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **Permissions for Temporary File Directory (Python Service):** The Python service needs write/delete permissions for the directory where `temp_video_filename` and `slow_path` are stored. This is especially relevant in containerized environments (Phase 4).
        *   **Mitigation:** Define a specific temp directory (e.g., `/tmp/engagement_videos/` inside the container) and ensure permissions are set correctly in the Dockerfile.
    *   **Long-Running Operations in `EngagementProcessor.end_session()`:** Video slowing and YouTube upload can be time-consuming and block the executor thread in Python if not handled carefully.
        *   **Mitigation:** Ensure `end_session` is indeed run in an executor thread via `sio.loop.run_in_executor`. For very long uploads, consider a more advanced task queue system (e.g., Celery) as a future enhancement if this becomes a bottleneck for ending many sessions. For now, executor thread is a good start.
    *   **Error Propagation and User Feedback:** If a YouTube upload fails, the student/instructor might not be aware.
        *   **Mitigation:** Python service should log errors. Node.js could potentially listen for `processing_error` events from Python and log them or (future enhancement) store a status in Firebase that the UI could reflect (e.g., "Video upload pending/failed").
    *   **State Synchronization for `dev_mode`:** If `dev_mode` could change dynamically per lecture (not the current plan), ensuring the Python service gets the correct, up-to-date flag for each session would be critical.
        *   **Mitigation:** Current plan uses Node.js environment variable, which is simpler and less prone to sync issues for a global dev/prod switch.
    *   **Cleanup Logic Failures:** If `os.remove` fails (e.g., file in use, permissions), temporary files might be left behind.
        *   **Mitigation:** Wrap `os.remove` in `try...except` and log errors. Implement a startup cleanup routine in the Python service to delete orphaned temp files from previous runs (optional enhancement).
    *   **Inconsistent `studentId`/`lectureCode`:** Any mismatch in these IDs between client, Node.js, and Python will lead to data being stored incorrectly or sessions not being found.
        *   **Mitigation:** Rigorous logging and tracing of these IDs during testing. Standardize the data structures for messages.

### Phase 4: Dockerization & Deployment Configuration

*   **Objective:** Create reproducible, isolated, and deployable units for both the Node.js application and the Python Engagement Service using Docker. Define their interaction and configuration management using Docker Compose for local development and as a blueprint for production deployment.

*   **Detailed Key Tasks:**

    1.  **Dockerfile for Node.js Application (e.g., located at project root `./Dockerfile.node` or `./node-app/Dockerfile` if you structure the Node app in its own subfolder):**
        *   **Sub-task 1.1: Base Image Selection:**
            *   `FROM node:18-alpine` (or a recent LTS like `node:20-alpine`). Alpine images are smaller. Consider `node:18-slim` or `node:20-slim` if Alpine causes issues with native dependencies for any Node modules.
        *   **Sub-task 1.2: Working Directory & Application Code Copy Strategy:**
            *   `WORKDIR /usr/src/app`
            *   **Strategy:** Copy only necessary files for dependency installation first, then the rest of the code to leverage Docker's layer caching.
            *   Create a `.dockerignore` file in the same directory as this Dockerfile (or project root if Dockerfile is there). Add `node_modules`, `.git`, `.env`, `*.log`, `npm-debug.log*`, `python_engagement_service/` (if Python service is a subfolder of the main project and not meant to be in this image), etc.
        *   **Sub-task 1.3: Install Dependencies:**
            *   `COPY package.json package-lock.json* ./`
            *   `RUN npm ci --only=production` (Using `npm ci` is generally recommended for reproducible builds from `package-lock.json`). If you have build steps that require devDependencies, omit `--only=production` here and add a prune step later or use a multi-stage build.
        *   **Sub-task 1.4: Copy Application Source Code:**
            *   `COPY . .` (If Dockerfile is at project root and `.dockerignore` is set up correctly).
            *   Or, more explicitly: `COPY server ./server`, `COPY client ./client` (assuming these are the main directories for your Node.js app relative to the Dockerfile's context).
        *   **Sub-task 1.5: Expose Port:**
            *   `EXPOSE 3000` (Or whatever port your Node.js server in [`server/server.js`](server/server.js) listens on, e.g., `process.env.PORT || 3000`).
        *   **Sub-task 1.6: Define Default Command:**
            *   `CMD [ "node", "server/server.js" ]`
        *   **Example `Dockerfile.node` (assuming it's at project root):**
            ```dockerfile
            # Use an official Node.js runtime as a parent image
            FROM node:18-alpine

            # Set the working directory in the container
            WORKDIR /usr/src/app

            # Copy package.json and package-lock.json (if available)
            COPY package.json ./
            COPY package-lock.json* ./

            # Install project dependencies
            # Using npm ci for reproducible builds from lock file
            RUN npm ci --only=production

            # Copy the rest of the application code (server and client folders)
            # Ensure .dockerignore excludes node_modules, .git, python_service, etc.
            COPY ./server ./server
            COPY ./client ./client
            # If you have other root files needed by server.js, copy them too. E.g. COPY cors.json ./

            # Make port 3000 available to the world outside this container
            EXPOSE 3000 # Or your application's port

            # Define environment variables (can be overridden by docker-compose or run command)
            ENV NODE_ENV=production
            ENV PORT=3000
            # Other ENV vars like PYTHON_SERVICE_URL will be set via docker-compose

            # Run server.js when the container launches
            CMD [ "node", "server/server.js" ]
            ```

    2.  **Dockerfile for Python Engagement Service (e.g., in `./python_engagement_service/Dockerfile.python`):**
        *   **Sub-task 2.1: Base Image Selection:**
            *   `FROM python:3.9-slim` (or `python:3.10-slim`, `python:3.11-slim`). Slim images are a good balance. Avoid full Debian images unless necessary for complex C dependencies.
        *   **Sub-task 2.2: Working Directory & Code Copy:**
            *   `WORKDIR /opt/app`
            *   Create a `.dockerignore` in `./python_engagement_service/` to exclude `.venv`, `__pycache__`, `*.log`, `config/` (if credentials are not meant to be baked in, which they shouldn't be), etc.
        *   **Sub-task 2.3: Install Python Dependencies (without venv inside container, as container itself is the isolation):**
            *   `COPY requirements.txt ./`
            *   `RUN pip install --no-cache-dir -r requirements.txt` (`--no-cache-dir` keeps image size smaller).
            *   **Note on OpenCV:** If `opencv-python` has issues with headless environments on Alpine/Slim, you might need `opencv-python-headless` or install additional system libraries (e.g., `RUN apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*`). Test this thoroughly.
        *   **Sub-task 2.4: Copy Application Code:**
            *   `COPY . .` (Copies everything from `python_engagement_service/` context to `/opt/app`).
        *   **Sub-task 2.5: Expose Port:**
            *   `EXPOSE 5001` (Or the port Uvicorn/Python service listens on).
        *   **Sub-task 2.6: Define Default Command (for Uvicorn with FastAPI):**
            *   `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]` (Assuming `main.py` contains `app = FastAPI(...)`).
        *   **Example `Dockerfile.python` (in `./python_engagement_service/`):**
            ```dockerfile
            # Use an official Python runtime as a parent image
            FROM python:3.9-slim

            # Set environment variables for Python
            ENV PYTHONDONTWRITEBYTECODE 1 # Prevents .pyc files
            ENV PYTHONUNBUFFERED 1     # Ensures print statements appear directly in logs

            # Set the working directory in the container
            WORKDIR /opt/app

            # Install system dependencies that might be needed by OpenCV or other libraries
            # This is an example; you might need more or fewer depending on your exact requirements.
            # RUN apt-get update && apt-get install -y --no-install-recommends \
            #     libgl1-mesa-glx \
            #     libglib2.0-0 \
            #  && rm -rf /var/lib/apt/lists/*

            # Copy the requirements file into the container
            COPY requirements.txt ./

            # Install Python dependencies
            RUN pip install --no-cache-dir -r requirements.txt

            # Copy the rest of the application code into the container
            # Ensure .dockerignore in this directory excludes .venv, __pycache__, config/ (for secrets)
            COPY . .

            # Make port 5001 available
            EXPOSE 5001 # Or your Python service's port

            # Define environment variables (will be set by docker-compose)
            # ENV FIREBASE_CREDENTIALS_PATH=/run/secrets/firebase_credentials
            # ENV YOUTUBE_SERVICE_ACCOUNT_PATH=/run/secrets/youtube_credentials
            # ENV FIREBASE_DATABASE_URL=your_db_url_from_compose
            # ENV TEMP_VIDEO_DIR=/tmp/engagement_videos # For video files

            # Create the temporary directory for video files and ensure it's writable
            # RUN mkdir -p /tmp/engagement_videos && chmod 777 /tmp/engagement_videos

            # Run main.py (which starts Uvicorn) when the container launches
            CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]
            ```
            *   **Important for Python Service:** The `TEMP_VIDEO_DIR` environment variable should be used by `EngagementProcessor` to save temporary videos. The Dockerfile should create this directory and ensure it's writable by the user the Python process runs as (usually root by default in Python images, but can be changed with `USER` instruction for better security).

    3.  **`docker-compose.yml` for Local Development & Orchestration (at project root):**
        *   **Sub-task 3.1: Define Services:**
            *   `version: '3.8'` (or newer)
            *   `services:`
                *   `node_app:` (Node.js web application)
                *   `python_service:` (Python Engagement Service)
        *   **Sub-task 3.2: Configure `node_app` Service:**
            *   `build:`
                *   `context: .` (If Dockerfile.node is at root)
                *   `dockerfile: Dockerfile.node`
            *   `ports:`
                *   `- "3000:3000"` (Maps host port 3000 to container port 3000)
            *   `environment:` (Key-value pairs)
                *   `NODE_ENV=development`
                *   `PORT=3000`
                *   `PYTHON_SERVICE_URL=http://python_service:5001/ws` (Using Docker Compose service discovery; `python_service` is the hostname, 5001 is the Python service's internal port)
                *   `ENGAGEMENT_DEV_MODE=true` (For local testing)
                *   `FIREBASE_DATABASE_URL=your_actual_firebase_db_url` (Can also be in a `.env` file)
                *   Other Node.js specific env vars.
            *   `volumes:` (For live code reloading during development)
                *   `./server:/usr/src/app/server`
                *   `./client:/usr/src/app/client`
                *   `./package.json:/usr/src/app/package.json`
                *   `./package-lock.json:/usr/src/app/package-lock.json`
                *   (Be cautious with volume-mounting `node_modules` from host to container; usually better to let container manage its own `node_modules`.)
            *   `depends_on:`
                *   `- python_service` (Optional, ensures Python service starts before Node.js attempts to connect, though Node.js client should have retry logic)
        *   **Sub-task 3.3: Configure `python_service` Service:**
            *   `build:`
                *   `context: ./python_engagement_service` (Path to Python service code and its Dockerfile)
                *   `dockerfile: Dockerfile.python`
            *   `ports:`
                *   `- "5001:5001"` (Map for direct testing if needed, but primarily for Node.js to access)
            *   `environment:`
                *   `FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}` (Inherits from `.env` file or host)
                *   `FIREBASE_CREDENTIALS_PATH=/opt/app/config/firebase-credentials.json` (Path *inside* the container)
                *   `YOUTUBE_SERVICE_ACCOUNT_PATH=/opt/app/config/youtube-service-account-credentials.json` (Path *inside* the container)
                *   `TEMP_VIDEO_DIR=/opt/app/temp_videos` (Path *inside* the container for video files)
            *   `volumes:`
                *   `./python_engagement_service:/opt/app` (For live code reloading)
                *   `./config/firebase-credentials.json:/opt/app/config/firebase-credentials.json:ro` (Mount actual credential file read-only)
                *   `./config/youtube-service-account-credentials.json:/opt/app/config/youtube-service-account-credentials.json:ro` (Mount actual credential file read-only)
                *   Ensure a `python_engagement_service/temp_videos` directory exists on host if you want to inspect videos locally, or let the container manage it internally. If mounting, ensure permissions.
        *   **Sub-task 3.4: Define Networks (Optional but good practice):**
            *   `networks:`
                *   `app_network:`
            *   Assign services to this network:
                ```yaml
                services:
                  node_app:
                    networks:
                      - app_network
                  python_service:
                    networks:
                      - app_network
                ```
        *   **Sub-task 3.5: `.env` File for Docker Compose:**
            *   Create a `.env` file at the project root (where `docker-compose.yml` is).
            *   `FIREBASE_DATABASE_URL=your_actual_firebase_db_url`
            *   `ENGAGEMENT_DEV_MODE=true`
            *   Other shared environment variables.
            *   Add `.env` to `.gitignore`.
        *   **Example `docker-compose.yml`:**
            ```yaml
            version: '3.8'

            services:
              node_app:
                build:
                  context: .
                  dockerfile: Dockerfile.node # Assuming Dockerfile.node is at project root
                ports:
                  - "3000:3000" # Expose Node.js app on host port 3000
                environment:
                  - NODE_ENV=development
                  - PORT=3000
                  - PYTHON_SERVICE_URL=http://python_service:5001/ws # Service discovery
                  - ENGAGEMENT_DEV_MODE=${ENGAGEMENT_DEV_MODE:-true} # Use from .env, default true
                  - FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}
                volumes:
                  # Mount source code for live reload (adjust paths as per your project structure)
                  - ./server:/usr/src/app/server
                  - ./client:/usr/src/app/client
                  # Avoid mounting node_modules from host; let container handle it
                depends_on:
                  - python_service
                networks:
                  - app_network

              python_service:
                build:
                  context: ./python_engagement_service # Path to Python service's Dockerfile and code
                  dockerfile: Dockerfile.python
                ports:
                  - "5001:5001" # Expose Python service (mainly for Node.js to connect, can be omitted if not needed externally)
                environment:
                  - FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}
                  - FIREBASE_CREDENTIALS_PATH=/opt/app/config/firebase-credentials.json # Path inside container
                  - YOUTUBE_SERVICE_ACCOUNT_PATH=/opt/app/config/youtube-service-account-credentials.json # Path inside container
                  - TEMP_VIDEO_DIR=/opt/app/temp_videos # Ensure this dir is created in Dockerfile.python and writable
                volumes:
                  - ./python_engagement_service:/opt/app # Mount Python code for live reload
                  # Mount actual credential files from host to the paths defined in environment variables
                  # Ensure these files exist in a 'config' folder at the project root or adjust paths.
                  - ./config/firebase-credentials.json:/opt/app/config/firebase-credentials.json:ro
                  - ./config/youtube-service-account-credentials.json:/opt/app/config/youtube-service-account-credentials.json:ro
                  # Volume for persistent/inspectable temp videos (optional for dev)
                  # - ./python_engagement_service_temp_videos:/opt/app/temp_videos
                networks:
                  - app_network
            
            networks:
              app_network:
                driver: bridge
            ```

    4.  **Credentials Management Strategy:**
        *   **Sub-task 4.1: Local Development (Docker Compose):**
            *   Create a `config/` directory at the project root (and add `config/` to `.gitignore`).
            *   Place `firebase-credentials.json` and `youtube-service-account-credentials.json` into this `config/` directory.
            *   Use Docker Compose `volumes` to mount these files read-only into the respective containers at the paths specified by `FIREBASE_CREDENTIALS_PATH` and `YOUTUBE_SERVICE_ACCOUNT_PATH` environment variables within the Python service.
        *   **Sub-task 4.2: Production Deployment:**
            *   **NEVER** bake credential files into Docker images.
            *   Use your deployment platform's secrets management (e.g., Kubernetes Secrets, AWS Secrets Manager, HashiCorp Vault, Docker Swarm Secrets).
            *   These secrets would then be mounted as files into the containers at runtime, or their content passed as environment variables (less secure for multi-line JSONs). The paths inside the container would match what the application expects (e.g., `/run/secrets/firebase_key_file`).

*   **Expected Outcome (Revised & More Detailed):**
    *   A `Dockerfile.node` that successfully builds a runnable Docker image for the Node.js application.
    *   A `Dockerfile.python` (within `python_engagement_service/`) that successfully builds a runnable Docker image for the Python Engagement Service, including all its dependencies and correct startup command for Uvicorn.
    *   A `docker-compose.yml` file at the project root that can:
        *   Build both images.
        *   Start both services in a shared Docker network.
        *   Correctly map ports for external access to the Node.js app and inter-service communication.
        *   Inject environment variables (including service URLs for discovery, `DEV_MODE`, and paths to credentials) into both services.
        *   Mount local source code for live reloading during development.
        *   Securely mount actual credential files (from a local `.gitignore`'d `config/` directory) into the Python service container for local Docker Compose runs.
    *   A `.dockerignore` file for each Docker build context to optimize image size and build speed.
    *   A `.env` file for Docker Compose to manage shared environment variables locally.

*   **Testing Strategy (Developer - Revised & More Detailed):**
    *   **Individual Docker Image Builds:**
        *   `docker build -f Dockerfile.node -t node-app-image .` (from project root)
        *   `docker build -f python_engagement_service/Dockerfile.python -t python-service-image ./python_engagement_service`
        *   Verify both builds complete without errors.
    *   **Docker Compose Local Deployment:**
        *   Ensure `config/firebase-credentials.json` and `config/youtube-service-account-credentials.json` exist locally.
        *   Ensure `.env` file is populated.
        *   Run `docker-compose up --build`.
        *   Check logs from both `node_app` and `python_service` for successful startup, Firebase/YouTube SDK initialization, and connection between Node.js and Python service.
    *   **Full End-to-End Testing within Docker Compose:**
        *   Access the Node.js application via browser at `http://localhost:3000`.
        *   Perform all test scenarios from Phase 3 (Happy Path Prod/Dev, error cases for YouTube, multiple students).
        *   Verify Firebase data and YouTube uploads.
        *   Check container logs: `docker-compose logs -f node_app` and `docker-compose logs -f python_service`.
    *   **Verify Environment Variables and Mounted Files:**
        *   Exec into running containers to check:
            *   `docker-compose exec python_service printenv` (to see environment variables).
            *   `docker-compose exec python_service ls -l /opt/app/config/` (to verify credential files are mounted).
            *   `docker-compose exec python_service ls -l /opt/app/temp_videos/` (to check temp video directory).
    *   **Test Live Reloading (if volumes are mounted for code):**
        *   Make a small, log-generating change in `server/server.js` or `python_engagement_service/main.py`.
        *   If using `nodemon` for Node.js or `uvicorn --reload` for Python, the services should restart automatically within Docker Compose. Verify by checking logs.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **`.dockerignore` Misconfiguration:** Accidentally copying `node_modules` or `.venv` into the image, bloating it or causing conflicts.
        *   **Mitigation:** Carefully craft `.dockerignore` for each service. Use `docker history <image_name>` to inspect layer sizes.
    *   **File Path Issues Inside Containers:** Application code trying to access files using host paths or incorrect relative paths.
        *   **Mitigation:** Use absolute paths within the container (e.g., `/opt/app/config/firebase-credentials.json` as set by ENV var) or paths relative to the `WORKDIR`. Ensure mounted volumes map correctly to these expected paths.
    *   **Container Networking (`PYTHON_SERVICE_URL`):** Node.js app in one container needs to reach Python service in another. `localhost` inside a container refers to the container itself, not the host or other containers.
        *   **Mitigation:** Use Docker Compose service names as hostnames (e.g., `http://python_service:5001/ws`). Ensure both services are on the same Docker network (default with `docker-compose up`, or explicitly defined).
    *   **Permissions for Mounted Volumes/Temp Dirs:**
        *   If Python service runs as non-root user (good security practice, but more complex to set up), it might not have write access to mounted volumes or directories created by root in Dockerfile.
        *   The `TEMP_VIDEO_DIR` in the Python container needs to be writable by the Uvicorn process.
        *   **Mitigation:** For `TEMP_VIDEO_DIR`, `RUN mkdir -p /opt/app/temp_videos && chmod -R 777 /opt/app/temp_videos` in Dockerfile.python (or set ownership if running as non-root). For mounted credential files, `:ro` (read-only) is good.
    *   **Forgetting to Expose Ports:** `EXPOSE` in Dockerfile is documentation; `ports` mapping in `docker-compose.yml` actually publishes them.
        *   **Mitigation:** Ensure both are set if external access is needed, or just internal port for inter-service communication.
    *   **Differences Between Local Dev and Container Environment:** Missing system libraries (e.g., for OpenCV), different OS leading to path separator issues (though less common with modern Python/Node).
        *   **Mitigation:** Test thoroughly in Docker. For Python, use `os.path.join` for paths. Install necessary system libs in Dockerfile.
    *   **Credential Security:** Committing credential files or baking them into images.
        *   **Mitigation:** Strict `.gitignore`. Use volume mounts for local Docker Compose and proper secrets management for production.
    *   **Build Context Issues:** `COPY . .` behavior depends on the `build.context` in `docker-compose.yml` and location of Dockerfile.
        *   **Mitigation:** Be explicit with paths. Structure project with subdirectories for services if it simplifies contexts.

### Phase 5: Final Testing, Optimization & Documentation

*   **Objective:** Validate the stability, performance, and scalability of the fully integrated engagement detection system under various conditions. Optimize critical pathways, enhance error handling and logging, and produce comprehensive documentation for ongoing development and maintenance.

*   **Detailed Key Tasks:**

    1.  **Comprehensive Testing Strategies:**
        *   **Sub-task 1.1: Concurrency Testing:**
            *   **Goal:** Verify the system can handle multiple students (e.g., 5, 10, 20+ concurrent users, based on expected load) using the engagement feature simultaneously without errors, data corruption, or significant performance degradation.
            *   **Method:**
                *   Use browser automation tools (e.g., Selenium, Puppeteer, Playwright) to script multiple simulated student sessions joining lectures and enabling webcam streaming.
                *   Alternatively, coordinate manual testing with multiple testers or multiple browser profiles on different machines.
            *   **Monitoring:**
                *   Node.js service: CPU/memory usage, event loop lag, Socket.IO connection handling.
                *   Python service: CPU/memory usage, response times for Socket.IO events, number of active `EngagementProcessor` instances, processing time per frame (logged by `EngagementProcessor`).
                *   Firebase: Verify data integrity and correct pathing for all concurrent sessions.
                *   YouTube: (If `dev_mode` is off for some test users) Verify distinct videos are uploaded correctly.
            *   **Success Criteria:** No crashes, no data mixing between sessions, acceptable UI responsiveness, resource usage within reasonable limits.
        *   **Sub-task 1.2: Stress Testing:**
            *   **Goal:** Identify system bottlenecks and breaking points by pushing beyond expected peak load.
            *   **Method:** Gradually increase the number of concurrent simulated users (or frame rate/data volume per user) until performance degrades significantly or errors occur.
            *   Tools: Load testing tools like k6 (for Socket.IO, if adaptable), Artillery, or custom scripts.
            *   **Focus Areas:**
                *   Node.js Socket.IO handling (max connections, message throughput).
                *   Python service's capacity to manage `EngagementProcessor` instances and process incoming frames.
                *   Network bandwidth between services.
                *   Disk I/O in Python service for temporary video file writing.
            *   **Success Criteria:** Understand the limits, identify the first component to fail/bottleneck, and gather data for optimization.
        *   **Sub-task 1.3: Soak Testing (Endurance Testing):**
            *   **Goal:** Verify system stability and resource management (e.g., memory leaks, disk space) over an extended period under a moderate, sustained load.
            *   **Method:** Run a concurrency test scenario (e.g., 5-10 users) for several hours (e.g., 2-4 hours, or longer if feasible).
            *   **Monitoring:** Track memory usage of Node.js and Python services over time. Monitor disk space on the Python service host/container (for temp video files). Check for any gradual increase in error rates or response times.
            *   **Success Criteria:** System remains stable, resource usage plateaus, no crashes or unhandled errors.
        *   **Sub-task 1.4: Real-World Network Condition Simulation:**
            *   **Goal:** Test system behavior under suboptimal network conditions (latency, packet loss, low bandwidth).
            *   **Method:** Use browser developer tools (network throttling) for client-side simulation. For inter-service communication (Node.js to Python), tools like `tc` (traffic control) on Linux or specialized network simulators can be used if testing in a non-Docker Compose environment or between separate hosts. Within Docker Compose, this is harder to simulate precisely without custom network setups.
            *   **Focus:** Client-side UI responsiveness, frame dropping, Socket.IO reconnection logic, potential timeouts.
            *   **Success Criteria:** System degrades gracefully, recovers when network conditions improve, provides appropriate user feedback if possible.

    2.  **Performance Optimization (Based on Testing Results):**
        *   **Sub-task 2.1: Python Service - Video Frame Processing:**
            *   **Profiling:** Use Python profilers (e.g., `cProfile`, `Pyinstrument`) on the `EngagementProcessor.process_frame` method under load to identify specific bottlenecks within the detection logic (MediaPipe, FER, OpenCV functions).
            *   **Optimization Techniques:**
                *   **Frame Skipping/Downsampling:** If processing is too slow, consider processing every Nth frame or reducing frame resolution dynamically if CPU load is high. This would be a trade-off with detection granularity.
                *   **Algorithm Tuning:** Review parameters of MediaPipe models, FER, EAR/MAR thresholds for potential minor adjustments that might reduce computation without significant accuracy loss.
                *   **Efficient NumPy/OpenCV:** Ensure array operations are vectorized where possible. Avoid unnecessary data copies.
                *   **Model Loading:** Confirm models are loaded once (globally or per-processor `__init__`) and not per frame.
        *   **Sub-task 2.2: Network Communication Optimization:**
            *   **Frame Format/Compression:** If JPEG frames (sent as ArrayBuffer/bytes) are still too large and causing bandwidth issues:
                *   Client-side: Adjust JPEG quality in `canvas.toDataURL('image/jpeg', quality)`.
                *   Consider WebP format if browser support is adequate and Python can decode it efficiently (`cv2.imdecode` supports WebP if OpenCV is built with WebP support). WebP often offers better compression than JPEG.
            *   **Socket.IO Message Size:** Ensure no unnecessarily large or redundant data is sent with each frame chunk or command.
        *   **Sub-task 2.3: Node.js Relaying Efficiency:**
            *   Ensure the relaying logic in Node.js is non-blocking and efficient. Current Socket.IO emits are generally async.
            *   Monitor event loop health in Node.js under load.
        *   **Sub-task 2.4: Database Interactions (Firebase):**
            *   Ensure Firebase updates from Python are batched if many small updates occur rapidly (though current design updates on status change, which is good).
            *   Minimize data written per update.

    3.  **Enhanced Error Handling & Logging:**
        *   **Sub-task 3.1: Comprehensive Logging Across Services:**
            *   **Client-Side:** Log key events (webcam access, streaming start/stop, errors, Socket.IO events).
            *   **Node.js:** Log client connections/disconnections, relay actions, errors connecting to Python service, `dev_mode` status per session. Use a structured logging library (e.g., Winston, Pino) with log levels.
            *   **Python Service:** Log service startup, Node.js connections/disconnections, session creation/deletion (`active_sessions`), frame reception/decoding issues, `EngagementProcessor` actions (Firebase updates, video file operations, YouTube calls), and all errors/exceptions. Use Python's `logging` module with appropriate levels and formatting.
            *   **Correlation IDs:** Consider adding a unique request/session ID that can be passed from client -> Node.js -> Python to trace a single user's activity across logs.
        *   **Sub-task 3.2: Robust Error Handling Mechanisms:**
            *   **Python Service:** Ensure all external calls (Firebase, YouTube, file system) and potentially failing operations (frame decoding) are wrapped in `try...except` blocks.
            *   **Node.js to Python Link:** Implement robust reconnection logic for the `socket.io-client` in Node.js. If Python service is down, Node.js should handle this gracefully (e.g., queue requests for a short period, or inform the browser client that the engagement service is temporarily unavailable).
            *   **Client-Side:** Display user-friendly error messages for issues like webcam denial, service unavailability.
        *   **Sub-task 3.3: Health Checks (Future Enhancement Consideration):**
            *   Python Service: Implement a simple HTTP endpoint (e.g., `/health` via FastAPI) that Node.js or a monitoring system can poll to check if the service is alive and responsive.
            *   Node.js: Could expose a similar health check.

    4.  **Code Review & Refactoring:**
        *   **Sub-task 4.1: Peer Code Reviews:** Conduct reviews for all new and significantly modified code in client-side JS, Node.js, and Python service. Focus on correctness, clarity, performance, security, and adherence to the plan.
        *   **Sub-task 4.2: Refactor for Clarity and Maintainability:**
            *   Break down large functions.
            *   Improve variable and function naming.
            *   Remove dead or commented-out code.
            *   Ensure consistency in coding style.
        *   **Sub-task 4.3: Add In-Code Comments:** Document complex logic, non-obvious decisions, and public APIs/class methods.

    5.  **Developer & Operational Documentation:**
        *   **Sub-task 5.1: Update `README.md` (or create new documentation files):**
            *   **Architecture Overview:** High-level diagram (like the Mermaid diagram) and description of components and data flow.
            *   **Setup Instructions (Local Development):**
                *   Prerequisites (Node.js version, Python version, Docker, Docker Compose).
                *   Steps to set up environment variables (e.g., `.env` file structure, required Firebase/YouTube credentials).
                *   How to obtain/configure `firebase-credentials.json` and `youtube-service-account-credentials.json`.
                *   Commands to build and run the system using Docker Compose (`docker-compose up --build`).
                *   How to run services individually for isolated testing.
            *   **Service Configuration:** Document all environment variables used by Node.js and Python services (e.g., `PORT`, `PYTHON_SERVICE_URL`, `ENGAGEMENT_DEV_MODE`, `FIREBASE_DATABASE_URL`, `FIREBASE_CREDENTIALS_PATH`, `YOUTUBE_SERVICE_ACCOUNT_PATH`, `TEMP_VIDEO_DIR`).
            *   **API/Socket.IO Event Definitions:** Clearly define the events and data structures for communication between:
                *   Browser Client <-> Node.js (`/engagement-stream` namespace)
                *   Node.js <-> Python Service (`/ws` on Python service)
            *   **Deployment Guidelines (High-Level):** Notes on deploying the Docker containers, managing secrets in production, and required infrastructure (e.g., HTTPS termination).
            *   **Troubleshooting Guide:** Common issues, how to check logs, known limitations.
        *   **Sub-task 5.2: Code-Level Documentation (Docstrings):**
            *   Add/improve docstrings for Python classes and functions (e.g., `EngagementProcessor` methods).
            *   Use JSDoc or similar for key JavaScript functions/modules.

*   **Expected Outcome (Revised & More Detailed):**
    *   The integrated engagement detection system is validated for stability under concurrent load and endurance.
    *   Key performance bottlenecks are identified, and initial optimizations are implemented in Python frame processing and network communication.
    *   Logging is comprehensive across all services, facilitating easier debugging and monitoring.
    *   Error handling is robust, with graceful degradation or clear error reporting where appropriate.
    *   The codebase is reviewed, refactored for clarity, and well-commented.
    *   Comprehensive developer documentation (`README.md` or dedicated docs) is created, covering architecture, setup, configuration, API/event definitions, and basic troubleshooting.

*   **Testing Strategy (Developer & QA - Revised & More Detailed):**
    *   **Execute Formal Test Plan:** Develop and execute a test plan covering all functional requirements, user stories, edge cases (e.g., no webcam, slow network, rapid start/stop), and error conditions.
    *   **Automated Testing (Where Feasible):**
        *   **Unit Tests:** Continue to maintain and expand unit tests for individual modules/functions in Node.js and Python (especially for `EngagementProcessor` logic).
        *   **Integration Tests (Service-Level):**
            *   Node.js: Test Socket.IO client connection and message relay to a mock Python service.
            *   Python: Test Socket.IO server with a mock Node.js client sending a sequence of events.
        *   **E2E Test Automation (Consideration for future):** Fully automated E2E tests with browser automation are complex for video streaming but could be targeted for core start/stop/data-flow scenarios without deep video content validation.
    *   **Performance Monitoring Tools:** Use APM (Application Performance Monitoring) tools if available in staging/production (e.g., Datadog, New Relic, Prometheus/Grafana) to monitor resource usage, response times, and error rates. For local Docker Compose, use `docker stats`.
    *   **Manual Exploratory Testing:** Encourage testers to explore the system freely to find unexpected issues.
    *   **User Acceptance Testing (UAT):** If possible, have a small group of representative users test the feature.

*   **Common Pitfalls & Mitigation (Revised & More Detailed):**
    *   **Overlooking Edge Cases during Testing:** Focusing only on "happy path" scenarios.
        *   **Mitigation:** Brainstorm and document edge cases and error conditions explicitly in the test plan (e.g., user revokes webcam permission mid-stream, Python service crashes, YouTube API rate limits hit).
    *   **Performance Bottlenecks Underestimated:** Python video processing or Node.js relay becoming overwhelmed at lower-than-expected loads.
        *   **Mitigation:** Start performance testing early in this phase. Be prepared to iterate on optimizations. Clearly define acceptable performance targets.
    *   **Insufficient Logging for Debugging Production Issues:** Logs lacking context or crucial information.
        *   **Mitigation:** Review logs generated during testing. Add correlation IDs. Ensure log levels are configurable.
    *   **Documentation Becoming Outdated:** Plan created, but documentation not updated as implementation details change.
        *   **Mitigation:** Treat documentation as part of the definition of "done" for each task/phase. Schedule time for documentation updates.
    *   **"Works on my machine" Syndrome with Docker:** Differences between local Docker setup and a staging/production Docker environment.
        *   **Mitigation:** Keep Dockerfiles and `docker-compose.yml` as the source of truth. Minimize environment-specific configurations not handled by environment variables or secrets management. Test on a clean environment if possible.
    *   **Resource Cleanup in Long-Running Sessions or Crashes:** Ensuring `EngagementProcessor.end_session()` is always called to release files and models, even if Node.js or Python service has issues.
        *   **Mitigation:** The current design relies on Node.js to signal session end. For greater robustness against Node.js crashes, the Python service could implement a timeout for inactive sessions (if no frames received for X minutes, auto-end). This is an advanced enhancement.

## 4. Developer Checklist for Each Stage

*   **Understand Requirements:** Clearly grasp the goals of the current phase.
*   **Implement:** Write the necessary code for client, Node.js backend, and Python service.
*   **Unit Test:** Test individual functions and modules in isolation.
*   **Local Integration Test:** Test the interaction of components developed in the current phase locally (e.g., browser to Node.js, Node.js to Python service).
*   **Verify Outcomes:** Check Firebase data, YouTube uploads (if applicable), server logs, and browser console.
*   **Address Pitfalls:** Proactively consider and mitigate common issues.
*   **Commit Code:** Use version control regularly.
*   **Document:** Note any important decisions, configurations, or issues encountered.

This detailed plan should provide a solid roadmap for the integration. Remember that flexibility is key, and some adjustments might be needed as you progress through the implementation.