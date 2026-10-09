import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

export const DEMO_CREDENTIALS = {
  email: "margaret@example.com",
  password: "ReIdentify123",
} as const;

export const DEMO_USER_ID = "demo-margaret";

type AuthResult = { ok: true } | { ok: false; message: string };

type ProfileInput = Pick<AppUser, "fullName" | "area" | "interests">;

type AuthContextValue = {
  user: AppUser | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  register: (fields: AuthFields) => Promise<AuthResult>;
  signOut: () => void;
  updateProfile: (input: ProfileInput) => AuthResult;
};

type DemoAccount = { user: AppUser; password: string };

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function createDemoAccount(): DemoAccount {
  return {
    user: {
      id: DEMO_USER_ID,
      fullName: "Margaret Hughes",
      email: DEMO_CREDENTIALS.email,
      area: "Etobicoke, Toronto",
      interests: ["Walking & outdoors", "Learning & books"],
      joinedAt: new Date(2026, 5, 1).toISOString(),
    },
    password: DEMO_CREDENTIALS.password,
  };
}

/**
 * Frontend preview only. Accounts and the session live in memory and reset
 * when the app restarts. No passwords or account records are written to storage.
 * Replace the method bodies with Firebase/Node integration in the backend phase.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const accounts = useRef<DemoAccount[]>([createDemoAccount()]);
  const nextUserId = useRef(1);

  async function signIn(email: string, password: string): Promise<AuthResult> {
    const errors = validateAuthForm("login", {
      fullName: "",
      email,
      password,
      confirmPassword: "",
    });

    if (Object.keys(errors).length > 0) {
      return { ok: false, message: Object.values(errors)[0]! };
    }

    const account = accounts.current.find(
      (entry) =>
        entry.user.email === normalizeEmail(email) &&
        entry.password === password,
    );

    if (!account) {
      return { ok: false, message: "Your email or password is incorrect." };
    }

    setUser({ ...account.user, interests: [...account.user.interests] });
    return { ok: true };
  }

  async function register(fields: AuthFields): Promise<AuthResult> {
    const errors = validateAuthForm("register", fields);
    if (Object.keys(errors).length > 0) {
      return { ok: false, message: Object.values(errors)[0]! };
    }

    const email = normalizeEmail(fields.email);
    if (accounts.current.some((entry) => entry.user.email === email)) {
      return {
        ok: false,
        message: "This email already has an account. Please sign in.",
      };
    }

    const newUser: AppUser = {
      id: `preview-user-${nextUserId.current++}`,
      fullName: fields.fullName.trim(),
      email,
      area: "",
      interests: [],
      joinedAt: new Date().toISOString(),
    };

    accounts.current.push({ user: newUser, password: fields.password });
    setUser({ ...newUser, interests: [] });
    return { ok: true };
  }

  function signOut() {
    setUser(null);
  }

  function updateProfile(input: ProfileInput): AuthResult {
    if (!user) {
      return { ok: false, message: "Please sign in to edit your profile." };
    }
    if (input.fullName.trim().length < 2) {
      return { ok: false, message: "Please enter your name." };
    }

    const updatedUser: AppUser = {
      ...user,
      fullName: input.fullName.trim(),
      area: input.area.trim(),
      interests: [...input.interests],
    };

    accounts.current = accounts.current.map((account) =>
      account.user.id === user.id ? { ...account, user: updatedUser } : account,
    );
    setUser(updatedUser);
    return { ok: true };
  }

  return (
    <AuthContext.Provider
      value={{ user, signIn, register, signOut, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
