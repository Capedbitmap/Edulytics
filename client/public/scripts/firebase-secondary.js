// client/public/scripts/firebase-secondary.js


const videoAppConfig = {
    apiKey: "AIzaSyBhS62FgPzXcI9Senc6jmT3K5WkCJkTS5Y",
    authDomain: "lecture-video-analysis.firebaseapp.com",
    projectId: "lecture-video-analysis",
    storageBucket: "lecture-video-analysis.firebasestorage.app",
    messagingSenderId: "377469035793",
    appId: "1:377469035793:web:a119b837940adecdb018b0"
  };
  

  const videoApp = firebase.initializeApp(videoAppConfig, "videoApp");
  const videoStorage = videoApp.storage();
  