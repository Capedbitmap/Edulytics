// client/public/scripts/firebase-secondary.js

// ✅ Config for the second Firebase project (video uploads only)
const videoAppConfig = {
    apiKey: "AIzaSyBhS62FgPzXcI9Senc6jmT3K5WkCJkTS5Y",
    authDomain: "lecture-video-analysis.firebaseapp.com",
    projectId: "lecture-video-analysis",
    storageBucket: "lecture-video-analysis.firebasestorage.app",
    messagingSenderId: "377469035793",
    appId: "1:377469035793:web:a119b837940adecdb018b0"
  };
  
  // ✅ Initialize secondary Firebase app (named instance)
  const videoApp = firebase.initializeApp(videoAppConfig, "videoApp");
  const videoStorage = videoApp.storage();
  