// server/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');

// Initialize environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create uploads directory if it doesn't exist
    const dir = './uploads';
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Initialize Firebase
try {
  const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
}

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// API endpoint to handle audio transcription
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const lectureCode = req.body.lectureCode;
    if (!lectureCode) {
      return res.status(400).json({ error: 'No lecture code provided' });
    }

    // Transcribe with Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
    });

    // Save to Firebase if there's text
    if (transcription.text) {
      const timestamp = Date.now();
      const db = getDatabase();
      const ref = db.ref(`lectures/${lectureCode}/transcriptions/${timestamp}`);
      await ref.set({
        text: transcription.text,
        timestamp: timestamp
      });

      // Also update active lecture
      const activeRef = db.ref('active_lecture');
      await activeRef.set({
        code: lectureCode,
        path: `lectures/${lectureCode}/transcriptions`
      });

      // Clean up the uploaded file
      fs.unlinkSync(req.file.path);

      return res.json({ 
        success: true, 
        text: transcription.text,
        timestamp: timestamp
      });
    } else {
      return res.status(400).json({ error: 'No text was transcribed' });
    }
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint to generate a lecture code
app.post('/api/generate-lecture-code', async (req, res) => {
  try {
    const { course_code, date, time, instructor, user_id } = req.body;
    
    if (!course_code || !date || !time || !instructor) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Generate a random 6-character code
    const code = generateUniqueCode();
    
    // Save to Firebase
    const db = getDatabase();
    const lectureRef = db.ref(`lectures/${code}`);
    
    await lectureRef.child('metadata').set({
      course_code: course_code,
      date: date,
      time: time,
      instructor: instructor,
      created_at: Date.now(),
      created_by: user_id || 'anonymous'
    });
    
    await lectureRef.child('transcriptions').set({});
    
    return res.json({ 
      success: true, 
      lecture_code: code 
    });
  } catch (error) {
    console.error('Error generating lecture code:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Helper to generate a unique code
function generateUniqueCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});