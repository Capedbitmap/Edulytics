// server/server.js
// NEED TO ADD BACK SERVER PROMPTS TO THIS!!! FOR THE STUDENT BUTTONS

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer'); // Assuming multer might be needed elsewhere, keep it for now
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');
// const { generate: generateId } = require('shortid'); // shortid is not used, consider removing
const session = require('express-session');
const {
  generatePasswordHash,
  checkPasswordHash
} = require('./utils/auth');

// Initialize environment variables FIRST
dotenv.config({ override: true }); // Force environment variables from .env

// Configure logging
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()}: ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`, err || ''),
  debug: (msg) => { if (process.env.NODE_ENV !== 'production') console.log(`[DEBUG] ${new Date().toISOString()}: ${msg}`) }
};

// Initialize app and configurations
const app = express();
const server = http.createServer(app);

// --- Middleware Setup ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

// Session middleware
const sessionSecret = process.env.SECRET_KEY || 'dev-secret-key';
if (sessionSecret === 'dev-secret-key' && process.env.NODE_ENV === 'production') {
  logger.error('WARNING: Using default session secret in production!');
}
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } // Example: 1 day
}));
// app.secret_key = sessionSecret; // Not needed with express-session

// --- Firebase Initialization ---
let db;
try {
  const cred_path = process.env.FIREBASE_CREDENTIALS_PATH || path.join(__dirname, 'firebase-credentials.json'); // Use path.join
  const db_url = process.env.FIREBASE_DATABASE_URL;

  if (!fs.existsSync(cred_path)) {
    throw new Error(`Firebase credentials file not found at: ${cred_path}`);
  }
  if (!db_url) {
    throw new Error("FIREBASE_DATABASE_URL not found in environment variables");
  }

  const serviceAccount = require(cred_path);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: db_url
  });
  db = getDatabase(); // Assign to db variable
  logger.info("Firebase initialized successfully");

  // Optional: Test connection on startup (can be removed after verification)
  db.ref('server_startup_test').set({ timestamp: Date.now() })
    .then(() => logger.info('Firebase write test successful on startup.'))
    .catch(err => logger.error('Firebase write test failed on startup.', err));

} catch (error) {
  logger.error(`Failed to initialize Firebase: ${error.message}`, error);
  process.exit(1); // Exit if Firebase fails to initialize
}

// --- OpenAI Initialization ---
let client;
try {
  const openai_api_key = process.env.OPENAI_API_KEY;
  if (!openai_api_key) {
    throw new Error("OPENAI_API_KEY not found in environment variables");
  }

  client = new OpenAI({
    apiKey: openai_api_key
  });
  logger.info("OpenAI client initialized successfully");
} catch (error) {
  logger.error(`Failed to initialize OpenAI client: ${error.message}`, error);
  // Decide if you want to exit or continue without OpenAI
  // process.exit(1);
}

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ server });
const activeTranscriptions = new Map(); // Track active transcription sessions

wss.on('connection', async function(ws, req) {
  // ...(Keep your existing WebSocket handling logic here)...
  // Make sure to use the 'db' variable for database access
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lectureCode = url.searchParams.get('lecture_code');

    if (!lectureCode) {
      logger.error('WebSocket connection attempt without lecture code');
      ws.close(1008, 'Lecture code is required');
      return;
    }

    logger.info(`New WebSocket connection for lecture: ${lectureCode}`);

    const lectureRef = db.ref(`lectures/${lectureCode}/metadata`); // Check metadata existence
    const lectureSnapshot = await lectureRef.once('value');

    if (!lectureSnapshot.exists()) {
      logger.error(`Invalid lecture code for WebSocket: ${lectureCode}`);
      ws.close(1008, 'Invalid lecture code');
      return;
    }

    // Generate a unique session ID for this connection
    const sessionId = uuidv4();

    // Establish connection to OpenAI Realtime API
    // Ensure OPENAI_API_KEY is available
    if (!process.env.OPENAI_API_KEY) {
         logger.error('OpenAI API Key missing, cannot connect to OpenAI WebSocket');
         ws.close(1011, 'Server configuration error');
         return;
    }

    const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

     // Store the connection info
    activeTranscriptions.set(sessionId, {
      ws,
      openaiWs,
      lectureCode,
      startTime: Date.now()
    });


    logger.info(`Connected to OpenAI Realtime API for lecture: ${lectureCode}, session: ${sessionId}`);

    // --- Handle OpenAI WebSocket Events ---
    openaiWs.on('open', function() {
      logger.info(`Connected to OpenAI Realtime API for lecture: ${lectureCode}, session: ${sessionId}. Initial ReadyState: ${openaiWs.readyState}`);

      // --- CONFIG PAYLOAD (Based on Transcription Doc - Rev. 2) ---
      const configPayload = {
        type: "session.update",
        session: {
          input_audio_format: "pcm16",
          input_audio_transcription: {          // Use array format
              model: "gpt-4o-mini-transcribe", // Ensure this model is correct and enabled for your key
              // prompt: "",                  // Optional
              language: "en"                 // Optional but recommended
          },
          turn_detection: {                      // VAD settings (optional, null to disable)
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
          },
          input_audio_noise_reduction: {         // Noise reduction (optional, null to disable)
              type: "near_field"
          },
          // include: []                          // Optional: e.g., ["item.input_audio_transcription.logprobs"]
        },
      };
      const configEvent = JSON.stringify(configPayload);
      // --- END OF CONFIG PAYLOAD ---

      // --- SEND LOGIC (Keep the setTimeout wrapper from previous step) ---
      const sendDelay = 100; // Delay in milliseconds
      logger.debug(`Waiting ${sendDelay}ms before sending config for session ${sessionId}...`);

      setTimeout(() => {
          if (openaiWs.readyState === WebSocket.OPEN && ws.readyState === WebSocket.OPEN) {
              try {
                  openaiWs.send(configEvent);
                  // Log the actual payload being sent
                  logger.debug(`Sent session config to OpenAI for ${lectureCode} after delay. Payload: ${configEvent}`);
                  // Notify client
                  ws.send(JSON.stringify({ type: 'status', status: 'connected', session_id: sessionId }));
                  logger.info(`Notified client ${sessionId} that connection is ready (after delay).`);
              } catch (sendError) {
                  logger.error(`Failed to send config to OpenAI for ${lectureCode}, session ${sessionId} (after delay): ${sendError.message}`);
                  if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Failed to configure transcription session');
              }
          } else {
              logger.warn(`WebSocket state changed during delay for session ${sessionId}. OpenAI: ${openaiWs.readyState}, Client: ${ws.readyState}. Config not sent.`);
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1011, 'State changed during config delay');
              if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) openaiWs.close(1011, 'State changed during config delay');
          }
      }, sendDelay); // End of setTimeout

  }); // End of openaiWs.on('open')
    

    openaiWs.on('message', function(data) {
        try {
            const event = JSON.parse(data.toString());
            // Process transcription events
            if (event.type === 'conversation.item.input_audio_transcription.completed' ||
                (event.type === 'conversation.item.input_audio_transcription.delta' && event.delta && event.delta.trim().length > 0)) {

                const text = event.type === 'conversation.item.input_audio_transcription.completed' ? event.transcript : event.delta;
                const timestamp = Date.now();
                const transcriptRef = db.ref(`lectures/${lectureCode}/transcriptions`).push(); // Use push for unique IDs

                transcriptRef.set({
                    text: text,
                    timestamp: timestamp,
                    item_id: event.item_id, // Store OpenAI item ID if needed
                    event_type: event.type // Store event type if needed
                }).catch(err => logger.error(`Firebase write error for transcription: ${lectureCode}`, err));

                // Forward relevant info to the client WebSocket
                 ws.send(JSON.stringify({
                    type: 'transcription',
                    event_type: event.type, // Let frontend know if it's delta or completed
                    text: text,
                    timestamp: timestamp,
                    item_id: event.item_id // Send item_id if frontend needs it
                 }));
            } else if (event.type.includes('error')) {
                 logger.error(`OpenAI event error for ${lectureCode}:`, event);
            }
            // Handle other event types if necessary
        } catch (error) {
            logger.error(`Error processing message from OpenAI for ${lectureCode}: ${error.message}`, data.toString());
        }
    });

    openaiWs.on('error', function(error) {
        logger.error(`OpenAI WebSocket error for lecture ${lectureCode}, session ${sessionId}: ${error.message}`);
        ws.send(JSON.stringify({ type: 'error', message: 'Transcription service connection error' }));
        // Consider closing the client connection or attempting reconnect depending on the error
         if (activeTranscriptions.has(sessionId)) {
            activeTranscriptions.get(sessionId)?.ws?.close(1011, 'Transcription service error');
            activeTranscriptions.delete(sessionId);
         }
    });

    openaiWs.on('close', function(code, reason) {
        logger.info(`OpenAI connection closed for lecture ${lectureCode}, session ${sessionId}: ${code} - ${reason}`);
        if (activeTranscriptions.has(sessionId)) {
            activeTranscriptions.get(sessionId)?.ws?.send(JSON.stringify({ type: 'status', status: 'disconnected', reason: `Transcription service closed: ${reason}` }));
            // Don't delete here, let the client ws.on('close') handle cleanup
        }
    });

    // --- Handle Client WebSocket Events ---
    ws.on('message', function(message) {
        if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
            logger.debug(`Received client message for ${lectureCode}, but OpenAI WS not open. State: ${openaiWs?.readyState}`);
            return;
        }
        try {
            if (Buffer.isBuffer(message)) {
                const base64Audio = message.toString('base64');
                openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", buffer: base64Audio }));
            } else {
                const msg = JSON.parse(message.toString());
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
                // Handle other control messages if needed
            }
        } catch (error) {
            logger.error(`Error processing client message for ${lectureCode}: ${error.message}`);
        }
    });

    ws.on('close', function(code, reason) {
        logger.info(`Client disconnected for lecture ${lectureCode}, session ${sessionId}. Code: ${code}, Reason: ${reason}`);
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
            logger.info(`Closing OpenAI connection for session ${sessionId}`);
            openaiWs.close(1000, 'Client disconnected');
        }
        // Clean up session
        if (activeTranscriptions.has(sessionId)) {
            activeTranscriptions.delete(sessionId);
            logger.info(`Removed active transcription session ${sessionId}`);
        }
    });

     ws.on('error', function (error) {
         logger.error(`Client WebSocket error for lecture ${lectureCode}, session ${sessionId}: ${error.message}`);
         // Ensure cleanup happens on error too
         if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
             openaiWs.close(1011, 'Client WS Error');
         }
         if (activeTranscriptions.has(sessionId)) {
             activeTranscriptions.delete(sessionId);
         }
     });

  } catch (error) {
    logger.error(`WebSocket connection error: ${error.message}`, error);
    // Try to close the WebSocket if it's still open
    if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Internal server error during connection setup');
    }
  }
});


// --- Helper Functions ---
function login_required(req, res, next) {
  if (!req.session || !req.session.user_id) {
    logger.info(`Authentication required for ${req.method} ${req.path}`);
    // Check if AJAX request
    if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ 'error': 'Authentication required', 'redirect': '/instructor/login' });
    }
    return res.redirect('/instructor/login');
  }
  // User is authenticated, proceed
  req.user = { id: req.session.user_id, email: req.session.email, name: req.session.name }; // Attach user info to request
  next();
}

async function generate_unique_lecture_code() {
  const code_length = 6;
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'; // Removed I, O, 0
  const max_attempts = 10;
  let attempts = 0;

  while (attempts < max_attempts) {
    let code = '';
    for (let i = 0; i < code_length; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    try {
      const ref = db.ref(`lectures/${code}/metadata`); // Check only metadata existence
      const snapshot = await ref.once('value'); // Use once('value') for existence check

      if (!snapshot.exists()) {
        logger.debug(`Generated unique code: ${code}`);
        return code; // Found a unique code
      } else {
        logger.debug(`Code ${code} already exists, generating new one...`);
      }
    } catch (error) {
      logger.error(`Firebase error checking code uniqueness for ${code}:`, error);
      // Rethrow or handle specific Firebase errors if needed
      throw new Error('Failed to check code uniqueness due to database error');
    }
    attempts++;
  }
  logger.error(`Failed to generate a unique lecture code after ${max_attempts} attempts.`);
  throw new Error('Could not generate a unique lecture code');
}


const system_prompts = { // Define prompts before routes use them
  'define': `...`, // Keep your prompts
  'explain': `...`,
  'examples': `...`,
  'simplify': `...`
};

// --- API Routes ---

app.get('/api/status', (req, res) => {
  res.json({
      status: 'active',
      activeTranscriptionSessions: activeTranscriptions.size,
      // Optionally list active lecture codes
      activeLectures: [...new Set([...activeTranscriptions.values()].map(s => s.lectureCode))]
  });
});

// Test Firebase connection endpoint
app.get('/test_firebase', async (req, res) => {
  try {
    logger.info('Testing Firebase connection via /test_firebase endpoint...');
    const testRef = db.ref('test_connection_endpoint');
    await testRef.set({ timestamp: Date.now(), status: 'success' });
    logger.info('Firebase endpoint test successful!');
    res.json({ success: true, message: 'Firebase connection successful' });
  } catch (error) {
    logger.error('Firebase endpoint test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Authentication Routes ---
app.post('/instructor/login', async (req, res) => {
  try {
    const { email, password } = req.body; // Destructure

    if (!email || !password) {
      return res.status(400).json({ 'error': 'Email and password are required' });
    }
    logger.info(`Login attempt for email: ${email}`);

    const users_ref = db.ref('users');
    // Query for user by email - more efficient than fetching all users
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');

    if (!snapshot.exists()) {
        logger.warn(`Login failed: Email not found - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    const userData = snapshot.val();
    const userId = Object.keys(userData)[0]; // Get the user ID (key)
    const user = userData[userId];

    // Verify password
    if (!checkPasswordHash(user.password, password)) {
        logger.warn(`Login failed: Invalid password for email - ${email}`);
        return res.status(401).json({'error': 'Invalid email or password'});
    }

    // Set session
    req.session.user_id = userId;
    req.session.email = user.email;
    req.session.name = user.name || ''; // Use stored name
    logger.info(`Login successful for user: ${userId} (${user.email})`);

    // Regenerate session ID upon login for security
    req.session.regenerate((err) => {
        if (err) {
            logger.error('Session regeneration failed after login:', err);
            return res.status(500).json({ error: 'Login failed due to session error' });
        }
        // Re-assign session data after regeneration
        req.session.user_id = userId;
        req.session.email = user.email;
        req.session.name = user.name || '';
        res.json({ 'success': true, name: req.session.name }); // Send name back
    });

  } catch (error) {
    logger.error(`Login error for email ${req.body.email}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'An internal error occurred during login' });
  }
});

app.post('/instructor/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ 'error': 'Name, email, and password are required' });
    }

    // Basic email format validation
    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ 'error': 'Password must be at least 8 characters long' });
    }
    logger.info(`Signup attempt for email: ${email}`);

    // Check if email is already in use
    const users_ref = db.ref('users');
    const snapshot = await users_ref.orderByChild('email').equalTo(email).limitToFirst(1).once('value');

    if (snapshot.exists()) {
        logger.warn(`Signup failed: Email already in use - ${email}`);
        return res.status(400).json({'error': 'Email is already registered'});
    }

    // Hash password
    const hashed_password = generatePasswordHash(password);

    // Create user using push for a unique ID
    const new_user_ref = users_ref.push();
    const user_id = new_user_ref.key;

    await new_user_ref.set({
      'name': name,
      'email': email,
      'password': hashed_password,
      'created_at': Date.now()
    });
    logger.info(`User created successfully: ${user_id} (${email})`);

    // Set session immediately after signup
    req.session.user_id = user_id;
    req.session.email = email;
    req.session.name = name;

    req.session.regenerate((err) => {
         if (err) {
             logger.error('Session regeneration failed after signup:', err);
             // User is created, but session failed. Maybe ask them to log in.
             return res.status(201).json({ success: true, message: 'Account created, but session setup failed. Please log in.' });
         }
         req.session.user_id = user_id;
         req.session.email = email;
         req.session.name = name;
         res.status(201).json({ 'success': true, name: req.session.name }); // Use 201 Created status
     });

  } catch (error) {
    logger.error(`Signup error for email ${req.body.email}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'An internal error occurred during signup' });
  }
});

app.get('/instructor/logout', (req, res) => {
  const userName = req.session?.name || 'User';
  req.session.destroy((err) => { // Use destroy for proper cleanup
    if (err) {
      logger.error('Error destroying session during logout:', err);
       // Still redirect, but log the error
       res.redirect('/');
    } else {
       logger.info(`${userName} logged out.`);
       res.clearCookie('connect.sid'); // Clear the session cookie
       res.redirect('/instructor/login'); // Redirect to login after logout
    }
  });
});

// Get user info for the logged-in instructor
app.get('/get_user_info', login_required, (req, res) => { // No async needed if just reading session
  try {
    // req.user is attached by login_required middleware
    res.json({
      'name': req.user.name,
      'email': req.user.email,
      'user_id': req.user.id
    });
  } catch (error) { // Should not happen if login_required works
    logger.error(`Error getting user info: ${error.message}`, error);
    res.status(500).json({ 'error': 'An error occurred while retrieving user information' });
  }
});

// --- Lecture Management Routes ---

app.post('/generate_lecture_code', login_required, async (req, res) => {
  try {
    logger.debug('Request body for /generate_lecture_code:', req.body);
    logger.debug('Session user ID:', req.session.user_id); // Verify user ID is present

    const { course_code, date, time: time_str, instructor, set_active } = req.body;

    if (!course_code || !date || !time_str || !instructor) {
      logger.warn('Generate code failed: Missing required fields', { course_code, date, time_str, instructor });
      return res.status(400).json({ 'error': 'Course code, date, time, and instructor name are required' });
    }

    logger.info(`Generating lecture code for course: ${course_code} by instructor ID: ${req.user.id}`);

    // Generate a unique lecture code
    const lecture_code = await generate_unique_lecture_code(); // Function defined above

    // Create the database structure
    const lecture_ref = db.ref(`lectures/${lecture_code}`);
    const now = Date.now();

    // Set metadata
    await lecture_ref.child('metadata').set({
      'course_code': course_code,
      'date': date,
      'time': time_str,
      'instructor': instructor, // Use provided instructor name
      'created_at': now,
      'created_by': req.user.id // Use user ID from session/middleware
    });

    // Create empty transcriptions node (optional, Firebase creates automatically on first push/set)
    // await lecture_ref.child('transcriptions').set({});

    // Set as active lecture if requested
    if (set_active) {
      logger.info(`Setting lecture ${lecture_code} as active.`);
      const active_ref = db.ref('active_lecture');
      await active_ref.set({
        'code': lecture_code,
        'path': `lectures/${lecture_code}/transcriptions`, // Path for potential direct listeners (though WebSocket is primary)
        'set_at': now,
        'set_by': req.user.id
      });
    }

    logger.info(`Successfully generated lecture code: ${lecture_code}`);
    return res.json({ 'lecture_code': lecture_code, 'success': true });

  } catch (error) {
    logger.error(`Error generating lecture code: ${error.message}`, error);
    // Provide a more generic error message to the client
    return res.status(500).json({ 'error': 'Failed to generate lecture code due to an internal server error.' });
  }
});

app.post('/join_lecture', async (req, res) => {
  try {
    const { lecture_code } = req.body;

    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code is required' });
    }
    logger.info(`Join attempt for lecture code: ${lecture_code}`);

    // Check if the lecture code exists by checking its metadata
    const metadata_ref = db.ref(`lectures/${lecture_code}/metadata`);
    const snapshot = await metadata_ref.once('value');

    if (!snapshot.exists()) {
      logger.warn(`Join failed: Invalid lecture code - ${lecture_code}`);
      return res.status(404).json({ 'error': 'Invalid or expired lecture code' });
    }

    const metadata = snapshot.val();
    logger.info(`Join successful for lecture: ${lecture_code} (${metadata.course_code})`);

    // Return metadata and path (path might not be needed if only using WebSocket)
    return res.json({
      'success': true,
      'metadata': metadata || {},
      'path': `lectures/${lecture_code}/transcriptions` // Path for historical fetching
    });
  } catch (error) {
    logger.error(`Error joining lecture ${req.body.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to join lecture due to an internal server error.' });
  }
});

app.get('/get_lecture_transcriptions', async (req, res) => {
  try {
    const { lecture_code, after: after_timestamp } = req.query;

    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code is required' });
    }
    logger.debug(`Fetching transcriptions for ${lecture_code}, after: ${after_timestamp}`);

    // Reference to the transcriptions for the lecture
    const transcriptions_ref = db.ref(`lectures/${lecture_code}/transcriptions`);
    let query = transcriptions_ref.orderByChild('timestamp'); // Always order by timestamp

    // Apply timestamp filter if provided
    if (after_timestamp && !isNaN(parseInt(after_timestamp))) {
      query = query.startAfter(parseInt(after_timestamp));
    }

    const snapshot = await query.once('value'); // Use once('value')
    const transcriptionsData = snapshot.val() || {};

    // Convert Firebase object to sorted array
    const formatted_transcriptions = Object.entries(transcriptionsData)
      .map(([key, value]) => ({
        id: key, // Firebase push key
        text: value.text || '',
        timestamp: value.timestamp || 0,
        // Include other fields if needed, e.g., item_id, event_type
      }))
      .sort((a, b) => a.timestamp - b.timestamp); // Ensure sorted order

    logger.debug(`Returning ${formatted_transcriptions.length} transcriptions for ${lecture_code}`);
    return res.json({ 'transcriptions': formatted_transcriptions });

  } catch (error) {
    logger.error(`Error getting transcriptions for ${req.query.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve transcriptions.' });
  }
});

app.get('/get_instructor_lectures', login_required, async (req, res) => {
  try {
    const user_id = req.user.id; // From login_required middleware
    logger.info(`Fetching lectures for instructor ID: ${user_id}`);

    // Query lectures created by this instructor
    const lectures_ref = db.ref('lectures');
    const snapshot = await lectures_ref.orderByChild('metadata/created_by').equalTo(user_id).once('value');

    const lecturesData = snapshot.val() || {};

    // Format for response (convert object to array if needed by frontend)
    const instructor_lectures = Object.entries(lecturesData).map(([code, lecture]) => ({
        code: code,
        metadata: lecture.metadata || {}
        // Optionally include transcription count or last activity
    })).sort((a,b)=> b.metadata.created_at - a.metadata.created_at); // Sort newest first


    logger.info(`Found ${instructor_lectures.length} lectures for instructor ID: ${user_id}`);
    return res.json({ 'lectures': instructor_lectures }); // Return array

  } catch (error) {
    logger.error(`Error getting instructor lectures for user ${req.user?.id}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve your lectures.' });
  }
});

app.get('/get_lecture_info', async (req, res) => { // Does not require login
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ 'error': 'Lecture code is required' });
    }
    logger.debug(`Fetching info for lecture code: ${code}`);

    const metadata_ref = db.ref(`lectures/${code}/metadata`);
    const snapshot = await metadata_ref.once('value');

    if (!snapshot.exists()) {
      logger.warn(`Info request failed: Lecture not found - ${code}`);
      return res.status(404).json({ 'error': 'Lecture not found' });
    }

    logger.debug(`Returning metadata for lecture code: ${code}`);
    return res.json({
      'success': true,
      'metadata': snapshot.val() || {}
    });
  } catch (error) {
    logger.error(`Error getting lecture info for ${req.query.code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve lecture information.' });
  }
});

app.get('/active_lecture', async (req, res) => { // Does not require login
  try {
    logger.debug('Fetching active lecture...');
    const active_ref = db.ref('active_lecture');
    const snapshot = await active_ref.once('value');
    const activeData = snapshot.val();

    if (!activeData || !activeData.code) {
        logger.debug('No active lecture found.');
        return res.json(null); // Return null or {} if no active lecture
    }

    logger.debug(`Active lecture is: ${activeData.code}`);
    return res.json(activeData);

  } catch (error) {
    logger.error(`Error getting active lecture: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to retrieve active lecture status.' });
  }
});

app.post('/set_active_lecture', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    const user_id = req.user.id;

    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code is required' });
    }
    logger.info(`Setting active lecture to ${lecture_code} by user: ${user_id}`);

    // Verify lecture exists and belongs to the user
    const metadata_ref = db.ref(`lectures/${lecture_code}/metadata`);
    const snapshot = await metadata_ref.once('value');

    if (!snapshot.exists()) {
      logger.warn(`Set active failed: Lecture not found - ${lecture_code}`);
      return res.status(404).json({ 'error': 'Invalid lecture code' });
    }
    // Optional: Check if created_by matches user_id for authorization
    // if (snapshot.val().created_by !== user_id) {
    //   logger.warn(`Set active failed: Lecture ${lecture_code} does not belong to user ${user_id}`);
    //   return res.status(403).json({ 'error': 'You do not have permission to activate this lecture' });
    // }

    // Set as active lecture
    const active_ref = db.ref('active_lecture');
    await active_ref.set({
      'code': lecture_code,
      'path': `lectures/${lecture_code}/transcriptions`,
      'set_at': Date.now(),
      'set_by': user_id
    });

    logger.info(`Successfully set active lecture to ${lecture_code}`);
    return res.json({ 'success': true });

  } catch (error) {
    logger.error(`Error setting active lecture ${req.body.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to set active lecture.' });
  }
});


// --- Recording Control Routes (Simplified for WebSocket) ---

// Start Recording now primarily sets the 'active_lecture' flag
app.post('/start_recording', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    const user_id = req.user.id;

    if (!lecture_code) {
      return res.status(400).json({ 'error': 'Lecture code is required' });
    }
    logger.info(`'/start_recording' called for ${lecture_code} by user ${user_id}`);

    // Verify lecture exists (optional check, could rely on set_active_lecture)
    const metadata_ref = db.ref(`lectures/${lecture_code}/metadata`);
    const snapshot = await metadata_ref.once('value');
    if (!snapshot.exists()) {
      logger.warn(`Start recording failed: Lecture not found - ${lecture_code}`);
      return res.status(404).json({ 'error': 'Invalid lecture code' });
    }
     // Optional: Check ownership
     // if (snapshot.val().created_by !== user_id) { ... return 403 ... }


    // Set as active lecture (idempotent, can be called again)
    await db.ref('active_lecture').set({
      'code': lecture_code,
      'path': `lectures/${lecture_code}/transcriptions`,
      'set_at': Date.now(),
      'set_by': user_id
    });
    logger.info(`Lecture ${lecture_code} confirmed as active for recording.`);

    // The actual recording/transcription starts when the WebSocket connects and sends audio
    // We return a success status and the current time as the potential "start"
    return res.json({
      'success': true,
      'start_time': Date.now() // Reflects when the API call was made
    });
  } catch (error) {
    logger.error(`Error in /start_recording for ${req.body.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to start recording process.' });
  }
});

// Stop Recording should primarily clear the 'active_lecture' flag
app.post('/stop_recording', login_required, async (req, res) => {
  try {
    const { lecture_code } = req.body;
    const user_id = req.user.id;

    logger.info(`'/stop_recording' called for ${lecture_code} by user ${user_id}`);

    // Optional: Verify lecture_code if needed

    // Clear the active lecture flag if it matches the requested code
    const activeRef = db.ref('active_lecture');
    const activeSnapshot = await activeRef.once('value');
    if (activeSnapshot.exists() && activeSnapshot.val().code === lecture_code) {
        await activeRef.remove();
        logger.info(`Cleared active lecture flag for ${lecture_code}.`);
    } else {
        logger.info(`Stop recording called for ${lecture_code}, but it wasn't the active lecture.`);
    }


    // Close any active WebSocket connections for this lecture code
    let connectionsClosed = 0;
    for (const [sessionId, session] of activeTranscriptions.entries()) {
      if (session.lectureCode === lecture_code) {
        logger.info(`Closing WebSocket session ${sessionId} for stopped lecture ${lecture_code}`);
        if (session.openaiWs?.readyState === WebSocket.OPEN) {
          session.openaiWs.close(1000, 'Lecture stopped by instructor');
        }
        if (session.ws?.readyState === WebSocket.OPEN) {
          session.ws.close(1000, 'Lecture stopped by instructor');
        }
        // Deletion is handled by the 'close' event handlers of the WebSockets
        connectionsClosed++;
      }
    }
    logger.info(`Requested closure for ${connectionsClosed} WebSocket sessions for lecture ${lecture_code}.`);

    return res.json({
      'success': true,
      'connections_closed': connectionsClosed // Indicates how many connections were *told* to close
    });
  } catch (error) {
    logger.error(`Error in /stop_recording for ${req.body.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to stop recording process.' });
  }
});

// Recording status now checks active WebSocket connections
app.get('/recording_status', login_required, (req, res) => { // No async needed
  try {
    const lecture_code = req.query.lecture_code;

    if (!lecture_code) {
        return res.status(400).json({ error: 'Lecture code is required' });
    }

    let isRecording = false;
    let startTime = null;

    // Check if there's an active WebSocket session for this lecture code
    for (const session of activeTranscriptions.values()) {
      if (session.lectureCode === lecture_code &&
          session.ws?.readyState === WebSocket.OPEN && // Check if client WS is open
          session.openaiWs?.readyState === WebSocket.OPEN) { // Check if OpenAI WS is open
        isRecording = true;
        startTime = session.startTime; // Use the session start time
        break;
      }
    }
    logger.debug(`Recording status for ${lecture_code}: ${isRecording}`);

    return res.json({
      'is_recording': isRecording,
      'start_time': startTime // This is the WebSocket session start time
    });
  } catch (error) {
    logger.error(`Error getting recording status for ${req.query.lecture_code}: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get recording status.' });
  }
});


// --- AI Explanation/Summary Routes ---
app.post('/get_explanation', async (req, res) => { // Login not required for explanation? Adjust if needed.
  try {
    const { text, option = 'explain' } = req.body; // Default to 'explain'

    if (!text) {
      return res.status(400).json({ 'error': 'Text for explanation is required' });
    }
    if (!client) {
         return res.status(503).json({ error: 'AI service is unavailable' });
     }
    if (!system_prompts[option]) {
         logger.warn(`Invalid explanation option received: ${option}`);
         return res.status(400).json({ error: 'Invalid explanation option' });
     }

     logger.info(`Getting explanation (option: ${option}) for text snippet...`);

    const messages = [
      { "role": "system", "content": system_prompts[option] },
      { "role": "user", "content": text }
    ];

    const response = await client.chat.completions.create({
      // Consider using a more capable model if o3-mini isn't sufficient
      model: "gpt-4o-mini", // Ensure this model is available/correct
      messages: messages,
      temperature: 0.5, // Adjust temperature for desired creativity/factualness
    });

    const reply = response.choices[0]?.message?.content?.trim() || 'Sorry, I could not generate an explanation.';
    logger.info(`Generated explanation successfully.`);

    return res.json({ 'explanation': reply });

  } catch (error) {
    logger.error(`Error getting explanation: ${error.message}`, error);
    // Check for specific OpenAI errors (e.g., rate limits, API key issues)
    // if (error instanceof OpenAI.APIError) { ... }
    return res.status(500).json({ 'error': 'Failed to get explanation from AI service.' });
  }
});

app.post('/get_summary', async (req, res) => { // Login not required for summary? Adjust if needed.
  try {
    const { text, minutes } = req.body;

    if (!text) {
      return res.status(400).json({ 'error': 'Text for summary is required' });
    }
    if (minutes === undefined || isNaN(parseInt(minutes))) {
         return res.status(400).json({ error: 'Time period (minutes) is required' });
     }
     if (!client) {
         return res.status(503).json({ error: 'AI service is unavailable' });
     }

     logger.info(`Getting summary for last ${minutes} minute(s)...`);

    // Construct the system prompt dynamically
    const summary_system_prompt = `You are an AI assistant summarizing lecture content. Provide a concise summary of the main points from the last ${minutes} minute(s) using the provided text. Focus on key concepts, use clear academic language, and organize the summary logically (e.g., bullet points). Ignore non-academic content.`;

    const messages = [
      { "role": "system", "content": summary_system_prompt },
      { "role": "user", "content": text }
    ];

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini", // Or a suitable model for summarization
      messages: messages,
      temperature: 0.6,
    });

    const reply = response.choices[0]?.message?.content?.trim() || 'Sorry, I could not generate a summary.';
    logger.info(`Generated summary successfully.`);

    return res.json({ 'summary': reply });

  } catch (error) {
    logger.error(`Error getting summary: ${error.message}`, error);
    return res.status(500).json({ 'error': 'Failed to get summary from AI service.' });
  }
});

// --- Static File Routes ---
// Serve index.html for the root, and also define landing.html explicitly if needed
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});
app.get('/landing', (req, res) => { // If you have a separate landing page
  res.sendFile(path.join(__dirname, '../client/public/landing.html'));
});
// Explicitly define index.html route if needed, though '/' usually covers it
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});


app.get('/instructor/login', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.session && req.session.user_id) {
      return res.redirect('/instructor');
  }
  res.sendFile(path.join(__dirname, '../client/public/instructor_login.html'));
});

app.get('/instructor/signup', (req, res) => {
   // If user is already logged in, redirect to dashboard
   if (req.session && req.session.user_id) {
       return res.redirect('/instructor');
   }
  res.sendFile(path.join(__dirname, '../client/public/instructor_signup.html'));
});

// Use login_required middleware for the instructor dashboard
app.get('/instructor', login_required, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/instructor.html'));
});

app.get('/lecture/:code', (req, res) => {
  // You might want to check if req.params.code is a valid lecture code format
  // before sending the file, but sending the file and letting the frontend
  // handle joining/errors is also common.
  res.sendFile(path.join(__dirname, '../client/public/lecture.html'));
});

// --- Catch-all for 404 errors ---
// This should be the *last* route handler
app.use((req, res, next) => {
  // logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`); // Original line
  logger.info(`404 Not Found: ${req.method} ${req.originalUrl}`); // FIXED line
  res.status(404).sendFile(path.join(__dirname, '../client/public/404.html')); // Serve a custom 404 page
});

// --- Global Error Handler ---
// This should be the *very last* middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, err.stack);
  // Avoid sending stack trace in production
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'An internal server error occurred.' : err.message;
  res.status(status).json({ error: message });
});


// --- Start Server ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});

// Optional: Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    // Close Firebase connection if needed (usually not required for admin SDK)
    // Close WebSocket connections
    wss.clients.forEach(client => client.terminate());
    process.exit(0);
  });
});

module.exports = app; // Export app for potential testing frameworks