/**
 * #409 / quadwork#273: notification sound prefs + playback helpers.
 *
 * Mirrors AgentChattr's static/sounds notification model: a small set
 * of MP3s bundled in public/sounds/, an enable toggle, a sound choice,
 * and a "background only" mode that suppresses dings while the tab is
 * focused. All preferences persist in localStorage so the chat panel
 * and the System control row stay in sync across reloads + tabs.
 */

export type NotificationSoundChoice =
  | "soft-chime"
  | "warm-bell"
  | "click"
  | "alert-tone"
  | "pluck";

export const NOTIFICATION_SOUND_OPTIONS: { value: NotificationSoundChoice; label: string }[] = [
  { value: "soft-chime", label: "Soft Chime" },
  { value: "warm-bell", label: "Warm Bell" },
  { value: "click", label: "Click" },
  { value: "alert-tone", label: "Alert Tone" },
  { value: "pluck", label: "Pluck" },
];

const KEY_ENABLED = "quadwork_notification_sound";
const KEY_CHOICE = "quadwork_notification_sound_choice";
const KEY_BG = "quadwork_notification_sound_background_only";

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be disabled (Safari private mode etc.) — non-fatal
  }
}

export function getNotificationEnabled(): boolean {
  return safeRead(KEY_ENABLED) !== "off";
}
export function setNotificationEnabled(value: boolean) {
  safeWrite(KEY_ENABLED, value ? "on" : "off");
}

export function getNotificationChoice(): NotificationSoundChoice {
  const v = safeRead(KEY_CHOICE);
  if (v && NOTIFICATION_SOUND_OPTIONS.some((o) => o.value === v)) {
    return v as NotificationSoundChoice;
  }
  return "soft-chime";
}
export function setNotificationChoice(value: NotificationSoundChoice) {
  safeWrite(KEY_CHOICE, value);
}

export function getNotificationBackgroundOnly(): boolean {
  const v = safeRead(KEY_BG);
  // Default: enabled (less annoying — only ding when the user isn't
  // already looking at the chat).
  if (v === null) return true;
  return v !== "off";
}
export function setNotificationBackgroundOnly(value: boolean) {
  safeWrite(KEY_BG, value ? "on" : "off");
}

/**
 * Play the currently-selected notification sound. Honors the global
 * enable toggle and the background-only mode. Safe to call from any
 * render path — if Audio is unavailable or autoplay is blocked, the
 * promise rejection is swallowed.
 */
export function playNotificationSound() {
  if (typeof window === "undefined") return;
  if (!getNotificationEnabled()) return;
  if (getNotificationBackgroundOnly() && document.hasFocus()) return;
  const choice = getNotificationChoice();
  try {
    const audio = new Audio(`/sounds/${choice}.mp3`);
    audio.volume = 0.6;
    void audio.play().catch(() => {
      // Autoplay blocked or user gesture required — swallow.
    });
  } catch {
    // Audio constructor failed (very old browser) — swallow.
  }
}
