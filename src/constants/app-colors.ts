export type AppColors = {
  // Page background.
  background: string;
  // Cards, sheets and bars that sit on the background.
  surface: string;
  // Inputs, chips and icon tiles that sit on a surface.
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  // Quiet accent tint for selected rows, badges and icon tiles.
  accentSoft: string;
  danger: string;
  // True for the dark palette; used to tune shadows.
  dark: boolean;
};

export const darkColors: AppColors = {
  background: "#101214",
  surface: "#181C20",
  surfaceAlt: "#20262B",
  border: "#2B3238",
  text: "#F3F6F5",
  muted: "#9CA8A4",
  accent: "#75D6B0",
  accentSoft: "#1A332C",
  danger: "#FF8A75",
  dark: true,
};

export const lightColors: AppColors = {
  background: "#F5F7F5",
  surface: "#FFFFFF",
  surfaceAlt: "#EDF1EF",
  border: "#E0E6E3",
  text: "#0D2B27",
  muted: "#5B6B67",
  accent: "#14756A",
  accentSoft: "#DDF0EA",
  danger: "#B3261E",
  dark: false,
};
