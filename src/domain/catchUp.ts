// Catch me up: when a chat shows the bar, and how many of its newest messages to summarise. The
// count is the new-message count when the chat was opened (it's marked read once it's on screen).
// Spec: docs/superpowers/specs/2026-11-01-catch-me-up-design.md

/** New messages it takes to offer a catch-up; fewer than this is quicker to scroll. */
export const CATCHUP_MIN = 8;
/** The demo offers it sooner, so it can be tried on the demo chats. */
export const CATCHUP_DEMO_MIN = 3;
export const CATCHUP_MAX = 300;

/** How many messages to summarise, or null when the bar shouldn't show. */
export function catchUpCount(unreadAtOpen: number, demo: boolean): number | null {
  if (unreadAtOpen < (demo ? CATCHUP_DEMO_MIN : CATCHUP_MIN)) return null;
  return Math.min(Math.max(unreadAtOpen, CATCHUP_MIN), CATCHUP_MAX);
}
