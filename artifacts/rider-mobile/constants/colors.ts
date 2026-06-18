/**
 * Dastak Rider — design tokens.
 * Brand primary mirrors the web app's --primary: hsl(16 100% 50%) => #FF4400.
 */

const colors = {
  light: {
    // Legacy aliases
    text: "#0A0A0A",
    tint: "#FF4400",

    // Core surfaces
    background: "#F6F7F9",
    foreground: "#0A0A0A",

    // Cards
    card: "#FFFFFF",
    cardForeground: "#0A0A0A",

    // Primary brand (orange-red)
    primary: "#FF4400",
    primaryForeground: "#FFFFFF",

    // Secondary
    secondary: "#F1F2F4",
    secondaryForeground: "#1A1A1A",

    // Muted
    muted: "#EEEFF2",
    mutedForeground: "#6B7280",

    // Accent (light orange tint)
    accent: "#FFF1EC",
    accentForeground: "#D63A00",

    // Destructive
    destructive: "#EF4444",
    destructiveForeground: "#FFFFFF",

    // Borders / inputs
    border: "#E7E8EC",
    input: "#E2E4E9",

    // Status / semantic
    success: "#16A34A",
    successForeground: "#15803D",
    successBg: "#DCFCE7",
    warning: "#D97706",
    warningBg: "#FEF3C7",
    info: "#2563EB",
    infoBg: "#DBEAFE",
    purple: "#7C3AED",
    purpleBg: "#EDE9FE",
  },

  // Border radius (px)
  radius: 14,
};

export default colors;
