import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile as updateFirebaseProfile,
  type User,
} from "firebase/auth";

import { auth } from "../lib/firebase";
import { ApiError, apiRequest } from "../lib/api";

import {
  normalizeEmail,
  validateAuthForm,
  type AuthFields,
} from "../utils/auth-validation";

export const INTEREST_OPTIONS = [
  "Walking & outdoors",
  "Learning & books",
  "Volunteering",
  "Music & culture",
] as const;

export type AppUser = {
  id: string;
  fullName: string;
  email: string;
  area: string;
  interests: string[];
  joinedAt: string;
};

// Keep existing imports compatible.
// These values do not create or authenticate a demo account.
export const DEMO_USER_ID = "demo-margaret";

export const DEMO_CREDENTIALS = {
  email: "margaret@example.com",
  password: "ReIdentify123",
} as const;

type AuthResult =
  | { ok: true }
  | { ok: false; message: string };

type ProfileInput = Pick<
  AppUser,
  "fullName" | "area" | "interests"
>;

type AuthContextValue = {
  user: AppUser | null;
  loading: boolean;
  authError: string;
  signIn: (
    email: string,
    password: string
  ) => Promise<AuthResult>;
  register: (fields: AuthFields) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  updateProfile: (
    input: ProfileInput
  ) => Promise<AuthResult>;
  refreshProfile: () => Promise<AuthResult>;
};

const AuthContext = createContext<
  AuthContextValue | undefined
>(undefined);

function errorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Your email or password is incorrect.";

    case "auth/email-already-in-use":
      return "This email already has an account. Please sign in.";

    case "auth/invalid-email":
      return "Please enter a valid email address.";

    case "auth/weak-password":
      return "Please choose a stronger password.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";

    case "auth/network-request-failed":
      return "Cannot sign in. Check your internet connection.";

    case "auth/user-disabled":
      return "This account has been disabled.";

    case "auth/operation-not-allowed":
      return "Sign in is unavailable right now.";

    default:
      if (code) {
        return "We could not continue. Please try again.";
      }

      return error instanceof Error
        ? error.message
        : "Something went wrong. Try again.";
  }
}

async function saveProfile(
  account: User,
  input: ProfileInput
): Promise<AppUser> {
  const result = await apiRequest<{ user: AppUser }>(
    account,
    "PUT",
    input
  );

  return result.user;
}

async function loadProfile(
  account: User
): Promise<AppUser> {
  try {
    const result = await apiRequest<{ user: AppUser }>(
      account,
      "GET"
    );

    return result.user;
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 404
    ) {
      throw error;
    }

    // Recover an interrupted signup where only the
    // Firebase account was created.
    const name = account.displayName?.trim();

    return saveProfile(account, {
      fullName:
        name && name.length >= 2 ? name : "New member",
      area: "",
      interests: [],
    });
  }
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const pending = useRef(false);
  const version = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      (account) => {
        if (pending.current) return;

        const requestVersion = ++version.current;

        setUser(null);
        setAuthError("");
        setLoading(true);

        void (async () => {
          try {
            const profile = account
              ? await loadProfile(account)
              : null;

            if (
              mounted.current &&
              version.current === requestVersion
            ) {
              setUser(profile);
            }
          } catch (error) {
            if (
              mounted.current &&
              version.current === requestVersion
            ) {
              setAuthError(errorMessage(error));
            }
          } finally {
            if (
              mounted.current &&
              version.current === requestVersion
            ) {
              setLoading(false);
            }
          }
        })();
      }
    );

    return () => {
      mounted.current = false;
      ++version.current;
      unsubscribe();
    };
  }, []);

  async function runAction(
    action: () => Promise<AppUser | null>
  ): Promise<AuthResult> {
    if (pending.current) {
      return {
        ok: false,
        message: "Please wait for the current request.",
      };
    }

    pending.current = true;
    const requestVersion = ++version.current;

    setAuthError("");
    setLoading(true);

    try {
      await auth.authStateReady();

      const profile = await action();

      if (
        profile &&
        auth.currentUser?.uid !== profile.id
      ) {
        throw new Error(
          "Your login changed. Please try again."
        );
      }

      if (
        !mounted.current ||
        version.current !== requestVersion
      ) {
        return {
          ok: false,
          message: "Please try again.",
        };
      }

      setUser(profile);
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error);

      if (
        mounted.current &&
        version.current === requestVersion
      ) {
        setAuthError(message);

        setUser((current) =>
          current?.id === auth.currentUser?.uid
            ? current
            : null
        );
      }

      return { ok: false, message };
    } finally {
      pending.current = false;

      if (
        mounted.current &&
        version.current === requestVersion
      ) {
        setLoading(false);
      }
    }
  }

  async function signIn(
    email: string,
    password: string
  ): Promise<AuthResult> {
    const errors = validateAuthForm("login", {
      fullName: "",
      email,
      password,
      confirmPassword: "",
    });

    const message = Object.values(errors)[0];

    if (message) return { ok: false, message };

    return runAction(async () => {
      const result = await signInWithEmailAndPassword(
        auth,
        normalizeEmail(email),
        password
      );

      return loadProfile(result.user);
    });
  }

  async function register(
    fields: AuthFields
  ): Promise<AuthResult> {
    const errors = validateAuthForm("register", fields);
    const message = Object.values(errors)[0];

    if (message) return { ok: false, message };

    if (fields.fullName.trim().length > 80) {
      return {
        ok: false,
        message: "Use a name with 80 characters or fewer.",
      };
    }

    return runAction(async () => {
      let accountCreated = false;

      try {
        const result =
          await createUserWithEmailAndPassword(
            auth,
            normalizeEmail(fields.email),
            fields.password
          );

        accountCreated = true;

        await updateFirebaseProfile(result.user, {
          displayName: fields.fullName.trim(),
        });

        return await saveProfile(result.user, {
          fullName: fields.fullName.trim(),
          area: "",
          interests: [],
        });
      } catch (error) {
        if (accountCreated) {
          throw new Error(
            `Your account was created, but profile setup could not finish. ${errorMessage(error)} Choose Sign in or Try again to finish setup.`
          );
        }

        throw error;
      }
    });
  }

  async function signOut(): Promise<AuthResult> {
    return runAction(async () => {
      await firebaseSignOut(auth);
      return null;
    });
  }

  async function updateProfile(
    input: ProfileInput
  ): Promise<AuthResult> {
    return runAction(async () => {
      const account = auth.currentUser;

      if (!account) {
        throw new Error(
          "Please sign in to edit your profile."
        );
      }

      return saveProfile(account, input);
    });
  }

  async function refreshProfile(): Promise<AuthResult> {
    return runAction(async () => {
      const account = auth.currentUser;
      return account ? loadProfile(account) : null;
    });
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        signIn,
        register,
        signOut,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}