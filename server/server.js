// (with added realtime transcription WebSocket support)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');
const { generate: generateId } = require('shortid');
const session = require('express-session');
const { 
  generatePasswordHash, 
  checkPasswordHash 
} = require('./utils/auth');


// Initialize environment variables
dotenv.config(override=true);  // Force environment variables from .env to override system variables

// Configure logging
const logger = {
  info: (msg) => console.log(`INFO: ${msg}`),
  error: (msg) => console.error(`ERROR: ${msg}`),
};

// Initialize app and configurations
const app = express();
const server = http.createServer(app);

// Add this route to test Firebase connection after app is initialized
app.get('/test_firebase', async (req, res) => {
  try {
    console.log('Testing Firebase connection...');
    // Try to write a simple value
    const testRef = getDatabase().ref('test_connection');
    await testRef.set({
      timestamp: Date.now(),
      status: 'success'
    });
    console.log('Firebase test successful!');
    res.json({ success: true, message: 'Firebase connection successful' });
  } catch (error) {
    console.error('Firebase test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// Add session middleware after app initialization
app.use(session({
  secret: process.env.SECRET_KEY || 'dev-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));
app.secret_key = process.env.SECRET_KEY || 'dev-secret-key';

// Initialize Firebase
try {
  const cred_path = process.env.FIREBASE_CREDENTIALS_PATH || './firebase-credentials.json';
  const db_url = process.env.FIREBASE_DATABASE_URL;
  
  if (!fs.existsSync(cred_path) || !db_url) {
    throw new Error("Firebase credentials or database URL not found");
  }
  
  const serviceAccount = require(cred_path);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: db_url
  });
  logger.info("Firebase initialized successfully");
} catch (error) {
  logger.error(`Failed to initialize Firebase: ${error}`);
  throw error;
}

// Initialize OpenAI client
let client;
try {
  const openai_api_key = process.env.OPENAI_API_KEY;
  if (!openai_api_key) {
    throw new Error("OpenAI API key not found in environment variables");
  }
  
  client = new OpenAI({
    apiKey: openai_api_key
  });
  logger.info("OpenAI client initialized successfully");
} catch (error) {
  logger.error(`Failed to initialize OpenAI client: ${error}`);
  throw error;
}

// Different system prompts based on the selected option
const system_prompts = {
  'define': `
    You are an AI assistant designed to help university students understand lecture content in real-time. Your role is to define and clarify academic terms from live lecture transcriptions.

    Objective: Provide precise, academic definitions of key terms, concepts, or technical vocabulary found in the lecture snippet. Focus on clear, authoritative definitions that a university student would need to know.
    
    Context: You are receiving queries based on real-time transcriptions of university lectures. These may include single words, phrases, or full sentences, some of which may not be directly related to the academic content.
    
    Instructions:
        a. Analyze the student's request and the provided lecture snippet carefully.
        b. Provide a response that directly addresses the student's query, focusing only on academically relevant content.
        c. Keep explanations brief and to the point, typically no more than 2-3 sentences.
        d. Use academic language appropriate for university-level education.
        e. Focus solely on academic content, even if it's fragmented or interrupted.
        f. Ignore all administrative announcements, classroom management, and off-topic discussions.
        g. Provide brief, clear explanations of the academic concepts mentioned.
        h. If multiple concepts are mentioned, explain each one succinctly.
        i. If a concept is only partially mentioned, explain it based on the available information.

    Constraints:
        a. Do not elaborate beyond the scope of the question.
        b. Avoid using jargon unless explicitly explaining a technical term.
        c. Do not provide personal opinions or interpretations of the lecture content.
        d. If you're unsure about any information, clearly state that you don't have enough context to provide a definitive answer.
        e. Do not respond to administrative announcements or non-academic discussions.
  `,
  'explain': `
    You are an AI assistant designed to help university students understand lecture content in real-time. Your role is to provide detailed explanations of concepts from live lecture transcriptions.

    Objective: Provide concrete, relevant real-world examples that demonstrate how academic concepts apply in practical situations. Focus on making abstract ideas tangible through clear, relatable examples.

    Context: You are receiving queries based on real-time transcriptions of university lectures. These may include single words, phrases, or full sentences, some of which may not be directly related to the academic content.

    Instructions:
        a. Analyze the student's request and the provided lecture snippet carefully.
        b. Provide a response that directly addresses the student's query, focusing only on academically relevant content.
        c. Keep explanations brief and to the point, typically no more than 2-3 sentences.
        d. Use academic language appropriate for university-level education.
        e. Focus solely on academic content, even if it's fragmented or interrupted.
        f. Ignore all administrative announcements, classroom management, and off-topic discussions.
        g. Provide brief, clear explanations of the academic concepts mentioned.
        h. If multiple concepts are mentioned, explain each one succinctly.
        i. If a concept is only partially mentioned, explain it based on the available information.

    Constraints:
        a. Do not elaborate beyond the scope of the question.
        b. Avoid using jargon unless explicitly explaining a technical term.
        c. Do not provide personal opinions or interpretations of the lecture content.
        d. If you're unsure about any information, clearly state that you don't have enough context to provide a definitive answer.
        e. Do not respond to administrative announcements or non-academic discussions.
  `,
  'examples': `
    You are an AI assistant providing real-world examples. For the given academic concept, provide 2-3 concrete, practical examples that illustrate how it applies in the real world.
    
    Objective: Provide concrete, relevant real-world examples that demonstrate how academic concepts apply in practical situations. Focus on making abstract ideas tangible through clear, relatable examples.

    Context: You are receiving queries based on real-time transcriptions of university lectures. These may include single words, phrases, or full sentences, some of which may not be directly related to the academic content.

    Instructions:
        a. Analyze the student's request and the provided lecture snippet carefully.
        b. Provide a response that directly addresses the student's query, focusing only on academically relevant content.
        c. Keep explanations brief and to the point, typically no more than 2-3 sentences.
        d. Use academic language appropriate for university-level education.
        e. Focus solely on academic content, even if it's fragmented or interrupted.
        f. Ignore all administrative announcements, classroom management, and off-topic discussions.
        g. Provide brief, clear explanations of the academic concepts mentioned.
        h. If multiple concepts are mentioned, explain each one succinctly.
        i. If a concept is only partially mentioned, explain it based on the available information.

    Constraints:
        a. Do not elaborate beyond the scope of the question.
        b. Avoid using jargon unless explicitly explaining a technical term.
        c. Do not provide personal opinions or interpretations of the lecture content.
        d. If you're unsure about any information, clearly state that you don't have enough context to provide a definitive answer.
        e. Do not respond to administrative announcements or non-academic discussions.
  `,
  'simplify': `
    You are an AI assistant explaining complex concepts in simple terms. Explain the given text as if speaking to someone with no background in the subject, using simple analogies and everyday language.

    Objective: Transform complex academic concepts into simple, accessible explanations using everyday language and familiar analogies. Make difficult ideas understandable without losing their essential meaning.

    Context: You are receiving queries based on real-time transcriptions of university lectures. These may include single words, phrases, or full sentences, some of which may not be directly related to the academic content.

    Instructions:
        a. Analyze the student's request and the provided lecture snippet carefully.
        b. Provide a response that directly addresses the student's query, focusing only on academically relevant content.
        c. Keep explanations brief and to the point, typically no more than 2-3 sentences.
        d. Use academic language appropriate for university-level education.
        e. Focus solely on academic content, even if it's fragmented or interrupted.
        f. Ignore all administrative announcements, classroom management, and off-topic discussions.
        g. Provide brief, clear explanations of the academic concepts mentioned.
        h. If multiple concepts are mentioned, explain each one succinctly.
        i. If a concept is only partially mentioned, explain it based on the available information.

    Constraints:
        a. Do not elaborate beyond the scope of the question.
        b. Avoid using jargon unless explicitly explaining a technical term.
        c. Do not provide personal opinions or interpretations of the lecture content.
        d. If you're unsure about any information, clearly state that you don't have enough context to provide a definitive answer.
        e. Do not respond to administrative announcements or non-academic discussions.
  `
};

// Create a users reference in Firebase
function get_users_ref() {
  return getDatabase().ref('users');
}

// Authentication helper functions
function login_required(f) {
  return function(req, res, next) {
    if (!req.session || !req.session.user_id) {
      // Check if this is an AJAX request
      if (req.xhr || req.headers.accept.indexOf('json') !== -1 || req.path.startsWith('/api/')) {
        // Return JSON error for AJAX requests
        return res.status(401).json({'error': 'Authentication required', 'redirect': '/instructor/login'});
      }
      // Regular browser request gets redirected
      return res.redirect('/instructor/login');
    }
    return f(req, res, next);
  };
}

// Function to generate a unique lecture code
async function generate_unique_lecture_code() {
  const code_length = 6;
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  while (true) {
    // Generate a random code
    let code = '';
    for (let i = 0; i < code_length; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    // Check if the code already exists in Firebase
    const ref = getDatabase().ref(`lectures/${code}`);
    const snapshot = await ref.get();
    
    if (!snapshot.exists()) {
      return code;
    }
  }
}

// Set up WebSocket server for OpenAI Realtime API
const wss = new WebSocket.Server({ server });

// Track active transcription sessions
const activeTranscriptions = new Map();

// Handle WebSocket connections
wss.on('connection', async function(ws, req) {
  try {
    // Parse URL to get lecture code
    const url = new URL(req.url, `http://${req.headers.host}`);
    const lectureCode = url.searchParams.get('lecture_code');
    
    if (!lectureCode) {
      logger.error('WebSocket connection attempt without lecture code');
      ws.close(1008, 'Lecture code is required');
      return;
    }
    
    logger.info(`New WebSocket connection for lecture: ${lectureCode}`);
    
    // Check if lecture exists
    const lectureRef = getDatabase().ref(`lectures/${lectureCode}`);
    const lecture = await lectureRef.get();
    
    if (!lecture) {
      logger.error(`Invalid lecture code: ${lectureCode}`);
      ws.close(1008, 'Invalid lecture code');
      return;
    }
    
    // Generate a unique session ID for this connection
    const sessionId = uuidv4();
    
    // Establish connection to OpenAI Realtime API
    const openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });
    
    // Handle OpenAI WebSocket connection
    openaiWs.on('open', function() {
      logger.info(`Connected to OpenAI Realtime API for lecture: ${lectureCode}`);
      
      // Configure the transcription session
      const configEvent = JSON.stringify({
        "type": "transcription_session.update",
        "input_audio_format": "pcm16",
        "input_audio_transcription": [{
          "model": "gpt-4o-mini-transcribe",
          "prompt": "",
          "language": "en"
        }],
        "turn_detection": {
          "type": "server_vad",
          "threshold": 0.5,
          "prefix_padding_ms": 300,
          "silence_duration_ms": 700,
        },
        "input_audio_noise_reduction": {
          "type": "near_field"
        }
      });
      
      openaiWs.send(configEvent);
      
      // Notify client that connection is ready
      ws.send(JSON.stringify({ 
        type: 'status', 
        status: 'connected',
        session_id: sessionId
      }));
    });
    
    // Handle messages from OpenAI
    openaiWs.on('message', function(data) {
      try {
        const event = JSON.parse(data.toString());
        
        // Process transcription events
        if (event.type === 'conversation.item.input_audio_transcription.delta' || 
            event.type === 'conversation.item.input_audio_transcription.completed') {
          
          const text = event.type === 'conversation.item.input_audio_transcription.delta' ? 
                       event.delta : event.transcript;
          
          // Only process completed transcriptions or meaningful deltas
          if (event.type === 'conversation.item.input_audio_transcription.completed' || 
              (text && text.trim().length > 0)) {
            
            // Save to Firebase
            const timestamp = Date.now();
            const transcriptRef = getDatabase().ref(`lectures/${lectureCode}/transcriptions/${timestamp}`);
            
            transcriptRef.set({
              text: text,
              timestamp: timestamp
            });
            
            // Forward the event to the client
            ws.send(JSON.stringify({
              type: 'transcription',
              event_type: event.type,
              text: text,
              timestamp: timestamp,
              item_id: event.item_id
            }));
          }
        }
      } catch (error) {
        logger.error(`Error processing message from OpenAI: ${error}`);
      }
    });
    
    // Handle errors with OpenAI connection
    openaiWs.on('error', function(error) {
      logger.error(`OpenAI WebSocket error for lecture ${lectureCode}: ${error}`);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Error connecting to transcription service'
      }));
    });
    
    // Handle OpenAI connection close
    openaiWs.on('close', function(code, reason) {
      logger.info(`OpenAI connection closed for lecture ${lectureCode}: ${code} - ${reason}`);
      
      // Clean up session
      if (activeTranscriptions.has(sessionId)) {
        activeTranscriptions.delete(sessionId);
      }
      
      // Notify client
      ws.send(JSON.stringify({ 
        type: 'status', 
        status: 'disconnected',
        reason: reason
      }));
    });
    
    // Store the connection info
    activeTranscriptions.set(sessionId, {
      ws,
      openaiWs,
      lectureCode,
      startTime: Date.now()
    });
    
    // Handle audio data from client
    ws.on('message', function(message) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        return;
      }
      
      try {
        // Check if binary data or control message
        if (Buffer.isBuffer(message)) {
          // Forward binary audio data to OpenAI
          const base64Audio = message.toString('base64');
          
          // Send audio data to OpenAI
          openaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            buffer: base64Audio
          }));
        } else {
          // Handle control messages
          const msg = JSON.parse(message.toString());
          
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        }
      } catch (error) {
        logger.error(`Error processing client message: ${error}`);
      }
    });
    
    // Handle client disconnection
    ws.on('close', function() {
      logger.info(`Client disconnected for lecture ${lectureCode}`);
      
      // Close OpenAI connection
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
      
      // Clean up session
      if (activeTranscriptions.has(sessionId)) {
        activeTranscriptions.delete(sessionId);
      }
    });
  } catch (error) {
    logger.error(`WebSocket connection error: ${error}`);
    ws.close(1011, 'Internal server error');
  }
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({ status: 'active', activeTranscriptions: activeTranscriptions.size });
});

// Routes for controlling recording
app.post('/start_recording', login_required, async (req, res) => {
  try {
    const data = req.body;
    const lecture_code = data.lecture_code;
    
    if (!lecture_code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Check if lecture exists
    const lecture_ref = getDatabase().ref(`lectures/${lecture_code}`);
    const snapshot = await lecture_ref.get();
    
    if (!snapshot.exists()) {
      return res.status(404).json({'error': 'Invalid lecture code'});
    }
    
    // Set as active lecture
    const active_ref = getDatabase().ref('active_lecture');
    active_ref.set({
      'code': lecture_code,
      'path': `lectures/${lecture_code}/transcriptions`
    });
    
    // Transcription is now handled via WebSocket, so we just update status
    return res.json({
      'success': true,
      'start_time': Date.now()
    });
  } catch (error) {
    logger.error(`Error starting recording: ${error}`);
    return res.status(500).json({'error': error.message});
  }
});

app.post('/stop_recording', login_required, (req, res) => {
  try {
    const data = req.body;
    const lecture_code = data.lecture_code;
    
    if (!lecture_code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Close any active WebSocket connections for this lecture
    let connectionsClosed = 0;
    
    for (const [sessionId, session] of activeTranscriptions.entries()) {
      if (session.lectureCode === lecture_code) {
        if (session.openaiWs.readyState === WebSocket.OPEN) {
          session.openaiWs.close();
        }
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        activeTranscriptions.delete(sessionId);
        connectionsClosed++;
      }
    }
    
    return res.json({
      'success': true,
      'connections_closed': connectionsClosed
    });
  } catch (error) {
    logger.error(`Error stopping recording: ${error}`);
    return res.status(500).json({'error': error.message});
  }
});

app.get('/recording_status', login_required, (req, res) => {
  try {
    const lecture_code = req.query.lecture_code;
    
    if (lecture_code) {
      // Get status for a specific lecture
      let isRecording = false;
      let startTime = null;
      
      for (const session of activeTranscriptions.values()) {
        if (session.lectureCode === lecture_code) {
          isRecording = true;
          startTime = session.startTime;
          break;
        }
      }
      
      return res.json({
        'is_recording': isRecording,
        'start_time': startTime
      });
    } else {
      // Get status for all lectures
      const status = {};
      
      for (const session of activeTranscriptions.values()) {
        const code = session.lectureCode;
        
        if (!status[code]) {
          status[code] = {
            'is_recording': true,
            'start_time': session.startTime
          };
        }
      }
      
      return res.json(status);
    }
  } catch (error) {
    logger.error(`Error getting recording status: ${error}`);
    return res.status(500).json({'error': error.message});
  }
});

// Authentication routes
app.post('/instructor/login', async (req, res) => {
  try {
    const data = req.body;
    const email = data.email;
    const password = data.password;
    
    if (!email || !password) {
      return res.status(400).json({'error': 'Email and password are required'});
    }
    
    // Find user by email
    const users_ref = get_users_ref();
    const snapshot = await users_ref.get();
    const users = snapshot.val() || {};
    
    let user_id = null;
    let user_data = null;
    
    for (const [uid, user] of Object.entries(users)) {
      if (user.email === email) {
        user_id = uid;
        user_data = user;
        break;
      }
    }
    
    if (!user_id || !user_data) {
      return res.status(401).json({'error': 'Invalid email or password'});
    }
    
    // Verify password
    if (!checkPasswordHash(user_data.password, password)) {
      return res.status(401).json({'error': 'Invalid email or password'});
    }
    
    // Set session
    req.session.user_id = user_id;
    req.session.email = email;
    req.session.name = user_data.name || '';
    
    return res.json({'success': true});
  } catch (error) {
    logger.error(`Login error: ${error}`);
    return res.status(500).json({'error': 'An error occurred during login'});
  }
});

app.post('/instructor/signup', async (req, res) => {
  try {
    const data = req.body;
    const name = data.name;
    const email = data.email;
    const password = data.password;
    
    if (!name || !email || !password) {
      return res.status(400).json({'error': 'All fields are required'});
    }
    
    if (password.length < 8) {
      return res.status(400).json({'error': 'Password must be at least 8 characters long'});
    }
    
    // Check if email is already in use
    const users_ref = get_users_ref();
    const usersSnapshot = await users_ref.get();
    const users = usersSnapshot.val() || {};
    
    for (const [uid, user] of Object.entries(users)) {
      if (user.email === email) {
        return res.status(400).json({'error': 'Email is already in use'});
      }
    }
    
    // Hash password
    const hashed_password = generatePasswordHash(password);
    
    // Create user
    const new_user_ref = users_ref.push();
    const user_id = new_user_ref.key;
    
    await new_user_ref.set({
      'name': name,
      'email': email,
      'password': hashed_password,
      'created_at': Date.now()
    });
    
    // Set session
    req.session.user_id = user_id;
    req.session.email = email;
    req.session.name = name;
    
    return res.json({'success': true});
  } catch (error) {
    logger.error(`Signup error: ${error}`);
    return res.status(500).json({'error': 'An error occurred during signup'});
  }
});

app.get('/instructor/logout', (req, res) => {
  req.session = null;
  return res.redirect('/');
});

// Lecture code generation
app.post('/generate_lecture_code', login_required, async (req, res) => {
  try {
    console.log('Received request to generate lecture code:', req.body);

    // Get lecture details from request
    const data = req.body;
    const course_code = data.course_code;
    const date = data.date;
    const time_str = data.time;
    const instructor = data.instructor;
    
    if (!course_code || !date || !time_str || !instructor) {
      console.log('Missing required fields:', { course_code, date, time_str, instructor });
      return res.status(400).json({'error': 'Missing required fields'});
    }

    console.log('Generating lecture code...');
    
    // Test Firebase connection before proceeding
    try {
      console.log('Testing Firebase before generating code...');
      const testRef = getDatabase().ref('test_connection');
      await testRef.set({ timestamp: Date.now() });
      console.log('Firebase test successful, proceeding with code generation');
    } catch (fbError) {
      console.error('Firebase connection test failed:', fbError);
      return res.status(500).json({'error': `Firebase connection failed: ${fbError.message}`});
    }
    
    // Generate a unique lecture code
    const lecture_code = await generate_unique_lecture_code();
    console.log(`Generated unique code: ${lecture_code}`);
    
    // Create the database structure
    console.log('Creating lecture structure in Firebase...');
    const lectures_ref = getDatabase().ref('lectures');
    const lecture_ref = lectures_ref.child(lecture_code);
    
    // Set the metadata
    console.log('Setting metadata...');
    const metadata_ref = lecture_ref.child('metadata');
    await metadata_ref.set({
      'course_code': course_code,
      'date': date,
      'time': time_str,
      'instructor': instructor,
      'created_at': Date.now(),
      'created_by': req.session.user_id
    });
    
    console.log('Setting up transcriptions node...');
    // Create empty transcriptions node
    await lecture_ref.child('transcriptions').set({});
    
    // Set as active lecture if requested
    if (data.set_active) {
      console.log('Setting as active lecture...');
      const active_ref = getDatabase().ref('active_lecture');
      await active_ref.set({
        'code': lecture_code,
        'path': `lectures/${lecture_code}/transcriptions`
      });
    }
    
    console.log(`Generated lecture code: ${lecture_code}`);

    logger.info(`Generated lecture code: ${lecture_code}`);
    return res.json({'lecture_code': lecture_code, 'success': true});
  } catch (error) {
    console.error(`Error generating lecture code (FULL ERROR):`, error);
    logger.error(`Error generating lecture code: ${error}`);
    return res.status(500).json({'error': `Failed to generate lecture code: ${error.message}`});
  }
});

// Join lecture route
app.post('/join_lecture', async (req, res) => {
  try {
    // Get lecture code from request
    const data = req.body;
    const lecture_code = data.lecture_code;
    
    if (!lecture_code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Check if the lecture code exists
    const lecture_ref = getDatabase().ref(`lectures/${lecture_code}`);
    const lecture_data = await lecture_ref.get();
    
    if (!lecture_data) {
      return res.status(404).json({'error': 'Invalid lecture code'});
    }
    
    // Return the lecture details and transcriptions path
    return res.json({
      'success': true,
      'metadata': lecture_data.metadata || {},
      'path': `lectures/${lecture_code}/transcriptions`
    });
  } catch (error) {
    logger.error(`Error joining lecture: ${error}`);
    return res.status(500).json({'error': `Failed to join lecture: ${error.message}`});
  }
});

// Get lecture transcriptions
app.get('/get_lecture_transcriptions', async (req, res) => {
  try {
    const lecture_code = req.query.lecture_code;
    const after_timestamp = req.query.after;
    
    if (!lecture_code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Get the transcriptions for the lecture
    const transcriptions_ref = getDatabase().ref(`lectures/${lecture_code}/transcriptions`);
    let query = transcriptions_ref;
    
    if (after_timestamp) {
      query = transcriptions_ref.orderByChild('timestamp').startAfter(parseInt(after_timestamp));
    }
    
    const snapshot = await query.get();
    const transcriptions = snapshot.val() || {};
    
    // Convert to array and format for response
    const formatted_transcriptions = Object.entries(transcriptions).map(([key, value]) => {
      return {
        'id': key,
        'text': value.text,
        'timestamp': value.timestamp || 0
      };
    }).sort((a, b) => a.timestamp - b.timestamp);
    
    return res.json({'transcriptions': formatted_transcriptions});
  } catch (error) {
    logger.error(`Error getting lecture transcriptions: ${error}`);
    return res.status(500).json({'error': `Failed to get transcriptions: ${error.message}`});
  }
});

// Get explanation from OpenAI
app.post('/get_explanation', async (req, res) => {
  try {
    const text = req.body.text;
    const option = req.body.option || 'explain';
    
    if (!text) {
      return res.status(400).json({'error': 'No text provided'});
    }
    
    const messages = [
      {
        "role": "system",
        "content": system_prompts[option] || system_prompts['explain']
      },
      {
        "role": "user",
        "content": text
      }
    ];
    
    const response = await client.chat.completions.create({
      model: "o3-mini",
      messages: messages
    });
    
    const reply = response.choices[0].message.content;
    logger.info(`Generated explanation for text: ${text.substring(0, 50)}...`);
    
    return res.json({'explanation': reply});
  } catch (error) {
    logger.error(`Error getting explanation: ${error}`);
    return res.status(500).json({'error': `Failed to get explanation: ${error.message}`});
  }
});

// Get summary from OpenAI
app.post('/get_summary', async (req, res) => {
  try {
    const text = req.body.text;
    const minutes = req.body.minutes;
    
    if (!text) {
      return res.status(400).json({'error': 'No text provided'});
    }
    
    if (!minutes) {
      return res.status(400).json({'error': 'No time period specified'});
    }
    
    const messages = [
      {
        "role": "system",
        "content": `You are an AI assistant designed to summarize lecture content. Your task is to provide a clear, concise summary of the last ${minutes} minute${minutes === 1 ? '' : 's'} of lecture content.

        Objective: Create a well-structured summary that captures the main points and key concepts discussed in the provided timeframe.
        
        Instructions:
        1. Focus on the main topics and key points
        2. Maintain chronological order where relevant
        3. Highlight important concepts or terms
        4. Keep the summary concise but comprehensive
        5. Use clear, academic language
        6. Organize the summary in a structured way with bullet points or clear paragraphs
        7. Ignore administrative announcements or non-academic content
        8. If the content appears fragmented, focus on the most coherent and important points
        9. Highlight any key terms, definitions, or concepts that were introduced
        10. If possible, indicate the progression or connection between different topics

        Constraints:
        1. Focus only on academic content
        2. Do not make assumptions about content outside the provided text
        3. If the content is unclear or fragmented, acknowledge this in your summary
        4. Keep the summary proportional to the time period covered
        5. Use appropriate academic language while maintaining clarity`
      },
      {
        "role": "user",
        "content": text
      }
    ];
    
    const response = await client.chat.completions.create({
      model: "o3-mini",
      messages: messages
    });
    
    const reply = response.choices[0].message.content;
    logger.info(`Generated summary for last ${minutes} minute(s)`);
    
    return res.json({'summary': reply});
  } catch (error) {
    logger.error(`Error getting summary: ${error}`);
    return res.status(500).json({'error': `Failed to get summary: ${error.message}`});
  }
});

// Static routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/landing.html'));
});

app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

app.get('/instructor/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/instructor_login.html'));
});

app.get('/instructor/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/instructor_signup.html'));
});

app.get('/instructor', (req, res) => {
  // Check if user is logged in
  if (!req.session || !req.session.user_id) {
    return res.redirect('/instructor/login');
  }
  res.sendFile(path.join(__dirname, '../client/public/instructor.html'));
});

app.get('/lecture/:code', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/lecture.html'));
});


// Start the server - THIS IS THE PROBLEM: routes defined after server.listen() aren't registered
const PORT = process.env.PORT || 8080;

// Define all routes before starting the server
// Get user info for the logged-in instructor
app.get('/get_user_info', login_required, async (req, res) => {
  try {
    // Return the user information from the session
    return res.json({
      'name': req.session.name,
      'email': req.session.email,
      'user_id': req.session.user_id
    });
  } catch (error) {
    logger.error(`Error getting user info: ${error}`);
    return res.status(500).json({'error': 'An error occurred while retrieving user information'});
  }
});

// Get active lecture
app.get('/active_lecture', async (req, res) => {
  try {
    // Get the active lecture from the database
    const active_ref = getDatabase().ref('active_lecture');
    const active_data = await active_ref.get();
    
    if (!active_data) {
      return res.json(null);
    }
    
    return res.json(active_data);
  } catch (error) {
    logger.error(`Error getting active lecture: ${error}`);
    return res.status(500).json({'error': `Failed to get active lecture: ${error.message}`});
  }
});

// Get lectures for the logged-in instructor
app.get('/get_instructor_lectures', login_required, async (req, res) => {
  try {
    const user_id = req.session.user_id;
    
    if (!user_id) {
      return res.status(401).json({'error': 'User not authenticated'});
    }
    
    // Get all lectures from the database
    const lectures_ref = getDatabase().ref('lectures');
    const lectures_snapshot = await lectures_ref.get();
    const lectures = lectures_snapshot.val() || {};
    
    // Filter lectures created by this instructor
    const instructor_lectures = {};
    
    for (const [code, lecture] of Object.entries(lectures)) {
      if (lecture.metadata && lecture.metadata.created_by === user_id) {
        instructor_lectures[code] = lecture;
      }
    }
    
    return res.json({'lectures': instructor_lectures});
  } catch (error) {
    logger.error(`Error getting instructor lectures: ${error}`);
    return res.status(500).json({'error': `Failed to get lectures: ${error.message}`});
  }
});

// Get lecture info by code
app.get('/get_lecture_info', async (req, res) => {
  try {
    const code = req.query.code;
    
    if (!code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Get the lecture from the database
    const lecture_ref = getDatabase().ref(`lectures/${code}`);
    const lecture_data = await lecture_ref.get();
    
    if (!lecture_data) {
      return res.status(404).json({'error': 'Lecture not found'});
    }
    
    return res.json({
      'success': true,
      'metadata': lecture_data.metadata || {}
    });
  } catch (error) {
    logger.error(`Error getting lecture info: ${error}`);
    return res.status(500).json({'error': `Failed to get lecture info: ${error.message}`});
  }
});

// Add route for setting active lecture
app.post('/set_active_lecture', login_required, async (req, res) => {
  try {
    const data = req.body;
    const lecture_code = data.lecture_code;
    
    if (!lecture_code) {
      return res.status(400).json({'error': 'No lecture code provided'});
    }
    
    // Check if lecture exists
    const lecture_ref = getDatabase().ref(`lectures/${lecture_code}`);
    const snapshot = await lecture_ref.get();
    
    if (!snapshot.exists()) {
      return res.status(404).json({'error': 'Invalid lecture code'});
    }
    
    // Set as active lecture
    const active_ref = getDatabase().ref('active_lecture');
    await active_ref.set({
      'code': lecture_code,
      'path': `lectures/${lecture_code}/transcriptions`
    });
    
    return res.json({
      'success': true
    });
  } catch (error) {
    logger.error(`Error setting active lecture: ${error}`);
    return res.status(500).json({'error': error.message});
  }
});

// Now start the server after all routes are defined
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Export app for testing
module.exports = app;


