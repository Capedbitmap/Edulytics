// server/server.js

//###################################################################################
// NEED TO DOUBLE CHECK STUDENT BUTTON PROMPTS BUT SEEMS TO BE WORKING FINE
//###################################################################################

// =============================================================================
// --- Module Imports ---
// =============================================================================

// Core Node.js Modules
const path = require('path');           // Provides utilities for working with file and directory paths
const fs = require('fs');             // Provides file system functionalities (e.g., reading files, checking existence)
const http = require('http');           // Provides HTTP server functionalities
const { URL } = require('url');         // Provides utilities for URL resolution and parsing

// External Dependencies (Installed via npm/yarn)
const express = require('express');         // Fast, unopinionated, minimalist web framework for Node.js
const cors = require('cors');             // Middleware for enabling Cross-Origin Resource Sharing
const dotenv = require('dotenv');         // Loads environment variables from a .env file into process.env
const multer = require('multer');         // Middleware for handling multipart/form-data (primarily file uploads)
const { initializeApp, cert } = require('firebase-admin/app'); // Firebase Admin SDK for interacting with Firebase services
const { getDatabase } = require('firebase-admin/database');   // Firebase Realtime Database service
const { OpenAI } = require('openai');         // Official OpenAI Node.js library
const { v4: uuidv4 } = require('uuid');       // For generating universally unique identifiers (UUIDs)
const session = require('express-session'); // Session middleware for Express

// Local Utilities
const {
  generatePasswordHash, // Function to hash passwords
  checkPasswordHash     // Function to verify password against a hash
} = require('./utils/auth'); // Assuming this file exists and exports these functions
const PDFDocument = require('pdfkit');      // Library for creating PDF documents
const { marked } = require('marked');       // Library to parse Markdown (if needed for PDF generation, though basic is shown)
// =============================================================================
// --- Initializations & Configuration ---
// =============================================================================

// Load environment variables from .env file FIRST
// `override: true` ensures .env variables take precedence over existing process.env variables
dotenv.config({ override: true });

// Configure Logging Utility
// Simple console logging with timestamps and levels
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()}: ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, err || ''),
  debug: (msg) => { if (process.env.NODE_ENV !== 'production') console.log(`[DEBUG] ${new Date().toISOString()}: ${msg}`) }
};

// Initialize Express Application
const app = express();

// Create HTTP Server using the Express app
const server = http.createServer(app);

// =============================================================================
// --- Core Middleware Setup ---
// =============================================================================

// Enable Cross-Origin Resource Sharing (CORS) for all origins
// Allows requests from different domains (e.g., frontend running on a different port)
app.use(cors());

// Enable parsing of JSON request bodies
// Populates `req.body` with the parsed JSON object
app.use(express.json());

// Serve static files (HTML, CSS, JavaScript, Images) from the specified directory
// `path.join` creates a platform-independent path
app.use(express.static(path.join(__dirname, '../client/public')));

// Session Secret Configuration
// Used to sign the session ID cookie. Should be a long, random, secret string.
const sessionSecret = process.env.SECRET_KEY || 'dev-secret-key-CHANGE-ME';
if (sessionSecret === 'dev-secret-key-CHANGE-ME' && process.env.NODE_ENV === 'production') {
  // Log a critical warning if the default secret is used in production
  logger.error('CRITICAL SECURITY WARNING: Using default session secret in production! Please set SECRET_KEY environment variable.');
}

// =============================================================================
// --- Session Middleware Configuration (Separate for Student and Instructor) ---
// =============================================================================

// --- 1. Student Session Middleware ---
// This middleware handles sessions specifically for student users.
const studentSessionMiddleware = session({
    // `name`: The name of the session ID cookie to set in the response (and read from in the request).
    // Using a unique name prevents collisions with the instructor session.
    name: 'connect.sid.student',

    // `secret`: Required to sign the session ID cookie. Use the configured secret.
    secret: sessionSecret,

    // `resave`: Forces the session to be saved back to the session store, even if
    // the session was never modified during the request. Setting to `false` is recommended.
    resave: false,

    // `saveUninitialized`: Forces a session that is "uninitialized" to be saved to the store.
    // A session is uninitialized when it is new but not modified. Setting to `true` can be
    // useful for login sessions, setting to `false` helps comply with cookie laws.
    saveUninitialized: true, // Consider setting to false later if needed

    // `cookie`: Settings for the session cookie itself.
    cookie: {
        // `secure`: Requires the cookie to only be sent over HTTPS. Should be `true` in production.
        secure: process.env.NODE_ENV === 'production',

        // `httpOnly`: Prevents client-side JavaScript from accessing the cookie. Essential for security.
        httpOnly: true,

        // `maxAge`: Specifies the number of milliseconds until the cookie expires. (1 day here)
        maxAge: 24 * 60 * 60 * 1000,

        // `path`: Specifies the URL path for which the cookie is valid. '/' means all paths.
        path: '/'
    }
});

// --- 2. Instructor Session Middleware ---
// This middleware handles sessions specifically for instructor users.
const instructorSessionMiddleware = session({
    // `name`: Unique name for the instructor session cookie.
    name: 'connect.sid.instructor',

    // `secret`: Can use the same secret as the student session.
    secret: sessionSecret,

    // `resave`: Recommended setting is `false`.
    resave: false,

    // `saveUninitialized`: Recommended setting depends on use case, `true` for initial login convenience.
    saveUninitialized: true,

    // `cookie`: Settings for the instructor session cookie.
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        path: '/' // Cookie applies to all paths
    }
});

// --- Apply Session Middleware Selectively ---
// Apply the correct session middleware based on the URL path prefix.
// This ensures that `req.session` is populated correctly for each user type.
// Note: List ALL paths that require a specific session type.

// Apply student session middleware to student-related routes and APIs
app.use(
    [
        '/student',                 // All paths starting with /student/
        '/lecture',                 // All paths starting with /lecture/
        '/join_lecture',            // Specific API endpoint
        '/get_student_info',        // Specific API endpoint
        '/get_student_lectures',    // Specific API endpoint
        '/get_lecture_transcriptions',// Specific API endpoint
        '/get_explanation',         // Specific API endpoint
        '/get_summary',             // Specific API endpoint
        '/get_summary_entire',      // NEW: Endpoint for entire lecture summary
        '/generate_practice_problems_lecture', // NEW: Endpoint for lecture practice problems
        '/create_lecture_notes',    // NEW: Endpoint for PDF lecture notes
        '/search_lectures',         // NEW: Endpoint for searching lectures/transcripts
        '/submit_quiz_answer',      // New endpoint for submitting quiz answers
        '/get_active_quiz',         // New endpoint for getting active quiz
        '/recording_status'         // MOVED: Students need to check this status
    ],
    studentSessionMiddleware // Use the student session configuration
);

// Apply instructor session middleware to instructor-related routes and APIs
app.use(
    [
        '/instructor',              // All paths starting with /instructor/
        '/generate_lecture_code',   // Specific API endpoint
        '/get_user_info',           // Specific API endpoint
        '/get_instructor_lectures', // Specific API endpoint
        '/set_active_lecture',      // Specific API endpoint
        '/start_recording',         // Specific API endpoint
        '/stop_recording',          // Specific API endpoint
        // '/recording_status',     // MOVED to student middleware
        '/delete_lecture',          // Specific API endpoint
        '/delete_course',           // Specific API endpoint
        '/delete_lectures',         // Specific API endpoint
        '/delete_courses',          // Specific API endpoint
        '/save_transcription',      // Specific API endpoint (for saving WebRTC transcriptions)
        '/create_quiz',             // New endpoint for quiz creation
        '/activate_quiz',           // New endpoint for quiz activation
        '/get_quiz_results',        // New endpoint for quiz results
        '/delete_quiz',             // New endpoint for quiz deletion
        '/get_lecture_quizzes'      // New endpoint for fetching lecture quizzes
    ],
    instructorSessionMiddleware // Use the instructor session configuration
);


// =============================================================================
// --- Firebase Admin SDK Initialization ---
// =============================================================================
let db; // Firebase Realtime Database reference variable
try {
  // Get credentials path from environment variable or default path
  const cred_path = process.env.FIREBASE_CREDENTIALS_PATH || path.join(__dirname, 'firebase-credentials.json');
  // Get Database URL from environment variable
  const db_url = process.env.FIREBASE_DATABASE_URL;

  // Validate that credentials file exists
  if (!fs.existsSync(cred_path)) {
    throw new Error(`Firebase credentials file not found at: ${cred_path}. Please ensure the file exists or set FIREBASE_CREDENTIALS_PATH.`);
  }
  // Validate that Database URL is set
  if (!db_url) {
    throw new Error("FIREBASE_DATABASE_URL not found in environment variables. Please set it in your .env file.");
  }

  // Load the service account key JSON file
  const serviceAccount = require(cred_path);

  // Initialize the Firebase Admin SDK
  initializeApp({
    credential: cert(serviceAccount), // Provide the loaded credentials
    databaseURL: db_url              // Provide the Realtime Database URL
  });

  // Get a reference to the Firebase Realtime Database service
  db = getDatabase();
  logger.info("Firebase Admin SDK initialized successfully.");

  // Optional: Test Firebase connection on startup by writing a timestamp
  db.ref('server_status/last_startup').set({ timestamp: Date.now() })
    .then(() => logger.info('Firebase write test successful on startup.'))
    .catch(err => logger.error('Firebase write test failed on startup.', err));

} catch (error) {
  // Log fatal error and exit if Firebase initialization fails (it's critical)
  logger.error(`FATAL: Failed to initialize Firebase Admin SDK: ${error.message}`, error);
  process.exit(1);
}

// =============================================================================
// --- OpenAI Client Initialization ---
// =============================================================================
let client; // OpenAI client instance variable
try {
  // Get OpenAI API key from environment variables
  const openai_api_key = process.env.OPENAI_API_KEY;

  // Check if the API key is present
  if (!openai_api_key) {
    // Log an error if the key is missing, but allow the server to continue (OpenAI features will be disabled)
    logger.error("OPENAI_API_KEY not found in environment variables. OpenAI features will be unavailable.");
  } else {
    // Initialize the OpenAI client if the key is found
    client = new OpenAI({ apiKey: openai_api_key });
    logger.info("OpenAI client initialized successfully.");
  }
} catch (error) {
  // Log error during initialization, but don't crash the server
  logger.error(`Failed to initialize OpenAI client: ${error.message}`, error);
}

// Helper function to check if the OpenAI client is available and initialized
function isOpenAiAvailable() {
  return !!client; // Returns true if 'client' is truthy (initialized)
}

// =============================================================================
// --- Multer Setup for File Uploads (Fallback Transcription) ---
// =============================================================================

// Define the directory for temporary file uploads
const tmpDir = path.join(__dirname, 'tmp/uploads');

// Ensure the temporary directory exists, create it if not
if (!fs.existsSync(tmpDir)) {
  try {
    fs.mkdirSync(tmpDir, { recursive: true }); // Create parent directories if needed
    logger.info("Created temporary uploads directory:", tmpDir);
  } catch (mkdirError) {
    logger.error(`Failed to create temporary directory ${tmpDir}:`, mkdirError);
    // Note: Fallback transcription might fail if this directory cannot be created.
  }
}

// Configure Multer middleware
const upload = multer({
    // `dest`: The destination directory for uploaded files (temporary storage)
    dest: tmpDir,

    // `limits`: Constraints on uploaded files (e.g., file size)
    limits: { fileSize: 25 * 1024 * 1024 }, // OpenAI Transcription API limit is 25MB

    // `fileFilter`: Function to control which files are accepted
    fileFilter: (req, file, cb) => {
        // List of allowed MIME types for audio files (align with OpenAI Transcription support)
        const allowedTypes = [
            'audio/mpeg',   // mp3
            'audio/mp4',    // mp4, m4a
            'audio/wav',    // wav
            'audio/webm',   // webm
            'audio/mpga',   // sometimes used for mp3
            'audio/ogg',    // ogg
            'audio/flac',   // flac
        ];
        // Check if the uploaded file's MIME type is in the allowed list
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true); // Accept the file
        } else {
            // Log rejection and provide an informative error
            logger.error(`Fallback rejected file type: ${file.mimetype} for file ${file.originalname}`);
            cb(new Error('Invalid audio file type for fallback. Supported types: mp3, mp4, mpeg, mpga, m4a, wav, webm')); // Reject the file
        }
    }
});

// WebSocket server implementation removed as WebRTC is now the primary method
// and MediaRecorder is the fallback. The server no longer proxies WebSocket traffic.


// =============================================================================
// --- Authentication Middleware Definitions ---
// =============================================================================
// These functions check if a user is authenticated based on their session.
// They are applied selectively to routes that require login.

/**
 * Middleware to ensure an INSTRUCTOR is logged in.
 * Checks for `req.session.user_id` in the INSTRUCTOR session store.
 * Sends 401 JSON or redirects based on request type if not logged in.
 * Attaches instructor info to `req.user` if logged in.
 *
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 * @param {express.NextFunction} next - The callback to pass control to the next middleware.
 */
function login_required(req, res, next) {
  // Check the INSTRUCTOR session (identified by cookie 'connect.sid.instructor')
  if (!req.session || !req.session.user_id) {
    logger.info(`Instructor authentication required for ${req.method} ${req.path}`);

    // Determine if the request likely expects a JSON response
    const expectsJson = req.headers.accept?.includes('application/json') || req.xhr ||
                        (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers['content-type']?.includes('application/json'));

    if (expectsJson) {
      // Send 401 Unauthorized with JSON body for API-like requests
      return res.status(401).json({ 'error': 'Instructor authentication required', 'redirect': '/instructor/login' });
    } else {
      // Redirect browser requests to the instructor login page
      return res.redirect('/instructor/login');
    }
  }
  // If authenticated, attach user info to the request object for convenience
  req.user = { id: req.session.user_id, email: req.session.email, name: req.session.name };
  next(); // Pass control to the next middleware or route handler
}

/**
 * Middleware to ensure a STUDENT is logged in.
 * Checks for `req.session.student_id` in the STUDENT session store.
 * Sends 401 JSON or redirects based on request type if not logged in.
 * Attaches student info to `req.student` if logged in.
 * Includes detailed logging for debugging session issues.
 *
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 * @param {express.NextFunction} next - The callback to pass control to the next middleware.
 */
function student_required(req, res, next) {
  // Check the STUDENT session (identified by cookie 'connect.sid.student')

  // --- Detailed Logging for Debugging ---
  const logPrefix = `[student_required] Path: ${req.path}, Method: ${req.method}`;
  logger.debug(`${logPrefix} - Request received.`);
  // Log the session ID associated with the current request (if any)
  logger.debug(`${logPrefix} - Session ID from req.session.id: ${req.session?.id}`);
  // Log the student ID found in the session (should be undefined if not logged in)
  logger.debug(`${logPrefix} - Student ID from req.session.student_id: ${req.session?.student_id}`);
  // Log the raw Cookie header received from the browser
  const cookies = req.headers.cookie || 'None';
  logger.debug(`${logPrefix} - Raw Cookie Header Received: ${cookies}`);
  // --- End Detailed Logging ---

  // Check if the session exists and contains the student_id
  if (!req.session || !req.session.student_id) {
    logger.info(`${logPrefix} - Authentication FAILED (req.session.student_id is falsy).`);

    // Determine if the request likely expects a JSON response
    const acceptHeader = req.headers.accept || '';
    const contentTypeHeader = req.headers['content-type'] || '';
    const isApiMethodWithJson = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && contentTypeHeader.includes('application/json');
    const acceptsJson = acceptHeader.includes('application/json');
    // Combine checks: Accept header, XHR, or relevant method with JSON Content-Type
    const expectsJson = acceptsJson || req.xhr || isApiMethodWithJson;

    logger.debug(`${logPrefix} - Accept Header: '${acceptHeader}', Content-Type: '${contentTypeHeader}', req.xhr: ${req.xhr}, isApiMethodWithJson: ${isApiMethodWithJson}, expectsJson: ${expectsJson}`);

    if (expectsJson) {
        // Send 401 Unauthorized with JSON body for API-like requests
        logger.info(`${logPrefix} - Sending 401 JSON response because authentication failed and request expects JSON.`);
        return res.status(401).json({ 'error': 'Authentication required. Please log in again.', 'redirect': '/student/login' });
    } else {
        // Redirect browser requests to the student login page
        logger.info(`${logPrefix} - Redirecting to /student/login because authentication failed and request does not expect JSON.`);
        return res.redirect('/student/login');
    }
  }

  // If authenticated, log success and attach student info to the request object
  logger.debug(`${logPrefix} - Authentication SUCCESSFUL for student ${req.session.student_id}.`);
  req.student = {
    id: req.session.student_id,
    email: req.session.student_email,
    name: req.session.student_name,
    student_number: req.session.student_number
  };
  next(); // Pass control to the next middleware or route handler
}

// =============================================================================
// --- Helper Functions ---
// =============================================================================

/**
 * Generates a unique, random lecture code of a specified length.
 * Checks against Firebase to ensure the code is not already in use.
 *
 * @returns {Promise<string>} A promise that resolves with a unique lecture code.
 * @throws {Error} If a unique code cannot be generated after max attempts or if there's a DB error.
 */
async function generate_unique_lecture_code() {
  const code_length = 6;
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'; // Excludes easily confused chars (I, O, 0)
  const max_attempts = 10; // Limit attempts to prevent infinite loops

  for (let attempts = 0; attempts < max_attempts; attempts++) {
    // Generate a random code
    let code = '';
    for (let i = 0; i < code_length; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    try {
      // Check if the generated code already exists in Firebase
      const snapshot = await db.ref(`lectures/${code}/metadata`).once('value');
      if (!snapshot.exists()) {
        // Code is unique
        logger.debug(`Generated unique lecture code: ${code}`);
        return code;
      } else {
        // Code already exists, log and retry
         logger.debug(`Code ${code} already exists, retrying...`);
      }
    } catch (error) {
      // Handle potential database errors during the check
      logger.error(`Firebase error checking code uniqueness for ${code}:`, error);
      throw new Error('Failed to check code uniqueness due to database error');
    }
  }

  // If max attempts are reached without finding a unique code
  logger.error(`Failed to generate a unique lecture code after ${max_attempts} attempts.`);
  throw new Error('Could not generate a unique lecture code');
}

// =============================================================================
// --- System Prompts for AI Features ---
// =============================================================================
// Pre-defined system prompts for instructing the OpenAI model for different tasks.
const system_prompts = {
  'define': `Concisely define the key technical terms or jargon present in the following text snippet from a lecture. Aim for clarity suitable for a university student unfamiliar with the specific terms.`,
  'explain': `Explain the core concepts presented in the following lecture excerpt in detail. Provide context and elaborate on the significance of the ideas discussed. Assume the audience is a university student in a related field.`,
  'examples': `Provide practical, real-world examples or relatable analogies that illustrate the main concepts discussed in the following lecture text. Make the abstract ideas more concrete.`,
  'simplify': `Explain the following text from a lecture in very simple terms, as if explaining it to someone with no prior knowledge of the subject (like explaining to a 5-year-old, ELI5). Avoid jargon.`,
  'summary': (/** @type {number} minutes */ minutes) => `You are an AI assistant summarizing lecture content. Provide a concise summary (e.g., 3-5 bullet points) of the main points from the last ${minutes} minute(s) using the provided text. Focus on key concepts and conclusions. Ignore filler words and off-topic remarks. Format the output using Markdown.`, // Dynamic prompt based on time
  'summary_entire': `You are an AI assistant summarizing lecture content. Provide a comprehensive summary of the main topics, key concepts, definitions, and conclusions discussed throughout the entire lecture transcript provided. Structure the summary logically (e.g., by topic). Format the output using Markdown.`,
  'practice_lecture': `You are an AI assistant generating practice problems based on lecture content. Create 3-5 relevant practice questions (e.g., multiple-choice, short answer, problem-solving) based on the *entire* lecture transcript provided. The questions should test understanding of the key concepts and materials covered. Format the output using Markdown, clearly numbering each question.`,
  'practice_context': `You are an AI assistant generating practice problems. Based *only* on the following short text snippet from a lecture, create 1-2 relevant practice questions (e.g., multiple-choice, short answer) that test understanding of the concepts mentioned in *this specific snippet*. Format the output using Markdown.`,
  'lecture_notes_structure': `You are an AI assistant structuring lecture notes. Based on the provided lecture transcript and metadata (course code, date, instructor), create well-structured study notes in Markdown format. Include a clear title with metadata, organize content logically (e.g., by topic or section), use headings, bullet points, and emphasize key terms or definitions. The goal is to produce comprehensive notes suitable for student review.`
};

// =============================================================================
// --- API Routes ---
// =============================================================================
// Define the application's API endpoints.
// Authentication middleware (`login_required`, `student_required`) is applied
// directly to routes that need protection.

// --- General API Routes ---

/**
 * GET /api/status
 * Provides basic server status information. No authentication required.
 */
app.get('/api/status', (req, res) => {
  res.json({
      status: 'active'
  });
});

/**
 * GET /test_firebase
 * Endpoint for manually testing the Firebase database connection. No authentication required.
 */
app.get('/test_firebase', async (req, res) => {
  try {
    logger.info('Manual Firebase test via /test_firebase endpoint...');
    // Attempt to write a test value to the database
    await db.ref('test_connection_endpoint').set({ timestamp: Date.now(), status: 'success from manual test' });
    logger.info('Manual Firebase endpoint test successful!');
    res.json({ success: true, message: 'Firebase connection successful' });
  } catch (error) {
    // Handle potential database errors
    logger.error('Manual Firebase endpoint test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Realtime Session Token Generation ---

/**
 * GET /session
 * Generates an ephemeral OpenAI API key for client-side Realtime API connections (e.g., WebRTC).
 * Uses the server's main API key to request the token.
 * No authentication required for this endpoint itself, as it provides a short-lived token.
 */
app.get('/session', async (req, res) => {
    logger.info("Request received for ephemeral Realtime API token.");

    // Check if OpenAI client is available
    if (!isOpenAiAvailable()) {
        logger.error('Cannot generate session token: OpenAI client unavailable.');
        return res.status(503).json({ error: 'AI service unavailable' });
    }

    // Define the model to be used for the session (should match client intent)
    // Using the same model as fallback/WS for consistency
    const targetModel = "gpt-4o-transcribe";

    try {
        // Request an ephemeral key from the OpenAI REST API
        const sessionResponse = await fetch("https://api.openai.com/v1/realtime/sessions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, // Use the server's secret key
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: targetModel,
                // Add other session parameters if needed, e.g., voice for speech-to-speech
                // For transcription-only, model is often sufficient
            }),
        });

        // Check if the request to OpenAI was successful
        if (!sessionResponse.ok) {
            const errorBody = await sessionResponse.text();
            logger.error(`Failed to get ephemeral token from OpenAI API: ${sessionResponse.status} ${sessionResponse.statusText}`, errorBody);
            throw new Error(`OpenAI API error (${sessionResponse.status}): Failed to create session`);
        }

        // Parse the JSON response from OpenAI
        const sessionData = await sessionResponse.json();

        // Log success and send the data back to the client
        logger.info(`Successfully generated ephemeral token for model ${targetModel}.`);
        res.json(sessionData); // Send the entire response, which includes the client_secret

    } catch (error) {
        logger.error(`Error generating ephemeral session token: ${error.message}`, error);
        res.status(500).json({ error: 'Failed to generate session token.' });
    }
});


// --- Authentication API Routes ---

/**
 * POST /instructor/login
 * Handles instructor login attempts. No prior authentication required.
 * Uses the INSTRUCTOR session store.
 */
app.post('/instructor/login', async (req, res) => {
  try {
    // Extract email and password from the request body
    const { email, password } = req.body;
    // Basic validation
    if (!email || !password) return res.status(400).json({ 'error': 'Email and password required' });

    logger.info(`Instructor login attempt for email: ${email}`);

    // Find user in Firebase by email
    const users_ref = db.ref('users');
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');

    // Check if user exists
    if (!snapshot.exists()) {
        logger.info(`Login failed: Email not found - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    // Extract user data
    const [userId, user] = Object.entries(snapshot.val())[0];

    // Verify password
    if (!checkPasswordHash(user.password, password)) {
        logger.info(`Login failed: Invalid password for email - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    // Regenerate session ID upon successful login to prevent session fixation attacks
    req.session.regenerate((err) => {
        if (err) {
            logger.error('Session regeneration failed post-login:', err);
            return res.status(500).json({ error: 'Login session error' });
        }
        // Store instructor information in the INSTRUCTOR session
        req.session.user_id = userId;
        req.session.email = user.email;
        req.session.name = user.name || ''; // Use instructor's name or empty string

        logger.info(`Instructor login successful: ${userId} (${user.email}). New Session ID: ${req.session.id}`);
        // Send success response
        res.json({ 'success': true, name: req.session.name });
    });
  } catch (error) {
    logger.error(`Instructor login error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal login error' });
  }
});

/**
 * POST /instructor/signup
 * Handles new instructor account creation. No prior authentication required.
 * Uses the INSTRUCTOR session store upon successful signup for auto-login.
 */
app.post('/instructor/signup', async (req, res) => {
  try {
    // Extract details from request body
    const { name, email, password } = req.body;

    // --- Input Validation ---
    if (!name || !email || !password) return res.status(400).json({ 'error': 'Name, email, password required' });
    // Specific ADU faculty email validation
    const aduEmailRegex = /^[a-zA-Z0-9._%+-]+@adu\.ac\.ae$/;
    if (!aduEmailRegex.test(email)) {
        logger.info(`Invalid instructor signup email format: ${email}`);
        return res.status(400).json({ error: 'Invalid email format. Must be facultyname@adu.ac.ae' });
    }
    // Password length check
    if (password.length < 8) return res.status(400).json({ 'error': 'Password minimum 8 characters' });

    logger.info(`Instructor signup attempt: ${email}`);

    // Check if email already exists
    const users_ref = db.ref('users');
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    if (snapshot.exists()) {
        logger.info(`Signup failed: Email exists - ${email}`);
        return res.status(400).json({'error': 'Email already registered'});
    }

    // --- Create User ---
    // Hash the password before storing
    const hashed_password = generatePasswordHash(password);
    // Get a reference to a new user location in Firebase
    const new_user_ref = users_ref.push();
    const user_id = new_user_ref.key; // Get the unique key generated by push()
    // Set the new user's data
    await new_user_ref.set({
        name,
        email,
        password: hashed_password,
        created_at: Date.now() // Store creation timestamp
    });
    logger.info(`Instructor created: ${user_id} (${email})`);

    // --- Auto-Login After Signup ---
    req.session.regenerate((err) => {
         if (err) {
             logger.error('Session regeneration failed post-signup:', err);
             // Still send success, but inform user they need to log in manually
             return res.status(201).json({ success: true, message: 'Account created, session setup failed. Please log in.' });
         }
         // Store instructor info in the INSTRUCTOR session
         req.session.user_id = user_id;
         req.session.email = email;
         req.session.name = name;

         logger.info(`Instructor signup successful & logged in: ${user_id} (${email}). New Session ID: ${req.session.id}`);
         // Send success response (HTTP 201 Created)
         res.status(201).json({ 'success': true, name: req.session.name });
     });
  } catch (error) {
    logger.error(`Instructor signup error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal signup error' });
  }
});

/**
 * GET /instructor/logout
 * Logs out the currently logged-in instructor.
 * Destroys the INSTRUCTOR session.
 */
app.get('/instructor/logout', (req, res) => {
  // Get user name from session for logging, default to 'Instructor'
  const userName = req.session?.name || 'Instructor';
  const sessionId = req.session?.id; // Get session ID for logging

  // Destroy the session associated with the request
  req.session.destroy((err) => {
    if (err) {
        logger.error('Instructor session destroy error during logout:', err);
    } else {
        logger.info(`${userName} logged out (Session ID: ${sessionId}).`);
    }
    // Clear the INSTRUCTOR session cookie from the browser
    res.clearCookie('connect.sid.instructor');
    // Redirect to the instructor login page regardless of destroy errors
    res.redirect('/instructor/login');
  });
});

/**
 * GET /get_user_info
 * Retrieves information about the currently logged-in instructor.
 * Requires instructor authentication (`login_required`).
 */
app.get('/get_user_info', login_required, (req, res) => {
  // `login_required` middleware populates `req.user` from the INSTRUCTOR session
  res.json({
      name: req.user.name,
      email: req.user.email,
      user_id: req.user.id
  });
});

/**
 * POST /student/login
 * Handles student login attempts. No prior authentication required.
 * Uses the STUDENT session store.
 */
app.post('/student/login', async (req, res) => {
  try {
    // Extract credentials
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ 'error': 'Email and password required' });

    // Validate email domain (specific requirement)
    if (!email.toLowerCase().endsWith('@students.adu.ac.ae') && !email.toLowerCase().endsWith('@adu.ac.ae')) {
      return res.status(400).json({ 'error': 'Only ADU email addresses are allowed' });
    }

    logger.info(`Student login attempt for email: ${email}`);

    // Find student by email
    const students_ref = db.ref('students');
    const snapshot = await students_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');

    // Check if student exists
    if (!snapshot.exists()) {
        logger.info(`Student login failed: Email not found - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    // Extract student data
    const [studentId, student] = Object.entries(snapshot.val())[0];

    // Verify password
    if (!checkPasswordHash(student.password, password)) {
        logger.info(`Student login failed: Invalid password for email - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    // Determine student number (specific logic)
    let studentNumber = 'STAFF'; // Default for non-student domain emails
    if (email.toLowerCase().endsWith('@students.adu.ac.ae')) {
      studentNumber = email.split('@')[0]; // Extract part before @
    }

    // Regenerate session upon successful login
    req.session.regenerate((err) => {
        if (err) {
          logger.error('Student session regeneration failed post-login:', err);
          return res.status(500).json({ error: 'Login session error' });
        }
        // Store student information in the STUDENT session
        req.session.student_id = studentId;
        req.session.student_email = student.email;
        req.session.student_name = student.name || ''; // Use student's name or empty string
        req.session.student_number = studentNumber;

        logger.info(`Student login successful: ${studentId} (${student.email}). New Session ID: ${req.session.id}`);
        // Send success response
        res.json({
          'success': true,
          name: req.session.student_name,
          student_number: studentNumber
        });
    });
  } catch (error) {
    logger.error(`Student login error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal login error' });
  }
});

/**
 * POST /student/signup
 * Handles new student account creation. No prior authentication required.
 * Uses the STUDENT session store upon successful signup for auto-login.
 */
app.post('/student/signup', async (req, res) => {
  try {
    // Extract details
    const { name, email, password } = req.body;

    // --- Input Validation ---
    if (!name || !email || !password) return res.status(400).json({ 'error': 'Name, email, password required' });
    if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    // Domain validation
    if (!email.toLowerCase().endsWith('@students.adu.ac.ae') && !email.toLowerCase().endsWith('@adu.ac.ae')) {
      return res.status(400).json({ 'error': 'Only ADU email addresses are allowed' });
    }
    if (password.length < 8) return res.status(400).json({ 'error': 'Password minimum 8 characters' });

    logger.info(`Student signup attempt: ${email}`);

    // Check if email already exists
    const students_ref = db.ref('students');
    const snapshot = await students_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    if (snapshot.exists()) {
      logger.info(`Student signup failed: Email exists - ${email}`);
      return res.status(400).json({'error': 'Email already registered'});
    }

    // --- Create Student ---
    const hashed_password = generatePasswordHash(password);
    const new_student_ref = students_ref.push();
    const student_id = new_student_ref.key;

    // Determine student number
    let studentNumber = 'STAFF';
    if (email.toLowerCase().endsWith('@students.adu.ac.ae')) {
      studentNumber = email.split('@')[0];
    }

    // Set student data in Firebase
    await new_student_ref.set({
      name,
      email,
      password: hashed_password,
      created_at: Date.now(),
      student_number: studentNumber // Store derived student number
    });
    logger.info(`Student created: ${student_id} (${email})`);

    // --- Auto-Login After Signup ---
    req.session.regenerate((err) => {
      if (err) {
        logger.error('Student session regeneration failed post-signup:', err);
        return res.status(201).json({ success: true, message: 'Account created, session setup failed. Please log in.' });
      }
      // Store student info in the STUDENT session
      req.session.student_id = student_id;
      req.session.student_email = email;
      req.session.student_name = name;
      req.session.student_number = studentNumber;

      logger.info(`Student signup successful & logged in: ${student_id} (${email}). New Session ID: ${req.session.id}`);
      // Send success response (HTTP 201 Created)
      res.status(201).json({
        'success': true,
        name: req.session.student_name,
        student_number: studentNumber
      });
    });
  } catch (error) {
    logger.error(`Student signup error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal signup error' });
  }
});

/**
 * GET /student/logout
 * Logs out the currently logged-in student.
 * Destroys the STUDENT session.
 */
app.get('/student/logout', (req, res) => {
  const studentName = req.session?.student_name || 'Student';
  const sessionId = req.session?.id;

  // Destroy the STUDENT session
  req.session.destroy((err) => {
    if (err) {
        logger.error('Student session destroy error during logout:', err);
    } else {
        logger.info(`${studentName} logged out (Session ID: ${sessionId}).`);
    }
    // Clear the STUDENT session cookie
    res.clearCookie('connect.sid.student');
    // Redirect to student login page
    res.redirect('/student/login');
  });
});

/**
 * GET /get_student_info
 * Retrieves information about the currently logged-in student.
 * Requires student authentication (`student_required`).
 */
app.get('/get_student_info', student_required, (req, res) => {
  // `student_required` middleware populates `req.student` from the STUDENT session
  res.json({
    name: req.student.name,
    email: req.student.email,
    student_id: req.student.id,
    student_number: req.student.student_number
  });
});

/**
 * GET /get_student_lectures
 * Retrieves the list of lectures accessed by the currently logged-in student.
 * Requires student authentication (`student_required`).
 */
app.get('/get_student_lectures', student_required, async (req, res) => {
  try {
    // Get student ID from the authenticated session
    const student_id = req.student.id;
    logger.info(`Fetching lecture access history for student: ${student_id}`);

    // Fetch lecture access records for the student from Firebase
    const snapshot = await db.ref(`student_lectures/${student_id}`).once('value');
    if (!snapshot.exists()) {
      // No records found, return empty list
      return res.json({ 'lectures': [] });
    }

    // Process the access records
    const accessData = snapshot.val();
    // Create promises to fetch metadata for each accessed lecture
    const lecturePromises = Object.entries(accessData).map(async ([lectureCode, accessInfo]) => {
      // Fetch the corresponding lecture metadata
      const lectureSnapshot = await db.ref(`lectures/${lectureCode}/metadata`).once('value');
      const metadata = lectureSnapshot.exists() ? lectureSnapshot.val() : {}; // Use metadata or empty object

      // Return combined object
      return {
        code: lectureCode,
        last_accessed: accessInfo.timestamp, // Timestamp of last access by this student
        metadata: metadata
      };
    });

    // Wait for all metadata fetches to complete
    const lectures = await Promise.all(lecturePromises);

    // Sort lectures by most recently accessed
    lectures.sort((a, b) => b.last_accessed - a.last_accessed);

    // Return the sorted list of lectures
    return res.json({ 'lectures': lectures });
  } catch (error) {
    logger.error(`Get student lectures error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lecture history.' });
  }
});

// --- Lecture Management API Routes ---

/**
 * POST /generate_lecture_code
 * Creates a new lecture record with a unique code.
 * Requires instructor authentication (`login_required`).
 */
app.post('/generate_lecture_code', login_required, async (req, res) => {
  try {
    // Extract lecture details from request body
    const { course_code, date, time: time_str, instructor, set_active } = req.body;
    // Validate input
    if (!course_code || !date || !time_str || !instructor) return res.status(400).json({ 'error': 'All lecture details required' });

    logger.info(`Generating lecture: ${course_code} by instructor ${req.user.id}`); // Use instructor ID from session

    // Generate a unique code
    const lecture_code = await generate_unique_lecture_code();
    const now = Date.now();

    // Save lecture metadata to Firebase
    await db.ref(`lectures/${lecture_code}/metadata`).set({
      course_code,
      date,
      time: time_str,
      instructor,
      created_at: now,
      created_by: req.user.id // Associate with the logged-in instructor
    });

    // Optionally set this new lecture as the globally active one
    if (set_active) {
      logger.info(`Setting lecture ${lecture_code} active.`);
      await db.ref('active_lecture').set({
          code: lecture_code,
          path: `lectures/${lecture_code}/transcriptions`, // Path for transcriptions
          set_at: now,
          set_by: req.user.id // Track who set it active
      });
    }

    logger.info(`Generated lecture code: ${lecture_code}`);
    // Send success response with the new code
    return res.json({ 'lecture_code': lecture_code, 'success': true });
  } catch (error) {
    logger.error(`Error generating code: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to generate lecture code.' });
  }
});

/**
 * POST /join_lecture
 * Allows a logged-in student to access/join a lecture by its code.
 * Records the student's access and returns lecture metadata.
 * Requires student authentication (`student_required`).
 */
app.post('/join_lecture', student_required, async (req, res) => {
  try {
    // Extract lecture code from request body
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });

    logger.info(`Join attempt: ${lecture_code} by student ${req.student.id}`); // Use student ID from session

    // Validate lecture code existence
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) {
      logger.info(`Join failed: Code invalid - ${lecture_code}`);
      return res.status(404).json({ 'error': 'Invalid lecture code' }); // 404 Not Found
    }

    // --- Record Student Access ---
    const now = Date.now();
    // Store access record under student_lectures/[student_id]/[lecture_code]
    await db.ref(`student_lectures/${req.student.id}/${lecture_code}`).set({
      timestamp: now, // Timestamp of this access
      // Optionally store redundant student info for easier querying later if needed
      student_id: req.student.id,
      student_number: req.student.student_number,
      student_email: req.student.email
    });

    logger.info(`Join successful: ${lecture_code} by student ${req.student.id}`);
    // Send success response with lecture metadata
    return res.json({
      success: true,
      metadata: snapshot.val() || {}, // Return metadata or empty object
      path: `lectures/${lecture_code}/transcriptions` // Path to transcriptions (optional)
    });
  } catch (error) {
    logger.error(`Join error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to join lecture.' });
  }
});

/**
 * GET /get_lecture_transcriptions
 * Retrieves transcriptions for a given lecture code.
 * Allows fetching transcriptions after a specific timestamp (for polling).
 * Requires student authentication (`student_required`).
 */
app.get('/get_lecture_transcriptions', student_required, async (req, res) => {
  try {
    // Extract lecture_code and optional timestamp filter from query parameters
    const { lecture_code, since: after_timestamp } = req.query; // Client uses 'since', maps to 'after_timestamp' here
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });

    // Logged-in student ID (from student_required middleware)
    const student_id = req.student.id;

    // --- Fetch Transcriptions ---
    const transcriptions_ref = db.ref(`lectures/${lecture_code}/transcriptions`);
    let query = transcriptions_ref.orderByChild('timestamp'); // Order by timestamp

    // Apply filter if 'after_timestamp' is provided and valid
    if (after_timestamp && !isNaN(parseInt(after_timestamp))) {
      query = query.startAfter(parseInt(after_timestamp)); // Fetch items with timestamp > after_timestamp
    }

    // Execute the query
    const snapshot = await query.once('value');
    const data = snapshot.val() || {}; // Get data or empty object

    // Convert Firebase object to sorted array
    const transcriptions = Object.entries(data)
        .map(([id, value]) => ({ id, ...value })) // Include Firebase key as 'id'
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // Sort chronologically

    logger.debug(`Returning ${transcriptions.length} transcriptions for ${lecture_code} (student ${student_id})`);
    return res.json({ 'transcriptions': transcriptions });
  } catch (error) {
    logger.error(`Get transcriptions error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve transcriptions.' });
  }
});

/**
 * GET /get_instructor_lectures
 * Retrieves all lectures created by the currently logged-in instructor.
 * Requires instructor authentication (`login_required`).
 */
app.get('/get_instructor_lectures', login_required, async (req, res) => {
  try {
    // Get instructor ID from the authenticated session
    const user_id = req.user.id;
    logger.info(`Fetching lectures for instructor: ${user_id}`);

    // Query Firebase for lectures where metadata/created_by matches the instructor's ID
    const snapshot = await db.ref('lectures')
        .orderByChild('metadata/created_by') //Requires .indexOn rule in Firebase for performance
        .equalTo(user_id)
        .once('value');

    const data = snapshot.val() || {}; // Get data or empty object

    // Convert Firebase object to array and sort by creation date (descending)
    const lectures = Object.entries(data)
        .map(([code, lecture]) => ({ code, metadata: lecture.metadata || {} }))
        .sort((a,b)=> (b.metadata.created_at || 0) - (a.metadata.created_at || 0));

    logger.info(`Found ${lectures.length} lectures for instructor: ${user_id}`);
    return res.json({ 'lectures': lectures });
  } catch (error) {
    logger.error(`Get instructor lectures error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lectures.' });
  }
});

/**
 * GET /get_lecture_info
 * Retrieves metadata for a specific lecture code.
 * Currently public, add auth middleware (`student_required` or `login_required`) if needed.
 */
app.get('/get_lecture_info', async (req, res) => {
  try {
    // Extract lecture code from query parameters
    const { code } = req.query;
    if (!code) return res.status(400).json({ 'error': 'Lecture code required' });

    // Fetch metadata from Firebase
    const snapshot = await db.ref(`lectures/${code}/metadata`).once('value');
    if (!snapshot.exists()) {
      logger.info(`Info failed: Lecture not found - ${code}`);
      return res.status(404).json({ 'error': 'Lecture not found' }); // 404 Not Found
    }
    // Return success response with metadata
    return res.json({ success: true, metadata: snapshot.val() || {} });
  } catch (error) {
    logger.error(`Get lecture info error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lecture info.' });
  }
});

/**
 * GET /active_lecture
 * Retrieves the currently globally active lecture code, if any.
 * No authentication required.
 */
app.get('/active_lecture', async (req, res) => {
  try {
    // Fetch the 'active_lecture' node from Firebase
    const snapshot = await db.ref('active_lecture').once('value');
    const activeData = snapshot.val();

    // Check if an active lecture exists
    if (!activeData?.code) {
      logger.debug('No active lecture.');
      return res.json(null); // Return null if no active lecture
    }

    logger.debug(`Active lecture is: ${activeData.code}`);
    return res.json(activeData); // Return the active lecture data
  } catch (error) {
    logger.error(`Get active lecture error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get active lecture status.' });
  }
});

/**
 * POST /set_active_lecture
 * Sets a specific lecture as the globally active lecture.
 * Requires instructor authentication (`login_required`).
 */
app.post('/set_active_lecture', login_required, async (req, res) => {
  try {
    // Extract lecture code from request body
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });

    // Get instructor ID from session
    const instructor_id = req.user.id;
    logger.info(`Setting active lecture: ${lecture_code} by instructor ${instructor_id}`);

    // Validate lecture code existence
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) {
      logger.info(`Set active failed: Lecture not found - ${lecture_code}`);
      return res.status(404).json({ 'error': 'Invalid lecture code' });
    }

    // --- Optional Authorization Check ---
    // Ensure the lecture being set active was created by the logged-in instructor
    // if (snapshot.val().created_by !== instructor_id) {
    //   logger.warn(`Set active forbidden: Lecture ${lecture_code} not owned by instructor ${instructor_id}`);
    //   return res.status(403).json({ 'error': 'Forbidden: You can only activate lectures you created.' });
    // }
    // --- End Optional Check ---

    // Update the 'active_lecture' node in Firebase
    await db.ref('active_lecture').set({
      code: lecture_code,
      path: `lectures/${lecture_code}/transcriptions`,
      set_at: Date.now(),
      set_by: instructor_id // Record who set it active
    });

    logger.info(`Set active lecture successful: ${lecture_code}`);
    return res.json({ 'success': true });
  } catch (error) {
    logger.error(`Set active lecture error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to set active lecture.' });
  }
});

// --- Recording Control API Routes (Manage Active State and WebSockets) ---

/**
 * POST /start_recording
 * Marks a lecture as actively recording.
 * Requires instructor authentication (`login_required`).
 */
app.post('/start_recording', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });

    const instructor_id = req.user.id;
    logger.info(`'/start_recording' API called for ${lecture_code} by instructor ${instructor_id}`);

    // Validate lecture exists
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) return res.status(404).json({ 'error': 'Lecture not found' });

    // Optional: Authorization check (lecture belongs to instructor)
    // if (snapshot.val().created_by !== instructor_id) { ... return 403 ... }

    // Set the lecture as active AND explicitly mark as recording in the lecture's status
    const now = Date.now();
    // Create a dedicated status node with explicit isCurrentlyRecording flag
    await db.ref(`lectures/${lecture_code}/status`).set({
        isCurrentlyRecording: true,
        last_started: now,
        started_by: instructor_id
    });
    // Keep the active_lecture node for now as other parts might rely on it,
    // but the primary source for recording status should be the flag above.
    await db.ref('active_lecture').set({
        code: lecture_code,
        path: `lectures/${lecture_code}/transcriptions`,
        set_at: now,
        set_by: instructor_id
    });

    logger.info(`Lecture ${lecture_code} marked as recording.`);
    // Respond indicating success
    return res.json({ success: true, message: 'Lecture recording started.', start_time: now });
  } catch (error) {
    logger.error(`Start recording error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to start recording.' });
  }
});

/**
 * POST /stop_recording
 * Marks a lecture as not actively recording.
 * Requires instructor authentication (`login_required`).
 */
app.post('/stop_recording', login_required, async (req, res) => {
  try {
    // Lecture code to stop (optional, defaults to current active if not provided)
    const { lecture_code } = req.body;
    const instructor_id = req.user.id;
    logger.info(`'/stop_recording' API called (for ${lecture_code || 'current active'}) by instructor ${instructor_id}`);

    // Get current active lecture (still useful to clear the global flag if needed)
    const activeRef = db.ref('active_lecture');
    const activeSnapshot = await activeRef.once('value');
    const currentActiveCode = activeSnapshot.val()?.code;

    let message = 'No specific lecture code provided and no lecture was globally active.';

    // Determine the lecture code to stop
    const codeToStop = lecture_code || currentActiveCode;

    // Check if there is a lecture code to stop
    if (codeToStop) {
        // Explicitly mark the specific lecture as NOT recording
        await db.ref(`lectures/${codeToStop}/status`).update({
            isCurrentlyRecording: false,
            last_stopped: Date.now(),
            stopped_by: instructor_id
        });
        logger.info(`Marked lecture ${codeToStop} as not recording.`);
        message = `Recording stopped for ${codeToStop}.`;

        // Also clear the global active_lecture flag if it matches the stopped lecture
        if (currentActiveCode === codeToStop) {
            await activeRef.remove();
            logger.info(`Cleared active lecture flag for ${codeToStop}.`);
        }
    } else {
         // No lecture code specified and none was active
         logger.info(message);
    }

    // Respond with success and status message
    return res.json({ success: true, message });
  } catch (error) {
    logger.error(`Stop recording error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to stop recording.' });
  }
});

/**
 * GET /recording_status
 * Checks the explicit recording status flag for a specific lecture code.
 * Requires student authentication (`student_required`).
 */
app.get('/recording_status', student_required, async (req, res) => { // Added student_required
  try {
    // Get lecture code from query parameters
    const lecture_code = req.query.lecture_code;
    if (!lecture_code) return res.status(400).json({ error: 'Lecture code required' });

    // --- Read the explicit recording status flag ---
    const statusRef = db.ref(`lectures/${lecture_code}/status`);
    const statusSnapshot = await statusRef.once('value');
    const statusData = statusSnapshot.val();

    // Check the explicit flag `isCurrentlyRecording`
    const isRecording = statusData?.isCurrentlyRecording === true;
    const sessionStartTime = statusData?.last_started || null; // Use the timestamp when recording was last started

    logger.debug(`Recording status check for ${lecture_code}: ${isRecording}`);
    
    // Return recording status explicitly
    return res.json({ 
      is_recording: isRecording, 
      session_start_time: sessionStartTime 
    });
  } catch (error) {
    logger.error(`Error checking recording status: ${error.message}`);
    return res.status(500).json({ error: 'Failed to check recording status' });
  }
});

// --- Transcription Saving API Route (for WebRTC) ---

/**
 * POST /save_transcription
 * Receives transcription data (likely from a client using WebRTC) and saves it to Firebase.
 * Requires instructor authentication as they control the recording session.
 */
app.post('/save_transcription', login_required, async (req, res) => {
    try {
        const { lecture_code, text, timestamp, event_type, item_id } = req.body;
        const instructor_id = req.user.id; // From login_required middleware

        // Basic validation
        if (!lecture_code || !text || !timestamp || !event_type || !item_id) {
            logger.warn(`Save transcription failed: Missing required fields. Received:`, req.body);
            return res.status(400).json({ error: 'Missing required transcription data (lecture_code, text, timestamp, event_type, item_id)' });
        }

        // Optional: Validate lecture code existence and ownership (could add overhead)
        // const lectureSnapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
        // if (!lectureSnapshot.exists() || lectureSnapshot.val().created_by !== instructor_id) {
        //     logger.error(`Save transcription forbidden: Invalid lecture code (${lecture_code}) or not owner (${instructor_id}).`);
        //     return res.status(403).json({ error: 'Forbidden or invalid lecture code' });
        // }
// Only save the completed transcription events to Firebase
if (event_type === 'conversation.item.input_audio_transcription.completed') {
    logger.debug(`Saving completed transcription for ${lecture_code} (item: ${item_id})`);

    // Save transcription to Firebase
    await db.ref(`lectures/${lecture_code}/transcriptions`).push().set({
        text: text,
        timestamp: timestamp,
        item_id: item_id,       // OpenAI's identifier
        event_type: event_type, // Should always be 'completed' here
        source: 'webrtc_api'    // Indicate the source
    });

    return res.status(201).json({ success: true, saved: true }); // Indicate save occurred and RETURN
} else if (event_type === 'conversation.item.input_audio_transcription.delta') {
     logger.debug(`Ignoring delta transcription for ${lecture_code} (item: ${item_id}) for saving.`);
     return res.status(200).json({ success: true, saved: false }); // Acknowledge receipt, but didn't save, and RETURN
} else {
     logger.warn(`Received unknown event type to save: ${event_type}`);
     res.status(400).json({ error: 'Unknown event type received' });
}
        // Removed redundant response send here, responses are handled within the if/else blocks.

    } catch (error) {
        logger.error(`Error saving transcription via API: ${error.message}`, error);
        // Only send error response if headers haven't already been sent
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to save transcription.' });
        }
    }
});


// --- Fallback Transcription API Route ---

/**
 * POST /fallback_transcription
 * Accepts an audio file upload and transcribes it using OpenAI's standard API.
 * Used when the realtime WebSocket connection fails or is unavailable.
 * No authentication required (relies on valid lecture_code in the body).
 * Uses multer middleware (`upload.single('audio')`) to handle the file upload.
 */
app.post('/fallback_transcription', upload.single('audio'), async (req, res) => {
    logger.info(`Fallback transcription request received`);

    // Check if a file was actually uploaded
    if (!req.file) {
        logger.error('Fallback: No audio file.');
        return res.status(400).json({ error: 'No audio file uploaded' });
    }

    // Extract lecture code from the request body and get the temporary file path
    const lectureCode = req.body.lecture_code;
    const audioFilePath = req.file.path; // Path where multer saved the temporary file
    let extension = 'webm'; // Default extension

    // Validate required inputs
    if (!lectureCode || !audioFilePath) {
        logger.error('Fallback: Missing lecture code or file path.');
        // Clean up temporary file if it exists
        if (audioFilePath) fs.unlink(audioFilePath, (err) => { if(err) logger.error("Error deleting temp file on validation fail:", err); });
        return res.status(400).json({ error: 'Lecture code and audio required' });
    }

    logger.info(`Fallback processing: ${lectureCode}, file: ${audioFilePath}, size: ${req.file.size}`);

    try {
        // --- Validate Lecture Code ---
        const snapshot = await db.ref(`lectures/${lectureCode}/metadata`).once('value');
        if (!snapshot.exists()) {
            logger.info(`Fallback failed: Invalid code - ${lectureCode}`);
            fs.unlink(audioFilePath, () => {}); // Clean up temp file
            return res.status(404).json({ error: 'Invalid lecture code' });
        }

        // --- Check OpenAI Availability ---
        if (!isOpenAiAvailable()) {
            logger.error('Fallback failed: OpenAI unavailable.');
            fs.unlink(audioFilePath, () => {}); // Clean up temp file
            return res.status(503).json({ error: 'AI service unavailable' }); // 503 Service Unavailable
        }

        // --- Prepare File for OpenAI ---
        // Determine file extension from MIME type for OpenAI compatibility
        const originalMimeType = req.file.mimetype || 'audio/webm';
        if (originalMimeType.includes('webm')) extension = 'webm';
        else if (originalMimeType.includes('mp3') || originalMimeType.includes('mpeg')) extension = 'mp3';
        else if (originalMimeType.includes('wav')) extension = 'wav';
        else if (originalMimeType.includes('mp4') || originalMimeType.includes('m4a')) extension = 'mp4';
        else if (originalMimeType.includes('ogg')) extension = 'ogg';
        // Create a new file path with the correct extension (OpenAI often relies on extension)
        const properFileName = `${path.basename(audioFilePath)}.${extension}`;
        const properFilePath = path.join(path.dirname(audioFilePath), properFileName);
        // Rename the temporary file to include the correct extension
        fs.renameSync(audioFilePath, properFilePath);
        logger.info(`Renamed file to match format: ${properFilePath} with extension .${extension}`);

        // --- Call OpenAI Transcription API ---
        logger.info(`Sending fallback audio to OpenAI standard API: ${properFilePath}`);
        const transcription = await client.audio.transcriptions.create({
            file: fs.createReadStream(properFilePath), // Stream the renamed file
            model: "gpt-4o-transcribe",       // Specify the transcription model
            response_format: "json",           // Request JSON response
            language: "en",                    // Language hint
            // Provide context prompt for better accuracy
            prompt: "This audio is from an academic lecture. Transcribe meaningful speech only. Ignore filler words (like um, uh), gibberish, and non-English speech. Focus on educational content. You must not include this prompt or any part of this prompt in your response; only inlcude the actual lecture speech transcription. If the audio is contains no meaningful speech, respond with a single space character and nothing else.",
        });

        // --- Process Transcription Result ---
        const text = transcription?.text?.trim() || ''; // Extract text, trim whitespace
        if (text) {
            // Transcription successful and not empty
            logger.info(`Fallback success (standard API): "${text.substring(0, 50)}..."`);
            const timestamp = Date.now();
            // Save the fallback transcription to Firebase
            await db.ref(`lectures/${lectureCode}/transcriptions`).push().set({
                text,
                timestamp,
                source: 'fallback_api' // Indicate the source was fallback
            });
            // Respond to the client with success and the transcription
            return res.json({ success: true, text, timestamp });
        } else {
            // Transcription result was empty
            logger.info('Fallback: Empty transcription result.');
            return res.json({ success: true, text: '', timestamp: Date.now() });
        }
    } catch (error) {
        // Handle errors during fallback processing (e.g., OpenAI API errors)
        logger.error(`Fallback processing error: ${error.message}`, error);
        let apiErrorMsg = `Transcription error: ${error.message}`;
        // Format OpenAI specific errors more clearly if possible
        if (error.status) apiErrorMsg = `OpenAI API Error (${error.status}): ${error.error?.message || error.message}`;
        return res.status(500).json({ error: apiErrorMsg });
    } finally {
        // --- Cleanup Temporary Files ---
        // Always attempt to delete the temporary audio file(s)
        try {
            // Attempt to delete the original path (might have been renamed)
            if (fs.existsSync(audioFilePath)) {
                fs.unlinkSync(audioFilePath);
                logger.debug(`Temp fallback file deleted: ${audioFilePath}`);
            }
            // Attempt to delete the renamed path (if it's different)
            const properFileName = `${path.basename(audioFilePath)}.${extension || 'webm'}`;
            const properFilePath = path.join(path.dirname(audioFilePath), properFileName);
            if (fs.existsSync(properFilePath) && properFilePath !== audioFilePath) {
                fs.unlinkSync(properFilePath);
                logger.debug(`Temp renamed fallback file deleted: ${properFilePath}`);
            }
        } catch (err) {
            // Log errors during cleanup, but don't fail the request
            logger.error(`Error deleting temp file(s): ${err.message}`);
        }
    }
});

// --- AI Explanation/Summary API Routes ---
// These endpoints use OpenAI's chat completions for analysis tasks.

/**
 * POST /get_explanation
 * Generates an explanation for a given text snippet based on a specified option.
 * Requires student authentication (`student_required`).
 */
app.post('/get_explanation', student_required, async (req, res) => {
  try {
    // Log entry into the route handler immediately
    logger.debug(`[get_explanation] Entered route handler for student ${req.student?.id}`);
    // Log the received Content-Type header and the request body
    logger.debug(`[get_explanation] Request Content-Type: ${req.headers['content-type']}`);
    logger.debug(`[get_explanation] Request Body (raw): ${JSON.stringify(req.body)}`);
    // Extract text and explanation option from request body
    const { text, option = 'explain' } = req.body; // Default to 'explain' if no option provided
    // Validate input
    if (!text) return res.status(400).json({ 'error': 'Text required' });
    // Check OpenAI availability
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });
    
    // Determine the system prompt key based on the option
    const systemPromptKey = option === 'practice' ? 'practice_context' : option;
    
    // Modified validation - check if the systemPromptKey exists in system_prompts
    if (!system_prompts[systemPromptKey]) return res.status(400).json({ error: 'Invalid option' });

    const student_id = req.student.id; // Get student ID from session
    logger.info(`Streaming explanation (option: ${option}) for student ${student_id}...`);

    // --- Prepare OpenAI Request ---
    // Construct messages array with system prompt and user text
    // Add detailed logging before the check
    logger.debug(`[get_explanation] Received option: '${option}', Derived systemPromptKey: '${systemPromptKey}'`);
    const systemPrompt = system_prompts[systemPromptKey];
    logger.debug(`[get_explanation] Looked up system_prompts['${systemPromptKey}']: ${systemPrompt ? 'Found' : 'NOT Found'}`);

    // Validate that a prompt was found for the derived key
    if (!systemPrompt) {
        // Add error logging here too for clarity when it fails
        logger.error(`[get_explanation] Validation failed: No system prompt found for key '${systemPromptKey}' (derived from option '${option}').`);
        return res.status(400).json({ error: 'Invalid option provided' });
    }
    const messages = [
        { "role": "system", "content": systemPrompt }, // Use the selected system prompt
        { "role": "user", "content": text }            // User's text input (the chat bubble content)
    ];

    // --- Set Headers for SSE ---
    res.setHeader('Content-Type', 'text-event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately


    // --- Call OpenAI and Stream Response ---
    const stream = await client.chat.completions.create({
        // model: "o3-mini",    // Specify the chat model
        // The structure of answer seems far more pleasent and visually appealing
        //  with 4o-mini.
        model: "gpt-4o-mini",    // Specify the chat model
        messages: messages,     // Provide the conversation history/prompt
        temperature: 0.5,       // CANNOT USE WITH o3-mini! Control randomness (lower is more focused)
        stream: true            // Enable streaming
    });

    // --- Process Stream ---
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        // Send chunk as SSE data event
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }
    }

    // --- Signal End of Stream ---
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end(); // Close the connection
    logger.info(`Finished streaming explanation for student ${student_id}.`);

  } catch (error) {
    logger.error(`Get explanation stream error: ${error.message}`, error);
    // Try to send an error event if headers haven't been sent (though they likely have)
    if (!res.headersSent) {
        res.status(500).json({ 'error': 'Failed to get explanation.' });
    } else {
        // If headers are sent, try sending an error event via SSE before ending
        try {
            res.write(`data: ${JSON.stringify({ error: 'Failed to get explanation.' })}\n\n`);
        } catch (sseError) {
            logger.error('Failed to send SSE error event:', sseError);
        }
        res.end(); // Ensure the connection is closed
    }
  }
});

/**
 * POST /get_summary
 * Generates a summary for a given text snippet, specifying the time duration it covers.
 * Requires student authentication (`student_required`).
 */
app.post('/get_summary', student_required, async (req, res) => {
  try {
    // Extract text and minutes from request body
    const { text, minutes } = req.body;
    // Validate input
    if (!text || minutes === undefined || isNaN(parseInt(minutes))) return res.status(400).json({ 'error': 'Text and minutes required' });
    // Check OpenAI availability
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });

    const student_id = req.student.id; // Get student ID from session
    logger.info(`Streaming summary for last ${minutes} min for student ${student_id}...`);

    // --- Prepare OpenAI Request ---
    // Get the appropriate system prompt (it's a function for summary)
    const promptContent = typeof system_prompts.summary === 'function'
        ? system_prompts.summary(minutes)
        : 'Summarize the provided text.'; // Fallback prompt
    // Construct messages array
    const messages = [
        { "role": "system", "content": promptContent }, // System instruction
        { "role": "user", "content": text }              // User's text input
    ];

    // --- Set Headers for SSE ---
    res.setHeader('Content-Type', 'text-event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send headers immediately

    // --- Call OpenAI and Stream Response ---
    const stream = await client.chat.completions.create({
        // model: "o3-mini",    // Specify the chat model
        model: "gpt-4o-mini",    // Specify the chat model
        messages: messages,     // Provide the conversation history/prompt
        temperature: 0.6,       // CANNOT USE WITH o3-mini! Slightly higher temperature for potentially more varied summaries
        stream: true            // Enable streaming
    });

    // --- Process Stream ---
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        // Send chunk as SSE data event
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }
    }

    // --- Signal End of Stream ---
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end(); // Close the connection
    logger.info(`Finished streaming summary for student ${student_id}.`);

  } catch (error) {
    logger.error(`Get summary stream error: ${error.message}`, error);
    // Try to send an error event if headers haven't been sent
    if (!res.headersSent) {
        res.status(500).json({ 'error': 'Failed to get summary.' });
    } else {
        // If headers are sent, try sending an error event via SSE before ending
        try {
            res.write(`data: ${JSON.stringify({ error: 'Failed to get summary.' })}\n\n`);
        } catch (sseError) {
            logger.error('Failed to send SSE error event:', sseError);
        }
        res.end(); // Ensure the connection is closed
    }
  }
});

// --- NEW: Endpoint for Entire Lecture Summary ---
app.post('/get_summary_entire', student_required, async (req, res) => {
  try {
    const { text, lecture_code } = req.body; // Expecting the full transcript text
    if (!text || !lecture_code) return res.status(400).json({ 'error': 'Full text and lecture code required' });
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });

    const student_id = req.student.id;
    logger.info(`Streaming entire summary for lecture ${lecture_code} for student ${student_id}...`);

    const messages = [
        { "role": "system", "content": system_prompts['summary_entire'] },
        { "role": "user", "content": text }
    ];

    res.setHeader('Content-Type', 'text-event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages,
        temperature: 0.6,
        stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    logger.info(`Finished streaming entire summary for student ${student_id}.`);

  } catch (error) {
    logger.error(`Get entire summary stream error: ${error.message}`, error);
    if (!res.headersSent) {
        res.status(500).json({ 'error': 'Failed to get entire summary.' });
    } else {
        try { res.write(`data: ${JSON.stringify({ error: 'Failed to get entire summary.' })}\n\n`); }
        catch (sseError) { logger.error('Failed to send SSE error event:', sseError); }
        res.end();
    }
  }
});

// --- NEW: Endpoint for Lecture-Wide Practice Problems ---
app.post('/generate_practice_problems_lecture', student_required, async (req, res) => {
  try {
    const { text, lecture_code } = req.body; // Expecting the full transcript text
    if (!text || !lecture_code) return res.status(400).json({ 'error': 'Full text and lecture code required' });
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });

    const student_id = req.student.id;
    logger.info(`Streaming lecture practice problems for ${lecture_code} for student ${student_id}...`);

    const messages = [
        { "role": "system", "content": system_prompts['practice_lecture'] },
        { "role": "user", "content": text }
    ];

    res.setHeader('Content-Type', 'text-event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages,
        temperature: 0.7, // Slightly higher temp for more varied questions
        stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    logger.info(`Finished streaming lecture practice problems for student ${student_id}.`);

  } catch (error) {
    logger.error(`Generate lecture practice problems stream error: ${error.message}`, error);
    if (!res.headersSent) {
        res.status(500).json({ 'error': 'Failed to generate practice problems.' });
    } else {
        try { res.write(`data: ${JSON.stringify({ error: 'Failed to generate practice problems.' })}\n\n`); }
        catch (sseError) { logger.error('Failed to send SSE error event:', sseError); }
        res.end();
    }
  }
});

// --- NEW: Endpoint for Creating Lecture Notes PDF ---
app.post('/create_lecture_notes', student_required, async (req, res) => {
  try {
    const { text, lecture_code, course_code, instructor, date, time } = req.body;
    if (!text || !lecture_code) return res.status(400).json({ 'error': 'Full text and lecture code required' });
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });

    const student_id = req.student.id;
    const student_number = req.student.student_number || 'N/A'; // Get student number from session
    logger.info(`Generating lecture notes PDF for ${lecture_code} for student ${student_id}...`);

    // --- 1. Generate Structured Notes Content using OpenAI ---
    const metadataContext = `Lecture Metadata:\nCourse Code: ${course_code || 'N/A'}\nInstructor: ${instructor || 'N/A'}\nDate: ${date || 'N/A'}\nTime: ${time || 'N/A'}\nStudent ID: ${student_number}`; // Include student number/ID
    const messages = [
        { "role": "system", "content": system_prompts['lecture_notes_structure'] },
        { "role": "user", "content": `${metadataContext}\n\nLecture Transcript:\n${text}` } // Combine metadata and transcript
    ];

    // Get the full response (not streaming for this part, as we need the whole content for PDF)
    const completion = await client.chat.completions.create({
        model: "gpt-4o-mini", // Or a more powerful model if needed for structure
        messages: messages,
        temperature: 0.5,
        stream: false // We need the complete response here
    });

    const markdownNotes = completion.choices[0]?.message?.content || 'Error: Could not generate notes content.';
    logger.info(`Generated Markdown notes content for ${lecture_code}. Length: ${markdownNotes.length}`);

    // --- 2. Generate PDF from Markdown ---
    const doc = new PDFDocument({ margin: 50 }); // Create a new PDF document

    // Set headers for PDF download
    const safeCourseCode = (course_code || 'Lecture').replace(/[^a-z0-9]/gi, '_');
    const safeDate = (date ? date.replace(/[^a-z0-9]/gi, '-') : new Date().toISOString().split('T')[0]);
    const filename = `LectureNotes_${safeCourseCode}_${safeDate}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Pipe the PDF output directly to the response stream
    doc.pipe(res);

    // --- Basic Markdown to PDF Conversion (using pdfkit features) ---
    // This is a simplified conversion. More complex Markdown needs a dedicated library.
    doc.fontSize(18).text(`Lecture Notes: ${course_code || 'Untitled'}`, { align: 'center' }).moveDown(0.5);
    doc.fontSize(10).text(`Instructor: ${instructor || 'N/A'} | Date: ${date || 'N/A'} | Time: ${time || 'N/A'}`, { align: 'center' });
    doc.fontSize(10).text(`Student ID: ${student_number}`, { align: 'center' }).moveDown(1.5);

    // Split notes into lines and process basic Markdown
    const lines = markdownNotes.split('\n');
    let listType = null; // null, 'ul', 'ol'
    let listCounter = 1;

    lines.forEach(line => {
        line = line.trimEnd(); // Remove trailing whitespace

        // Reset list if line is empty
        if (line.trim() === '') {
            listType = null;
            listCounter = 1;
            doc.moveDown(0.5); // Add some space
            return;
        }

        // Headings (simplified)
        if (line.startsWith('# ')) {
            listType = null; doc.fontSize(16).font('Helvetica-Bold').text(line.substring(2)).font('Helvetica').moveDown(0.5);
        } else if (line.startsWith('## ')) {
            listType = null; doc.fontSize(14).font('Helvetica-Bold').text(line.substring(3)).font('Helvetica').moveDown(0.5);
        } else if (line.startsWith('### ')) {
            listType = null; doc.fontSize(12).font('Helvetica-Bold').text(line.substring(4)).font('Helvetica').moveDown(0.5);
        }
        // Unordered list
        else if (line.startsWith('* ') || line.startsWith('- ')) {
            if (listType !== 'ul') listCounter = 1; // Reset counter if switching list type
            listType = 'ul';
            doc.fontSize(11).text(`  • ${line.substring(2)}`, { continued: false }).moveDown(0.2);
        }
        // Ordered list (basic)
        else if (/^\d+\.\s/.test(line)) {
             if (listType !== 'ol') listCounter = 1; // Reset counter if switching list type
             listType = 'ol';
             // Use actual number from Markdown if possible, otherwise use counter
             const numMatch = line.match(/^(\d+)\.\s/);
             const num = numMatch ? numMatch[1] : listCounter++;
             doc.fontSize(11).text(`  ${num}. ${line.substring(line.indexOf('.') + 2)}`, { continued: false }).moveDown(0.2);
        }
        // Emphasis/Bold (very basic - just renders text)
        // A real solution would need more complex parsing and font switching.
        else if (line.includes('*') || line.includes('_')) {
             listType = null;
             // Simple rendering, doesn't actually apply bold/italic
             doc.fontSize(11).text(line.replace(/[*_]/g, ''), { continued: false }).moveDown(0.3);
        }
        // Default paragraph text
        else {
            listType = null;
            doc.fontSize(11).text(line, { continued: false }).moveDown(0.3);
        }
    });

    // Finalize the PDF and end the stream
    doc.end();
    logger.info(`Successfully streamed lecture notes PDF for ${lecture_code} to student ${student_id}.`);

  } catch (error) {
    logger.error(`Create lecture notes PDF error: ${error.message}`, error);
    // Ensure response ends if headers haven't been sent
    if (!res.headersSent) {
        res.status(500).json({ 'error': 'Failed to create lecture notes PDF.' });
    } else if (!res.writableEnded) {
        // If headers sent but stream not ended, try to end it.
        res.end();
    }
  }
});

/**
 * POST /create_quiz
 * Creates a new quiz for a specific lecture.
 * Requires instructor authentication (`login_required`).
 */
app.post('/create_quiz', login_required, async (req, res) => {
  try {
    const { lecture_code, question, type, options, correctAnswer, timeLimit } = req.body;
    
    if (!lecture_code || !question || !type || !correctAnswer || !timeLimit) {
      return res.status(400).json({ 'error': 'Missing required quiz fields', 'success': false });
    }
    
    // Validate quiz type
    if (type !== 'multiple_choice' && type !== 'short_answer') {
      return res.status(400).json({ 'error': 'Invalid quiz type', 'success': false });
    }
    
    // Validate options for multiple choice
    if (type === 'multiple_choice' && (!options || !Array.isArray(options) || options.length < 2)) {
      return res.status(400).json({ 'error': 'Multiple choice requires at least 2 options', 'success': false });
    }
    
    // Validate time limit (minimum 10 seconds, maximum 600 seconds/10 minutes)
    if (timeLimit < 10 || timeLimit > 600) {
      return res.status(400).json({ 'error': 'Time limit must be between 10 and 600 seconds', 'success': false });
    }
    
    const instructor_id = req.user.id;
    logger.info(`Creating quiz for lecture ${lecture_code} by instructor ${instructor_id}`);
    
    // Generate unique ID for the quiz
    const quizRef = db.ref(`lectures/${lecture_code}/quizzes`).push();
    const quiz_id = quizRef.key;
    
    // Create quiz object
    const quiz = {
      id: quiz_id,
      lecture_code,
      question,
      type,
      options: type === 'multiple_choice' ? options : null,
      correctAnswer,
      timeLimit: parseInt(timeLimit),
      status: 'draft',
      created_at: Date.now(),
      created_by: instructor_id
    };
    
    // Save to Firebase
    await quizRef.set(quiz);
    
    logger.info(`Quiz created: ${quiz_id} for lecture ${lecture_code}`);
    return res.json({ 'success': true, 'quiz_id': quiz_id, 'quiz': quiz });
  } catch (error) {
    logger.error(`Create quiz error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to create quiz', 'success': false });
  }
});

/**
 * POST /activate_quiz
 * Activates a quiz, making it live for students.
 * Requires instructor authentication (`login_required`).
 */
app.post('/activate_quiz', login_required, async (req, res) => {
  try {
    const { lecture_code, quiz_id } = req.body;
    
    if (!lecture_code || !quiz_id) {
      return res.status(400).json({ 'error': 'Lecture code and quiz ID required', 'success': false });
    }
    
    const instructor_id = req.user.id;
    logger.info(`Activating quiz ${quiz_id} for lecture ${lecture_code} by instructor ${instructor_id}`);
    
    // Get the quiz
    const quizRef = db.ref(`lectures/${lecture_code}/quizzes/${quiz_id}`);
    const quizSnapshot = await quizRef.once('value');
    
    if (!quizSnapshot.exists()) {
      return res.status(404).json({ 'error': 'Quiz not found', 'success': false });
    }
    
    const quiz = quizSnapshot.val();
    
    // Update quiz status
    const startTime = Date.now();
    const endTime = startTime + (quiz.timeLimit * 1000);
    
    await quizRef.update({
      status: 'active',
      startTime: startTime,
      endTime: endTime,
      responses: {} // Reset responses if reactivating
    });
    
    // Set active quiz reference in the lecture
    await db.ref(`lectures/${lecture_code}/active_quiz`).set({
      quiz_id: quiz_id,
      startTime: startTime,
      endTime: endTime
    });
    
    // Set a timer to automatically close the quiz after the time limit
    setTimeout(async () => {
      try {
        await quizRef.update({ status: 'completed' });
        // Remove from active quiz reference
        await db.ref(`lectures/${lecture_code}/active_quiz`).remove();
        logger.info(`Quiz ${quiz_id} for lecture ${lecture_code} automatically completed after time limit`);
      } catch (err) {
        logger.error(`Error auto-completing quiz ${quiz_id}: ${err.message}`);
      }
    }, quiz.timeLimit * 1000);
    
    logger.info(`Quiz ${quiz_id} activated for lecture ${lecture_code}`);
    return res.json({ 
      'success': true, 
      'startTime': startTime,
      'endTime': endTime
    });
  } catch (error) {
    logger.error(`Activate quiz error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to activate quiz', 'success': false });
  }
});

/**
 * POST /submit_quiz_answer
 * Submits a student's answer for an active quiz.
 * Requires student authentication (`student_required`).
 */
app.post('/submit_quiz_answer', student_required, async (req, res) => {
  try {
    const { lecture_code, quiz_id, answer } = req.body;
    
    if (!lecture_code || !quiz_id || answer === undefined) {
      return res.status(400).json({ 'error': 'Lecture code, quiz ID, and answer required', 'success': false });
    }
    
    const student_id = req.student.id;
    logger.info(`Student ${student_id} submitting answer for quiz ${quiz_id}, lecture ${lecture_code}`);
    
    // Get the quiz
    const quizRef = db.ref(`lectures/${lecture_code}/quizzes/${quiz_id}`);
    const quizSnapshot = await quizRef.once('value');
    
    if (!quizSnapshot.exists()) {
      return res.status(404).json({ 'error': 'Quiz not found', 'success': false });
    }
    
    const quiz = quizSnapshot.val();
    
    // Check if quiz is active and time hasn't expired
    const now = Date.now();
    if (quiz.status !== 'active' || now > quiz.endTime) {
      return res.status(400).json({ 'error': 'Quiz is not active or time has expired', 'success': false });
    }
    
    // Prepare response data
    const isCorrect = typeof answer === 'string' && 
                     (answer.toLowerCase() === quiz.correctAnswer.toLowerCase() || 
                      (quiz.type === 'short_answer' && answer.toLowerCase().includes(quiz.correctAnswer.toLowerCase())));
    
    const response = {
      answer: answer,
      timestamp: now,
      correct: isCorrect,
      student_name: req.student.name,
      student_number: req.student.student_number
    };
    
    // Save the response
    await db.ref(`lectures/${lecture_code}/quizzes/${quiz_id}/responses/${student_id}`).set(response);
    
    logger.info(`Answer submitted by student ${student_id} for quiz ${quiz_id}`);
    return res.json({ 'success': true, 'correct': isCorrect });
  } catch (error) {
    logger.error(`Submit quiz answer error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to submit answer', 'success': false });
  }
});

/**
 * GET /get_active_quiz
 * Gets the currently active quiz for a lecture.
 * Requires student authentication (`student_required`).
 */
app.get('/get_active_quiz', student_required, async (req, res) => {
  try {
    const { lecture_code } = req.query;
    
    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code required', 'success': false });
    }
    
    const student_id = req.student.id;
    logger.info(`Student ${student_id} checking for active quiz in lecture ${lecture_code}`);
    
    // Check if there's an active quiz
    const activeQuizRef = db.ref(`lectures/${lecture_code}/active_quiz`);
    const activeQuizSnapshot = await activeQuizRef.once('value');
    
    if (!activeQuizSnapshot.exists()) {
      // No active quiz
      return res.json({ 'success': true, 'has_active_quiz': false });
    }
    
    // Get active quiz data
    const activeQuiz = activeQuizSnapshot.val();
    const quizRef = db.ref(`lectures/${lecture_code}/quizzes/${activeQuiz.quiz_id}`);
    const quizSnapshot = await quizRef.once('value');
    
    if (!quizSnapshot.exists()) {
      // Quiz referenced but not found (should not happen)
      return res.status(404).json({ 'error': 'Quiz not found', 'success': false });
    }
    
    const quiz = quizSnapshot.val();
    
    // Check if student has already answered
    const hasAnswered = quiz.responses && quiz.responses[student_id];
    
    // Remove correct answer if quiz is still active
    const now = Date.now();
    const isActive = now < activeQuiz.endTime;
    
    const sanitizedQuiz = {
      ...quiz,
      correctAnswer: isActive ? undefined : quiz.correctAnswer // Only include correct answer if quiz has ended
    };
    
    return res.json({
      'success': true,
      'has_active_quiz': true,
      'quiz': sanitizedQuiz,
      'has_answered': !!hasAnswered,
      'student_answer': hasAnswered ? hasAnswered.answer : null,
      'is_active': isActive,
      'time_remaining': isActive ? Math.max(0, activeQuiz.endTime - now) : 0
    });
  } catch (error) {
    logger.error(`Get active quiz error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get active quiz', 'success': false });
  }
});

/**
 * GET /get_quiz_results
 * Gets the results of a completed quiz.
 * Requires instructor authentication (`login_required`).
 */
app.get('/get_quiz_results', login_required, async (req, res) => {
  try {
    const { lecture_code, quiz_id } = req.query;
    
    if (!lecture_code || !quiz_id) {
      return res.status(400).json({ 'error': 'Lecture code and quiz ID required', 'success': false });
    }
    
    const instructor_id = req.user.id;
    logger.info(`Instructor ${instructor_id} getting results for quiz ${quiz_id} of lecture ${lecture_code}`);
    
    // Get the quiz
    const quizRef = db.ref(`lectures/${lecture_code}/quizzes/${quiz_id}`);
    const quizSnapshot = await quizRef.once('value');
    
    if (!quizSnapshot.exists()) {
      return res.status(404).json({ 'error': 'Quiz not found', 'success': false });
    }
    
    const quiz = quizSnapshot.val();
    const responses = quiz.responses || {};
    
    // Calculate statistics
    const totalResponses = Object.keys(responses).length;
    const correctResponses = Object.values(responses).filter(r => r.correct).length;
    
    // For multiple choice, calculate distribution of answers
    let answerDistribution = {};
    if (quiz.type === 'multiple_choice' && quiz.options) {
      quiz.options.forEach(option => {
        answerDistribution[option] = 0;
      });
      
      Object.values(responses).forEach(response => {
        if (answerDistribution[response.answer] !== undefined) {
          answerDistribution[response.answer]++;
        }
      });
    }
    
    return res.json({
      'success': true,
      'quiz': quiz,
      'statistics': {
        'total_responses': totalResponses,
        'correct_responses': correctResponses,
        'correct_percentage': totalResponses > 0 ? Math.round((correctResponses / totalResponses) * 100) : 0,
        'answer_distribution': answerDistribution
      }
    });
  } catch (error) {
    logger.error(`Get quiz results error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get quiz results', 'success': false });
  }
});

/**
 * DELETE /delete_quiz
 * Deletes a quiz.
 * Requires instructor authentication (`login_required`).
 */
app.delete('/delete_quiz', login_required, async (req, res) => {
  try {
    const { lecture_code, quiz_id } = req.body;
    
    if (!lecture_code || !quiz_id) {
      return res.status(400).json({ 'error': 'Lecture code and quiz ID required', 'success': false });
    }
    
    const instructor_id = req.user.id;
    logger.info(`Deleting quiz ${quiz_id} from lecture ${lecture_code} by instructor ${instructor_id}`);
    
    // Check if this is the active quiz and deactivate if needed
    const activeQuizRef = db.ref(`lectures/${lecture_code}/active_quiz`);
    const activeQuizSnapshot = await activeQuizRef.once('value');
    
    if (activeQuizSnapshot.exists() && activeQuizSnapshot.val().quiz_id === quiz_id) {
      // Remove from active quiz reference
      await activeQuizRef.remove();
      logger.info(`Removed ${quiz_id} from active quiz for lecture ${lecture_code}`);
    }
    
    // Delete the quiz
    await db.ref(`lectures/${lecture_code}/quizzes/${quiz_id}`).remove();
    
    logger.info(`Successfully deleted quiz ${quiz_id} from lecture ${lecture_code}`);
    return res.json({ 'success': true });
  } catch (error) {
    logger.error(`Delete quiz error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to delete quiz', 'success': false });
  }
});

/**
 * GET /get_lecture_quizzes
 * Gets all quizzes for a specific lecture.
 * Requires instructor authentication (`login_required`).
 */
app.get('/get_lecture_quizzes', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.query;
    
    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code required', 'success': false });
    }
    
    const instructor_id = req.user.id;
    logger.info(`Instructor ${instructor_id} getting quizzes for lecture ${lecture_code}`);
    
    // Get the quizzes
    const quizzesRef = db.ref(`lectures/${lecture_code}/quizzes`);
    const quizzesSnapshot = await quizzesRef.once('value');
    const quizzes = quizzesSnapshot.val() || {};
    
    // Return the quizzes
    return res.json({ 'success': true, 'quizzes': quizzes });
  } catch (error) {
    logger.error(`Get lecture quizzes error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get quizzes', 'success': false });
  }
});

// --- NEW: Endpoint for Searching Lectures & Transcriptions ---
app.get('/search_lectures', student_required, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.length < 3) {
      return res.status(400).json({ 'error': 'Search query must be at least 3 characters long' });
    }

    const student_id = req.student.id;
    logger.info(`Student ${student_id} searching for: ${query}`);

    // 1. Get lectures the student has access to
    const studentLecturesRef = db.ref(`student_lectures/${student_id}`);
    const studentLecturesSnapshot = await studentLecturesRef.once('value');
    
    if (!studentLecturesSnapshot.exists()) {
      return res.json([]); // No lectures to search
    }

    const accessibleLectures = Object.keys(studentLecturesSnapshot.val() || {});
    if (accessibleLectures.length === 0) {
      return res.json([]); // No lectures to search
    }

    // 2. Build search results
    const results = [];
    const searchPromises = accessibleLectures.map(async (lectureCode) => {
      // Get lecture metadata
      const metadataSnapshot = await db.ref(`lectures/${lectureCode}/metadata`).once('value');
      const metadata = metadataSnapshot.val() || {};
      
      // Check if metadata matches search query
      const metadataMatch = JSON.stringify(metadata).toLowerCase().includes(query.toLowerCase());
      
      // Get transcriptions
      const transcriptionsSnapshot = await db.ref(`lectures/${lectureCode}/transcriptions`).once('value');
      const transcriptionsObj = transcriptionsSnapshot.val() || {};
      const transcriptions = Object.values(transcriptionsObj);
      
      let transcript_snippet = null;
      let matchFound = metadataMatch;
      
      // Search through transcriptions
      for (const transcription of transcriptions) {
        if (typeof transcription.text === 'string' && 
            transcription.text.toLowerCase().includes(query.toLowerCase())) {
          matchFound = true;
          
          // Create a snippet with surrounding context (up to 100 chars before and after)
          const text = transcription.text;
          const lowerText = text.toLowerCase();
          const index = lowerText.indexOf(query.toLowerCase());
          const start = Math.max(0, index - 100);
          const end = Math.min(text.length, index + query.length + 100);
          transcript_snippet = text.substring(start, end);
          
          // If we found a match in the transcript, no need to check more
          break;
        }
      }
      
      // Add to results if we found a match in metadata or transcriptions
      if (matchFound) {
        results.push({
          code: lectureCode,
          metadata: metadata,
          transcript_snippet: transcript_snippet
        });
      }
    });
    
    // Wait for all searches to complete
    await Promise.all(searchPromises);
    
    logger.info(`Search for "${query}" returned ${results.length} results for student ${student_id}`);
    return res.json(results);
    
  } catch (error) {
    logger.error(`Search lectures error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to search lectures.' });
  }
});

// =============================================================================
// --- Static File Serving Routes ---
// =============================================================================
// Define routes to serve the main HTML pages of the application.
// These typically check session status to redirect logged-in users appropriately.

/**
 * GET /
 * Root route. Redirects logged-in students to their dashboard.
 * Serves the main index page otherwise.
 */
app.get('/', (req, res) => {
  // Check STUDENT session first (using optional chaining)
  if (req.session?.student_id) {
    return res.redirect('/student/dashboard');
  }
  // Optional: Check INSTRUCTOR session if needed for root redirection
  // if (req.session?.user_id) {
  //   return res.redirect('/instructor');
  // }

  // Serve the main landing page if not logged in as a student
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

/**
 * GET /instructor/login
 * Serves the instructor login page. Redirects to dashboard if already logged in.
 */
app.get('/instructor/login', (req, res) => {
  // Check INSTRUCTOR session
  if (req.session?.user_id) {
      return res.redirect('/instructor'); // Redirect if already logged in
  }
  res.sendFile(path.join(__dirname, '../client/public/instructor_login.html'));
});

/**
 * GET /instructor/signup
 * Serves the instructor signup page. Redirects to dashboard if already logged in.
 */
app.get('/instructor/signup', (req, res) => {
  // Check INSTRUCTOR session
  if (req.session?.user_id) {
      return res.redirect('/instructor'); // Redirect if already logged in
  }
  res.sendFile(path.join(__dirname, '../client/public/instructor_signup.html'));
});

/**
 * GET /instructor
 * Serves the main instructor dashboard page.
 * Requires instructor authentication (`login_required`).
 */
app.get('/instructor', login_required, (req, res) => {
  // login_required ensures only authenticated instructors reach here
  res.sendFile(path.join(__dirname, '../client/public/instructor.html'));
});

/**
 * GET /student/login
 * Serves the student login page. Redirects to dashboard if already logged in.
 */
app.get('/student/login', (req, res) => {
  // Check STUDENT session
  if (req.session?.student_id) {
      return res.redirect('/student/dashboard'); // Redirect if already logged in
  }
  res.sendFile(path.join(__dirname, '../client/public/student_login.html'));
});

/**
 * GET /student/signup
 * Serves the student signup page. Redirects to dashboard if already logged in.
 */
app.get('/student/signup', (req, res) => {
  // Check STUDENT session
  if (req.session?.student_id) {
      return res.redirect('/student/dashboard'); // Redirect if already logged in
  }
  res.sendFile(path.join(__dirname, '../client/public/student_signup.html'));
});

/**
 * GET /student/dashboard
 * Serves the main student dashboard page.
 * Requires student authentication (`student_required`).
 */
app.get('/student/dashboard', student_required, (req, res) => {
  // student_required ensures only authenticated students reach here
  res.sendFile(path.join(__dirname, '../client/public/student_dashboard.html'));
});

/**
 * GET /lecture/:code
 * Serves the lecture viewing page for a specific lecture code.
 * Requires student authentication (`student_required`).
 * `:code` is a route parameter accessible via `req.params.code`.
 */
app.get('/lecture/:code', student_required, (req, res) => {
  // student_required ensures only authenticated students reach here
  res.sendFile(path.join(__dirname, '../client/public/lecture.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  // Log the full error stack for debugging purposes
  logger.error(`Unhandled application error: ${err.message}`, err.stack);

  // Determine the status code (use error's status or default to 500)
  const status = err.status || 500;
  // Determine the error message (generic in production, detailed otherwise)
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal server error occurred.'
    : err.message; // Show detailed message in development

  // Check if headers have already been sent (e.g., streaming response)
  if (res.headersSent) {
    return next(err); // Delegate to Express's default handler if response started
  }

  // Send a JSON error response
  res.status(status).json({ error: message });
});

// =============================================================================
// --- Start HTTP Server ---
// =============================================================================

// Define the port the server will listen on (from environment or default 8080)
const PORT = process.env.PORT || 8080;

// Start the HTTP server and listen for connections
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});

// =============================================================================
// --- Graceful Shutdown Handling ---
// =============================================================================
// Handles process termination signals (like Ctrl+C or system shutdown commands)
// to allow the server to close connections gracefully.

/**
 * Performs graceful shutdown actions.
 * @param {string} signal - The signal received (e.g., 'SIGTERM', 'SIGINT').
 */
const shutdown = (signal) => {
    logger.info(`${signal} signal received: closing HTTP server`);
    // Stop accepting new connections
    server.close(() => {
        logger.info('HTTP server closed');
        // Close existing WebSocket connections - Removed as wss no longer exists
        // Optional: Close database connections if needed (usually not required for Firebase Admin SDK)
        logger.info('Shutdown complete.');
        process.exit(0); // Exit cleanly
    });

    // Force exit after a timeout if graceful shutdown takes too long
    setTimeout(() => {
        logger.error('Shutdown timeout, forcing exit.');
        process.exit(1); // Exit forcefully
    }, 10000); // 10 second timeout
};

// Listen for termination signals
process.on('SIGTERM', () => shutdown('SIGTERM')); // Generic termination signal
process.on('SIGINT', () => shutdown('SIGINT'));   // Signal from Ctrl+C

// =============================================================================
// --- Exports (Optional) ---
// =============================================================================
// Export the Express app instance, primarily useful for testing frameworks.
module.exports = app;