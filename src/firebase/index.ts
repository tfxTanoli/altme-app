'use client';

import { firebaseConfig } from '@/firebase/Firebase';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
// import { getFirestore, initializeFirestore } from 'firebase/firestore'  -- Removed for RTDB migration
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';


// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (getApps().length) {
    return getSdks(getApp());
  }

  const app = initializeApp(firebaseConfig);

  return getSdks(app);
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    storage: getStorage(firebaseApp),
    database: getDatabase(firebaseApp),
  };
}

export * from './provider';
export * from './client-provider';
