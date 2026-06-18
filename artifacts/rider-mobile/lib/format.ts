export function parseItemName(fullName: string): {
  baseName: string;
  selections: string[];
} {
  const match = (fullName ?? "").match(/^(.*?)\s*\((.+)\)\s*$/);
  if (match) {
    return {
      baseName: match[1].trim(),
      selections: match[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  return { baseName: fullName ?? "", selections: [] };
}

export const STATUS_LABELS: Record<string, string> = {
  Pending: "New Order",
  "Admin Accepted": "New Order",
  "Rider Accepted": "Heading to Restaurant",
  "Rider Picked Up": "On the Way",
  Delivered: "Delivered",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

type Palette = {
  warningBg: string;
  warning: string;
  infoBg: string;
  info: string;
  accent: string;
  accentForeground: string;
  purpleBg: string;
  purple: string;
  successBg: string;
  successForeground: string;
  muted: string;
  mutedForeground: string;
};

export function statusColors(
  status: string,
  c: Palette,
): { bg: string; fg: string } {
  switch (status) {
    case "Pending":
      return { bg: c.warningBg, fg: c.warning };
    case "Admin Accepted":
      return { bg: c.infoBg, fg: c.info };
    case "Rider Accepted":
      return { bg: c.accent, fg: c.accentForeground };
    case "Rider Picked Up":
      return { bg: c.purpleBg, fg: c.purple };
    case "Delivered":
      return { bg: c.successBg, fg: c.successForeground };
    default:
      return { bg: c.muted, fg: c.mutedForeground };
  }
}

function group(v: number): string {
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function money(n: number | undefined | null): string {
  return `Rs. ${group(Math.round(Number(n ?? 0)))}`;
}

export function num(n: number | undefined | null): number {
  return Number(n ?? 0);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats an ISO timestamp into Pakistan local time (PKT = UTC+5, no DST).
 * Returns separate date and time strings, or null when the input is invalid.
 * Done manually because Hermes' Intl timezone support is unreliable on Expo.
 */
export function formatDateTime(
  iso: string | null | undefined,
): { date: string; time: string } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms + 5 * 60 * 60 * 1000);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return {
    date: `${day} ${month} ${year}`,
    time: `${h}:${String(m).padStart(2, "0")} ${ampm}`,
  };
}

const COD_TYPES = ["cod", "cash"];

export function isCOD(paymentType: string | undefined | null): boolean {
  return COD_TYPES.includes(String(paymentType ?? "").toLowerCase());
}
