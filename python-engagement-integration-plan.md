
# Python Engagement Detection Integration Plan (Local Video Saving)

## 1. Introduction

This document outlines a detailed, multi-phased plan to integrate a Python-based student engagement detection script into the main web application. The primary goal is to enable real-time engagement monitoring using the student's webcam via the browser. The captured video feed will be processed by the Python script to analyze student engagement, and these engagement metrics will be stored in Firebase.

A key modification from previous considerations is that session video recordings will **not** be uploaded to YouTube. Instead, they will be **saved locally on the server** where the Python Engagement Service is running. The path to this locally saved video will then be stored in Firebase for reference.

The integration aims for minimal changes to the existing web application's core logic while ensuring a robust, performant, and scalable solution. This plan is based on the newer Python script which utilizes landmark-based emotion and pose detection.

## 2. Overall Proposed Architecture

We propose a microservices-oriented architecture using Docker containers for eventual deployment, ensuring separation of concerns and scalability:

*   **Client (Browser):** Captures webcam video, converts individual frames to JPEG format, and sends these frames via Socket.IO to the Node.js backend. It also interacts with the Node.js backend for control signals (e.g., start/stop engagement detection).
*   **Node.js Backend (`server.js`):**
    *   Receives JPEG video frames from multiple clients.
    *   Manages student sessions for engagement detection.
    *   Relays video frames and control data (student ID, lecture code, development mode status) to the Python Engagement Service via a separate Socket.IO connection.
    *   Continues to handle all existing application logic (user authentication, lecture management, etc.).
*   **Python Engagement Service:**
    *   A dedicated service built with a web framework like FastAPI and `python-socketio`, running the modified Python engagement script.
    *   Receives JPEG video frames and associated parameters from the Node.js backend.
    *   Performs engagement analysis using landmark-based detection methods.
    *   Sends derived engagement metrics directly to Firebase in real-time.
    *   Handles the recording of incoming video frames into a video file. This video file is **saved locally** on the server running this Python service.
    *   Stores the path or relevant identifier of the locally saved video in Firebase.
*   **Firebase:** Continues to be the central database for storing engagement metrics, paths to locally saved lecture videos, and other application data.

```mermaid
graph TD
    subgraph Client Browser
        A[Webcam via JS + Canvas] -->|JPEG Frames (Socket.IO)| B((Node.js Backend));
        A -->|Start/Stop Signals| B;
        B -->|Control UI| A;
    end

    subgraph Server Environment
        B -->|JPEG Frames, Params (Socket.IO)| C((Python Engagement Service));
        C -->|Engagement Metrics| D[(Firebase)];
        C -->|Local Video File Path| D;
        C -- Stores Video --> E[Local Server Storage];
        B -->|App Data| D;
    end

    A ~~~ F[User];
    F <--> A;
    B <--> G{Existing App Logic};

    style C fill:#ccf,stroke:#333,stroke-width:2px;
    style B fill:#cff,stroke:#333,stroke-width:2px;
    style E fill:#f9f,stroke:#333,stroke-width:2px;
```

## 3. Phased Implementation Plan

### Phase 0: Preparation & Python Script Refactoring ✅ COMPLETED

*   **Objective:** Transform the standalone Python engagement detection script into a modular, configurable, and headless service component. This phase focuses on parameterizing inputs, encapsulating core logic (using its existing landmark-based detections), adapting it to receive video frames instead of direct capture, implementing local video saving with configurable paths, and establishing robust dependency and configuration management.

*   **Status:** ✅ **COMPLETED** - All tasks (3-7) have been successfully implemented:
    *   ✅ Task 3: Video stream handling adapted (webcam capture removed, class-based processing)
    *   ✅ Task 4: Local video storage configured with environment variables
    *   ✅ Task 5: Dependencies properly managed in requirements.txt
    *   ✅ Task 6: Virtual environment (.venv) setup and gitignore configured
    *   ✅ Task 7: Configuration centralized using environment variables for Firebase and paths

*   **Detailed Key Tasks:**

    1.  **Parameterize Python Script for Headless Operation:**
        *   **Sub-task 1.1: Eliminate Interactive Inputs:**
            *   Locate and remove `student_id = input("Please enter your student ID: ").strip()`.
            *   Locate and remove `lecture_code = input("Please enter the lecture code: ").strip()`. These values will be passed as parameters when the processing logic is invoked by the service.
            *   Remove any `exit()` calls that follow print statements for input validation errors (e.g., "Lecture code not found. Exiting..."). Error conditions should be handled by returning appropriate values or raising exceptions within functions/methods.
        *   **Sub-task 1.2: Introduce `dev_mode` Parameter:**
            *   Add a boolean parameter `dev_mode` to the main processing logic or class that will be developed.
            *   If `dev_mode` is `True`, local video saving can be optionally skipped to speed up testing cycles. This needs to be a deliberate choice in the logic.
            *   Log a message indicating whether video saving is active or skipped based on `dev_mode`.
        *   **Sub-task 1.3: Remove UI-Dependent OpenCV Calls:**
            *   Search for and remove all instances of `cv2.imshow(...)`.
            *   Search for and remove all instances of `cv2.waitKey(...)`.
            *   Search for and remove any calls to `cv2.destroyAllWindows()`. These are not applicable in a headless server environment.

    2.  **Encapsulate Core Logic into a Reusable Structure (e.g., `EngagementProcessor` Class):**
        *   **Sub-task 2.1: Design `EngagementProcessor` Class:**
            *   This class will encapsulate the state and all processing logic for a single student's engagement session.
            *   **Detection Logic:** The class will use the provided script's existing methods for engagement analysis:
                *   Emotion detection: `detect_emotion_by_landmarks(pixel_landmarks, img_w, img_h)`.
                *   Pose detection: The landmark-based heuristic (nose position relative to face bounding box).
                *   Other detections: Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR), gaze, hand raising.
            *   **Attributes:**
                *   `student_id` (string): Identifier for the student.
                *   `lecture_code` (string): Identifier for the lecture.
                *   `dev_mode` (boolean): Flag to alter behavior, e.g., skipping video saving.
                *   `output_video_directory` (string): Base directory path on the server where recorded videos will be saved.
                *   `firebase_creds_path` (string): Path to the Firebase service account credentials JSON file.
                *   Detection models: `face_mesh_model` (instance of `mp.solutions.face_mesh.FaceMesh`), `pose_model` (instance of `mp.solutions.pose.Pose`).
                *   State variables: `yawn_counter`, `drowsy_counter`, `frame_counter`, `last_sent_status` (dictionary to store the last sent engagement status to Firebase, to avoid redundant writes), `emotion_text_cache` (or similar, if heuristic emotion detection benefits from temporal smoothing or caching).
                *   Video recording: `video_writer` (OpenCV `VideoWriter` instance), `current_video_filepath` (full path to the video file being currently recorded), `output_video_fps` (e.g., 10 or 20 FPS), `output_video_resolution` (tuple, e.g., (320, 240), determined from first frame).
            *   **Methods:**
                *   `__init__(self, student_id, lecture_code, dev_mode, firebase_creds_path, output_video_directory, output_video_fps=10)`:
                    *   Store the passed parameters (`student_id`, `lecture_code`, `dev_mode`, `firebase_creds_path`, `output_video_directory`, `output_video_fps`).
                    *   Ensure `output_video_directory` exists, creating it if necessary using `os.makedirs(output_video_directory, exist_ok=True)`.
                    *   Load and initialize `self.face_mesh_model = mp.solutions.face_mesh.FaceMesh(...)`.
                    *   Load and initialize `self.pose_model = mp.solutions.pose.Pose(...)`.
                    *   Initialize `self.last_sent_status = {}`.
                    *   Initialize `self.video_writer = None` and `self.current_video_filepath = None`.
                    *   **Note:** Firebase Admin SDK initialization (`firebase_admin.initialize_app`) should be handled globally once when the Python service starts, not per instance of `EngagementProcessor`. This `__init__` assumes it's already initialized.
                *   `start_session(self, first_frame_bgr)`:
                    *   This method is called when the first video frame for a session is received.
                    *   Input: `first_frame_bgr` (NumPy array representing the first BGR video frame).
                    *   Determine `frame_height, frame_width, _ = first_frame_bgr.shape`. Set `self.output_video_resolution = (frame_width, frame_height)`.
                    *   Generate `self.current_video_filepath` using `self.output_video_directory`, `self.student_id`, `self.lecture_code`, and a timestamp (e.g., `f"{self.output_video_directory}/{self.student_id}_{self.lecture_code}_{get_timestamp()}.mp4"`).
                    *   Initialize `self.video_writer = cv2.VideoWriter(self.current_video_filepath, cv2.VideoWriter_fourcc(*'mp4v'), self.output_video_fps, self.output_video_resolution)`.
                    *   Call `self.mark_attendance(self.student_id, self.lecture_code, "check_in_time")`.
                    *   Log that the session has started and video recording to `self.current_video_filepath` has begun.
                *   `process_frame(self, frame_bgr)`:
                    *   Input: `frame_bgr` (NumPy array, BGR video frame).
                    *   If `self.video_writer is None`, log an error or handle appropriately (e.g., call `start_session` if this is meant to be the first frame).
                    *   Increment `self.frame_counter`.
                    *   Perform all engagement detection logic using the input `frame_bgr` and class's models/state variables (EAR, MAR, emotion via `detect_emotion_by_landmarks`, pose, gaze, hand raising).
                    *   Compile the `current_status` dictionary with all detected engagement metrics.
                    *   If `current_status != self.last_sent_status`:
                        *   Call `self.send_to_firebase(self.student_id, self.lecture_code, **current_status)`.
                        *   `self.last_sent_status = current_status.copy()`.
                    *   If `self.video_writer` is active: `self.video_writer.write(frame_bgr)`.
                *   `end_session(self)`:
                    *   Call `self.mark_attendance(self.student_id, self.lecture_code, "check_out_time")`.
                    *   If `self.video_writer`:
                        *   `self.video_writer.release()`.
                        *   Log that video recording for `self.current_video_filepath` has finished.
                        *   If `not self.dev_mode` (or if dev mode doesn't skip saving) and `self.current_video_filepath` exists:
                            *   The video is already saved. Now, store its path in Firebase.
                            *   `video_path_reference = f'lectures/{self.lecture_code}/attendens/{self.student_id}/lecture_video_path'`
                            *   `db.reference(video_path_reference).set(self.current_video_filepath)`
                            *   Log that the video path has been saved to Firebase.
                        *   Else (if `self.dev_mode` implies skipping saving *and* the file was created for processing):
                            *   If `os.path.exists(self.current_video_filepath)`: `os.remove(self.current_video_filepath)`.
                            *   Log that local video saving was skipped due to dev mode and the temp file was deleted.
                    *   Release MediaPipe models: `self.face_mesh_model.close()`, `self.pose_model.close()`.
                    *   Log that the engagement session has ended.
                *   All helper functions from the script (e.g., `get_timestamp`, `get_simple_time`, `lecture_exists`, `send_to_firebase`, `mark_attendance`, `eye_aspect_ratio`, `mouth_aspect_ratio`, `get_pixel_coords`, `get_eye_ratio`, `detect_emotion_by_landmarks`, and the pose detection logic) should be refactored as methods of this class (e.g., `_get_timestamp()`) or as static/utility functions that are callable by the class methods.
        *   **Sub-task 2.2: Global Initializations (outside the class, in the service's main entry point):**
            *   Firebase Admin SDK: `firebase_admin.initialize_app(cred, {'databaseURL': ...})` should be called once when the Python service starts. The `EngagementProcessor` instances will then use the default app.
            *   Paths to credentials and video storage directory will be loaded from environment variables at service startup.

    3.  **Adapt Input Video Stream Handling:**
        *   **Sub-task 3.1: Remove Direct Webcam Capture from Original Script:**
            *   Delete `cap = cv2.VideoCapture(0)`, `cap.set(cv2.CAP_PROP_FRAME_WIDTH, ...)` and the main `while cap.isOpened(): ret, frame = cap.read()` loop structure.
            *   The `EngagementProcessor.process_frame(self, frame_bgr)` method will now be the primary entry point for new video data received from the network.
        *   **Sub-task 3.2: `video_writer` Management:**
            *   The `VideoWriter` is initialized in `EngagementProcessor.start_session()` using frame dimensions from the first received frame and a configured FPS.
            *   It's released in `EngagementProcessor.end_session()`.

    4.  **Configure Local Video Storage:**
        *   **Sub-task 4.1: Environment Variable for Video Directory:**
            *   The Python service will read an environment variable, e.g., `VIDEO_STORAGE_PATH`, to determine the root directory for saving recorded videos.
            *   Example (in the service's main setup code): `DEFAULT_VIDEO_DIR = "recorded_engagement_videos/"`
              `VIDEO_STORAGE_PATH = os.getenv("VIDEO_STORAGE_PATH", DEFAULT_VIDEO_DIR)`
            *   This `VIDEO_STORAGE_PATH` will be passed to the `EngagementProcessor` during its instantiation.
        *   **Sub-task 4.2: Directory Creation:**
            *   The `EngagementProcessor.__init__` method should ensure that the `self.output_video_directory` (derived from `VIDEO_STORAGE_PATH`) exists, creating it if it doesn't.
              `os.makedirs(self.output_video_directory, exist_ok=True)`

    5.  **Establish Robust Dependency Management:**
        *   **Sub-task 5.1: Create/Update `requirements.txt`:**
            *   From within an activated virtual environment (`venv`):
                *   Install necessary packages: `pip install opencv-python mediapipe numpy scipy firebase-admin python-socketio fastapi uvicorn[standard]`
                *   (Note: `google-api-python-client`, `google-auth`, and `fer` are **not** needed based on the new script and local saving requirement).
            *   Generate the file: `pip freeze > requirements.txt`.
            *   Review `requirements.txt` and consider pinning major versions for stable builds (e.g., `opencv-python==4.8.0.76`).

    6.  **Implement Virtual Environment (`venv`) Consistently:**
        *   **Sub-task 6.1: Setup `venv` (if not already done for the Python service):**
            *   In the Python service's root directory: `python3 -m venv .venv` (or `python -m venv .venv`).
            *   Activate: `source .venv/bin/activate` (Linux/macOS) or `.venv\Scripts\activate` (Windows).
        *   **Sub-task 6.2: Add `.venv` to `.gitignore`:**
            *   Create/update a `.gitignore` file in the Python service's root directory and add `.venv/` to it.
        *   **Sub-task 6.3: Always Develop with `venv` Activated:**
            *   All subsequent `pip install` commands and script executions during development of the Python service should be done with its `venv` active.

    7.  **Centralize Configuration for Credentials and Paths:**
        *   **Sub-task 7.1: Load Firebase Credentials Path via Environment Variable:**
            *   Modify Firebase initialization in the Python service's main entry point:
              ```python
              import firebase_admin
              from firebase_admin import credentials as firebase_credentials_module # Alias if 'credentials' is used elsewhere
              from firebase_admin import db
              import os

              FIREBASE_CREDENTIALS_PATH_ENV = os.getenv("FIREBASE_CREDENTIALS_PATH", "config/firebase-credentials.json") # Default for local dev
              DATABASE_URL_ENV = os.getenv("FIREBASE_DATABASE_URL") 

              if not DATABASE_URL_ENV:
                  print("FATAL ERROR: FIREBASE_DATABASE_URL environment variable not set. Python service cannot start.")
                  exit(1) # Or raise a critical error
              
              try:
                  cred_obj = firebase_credentials_module.Certificate(FIREBASE_CREDENTIALS_PATH_ENV)
                  firebase_admin.initialize_app(cred_obj, {'databaseURL': DATABASE_URL_ENV})
                  print("INFO: Firebase Admin SDK initialized successfully.")
              except Exception as e:
                  print(f"FATAL ERROR: Failed to initialize Firebase Admin SDK: {e}. Path: {FIREBASE_CREDENTIALS_PATH_ENV}, URL: {DATABASE_URL_ENV}")
                  exit(1) # Or raise
              ```
        *   **Sub-task 7.2: Video Storage Path from Environment Variable:**
            *   As described in Sub-task 4.1, `VIDEO_STORAGE_PATH` will be read from an environment variable.

*   **Expected Outcome for Phase 0:**
    *   A refactored Python script, primarily structured as an `EngagementProcessor` class.
    *   This class is initializable with `student_id`, `lecture_code`, `dev_mode`, Firebase credentials path, and the `output_video_directory`.
    *   The class contains methods: `__init__`, `start_session(first_frame_bgr)`, `process_frame(frame_bgr)`, and `end_session()`.
    *   All direct webcam interaction, UI display (`cv2.imshow`, `cv2.waitKey`), and user `input()` calls are removed from the core processing logic.
    *   The `end_session` method handles releasing the video writer. If not in `dev_mode` (or if `dev_mode` is configured to allow saving), it ensures the video file path is saved to Firebase. If `dev_mode` dictates, it can skip saving and delete any temporary recording.
    *   A comprehensive `requirements.txt` is generated, excluding libraries for YouTube or FER.
    *   Paths for Firebase credentials and the video storage directory are loaded from environment variables with sensible defaults for local development.
    *   The `EngagementProcessor` uses the new script's landmark-based emotion and pose detection.

*   **Testing Strategy for Phase 0 (Developer):**
    *   **Unit Tests for `EngagementProcessor` methods:**
        *   Mock Firebase interactions (e.g., using `unittest.mock.patch` to simulate `db.reference().set()`).
        *   Test `process_frame` with sample image frames (NumPy arrays loaded from files or synthetically generated). Verify internal state changes (counters, `last_sent_status`).
        *   Test `dev_mode` logic for `end_session` concerning video saving:
            *   When `dev_mode` allows saving: verify `video_writer.release()` is called, and the Firebase mock indicates an attempt to save the video path. Check that the video file is *not* deleted by `end_session`.
            *   When `dev_mode` prevents saving: verify `video_writer.release()` is called, no Firebase path update occurs, and if a video file was being written, it's deleted by `os.remove`.
        *   Test video file creation in `start_session` (mock `cv2.VideoWriter`) and ensure the filepath uses `output_video_directory`.
        *   Test directory creation logic in `__init__` for `output_video_directory`.
    *   **Local Script Execution (Simulating Service Calls):**
        *   Create a small wrapper Python script (e.g., `test_processor_local.py`) that:
            *   Sets up mock environment variables for `FIREBASE_CREDENTIALS_PATH`, `FIREBASE_DATABASE_URL`, and `VIDEO_STORAGE_PATH`.
            *   Initializes Firebase Admin SDK (if not done by the module itself when imported).
            *   Instantiates `EngagementProcessor` with test data, credential paths, and a local test video directory.
            *   Loads a sample video file using `cv2.VideoCapture("sample_test_video.mp4")`.
            *   Reads the first frame, calls `processor.start_session(first_frame)`.
            *   Loops through subsequent frames from `sample_test_video.mp4`, calling `processor.process_frame(frame)`.
            *   After processing some frames, calls `processor.end_session()`.
        *   **Verify:**
            *   Correct engagement data appears in the Firebase database (monitor the console or Firebase UI).
            *   A video file is created in the specified `VIDEO_STORAGE_PATH` / `output_video_directory` with the correct naming convention.
            *   The path to this video file is correctly updated in Firebase under the student's attendance record.
            *   If `dev_mode` is set to skip saving, verify the video file is deleted and no path is written to Firebase.
            *   No errors related to headless operation or file system access (check permissions on the video directory).
            *   Logs from the processor indicate correct operation.
    *   **Environment Variable Testing:**
        *   Run the `test_processor_local.py` script after setting actual environment variables for credential paths and video storage directory to ensure they are correctly picked up and utilized by the `EngagementProcessor`.

*   **Common Pitfalls & Mitigation for Phase 0:**
    *   **File System Permissions:** The Python process might not have write permissions for the specified `VIDEO_STORAGE_PATH`.
        *   **Mitigation:** Ensure the directory exists and has appropriate write permissions for the user running the Python service. Log permission errors clearly. For Docker (Phase 4), this involves Docker volume permissions or `RUN chmod` commands in the Dockerfile.
    *   **Firebase Initialization Issues:** Incorrect credential file path, network issues, or attempting to initialize the app multiple times.
        *   **Mitigation:** Use the `if not firebase_admin._apps:` check before `firebase_admin.initialize_app()`. Ensure the credential path environment variable is correctly set and the file is accessible. Log initialization errors clearly.
    *   **State Management within `EngagementProcessor`:** Incorrectly managed counters, `last_sent_status`, or `video_writer` state across calls.
        *   **Mitigation:** Thorough unit testing of the `EngagementProcessor` lifecycle, especially the sequence of `start_session`, multiple `process_frame` calls, and `end_session`.
    *   **Error Handling for File Operations:** `cv2.VideoWriter` failing to open, `os.remove` failing.
        *   **Mitigation:** Wrap all file system operations (`cv2.VideoWriter`, `os.remove`, `os.makedirs`) in `try-except` blocks. Log any exceptions with details. Decide on fallback behavior (e.g., if video writer fails, does processing continue without video?).
    *   **Resource Leaks:** `VideoWriter` not being released, MediaPipe models not closed.
        *   **Mitigation:** Ensure `video_writer.release()`, `face_mesh_model.close()`, and `pose_model.close()` are reliably called in `end_session()`, potentially within a `finally` block if `end_session` itself might raise exceptions before these calls.
    *   **Video Codec/Format Issues:** `mp4v` (H.264) is generally good, but ensure it's supported by the OpenCV build.
        *   **Mitigation:** Test video playback of locally saved files. If issues arise, experiment with other FourCC codes compatible with MP4.
    *   **Disk Space Management:** If many long videos are saved locally, the server can run out of disk space.
        *   **Mitigation (Long-term consideration, not for Phase 0 implementation):** Implement a cleanup strategy (e.g., cron job to delete videos older than X days, or a UI for instructors to manage/delete videos). For Phase 0, be mindful of disk usage during testing.

### Phase 1: Client-Side Video Capture & Streaming to Node.js

*   **Objective:** Implement robust client-side webcam video capture, conversion of individual frames to JPEG format, and efficient streaming of these JPEG frames to the Node.js backend using Socket.IO. This phase focuses on establishing the browser-to-Node.js data pipeline for video frames.

*   **Detailed Key Tasks:**

    1.  **Client-Side JavaScript Implementation (e.g., in a new `client/public/scripts/engagementStreaming.js` or integrated into an existing relevant JavaScript file like `lecture.js`):**
        *   **Sub-task 1.1: UI Elements for Control & Feedback (HTML in `lecture.html` or similar view):**
            *   Add a hidden ` <video id="webcamFeed" autoplay muted style="display:none;"></video> ` element. This element will act as the source for the `MediaStream` and facilitate drawing frames to a canvas. It's muted and hidden as its primary purpose isn't direct user viewing but to provide data.
            *   Add placeholder `div` or `span` elements in the UI to display status messages to the student (e.g., "Engagement monitoring: Active", "Engagement monitoring: Inactive", "Webcam access denied. Please check browser permissions."). These will be updated by JavaScript.
        *   **Sub-task 1.2: Webcam Access Logic:**
            *   Define a JavaScript module or class, for example, `EngagementStreamer`.
            *   Implement `EngagementStreamer.prototype.requestWebcamAccess = async function() { ... }`:
                *   Use `navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } } })`. Request a specific resolution (e.g., 320x240, matching the new Python script's `cap.set` values if those are desired defaults) and frame rate (e.g., 10 FPS) to manage bandwidth and processing load. Make these parameters potentially configurable if advanced settings are needed later.
                *   On success: Store the obtained `MediaStream` object (e.g., `this.mediaStream`). Attach this stream to the hidden `webcamFeed` video element: `document.getElementById('webcamFeed').srcObject = this.mediaStream;`.
                *   On error (e.g., `NotFoundError`, `NotAllowedError`, `AbortError`, `SecurityError`, `TypeError`):
                    *   Log detailed errors to the browser's developer console.
                    *   Update the UI to inform the user (e.g., display "Webcam access denied.").
                    *   Return a promise that resolves with the stream on success or rejects with an error object on failure.
        *   **Sub-task 1.3: Frame Extraction, Conversion to JPEG, and Transmission Strategy:**
            *   Within the `EngagementStreamer` class:
                *   `this.videoElement = document.getElementById('webcamFeed');`
                *   `this.canvasElement = document.createElement('canvas');`
                *   `this.canvasContext = null;` // Will be `this.canvasElement.getContext('2d')`
                *   `this.frameIntervalId = null;` // To store ID from `setInterval`
                *   `this.targetFps = 10; // Target frames per second for streaming`
                *   `this.jpegQuality = 0.7; // JPEG quality (0.0 to 1.0)`
            *   Modify/Implement `EngagementStreamer.prototype.startStreaming = async function(studentId, lectureCode) { ... }`:
                *   Set `this.studentId = studentId;` and `this.lectureCode = lectureCode;`.
                *   Establish or ensure an active Socket.IO connection (see Sub-task 1.4).
                *   Call `await this.requestWebcamAccess();`. If it fails, display an error and abort streaming.
                *   Once the `mediaStream` is attached to `this.videoElement` and video metadata is loaded (use `this.videoElement.onloadedmetadata` or wait for `this.videoElement.videoWidth > 0`):
                    *   `this.canvasElement.width = this.videoElement.videoWidth;`
                    *   `this.canvasElement.height = this.videoElement.videoHeight;`
                    *   `this.canvasContext = this.canvasElement.getContext('2d');`
                *   If `this.canvasContext` is successfully obtained:
                    *   Emit an initial event to Node.js to signal the start of a video session: `this.socket.emit('start_video_session', { studentId: this.studentId, lectureCode: this.lectureCode, frameWidth: this.canvasElement.width, frameHeight: this.canvasElement.height });`
                    *   Start sending frames at the defined FPS:
                      `this.frameIntervalId = setInterval(() => { this.captureAndSendFrame(); }, 1000 / this.targetFps);`
                    *   Update UI: "Engagement monitoring active."
            *   Implement `EngagementStreamer.prototype.captureAndSendFrame = function() { ... }`:
                *   Check if `this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA` (ensures frame is available), `this.canvasContext` exists, and the `this.socket` is connected.
                *   Draw the current video frame onto the canvas:
                  `this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);`
                *   Convert the canvas content to a JPEG Blob:
                  `this.canvasElement.toBlob((jpegBlob) => {`
                  `  if (jpegBlob && this.socket && this.socket.connected) {`
                  `    this.socket.emit('video_jpeg_frame', { studentId: this.studentId, lectureCode: this.lectureCode, frame_jpeg_blob: jpegBlob });`
                  `  }`
                  `}, 'image/jpeg', this.jpegQuality);`
            *   Modify/Implement `EngagementStreamer.prototype.stopStreaming = function() { ... }`:
                *   If `this.frameIntervalId` is set: `clearInterval(this.frameIntervalId); this.frameIntervalId = null;`.
                *   If `this.mediaStream` exists: Stop all tracks: `this.mediaStream.getTracks().forEach(track => track.stop()); this.mediaStream = null;`.
                *   If `this.socket` is connected: Emit a `stop_video_session` event: `this.socket.emit('stop_video_session', { studentId: this.studentId, lectureCode: this.lectureCode });`.
                *   Optionally disconnect the Socket.IO connection if it's dedicated to this stream and no longer needed: `this.socket.disconnect();`.
                *   Clear the `webcamFeed` video element's source: `document.getElementById('webcamFeed').srcObject = null;`.
                *   Update UI: "Engagement monitoring inactive."
        *   **Sub-task 1.4: Socket.IO Integration for Video Streaming:**
            *   Initialize a Socket.IO client instance within `EngagementStreamer` or make it globally accessible if shared.
                *   `this.socket = io('/engagement-stream', { autoConnect: false });` (Use a dedicated namespace like `/engagement-stream`. `autoConnect: false` allows connecting on demand when streaming starts).
            *   Implement connection logic within `startStreaming` (e.g., `if (!this.socket.connected) { this.socket.connect(); }`).
            *   Add listeners for `connect`, `disconnect`, and `connect_error` events on `this.socket` for robust connection management and debugging. Log these events to the console.
        *   **Sub-task 1.5: Control Logic Integration with Main Application:**
            *   An instance of `EngagementStreamer` (e.g., `const engagementStreamer = new EngagementStreamer();`) should be created and managed by the main client-side application logic (e.g., within `lecture.js`).
            *   The main application logic will call `engagementStreamer.startStreaming(currentStudentId, currentLectureCode)` or `engagementStreamer.stopStreaming()` based on:
                *   Event: Student successfully joins a lecture.
                *   Event: Instructor toggles the engagement monitoring switch on their dashboard (this signal would come from the Node.js server via a general application Socket.IO message, e.g., `engagement_status_update`).
            *   Ensure `currentStudentId` and `currentLectureCode` are reliably available in the client-side JavaScript context when these methods are called.

    2.  **Node.js Backend Modifications (in `server/server.js` or a dedicated module):**
        *   **Sub-task 2.1: Create New Socket.IO Namespace for Video Streaming:**
            *   `const engagementStreamNsp = io.of('/engagement-stream');`
            *   Attach event listeners to this namespace:
              `engagementStreamNsp.on('connection', (socket) => { ... });`
        *   **Sub-task 2.2: Handle Client Connection and Stream Lifecycle Events within the Namespace:**
            *   Inside `engagementStreamNsp.on('connection', (socket) => { ... })`:
                *   Log new client connection: `console.log(\`Client \${socket.id} connected to /engagement-stream namespace.\`);`
                *   Maintain session information associated with the socket: `let clientSessionInfo = { socketId: socket.id };`
                *   Handle `start_video_session` event from the client:
                    *   `socket.on('start_video_session', (data) => { ... });`
                    *   Extract and validate `data.studentId`, `data.lectureCode`, `data.frameWidth`, `data.frameHeight`.
                    *   Store this info: `clientSessionInfo.studentId = data.studentId; clientSessionInfo.lectureCode = data.lectureCode; ...`.
                    *   Log the event: `console.log(\`[Node.js] Received 'start_video_session' from \${socket.id} for student \${data.studentId}, lecture \${data.lectureCode}.\`);`
                    *   **Action for Phase 2:** This is the trigger to inform the Python Engagement Service to prepare for a new session for this student/lecture, passing along necessary parameters including frame dimensions.
                *   Handle `video_jpeg_frame` event from the client:
                    *   `socket.on('video_jpeg_frame', (payload) => { ... });`
                    *   The `payload` will be `{ studentId, lectureCode, frame_jpeg_blob: Blob }`. Socket.IO typically converts client-side Blobs to server-side `ArrayBuffer` objects.
                    *   `const { studentId, lectureCode, frame_jpeg_blob } = payload;`
                    *   Verify `frame_jpeg_blob instanceof ArrayBuffer`. If not, log an error.
                    *   Log receipt: `console.log(\`[Node.js] Received 'video_jpeg_frame' from \${socket.id} for \${studentId}. JPEG size: \${frame_jpeg_blob.byteLength} bytes.\`);`
                    *   **Action for Phase 2:** Relay this `frame_jpeg_blob` (which is an ArrayBuffer containing the JPEG bytes) along with `studentId` and `lectureCode` to the Python Engagement Service.
                *   Handle `stop_video_session` event from the client:
                    *   `socket.on('stop_video_session', (data) => { ... });`
                    *   Log the event: `console.log(\`[Node.js] Received 'stop_video_session' from \${socket.id} for student \${data.studentId}.\`);`
                    *   **Action for Phase 2:** Inform the Python Engagement Service to finalize and clean up the session for this student/lecture.
                *   Handle `disconnect` event (client closes tab, loses connection, etc.):
                    *   `socket.on('disconnect', (reason) => { ... });`
                    *   Log disconnection: `console.log(\`Client \${socket.id} disconnected from /engagement-stream. Reason: \${reason}.\`);`
                    *   If `clientSessionInfo.studentId` exists (meaning a session was active for this socket):
                        *   Log that an active session is being terminated due to disconnect: `console.log(\`[Node.js] Handling disconnect for active session: studentId=\${clientSessionInfo.studentId}, lectureCode=\${clientSessionInfo.lectureCode}\`);`
                        *   **Action for Phase 2:** Treat this as an implicit `stop_video_session`. Inform the Python Engagement Service to finalize the session.
                    *   Clean up any server-side state specifically associated with this `socket.id` within the `/engagement-stream` namespace.
        *   **Sub-task 2.3: Data Buffering/Queueing (Consideration for Robustness):**
            *   If the Python Engagement Service is temporarily slow or unavailable, Node.js might rapidly accumulate video frames.
            *   **Initial Approach:** Direct relay of frames as they arrive.
            *   **Future Consideration:** If direct relay causes issues under load or during Python service restarts, a small in-memory buffer or queue per student session (with a sensible size limit to prevent memory exhaustion) could be implemented in Node.js. For now, focus on direct relay and robust error handling if the Python service is unreachable.

*   **Expected Outcome for Phase 1:**
    *   A dedicated client-side JavaScript module (`EngagementStreamer` or similar) that successfully manages webcam access, captures frames, converts them to JPEGs using a canvas, and streams these JPEGs as Blobs via a dedicated Socket.IO namespace (`/engagement-stream`) to the Node.js backend.
    *   Each JPEG frame transmitted is associated with `studentId` and `lectureCode`.
    *   The client UI provides basic feedback to the user regarding webcam access and streaming status.
    *   The Node.js backend correctly handles connections on the `/engagement-stream` namespace.
    *   Node.js accurately logs the receipt of `start_video_session`, `video_jpeg_frame` (verifying the payload as an `ArrayBuffer` and logging its byte size), and `stop_video_session` events, associating them with specific client sockets and extracting `studentId`/`lectureCode`.
    *   Graceful handling of client disconnects is implemented on the server-side, triggering appropriate cleanup or session-end signals for later phases.
    *   The system is prepared for relaying this structured JPEG data to the Python Engagement Service in Phase 2.

*   **Testing Strategy for Phase 1 (Developer):**
    *   **Client-Side (`EngagementStreamer` module):**
        *   Manually test in various supported browsers (Chrome, Firefox, Edge, Safari if possible):
            *   Trigger `engagementStreamer.startStreaming()` with test `studentId` and `lectureCode`.
            *   Verify the webcam permission prompt appears. Test both "Allow" and "Block" scenarios.
            *   Check the browser's developer console for logs from `EngagementStreamer` (e.g., "Webcam access granted", "Canvas initialized", "Sending JPEG frame").
            *   Use browser developer tools (Network tab, filter by WebSocket/WS connections) to inspect Socket.IO messages being sent. Verify that `start_video_session` is sent first, followed by binary messages for `video_jpeg_frame`. Check the payload structure (e.g., using `console.log` on the client before sending to confirm it's a Blob).
            *   Trigger `engagementStreamer.stopStreaming()`. Verify that a `stop_video_session` message is sent and the webcam light turns off.
            *   Test UI feedback for different states.
    *   **Node.js Backend (Socket.IO Namespace `/engagement-stream`):**
        *   With the client-side streaming active, monitor Node.js server logs extensively.
        *   Verify connection logs for the `/engagement-stream` namespace.
        *   Confirm receipt of `start_video_session` and log the `studentId`, `lectureCode`, and frame dimensions.
        *   For `video_jpeg_frame` events, log that an `ArrayBuffer` was received and its `byteLength`. Crucially, ensure no errors are thrown during data reception.
        *   Confirm receipt of `stop_video_session` and log associated data.
        *   Test multiple client connections simultaneously (e.g., open multiple browser tabs for the lecture page) to ensure `socket.id` and `clientSessionInfo` correctly isolate individual student sessions on the Node.js side.
        *   Test client disconnects (e.g., by closing a browser tab abruptly) and verify that the server-side `disconnect` event fires and logs appropriately.
    *   **Cross-Browser Compatibility:** Specifically test `navigator.mediaDevices.getUserMedia` and `canvas.toBlob('image/jpeg')` behavior, as support and performance nuances can exist.
    *   **Bandwidth/Latency Simulation:** Use browser developer tools (Network throttling feature) to simulate poor network conditions (e.g., "Slow 3G"). Observe if frames are still sent/received, how delays impact the flow, and if Socket.IO handles reconnections gracefully. This helps anticipate real-world usability issues.

*   **Common Pitfalls & Mitigation for Phase 1:**
    *   **HTTPS Requirement for `getUserMedia`:** Most modern browsers require a secure context (HTTPS) for webcam access, except for `localhost` and `file:///` origins.
        *   **Mitigation:** Develop locally using `http://localhost`. Ensure that any staging or production deployment environments are configured with HTTPS. Provide clear error messages to the user if the context is insecure and webcam access fails.
    *   **`canvas.toBlob` Quality and Performance:** The JPEG quality parameter (0.0 to 1.0) in `canvas.toBlob(callback, 'image/jpeg', quality)` is a trade-off between image fidelity/size and encoding performance. Lower quality means smaller blobs and faster encoding but poorer image.
        *   **Mitigation:** Experiment with the quality setting (e.g., 0.5 to 0.8) to find a good balance. Profile client-side performance if frame dropping occurs due to slow `toBlob` calls, especially on lower-end devices.
    *   **Socket.IO Binary Data Transmission:** Ensure that the Blob sent from the client is correctly received as an ArrayBuffer on the Node.js server. Socket.IO is designed to handle this, but verification is key.
        *   **Mitigation:** Explicitly check `payload.frame_jpeg_blob instanceof ArrayBuffer` on the Node.js server side within the `video_jpeg_frame` event handler. Log types if unexpected data is received.
    *   **Client-Side Resource Management:** Failure to stop `MediaStream` tracks when streaming ends can leave the webcam active and drain battery. `setInterval` must be cleared.
        *   **Mitigation:** Ensure `this.mediaStream.getTracks().forEach(track => track.stop());` is called reliably in `stopStreaming()`. Also, clear the interval using `clearInterval(this.frameIntervalId);`. Consider adding event listeners for `beforeunload` or page visibility changes to attempt cleanup if the user navigates away abruptly, though this can be unreliable.
    *   **Server-Side State per Socket:** Storing `clientSessionInfo` (studentId, lectureCode, etc.) tied to a specific socket connection is vital for associating incoming frames with the correct session. This state must be cleaned up on socket disconnect to prevent memory leaks.
        *   **Mitigation:** Use a JavaScript `Map` or an object on the Node.js server to store session information, keyed by `socket.id`. Delete the entry for a `socket.id` when its `disconnect` event is handled.
    *   **Error Handling Chain:** Errors on the client (webcam access denial, canvas errors) should be handled gracefully, update the UI, and not crash the client-side script. Errors in Socket.IO communication (e.g., server unavailable) should also be handled and logged.
        *   **Mitigation:** Implement comprehensive `try...catch` blocks in async functions on the client. Utilize Socket.IO's built-in error event listeners (`connect_error`, `error`) on both client and server.
    *   **Frame Rate Consistency:** `setInterval` does not guarantee exact timing, especially if the `captureAndSendFrame` function takes a variable amount of time or the browser is under heavy load.
        *   **Mitigation:** While `setInterval` is generally acceptable for this use case, for more precise frame timing (if it becomes an issue), `requestAnimationFrame` combined with manual time checking could be an alternative, though more complex to implement for a fixed FPS target. For now, `setInterval` is a practical starting point.



### Phase 2: Setting up the Python Engagement Service

*   **Objective:** Develop a standalone Python service that acts as a Socket.IO server. This service will listen for commands and JPEG video data (as byte streams) from the Node.js backend. It will use the `EngagementProcessor` class (refactored in Phase 0) to manage concurrent student engagement sessions, process the video frames for engagement analysis, update Firebase with metrics, and save recorded videos locally, finally storing their paths in Firebase.

*   **Detailed Key Tasks:**

    1.  **Python Web Framework and Socket.IO Server Setup:**
        *   **Sub-task 1.1: Choose and Implement Web Framework & ASGI Server:**
            *   **Technology Stack:** FastAPI will be used as the underlying web framework, and Uvicorn will serve as the ASGI server. `python-socketio` will be used for Socket.IO server implementation, configured to run with FastAPI/Uvicorn.
            *   **Rationale:** FastAPI offers high performance, asynchronous capabilities (crucial for handling concurrent I/O-bound operations like network requests and frame processing), and Pydantic-based data validation. Uvicorn is a lightning-fast ASGI server. `python-socketio` integrates well with ASGI frameworks.
        *   **Sub-task 1.2: Install Dependencies:**
            *   Ensure the Python virtual environment (`.venv` from Phase 0) for this service is activated.
            *   The `requirements.txt` file created in Phase 0 should already list: `fastapi`, `uvicorn[standard]`, `python-socketio`, `opencv-python`, `mediapipe`, `numpy`, `scipy`, and `firebase-admin`. Verify all are installed.
        *   **Sub-task 1.3: Basic FastAPI & Socket.IO Application Structure:**
            *   Create a dedicated directory for the Python service (e.g., `python_engagement_service/`).
            *   Inside this directory, create `main.py` for the FastAPI/Socket.IO server logic, and ensure `engagement_processor.py` (containing the `EngagementProcessor` class from Phase 0) is also present or correctly imported.
            *   **`python_engagement_service/main.py` initial structure:**
                ```python
                import socketio
                import uvicorn
                from fastapi import FastAPI
                import os
                import firebase_admin
                from firebase_admin import credentials as firebase_credentials_module
                from firebase_admin import db
                import asyncio # For running blocking IO in executor
                import numpy as np
                import cv2

                # Assuming EngagementProcessor class is in engagement_processor.py within the same directory
                from .engagement_processor import EngagementProcessor # Use relative import

                # --- Global Initializations (from Phase 0) ---
                # Load paths from environment variables with defaults for local dev
                FIREBASE_CREDENTIALS_PATH_ENV = os.getenv("FIREBASE_CREDENTIALS_PATH", "config/firebase-credentials.json")
                DATABASE_URL_ENV = os.getenv("FIREBASE_DATABASE_URL")
                VIDEO_STORAGE_PATH_ENV = os.getenv("VIDEO_STORAGE_PATH", "recorded_engagement_videos/") # Used by EngagementProcessor

                if not DATABASE_URL_ENV:
                    print("FATAL ERROR: Python Service - FIREBASE_DATABASE_URL environment variable not set. Exiting.")
                    exit(1)
                
                try:
                    # Initialize Firebase Admin SDK only if no app named '[DEFAULT]' already exists
                    if not firebase_admin._apps:
                        cred_obj = firebase_credentials_module.Certificate(FIREBASE_CREDENTIALS_PATH_ENV)
                        firebase_admin.initialize_app(cred_obj, {'databaseURL': DATABASE_URL_ENV})
                        print("INFO: Python Service - Firebase Admin SDK initialized successfully.")
                    else:
                        print("INFO: Python Service - Firebase Admin SDK already initialized.")
                except Exception as e:
                    print(f"FATAL ERROR: Python Service - Failed to initialize Firebase Admin SDK: {e}. Path: {FIREBASE_CREDENTIALS_PATH_ENV}")
                    exit(1)

                # --- Socket.IO Server Setup ---
                # async_mode='asgi' is important for FastAPI/Uvicorn integration
                # cors_allowed_origins='*' allows all origins; restrict this in production (e.g., to Node.js server's address)
                sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*') 
                
                # Wrap the Socket.IO server with an ASGI application
                # This 'sio_app' will be mounted into the FastAPI application
                sio_app = socketio.ASGIApp(sio)

                # --- FastAPI Application Setup ---
                app = FastAPI(title="Python Engagement Service")

                # Mount the Socket.IO ASGI application at a specific path (e.g., /ws)
                # This means Node.js client will connect to 'http://<python_service_host>:<port>/ws/socket.io/?EIO=4...'
                app.mount("/ws", sio_app)

                # --- Session Management ---
                # Dictionary to store active EngagementProcessor instances
                # Key: session_key (e.g., f"{student_id}_{lecture_code}")
                # Value: EngagementProcessor instance
                active_sessions = {} 

                print(f"INFO: Python Service starting. Will listen for Node.js connections on configured port.")
                # Uvicorn will be run from the command line, e.g., `uvicorn main:app --host 0.0.0.0 --port 5001`
                ```
            *   Ensure necessary configuration files (like `firebase-credentials.json`) are placed in a `config/` subdirectory or their paths are correctly managed via environment variables, especially for Docker deployment later.

    2.  **Define Socket.IO Event Handlers for Node.js Communication (within `python_engagement_service/main.py`):**
        *   These handlers will process messages received from the Node.js backend, which acts as a Socket.IO client to this Python service.
        *   **Sub-task 2.1: Handle `connect` and `disconnect` from the Node.js service instance:**
            ```python
            @sio.event
            async def connect(sid, environ):
                # 'sid' is the unique session ID for this connection from the Node.js service.
                # 'environ' contains request environment details (e.g., headers).
                print(f"INFO: Python Service - Node.js service instance connected: sid={sid}")
                # Potentially log originating IP from environ if needed for security/auditing.
                # Node.js could send an auth token or identifier if multiple Node.js instances might connect.
                # For now, assume a single, trusted Node.js backend.

            @sio.event
            async def disconnect(sid):
                print(f"INFO: Python Service - Node.js service instance disconnected: sid={sid}")
                # This disconnect is for the communication link between Node.js and this Python service.
                # It does NOT automatically clean up individual student video processing sessions.
                # If Node.js dies abruptly, student sessions might become orphaned unless Node.js explicitly
                # calls end_engagement_processing for all its active sessions before it shuts down,
                # or a timeout mechanism is implemented here for inactive sessions.
            ```
        *   **Sub-task 2.2: Handle `start_engagement_processing` Event from Node.js:**
            *   This event signals that a new student engagement session should begin.
            ```python
            @sio.on('start_engagement_processing')
            async def handle_start_engagement(sid, data):
                # 'data' is expected to be a dictionary:
                # { studentId: "...", lectureCode: "...", devMode: true/false, frameWidth: 320, frameHeight: 240 }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')
                dev_mode = data.get('devMode', True) # Default to dev_mode True if not provided
                # Frame dimensions are not strictly needed by EngagementProcessor itself for start_session anymore,
                # as it derives them from the first frame. However, they can be logged or used for pre-allocation if desired.

                if not student_id or not lecture_code:
                    error_msg = f"Missing studentId or lectureCode in start_engagement_processing from SID {sid}. Data: {data}"
                    print(f"ERROR: Python Service - {error_msg}")
                    # Optionally emit an error back to Node.js
                    await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': error_msg}, room=sid)
                    return

                session_key = f"{student_id}_{lecture_code}"
                print(f"INFO: Python Service - Received 'start_engagement_processing' for session: {session_key}, dev_mode={dev_mode} from SID {sid}.")

                if session_key in active_sessions:
                    print(f"WARN: Python Service - Session {session_key} is already active. Ending existing one before restart.")
                    existing_processor = active_sessions.pop(session_key)
                    try:
                        # Ensure cleanup of the old session (blocking call, run in executor)
                        await sio.loop.run_in_executor(None, existing_processor.end_session)
                    except Exception as e_old_end:
                        print(f"ERROR: Python Service - Error ending previous session {session_key} during restart: {e_old_end}")
                
                try:
                    # Instantiate the EngagementProcessor
                    processor = EngagementProcessor(
                        student_id=student_id,
                        lecture_code=lecture_code,
                        dev_mode=dev_mode,
                        firebase_creds_path=FIREBASE_CREDENTIALS_PATH_ENV, # Path to creds
                        output_video_directory=VIDEO_STORAGE_PATH_ENV # Base dir for videos
                        # output_video_fps can be made configurable if needed
                    )
                    active_sessions[session_key] = processor
                    print(f"INFO: Python Service - EngagementProcessor instance created and stored for {session_key}.")
                    # The processor's start_session (which inits VideoWriter) will be called upon receiving the first video frame.
                    await sio.emit('processing_started_ack', {'studentId': student_id, 'lectureCode': lecture_code, 'message': f'Session for {session_key} initialized by Python. Ready for frames.'}, room=sid)
                except Exception as e:
                    error_msg = f"Failed to create EngagementProcessor for {session_key}: {e}"
                    print(f"ERROR: Python Service - {error_msg}")
                    await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': error_msg}, room=sid)
            ```
        *   **Sub-task 2.3: Handle `video_frame_from_node` Event from Node.js:**
            *   This event will carry the actual JPEG video frame data.
            ```python
            @sio.on('video_frame_from_node')
            async def handle_video_frame(sid, data):
                # 'data' is expected to be a dictionary:
                # { studentId: "...", lectureCode: "...", frame_chunk: bytes (raw JPEG bytes from ArrayBuffer) }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')
                frame_jpeg_bytes = data.get('frame_chunk') # These are the raw JPEG bytes

                if not student_id or not lecture_code or not frame_jpeg_bytes:
                    print(f"ERROR: Python Service - Missing data in video_frame_from_node from SID {sid}. Keys: {data.keys() if isinstance(data, dict) else 'Not a dict'}")
                    return # Or emit an error

                session_key = f"{student_id}_{lecture_code}"
                processor = active_sessions.get(session_key)

                if not processor:
                    print(f"WARN: Python Service - No active session for {session_key} to process frame from SID {sid}. Frame ignored.")
                    return
                
                # For debugging high traffic, this log can be conditional or less frequent:
                # print(f"DEBUG: Python Service - Received frame for {session_key}, JPEG size: {len(frame_jpeg_bytes)} bytes from SID {sid}.")
                try:
                    # Decode JPEG bytes to an OpenCV BGR frame
                    nparr = np.frombuffer(frame_jpeg_bytes, np.uint8)
                    bgr_frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if bgr_frame is None:
                        print(f"ERROR: Python Service - Failed to decode JPEG frame for {session_key} from SID {sid}. Frame ignored. JPEG Bytes length: {len(frame_jpeg_bytes)}")
                        return

                    # If EngagementProcessor's video_writer isn't initialized, this is the first valid frame.
                    # Call start_session to initialize VideoWriter and other first-frame tasks.
                    if processor.video_writer is None: # Check if video_writer is not yet initialized
                        print(f"INFO: Python Service - First valid frame received for {session_key}, calling processor.start_session().")
                        # processor.start_session is a blocking call (file I/O for VideoWriter init)
                        # Run it in an executor thread to avoid blocking the asyncio event loop.
                        await sio.loop.run_in_executor(None, processor.start_session, bgr_frame)
                        # A small delay might be needed if start_session has significant setup time, but usually executor is enough.
                        # await asyncio.sleep(0.01) 

                    # Offload the CPU-bound frame processing (detections, etc.) to an executor thread.
                    await sio.loop.run_in_executor(None, processor.process_frame, bgr_frame)
                    # print(f"DEBUG: Python Service - Frame for {session_key} submitted for processing.")
                    
                    # Optional: send an acknowledgement back to Node.js if acks are needed for flow control.
                    # await sio.emit('frame_processed_ack', {'studentId': student_id, 'lectureCode': lectureCode, 'status': 'submitted'}, room=sid)

                except Exception as e:
                    print(f"ERROR: Python Service - Error processing frame for {session_key} from SID {sid}: {e}")
                    # Optionally notify Node.js of this frame processing error.
                    # await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': f'Frame processing error: {str(e)}'}, room=sid)
            ```
        *   **Sub-task 2.4: Handle `end_engagement_processing` Event from Node.js:**
            *   This event signals that a student engagement session should be finalized.
            ```python
            @sio.on('end_engagement_processing')
            async def handle_end_engagement(sid, data):
                # 'data' is expected to be a dictionary:
                # { studentId: "...", lectureCode: "..." }
                student_id = data.get('studentId')
                lecture_code = data.get('lectureCode')

                if not student_id or not lecture_code:
                    error_msg = f"Missing studentId or lectureCode in end_engagement_processing from SID {sid}. Data: {data}"
                    print(f"ERROR: Python Service - {error_msg}")
                    return # Or emit error

                session_key = f"{student_id}_{lecture_code}"
                print(f"INFO: Python Service - Received 'end_engagement_processing' for session: {session_key} from SID {sid}.")
                
                processor = active_sessions.pop(session_key, None) # Atomically get and remove the processor
                
                if processor:
                    try:
                        print(f"INFO: Python Service - Calling processor.end_session() for {session_key}.")
                        # processor.end_session() involves file I/O (releasing video) and potentially Firebase updates.
                        # Run this blocking call in an executor thread.
                        await sio.loop.run_in_executor(None, processor.end_session)
                        print(f"INFO: Python Service - Session for {session_key} ended and resources released by processor.")
                        await sio.emit('processing_ended_ack', {'studentId': student_id, 'lectureCode': lecture_code, 'message': f'Session {session_key} successfully ended by Python.'}, room=sid)
                    except Exception as e:
                        error_msg = f"Error during processor.end_session() for {session_key}: {e}"
                        print(f"ERROR: Python Service - {error_msg}")
                        await sio.emit('processing_error', {'studentId': student_id, 'lectureCode': lecture_code, 'error': error_msg}, room=sid)
                else:
                    print(f"WARN: Python Service - No active session found for {session_key} to end, requested by SID {sid}.")
            ```

    3.  **Node.js Backend Modifications (in `server/server.js`) - Node.js as a Socket.IO Client to Python Service:**
        *   The Node.js backend needs to act as a client to the Python Engagement Service's Socket.IO server.
        *   **Sub-task 3.1: Implement Robust Socket.IO Client in Node.js:**
            *   Install `socket.io-client` in the Node.js project: `npm install socket.io-client`.
            *   Add logic in `server/server.js` to connect to the Python service:
            ```javascript
            // In server.js (Node.js backend)
            const ioPythonClient = require('socket.io-client');
            const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001/ws'; // Target /ws where Python's Socket.IO is mounted
            let pythonServiceSocket = null;
            let pythonConnectionInterval = null; // To manage reconnection attempts

            function connectToPythonService() {
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    console.log('[Node.js] Already connected to Python Engagement Service.');
                    return;
                }

                if (pythonConnectionInterval) clearInterval(pythonConnectionInterval); // Clear existing retry interval

                console.log(`[Node.js] Attempting to connect to Python Engagement Service at ${PYTHON_SERVICE_URL}...`);
                
                // If re-instantiating, ensure old listeners are removed to prevent memory leaks
                if (pythonServiceSocket) {
                    pythonServiceSocket.removeAllListeners();
                }

                pythonServiceSocket = ioPythonClient(PYTHON_SERVICE_URL, {
                    reconnectionAttempts: 5, // Or Infinity for continuous retries
                    reconnectionDelay: 5000, // Time between retries
                    transports: ['websocket'] // Prefer WebSocket for inter-service communication
                });

                pythonServiceSocket.on('connect', () => {
                    console.log('[Node.js] Successfully connected to Python Engagement Service.');
                    if (pythonConnectionInterval) {
                        clearInterval(pythonConnectionInterval);
                        pythonConnectionInterval = null;
                    }
                    // Potentially resend start signals for sessions that were active if Node.js restarted
                });

                pythonServiceSocket.on('disconnect', (reason) => {
                    console.warn(`[Node.js] Disconnected from Python Engagement Service. Reason: ${reason}.`);
                    // Attempt to reconnect if not already doing so
                    if (!pythonConnectionInterval && (!pythonServiceSocket || !pythonServiceSocket.connected)) {
                       pythonConnectionInterval = setInterval(connectToPythonService, 5000);
                    }
                });

                pythonServiceSocket.on('connect_error', (err) => {
                    console.error(`[Node.js] Connection error with Python Service: ${err.message}.`);
                    // Attempt to reconnect if not already doing so
                    if (!pythonConnectionInterval && (!pythonServiceSocket || !pythonServiceSocket.connected)) {
                       pythonConnectionInterval = setInterval(connectToPythonService, 5000);
                    }
                });
                
                // Listen for custom acknowledgement/error events from Python service
                pythonServiceSocket.on('processing_started_ack', (data) => console.log('[Node.js] Python service ACK: processing_started:', data));
                pythonServiceSocket.on('processing_ended_ack', (data) => console.log('[Node.js] Python service ACK: processing_ended:', data));
                pythonServiceSocket.on('processing_error', (data) => console.error('[Node.js] Python service reported an ERROR:', data));
                // pythonServiceSocket.on('frame_processed_ack', (data) => console.log('[Node.js] Python service ACK: frame_processed:', data)); // If implementing frame ACKs
            }
            connectToPythonService(); // Initial connection attempt when Node.js server starts
            ```
        *   **Sub-task 3.2: Refine Relaying Logic (within Node.js's `/engagement-stream` namespace, which handles browser client connections):**
            *   When Node.js receives `start_video_session` from a browser client:
                ```javascript
                // Inside engagementStreamNsp.on('connection', (socket) => { ... socket.on('start_video_session', (data) => { ...
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    const { studentId, lectureCode, frameWidth, frameHeight } = data; // from browser client
                    const devModeForPython = process.env.ENGAGEMENT_DEV_MODE === 'true'; // Get dev_mode from Node.js env
                    
                    console.log(`[Node.js] Relaying 'start_engagement_processing' to Python for ${studentId}, ${lectureCode}, devMode: ${devModeForPython}`);
                    pythonServiceSocket.emit('start_engagement_processing', { studentId, lectureCode, devMode: devModeForPython, frameWidth, frameHeight });
                } else {
                    console.error('[Node.js] Cannot start engagement: Python Engagement Service not connected.');
                    // Notify the specific browser client that the service is unavailable
                    socket.emit('engagement_system_error', { error: 'Engagement processing service is temporarily unavailable. Please try again later.' });
                }
                // ...
                ```
            *   When Node.js receives `video_jpeg_frame` (containing `frame_jpeg_blob` as ArrayBuffer) from a browser client:
                ```javascript
                // Inside ... socket.on('video_jpeg_frame', (payload) => { ...
                if (pythonServiceSocket && pythonServiceSocket.connected) {
                    const { studentId, lectureCode, frame_jpeg_blob } = payload; // frame_jpeg_blob is an ArrayBuffer
                    // For debugging high traffic, this log can be conditional or less frequent:
                    // console.log(`[Node.js] Relaying JPEG frame (ArrayBuffer) to Python for ${studentId}. Size: ${frame_jpeg_blob.byteLength}`);
                    pythonServiceSocket.emit('video_frame_from_node', { studentId, lectureCode, frame_chunk: frame_jpeg_blob }); // 'frame_chunk' is what Python expects
                } else {
                    // console.warn('[Node.js] Cannot relay frame: Python Engagement Service not connected. Frame dropped.');
                    // Avoid flooding logs if the Python service is down for an extended period.
                    // Consider a flag to log this warning only once per X minutes or use a counter.
                }
                // ...
                ```
            *   When Node.js receives `stop_video_session` from a browser client, or when a browser client `disconnect`s while a session was active:
                ```javascript
                // Example for explicit stop: socket.on('stop_video_session', (data) => {
                // And for implicit stop: socket.on('disconnect', (reason) => { if (clientSessionInfo.studentId) { ... } })
                // Ensure clientSessionInfo (defined in Phase 1 for Node.js) holds studentId and lectureCode
                const studentIdToStop = clientSessionInfo.studentId; // Or data.studentId for explicit stop
                const lectureCodeToStop = clientSessionInfo.lectureCode; // Or data.lectureCode

                if (pythonServiceSocket && pythonServiceSocket.connected && studentIdToStop) {
                    console.log(`[Node.js] Relaying 'end_engagement_processing' to Python for ${studentIdToStop}, ${lectureCodeToStop}`);
                    pythonServiceSocket.emit('end_engagement_processing', {
                        studentId: studentIdToStop,
                        lectureCode: lectureCodeToStop
                    });
                } else if (studentIdToStop) { // Session was active, but Python service is down
                     console.error('[Node.js] Cannot cleanly end engagement session with Python: Python Engagement Service not connected.');
                }
                // ...
                ```

*   **Expected Outcome for Phase 2:**
    *   A fully functional Python Engagement Service (`main.py` using FastAPI/Uvicorn and `python-socketio`) is running, listening for Socket.IO connections from the Node.js backend on a specific port (e.g., 5001) and path (e.g., `/ws`).
    *   The Python service correctly initializes the Firebase Admin SDK and loads necessary configurations (paths to Firebase credentials, video storage directory) from environment variables.
    *   The Python service's Socket.IO event handlers (`connect`, `disconnect`, `start_engagement_processing`, `video_frame_from_node`, `end_engagement_processing`) are implemented and functional.
    *   Upon receiving a `start_engagement_processing` event, an `EngagementProcessor` instance is created, associated with a unique `session_key` (e.g., `studentId_lectureCode`), and stored in the `active_sessions` dictionary.
    *   JPEG video frames received as raw bytes in the `frame_chunk` field of the `video_frame_from_node` event are successfully decoded into OpenCV BGR format using `cv2.imdecode`.
    *   The `EngagementProcessor.start_session()` method is correctly called with the first valid BGR frame to initialize its `VideoWriter` and other first-frame setup.
    *   Subsequent calls to `EngagementProcessor.process_frame()` are made for each valid frame, with CPU-bound processing offloaded to an executor thread to prevent blocking the `asyncio` event loop.
    *   Upon receiving an `end_engagement_processing` event, the corresponding `EngagementProcessor.end_session()` method is called (also in an executor thread), the instance is removed from `active_sessions`, the video is finalized, and its path is saved to Firebase (if not in `dev_mode` that skips saving).
    *   The Node.js backend has a robust `socket.io-client` instance that establishes and maintains a connection (with reconnection logic) to the Python Engagement Service.
    *   Node.js reliably relays commands (`start_engagement_processing`, `end_engagement_processing`) and video data (ArrayBuffers containing JPEG bytes) to the Python service.
    *   Communication between Node.js and the Python service is logged effectively, and basic error notifications or acknowledgements are exchanged (e.g., Python service confirms session start/end).
    *   Engagement metrics are updated in Firebase by the `EngagementProcessor`, and local video file paths are stored in Firebase as per the logic in `end_session`.

*   **Testing Strategy for Phase 2 (Developer):**
    *   **Python Service Standalone (`python_engagement_service/main.py`):**
        *   Set all required environment variables (`FIREBASE_CREDENTIALS_PATH`, `FIREBASE_DATABASE_URL`, `VIDEO_STORAGE_PATH`).
        *   Run the Python service: `cd python_engagement_service && uvicorn main:app --host 0.0.0.0 --port 5001 --reload` (use `--reload` for development convenience).
        *   Use a separate, dedicated Python Socket.IO client script (e.g., `test_python_service_client.py`) to simulate the Node.js backend:
            *   Connect this test client to `http://localhost:5001/ws`.
            *   Emit `start_engagement_processing` with mock `studentId`, `lectureCode`, `devMode`, and frame dimensions. Verify Python service logs, console output, and the `processing_started_ack` event from the service.
            *   Load a sample JPEG image from a file, read its raw bytes, and emit `video_frame_from_node` with these bytes as `frame_chunk`. Verify Python service logs frame receipt, successful decoding (add a temporary log in `handle_video_frame` to save the decoded `bgr_frame` as an image file for visual inspection: `cv2.imwrite("temp_decoded_frame.jpg", bgr_frame)`). Check that `EngagementProcessor.start_session` (on first frame) and `EngagementProcessor.process_frame` are called. Check Firebase for metric updates.
            *   Send a sequence of several JPEG frames.
            *   Emit `end_engagement_processing`. Verify Python service logs, `EngagementProcessor.end_session` is called, and the `processing_ended_ack` event is received. Check that a video file is saved in the configured `VIDEO_STORAGE_PATH` and its path is in Firebase (if `devMode` allows saving).
    *   **Node.js Backend (Relaying Logic - `server/server.js`):**
        *   Ensure the Python Engagement Service is running and accessible from the Node.js environment (same machine or network).
        *   Set the `PYTHON_SERVICE_URL` environment variable for the Node.js application.
        *   In Node.js, you might need to temporarily trigger the functions that emit messages to `pythonServiceSocket` (e.g., by creating a temporary test route in Express that calls these functions, or by stepping through with a debugger after a client connects).
        *   Verify logs on both Node.js (confirming message emits to Python) and the Python service (confirming message receives and correct data payload).
        *   Test the resilience of the Node.js client's connection to the Python service: stop and restart the Python service while Node.js is running to observe reconnection attempts and behavior.
    *   **Integrated Test (Browser Client -> Node.js -> Python Service):**
        *   Run all three components: the browser client (developed in Phase 1), the Node.js backend, and the Python Engagement Service.
        *   Use the browser client to initiate video streaming for a lecture.
        *    meticulously trace logs across all three services:
            *   **Browser:** `startStreaming` called, JPEG frames captured and sent via Socket.IO to Node.js.
            *   **Node.js:** Receives JPEGs from browser, relays `start_engagement_processing` command and subsequent `video_frame_from_node` events (with ArrayBuffer of JPEG bytes) to the Python service.
            *   **Python Service:** Receives commands and JPEG data from Node.js, creates `EngagementProcessor` instance, decodes frames, processes them for engagement, updates Firebase metrics.
        *   After stopping the stream from the browser (or via instructor toggle), verify that the video is saved locally by the Python service and its path is recorded in Firebase.
    *   **Frame Integrity and Decoding Test:**
        *   As part of the Python service standalone test, or the integrated test: in Python's `handle_video_frame` function, immediately after `bgr_frame = cv2.imdecode(...)`, temporarily add `cv2.imwrite(f"decoded_frames/frame_{processor.frame_counter}.jpg", bgr_frame)`. Create a `decoded_frames` directory.
        *   Compare these saved decoded frames with what you expect (e.g., original frames if you used a video file for `test_python_service_client.py`, or a general visual check if from live webcam). This ensures that the JPEG encoding on the client, transmission, and decoding in Python are working without major corruption.

*   **Common Pitfalls & Mitigation for Phase 2:**
    *   **Python Service Port/Firewall Issues:** Ensure the port the Python service (Uvicorn) listens on (e.g., 5001) is accessible from the Node.js service. If running on different machines or in different Docker networks later, firewall rules must allow this.
        *   **Mitigation:** For local development, `localhost` or `0.0.0.0` for the Python service host usually works. Confirm Node.js uses the correct address and port for `PYTHON_SERVICE_URL`.
    *   **Socket.IO Path Mismatch:** If FastAPI in Python mounts the Socket.IO app at `/ws` (i.e., `app.mount("/ws", sio_app)`), the Node.js client **must** connect to `http://<python_host>:<port>/ws`. A common mistake is forgetting the `/ws` path in the client's connection URL.
        *   **Mitigation:** Double-check connection URLs. Python `python-socketio` server typically expects connections to `.../socket.io/` under its mount point. `socket.io-client` usually handles adding `/socket.io/` automatically if the base path is correct.
    *   **Asynchronous Programming Issues in Python (`async/await`):** Forgetting `await` for `async` Socket.IO calls (e.g., `await sio.emit(...)`) or not properly running blocking (CPU-bound or synchronous I/O-bound) code like `processor.process_frame` or `processor.end_session` in an executor thread using `await sio.loop.run_in_executor(None, ...)` can block the entire `asyncio` event loop, making the service unresponsive.
        *   **Mitigation:** Diligent review of all `async` functions and any calls to potentially blocking code. Use linters that understand Python's `asyncio`. Test responsiveness under concurrent requests.
    *   **Video Frame Data Type Mismatch (Node.js to Python):** Node.js sends an `ArrayBuffer` (which originated from a client-side JPEG Blob). Python's `python-socketio` should receive this binary data as `bytes`. The `np.frombuffer(frame_jpeg_bytes, np.uint8)` function expects a bytes-like object.
        *   **Mitigation:** In Python's `handle_video_frame`, log `type(frame_jpeg_bytes)` to confirm it is indeed `bytes`. If it's something else, investigate Socket.IO configurations or data handling.
    *   **JPEG Decoding Errors (`cv2.imdecode`):** `cv2.imdecode` might return `None` if the received byte stream is corrupted, not a valid JPEG, or if OpenCV lacks necessary codecs (though JPEG is standard).
        *   **Mitigation:** Ensure the client-side JavaScript is correctly producing valid JPEG Blobs. Log the length of `frame_jpeg_bytes` in Python if `cv2.imdecode` fails, as zero-length or very short byte arrays are indicative of problems. Handle the `None` return case gracefully (e.g., log error, skip frame).
    *   **`EngagementProcessor.start_session` Timing and First Frame:** The `EngagementProcessor.start_session` method, which initializes the `cv2.VideoWriter`, needs the dimensions from the first valid frame. The logic in `handle_video_frame` to check `if processor.video_writer is None:` and then call `processor.start_session` is designed to handle this.
        *   **Mitigation:** Test this initialization sequence thoroughly. Ensure `start_session` is called exactly once per session with a valid frame. If `start_session` itself is made `async`, ensure it's `await`ed correctly.
    *   **Resource Management for `EngagementProcessor` Instances (Orphaned Sessions):** If the Node.js service crashes or disconnects abruptly without sending an `end_engagement_processing` signal for all its active student sessions, the corresponding `EngagementProcessor` instances in the Python service's `active_sessions` dictionary might become "orphaned" and never have their `end_session` method called.
        *   **Mitigation (Basic):** Rely on Node.js being robust and sending `end_engagement_processing` upon client disconnects.
        *   **Mitigation (Advanced - for future enhancement if needed):** Implement a timeout mechanism within the Python service. If an active session in `active_sessions` doesn't receive any frames for a configurable period (e.g., 2-5 minutes), the Python service could automatically trigger its `end_session` method and remove it. This adds complexity but improves robustness against Node.js failures.
    *   **Global State in Python Service (Firebase Init):** Ensure `firebase_admin.initialize_app` is truly called only once per service lifecycle. The `if not firebase_admin._apps:` check is a common pattern to achieve this.
        *   **Mitigation:** Test by restarting the Python service multiple times (if not using `--reload`) or by simulating conditions that might re-trigger the initialization block to ensure it behaves as a singleton.



### Phase 3: Full End-to-End Flow & Local Video Saving Integration

*   **Objective:** Achieve a fully operational end-to-end data pipeline, starting from browser-based webcam capture (sending JPEGs), through Node.js relay, to Python processing (using its current landmark-based detection logic). This phase culminates in Firebase metric updates and the conditional local saving of session videos on the Python service's server, with the video's path then stored in Firebase. The `dev_mode` functionality for controlling video saving will be thoroughly tested.

*   **Detailed Key Tasks:**

    1.  **Python Engagement Service (`python_engagement_service/engagement_processor.py` and `python_engagement_service/main.py`):**
        *   **Sub-task 1.1: Finalize `EngagementProcessor.end_session()` Logic for Local Video Saving:**
            *   Thoroughly review and test the `end_session` method within the `EngagementProcessor` class.
            *   Ensure `self.video_writer.release()` is called reliably, preferably within a `finally` block if other operations in `end_session` could fail before its execution, to prevent corrupted or incomplete video files.
            *   **Conditional Local Video Saving and Firebase Path Update:**
                ```python
                # Inside EngagementProcessor.end_session() method
                # ... (after self.mark_attendance(self.student_id, self.lecture_code, "check_out_time")) ...

                video_file_was_written = False
                if hasattr(self, 'video_writer') and self.video_writer is not None:
                    try:
                        self.video_writer.release() # Release the video writer
                        video_file_was_written = True
                        print(f"INFO ({self.student_id}-{self.lecture_code}): Video recording to '{self.current_video_filepath}' finished and file closed.")
                    except Exception as e_release:
                        print(f"ERROR ({self.student_id}-{self.lecture_code}): Failed to release video_writer for '{self.current_video_filepath}': {e_release}")
                        # Depending on severity, may still attempt to handle the file if it exists
                
                self.video_writer = None # Ensure it's cleared

                if video_file_was_written and hasattr(self, 'current_video_filepath') and os.path.exists(self.current_video_filepath):
                    if not self.dev_mode: # dev_mode is False means we ARE in production-like mode, so save the video
                        print(f"INFO ({self.student_id}-{self.lecture_code}): Production mode. Saving video '{self.current_video_filepath}' and updating Firebase.")
                        try:
                            video_path_reference_in_firebase = f'lectures/{self.lecture_code}/attendens/{self.student_id}/lecture_video_path'
                            db.reference(video_path_reference_in_firebase).set(self.current_video_filepath)
                            print(f"INFO ({self.student_id}-{self.lecture_code}): Local video path '{self.current_video_filepath}' saved to Firebase at '{video_path_reference_in_firebase}'.")
                        except Exception as e_firebase:
                            print(f"ERROR ({self.student_id}-{self.lecture_code}): Failed to save video path to Firebase: {e_firebase}")
                            # Consider what to do with the video file if Firebase update fails (e.g., log for manual intervention)
                    else: # dev_mode is True, so we skip permanent saving and delete the file
                        print(f"INFO ({self.student_id}-{self.lecture_code}): Dev mode enabled. Deleting recorded video file '{self.current_video_filepath}'.")
                        try:
                            os.remove(self.current_video_filepath)
                            print(f"INFO ({self.student_id}-{self.lecture_code}): Successfully deleted '{self.current_video_filepath}'.")
                        except Exception as e_remove:
                            print(f"ERROR ({self.student_id}-{self.lecture_code}): Failed to delete video file '{self.current_video_filepath}' in dev mode: {e_remove}")
                elif video_file_was_written and hasattr(self, 'current_video_filepath'):
                     print(f"WARN ({self.student_id}-{self.lecture_code}): Video file '{self.current_video_filepath}' was expected but not found on disk after release. Cannot save path or delete.")


                # Release MediaPipe models (if initialized per instance and have a close method)
                if hasattr(self.face_mesh_model, 'close'): self.face_mesh_model.close()
                if hasattr(self.pose_model, 'close'): self.pose_model.close()
                print(f"INFO ({self.student_id}-{self.lecture_code}): EngagementProcessor session cleanup complete.")
                ```
            *   Ensure `self.current_video_filepath` (generated in `start_session`) uses the `self.output_video_directory` correctly.
        *   **Sub-task 1.2: Robust Error Handling for External Calls (Firebase, File System):**
            *   Wrap all calls to `db.reference().set()` for Firebase updates (both metrics and video path) in `try...except` blocks. Log errors comprehensively.
            *   Wrap file system operations like `os.remove()` and `cv2.VideoWriter.release()` in `try...except` blocks.
        *   **Sub-task 1.3: Temporary File Paths and Video Storage Directory:**
            *   Confirm that `VIDEO_STORAGE_PATH_ENV` (from `main.py`) is correctly passed to `EngagementProcessor` as `output_video_directory`.
            *   The `output_video_directory` must be a path where the Python service has write, read, and delete permissions (especially relevant for Docker in Phase 4).

    2.  **Node.js Backend (`server/server.js`):**
        *   **Sub-task 2.1: Determine and Consistently Pass `dev_mode` Flag to Python Service:**
            *   The `dev_mode` flag (boolean) should be determined by the Node.js backend when it initiates an engagement session with the Python service.
            *   **Primary Source for `dev_mode`:** An environment variable on the Node.js server.
                ```javascript
                // In server.js, when preparing to call the Python service's 'start_engagement_processing'
                const devModeForPython = process.env.ENGAGEMENT_DEV_MODE === 'true'; 
                // This 'devModeForPython' will be part of the data object sent to Python.
                // Example:
                // pythonServiceSocket.emit('start_engagement_processing', { 
                //   studentId, 
                //   lectureCode, 
                //   devMode: devModeForPython, // Pass it here
                //   frameWidth, 
                //   frameHeight 
                // });
                ```
            *   Ensure this `devModeForPython` flag is consistently sent from Node.js to Python when a session starts.
        *   **Sub-task 2.2: Ensure All Necessary Data (`studentId`, `lectureCode`) is Relayed:**
            *   Verify that `studentId` and `lectureCode` are correctly and consistently propagated from the browser client (Phase 1), through Node.js, to the Python service for all relevant events: `start_engagement_processing`, `video_frame_from_node` (though Python gets these from `active_sessions` map), and `end_engagement_processing`.

    3.  **Client-Side Triggering Logic (e.g., in `client/public/scripts/lecture.js` or `engagementStreaming.js`):**
        *   **Sub-task 3.1: Finalize Integration with "Student Enters Lecture":**
            *   When the client-side logic confirms a student has successfully joined a lecture (e.g., after authentication, loading lecture details, and joining general Socket.IO rooms):
                *   Reliably invoke `engagementStreamer.startStreaming(currentStudentId, currentLectureCode);`.
                *   The `currentStudentId` and `currentLectureCode` must be accurately available in the client's JavaScript context at this specific point.
        *   **Sub-task 3.2: Finalize Integration with "Instructor Engagement Switch":**
            *   The client should already be listening for an event from the server (e.g., `engagement_status_update`) which is triggered by the instructor's dashboard action via Node.js.
            *   Refine the handler for this event:
                ```javascript
                // Existing client-side Socket.IO listener for instructor commands
                // Assume 'socket' is the main application Socket.IO connection, not necessarily engagementStreamer.socket
                socket.on('engagement_status_update', (data) => { 
                    const { lectureCode: eventLectureCode, isEnabled } = data;
                    // Ensure this update is relevant to the current student's lecture
                    if (window.currentLectureCode === eventLectureCode) { // Assuming currentLectureCode is globally accessible or scoped
                        if (isEnabled) {
                            console.log('Client: Instructor enabled engagement detection. Attempting to start stream...');
                            // Ensure engagementStreamer and current IDs are accessible here
                            window.engagementStreamer.startStreaming(window.currentStudentId, window.currentLectureCode);
                        } else {
                            console.log('Client: Instructor disabled engagement detection. Attempting to stop stream...');
                            window.engagementStreamer.stopStreaming();
                        }
                    }
                });
                ```
        *   **Sub-task 3.3: Enhance UI Feedback:**
            *   Provide clear visual feedback to the student (e.g., a small icon, text message: "Engagement monitoring: Active", "Error: Webcam not found", "Service unavailable").
            *   This feedback should be updated by the `engagementStreamer` methods based on success/failure of its operations (webcam access, socket connection, start/stop commands).

    4.  **End-to-End Data Flow Verification:**
        *   **Sub-task 4.1: Trace `studentId` and `lectureCode`:** Meticulously ensure these identifiers are correctly propagated through each layer (Client -> Node.js -> Python Service) and are used accurately for Firebase paths and video file naming conventions.
        *   **Sub-task 4.2: Verify Video Frame Data Path:** Confirm that video frames (JPEGs) travel as intended: Browser Canvas `toBlob('image/jpeg')` -> Sent as Blob via Socket.IO -> Node.js receives as `ArrayBuffer` -> Node.js relays `ArrayBuffer` (as `frame_chunk`) to Python Service -> Python Service receives as `bytes` -> Python Service decodes JPEG bytes to BGR frame using `cv2.imdecode`.

*   **Expected Outcome for Phase 3:**
    *   A fully functional end-to-end pipeline demonstrated:
        1.  The browser client captures webcam frames, converts them to JPEGs, and sends these JPEGs along with session info (`studentId`, `lectureCode`) to the Node.js backend via Socket.IO.
        2.  The Node.js backend correctly relays this data (including the `dev_mode` flag) to the Python Engagement Service via its separate Socket.IO connection.
        3.  The Python service's `EngagementProcessor` instances successfully process the incoming JPEG frames, performing engagement analysis using the new script's landmark-based detection logic.
        4.  Real-time engagement metrics are updated in the Firebase database.
        5.  Upon session termination (e.g., student leaves, instructor toggles off), the `EngagementProcessor.end_session()` method is executed:
            *   The video recording is finalized and saved locally on the Python service's server in the configured `VIDEO_STORAGE_PATH`.
            *   If `dev_mode` is `false` (production-like), the full path to this locally saved video file is stored in Firebase. The video file itself remains on the server.
            *   If `dev_mode` is `true`, the recorded video file is deleted from the local server, and no path is written to Firebase.
    *   The `dev_mode` setting (controlled by a Node.js environment variable) correctly dictates the video saving behavior in the Python service.
    *   Temporary video files (if any intermediate steps were used, though current plan writes directly to final MP4) and final video files are handled correctly (saved or deleted) by the Python service.
    *   Error handling is implemented at each stage of the processing and saving chain in the Python service, with informative logging.
    *   The client-side application correctly starts and stops video streaming based on both automatic lecture entry events and manual instructor toggle commands, providing appropriate UI feedback.

*   **Testing Strategy for Phase 3 (Developer):**
    *   **Full End-to-End Test Scenarios (Manual and/or Semi-Automated):**
        *   **Scenario 1: "Happy Path" (Production-like Mode - Video Saved):**
            *   Set `ENGAGEMENT_DEV_MODE=false` as an environment variable for the Node.js server.
            *   Simulate a student joining a lecture. Engagement detection should start automatically.
            *   Verify: Webcam stream starts on the client; JPEG frames are sent. Node.js logs relay to Python. Python logs frame processing and Firebase metric updates.
            *   Simulate student leaving the lecture (or instructor toggling engagement OFF).
            *   Verify: Python service finalizes the video, saves it to the configured local directory (e.g., `recorded_engagement_videos/studentX_lectureY_timestamp.mp4`). The path to this file appears in Firebase. The Python service logs should confirm this.
        *   **Scenario 2: "Happy Path" (Development Mode - Video Deleted):**
            *   Set `ENGAGEMENT_DEV_MODE=true` for the Node.js server.
            *   Repeat the student actions from Scenario 1.
            *   Verify: Webcam stream, JPEG flow, Node.js relay, Python processing, Firebase metric updates all occur as before.
            *   Upon session end, verify that the Python service logs indicate `dev_mode` is active, that it deletes the locally recorded video file, and that **no** video path is written to Firebase. Check the server's video storage directory to confirm the file is gone.
        *   **Scenario 3: Error - Python Service File System Write Failure:**
            *   Set `ENGAGEMENT_DEV_MODE=false`.
            *   Simulate a condition where the Python service cannot write to `VIDEO_STORAGE_PATH` (e.g., temporarily change directory permissions if testing locally outside Docker, or configure an invalid path).
            *   Verify: Firebase metrics should still be updated if possible. Session processing continues. When `end_session` is called, Python service logs a clear error about failing to save the video file. No video path should be written to Firebase. The system should not crash.
        *   **Scenario 4: Error - Firebase Update Failure for Video Path:**
            *   Set `ENGAGEMENT_DEV_MODE=false`.
            *   Simulate a Firebase write failure when `end_session` tries to save the video path (e.g., temporarily use invalid Firebase credentials for this specific write, or mock the Firebase `db.reference().set()` call to throw an exception).
            *   Verify: The video file IS still saved locally on the Python server. Python logs the error about failing to update Firebase with the path.
        *   **Scenario 5: Multiple Concurrent Students:**
            *   Open multiple browser windows/tabs, simulating different students joining the same or different lectures (if your app supports it).
            *   Verify: Each student's engagement session is handled independently by the Python service. Data for each student (metrics, video paths) goes to the correct, distinct Firebase paths. Video files for each session are saved with unique names. No data mixing or crosstalk.
    *   **Component-Level Verification during End-to-End Tests:**
        *   **Client-Side:** Use browser developer tools (Console, Network tab) to monitor logs, UI feedback, and Socket.IO messages being sent (confirming JPEGs).
        *   **Node.js Backend:** Monitor server logs for message relay activity, `dev_mode` determination, correct handling of student IDs and lecture codes, and communication with the Python service.
        *   **Python Engagement Service:** Monitor logs extensively. Look for session creation/deletion, frame reception counts, JPEG decoding success/failure, `EngagementProcessor` method calls, Firebase updates (both metrics and video paths), video file open/write/close operations, and deletion logic for `dev_mode`. During an active session (not in `dev_mode`), periodically check the `VIDEO_STORAGE_PATH` on the server to see the video file growing.
    *   **Data Verification:**
        *   Manually inspect the Firebase database for:
            *   Correct engagement metrics structure and values under the appropriate student/lecture paths.
            *   The `lecture_video_path` field, ensuring it contains the correct, full, absolute path to the video file on the Python server's file system (when not in `dev_mode`).
        *   Manually check the Python server's `VIDEO_STORAGE_PATH`:
            *   Verify video files are created with the expected naming convention.
            *   Open and play a sample of these recorded MP4 files to ensure they are not corrupted and contain the expected video content.
            *   Verify files are deleted if `dev_mode` is true.

*   **Common Pitfalls & Mitigation for Phase 3:**
    *   **Permissions for Video Storage Directory (Python Service):** The Python service process needs consistent write, read, and delete permissions for the `VIDEO_STORAGE_PATH`. This is critical for saving videos and for cleaning them up in `dev_mode`.
        *   **Mitigation:** During local testing, ensure the user running the Python script has these permissions. For Docker (Phase 4), this will involve setting permissions in the Dockerfile or ensuring the Docker volume mounts correctly handle permissions. Log any OS-level permission errors from Python.
    *   **Absolute vs. Relative Paths for `lecture_video_path`:** The path stored in Firebase should be meaningful for whatever system might later need to access these videos. An absolute path on the server where the Python service runs is typical if other server-side processes access it. If a web server is to serve these files, the path might need to be relative to a web root or require a mapping.
        *   **Mitigation:** For now, store the absolute path as seen by the Python service. Decide on the access strategy for these videos. If they need to be served via the web app, a new API endpoint in Node.js might be needed to retrieve them based on the stored path (potentially streaming them from the Python server's disk or a shared volume). This is outside the scope of *saving* but important for *accessing*.
    *   **Disk Space Consumption:** Saving raw video for every session can consume disk space rapidly.
        *   **Mitigation (Long-term):** This plan doesn't include automated cleanup of old videos (beyond `dev_mode` deletion). For a production system, a strategy for archiving or deleting old videos (e.g., after X days, or a UI for manual deletion by instructors) will be essential. For Phase 3, be mindful of disk space during testing.
    *   **Error Propagation and User/Admin Feedback:** If saving a video file or its path to Firebase fails, this information might be lost unless properly logged and potentially flagged.
        *   **Mitigation:** Python service must log all such errors with sufficient detail (`studentId`, `lectureCode`, `filepath`, error message). Node.js could potentially listen for specific `processing_error` events from Python related to video saving and log them or (as a future enhancement) store a status in Firebase that an admin UI could display (e.g., "Video for session XYZ: Saving Failed").
    *   **State Synchronization for `dev_mode`:** Ensure the `dev_mode` flag set by Node.js (from its environment variable) is the one that actually dictates behavior in the Python service for every session.
        *   **Mitigation:** The current plan of passing `devMode` on `start_engagement_processing` is sound. Verify in logs that Python's `EngagementProcessor` instances are created with the correct `dev_mode` value.
    *   **Inconsistent `studentId`/`lectureCode` Propagation:** Any mismatch or corruption of these IDs between the client, Node.js, and Python will lead to data being stored incorrectly (wrong Firebase path, wrong video filename).
        *   **Mitigation:** Rigorous logging and tracing of these IDs during all end-to-end tests. Standardize the data structures for messages containing these IDs.
    *   **Video File Integrity:** Ensure the saved MP4 files are playable and not corrupted.
        *   **Mitigation:** Use a standard codec (`mp4v`). Test playback of recorded files. Ensure `video_writer.release()` is always called.



### Phase 4: Dockerization & Deployment Configuration

*   **Objective:** Create reproducible, isolated, and deployable units for both the Node.js web application and the Python Engagement Service using Docker. Define their interaction, configuration management (including environment variables and credential files), and local video storage persistence using Docker Compose for local development. This phase also lays the groundwork for future production deployment strategies.

*   **Detailed Key Tasks:**

    1.  **Dockerfile for Node.js Application (e.g., create at project root `./Dockerfile.node` or in a `./node-app/Dockerfile` if your Node.js app is in a subfolder):**
        *   **Sub-task 1.1: Base Image Selection:**
            *   Choose a recent Node.js LTS (Long Term Support) version. Alpine variants are smaller but can sometimes have compatibility issues with native modules. Slim variants are a good compromise.
            *   Example: `FROM node:18-slim` (or `node:20-slim`).
        *   **Sub-task 1.2: Working Directory & Application Code Copy Strategy:**
            *   Set a working directory: `WORKDIR /usr/src/app`.
            *   **Optimized Copying:** Copy only `package.json` and `package-lock.json` first, install dependencies, then copy the rest of the application code. This leverages Docker's layer caching effectively, speeding up rebuilds if only application code changes.
            *   Create a comprehensive `.dockerignore` file in the same directory as this Dockerfile (or at the project root if the Dockerfile is there). This file should exclude: `node_modules/`, `.git/`, `.vscode/`, `.idea/`, `*.log`, `npm-debug.log*`, local environment files like `.env`, the `python_engagement_service/` directory, and any other development-specific or sensitive files/folders not needed in the final image.
        *   **Sub-task 1.3: Install Dependencies:**
            *   `COPY package.json package-lock.json* ./`
            *   Run `RUN npm ci --only=production`. `npm ci` provides faster, more reliable builds from the lock file and is recommended for CI/CD and production images. If your build process requires `devDependencies`, omit `--only=production` and consider a multi-stage build to prune them later, or ensure they are minimal.
        *   **Sub-task 1.4: Copy Application Source Code:**
            *   `COPY . .` (If Dockerfile is at the project root and `.dockerignore` is correctly configured to exclude unnecessary files).
            *   Alternatively, be more explicit: `COPY ./server ./server`, `COPY ./client ./client`, `COPY ./public ./public` (adjust based on your project structure relative to the Dockerfile's build context).
        *   **Sub-task 1.5: Expose Application Port:**
            *   `EXPOSE 3000` (Or the port number your Node.js server (e.g., Express app in `server/server.js`) is configured to listen on, often `process.env.PORT || 3000`). This documents the port the container will use.
        *   **Sub-task 1.6: Define Default Startup Command:**
            *   `CMD [ "node", "server/server.js" ]` (Adjust path to your server's entry point script).
        *   **Example `Dockerfile.node` (assuming it's at the project root):**
            ```dockerfile
            # Phase 4: Dockerfile for Node.js Application
            FROM node:18-slim

            # Set metadata labels
            LABEL maintainer="your-email@example.com"
            LABEL version="1.0"
            LABEL description="Node.js backend for engagement detection application."

            # Set the working directory inside the container
            WORKDIR /usr/src/app

            # Copy package.json and package-lock.json (if available)
            COPY package.json package-lock.json* ./

            # Install project dependencies using npm ci for reproducible builds
            # Using --only=production to avoid installing devDependencies
            RUN npm ci --only=production && npm cache clean --force

            # Copy the rest of the application code
            # Ensure .dockerignore is properly set up to exclude node_modules, .git, python_service, etc.
            COPY ./server ./server
            COPY ./client ./client 
            # Add other necessary directories like 'public' if they exist at the root
            # COPY ./public ./public 

            # Expose the port the app runs on
            EXPOSE 3000 # Default port, can be overridden by environment variable PORT

            # Define environment variables that can be built into the image (or overridden at runtime)
            ENV NODE_ENV=production
            ENV PORT=3000
            # PYTHON_SERVICE_URL will be injected by Docker Compose or runtime environment

            # Standard command to run the application
            CMD [ "node", "server/server.js" ]
            ```

    2.  **Dockerfile for Python Engagement Service (e.g., in `./python_engagement_service/Dockerfile.python`):**
        *   **Sub-task 2.1: Base Image Selection:**
            *   Choose a Python slim image corresponding to the Python version used in development (e.g., 3.9, 3.10, 3.11).
            *   Example: `FROM python:3.9-slim`.
        *   **Sub-task 2.2: Working Directory & Code Copy Strategy:**
            *   Set a working directory: `WORKDIR /opt/app`.
            *   Create a `.dockerignore` file specifically within the `./python_engagement_service/` directory. This should exclude its own `.venv/`, `__pycache__/`, `*.log`, local `config/` (if credentials are not meant to be baked in, which they shouldn't), `recorded_engagement_videos/` (if it's created locally during dev but shouldn't be in image), etc.
        *   **Sub-task 2.3: Install Python Dependencies:**
            *   Copy `requirements.txt` into the image.
            *   `COPY requirements.txt ./`
            *   Install dependencies using pip: `RUN pip install --no-cache-dir -r requirements.txt`. The `--no-cache-dir` option helps keep the image size smaller.
            *   **System Libraries for OpenCV:** `opencv-python` (especially `opencv-python-headless`) might require certain shared system libraries (e.g., for image/video processing, font rendering if any text is drawn by OpenCV internally).
                *   `RUN apt-get update && apt-get install -y --no-install-recommends libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev && rm -rf /var/lib/apt/lists/*`
                *   The exact libraries needed can vary. Test thoroughly. `libgl1-mesa-glx` is common for headless OpenCV.
        *   **Sub-task 2.4: Copy Application Code:**
            *   `COPY . .` (This copies everything from the `./python_engagement_service/` build context to `/opt/app` in the image, respecting its `.dockerignore`).
        *   **Sub-task 2.5: Create and Set Permissions for Video Storage Directory:**
            *   The directory specified by `VIDEO_STORAGE_PATH` (e.g., `/opt/app/recorded_engagement_videos`) needs to exist *inside* the container and be writable by the user running the Python Uvicorn process.
            *   `RUN mkdir -p /opt/app/recorded_engagement_videos && chmod -R 777 /opt/app/recorded_engagement_videos`
            *   Using `chmod 777` is broad; for better security, if running Uvicorn as a non-root user (see `USER` instruction below), change ownership (`chown`) to that user instead. For simplicity now, `777` ensures writability.
        *   **Sub-task 2.6: Expose Application Port:**
            *   `EXPOSE 5001` (Or the port your Python service/Uvicorn is configured to listen on).
        *   **Sub-task 2.7: Define Default Startup Command (for Uvicorn with FastAPI):**
            *   `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]` (Ensures Uvicorn binds to all network interfaces within the container, making it accessible from other containers).
        *   **Optional: Non-Root User (Better Security Practice):**
            *   `RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser`
            *   `USER appuser` (Switch to this user before the `CMD`). If using this, ensure `appuser` has ownership/write permissions to `VIDEO_STORAGE_PATH` and any other necessary directories.
        *   **Example `Dockerfile.python` (in `./python_engagement_service/`):**
            ```dockerfile
            # Phase 4: Dockerfile for Python Engagement Service
            FROM python:3.9-slim

            LABEL maintainer="your-email@example.com"
            LABEL version="1.0"
            LABEL description="Python Engagement Detection Service."

            # Set environment variables for Python
            ENV PYTHONDONTWRITEBYTECODE 1 # Prevents Python from writing .pyc files to disc
            ENV PYTHONUNBUFFERED 1     # Force stdin, stdout, stderr to be totally unbuffered

            # Set the working directory in the container
            WORKDIR /opt/app

            # Install system dependencies required by OpenCV and other libraries
            RUN apt-get update && apt-get install -y --no-install-recommends \
                libgl1-mesa-glx \
                libglib2.0-0 \
                libsm6 \
                libxext6 \
                libxrender-dev \
             && rm -rf /var/lib/apt/lists/*

            # Copy the requirements file into the container
            COPY requirements.txt ./

            # Install Python dependencies
            RUN pip install --no-cache-dir -r requirements.txt

            # Copy the rest of the application code into the container
            # Ensure .dockerignore in this directory excludes .venv, __pycache__, local config/, etc.
            COPY . .

            # Define the default path for video storage inside the container
            ENV VIDEO_STORAGE_PATH_IN_CONTAINER=/opt/app/recorded_engagement_videos

            # Create the video storage directory and ensure it's writable
            # If running as a non-root user later, ensure that user has write access.
            RUN mkdir -p $VIDEO_STORAGE_PATH_IN_CONTAINER && chmod -R 777 $VIDEO_STORAGE_PATH_IN_CONTAINER
            
            # Expose the port the app runs on
            EXPOSE 5001

            # FIREBASE_CREDENTIALS_PATH, FIREBASE_DATABASE_URL will be injected by Docker Compose or runtime env.
            # CMD will run Uvicorn, assuming main.py contains app = FastAPI()
            CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]
            ```

    3.  **`docker-compose.yml` for Local Development & Orchestration (at project root):**
        *   This file will define and configure how the Node.js and Python services run together locally.
        *   **Sub-task 3.1: Define Services:**
            *   Specify `version: '3.8'` (or a newer compatible version).
            *   Define two services: `node_app` (for the Node.js application) and `python_service` (for the Python Engagement Service).
        *   **Sub-task 3.2: Configure `node_app` Service:**
            *   `build:` section:
                *   `context: .` (If `Dockerfile.node` is at the project root).
                *   `dockerfile: Dockerfile.node`.
            *   `ports:` section:
                *   `- "3000:3000"` (Maps port 3000 on the host machine to port 3000 in the `node_app` container).
            *   `environment:` section (Key-value pairs):
                *   `NODE_ENV=development` (For local development features like more verbose logging, if any).
                *   `PORT=3000` (Port the Node.js app listens on inside its container).
                *   `PYTHON_SERVICE_URL=http://python_service:5001/ws` (Crucial: `python_service` is the hostname Docker Compose provides for the Python service container, and 5001 is its internal port. `/ws` is the Socket.IO path).
                *   `ENGAGEMENT_DEV_MODE=${ENGAGEMENT_DEV_MODE:-true}` (Uses value from `.env` file, defaults to `true`).
                *   `FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}` (Uses value from `.env` file).
                *   Any other environment variables your Node.js application requires.
            *   `volumes:` section (For live code reloading during development, map local source code into the container):
                *   `./server:/usr/src/app/server`
                *   `./client:/usr/src/app/client`
                *   `./public:/usr/src/app/public` (If you have a public assets folder)
                *   (Avoid mounting `node_modules` from the host; let the container manage its own via the `RUN npm ci` step in the Dockerfile).
            *   `depends_on:` (Optional, but can help with startup order):
                *   `- python_service` (Tells Docker Compose to attempt starting `python_service` before `node_app`. Note: Node.js app should still have internal retry logic for connecting to Python service).
        *   **Sub-task 3.3: Configure `python_service` Service:**
            *   `build:` section:
                *   `context: ./python_engagement_service` (Path to the Python service's code and its `Dockerfile.python`).
                *   `dockerfile: Dockerfile.python`.
            *   `ports:` (Optional, primarily for direct testing of Python service if needed, not strictly necessary for Node.js to connect via internal network):
                *   `- "5001:5001"`
            *   `environment:` section:
                *   `FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}` (Inherits from `.env` or host).
                *   `FIREBASE_CREDENTIALS_PATH=/opt/app/config/firebase-credentials.json` (This is the path *inside* the Python container where the credential file will be mounted).
                *   `VIDEO_STORAGE_PATH=${VIDEO_STORAGE_PATH_IN_CONTAINER}` (Uses the path defined in Python Dockerfile, e.g., `/opt/app/recorded_engagement_videos`).
            *   `volumes:` section:
                *   `./python_engagement_service:/opt/app` (Mounts Python source code for live reloading if using `uvicorn --reload`).
                *   **Credentials Mounting:**
                    *   `./config/firebase-credentials.json:/opt/app/config/firebase-credentials.json:ro` (Mounts the actual `firebase-credentials.json` file from a `./config` directory on the host into the path specified by `FIREBASE_CREDENTIALS_PATH` in the container, read-only).
                *   **Video Storage Persistence (Important):** To ensure videos saved by the Python container persist even if the container is removed and recreated, and to allow inspection from the host machine:
                    *   `./data/python_recorded_videos:/opt/app/recorded_engagement_videos` (Maps a `./data/python_recorded_videos` directory on the host to the `VIDEO_STORAGE_PATH_IN_CONTAINER` inside the Python container. Create `./data/python_recorded_videos` on your host machine).
        *   **Sub-task 3.4: Define Networks (Best Practice for Isolation and Naming):**
            *   At the top level of `docker-compose.yml`:
                ```yaml
                networks:
                  engagement_app_network:
                    driver: bridge 
                ```
            *   Then, assign both services to this network:
                ```yaml
                services:
                  node_app:
                    networks:
                      - engagement_app_network
                  python_service:
                    networks:
                      - engagement_app_network
                ```
        *   **Sub-task 3.5: `.env` File for Docker Compose (at project root, next to `docker-compose.yml`):**
            *   Create a `.env` file to store environment-specific configurations for local development.
            *   Example content:
                ```env
                # .env file for Docker Compose
                FIREBASE_DATABASE_URL=your_actual_firebase_database_url_here
                ENGAGEMENT_DEV_MODE=true # or false for testing production-like video saving
                
                # Node.js specific (if any, not already in Dockerfile)
                # SESSION_SECRET=yournodesessionsecret

                # Python service specific (if any, not already in Dockerfile or handled by volume mounts for paths)
                ```
            *   **Crucially, add `.env` to your main project's `.gitignore` file.**

        *   **Example `docker-compose.yml` (at project root):**
            ```yaml
            # Phase 4: docker-compose.yml
            version: '3.8'

            services:
              node_app:
                build:
                  context: . # Assumes Dockerfile.node is at the project root
                  dockerfile: Dockerfile.node
                ports:
                  - "3000:3000" # Expose Node.js app on host port 3000
                environment:
                  - NODE_ENV=development
                  - PORT=3000
                  - PYTHON_SERVICE_URL=http://python_service:5001/ws # Service discovery via Docker Compose network
                  - ENGAGEMENT_DEV_MODE=${ENGAGEMENT_DEV_MODE:-true} # Use from .env, default to true
                  - FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}
                volumes:
                  # Mount source code for live reload (adjust paths as per your project structure)
                  - ./server:/usr/src/app/server
                  - ./client:/usr/src/app/client
                  # - ./public:/usr/src/app/public # If you have a public assets folder
                  # Avoid mounting node_modules from host; let container handle its own build
                depends_on:
                  - python_service # Start python_service before node_app
                networks:
                  - engagement_app_network

              python_service:
                build:
                  context: ./python_engagement_service # Path to Python service's Dockerfile and code
                  dockerfile: Dockerfile.python
                ports:
                  - "5001:5001" # Expose Python service (mainly for Node.js to connect, can be useful for direct testing)
                environment:
                  - FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}
                  - FIREBASE_CREDENTIALS_PATH=/opt/app/config/firebase-credentials.json # Path inside Python container
                  # VIDEO_STORAGE_PATH is set via VIDEO_STORAGE_PATH_IN_CONTAINER in Python's Dockerfile
                volumes:
                  - ./python_engagement_service:/opt/app # Mount Python code for live reload (if uvicorn --reload)
                  # Mount actual credential files from host into the container (read-only)
                  # Ensure these files exist in a 'config' folder at the project root relative to docker-compose.yml.
                  - ./config/firebase-credentials.json:/opt/app/config/firebase-credentials.json:ro
                  # Mount a host directory to persist videos and allow inspection
                  - ./data/python_recorded_videos:/opt/app/recorded_engagement_videos 
                networks:
                  - engagement_app_network
            
            networks:
              engagement_app_network:
                driver: bridge

            # Optional: Define a top-level volume for python_recorded_videos if you prefer named volumes
            # volumes:
            #   python_videos_data:
            # Then in python_service volumes:
            #   - python_videos_data:/opt/app/recorded_engagement_videos
            ```

    4.  **Credentials Management Strategy:**
        *   **Sub-task 4.1: Local Development (Using Docker Compose):**
            *   Create a `config/` directory at the project root (i.e., same level as `docker-compose.yml`).
            *   Place your `firebase-credentials.json` file into this `config/` directory.
            *   **Crucially, add `config/` to your main project's `.gitignore` file to prevent committing credentials.**
            *   Use the Docker Compose `volumes` directive (as shown in the example `docker-compose.yml`) to mount the `firebase-credentials.json` file read-only into the Python service container at the path specified by its `FIREBASE_CREDENTIALS_PATH` environment variable.
        *   **Sub-task 4.2: Production Deployment (Strategy Outline - Not for this phase's implementation):**
            *   **NEVER** bake credential files directly into Docker images that might be pushed to a public or shared registry.
            *   For production, use your chosen deployment platform's secrets management solution (e.g., Kubernetes Secrets, AWS Secrets Manager, Google Secret Manager, Azure Key Vault, HashiCorp Vault, Docker Swarm Secrets).
            *   These secrets would then be securely mounted as files into the running containers at runtime (at the expected path, e.g., `/run/secrets/firebase_key_file`) or, for some platforms, their content injected as environment variables (though less secure for multi-line JSON files like Firebase credentials).

*   **Expected Outcome for Phase 4:**
    *   A `Dockerfile.node` that successfully builds a runnable, optimized Docker image for the Node.js web application.
    *   A `Dockerfile.python` (located within `./python_engagement_service/`) that successfully builds a runnable, optimized Docker image for the Python Engagement Service. This image includes all Python dependencies, necessary system libraries for OpenCV, and has a correctly configured video storage directory.
    *   A `docker-compose.yml` file at the project root that can:
        *   Build both the Node.js and Python service images.
        *   Start both services as interconnected containers within a shared Docker network (`engagement_app_network`).
        *   Correctly map ports for external access to the Node.js application and for inter-service communication (Node.js to Python).
        *   Inject necessary environment variables into both services (including `PYTHON_SERVICE_URL` for Node.js, `FIREBASE_DATABASE_URL`, `ENGAGEMENT_DEV_MODE`, and `FIREBASE_CREDENTIALS_PATH` for Python).
        *   Mount local source code directories into the containers for live reloading during development (if `nodemon` or `uvicorn --reload` are used).
        *   Securely mount the actual `firebase-credentials.json` file (from a local, `.gitignore`'d `config/` directory) into the Python service container for local Docker Compose runs.
        *   Persist locally recorded videos from the Python service to a directory on the host machine using a volume mount, allowing video files to survive container restarts and be accessible from the host.
    *   A `.dockerignore` file for each Docker build context (Node.js app root, Python service root) to optimize image sizes and build speeds by excluding unnecessary files.
    *   A `.env` file at the project root for Docker Compose to manage shared and environment-specific variables for local development, with this `.env` file itself being ignored by Git.

*   **Testing Strategy for Phase 4 (Developer):**
    *   **Individual Docker Image Builds:**
        *   From the project root, build the Node.js image: `docker build -f Dockerfile.node -t my-node-app-image .`
        *   From the project root, build the Python service image: `docker build -f python_engagement_service/Dockerfile.python -t my-python-service-image ./python_engagement_service`
        *   Verify both builds complete without errors. Inspect image sizes (`docker images`).
    *   **Docker Compose Local Deployment and Operation:**
        *   Ensure your `config/firebase-credentials.json` file exists locally.
        *   Ensure your `.env` file at the project root is populated with `FIREBASE_DATABASE_URL` and `ENGAGEMENT_DEV_MODE`.
        *   Create the host directory for video persistence if it doesn't exist (e.g., `mkdir -p ./data/python_recorded_videos`).
        *   Run `docker-compose up --build` from the project root. The `--build` flag forces images to be rebuilt if their Dockerfiles or contexts have changed.
        *   Carefully check the startup logs from both the `node_app` and `python_service` containers for:
            *   Successful server starts (Node.js Express, Python Uvicorn/FastAPI).
            *   Correct initialization of Firebase Admin SDK in the Python service.
            *   Log messages indicating the Python service is ready to accept connections on its Socket.IO endpoint.
            *   Log messages from Node.js indicating it's attempting to connect (and successfully connects) to the Python service using the `PYTHON_SERVICE_URL`.
    *   **Full End-to-End Functionality Testing within Docker Compose:**
        *   Access the Node.js web application via your browser at `http://localhost:3000` (or the mapped port).
        *   Perform all key end-to-end test scenarios from Phase 3 (e.g., "Happy Path" with `ENGAGEMENT_DEV_MODE=false` to test video saving, "Happy Path" with `ENGAGEMENT_DEV_MODE=true` to test video deletion, error conditions if feasible to simulate within Docker).
        *   Verify Firebase data updates correctly.
        *   Verify video files are saved to the host directory (`./data/python_recorded_videos`) when `ENGAGEMENT_DEV_MODE=false`. Check their content.
        *   Verify video files are *not* in the host directory (or are deleted from it) when `ENGAGEMENT_DEV_MODE=true`.
        *   Monitor container logs during these tests: `docker-compose logs -f node_app` and `docker-compose logs -f python_service` in separate terminal windows.
    *   **Verify Environment Variables and Mounted Files/Volumes:**
        *   Exec into the running Python service container: `docker-compose exec python_service bash` (or `sh` if bash isn't available).
            *   Inside the container, check environment variables: `printenv`. Verify `FIREBASE_DATABASE_URL`, `FIREBASE_CREDENTIALS_PATH`, `VIDEO_STORAGE_PATH_IN_CONTAINER` are set as expected.
            *   Check if the credential file is mounted correctly: `ls -l /opt/app/config/` and `cat /opt/app/config/firebase-credentials.json` (be careful with `cat` if outputting to a shared terminal).
            *   Check the video storage directory inside the container: `ls -l /opt/app/recorded_engagement_videos/`. Write a test file to it to confirm permissions.
        *   Exec into the running Node.js container: `docker-compose exec node_app bash`.
            *   Check environment variables: `printenv`. Verify `PYTHON_SERVICE_URL`, `ENGAGEMENT_DEV_MODE`, etc.
    *   **Test Live Reloading (if configured with volumes for source code):**
        *   While `docker-compose up` is running, make a small, visible change (e.g., add a `console.log` or `print` statement) in a source file for the Node.js backend (`server/server.js`) or the Python service (`python_engagement_service/main.py`).
        *   If using `nodemon` for Node.js (configured in its `package.json` start script) or `uvicorn --reload` for Python (in its `CMD`), the respective service should detect the change and restart automatically within its container. Verify this by observing the container logs.

*   **Common Pitfalls & Mitigation for Phase 4:**
    *   **`.dockerignore` Misconfiguration:** Accidentally including large, unnecessary files/folders (like `node_modules/`, `.venv/`, `.git/`, local video recordings) in the Docker image build context, leading to bloated images and slow builds.
        *   **Mitigation:** Carefully craft and test the `.dockerignore` files for both the Node.js and Python service build contexts. Use `docker history <image_name>` to inspect the layers and their sizes after a build.
    *   **File Path Issues Inside Containers:** Application code (Node.js or Python) trying to access files or directories using paths that are valid on the host machine but not inside the container, or using incorrect relative paths within the container's file system.
        *   **Mitigation:** Always use paths that are absolute within the container's file system (e.g., `/usr/src/app/...` for Node, `/opt/app/...` for Python, as defined by `WORKDIR`) or paths correctly relative to the `WORKDIR`. Environment variables (like `FIREBASE_CREDENTIALS_PATH`, `VIDEO_STORAGE_PATH_IN_CONTAINER`) should define these absolute paths within the container. Ensure mounted volumes in `docker-compose.yml` map correctly to these expected internal paths.
    *   **Container Networking (`PYTHON_SERVICE_URL`):** The Node.js app running in one container needs to reach the Python service running in another. Using `localhost` or `127.0.0.1` in `PYTHON_SERVICE_URL` from within the Node.js container will refer to the Node.js container itself, not the Python service container.
        *   **Mitigation:** Use Docker Compose service names as hostnames. If your Python service is named `python_service` in `docker-compose.yml`, then `http://python_service:5001/ws` is the correct URL for the Node.js container to use. Ensure both services are on the same Docker network (Docker Compose handles this by default if no networks are specified, or explicitly with a defined network).
    *   **Permissions for Mounted Volumes and Container Directories:**
        *   **Video Storage:** The Python service container (specifically the Uvicorn process) needs write permission to the directory mapped for video storage (`/opt/app/recorded_engagement_videos` in the example). If the host directory (`./data/python_recorded_videos`) has restrictive permissions, or if the user ID inside the container doesn't match the host's file ownership, writes can fail.
        *   **Credentials:** Mounted credential files should be readable by the Python process.
        *   **Mitigation:** For video storage, the `RUN mkdir ... && chmod ...` in Python's Dockerfile helps ensure the directory exists with open permissions *inside the container before the volume mount overlays it*. When using host volumes, Docker typically maps UIDs/GIDs. If issues persist, ensure the host directory (`./data/python_recorded_videos`) is writable by the user running `docker-compose up`, or adjust UID/GID in the container (more advanced). For credentials, mounting `:ro` (read-only) is good practice.
    *   **Forgetting to Expose Ports in Dockerfile vs. Publishing in Docker Compose:** `EXPOSE <port>` in a Dockerfile is primarily documentation and allows other containers on the same Docker network to access that port without explicit publishing. The `ports: - "host_port:container_port"` section in `docker-compose.yml` is what actually maps a port from the host machine into the container, making it accessible from outside the Docker environment (e.g., your browser).
        *   **Mitigation:** Ensure `EXPOSE` is used in Dockerfiles for clarity. Use `ports` in `docker-compose.yml` for any service that needs to be accessed from the host machine (like `node_app` on port 3000). For inter-container communication (Node to Python), `ports` mapping for the Python service is not strictly needed if only Node accesses it, but can be useful for direct debugging.
    *   **Environment Differences (Local Dev vs. Container):** Code might rely on system libraries, tools, or environment settings present on your local machine but missing in the lean Docker container environment (e.g., specific versions of build tools, graphics libraries for OpenCV if not using headless).
        *   **Mitigation:** Explicitly install all necessary system dependencies in the Dockerfiles (e.g., using `apt-get install` for Debian-based Python images). Aim for "headless" versions of libraries like OpenCV (`opencv-python-headless`) if full GUI capabilities are not needed. Test thoroughly within the Docker environment.
    *   **Credential Security in `docker-compose.yml` or Images:** Hardcoding credentials or paths to credentials that are then committed to version control. Baking credential files into images.
        *   **Mitigation:** Use environment variables for paths to credentials inside the container. Mount actual credential files using Docker Compose volumes from a `.gitignore`'d local directory for development. NEVER commit credential files. For production, use proper secrets management.
    *   **Build Context Issues (`.` vs. specific path):** The `build.context` in `docker-compose.yml` and the paths used in `COPY` instructions within Dockerfiles are critical. A common error is an incorrect context leading to "file not found" errors during `docker build`.
        *   **Mitigation:** Be explicit and clear about build contexts. For services in subdirectories (like `python_engagement_service`), set the context in `docker-compose.yml` to that subdirectory. `COPY` paths in the Dockerfile are then relative to that context.



### Phase 5: Final Testing, Optimization & Documentation

*   **Objective:** Conduct thorough end-to-end testing of the fully integrated and containerized engagement detection system to validate its stability, performance under various conditions (especially concurrent users), and resource utilization. Identify and implement optimizations, particularly for the Python processing pipeline and network communication. Enhance error handling, logging, and produce comprehensive documentation for ongoing development, maintenance, and potential future deployment.

*   **Detailed Key Tasks:**

    1.  **Comprehensive Testing Strategies (Executed within the Docker Compose Environment):**
        *   **Sub-task 1.1: Concurrency Testing:**
            *   **Goal:** Verify the system's ability to reliably handle multiple students simultaneously using the engagement detection feature without errors, data corruption, significant performance degradation, or resource exhaustion. Determine a practical concurrent user limit for the current setup.
            *   **Method:**
                *   Use browser automation tools (e.g., Selenium, Puppeteer, Playwright with JavaScript/Python) to script multiple simulated student sessions. Each script should:
                    1.  Navigate to the application.
                    2.  Log in (if applicable to access the lecture).
                    3.  Join a specific lecture.
                    4.  Initiate engagement detection (which starts webcam streaming).
                    5.  Maintain the session for a defined period (e.g., 5-10 minutes).
                    6.  Properly end the session (simulate leaving lecture or instructor toggle).
                *   Alternatively, for a smaller scale, coordinate manual testing with multiple testers using different machines/browser profiles.
                *   Start with a small number of concurrent users (e.g., 2-3) and gradually increase (e.g., 5, 10, 15, 20+ or until issues arise).
            *   **Monitoring (using `docker stats` and application logs):**
                *   **`node_app` container:** CPU utilization, memory usage, network I/O. Check Node.js logs for any errors, event loop delays (if instrumented), or Socket.IO issues.
                *   **`python_service` container:** CPU utilization (likely high during processing), memory usage (especially with multiple `EngagementProcessor` instances and video buffering), disk I/O (for video writing), network I/O. Check Python service logs for processing times per frame (if logged by `EngagementProcessor`), errors, number of active sessions.
                *   **Firebase:** Programmatically or manually verify data integrity, ensuring engagement metrics and video paths are correctly recorded and isolated for each concurrent session.
                *   **Local Video Storage (`./data/python_recorded_videos` on host):** Check that distinct video files are created for each session (when `ENGAGEMENT_DEV_MODE=false`) and are not corrupted.
            *   **Success Criteria:** The system handles the target number of concurrent users without crashes or data errors. UI responsiveness for clients remains acceptable. Resource usage (CPU, memory) on the server (Docker host) remains within reasonable, sustainable limits. Clear identification of any bottlenecks if they appear.
        *   **Sub-task 1.2: Stress Testing (Optional, but Recommended):**
            *   **Goal:** Intentionally push the system beyond its expected peak load to identify its breaking points and observe its behavior under extreme conditions.
            *   **Method:** Similar to concurrency testing, but continue increasing the load (number of users, or potentially frame rate/resolution if client-side configurable) until performance degrades significantly (e.g., very high response times, frame drops) or errors become frequent.
            *   **Focus Areas for Bottlenecks:**
                *   Python service CPU: Is `EngagementProcessor.process_frame` the bottleneck?
                *   Node.js Socket.IO: Can it handle the message throughput from many clients to Python?
                *   Network bandwidth between containers (less likely in Docker Compose local bridge network, but relevant for distributed deployments).
                *   Disk I/O in Python service if many videos are being written simultaneously.
            *   **Success Criteria:** Understanding the system's limits, identifying the first component to fail or become a bottleneck, and gathering data that could inform scaling strategies (e.g., "Python service CPU maxes out at X users, consider horizontal scaling or more aggressive optimization").
        *   **Sub-task 1.3: Soak Testing (Endurance Testing):**
            *   **Goal:** Verify the system's stability and resource management (e.g., checking for memory leaks, unreleased file handlers, growing disk space from logs/temp files) over an extended period of continuous operation under a moderate, sustained load.
            *   **Method:** Run a concurrency test scenario (e.g., 5-10 simulated users) continuously for a longer duration (e.g., 2-4 hours, or even 6-8 hours if feasible).
            *   **Monitoring:** Track CPU and memory usage of both `node_app` and `python_service` containers over the entire test duration using `docker stats` or by periodically logging `os.getloadavg()` (for CPU) and memory usage from within the Python service. Monitor the size of the video storage directory and log directories. Check for any gradual increase in error rates or API/Socket.IO response times.
            *   **Success Criteria:** The system remains stable throughout the test. Resource usage (CPU, memory) should plateau and not show a continuous upward trend (which might indicate leaks). No crashes or unhandled exceptions.
        *   **Sub-task 1.4: Real-World Network Condition Simulation (Client-Side):**
            *   **Goal:** Test the client-side application's behavior and resilience under suboptimal network conditions experienced by students (latency, jitter, packet loss, low bandwidth).
            *   **Method:** Use browser developer tools (e.g., Chrome's Network Throttling feature, Firefox's Network Monitor Throttling) to simulate various network profiles (e.g., "Slow 3G", "Fast 3G", custom high latency).
            *   **Focus:**
                *   Client-side UI responsiveness: Does the UI freeze or become unusable?
                *   Frame dropping: Does the client skip sending frames if `toBlob` or Socket.IO emit is too slow?
                *   Socket.IO reconnection logic: Does the client correctly re-establish connection to Node.js if briefly disconnected?
                *   User feedback: Does the UI provide any indication of network issues if streaming is severely impacted?
            *   **Success Criteria:** The system degrades gracefully under poor network conditions. The client should attempt to reconnect if connections drop. Data sent during good periods should still be processed. Severe issues should ideally provide some feedback to the user.

    2.  **Performance Optimization (Iterative, based on Testing Results):**
        *   **Sub-task 2.1: Python Service - Video Frame Processing (`EngagementProcessor`):**
            *   **Profiling:** If stress/concurrency tests show the Python service CPU as a bottleneck:
                *   Use Python's built-in `cProfile` and `pstats` modules, or more user-friendly profilers like `Pyinstrument` or `Scalene`, to profile the `EngagementProcessor.process_frame` method execution under load. This will show which specific function calls (MediaPipe detections, OpenCV operations, custom logic) are consuming the most CPU time.
            *   **Potential Optimization Techniques (if profiling indicates need):**
                *   **Frame Analysis Rate:** Consider processing every Nth frame instead of every frame if per-frame analysis is too slow for real-time. This is a trade-off: reduces CPU load but also reduces granularity of engagement detection. Make this configurable.
                *   **Input Resolution:** The client currently sends 320x240. If still too slow, ensure Python isn't upscaling unnecessarily. Further reduction might be possible but will impact detection accuracy.
                *   **Algorithm Parameter Tuning:** Review parameters for MediaPipe models (e.g., `min_detection_confidence`, `min_tracking_confidence`). Minor adjustments might yield performance gains, but always test impact on accuracy.
                *   **Efficient NumPy/OpenCV Usage:** Ensure array operations are vectorized where possible. Avoid unnecessary data copies or type conversions within loops.
                *   **Model Loading:** Confirm MediaPipe models are loaded once per `EngagementProcessor` instance (in `__init__`) and not reloaded per frame.
        *   **Sub-task 2.2: Network Communication Optimization:**
            *   **JPEG Quality (Client-Side):** The `jpegQuality` (currently 0.7) in `canvas.toBlob` directly impacts frame size. If network bandwidth (especially from client to Node.js, or Node.js to Python if they were on different networks) is a bottleneck:
                *   Experiment with slightly lower JPEG quality (e.g., 0.5-0.6) to reduce frame size. Measure the impact on bandwidth and the visual degradation of frames received by Python (important for detection accuracy).
            *   **Socket.IO Message Overhead:** Ensure messages are concise. Binary payloads (like JPEGs) are generally efficient with Socket.IO. Avoid sending large JSON objects with every frame if not necessary.
        *   **Sub-task 2.3: Node.js Relaying Efficiency:**
            *   The current direct relay logic in Node.js is generally efficient for I/O-bound tasks. Monitor Node.js event loop health using tools like `event-loop-lag` or Node.js internal metrics if performance issues are suspected here.
            *   Ensure no unnecessary processing or large object copying occurs in Node.js while relaying frames.
        *   **Sub-task 2.4: Database Interactions (Firebase):**
            *   The current strategy of sending Firebase updates only when `last_status` changes is good for minimizing writes.
            *   Ensure data written to Firebase is concise and only contains necessary information.
            *   For saving video paths, it's a single write per session, which is efficient.

    3.  **Enhanced Error Handling & Logging:**
        *   **Sub-task 3.1: Consistent and Structured Logging Across Services:**
            *   **Client-Side (JavaScript):** Use `console.log`, `console.warn`, `console.error` consistently. Log key events: webcam access requests/results, streaming start/stop, Socket.IO connection status changes, errors sending frames.
            *   **Node.js (`server.js`):** Implement a structured logging library (e.g., Winston, Pino, or Bunyan).
                *   Log levels (INFO, WARN, ERROR, DEBUG).
                *   Log client connections/disconnections to `/engagement-stream`.
                *   Log relay actions (start, frame, stop) to Python, including `studentId`, `lectureCode`.
                *   Log status of connection to Python service.
                *   Log `dev_mode` status per session initiated.
                *   Include timestamps and potentially request/session IDs in logs.
            *   **Python Service (`main.py`, `engagement_processor.py`):** Use Python's built-in `logging` module.
                *   Configure with a formatter for structured logs (timestamp, level, module name, message).
                *   Log service startup/shutdown, Node.js connections/disconnections.
                *   Log `EngagementProcessor` lifecycle events: session creation (with `studentId`, `lectureCode`, `dev_mode`), `start_session` called, `process_frame` called (can be very verbose, use DEBUG level or log summary stats like FPS), `end_session` called.
                *   Log Firebase updates (metrics and video path saving).
                *   Log video file operations: creation, writing, closing, deletion (in dev_mode). Include file paths.
                *   Log all errors and exceptions with tracebacks.
            *   **Correlation IDs (Advanced):** Consider generating a unique ID when a student starts an engagement session (e.g., on the client or Node.js) and passing this ID through all services (Node.js, Python) in logs. This greatly helps in tracing a single session's activity across distributed logs.
        *   **Sub-task 3.2: Robust Error Handling Mechanisms:**
            *   **Python Service:** Review all `try...except` blocks. Catch specific exceptions where possible (e.g., `firebase_admin.FirebaseError`, `cv2.error`, `IOError`). Ensure `finally` blocks are used for critical cleanup (e.g., releasing `video_writer` even if other parts of `end_session` fail).
            *   **Node.js to Python Link:** The `socket.io-client` in Node.js has reconnection logic. Ensure Node.js handles scenarios where the Python service is temporarily unavailable (e.g., logs warnings, maybe informs client if prolonged).
            *   **Client-Side:** Provide user-friendly error messages for common issues (webcam access denied, network error, engagement service unavailable).
        *   **Sub-task 3.3: Health Check Endpoints (Future Enhancement - Consider for Production Readiness):**
            *   **Python Service:** Implement a simple HTTP GET endpoint (e.g., `/health`) using FastAPI that returns a `200 OK` if the service is alive and basic checks (like Firebase connectivity, if critical) pass.
            *   **Node.js Service:** Could expose a similar `/health` endpoint.
            *   These endpoints are useful for load balancers, container orchestrators (like Kubernetes), or monitoring systems to check service health.

    4.  **Code Review & Refactoring:**
        *   **Sub-task 4.1: Peer Code Reviews:** Conduct thorough code reviews for all significant new and modified code across the client-side JavaScript, Node.js backend, and Python service. Reviewers should focus on:
            *   Correctness and adherence to the plan.
            *   Clarity, readability, and maintainability.
            *   Performance considerations and potential optimizations.
            *   Security aspects (e.g., handling of external data, permissions).
            *   Error handling completeness.
            *   Adequacy of logging.
        *   **Sub-task 4.2: Refactor for Clarity and Maintainability:**
            *   Based on review feedback and self-assessment, refactor code.
            *   Break down overly large functions or methods into smaller, more manageable units.
            *   Improve variable, function, and class naming for better self-documentation.
            *   Remove any dead, commented-out, or redundant code.
            *   Ensure consistency in coding style (use linters like ESLint for JS, Flake8/Black/Pylint for Python).
        *   **Sub-task 4.3: Add/Improve In-Code Comments and Docstrings:**
            *   Add comments to explain complex logic, non-obvious decisions, or workarounds.
            *   Write clear docstrings for Python classes, methods, and functions (e.g., using reStructuredText or Google style docstrings).
            *   Use JSDoc or similar conventions for important JavaScript functions, modules, and classes.

    5.  **Developer & Operational Documentation (`README.md` and/or Wiki):**
        *   **Sub-task 5.1: Update/Create Comprehensive `README.md` Files:**
            *   **Root Project `README.md`:**
                *   **Architecture Overview:** Include the Mermaid diagram and a high-level description of the components (Client, Node.js Backend, Python Engagement Service, Firebase, Local Server Storage) and their interactions/data flow.
                *   **Local Development Setup Instructions:**
                    *   Prerequisites: Node.js version, Python version, Docker, Docker Compose installed.
                    *   How to obtain and configure `firebase-credentials.json` (mentioning to place it in `./config/` and that this path is `.gitignore`'d).
                    *   Structure of the `.env` file (variables like `FIREBASE_DATABASE_URL`, `ENGAGEMENT_DEV_MODE`).
                    *   Step-by-step commands to build and run the entire system using `docker-compose up --build`.
                    *   How to access the application (e.g., `http://localhost:3000`).
                    *   How to view logs from Docker Compose.
                *   **Service Configuration:** Document all key environment variables used by the Node.js service (e.g., `PORT`, `PYTHON_SERVICE_URL`, `ENGAGEMENT_DEV_MODE`, `FIREBASE_DATABASE_URL`) and the Python service (e.g., `FIREBASE_CREDENTIALS_PATH`, `VIDEO_STORAGE_PATH_IN_CONTAINER`, `FIREBASE_DATABASE_URL`). Explain their purpose.
            *   **Python Service `README.md` (within `./python_engagement_service/`):**
                *   Brief overview of the service's role.
                *   Instructions for isolated local testing (if applicable, e.g., running `uvicorn main:app` directly without Docker, including setting environment variables manually).
                *   Details about its specific environment variables and configuration (especially `VIDEO_STORAGE_PATH_IN_CONTAINER` and how it relates to host volumes in Docker Compose).
                *   Description of the video file naming convention and storage location.
        *   **Sub-task 5.2: API/Socket.IO Event Definitions:**
            *   Clearly document the Socket.IO events and data structures (message payloads) for communication between:
                *   Browser Client <-> Node.js Backend (for the `/engagement-stream` namespace: `start_video_session`, `video_jpeg_frame`, `stop_video_session`, and any error/ack events).
                *   Node.js Backend <-> Python Engagement Service (for events like `start_engagement_processing`, `video_frame_from_node`, `end_engagement_processing`, and their acknowledgements/error responses).
        *   **Sub-task 5.3: Deployment Guidelines (High-Level Notes for Future):**
            *   Brief notes on considerations for deploying the Docker containers to a production environment (e.g., HTTPS termination, secrets management for Firebase credentials, persistent volume strategy for video storage, scaling options). This is not a full deployment plan but a pointer.
        *   **Sub-task 5.4: Troubleshooting Guide:**
            *   List common issues encountered during development/testing and their potential solutions or diagnostic steps.
            *   Examples: "Webcam access denied" (check HTTPS, browser permissions), "Node.js cannot connect to Python service" (check `PYTHON_SERVICE_URL`, Docker networking, Python service logs), "Videos not saving" (check `ENGAGEMENT_DEV_MODE`, Python service logs for file errors, disk permissions/space).
            *   How to check logs for each service in Docker Compose.

*   **Expected Outcome for Phase 5:**
    *   The fully integrated engagement detection system is rigorously tested and validated for stability, concurrency handling (up to a defined target), and endurance within the Docker Compose environment.
    *   Key performance characteristics are understood. Any critical performance bottlenecks identified during testing are addressed with initial optimizations (e.g., in Python frame processing, JPEG quality adjustment).
    *   Logging is comprehensive, structured, and consistent across all services, facilitating easier debugging, monitoring, and operational support.
    *   Error handling mechanisms are robust, ensuring graceful degradation or clear error reporting where appropriate, and minimizing unhandled exceptions.
    *   The codebase for all components (client, Node.js, Python) is thoroughly reviewed, refactored for clarity and maintainability, and well-commented with in-code documentation and docstrings.
    *   Comprehensive developer and operational documentation (primarily in `README.md` files) is created or updated. This documentation covers system architecture, local development setup, service configuration, API/event definitions, and basic troubleshooting steps.

*   **Testing Strategy for Phase 5 (Developer & QA/Lead):**
    *   **Execute Formal Test Plan:** Based on the testing strategies detailed in Sub-task 1 (Concurrency, Stress, Soak, Network Simulation), develop and execute a formal test plan. This plan should cover all functional requirements, user stories, important edge cases (e.g., no webcam available, very slow network, rapid start/stop sequences from instructor, empty lecture codes, invalid student IDs), and error recovery.
    *   **Automated Testing Maintenance & Expansion:**
        *   **Unit Tests:** Ensure all existing unit tests (from Phase 0 for `EngagementProcessor`, and any for Node.js/client utility functions) are passing with the latest code. Expand unit test coverage for any new logic or significant refactoring done in this phase.
        *   **Integration Tests (Service-Level, if developed):** If service-level integration tests were created (e.g., Node.js testing its Socket.IO client against a mock Python service, Python testing its Socket.IO server with a mock Node.js client), ensure these are updated and passing.
        *   **E2E Test Automation (Consideration for future, but manual for now):** While fully automated E2E tests for video streaming can be complex, for now, manual E2E testing based on the test plan is primary. Document common E2E scenarios that could be candidates for future automation.
    *   **Performance Monitoring & Analysis:**
        *   Utilize `docker stats` actively during all performance-related tests (concurrency, stress, soak) to monitor real-time CPU, memory, network, and disk I/O for each container.
        *   If more detailed APM (Application Performance Monitoring) tools are available for a staging environment (e.g., Datadog, New Relic, Prometheus/Grafana stack), consider deploying there for deeper insights after local Docker Compose validation.
        *   Analyze Python profiler outputs carefully if performance optimizations are undertaken.
    *   **Manual Exploratory Testing:** Encourage testers (and developers) to use the application in non-scripted, exploratory ways to try and uncover unexpected issues or usability problems.
    *   **User Acceptance Testing (UAT) (If Possible):** Before considering the feature "done," if feasible, have a small group of representative end-users (e.g., test instructors, students) use the engagement detection feature in a controlled setting and provide feedback.

*   **Common Pitfalls & Mitigation for Phase 5:**
    *   **Overlooking Edge Cases or "Unhappy Paths" During Testing:** Focusing too much on ideal scenarios and missing how the system behaves with unexpected inputs, disconnections, or resource constraints.
        *   **Mitigation:** Deliberately brainstorm and document edge cases and error conditions as part of the formal test plan. Assign specific tests to cover these. Examples: user revokes webcam permission mid-stream, Python service runs out of disk space, Firebase becomes temporarily unavailable, network connection between Node.js and Python is unstable.
    *   **Performance Bottlenecks Underestimated or Misidentified:** Optimizing the wrong part of the system or finding that the system doesn't scale to the desired concurrent user load.
        *   **Mitigation:** Start performance testing (concurrency, stress) early within this phase. Use profiling tools for Python. Be prepared to iterate on optimizations. Clearly define acceptable performance targets and resource utilization limits beforehand.
    *   **Insufficient or Unhelpful Logging for Debugging Production-Like Issues:** Logs lacking necessary context, timestamps, correlation IDs, or being too verbose/too sparse.
        *   **Mitigation:** Review the logs generated during all Phase 5 testing. Ask: "If this error occurred in production, would I have enough information to diagnose it?" Refine log messages, levels, and structure as needed. Implement structured logging.
    *   **Documentation Becoming Outdated or Incomplete:** The plan evolves during implementation, but the final documentation doesn't reflect all changes, configurations, or operational procedures accurately.
        *   **Mitigation:** Treat documentation as an integral part of the "definition of done" for this phase and the project. Schedule specific time for writing and reviewing documentation. Use tools that make documentation easy to update (e.g., Markdown in READMEs).
    *   **"Works on my machine" Syndrome Persisting with Docker:** Subtle differences between local Docker Compose setup (e.g., specific host OS behavior for volumes, network configurations) and a different developer's setup or a future staging/production Docker environment.
        *   **Mitigation:** Keep Dockerfiles and `docker-compose.yml` as the single source of truth for defining the services' environments. Minimize environment-specific configurations that aren't managed via environment variables or standard Docker features. Encourage testing on clean environments or by other team members if possible.
    *   **Resource Cleanup Issues in Long-Running Sessions or Abrupt Crashes:** While `EngagementProcessor.end_session()` is designed for cleanup, consider what happens if the Python service itself crashes mid-session before `end_session` can run for all active sessions (e.g., incomplete video files, resources not released by MediaPipe if not in `finally`).
        *   **Mitigation (for current scope):** Robust `try...finally` within `end_session` is key for releasing what it can. For service crashes, Docker/OS would reclaim memory/CPU, but partial video files might remain.
        *   **Mitigation (Future Enhancement):** A startup routine in the Python service could scan the video storage directory for orphaned/incomplete video files (e.g., based on naming or modification time if a session heartbeat isn't recorded) and attempt cleanup or quarantine them. This is complex and usually for more mature systems.
    *   **Scalability Concerns Not Fully Addressed:** While testing helps understand limits, true horizontal scalability (running multiple instances of Python service) requires a load balancer and potentially a shared state mechanism or distributed task queue if sessions can't be sticky.
        *   **Mitigation:** This plan focuses on a single Python service instance. Document the current architecture's limitations and note that scaling the Python service would be a significant next step requiring architectural changes (e.g., Node.js needs to distribute requests, or a message queue is needed).

## 4. Developer Checklist for Each Stage (General Reminder)

*   **Understand Requirements:** Clearly grasp the specific goals and deliverables of the current phase.
*   **Implement:** Write or modify the necessary code for client-side JavaScript, Node.js backend, and Python service as per the phase's tasks.
*   **Unit Test (where applicable):** Test individual functions, methods, and modules in isolation, especially for business logic and data transformations.
*   **Local Integration Test:** Test the interaction of components developed or modified in the current phase locally (e.g., browser to Node.js, Node.js to Python service; initially without Docker, then within Docker Compose as it's set up).
*   **Verify Outcomes:** Check Firebase data, locally saved video files (and their content/paths), server logs (Node.js, Python), and browser console outputs to ensure they match expectations.
*   **Address Pitfalls:** Proactively consider the common pitfalls listed for the phase and implement mitigations or verify existing ones.
*   **Commit Code:** Use version control (Git) regularly with clear, descriptive commit messages. Push to a feature branch.
*   **Document:** Update `README.md` files, add in-code comments/docstrings, and note any important decisions, configurations, or issues encountered during the phase. If creating diagrams, keep them updated.
*   **Review (Self and Peer):** Review your own code against requirements and best practices. Participate in peer code reviews.

This detailed plan for Phase 5 should guide the final validation and refinement of the integrated engagement detection system. Remember that testing is an iterative process, and findings may lead to adjustments in earlier phase implementations or further optimization work.
