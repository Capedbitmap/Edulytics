# Lecture Assistant - Real-time Transcription & AI Support


A web application designed to provide real-time transcription of lectures using OpenAI's Realtime API, store them in Firebase, and offer AI-powered explanations and summaries to students. Includes an instructor dashboard for managing lectures and initiating recordings.

## Features

*   **Instructor Dashboard:**
    *   Secure Instructor Login/Signup.
    *   Generate unique 6-character codes for new lectures.
    *   Manage lecture metadata (Course Code, Date, Time, Instructor Name).
    *   View list of previously created lectures.
    *   Select and activate a lecture for recording.
    *   Start/Stop real-time audio recording streamed via WebSockets.
    *   Live transcription preview during recording (requires WebSocket connection).
    *   Visual audio level indicator (cosmetic).
*   **Student Lecture View:**
    *   Access lectures using the unique 6-character code.
    *   View real-time transcriptions streamed from the server.
    *   Click on transcription bubbles to request AI assistance:
        *   Define Terms
        *   Explain in Detail
        *   Provide Real-World Examples
        *   Simplify (ELI5)
    *   Request summaries of recent lecture content (Last 1, 5, 30 minutes).
*   **Real-time Transcription:** Uses WebSockets to stream audio from the instructor's browser to the backend, which then forwards it to OpenAI's Realtime Transcription API. Transcriptions are saved to Firebase Realtime Database.
*   **AI Explanations & Summaries:** Leverages OpenAI's Chat Completions API (gpt-4o-mini) to provide contextual help based on selected transcriptions or recent content.

## Tech Stack

*   **Backend:** Node.js, Express.js
*   **Real-time Communication:** WebSockets (`ws` library on backend, native browser WebSocket API on frontend)
*   **Database:** Firebase Realtime Database (for storing lecture metadata and transcriptions)
*   **Authentication:** Simple session-based authentication for instructors (`express-session`), password hashing (`crypto`).
*   **Transcription:** OpenAI Realtime API (via WebSocket)
*   **AI Assistance:** OpenAI Chat Completions API (REST)
*   **Frontend:** HTML, CSS, Vanilla JavaScript (ES Modules patterns used in examples)
*   **Environment Management:** `dotenv`

## Project Structure

```
.
├── client/
│   └── public/             # Frontend static files (HTML, CSS, JS)
│       ├── scripts/        # Frontend JavaScript (audioRecorder.js, instructor.js, etc.)
│       ├── styles/         # (Optional) CSS files
│       ├── images/         # Static images
│       ├── index.html      # Student entry point (or landing page)
│       ├── lecture.html    # Student lecture view page
│       ├── instructor.html # Instructor dashboard page
│       ├── instructor_login.html
│       ├── instructor_signup.html
│       └── 404.html        # (Optional) Custom 404 page
├── server/
│   ├── utils/              # Utility functions (e.g., auth.js)
│   ├── server.js           # Main Express server, WebSocket handling, API routes
│   └── firebase-credentials.json # ** IMPORTANT: Add to .gitignore **
├── .env                    # Environment variables (API Keys, DB URL) ** IMPORTANT: Add to .gitignore **
├── .env.example            # Example environment file
├── .gitignore              # Git ignore file
├── package.json            # Backend Node.js dependencies
├── package-lock.json
└── README.md               # This file
```

## Setup and Installation

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (includes npm) - Version 18.x or later recommended.
*   [Git](https://git-scm.com/)
*   A Firebase Project with Realtime Database enabled.
*   An OpenAI API Key with access to the Realtime Transcription API and Chat Completions models (like gpt-4o-mini).

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd <repository-folder-name>
    ```

2.  **Install Backend Dependencies:**
    ```bash
    cd server
    npm install
    cd ..
    ```

3.  **Firebase Setup:**
    *   Go to your Firebase project settings > Service accounts.
    *   Generate a new private key and download the JSON file.
    *   **Rename** the downloaded file to `firebase-credentials.json`.
    *   **Place** this file inside the `server/` directory.
    *   Go to your Firebase project > Build > Realtime Database. Note your Database URL (e.g., `https://your-project-id-default-rtdb.firebaseio.com`).
    *   Go to the "Rules" tab and paste the security rules provided (see [Firebase Rules](#firebase-rules) section below or separate file). Publish the rules.

4.  **OpenAI API Key:**
    *   Obtain your API key from the [OpenAI Platform](https://platform.openai.com/api-keys).

5.  **Environment Variables:**
    *   In the **root** directory of the project (where `README.md` is), create a file named `.env`.
    *   Copy the contents of `.env.example` into `.env`.
    *   Fill in the required values in your `.env` file:

    ```dotenv
    # .env file

    # OpenAI API Key
    OPENAI_API_KEY=sk-YourOpenAiApiKeyHere

    # Firebase Configuration
    # Path relative to server.js OR absolute path
    FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json
    FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com

    # Session Secret (change this to a long, random string for production)
    SECRET_KEY=replace_this_with_a_strong_random_secret_key

    # Node Environment (development or production)
    NODE_ENV=development
    ```

6.  **Add to `.gitignore`:** Ensure that `.env` and `server/firebase-credentials.json` are listed in your `.gitignore` file to prevent committing sensitive keys.
    ```
    # .gitignore
    node_modules/
    .env
    server/firebase-credentials.json
    *.log
    ```

## Running the Application

1.  **Start the Server:**
    *   Navigate to the root directory in your terminal.
    *   Run:
        ```bash
        node server/server.js
        ```
    *   For development, it's highly recommended to use `nodemon` for automatic restarts on file changes:
        ```bash
        # Install nodemon globally (if you haven't already)
        # npm install -g nodemon
        nodemon server/server.js
        ```

2.  **Access the Application:**
    *   Open your web browser.
    *   **Student View:** Go to `http://localhost:8080` (or the configured port).
    *   **Instructor Login:** Go to `http://localhost:8080/instructor/login`.

## Usage

1.  **Instructor:**
    *   Navigate to `/instructor/signup` to create an account or `/instructor/login` to log in.
    *   On the dashboard, fill in the details for a new lecture (Course Code, Date, Time, Instructor Name).
    *   Check "Set as active lecture" if you want to record immediately.
    *   Click "Generate Lecture Code".
    *   Share the generated 6-character code with students.
    *   If set as active, the "Lecture Recording" section appears.
    *   Click "Start Recording". Grant microphone permission if prompted. Audio will stream to the server for transcription.
    *   Speak clearly. Transcriptions should appear in the preview box (with some delay).
    *   Click "Stop Recording" when finished.
    *   You can select previously created lectures from the list to make them active again.
2.  **Student:**
    *   Navigate to the main page (`/`).
    *   Enter the 6-character lecture code provided by the instructor.
    *   Click "Access Lecture".
    *   If the code is valid, you'll be taken to the lecture view.
    *   Transcriptions will appear in real-time as the instructor speaks (if recording is active).
    *   Click any transcription bubble to open a modal.
    *   Select an AI option ("Define", "Explain", etc.) to get help related to that transcription.
    *   Use the "Summarize Last X Minutes" buttons to get AI-generated summaries.

## Firebase Rules


```json
{
  "rules": {
    // == Users ==
    // Stores information about registered instructors.
    "users": {
      // Allow only authenticated users to query the users list (needed for login check by email).
      // WARNING: This might still allow fetching the list, filtering happens client-side (in Node server).
      // Consider alternative structures or Cloud Functions for more secure user lookup if needed.
      ".read": "auth != null",
      // Only allow authenticated users (server via signup) to create new user entries.
      // Existing users can only modify their own data (e.g., name).
      "$uid": {
        ".write": "auth != null && (
                    // Allow creation if the UID doesn't exist yet
                    !data.exists() ||
                    // Allow existing user to update their own data (UID must match)
                    (data.exists() && $uid === auth.uid)
                  )",
        // Validate user data structure
        ".validate": "newData.hasChildren(['name', 'email', 'password', 'created_at']) &&
                      newData.child('name').isString() && newData.child('name').val().length > 0 &&
                      newData.child('email').isString() && newData.child('email').val().matches(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$/i) &&
                      newData.child('password').isString() && newData.child('password').val().length > 0 && // Server handles hash format
                      newData.child('created_at').isNumber()",
        // Prevent users from changing their email or creation date after signup
        "email": {
          ".validate": "!data.exists() || newData.val() === data.val()"
        },
        "created_at": {
          ".validate": "!data.exists() || newData.val() === data.val()"
        },
        // Prevent reading/writing password hash directly by clients (server bypasses)
        "password": {
          ".read": false,
          ".write": "auth != null && (!data.exists() || $uid === auth.uid)" // Allow initial set or owner update (if password change implemented)
        },
        "$other": { ".validate": true } // Allow other potential fields
      },
      // Index needed for efficient login lookup by email
      ".indexOn": ["email"]
    },

    // == Lectures ==
    // Stores lecture metadata and transcriptions, keyed by unique lecture code.
    "lectures": {
      "$lecture_code": {
        // Allow any authenticated user (instructors, students) to read lecture data.
        ".read": "auth != null",
        // Metadata rules
        "metadata": {
          // Allow write only if:
          // 1. Creating: Data doesn't exist AND the 'created_by' field matches the authenticated user's ID.
          // 2. Updating: Data exists AND the existing 'created_by' field matches the authenticated user's ID.
          ".write": "auth != null && (
                      (!data.exists() && newData.child('created_by').val() === auth.uid) ||
                      (data.exists() && data.child('created_by').val() === auth.uid)
                    )",
          // Validate metadata structure and types
          ".validate": "newData.hasChildren(['course_code', 'date', 'time', 'instructor', 'created_at', 'created_by']) &&
                        newData.child('course_code').isString() && newData.child('course_code').val().length > 0 &&
                        newData.child('date').isString() && newData.child('date').val().length > 0 && // Consider date format validation if needed
                        newData.child('time').isString() && newData.child('time').val().length > 0 && // Consider time format validation if needed
                        newData.child('instructor').isString() && newData.child('instructor').val().length > 0 &&
                        newData.child('created_at').isNumber() &&
                        newData.child('created_by').isString() && newData.child('created_by').val().length > 0 &&
                        // Ensure 'created_by' cannot be changed after creation
                        (!data.exists() || newData.child('created_by').val() === data.child('created_by').val())",
          // Index needed for fetching instructor's lectures efficiently
          ".indexOn": ["created_by"]
        },
        // Transcriptions rules
        "transcriptions": {
          // Use unique push keys ($pushId) for transcriptions
          "$pushId": {
            // Read allowed for authenticated users (matches parent rule)
            // Write rule: IMPORTANT - Relying on Admin SDK bypass.
            // This rule explicitly DENIES writes from client SDKs.
            // Your server MUST use the Admin SDK to write transcriptions.
            ".write": false,
            // Validate transcription structure
            ".validate": "newData.hasChildren(['text', 'timestamp']) &&
                          newData.child('text').isString() &&
                          newData.child('timestamp').isNumber() && newData.child('timestamp').val() <= now" // Timestamp shouldn't be in the future
          },
          // Index needed for ordering and fetching recent transcriptions
          ".indexOn": ["timestamp"]
        }
      }
    },

    // == Active Lecture ==
    // Stores the code and path of the currently live lecture.
    "active_lecture": {
      // Allow anyone (students, instructors, unauthenticated users?) to read the active code.
      // Adjust to "auth != null" if only logged-in users should see it.
      ".read": true,
      // Allow only authenticated users (server acting for instructor) to write.
      // Server logic should verify the instructor owns the lecture being set.
      ".write": "auth != null",
      // Validate the structure
      ".validate": "newData.hasChildren(['code', 'path', 'set_at', 'set_by']) &&
                    newData.child('code').isString() && newData.child('code').val().length > 0 &&
                    newData.child('path').isString() && newData.child('path').val().length > 0 &&
                    newData.child('set_at').isNumber() && newData.child('set_at').val() <= now &&
                    newData.child('set_by').isString() && newData.child('set_by').val().length > 0"
    },

    // == Test Connection Nodes (Optional) ==
    // Allow authenticated writes during testing, remove or secure for production.
    "test_connection": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
     "test_connection_endpoint": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
     "server_startup_test": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## Acknowledgements

*   OpenAI for the powerful transcription and language models.
*   Firebase for the real-time database solution.
*   Express.js and Node.js communities.

---

## Copyright

© 2025 Mustafa Sheibani. All rights reserved.  
No part of this code may be used, reproduced, modified, distributed, or transmitted in any form or by any means without the prior written permission of the copyright owner.
