import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase client config — NOT secret, safe to expose in the browser bundle.
// Values come from environment variables (set in .env locally, in Vercel for prod).
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Backend base URL — localhost in dev, the Render URL in production (set in Vercel).
export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Builds request headers including the current user's Firebase ID token,
// which the backend verifies before talking to SAP.
export async function authHeaders() {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
