// client/public/scripts/firebase.js

// Import necessary Firebase SDKs (assuming v8 syntax based on other files)
// These should already be loaded via CDN in the HTML files that use Firebase.

// Initialize Firebase App globally when this script loads
// Ensure firebaseConfig is defined (from config.js loaded before this)
if (typeof firebaseConfig !== 'undefined') {
  if (!firebase.apps.length) { // Prevent re-initialization
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase App initialized globally.");

    // Initialize other Firebase services and attach them to the global firebase object
    // This makes them accessible as firebase.auth(), firebase.firestore(), etc.
    // Ensure the corresponding SDKs (auth, firestore, storage) are included in HTML files.
    if (!firebase.auth) {
        firebase.auth = firebase.auth();
        console.log("Firebase Auth initialized.");
    }
    if (!firebase.firestore) {
        firebase.firestore = firebase.firestore();
        console.log("Firebase Firestore initialized.");
    }
    if (!firebase.storage) {
        firebase.storage = firebase.storage();
        console.log("Firebase Storage initialized.");
    }
    // Initialize Realtime Database
    if (!firebase.database) {
        firebase.database = firebase.database();
        console.log("Firebase Realtime Database initialized.");
    }

  } else {
      console.log("Firebase App already initialized.");
      // Still ensure other services are initialized if the app was already there
      if (!firebase.auth) firebase.auth = firebase.auth();
      if (!firebase.firestore) firebase.firestore = firebase.firestore();
      if (!firebase.storage) firebase.storage = firebase.storage();
      if (!firebase.database) firebase.database = firebase.database(); // Also check here
  }
} else {
  console.error("Firebase config not found. Ensure config.js is loaded before firebase.js");
}

// Note: The FirebaseService class below seems focused on Realtime Database.
// It might be better to refactor this or create separate services/functions
// for Firestore/Storage interactions if the application grows more complex.
// For now, profile.js accesses firebase.firestore() and firebase.storage() directly.

class FirebaseService {
    constructor() {
      // Get the Realtime Database instance
      this.db = firebase.database();
      // Firestore and Storage are accessed via firebase.firestore() and firebase.storage()
    }

    // --- Realtime Database Methods ---

    // Get lecture data (Realtime DB)
    async getLecture(lectureCode) {
      try {
        const snapshot = await this.db.ref(`lectures/${lectureCode}`).once('value');
        return snapshot.val();
      } catch (error) {
        console.error('Error getting lecture:', error);
        throw error;
      }
    }
    
    // Listen for new transcriptions
    listenForTranscriptions(lectureCode, callback) {
      const ref = this.db.ref(`lectures/${lectureCode}/transcriptions`);
      
      // Listen for child added events
      ref.on('child_added', (snapshot) => {
        const data = snapshot.val();
        callback(data);
      });
      
      return () => ref.off('child_added'); // Return unsubscribe function
    }
    
    // Get all transcriptions for a lecture
    async getTranscriptions(lectureCode) {
      try {
        const snapshot = await this.db.ref(`lectures/${lectureCode}/transcriptions`).once('value');
        const data = snapshot.val() || {};
        
        // Convert to array and sort by timestamp
        return Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => a.timestamp - b.timestamp);
      } catch (error) {
        console.error('Error getting transcriptions:', error);
        throw error;
      }
    }
    
    // Get transcriptions after a certain timestamp
    async getTranscriptionsAfter(lectureCode, timestamp) {
      try {
        const ref = this.db.ref(`lectures/${lectureCode}/transcriptions`);
        const snapshot = await ref.orderByChild('timestamp').startAfter(timestamp).once('value');
        
        const data = snapshot.val() || {};
        
        return Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => a.timestamp - b.timestamp);
      } catch (error) {
        console.error('Error getting new transcriptions:', error);
        throw error;
      }
    }
  }