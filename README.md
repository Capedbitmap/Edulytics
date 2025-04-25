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
*   [LaTeX](https://www.latex-project.org/) - BasicTeX distribution for PDF lecture notes generation.

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd <repository-folder-name>
    ```

2.  **Install Backend Dependencies:**
    ```bash
    # From the project root directory
    npm install
    ```

3.  **LaTeX Installation:**
    * **For macOS:**
      * Install BasicTeX (lightweight LaTeX distribution):
        ```bash
        # Using Homebrew (recommended)
        brew install --cask basictex
        
        # OR download and install the BasicTeX .pkg manually from
        # https://www.tug.org/mactex/morepackages.html
        ```
      * After installation, the LaTeX binaries should be available at `/Library/TeX/texbin/`.
      * Verify installation:
        ```bash
        /Library/TeX/texbin/pdflatex --version
        ```
    
    * **For Linux:**
      * Install TeX Live base package:
        ```bash
        # Ubuntu/Debian
        sudo apt-get install texlive-base
        
        # CentOS/RHEL/Fedora
        sudo dnf install texlive-scheme-basic
        ```
    
    * **For Windows:**
      * Install MiKTeX (basic version):
        Download from https://miktex.org/download and run the installer
        Choose the "Basic MiKTeX Installer" option
      * Ensure the LaTeX binaries are in your PATH

4.  **Firebase Setup:**
    *   Go to your Firebase project settings > Service accounts.
    *   Generate a new private key and download the JSON file.
    *   **Rename** the downloaded file to `firebase-credentials.json`.
    *   **Place** this file inside the `server/` directory.
    *   Go to your Firebase project > Build > Realtime Database. Note your Database URL (e.g., `https://your-project-id-default-rtdb.firebaseio.com`).
    *   Go to the "Rules" tab and paste the security rules provided (see [Firebase Rules](#firebase-rules) section below or separate file). Publish the rules.

5.  **OpenAI API Key:**
    *   Obtain your API key from the [OpenAI Platform](https://platform.openai.com/api-keys).
    *   Make sure your account has access to the required models (Speech-to-Text and gpt-4o-mini).

6.  **Environment Variables:**
    *   In the **root** directory of the project (where `README.md` is), create a file named `.env`.
    *   Copy the contents of `.env.example` into `.env`.
    *   Fill in the required values in your `.env` file:

    ```dotenv
    # .env file

    # OpenAI API Key - Required for transcription and AI explanations
    OPENAI_API_KEY=sk-YourOpenAiApiKeyHere

    # Firebase Configuration - Required for database access
    # Path relative to server.js OR absolute path 
    FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json
    FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com

    # Session Secret (change this to a long, random string for production)
    # Used for securing user sessions
    SECRET_KEY=replace_this_with_a_strong_random_string_at_least_32_characters

    # Node Environment (development or production)
    # Affects logging verbosity and error details
    NODE_ENV=development

    # Optional: Server port (defaults to 8080 if not specified)
    PORT=8080
    ```

7.  **Add to `.gitignore`:** 
    Ensure that the following files and directories are listed in your `.gitignore` file to prevent committing sensitive information:
    
    ```
    # .gitignore
    
    # Dependencies
    node_modules/
    
    # Environment variables and secrets
    .env
    .env.local
    .env.*.local
    
    # Firebase credentials 
    server/firebase-credentials.json
    *-credentials.json
    
    # Logs
    *.log
    npm-debug.log*
    
    # Runtime data
    pids
    *.pid
    *.seed
    
    # Temporary files
    tmp/
    temp/
    
    # OS files
    .DS_Store
    Thumbs.db
    ```

## Running the Application

1.  **Start the Server:**
    *   Navigate to the root directory in your terminal.
    *   Run the server:
        ```bash
        node server/server.js
        ```
    *   You should see output indicating the server is running, such as:
        ```
        Lecture Assistant Server running on port 8080
        Connected to Firebase Realtime Database
        ```
    
    *   For development, it's highly recommended to use `nodemon` for automatic restarts on file changes:
        ```bash
        # Install nodemon globally if you haven't already
        npm install -g nodemon
        
        # Run the server with nodemon
        nodemon server/server.js
        ```

2.  **Access the Application:**
    *   Open your web browser and navigate to:
        - **Home/Student Page:** `http://localhost:8080` 
        - **Instructor Login:** `http://localhost:8080/instructor/login`
        - **Instructor Signup:** `http://localhost:8080/instructor/signup`
    
    *   If you configured a custom port in your `.env` file, replace `8080` with your port number.

3.  **Verify LaTeX Functionality:**
    * The application uses LaTeX to generate PDF lecture notes.
    * The server code is configured to use the full path to pdflatex at: `/Library/TeX/texbin/pdflatex`
    * When generating lecture notes, this path will be used to compile LaTeX files to PDF

4.  **Troubleshooting LaTeX Issues:**
    * If PDF generation fails, verify that the pdflatex executable exists:
      ```bash
      ls -la /Library/TeX/texbin/pdflatex
      ```
    * Check if your PATH contains the LaTeX binaries:
      ```bash
      echo $PATH | grep tex
      ```
    * If needed, add the LaTeX binaries to your PATH:
      ```bash
      echo 'export PATH="$PATH:/Library/TeX/texbin"' >> ~/.zshrc
      source ~/.zshrc
      ```

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

## Docker Deployment

To deploy the application in a Docker container, which will ensure consistent behavior including LaTeX support, follow these instructions:

1. **Create a Dockerfile** in the root of your project:

```dockerfile
# Use Node.js LTS as base image
FROM node:18-bullseye

# Install BasicTeX for LaTeX PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base \
    texlive-latex-base \
    texlive-fonts-recommended \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create the tmp/uploads directory for LaTeX files
RUN mkdir -p server/tmp/uploads && chmod 777 server/tmp/uploads

# Expose the application port
EXPOSE 8080

# Start the application
CMD ["node", "server/server.js"]
```

2. **Create a .dockerignore file** to exclude unnecessary files:

```
node_modules
npm-debug.log
.env
.git
.gitignore
server/tmp
Dockerfile
.dockerignore
README.md
```

3. **Build the Docker image**:

```bash
docker build -t lecture-transcription-app .
```

4. **Run the Docker container**:

```bash
docker run -p 8080:8080 \
  --env-file .env \
  -v $(pwd)/firebase-credentials.json:/app/server/firebase-credentials.json \
  -d lecture-transcription-app
```

5. **For production deployment**:
   - Consider using Docker Compose to manage multiple services
   - Use environment variables for sensitive configuration
   - Set up proper volume management for persistent data
   - Configure reverse proxy with HTTPS (e.g., Nginx, Traefik)

Example docker-compose.yml:

```yml
version: '3'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - FIREBASE_DATABASE_URL=${FIREBASE_DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
    volumes:
      - ./firebase-credentials.json:/app/server/firebase-credentials.json
    restart: unless-stopped
```

## Acknowledgements

*   OpenAI for the powerful transcription and language models.
*   Firebase for the real-time database solution.
*   Express.js and Node.js communities.


bofaa