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

import type { AppColors } from "../constants/app-colors";
import { DEMO_CREDENTIALS, useAuth } from "../context/auth-context";
import { useAppTheme } from "../context/theme-context";
import {
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
  const { signIn, register } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [fields, setFields] = useState<AuthFields>({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const isRegister = mode === "register";

  useEffect(() => {
    setErrors({});
    setFormError("");
    setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
  }, [mode]);

  function updateField(key: keyof AuthFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError("");
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

    Keyboard.dismiss();
    pending.current = true;
    setSubmitting(true);

    try {
      const result = isRegister
        ? await register(fields)
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

  function fillDemoAccount() {
    setFields({
      fullName: "",
      email: DEMO_CREDENTIALS.email,
      password: DEMO_CREDENTIALS.password,
      confirmPassword: "",
    });
    setErrors({});
    setFormError("");
    emailInput.current?.focus();
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

            {formError !== "" && (
              <View style={styles.errorBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {formError}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || submitting) && styles.pressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isRegister ? "Create account" : "Sign in"}
                </Text>
              )}
            </Pressable>

            {!isRegister && (
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={fillDemoAccount}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  Fill demo account
                </Text>
              </Pressable>
            )}
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

          <Text style={styles.previewNote}>
            Demo mode · accounts reset when the app restarts.
          </Text>
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
      padding: 24,
      paddingBottom: 36,
    },
    backButton: {
      minHeight: 48,
      justifyContent: "center",
      alignSelf: "flex-start",
      paddingRight: 16,
      marginBottom: 16,
    },
    backText: { color: colors.text, fontSize: 17, fontWeight: "600" },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 28,
    },
    logo: {
      width: 46,
      height: 46,
      borderRadius: 15,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    logoText: { color: colors.background, fontSize: 28, fontWeight: "800" },
    brandText: { color: colors.text, fontSize: 24, fontWeight: "700" },
    intro: { gap: 10, marginBottom: 28 },
    title: { color: colors.text, fontSize: 30, fontWeight: "700" },
    subtitle: { color: colors.muted, fontSize: 17, lineHeight: 25 },
    form: { gap: 20 },
    field: { gap: 8 },
    label: { color: colors.text, fontSize: 16, fontWeight: "600" },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 58,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 15,
      color: colors.text,
      fontSize: 18,
    },
    inputError: { borderColor: "#DC7565" },
    showPassword: {
      minWidth: 62,
      minHeight: 48,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 10,
    },
    showPasswordText: { color: colors.accent, fontSize: 15, fontWeight: "700" },
    fieldHint: { color: colors.muted, fontSize: 14, marginTop: 7 },
    errorText: {
      color: colors.background === "#101214" ? "#FFA895" : "#A33527",
      fontSize: 15,
      lineHeight: 22,
    },
    errorBox: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#DC7565",
      backgroundColor: colors.surface,
    },
    primaryButton: {
      minHeight: 58,
      borderRadius: 14,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    primaryButtonText: {
      color: colors.background,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    secondaryButton: {
      minHeight: 56,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      padding: 14,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
    },
    pressed: { opacity: 0.75 },
    switchRow: { alignItems: "center", marginTop: 26 },
    switchPrompt: { color: colors.muted, fontSize: 16, textAlign: "center" },
    switchButton: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    switchText: { color: colors.accent, fontSize: 17, fontWeight: "700" },
    previewNote: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginTop: 16,
    },
  });
}
