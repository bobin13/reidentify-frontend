import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AreaField } from "./area-field";
import { resolveArea, type AreaSelection } from "../lib/locations";

import type { AppColors } from "../constants/app-colors";
import { gutter, radius, type } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useAppTheme } from "../context/theme-context";
import {
  normalizeEmail,
  validateAuthForm,
  type AuthErrors,
  type AuthFields,
  type AuthMode,
} from "../utils/auth-validation";

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  isPassword?: boolean;
  disabled?: boolean;
  inputRef?: Ref<TextInput>;
  inputProps?: Omit<TextInputProps, "value" | "onChangeText" | "style">;
};

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  isPassword = false,
  disabled = false,
  inputRef,
  inputProps,
}: FieldProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          focused && { borderColor: colors.accent },
          error && styles.inputError,
        ]}
      >
        <TextInput
          {...inputProps}
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={error || undefined}
          autoCorrect={false}
          editable={!disabled}
          onBlur={() => setFocused(false)}
          onFocus={() => setFocused(true)}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={isPassword && !showPassword}
          selectionColor={colors.accent}
          style={styles.input}
          value={value}
        />
        {isPassword && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${showPassword ? "Hide" : "Show"} ${label.toLowerCase()}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => setShowPassword((shown) => !shown)}
            style={styles.showPassword}
          >
            <Text style={styles.showPasswordText}>
              {showPassword ? "Hide" : "Show"}
            </Text>
          </Pressable>
        )}
      </View>
      {error && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );
}

type AuthScreenProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onBack: () => void;
  onSuccess: () => void;
};

export function AuthScreen({
  mode,
  onModeChange,
  onBack,
  onSuccess,
}: AuthScreenProps) {
  const { colors } = useAppTheme();
  const { signIn, register, resetPassword } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [fields, setFields] = useState<AuthFields>({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState<AreaSelection | null>(null);
  const [locationError, setLocationError] = useState("");
  const pending = useRef(false);
  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const isRegister = mode === "register";
  const needsLocation = isRegister && !resolveArea(location);
  const submitDisabled = submitting || needsLocation;

  useEffect(() => {
    setErrors({});
    setFormError("");
    setNotice("");
    setLocationError("");
    setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
  }, [mode]);

  function updateField(key: keyof AuthFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError("");
    setNotice("");
  }

  async function sendReset() {
    if (sendingReset) return;
    setFormError("");
    setNotice("");
    setSendingReset(true);
    const result = await resetPassword(fields.email);
    setSendingReset(false);
    if (result.ok) {
      setNotice(
        `If ${normalizeEmail(fields.email)} has an account, a link to reset your password is on its way. Check your inbox and spam folder.`,
      );
    } else {
      setFormError(result.message);
      emailInput.current?.focus();
    }
  }

  async function submit() {
    if (pending.current) return;
    const nextErrors = validateAuthForm(mode, fields);
    setErrors(nextErrors);
    setFormError("");

    const firstError = (Object.keys(nextErrors) as (keyof AuthFields)[])[0];
    if (firstError) {
      const inputs = {
        fullName: nameInput,
        email: emailInput,
        password: passwordInput,
        confirmPassword: confirmInput,
      };
      inputs[firstError].current?.focus();
      return;
    }

    if (isRegister && !resolveArea(location)) {
      setLocationError("Choose your city or town to continue.");
      return;
    }

    Keyboard.dismiss();
    pending.current = true;
    setSubmitting(true);

    try {
      const result = isRegister
        ? await register({ ...fields, location })
        : await signIn(fields.email, fields.password);

      if (!result.ok) {
        setFormError(result.message);
      } else {
        setFields((current) => ({
          ...current,
          password: "",
          confirmPassword: "",
        }));
        onSuccess();
      }
    } catch {
      setFormError("We could not continue. Please try again.");
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to profile"
            disabled={submitting}
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>R</Text>
            </View>
            <Text style={styles.brandText}>ReIdentify</Text>
          </View>

          <View style={styles.intro}>
            <Text accessibilityRole="header" style={styles.title}>
              {isRegister ? "Find your community" : "Welcome back"}
            </Text>
            <Text style={styles.subtitle}>
              {isRegister
                ? "Create your account and make room for new connections."
                : "Sign in to connect with people and activities near you."}
            </Text>
          </View>

          <View style={styles.form}>
            {isRegister && (
              <FormField
                key="fullName"
                label="Full name"
                placeholder="Your name"
                value={fields.fullName}
                onChangeText={(value) => updateField("fullName", value)}
                error={errors.fullName}
                disabled={submitting}
                inputRef={nameInput}
                inputProps={{
                  autoComplete: "name",
                  textContentType: "name",
                  autoCapitalize: "words",
                  returnKeyType: "next",
                  onSubmitEditing: () => emailInput.current?.focus(),
                }}
              />
            )}

            <FormField
              key="email"
              label="Email address"
              placeholder="you@example.com"
              value={fields.email}
              onChangeText={(value) => updateField("email", value)}
              error={errors.email}
              disabled={submitting}
              inputRef={emailInput}
              inputProps={{
                autoCapitalize: "none",
                autoComplete: "email",
                textContentType: "emailAddress",
                keyboardType: "email-address",
                returnKeyType: "next",
                onSubmitEditing: () => passwordInput.current?.focus(),
              }}
            />

            <View>
              <FormField
                key={`password-${mode}`}
                label="Password"
                placeholder={isRegister ? "Choose a password" : "Your password"}
                value={fields.password}
                onChangeText={(value) => updateField("password", value)}
                error={errors.password}
                isPassword
                disabled={submitting}
                inputRef={passwordInput}
                inputProps={{
                  autoCapitalize: "none",
                  autoComplete: isRegister
                    ? "new-password"
                    : "current-password",
                  textContentType: isRegister ? "newPassword" : "password",
                  returnKeyType: isRegister ? "next" : "go",
                  onSubmitEditing: () =>
                    isRegister ? confirmInput.current?.focus() : void submit(),
                }}
              />
              {isRegister && !errors.password && (
                <Text style={styles.fieldHint}>Use at least 8 characters.</Text>
              )}
              {!isRegister && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Emails you a link to choose a new password"
                  disabled={submitting || sendingReset}
                  onPress={() => void sendReset()}
                  style={styles.forgotButton}
                >
                  <Text style={styles.forgotText}>
                    {sendingReset ? "Sending link…" : "Forgot password?"}
                  </Text>
                </Pressable>
              )}
            </View>

            {isRegister && (
              <FormField
                key="confirmPassword"
                label="Confirm password"
                placeholder="Enter your password again"
                value={fields.confirmPassword}
                onChangeText={(value) => updateField("confirmPassword", value)}
                error={errors.confirmPassword}
                isPassword
                disabled={submitting}
                inputRef={confirmInput}
                inputProps={{
                  autoCapitalize: "none",
                  autoComplete: "new-password",
                  textContentType: "newPassword",
                  returnKeyType: "go",
                  onSubmitEditing: () => void submit(),
                }}
              />
            )}

            {isRegister && (
              <AreaField
                value={location}
                error={locationError}
                disabled={submitting}
                onChange={(value) => {
                  setLocation(value);
                  setLocationError("");
                  setFormError("");
                }}
              />
            )}

            {notice !== "" && (
              <View style={styles.noticeBox}>
                <Text accessibilityRole="alert" style={styles.noticeText}>
                  {notice}
                </Text>
              </View>
            )}

            {formError !== "" && (
              <View style={styles.errorBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {formError}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityHint={
                needsLocation
                  ? "Choose your city or town to create an account."
                  : undefined
              }
              accessibilityState={{
                disabled: submitDisabled,
                busy: submitting,
              }}
              disabled={submitDisabled}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.primaryButton,
                submitDisabled && styles.primaryButtonDisabled,
                pressed && !submitDisabled && styles.pressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text
                  style={[
                    styles.primaryButtonText,
                    submitDisabled && styles.primaryButtonTextDisabled,
                  ]}
                >
                  {isRegister ? "Create account" : "Sign in"}
                </Text>
              )}
            </Pressable>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchPrompt}>
              {isRegister ? "Already have an account?" : "New to ReIdentify?"}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={() => onModeChange(isRegister ? "login" : "register")}
              style={styles.switchButton}
            >
              <Text style={styles.switchText}>
                {isRegister ? "Sign in" : "Create account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      flexGrow: 1,
      width: "100%",
      maxWidth: 540,
      alignSelf: "center",
      padding: gutter + 4,
      paddingBottom: 36,
    },
    backButton: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
      paddingRight: 16,
      marginBottom: 16,
    },
    backText: { ...type.label, color: colors.accent },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 32,
    },
    logo: {
      width: 40,
      height: 40,
      borderRadius: radius.sm + 2,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: {
      color: colors.background,
      fontSize: 23,
      lineHeight: 28,
      fontWeight: "800",
    },
    brandText: { ...type.title, fontSize: 20, color: colors.text },
    intro: { gap: 8, marginBottom: 28 },
    title: { ...type.display, color: colors.text },
    subtitle: { ...type.body, color: colors.muted },
    form: { gap: 18 },
    field: { gap: 8 },
    label: { ...type.label, color: colors.text },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 54,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 16,
    },
    inputError: { borderColor: colors.danger },
    showPassword: {
      minWidth: 62,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 12,
    },
    showPasswordText: { ...type.label, fontSize: 14, color: colors.accent },
    fieldHint: { ...type.caption, color: colors.muted, marginTop: 6 },
    errorText: {
      ...type.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.danger,
    },
    forgotButton: { alignSelf: "flex-end", minHeight: 40, justifyContent: "center", marginTop: 4 },
    forgotText: { ...type.label, color: colors.accent },
    noticeText: { ...type.body, fontSize: 15, lineHeight: 22, color: colors.text },
    noticeBox: {
      padding: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    errorBox: {
      padding: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.surface,
    },
    primaryButton: {
      minHeight: 54,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    primaryButtonText: {
      ...type.label,
      fontSize: 16,
      color: colors.background,
      fontWeight: "700",
      textAlign: "center",
    },
    primaryButtonDisabled: { backgroundColor: colors.surfaceAlt },
    primaryButtonTextDisabled: { color: colors.muted },
    secondaryButton: {
      minHeight: 54,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    secondaryButtonText: {
      ...type.label,
      fontSize: 16,
      color: colors.text,
      textAlign: "center",
    },
    pressed: { opacity: 0.8 },
    switchRow: { alignItems: "center", marginTop: 26 },
    switchPrompt: {
      ...type.body,
      fontSize: 15,
      color: colors.muted,
      textAlign: "center",
    },
    switchButton: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    switchText: { ...type.label, fontSize: 16, color: colors.accent, fontWeight: "700" },
    previewNote: {
      ...type.caption,
      color: colors.muted,
      textAlign: "center",
      marginTop: 16,
    },
  });
}
