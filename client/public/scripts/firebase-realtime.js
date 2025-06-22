
// Your web app's Firebase configuration
const firebaseRealtimeConfig = {
    apiKey: "AIzaSyAqENSap2THULkWKiwG4W0SDfHTjWqZKHA",
    authDomain: "lecture-video-realtime.firebaseapp.com",
    databaseURL: "https://lecture-video-realtime-default-rtdb.firebaseio.com",
    projectId: "lecture-video-realtime",
    storageBucket: "lecture-video-realtime.firebasestorage.app",
    messagingSenderId: "859794802664",
    appId: "1:859794802664:web:b435963dbd2fc38acb065d"
  };
  
const firebaseRealtimeApp = firebase.initializeApp(firebaseRealtimeConfig, "realtime");
const realtimeDatabase = firebaseRealtimeApp.database();
window.realtimeDatabase = realtimeDatabase;


