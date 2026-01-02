
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
      // Parse the JSON credentials from environment variable
      const serviceAccount = JSON.parse(serviceAccountKey);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      // Fallback to standard GOOGLE_APPLICATION_CREDENTIALS file path strategy
      // This will look for GOOGLE_APPLICATION_CREDENTIALS env var pointing to a JSON file
      admin.initializeApp();
    }
  } catch (error) {
    console.error('Firebase Admin Initialization Error:', error);
    throw new Error('Failed to initialize Firebase Admin SDK. Please check your FIREBASE_SERVICE_ACCOUNT_KEY environment variable.');
  }
}

export const firestore = admin.firestore();
export const auth = admin.auth();
