import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  AppColors,
  darkColors,
  lightColors,
} from "../constants/app-colors";

type ThemeMode = "dark" | "light";

type ThemeContextType = {
  theme: ThemeMode;
  colors: AppColors;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined
);

const THEME_KEY = "reidentify-theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [ready, setReady] = useState(false);

  // Keep the splash screen up until the saved theme is known, so members
  // who chose light mode do not see the dark theme flash first.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_KEY)
      .then((saved) => {
        if (active && (saved === "light" || saved === "dark")) setTheme(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
        SplashScreen.hide();
      });
    return () => {
      active = false;
    };
  }, []);

  function toggleTheme() {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    void AsyncStorage.setItem(THEME_KEY, newTheme).catch(() => {});
  }

  const colors = theme === "dark" ? darkColors : lightColors;

  if (!ready) return null;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colors,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error(
      "useAppTheme must be used inside ThemeProvider"
    );
  }

  return context;
}