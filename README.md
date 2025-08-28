# Lecture Assistant - Real-time Transcription & AI Support

A web application designed to provide real-time transcription of lectures using OpenAI's Realtime API, store them in Firebase, and offer AI-powered explanations and summaries to students. Includes an instructor dashboard for managing lectures and initiating recordings.

## Features

*   **Instructor Dashboard:**
    *   Secure Instructor Login/Signup with email validation and password protection.
    *   Generate unique 6-character codes for new lectures with collision detection.
    *   Manage lecture metadata (Course Code, Date, Time, Instructor Name).
    *   View list of previously created lectures with filtering and sorting options.
    *   Select and activate a lecture for recording with real-time status indicators.
    *   Start/Stop real-time audio recording streamed via WebSockets with automatic reconnection.
    *   Live transcription preview during recording with timestamps.
    *   Visual audio level indicator with adjustable sensitivity.
    *   Export lecture transcriptions to PDF with LaTeX formatting.
    *   Ability to edit or annotate transcriptions after recording.

*   **Student Lecture View:**
    *   Access lectures using the unique 6-character code with validation.
    *   View real-time transcriptions streamed from the server with auto-scrolling.
    *   Click on transcription bubbles to request AI assistance with context-aware responses:
        *   Define Terms - Get concise definitions of technical concepts
        *   Explain in Detail - Receive comprehensive explanations with examples
        *   Provide Real-World Examples - See practical applications of concepts
        *   Simplify (ELI5) - Get simplified explanations for complex topics
    *   Request summaries of recent lecture content (Last 1, 5, 30 minutes).
    *   Save favorite explanations for later review.
    *   Search functionality within lecture transcripts.
    *   Student engagement tracking with facial detection.

*   **Real-time Transcription:** 
    *   Uses WebSockets to stream audio from the instructor's browser to the backend.
    *   Forwards audio stream to OpenAI's Realtime Transcription API with error handling.
    *   Transcriptions are saved to Firebase Realtime Database with timestamps.
    *   Support for multiple concurrent lecture sessions.
    *   Automatic handling of disconnections and reconnections.

*   **AI Explanations & Summaries:** 
    *   Leverages OpenAI's Chat Completions API (gpt-4o-mini) for intelligent responses.
    *   Context-aware explanations based on selected transcriptions.
    *   Ability to summarize lecture segments with customizable timeframes.
    *   Support for generating lecture notes in multiple formats.
    *   Optimized prompts for educational content.

*   **Engagement Analytics:**
    *   Face detection to measure student attention levels.
    *   Aggregated engagement metrics for instructors.
    *   Privacy-focused approach that doesn't store personal data.

*   **Security Features:**
    *   Secure authentication for instructors.
    *   Rate limiting to prevent abuse.
    *   Firebase security rules to protect data.
    *   Input validation and sanitization throughout.

## Tech Stack

*   **Backend:** 
    *   Node.js v18+
    *   Express.js v4.21.2 for API routes and serving static files
    *   Socket.IO v4.8.1 for enhanced WebSocket communication

*   **Real-time Communication:** 
    *   Socket.IO for reliable bidirectional event-based communication
    *   Native browser WebSocket API for fallback

*   **Database:** 
    *   Firebase Realtime Database v13.2.0 for lecture storage and real-time updates
    *   Structured data model with security rules

*   **Authentication:** 
    *   Express-session v1.18.1 for session management
    *   Crypto module for password hashing and validation
    *   Email verification with Nodemailer v6.10.1

*   **Transcription & AI:** 
    *   OpenAI API v4.89.0 for transcription and AI capabilities
    *   Streaming response handling for real-time updates

*   **PDF Generation:**
    *   LaTeX for professional-quality PDF exports
    *   PDFKit v0.16.0 for dynamic PDF generation
    *   Marked v15.0.7 for Markdown parsing

*   **Frontend:** 
    *   HTML5, CSS3, Vanilla JavaScript (ES6+)
    *   Modular JavaScript with ES Modules pattern
    *   Responsive design for multi-device support
    *   Face-api.js for facial detection capabilities

*   **Other Tools:**
    *   UUID v11.1.0 for unique identifiers
    *   ShortID v2.2.17 for generating lecture codes
    *   Multer v1.4.5 for handling file uploads
    *   CORS v2.8.5 for cross-origin resource sharing
    *   Dotenv v16.4.7 for environment variable management

## Project Structure

```
.
├── client/
│   └── public/                  # Frontend static files
│       ├── images/              # Static image assets
│       │   ├── default-instructor.webp
│       │   └── scroll-feature-*.png
│       ├── models/              # Face detection models
│       │   ├── tiny_face_detector_model-shard1
│       │   └── tiny_face_detector_model-weights_manifest.json
│       ├── scripts/             # Frontend JavaScript
│       │   ├── advanced-animations.js  # Enhanced UI animations
│       │   ├── app.js           # Main application logic
│       │   ├── audioRecorder.js # Audio capture functionality
│       │   ├── config.js        # Frontend configuration
│       │   ├── engagement.js    # Student engagement tracking
│       │   ├── faceDetection.js # Face detection implementation
│       │   ├── firebase.js      # Firebase client integration
│       │   ├── instructor.js    # Instructor dashboard logic
│       │   └── landing.js       # Landing page functionality
│       ├── styles/              # CSS stylesheets
│       │   ├── advanced-effects.css  # Advanced visual effects
│       │   ├── animations.css   # Animation definitions
│       │   ├── main.css         # Core styling
│       │   └── main.css.additions  # Supplementary styles
│       ├── 404.html             # Custom 404 error page
│       ├── index.html           # Main landing page
│       ├── instructor_login.html  # Instructor login page
│       ├── instructor_signup.html # Instructor signup page
│       ├── instructor.html      # Instructor dashboard
│       ├── lecture.html         # Student lecture view
│       ├── student_dashboard.html # Student dashboard
│       ├── student_login.html   # Student login page
│       └── student_signup.html  # Student signup page
├── server/
│   ├── server.js               # Main Express server & WebSocket handling
│   ├── tmp/                    # Temporary file storage
│   │   └── uploads/            # Uploaded files (audio, PDFs)
│   └── utils/                  # Server utility functions
│       ├── auth.js             # Authentication utilities
│       └── verification.js     # Input validation
├── firebase-credentials.json   # Firebase service account credentials (PRIVATE)
├── package.json                # Project dependencies
├── README.md                   # Project documentation
└── .env                        # Environment variables (PRIVATE)
```

## Setup and Installation

**Prerequisites:**

*   [Node.js](https://nodejs.org/) (version 18.x or later recommended)
*   [Git](https://git-scm.com/) for version control
*   A Firebase Project with Realtime Database enabled
*   An OpenAI API Key with access to the Realtime Transcription API and Chat Completions models
*   [LaTeX](https://www.latex-project.org/) - BasicTeX distribution for PDF lecture notes generation

**Steps:**

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/Capedbitmap/JS-Lecture-Transciption.git
    cd JS-Lecture-Transciption
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
    *   Create a new Firebase project at [Firebase Console](https://console.firebase.google.com/)
    *   Enable the Realtime Database feature in your project
    *   Set up Authentication with Email/Password provider
    *   Go to your Firebase project settings > Service accounts
    *   Generate a new private key and download the JSON file
    *   **Rename** the downloaded file to `firebase-credentials.json`
    *   **Place** this file inside the root directory of your project
    *   Note your Database URL (e.g., `https://your-project-id-default-rtdb.firebaseio.com`)
    *   Go to the "Rules" tab and paste the security rules provided in the [Firebase Rules](#firebase-rules) section below
    *   Publish the rules

5.  **OpenAI API Key:**
    *   Create or log in to your account at [OpenAI Platform](https://platform.openai.com/)
    *   Navigate to API keys and generate a new key
    *   Make sure your account has access to the required models:
        *   Speech-to-Text API for transcription
        *   GPT-4o-mini or other suitable models for AI responses
    *   Ensure you have sufficient credits for your usage needs

6.  **Environment Variables:**
    *   In the root directory of the project, create a file named `.env`
    *   Fill in the required values:

    ```dotenv
    # .env file

    # OpenAI API Key - Required for transcription and AI explanations
    OPENAI_API_KEY=sk-YourOpenAiApiKeyHere

    # Firebase Configuration - Required for database access
    FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json
    FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com

    # Session Secret (change this to a long, random string for production)
    SECRET_KEY=replace_this_with_a_strong_random_string_at_least_32_characters

    # Node Environment (development or production)
    NODE_ENV=development

    # Server port
    PORT=8080

    # Email Configuration (for verification emails)
    EMAIL_SERVICE=gmail  # or another service like 'outlook', 'yahoo', etc.
    EMAIL_USER=your-email@example.com
    EMAIL_PASS=your-app-specific-password

    # LaTeX Binary Path (adjust based on your OS)
    LATEX_PATH=/Library/TeX/texbin/pdflatex  # for macOS
    # LATEX_PATH=pdflatex  # for Linux/Windows if in PATH
    ```

7.  **Create Required Directories:**
    ```bash
    # Create the temporary uploads directory if it doesn't exist
    mkdir -p server/tmp/uploads
    ```

8.  **Add to `.gitignore`:** 
    Create or update your `.gitignore` file to include:
    
    ```
    # Dependencies
    node_modules/
    
    # Environment variables and secrets
    .env
    .env.local
    .env.*.local
    
    # Firebase credentials 
    firebase-credentials.json
    *-credentials.json
    
    # Logs
    *.log
    npm-debug.log*
    
    # Runtime data and temporary files
    server/tmp/
    
    # OS files
    .DS_Store
    Thumbs.db
    ```
8.  **Frontend Configuration (API URL):**
    *   The frontend needs to know the URL of the running backend server. This is configured in `client/public/scripts/config.js`.
    *   Find the line: `export const API_URL = 'http://localhost:8080';`
    *   During development, this points to your local server.
    *   **IMPORTANT:** When deploying the application to a live environment, you **must** update this URL to the public address of your deployed backend server (e.g., `https://your-api.yourdomain.com`).

9.  **Setup npm Scripts:**
    Update your package.json scripts section for convenience:
    
    ```json
    "scripts": {
      "start": "node server/server.js",
      "dev": "nodemon server/server.js",
      "test": "echo \"Error: no test specified\" && exit 1"
    }
    ```

## Running the Application

1.  **Start the Server:**
    *   For development with automatic restarts:
        ```bash
        npm run dev
        ```
    *   For production:
        ```bash
        npm start
        ```
    *   You should see output indicating the server is running, such as:
        ```
        Lecture Assistant Server running on port 8080
        Connected to Firebase Realtime Database
        ```

2.  **Access the Application:**
    *   Open your web browser and navigate to:
        - **Home/Student Page:** `http://localhost:8080` 
        - **Instructor Login:** `http://localhost:8080/instructor_login.html`
        - **Instructor Signup:** `http://localhost:8080/instructor_signup.html`
    
    *   If you configured a custom port in your `.env` file, replace `8080` with your port number.

3.  **Verify LaTeX Functionality:**
    * The application uses LaTeX to generate PDF lecture notes.
    * Verify that the path in your `.env` file matches the actual location of pdflatex
    * Test PDF generation by creating a lecture and using the export feature

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
    *   Navigate to `/instructor_login.html` to log in or `/instructor_signup.html` to create an account.
    *   On the dashboard, fill in the details for a new lecture (Course Code, Date, Time, Instructor Name).
    *   Check "Set as active lecture" if you want to record immediately.
    *   Click "Generate Lecture Code".
    *   Share the generated 6-character code with students.
    *   If set as active, the "Lecture Recording" section appears.
    *   Click "Start Recording". Grant microphone permission if prompted. Audio will stream to the server for transcription.
    *   Speak clearly. Transcriptions should appear in the preview box (with some delay).
    *   Click "Stop Recording" when finished.
    *   You can select previously created lectures from the list to make them active again.
    *   Use the export feature to generate PDF versions of the lecture for distribution.

2.  **Student:**
    *   Navigate to the main page (`/`).
    *   Enter the 6-character lecture code provided by the instructor.
    *   Click "Access Lecture".
    *   If the code is valid, you'll be taken to the lecture view.
    *   Transcriptions will appear in real-time as the instructor speaks (if recording is active).
    *   Click any transcription bubble to open a modal with AI assistance options.
    *   Select an AI option ("Define", "Explain", etc.) to get help related to that transcription.
    *   Use the "Summarize Last X Minutes" buttons to get AI-generated summaries.
    *   Use the search function to find specific content within the lecture.
    *   Save explanations for later review in your student dashboard.

3.  **Engagement Tracking:**
    *   The application can track student engagement using face detection
    *   This feature requires camera permissions from students
    *   Privacy is maintained as no images are stored, only engagement metrics
    *   Instructors can view aggregated engagement data to gauge lecture effectiveness

## API Endpoints

The application provides several API endpoints for client-server communication:

### Authentication Endpoints

* `POST /api/auth/instructor/signup` - Register a new instructor
* `POST /api/auth/instructor/login` - Authenticate an instructor
* `GET /api/auth/instructor/logout` - End an instructor session
* `GET /api/auth/session` - Check current session status

### Lecture Management

* `POST /api/lectures/create` - Create a new lecture
* `GET /api/lectures/list` - Get all lectures for the authenticated instructor
* `POST /api/lectures/activate` - Set a lecture as active
* `GET /api/lectures/:code` - Get details for a specific lecture
* `PUT /api/lectures/:code` - Update lecture metadata
* `DELETE /api/lectures/:code` - Delete a lecture

### Transcription

* `GET /api/transcriptions/:lectureCode` - Get all transcriptions for a lecture
* `GET /api/transcriptions/:lectureCode/recent` - Get recent transcriptions
* `PUT /api/transcriptions/:lectureCode/:id` - Edit a transcription
* `POST /api/transcriptions/:lectureCode/export` - Generate a PDF export

### AI Assistance

* `POST /api/ai/explain` - Get AI explanation for a transcription
* `POST /api/ai/summarize` - Generate a summary of recent content
* `POST /api/ai/define` - Define terms from a transcription
* `POST /api/ai/simplify` - Simplify a complex transcription
* `POST /api/ai/examples` - Get real-world examples related to a transcription



