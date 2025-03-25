// client/public/scripts/firebase.js
class FirebaseService {
    constructor() {
      // Initialize Firebase
      firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
    }
    
    // Get lecture data
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