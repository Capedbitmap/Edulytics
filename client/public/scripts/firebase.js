// client/public/scripts/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
// Import necessary Firebase modules
import { getDatabase, ref, onChildAdded, off, get, query, orderByChild, startAfter } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";
// Example: import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
// Example: import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";

// Import the configuration
import { firebaseConfig } from './config.js';

let app;
let auth;
let firestore;
let db; // Realtime Database
let storage;

try {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);
  console.log("Firebase App initialized via module.");

  // Initialize Realtime Database (since FirebaseService uses it)
  db = getDatabase(app);
  console.log("Firebase Realtime Database initialized.");

  // Initialize other services as needed by uncommenting/adding imports above
  // auth = getAuth(app);
  // firestore = getFirestore(app);
  storage = getStorage(app);
  console.log("Firebase Storage initialized.");

 } catch (error) {
  console.error("Error initializing Firebase:", error);
  // Handle initialization error appropriately
}

// Note: The FirebaseService class below seems focused on Realtime Database.
// Consider refactoring if using Firestore/Storage more heavily.
class FirebaseService {
  constructor() {
    if (!db) {
       console.error("Realtime Database failed to initialize before FirebaseService constructor.");
       throw new Error("Realtime Database is required for FirebaseService but failed to initialize.");
    }
    // Get the Realtime Database instance
    this.db = db;
    // Firestore and Storage would be accessed via the exported 'firestore' and 'storage' variables if initialized
  }

  // --- Realtime Database Methods (using v9 syntax) ---

  // Get lecture data (Realtime DB)
  async getLecture(lectureCode) {
    try {
      const lectureRef = ref(this.db, `lectures/${lectureCode}`);
      const snapshot = await get(lectureRef);
      return snapshot.val();
    } catch (error) {
      console.error('Error getting lecture:', error);
      throw error;
    }
  }

  // Listen for new transcriptions
  listenForTranscriptions(lectureCode, callback) {
    const transcriptionsRef = ref(this.db, `lectures/${lectureCode}/transcriptions`);

    // Listen for child added events
    const unsubscribe = onChildAdded(transcriptionsRef, (snapshot) => {
      const data = snapshot.val();
      callback(data);
    });

    return unsubscribe; // Return unsubscribe function
  }

  // Get all transcriptions for a lecture
  async getTranscriptions(lectureCode) {
    try {
      const transcriptionsRef = ref(this.db, `lectures/${lectureCode}/transcriptions`);
      const snapshot = await get(query(transcriptionsRef, orderByChild('timestamp'))); // Order by timestamp
      const data = snapshot.val() || {};

      // Convert to array (already sorted by query)
      return Object.entries(data)
        .map(([key, value]) => ({ id: key, ...value }));
        // .sort((a, b) => a.timestamp - b.timestamp); // Sorting might be redundant due to orderByChild
    } catch (error) {
      console.error('Error getting transcriptions:', error);
      throw error;
    }
  }

  // Get transcriptions after a certain timestamp
  async getTranscriptionsAfter(lectureCode, timestamp) {
    try {
      const transcriptionsRef = ref(this.db, `lectures/${lectureCode}/transcriptions`);
      const q = query(transcriptionsRef, orderByChild('timestamp'), startAfter(timestamp));
      const snapshot = await get(q);

      const data = snapshot.val() || {};

      return Object.entries(data)
        .map(([key, value]) => ({ id: key, ...value }))
        .sort((a, b) => a.timestamp - b.timestamp); // Keep sort here as startAfter might affect order slightly depending on exact timestamps
    } catch (error) {
      console.error('Error getting new transcriptions:', error);
      throw error;
    }
  }
}

// Export the initialized app, services, and the service class
export { app, auth, firestore, db, storage, FirebaseService };