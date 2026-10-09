export type AuthMode = "login" | "register";

export type AuthFields = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type AuthErrors = Partial<Record<keyof AuthFields, string>>;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateAuthForm(
  mode: AuthMode,
  fields: AuthFields,
): AuthErrors {
  const errors: AuthErrors = {};

  if (mode === "register" && fields.fullName.trim().length < 2) {
    errors.fullName = "Please enter your name.";
  }

  const email = normalizeEmail(fields.email);
  if (!email) {
    errors.email = "Please enter your email address.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (!fields.password.trim()) {
    errors.password = "Please enter a password.";
  } else if (mode === "register" && fields.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }

  if (mode === "register") {
    if (!fields.confirmPassword) {
      errors.confirmPassword = "Please enter your password again.";
    } else if (fields.confirmPassword !== fields.password) {
      errors.confirmPassword = "Your passwords do not match.";
    }
  }

  return errors;
}
