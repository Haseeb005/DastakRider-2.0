/**
 * Dastak Rider — design tokens.
 * Brand primary mirrors the DastakMart website: crimson #DB143C (hsl 348 83% 47%).
 */

const colors = {
  light: {
    // Legacy aliases
    text: "#0A0A0A",
    tint: "#DB143C",

    // Core surfaces
    background: "#F6F7F9",
    foreground: "#0A0A0A",

    // Cards
    card: "#FFFFFF",
    cardForeground: "#0A0A0A",

    // Primary brand (DastakMart crimson)
    primary: "#DB143C",
    primaryForeground: "#FFFFFF",

    // Secondary
    secondary: "#F1F2F4",
    secondaryForeground: "#1A1A1A",

    // Muted
    muted: "#EEEFF2",
    mutedForeground: "#6B7280",

    // Accent (light crimson tint)
    accent: "#FDE7EC",
    accentForeground: "#A30F2C",

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
