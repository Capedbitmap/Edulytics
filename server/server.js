// server/server.js


// !!NEED TO ADD THE ACTUAL FULL PROMPTS.

// --- Core Node.js Modules ---
const path = require('path');
const fs = require('fs'); // Required for file system operations (temp files, credentials)
const http = require('http');
const { URL } = require('url');

// --- External Dependencies ---
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer'); // Required for file uploads (fallback endpoint)
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { OpenAI } = require('openai');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');

// --- Local Utilities ---
const {
  generatePasswordHash,
  checkPasswordHash
} = require('./utils/auth'); // Assuming this file exists and exports these functions

// --- Initialization ---

// Load environment variables FIRST
dotenv.config({ override: true }); // Force environment variables from .env

// Configure logging
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()}: ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, err || ''),
  debug: (msg) => { if (process.env.NODE_ENV !== 'production') console.log(`[DEBUG] ${new Date().toISOString()}: ${msg}`) }
  // No 'warn' defined, use 'info' or 'error' instead
};

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);

// --- Middleware Setup ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.static(path.join(__dirname, '../client/public'))); // Serve static files

// Session middleware configuration
const sessionSecret = process.env.SECRET_KEY || 'dev-secret-key-CHANGE-ME'; // Use a strong secret in production
if (sessionSecret === 'dev-secret-key-CHANGE-ME' && process.env.NODE_ENV === 'production') {
  logger.error('CRITICAL SECURITY WARNING: Using default session secret in production! Please set SECRET_KEY environment variable.');
}
app.use(session({
  secret: sessionSecret,
  resave: false, // Don't save session if unmodified
  saveUninitialized: true, // Save new sessions
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
    httpOnly: true, // Prevent client-side JS access
    maxAge: 24 * 60 * 60 * 1000 // Session duration: 1 day
  }
}));

// --- Firebase Admin SDK Initialization ---
let db; // Firebase database reference
try {
  const cred_path = process.env.FIREBASE_CREDENTIALS_PATH || path.join(__dirname, 'firebase-credentials.json');
  const db_url = process.env.FIREBASE_DATABASE_URL;

  if (!fs.existsSync(cred_path)) {
    throw new Error(`Firebase credentials file not found at: ${cred_path}. Please ensure the file exists or set FIREBASE_CREDENTIALS_PATH.`);
  }
  if (!db_url) {
    throw new Error("FIREBASE_DATABASE_URL not found in environment variables. Please set it in your .env file.");
  }

  const serviceAccount = require(cred_path);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: db_url
  });
  db = getDatabase(); // Assign database instance
  logger.info("Firebase Admin SDK initialized successfully.");

  // Optional: Test Firebase connection on startup
  db.ref('server_status/last_startup').set({ timestamp: Date.now() })
    .then(() => logger.info('Firebase write test successful on startup.'))
    .catch(err => logger.error('Firebase write test failed on startup.', err));

} catch (error) {
  logger.error(`FATAL: Failed to initialize Firebase Admin SDK: ${error.message}`, error);
  process.exit(1); // Exit if Firebase connection fails - critical dependency
}

// --- OpenAI Client Initialization ---
let client; // OpenAI client instance
try {
  const openai_api_key = process.env.OPENAI_API_KEY;
  if (!openai_api_key) {
    // Log a warning instead of throwing an error if fallback is the goal
    logger.error("OPENAI_API_KEY not found in environment variables. OpenAI features will be unavailable."); // Use error level
  } else {
    client = new OpenAI({ apiKey: openai_api_key });
    logger.info("OpenAI client initialized successfully.");
  }
} catch (error) {
  logger.error(`Failed to initialize OpenAI client: ${error.message}`, error);
  // Application can continue, but OpenAI features won't work
}

// Helper to check if OpenAI client is available
function isOpenAiAvailable() {
  return !!client;
}

// --- Multer Setup for File Uploads (Fallback Transcription) ---
const tmpDir = path.join(__dirname, 'tmp/uploads'); // Temporary storage directory
// Ensure the temporary directory exists
if (!fs.existsSync(tmpDir)) {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    logger.info("Created temporary uploads directory:", tmpDir);
  } catch (mkdirError) {
    logger.error(`Failed to create temporary directory ${tmpDir}:`, mkdirError);
    // Decide if this is fatal or if fallback just won't work
    // process.exit(1);
  }
}
// Configure Multer
const upload = multer({
    dest: tmpDir, // Destination for temporary files
    limits: { fileSize: 25 * 1024 * 1024 }, // OpenAI limit is 25MB
    fileFilter: (req, file, cb) => {
        // Accept common audio file types supported by OpenAI
        const allowedTypes = [
            'audio/mpeg',   // mp3
            'audio/mp4',    // mp4, m4a
            'audio/wav',    // wav
            'audio/webm',   // webm
            'audio/mpga',   // sometimes used for mp3
            'audio/ogg',    // ogg
            'audio/flac',   // flac
            // Add others if needed, check OpenAI docs
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true); // Accept file
        } else {
            logger.error(`Fallback rejected file type: ${file.mimetype} for file ${file.originalname}`); // Use error level
            cb(new Error('Invalid audio file type for fallback. Supported types: mp3, mp4, mpeg, mpga, m4a, wav, webm')); // More informative error
        }
    }
});

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ server }); // Attach WebSocket server to the HTTP server
const activeTranscriptions = new Map(); // Map<sessionId, {ws, openaiWs, lectureCode, startTime}>

// Helper function to trigger fallback mode for a specific session
function triggerFallback(sessionId, reason = 'Transcription service error') {
    const sessionData = activeTranscriptions.get(sessionId);
    if (!sessionData) return; // Session already cleaned up

    logger.error(`Triggering fallback for session ${sessionId}, lecture ${sessionData.lectureCode}. Reason: ${reason}`); // Use error level

    // 1. Close OpenAI WebSocket connection if it exists and is open/connecting
    if (sessionData.openaiWs && (sessionData.openaiWs.readyState === WebSocket.OPEN || sessionData.openaiWs.readyState === WebSocket.CONNECTING)) {
        sessionData.openaiWs.close(1011, `Fallback triggered: ${reason}`); // Use internal error code
    }

    // 2. Close the Client WebSocket connection with a custom code/reason indicating fallback
    if (sessionData.ws && (sessionData.ws.readyState === WebSocket.OPEN || sessionData.ws.readyState === WebSocket.CONNECTING)) {
        // Use a custom code (in the 4000-4999 range for application-specific codes)
        sessionData.ws.close(4001, `FALLBACK_REQUIRED: ${reason}`);
    }

    // 3. Remove the session from the active map (cleanup will also occur in ws.on('close'))
    activeTranscriptions.delete(sessionId);
    logger.info(`Removed session ${sessionId} from active map due to fallback.`);
}

// Handle new WebSocket connections
wss.on('connection', async function(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lectureCode = url.searchParams.get('lecture_code');
    const sessionId = uuidv4(); // Unique ID for this specific WebSocket connection

    // Define error handlers specific to this connection scope
    const handleOpenAIError = (error, context) => {
        logger.error(`OpenAI WebSocket error (${context}) for session ${sessionId} (Lecture ${lectureCode}): ${error.message}`);
        triggerFallback(sessionId, `OpenAI WS ${context} error`);
    };
    const handleOpenAIClose = (code, reason) => {
        const reasonText = reason ? reason.toString() : 'No reason provided'; // Ensure reason is string
        logger.info(`OpenAI connection closed for session ${sessionId} (Lecture ${lectureCode}): ${code} - ${reasonText}`);
        // Use a timeout to prevent race conditions if triggerFallback is also called
        setTimeout(() => {
            // If the session still exists and closed unexpectedly, trigger fallback
            if (activeTranscriptions.has(sessionId) && code !== 1000 && code !== 1011) { // 1000=Normal, 1011=Server Error/Intentional
                 triggerFallback(sessionId, `OpenAI WS closed unexpectedly (${code})`);
            }
        }, 150); // Short delay
    };
     const handleOpenAIMessageError = (event) => {
        // Log the full error event from OpenAI
        logger.error(`OpenAI event error message for ${sessionId} (Lecture ${lectureCode}):`, event);
        // Specifically trigger fallback on server errors from OpenAI
        if (event?.error?.type === 'server_error') {
             triggerFallback(sessionId, 'OpenAI server error received');
        }
        // Potentially handle other errors differently (e.g., rate limits might not require fallback)
    };

    let openaiWs; // Define here for accessibility within the connection scope

    try {
        // 1. Validate Lecture Code
        if (!lectureCode) throw new Error('Lecture code is required for WebSocket connection');
        logger.info(`New WebSocket connection for lecture: ${lectureCode}, assigning session ID: ${sessionId}`);

        const lectureRef = db.ref(`lectures/${lectureCode}/metadata`);
        const lectureSnapshot = await lectureRef.once('value');
        if (!lectureSnapshot.exists()) throw new Error(`Invalid lecture code provided: ${lectureCode}`);
        logger.info(`Lecture ${lectureCode} validated for session ${sessionId}.`);

        // 2. Check OpenAI Availability (for Realtime API)
        if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API Key missing, cannot establish realtime transcription');

        // 3. Connect to OpenAI Realtime WebSocket
        openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1' // Required header for this API
            }
        });

        // 4. Store Session Info Immediately
        activeTranscriptions.set(sessionId, { ws, openaiWs, lectureCode, startTime: Date.now() });
        logger.info(`Tracking new session ${sessionId} for lecture ${lectureCode}`);

        // --- Setup OpenAI WebSocket Event Handlers ---
        openaiWs.on('open', function() {
            logger.info(`OpenAI WS connection opened for session ${sessionId}`);
            // Define configuration payload for the OpenAI session
            const configPayload = {
                type: "session.update",
                session: {
                    input_audio_format: "pcm16", // We expect 16-bit PCM from the client
                    input_audio_transcription: {
                        model: "gpt-4o-mini-transcribe", // Ensure this model is suitable and enabled
                        language: "en" // Specify language for better accuracy
                    },
                    // Optional: Voice Activity Detection (VAD) settings
                    turn_detection: {
                        type: "server_vad",
                        threshold: 0.5,          // Sensitivity (adjust as needed)
                        prefix_padding_ms: 300,  // Audio before speech starts
                        silence_duration_ms: 700, // Silence to detect end of turn
                    },
                    // Optional: Noise Reduction
                    input_audio_noise_reduction: {
                        type: "near_field" // or "far_field" depending on mic setup
                    },
                },
            };
            const configEvent = JSON.stringify(configPayload);
            const sendDelay = 100; // Small delay before sending config

            // Send config after a short delay
            setTimeout(() => {
                const currentSession = activeTranscriptions.get(sessionId);
                // Check if both sockets are still open and session exists
                if (currentSession?.openaiWs?.readyState === WebSocket.OPEN && currentSession?.ws?.readyState === WebSocket.OPEN) {
                    try {
                        currentSession.openaiWs.send(configEvent);
                        logger.debug(`Sent OpenAI config for ${sessionId} after delay.`);
                        // Notify the client that the connection is fully ready
                        currentSession.ws.send(JSON.stringify({ type: 'status', status: 'connected', session_id: sessionId }));
                        logger.info(`Notified client ${sessionId} that connection is ready.`);
                    } catch (sendError) {
                        logger.error(`Failed to send config to OpenAI for ${sessionId}: ${sendError.message}`);
                        triggerFallback(sessionId, 'Failed to send config to OpenAI');
                    }
                } else {
                    logger.error(`WebSocket state changed during config delay for ${sessionId}. Config not sent.`); // Use error level
                    // If session still exists but sockets closed, trigger fallback might be redundant but ensures cleanup
                    if (activeTranscriptions.has(sessionId)) {
                         triggerFallback(sessionId, 'State changed during config delay');
                    }
                }
            }, sendDelay);
        });

        openaiWs.on('message', function(data) {
            try {
                const event = JSON.parse(data.toString());
                // Handle errors reported by OpenAI first
                if (event.type.includes('error')) {
                    handleOpenAIMessageError(event); // Use dedicated handler
                    return; // Don't process further if it's an error message
                }

                // Handle transcription results (completed or delta)
                if (event.type === 'conversation.item.input_audio_transcription.completed' ||
                   (event.type === 'conversation.item.input_audio_transcription.delta' && event.delta?.trim()))
                {
                    const text = event.type === 'conversation.item.input_audio_transcription.completed' ? event.transcript : event.delta;
                    const timestamp = Date.now();

                    // Save transcription to Firebase (asynchronously, don't wait for it)
                    db.ref(`lectures/${lectureCode}/transcriptions`).push().set({
                        text: text,
                        timestamp: timestamp,
                        item_id: event.item_id, // Store OpenAI's item ID for reference
                        event_type: event.type // Store if it was delta or completed
                    }).catch(err => logger.error(`Firebase write error for transcription (Session ${sessionId}): ${err.message}`));

                    // Forward the transcription data to the connected client
                    const clientWs = activeTranscriptions.get(sessionId)?.ws;
                    if (clientWs?.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'transcription',
                            event_type: event.type,
                            text: text,
                            timestamp: timestamp,
                            item_id: event.item_id
                        }));
                    } else {
                        logger.info(`Client WS for session ${sessionId} closed before forwarding transcription.`);
                    }
                }
                // Potentially handle other OpenAI event types here if needed (e.g., 'pong')
            } catch (error) {
                logger.error(`Error processing message from OpenAI for ${sessionId}: ${error.message}`, data.toString());
                // Consider triggering fallback on persistent parsing errors? Maybe not necessary.
            }
        });

        openaiWs.on('error', (error) => handleOpenAIError(error, 'general')); // Use specific handler
        openaiWs.on('close', handleOpenAIClose); // Use specific handler

        // --- Setup Client WebSocket Event Handlers ---
        ws.on('message', function(message) {
            const currentSession = activeTranscriptions.get(sessionId);
            // Ensure OpenAI WS is still valid before forwarding
            if (!currentSession?.openaiWs || currentSession.openaiWs.readyState !== WebSocket.OPEN) {
                logger.debug(`Client message for ${sessionId} ignored, OpenAI WS not open/ready.`);
                // Client might be sending data after OpenAI WS closed, potentially due to fallback trigger delay.
                // No action needed here usually, client should handle its state.
                return;
            }
            try {
                // If message is binary audio data, forward it directly to OpenAI
                if (Buffer.isBuffer(message)) {
                    currentSession.openaiWs.send(message);
                } else {
                    // Handle potential control messages from client (e.g., ping)
                    const msg = JSON.parse(message.toString());
                    if (msg.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong' })); // Respond to ping
                    } else {
                        logger.info(`Received non-audio message from client ${sessionId}:`, msg);
                    }
                    // Add handling for other client messages if necessary
                }
            } catch (error) {
                logger.error(`Error processing/forwarding client message for ${sessionId}: ${error.message}`);
                // If forwarding audio fails, trigger fallback
                triggerFallback(sessionId, 'Error forwarding client audio');
            }
        });

        ws.on('close', function(code, reason) {
            const reasonText = reason ? reason.toString() : 'No reason provided';
            logger.info(`Client disconnected session ${sessionId} (Lecture ${lectureCode}). Code: ${code}, Reason: ${reasonText}`);
            const sessionData = activeTranscriptions.get(sessionId);
            if (sessionData) {
                // Close the associated OpenAI connection if it's still open
                if (sessionData.openaiWs && (sessionData.openaiWs.readyState === WebSocket.OPEN || sessionData.openaiWs.readyState === WebSocket.CONNECTING)) {
                    logger.info(`Closing associated OpenAI WS for session ${sessionId} due to client disconnect.`);
                    sessionData.openaiWs.close(1000, 'Client disconnected'); // Normal closure
                }
                // Clean up the session from the map
                activeTranscriptions.delete(sessionId);
                logger.info(`Removed active transcription session ${sessionId}`);
            } else {
                 logger.info(`Client disconnected for session ${sessionId}, but it was already removed from the map (likely due to fallback trigger).`);
            }
        });

        ws.on('error', function (error) {
            logger.error(`Client WebSocket error for session ${sessionId} (Lecture ${lectureCode}): ${error.message}`);
            // Trigger fallback which handles cleanup
            triggerFallback(sessionId, 'Client WS Error');
        });

    } catch (error) { // Catch errors during the initial WebSocket connection setup phase
        logger.error(`WebSocket initial setup error for ${lectureCode}: ${error.message}`, error);
        // Ensure cleanup if session was partially added to map
        if (activeTranscriptions.has(sessionId)) {
            const sessionData = activeTranscriptions.get(sessionId);
            sessionData?.openaiWs?.close(1011, 'Server setup error'); // Close OpenAI WS if created
            activeTranscriptions.delete(sessionId); // Remove from map
        }
        // Try to close the client connection if it managed to open
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close(1011, `Internal server error during setup: ${error.message}`);
        }
        // No need to trigger fallback here, the connection failed before it was fully established.
    }
}); // End wss.on('connection')


// --- Authentication Middleware ---
function login_required(req, res, next) {
  if (!req.session || !req.session.user_id) {
    logger.info(`Authentication required for ${req.method} ${req.path}`);
    if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ 'error': 'Authentication required', 'redirect': '/instructor/login' });
    }
    return res.redirect('/instructor/login');
  }
  // Attach user info to request object for convenience
  req.user = { id: req.session.user_id, email: req.session.email, name: req.session.name };
  next();
}

// Student authentication middleware
function student_required(req, res, next) {
  // --- Start Detailed Logging ---
  const logPrefix = `[student_required] Path: ${req.path}, Method: ${req.method}`;
  logger.debug(`${logPrefix} - Request received.`);
  logger.debug(`${logPrefix} - Session ID from req.session.id: ${req.session?.id}`);
  logger.debug(`${logPrefix} - Student ID from req.session.student_id: ${req.session?.student_id}`);
  const cookies = req.headers.cookie || 'None';
  logger.debug(`${logPrefix} - Raw Cookie Header Received: ${cookies}`);
  // --- End Detailed Logging ---

  if (!req.session || !req.session.student_id) {
    logger.info(`${logPrefix} - Authentication FAILED (req.session.student_id is falsy).`);

    const acceptHeader = req.headers.accept || '';
    // --- MODIFICATION START ---
    // Check Accept header OR if it's a relevant method with JSON Content-Type
    const contentTypeHeader = req.headers['content-type'] || '';
    const isApiMethodWithJson = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && contentTypeHeader.includes('application/json'); // Added PATCH, check content-type
    const acceptsJson = acceptHeader.includes('application/json'); // Check accept header specifically
    const expectsJson = acceptsJson || req.xhr || isApiMethodWithJson; // Combine checks
    // --- MODIFICATION END ---

    logger.debug(`${logPrefix} - Accept Header: '${acceptHeader}', Content-Type: '${contentTypeHeader}', req.xhr: ${req.xhr}, isApiMethodWithJson: ${isApiMethodWithJson}, expectsJson: ${expectsJson}`);

    if (expectsJson) {
        logger.info(`${logPrefix} - Sending 401 JSON response because authentication failed and request expects JSON.`);
        return res.status(401).json({
            'error': 'Authentication required. Please log in again.',
            'redirect': '/student/login'
        });
    } else {
        logger.info(`${logPrefix} - Redirecting to /student/login because authentication failed and request does not expect JSON.`);
        return res.redirect('/student/login');
    }
  }

  // If we reach here, authentication is successful
  logger.debug(`${logPrefix} - Authentication SUCCESSFUL for student ${req.session.student_id}.`);
  req.student = {
    id: req.session.student_id,
    email: req.session.student_email,
    name: req.session.student_name,
    student_number: req.session.student_number
  };
  next();
}

// --- Helper Function to Generate Unique Lecture Code ---
async function generate_unique_lecture_code() {
  const code_length = 6;
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'; // Avoid I, O, 0
  const max_attempts = 10;
  for (let attempts = 0; attempts < max_attempts; attempts++) {
    let code = '';
    for (let i = 0; i < code_length; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    try {
      const snapshot = await db.ref(`lectures/${code}/metadata`).once('value');
      if (!snapshot.exists()) {
        logger.debug(`Generated unique lecture code: ${code}`);
        return code;
      } else {
         logger.debug(`Code ${code} already exists, retrying...`);
      }
    } catch (error) {
      logger.error(`Firebase error checking code uniqueness for ${code}:`, error);
      throw new Error('Failed to check code uniqueness due to database error');
    }
  }
  logger.error(`Failed to generate a unique lecture code after ${max_attempts} attempts.`);
  throw new Error('Could not generate a unique lecture code');
}

// --- System Prompts for AI Features ---
const system_prompts = {
  'define': `Concisely define the key technical terms or jargon present in the following text snippet from a lecture. Aim for clarity suitable for a university student unfamiliar with the specific terms.`,
  'explain': `Explain the core concepts presented in the following lecture excerpt in detail. Provide context and elaborate on the significance of the ideas discussed. Assume the audience is a university student in a related field.`,
  'examples': `Provide practical, real-world examples or relatable analogies that illustrate the main concepts discussed in the following lecture text. Make the abstract ideas more concrete.`,
  'simplify': `Explain the following text from a lecture in very simple terms, as if explaining it to someone with no prior knowledge of the subject (like explaining to a 5-year-old, ELI5). Avoid jargon.`,
  'summary': (minutes) => `You are an AI assistant summarizing lecture content. Provide a concise summary (e.g., 3-5 bullet points) of the main points from the last ${minutes} minute(s) using the provided text. Focus on key concepts and conclusions. Ignore filler words and off-topic remarks.` // Dynamic prompt
};


// --- API Routes ---

// GET /api/status - Basic server status
app.get('/api/status', (req, res) => {
  res.json({
      status: 'active',
      activeWebSocketSessions: activeTranscriptions.size,
      activeLectures: [...new Set([...activeTranscriptions.values()].map(s => s.lectureCode))]
  });
});

// GET /test_firebase - Manual Firebase connection test
app.get('/test_firebase', async (req, res) => {
  try {
    logger.info('Manual Firebase test via /test_firebase endpoint...');
    await db.ref('test_connection_endpoint').set({ timestamp: Date.now(), status: 'success from manual test' });
    logger.info('Manual Firebase endpoint test successful!');
    res.json({ success: true, message: 'Firebase connection successful' });
  } catch (error) {
    logger.error('Manual Firebase endpoint test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Authentication API Routes ---

// POST /instructor/login
app.post('/instructor/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ 'error': 'Email and password required' });
    logger.info(`Login attempt for email: ${email}`);
    const users_ref = db.ref('users');
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    if (!snapshot.exists()) {
        logger.info(`Login failed: Email not found - ${email}`); // Use info level
        return res.status(401).json({'error': 'Invalid email or password'});
    }
    const [userId, user] = Object.entries(snapshot.val())[0];
    if (!checkPasswordHash(user.password, password)) {
        logger.info(`Login failed: Invalid password for email - ${email}`); // Use info level
        return res.status(401).json({'error': 'Invalid email or password'});
    }
    req.session.regenerate((err) => { // Regenerate session ID on login
        if (err) { logger.error('Session regeneration failed post-login:', err); return res.status(500).json({ error: 'Login session error' }); }
        req.session.user_id = userId; req.session.email = user.email; req.session.name = user.name || '';
        logger.info(`Login successful: ${userId} (${user.email})`);
        res.json({ 'success': true, name: req.session.name });
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal login error' });
  }
});

// POST /instructor/signup
app.post('/instructor/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    // Validation
    if (!name || !email || !password) return res.status(400).json({ 'error': 'Name, email, password required' });
    if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ 'error': 'Password minimum 8 characters' });
    logger.info(`Signup attempt: ${email}`);
    const users_ref = db.ref('users');
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    if (snapshot.exists()) { logger.info(`Signup failed: Email exists - ${email}`); return res.status(400).json({'error': 'Email already registered'}); } // Use info level

    // Create user
    const hashed_password = generatePasswordHash(password);
    const new_user_ref = users_ref.push();
    const user_id = new_user_ref.key;
    await new_user_ref.set({ name, email, password: hashed_password, created_at: Date.now() });
    logger.info(`User created: ${user_id} (${email})`);

    // Log in immediately
    req.session.regenerate((err) => {
         if (err) { logger.error('Session regeneration failed post-signup:', err); return res.status(201).json({ success: true, message: 'Account created, session setup failed. Please log in.' }); }
         req.session.user_id = user_id; req.session.email = email; req.session.name = name;
         res.status(201).json({ 'success': true, name: req.session.name });
     });
  } catch (error) {
    logger.error(`Signup error: ${error.message}`, error);
    res.status(500).json({ 'error': 'Internal signup error' });
  }
});

// GET /instructor/logout
app.get('/instructor/logout', (req, res) => {
  const userName = req.session?.name || 'User';
  req.session.destroy((err) => {
    if (err) logger.error('Session destroy error during logout:', err);
    else logger.info(`${userName} logged out.`);
    res.clearCookie('connect.sid'); // Default cookie name
    res.redirect('/instructor/login'); // Redirect regardless of destroy error
  });
});

// GET /get_user_info
app.get('/get_user_info', login_required, (req, res) => {
  res.json({ name: req.user.name, email: req.user.email, user_id: req.user.id });
});

// POST /student/login
app.post('/student/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ 'error': 'Email and password required' });
    
    // Validate email domain
    if (!email.toLowerCase().endsWith('@students.adu.ac.ae') && !email.toLowerCase().endsWith('@adu.ac.ae')) {
      return res.status(400).json({ 'error': 'Only ADU email addresses are allowed' });
    }
    
    logger.info(`Student login attempt for email: ${email}`);
    const students_ref = db.ref('students');
    const snapshot = await students_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    
    if (!snapshot.exists()) {
        logger.info(`Student login failed: Email not found - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }
    
    const [studentId, student] = Object.entries(snapshot.val())[0];
    
    if (!checkPasswordHash(student.password, password)) {
        logger.info(`Student login failed: Invalid password for email - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }
    
    // Extract student number from email
    let studentNumber = 'STAFF';
    if (email.toLowerCase().endsWith('@students.adu.ac.ae')) {
      const emailParts = email.split('@');
      studentNumber = emailParts[0];
    }
    
    req.session.regenerate((err) => {
        if (err) { 
          logger.error('Session regeneration failed post-login:', err); 
          return res.status(500).json({ error: 'Login session error' }); 
        }
        
        req.session.student_id = studentId; 
        req.session.student_email = student.email; 
        req.session.student_name = student.name || '';
        req.session.student_number = studentNumber;
        
        logger.info(`Student login successful: ${studentId} (${student.email})`);
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

// POST /student/signup
app.post('/student/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Validation
    if (!name || !email || !password) return res.status(400).json({ 'error': 'Name, email, password required' });
    if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    
    // Validate email domain
    if (!email.toLowerCase().endsWith('@students.adu.ac.ae') && !email.toLowerCase().endsWith('@adu.ac.ae')) {
      return res.status(400).json({ 'error': 'Only ADU email addresses are allowed' });
    }
    
    if (password.length < 8) return res.status(400).json({ 'error': 'Password minimum 8 characters' });
    
    logger.info(`Student signup attempt: ${email}`);
    const students_ref = db.ref('students');
    const snapshot = await students_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');
    
    if (snapshot.exists()) { 
      logger.info(`Student signup failed: Email exists - ${email}`); 
      return res.status(400).json({'error': 'Email already registered'}); 
    }

    // Create student
    const hashed_password = generatePasswordHash(password);
    const new_student_ref = students_ref.push();
    const student_id = new_student_ref.key;
    
    // Extract student number from email
    let studentNumber = 'STAFF';
    if (email.toLowerCase().endsWith('@students.adu.ac.ae')) {
      const emailParts = email.split('@');
      studentNumber = emailParts[0];
    }
    
    await new_student_ref.set({ 
      name, 
      email, 
      password: hashed_password, 
      created_at: Date.now(),
      student_number: studentNumber
    });
    
    logger.info(`Student created: ${student_id} (${email})`);

    // Log in immediately
    req.session.regenerate((err) => {
      if (err) { 
        logger.error('Session regeneration failed post-signup:', err); 
        return res.status(201).json({ success: true, message: 'Account created, session setup failed. Please log in.' }); 
      }
      
      req.session.student_id = student_id; 
      req.session.student_email = email; 
      req.session.student_name = name;
      req.session.student_number = studentNumber;
      
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

// GET /student/logout
app.get('/student/logout', (req, res) => {
  const studentName = req.session?.student_name || 'Student';
  req.session.destroy((err) => {
    if (err) logger.error('Session destroy error during student logout:', err);
    else logger.info(`${studentName} logged out.`);
    res.clearCookie('connect.sid'); // Default cookie name
    res.redirect('/student/login'); // Redirect regardless of destroy error
  });
});

// GET /get_student_info
app.get('/get_student_info', student_required, (req, res) => {
  res.json({ 
    name: req.student.name, 
    email: req.student.email, 
    student_id: req.student.id,
    student_number: req.student.student_number
  });
});

// GET /get_student_lectures
app.get('/get_student_lectures', student_required, async (req, res) => {
  try {
    const student_id = req.student.id;
    logger.info(`Fetching lecture access history for student: ${student_id}`);
    
    const snapshot = await db.ref(`student_lectures/${student_id}`).once('value');
    if (!snapshot.exists()) {
      return res.json({ 'lectures': [] });
    }
    
    const accessData = snapshot.val();
    const lecturePromises = Object.entries(accessData).map(async ([lectureCode, accessInfo]) => {
      // Get lecture metadata
      const lectureSnapshot = await db.ref(`lectures/${lectureCode}/metadata`).once('value');
      const metadata = lectureSnapshot.exists() ? lectureSnapshot.val() : {};
      
      return {
        code: lectureCode,
        last_accessed: accessInfo.timestamp,
        metadata: metadata
      };
    });
    
    const lectures = await Promise.all(lecturePromises);
    
    // Sort by most recently accessed
    lectures.sort((a, b) => b.last_accessed - a.last_accessed);
    
    return res.json({ 'lectures': lectures });
  } catch (error) {
    logger.error(`Get student lectures error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lecture history.' });
  }
});

// --- Lecture Management API Routes ---

// POST /generate_lecture_code
app.post('/generate_lecture_code', login_required, async (req, res) => {
  try {
    const { course_code, date, time: time_str, instructor, set_active } = req.body;
    if (!course_code || !date || !time_str || !instructor) return res.status(400).json({ 'error': 'All lecture details required' });
    logger.info(`Generating lecture: ${course_code} by ${req.user.id}`);
    const lecture_code = await generate_unique_lecture_code();
    const now = Date.now();
    await db.ref(`lectures/${lecture_code}/metadata`).set({
      course_code, date, time: time_str, instructor, created_at: now, created_by: req.user.id
    });
    if (set_active) {
      logger.info(`Setting lecture ${lecture_code} active.`);
      await db.ref('active_lecture').set({ code: lecture_code, path: `lectures/${lecture_code}/transcriptions`, set_at: now, set_by: req.user.id });
    }
    logger.info(`Generated lecture code: ${lecture_code}`);
    return res.json({ 'lecture_code': lecture_code, 'success': true });
  } catch (error) {
    logger.error(`Error generating code: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to generate lecture code.' });
  }
});

// POST /join_lecture
app.post('/join_lecture', student_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });
    
    logger.info(`Join attempt: ${lecture_code} by student ${req.student.id}`);
    
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) { 
      logger.info(`Join failed: Code invalid - ${lecture_code}`); 
      return res.status(404).json({ 'error': 'Invalid lecture code' }); 
    }
    
    // Record that this student accessed this lecture
    const now = Date.now();
    await db.ref(`student_lectures/${req.student.id}/${lecture_code}`).set({
      timestamp: now,
      student_id: req.student.id,
      student_number: req.student.student_number,
      student_email: req.student.email
    });
    
    logger.info(`Join successful: ${lecture_code} by student ${req.student.id}`);
    return res.json({ 
      success: true, 
      metadata: snapshot.val() || {}, 
      path: `lectures/${lecture_code}/transcriptions` 
    });
  } catch (error) {
    logger.error(`Join error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to join lecture.' });
  }
});

// GET /get_lecture_transcriptions
app.get('/get_lecture_transcriptions', async (req, res) => {
  try {
    const { lecture_code, after: after_timestamp } = req.query;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });
    const transcriptions_ref = db.ref(`lectures/${lecture_code}/transcriptions`);
    let query = transcriptions_ref.orderByChild('timestamp');
    if (after_timestamp && !isNaN(parseInt(after_timestamp))) query = query.startAfter(parseInt(after_timestamp));
    const snapshot = await query.once('value');
    const data = snapshot.val() || {};
    const transcriptions = Object.entries(data).map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    logger.debug(`Returning ${transcriptions.length} transcriptions for ${lecture_code}`);
    return res.json({ 'transcriptions': transcriptions });
  } catch (error) {
    logger.error(`Get transcriptions error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve transcriptions.' });
  }
});

// GET /get_instructor_lectures
app.get('/get_instructor_lectures', login_required, async (req, res) => {
  try {
    const user_id = req.user.id;
    logger.info(`Fetching lectures for instructor: ${user_id}`);
    const snapshot = await db.ref('lectures').orderByChild('metadata/created_by').equalTo(user_id).once('value');
    const data = snapshot.val() || {};
    const lectures = Object.entries(data).map(([code, lecture]) => ({ code, metadata: lecture.metadata || {} }))
      .sort((a,b)=> (b.metadata.created_at || 0) - (a.metadata.created_at || 0));
    logger.info(`Found ${lectures.length} lectures for instructor: ${user_id}`);
    return res.json({ 'lectures': lectures });
  } catch (error) {
    logger.error(`Get instructor lectures error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lectures.' });
  }
});

// GET /get_lecture_info
app.get('/get_lecture_info', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ 'error': 'Lecture code required' });
    const snapshot = await db.ref(`lectures/${code}/metadata`).once('value');
    if (!snapshot.exists()) { logger.info(`Info failed: Lecture not found - ${code}`); return res.status(404).json({ 'error': 'Lecture not found' }); } // Use info level
    return res.json({ success: true, metadata: snapshot.val() || {} });
  } catch (error) {
    logger.error(`Get lecture info error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lecture info.' });
  }
});

// GET /active_lecture
app.get('/active_lecture', async (req, res) => {
  try {
    const snapshot = await db.ref('active_lecture').once('value');
    const activeData = snapshot.val();
    if (!activeData?.code) { logger.debug('No active lecture.'); return res.json(null); }
    logger.debug(`Active lecture is: ${activeData.code}`);
    return res.json(activeData);
  } catch (error) {
    logger.error(`Get active lecture error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get active lecture status.' });
  }
});

// POST /set_active_lecture
app.post('/set_active_lecture', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });
    logger.info(`Setting active lecture: ${lecture_code} by ${req.user.id}`);
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) { logger.info(`Set active failed: Lecture not found - ${lecture_code}`); return res.status(404).json({ 'error': 'Invalid lecture code' }); } // Use info level
    // Optional: Auth check: if (snapshot.val().created_by !== req.user.id) return res.status(403)...
    await db.ref('active_lecture').set({ code: lecture_code, path: `lectures/${lecture_code}/transcriptions`, set_at: Date.now(), set_by: req.user.id });
    logger.info(`Set active lecture successful: ${lecture_code}`);
    return res.json({ 'success': true });
  } catch (error) {
    logger.error(`Set active lecture error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to set active lecture.' });
  }
});


// --- Recording Control API Routes (Simplified - Primarily manage active state) ---

// POST /start_recording
app.post('/start_recording', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    if (!lecture_code) return res.status(400).json({ 'error': 'Lecture code required' });
    logger.info(`'/start_recording' API called for ${lecture_code} by ${req.user.id}`);
    const snapshot = await db.ref(`lectures/${lecture_code}/metadata`).once('value');
    if (!snapshot.exists()) return res.status(404).json({ 'error': 'Lecture not found' });
    // Optional: Auth check
    await db.ref('active_lecture').set({ code: lecture_code, path: `lectures/${lecture_code}/transcriptions`, set_at: Date.now(), set_by: req.user.id });
    logger.info(`Lecture ${lecture_code} confirmed active.`);
    return res.json({ success: true, message: 'Lecture active, connect WebSocket.', start_time: Date.now() });
  } catch (error) {
    logger.error(`Start recording error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to activate recording.' });
  }
});

// POST /stop_recording
app.post('/stop_recording', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body; // Code to stop (optional, defaults to current active)
    logger.info(`'/stop_recording' API called (for ${lecture_code || 'current active'}) by ${req.user.id}`);
    const activeRef = db.ref('active_lecture');
    const activeSnapshot = await activeRef.once('value');
    const currentActiveCode = activeSnapshot.val()?.code;
    let message = 'No active lecture to stop.';
    let connections_closed = 0;

    if (currentActiveCode && (!lecture_code || lecture_code === currentActiveCode)) {
        await activeRef.remove();
        logger.info(`Cleared active lecture flag for ${currentActiveCode}.`);
        message = `Recording stopped for ${currentActiveCode}.`;
        // Close associated WebSockets
        for (const [sessionId, session] of activeTranscriptions.entries()) {
            if (session.lectureCode === currentActiveCode) {
                triggerFallback(sessionId, 'Lecture stopped by instructor'); // Use trigger for cleanup
                connections_closed++;
            }
        }
        logger.info(`Requested closure for ${connections_closed} WS sessions for ${currentActiveCode}.`);
    } else if (lecture_code) {
        message = `Specified lecture (${lecture_code}) was not the active one (${currentActiveCode || 'none'}).`;
        logger.info(message);
    } else {
         logger.info(message);
    }
    return res.json({ success: true, message, connections_closed });
  } catch (error) {
    logger.error(`Stop recording error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to stop recording.' });
  }
});

// GET /recording_status
app.get('/recording_status', login_required, (req, res) => {
  try {
    const lecture_code = req.query.lecture_code;
    if (!lecture_code) return res.status(400).json({ error: 'Lecture code required' });
    let isRecording = false; let sessionStartTime = null;
    // Check if any client WS is open for this lecture
    for (const session of activeTranscriptions.values()) {
      if (session.lectureCode === lecture_code && session.ws?.readyState === WebSocket.OPEN) {
        isRecording = true; sessionStartTime = session.startTime; break;
      }
    }
    logger.debug(`Recording status for ${lecture_code}: ${isRecording}`);
    return res.json({ is_recording: isRecording, start_time: sessionStartTime });
  } catch (error) {
    logger.error(`Get recording status error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get status.' });
  }
});


// --- Fallback Transcription API Route ---
app.post('/fallback_transcription', upload.single('audio'), async (req, res) => {
    logger.info(`Fallback transcription request received`);
    if (!req.file) { logger.error('Fallback: No audio file.'); return res.status(400).json({ error: 'No audio file uploaded' }); }
    const lectureCode = req.body.lecture_code;
    const audioFilePath = req.file.path;
    // Initialize extension with a default value
    let extension = 'webm';
    
    if (!lectureCode || !audioFilePath) {
        logger.error('Fallback: Missing lecture code or file path.');
        if (audioFilePath) fs.unlink(audioFilePath, () => {});
        return res.status(400).json({ error: 'Lecture code and audio required' });
    }
    logger.info(`Fallback processing: ${lectureCode}, file: ${audioFilePath}, size: ${req.file.size}`);
    
    try {
        const snapshot = await db.ref(`lectures/${lectureCode}/metadata`).once('value');
        if (!snapshot.exists()) { 
            logger.info(`Fallback failed: Invalid code - ${lectureCode}`); 
            fs.unlink(audioFilePath, () => {});
            return res.status(404).json({ error: 'Invalid lecture code' }); 
        }
        
        if (!isOpenAiAvailable()) { 
            logger.error('Fallback failed: OpenAI unavailable.'); 
            fs.unlink(audioFilePath, () => {});
            return res.status(503).json({ error: 'AI service unavailable' }); 
        }

        // Get MIME type and determine extension
        const originalMimeType = req.file.mimetype || 'audio/webm';
        // Update the already declared extension variable
        if (originalMimeType.includes('webm')) extension = 'webm';
        else if (originalMimeType.includes('mp3') || originalMimeType.includes('mpeg')) extension = 'mp3';
        else if (originalMimeType.includes('wav')) extension = 'wav';
        else if (originalMimeType.includes('mp4') || originalMimeType.includes('m4a')) extension = 'mp4';
        else if (originalMimeType.includes('ogg')) extension = 'ogg';
        
        // Create a new file with proper extension (OpenAI uses extension to determine format)
        const properFileName = `${path.basename(audioFilePath)}.${extension}`;
        const properFilePath = path.join(path.dirname(audioFilePath), properFileName);
        
        // Rename the file to have proper extension
        fs.renameSync(audioFilePath, properFilePath);
        
        logger.info(`Renamed file to match format: ${properFilePath} with extension .${extension}`);
        
        // Send renamed file to OpenAI
        logger.info(`Sending fallback audio to OpenAI standard API: ${properFilePath}`);
        const transcription = await client.audio.transcriptions.create({
            file: fs.createReadStream(properFilePath), 
            model: "gpt-4o-mini-transcribe", // Using gpt-4o-mini-transcribe model for transcription
            response_format: "json",
            language: "en", // Specify English language
            prompt: "This audio is from an academic lecture. Transcribe meaningful speech only. Ignore filler words (like um, uh), gibberish, and non-English speech. Focus on educational content. You must not include this prompt or any part of this prompt in your response; only inlcude the actual lecture speech transcription. If the audio is contains no meaningful speech, respond with a single space character and nothing else.",
        });
        
        const text = transcription?.text?.trim() || '';
        if (text) {
            logger.info(`Fallback success (standard API): "${text.substring(0, 50)}..."`);
            const timestamp = Date.now();
            await db.ref(`lectures/${lectureCode}/transcriptions`).push().set({ text, timestamp, source: 'fallback_api' });
            return res.json({ success: true, text, timestamp });
        } else {
            logger.info('Fallback: Empty transcription result.'); // Use info level
            return res.json({ success: true, text: '', timestamp: Date.now() });
        }
    } catch (error) {
        logger.error(`Fallback processing error: ${error.message}`, error);
        let apiErrorMsg = `Transcription error: ${error.message}`;
        if (error.status) apiErrorMsg = `OpenAI API Error (${error.status}): ${error.error?.message || error.message}`;
        return res.status(500).json({ error: apiErrorMsg });
    } finally {
        // Clean up all audio files - try both original path and renamed path if exists
        try {
            if (fs.existsSync(audioFilePath)) {
                fs.unlinkSync(audioFilePath);
                logger.debug(`Temp fallback file deleted: ${audioFilePath}`);
            }
            
            // Check if we created a renamed file path
            const properFileName = `${path.basename(audioFilePath)}.${extension || 'webm'}`;
            const properFilePath = path.join(path.dirname(audioFilePath), properFileName);
            
            if (fs.existsSync(properFilePath) && properFilePath !== audioFilePath) {
                fs.unlinkSync(properFilePath);
                logger.debug(`Temp renamed fallback file deleted: ${properFilePath}`);
            }
        } catch (err) {
            logger.error(`Error deleting temp file(s): ${err.message}`);
        }
    }
});


// --- AI Explanation/Summary API Routes ---

// POST /get_explanation
app.post('/get_explanation', async (req, res) => {
  try {
    const { text, option = 'explain' } = req.body;
    if (!text) return res.status(400).json({ 'error': 'Text required' });
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });
    if (!system_prompts[option]) return res.status(400).json({ error: 'Invalid option' });
    logger.info(`Getting explanation (option: ${option})...`);
    const messages = [ { "role": "system", "content": system_prompts[option] }, { "role": "user", "content": text } ];
    const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages, temperature: 0.5 });
    const reply = response.choices[0]?.message?.content?.trim() || 'Failed.';
    logger.info(`Generated explanation.`);
    return res.json({ 'explanation': reply });
  } catch (error) {
    logger.error(`Get explanation error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get explanation.' });
  }
});

// POST /get_summary
app.post('/get_summary', async (req, res) => {
  try {
    const { text, minutes } = req.body;
    if (!text || minutes === undefined || isNaN(parseInt(minutes))) return res.status(400).json({ 'error': 'Text and minutes required' });
    if (!isOpenAiAvailable()) return res.status(503).json({ error: 'AI service unavailable' });
    logger.info(`Getting summary for last ${minutes} min...`);
    const promptContent = typeof system_prompts.summary === 'function' ? system_prompts.summary(minutes) : 'Summarize.';
    const messages = [ { "role": "system", "content": promptContent }, { "role": "user", "content": text } ];
    const response = await client.chat.completions.create({ model: "gpt-4o-mini", messages, temperature: 0.6 });
    const reply = response.choices[0]?.message?.content?.trim() || 'Failed.';
    logger.info(`Generated summary.`);
    return res.json({ 'summary': reply });
  } catch (error) {
    logger.error(`Get summary error: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get summary.' });
  }
});


// --- Static File Serving Routes ---
app.get('/', (req, res) => {
  // If student is logged in, redirect to dashboard
  if (req.session?.student_id) {
    return res.redirect('/student/dashboard');
  }
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

app.get('/instructor/login', (req, res) => { if (req.session?.user_id) return res.redirect('/instructor'); res.sendFile(path.join(__dirname, '../client/public/instructor_login.html')); });
app.get('/instructor/signup', (req, res) => { if (req.session?.user_id) return res.redirect('/instructor'); res.sendFile(path.join(__dirname, '../client/public/instructor_signup.html')); });
app.get('/instructor', login_required, (req, res) => res.sendFile(path.join(__dirname, '../client/public/instructor.html')));

// New routes for student pages
app.get('/student/login', (req, res) => { if (req.session?.student_id) return res.redirect('/student/dashboard'); res.sendFile(path.join(__dirname, '../client/public/student_login.html')); });
app.get('/student/signup', (req, res) => { if (req.session?.student_id) return res.redirect('/student/dashboard'); res.sendFile(path.join(__dirname, '../client/public/student_signup.html')); });
app.get('/student/dashboard', student_required, (req, res) => res.sendFile(path.join(__dirname, '../client/public/student_dashboard.html')));
app.get('/lecture/:code', student_required, (req, res) => res.sendFile(path.join(__dirname, '../client/public/lecture.html')));

// --- Catch-all 404 Handler ---
app.use((req, res, next) => {
  logger.info(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).sendFile(path.join(__dirname, '../client/public/404.html'));
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  logger.error(`Unhandled application error: ${err.message}`, err.stack);
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'An internal server error occurred.' : err.message;
  res.status(status).json({ error: message });
});


// --- Start HTTP Server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});

// --- Graceful Shutdown Handling ---
const shutdown = (signal) => {
    logger.info(`${signal} signal received: closing HTTP server`);
    server.close(() => {
        logger.info('HTTP server closed');
        logger.info('Closing WebSocket connections...');
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1001, 'Server shutting down'); // 1001 = Going Away
            }
        });
        // Close Firebase? Usually not needed for admin SDK.
        logger.info('Shutdown complete.');
        process.exit(0);
    });
    // Force exit after timeout
    setTimeout(() => { logger.error('Shutdown timeout, forcing exit.'); process.exit(1); }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT')); // Handle Ctrl+C

// Export app for testing
module.exports = app;