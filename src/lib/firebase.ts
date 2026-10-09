import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  FirebaseError,
  getApps,
  initializeApp,
} from "firebase/app";
import * as FirebaseAuth from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC0N7gLHjeFSB1FnBb1p_6Yjahw2yOxDYk",
  authDomain: "reidentify-backend.firebaseapp.com",
  projectId: "reidentify-backend",
  storageBucket: "reidentify-backend.firebasestorage.app",
  messagingSenderId: "22425381422",
  appId: "1:22425381422:web:e94f9daf86fa4c55ebcdbf",
};

const existingApp = getApps().find(
  (app) => app.name === "[DEFAULT]"
);

export const firebaseApp =
  existingApp ?? initializeApp(firebaseConfig);

// Firebase's shared types omit this native-only export.
const nativeAuth = FirebaseAuth as typeof FirebaseAuth & {
  getReactNativePersistence: (
    storage: typeof AsyncStorage
  ) => FirebaseAuth.Persistence;
};

function initializeFirebaseAuth(): FirebaseAuth.Auth {
  if (Platform.OS === "web") {
    return FirebaseAuth.getAuth(firebaseApp);
  }

  try {
    return FirebaseAuth.initializeAuth(firebaseApp, {
      persistence:
        nativeAuth.getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      error.code === "auth/already-initialized"
    ) {
      return FirebaseAuth.getAuth(firebaseApp);
    }

    throw error;
  }
}

export const auth = initializeFirebaseAuth();