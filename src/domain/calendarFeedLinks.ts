// The links on Me › Rides in my calendar: the member's own calendar file (served by the calendar-feed
// server function) and the pages that add it to Google, Outlook or Apple Calendar.
// Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

export const CALENDAR_NAME = 'Rustnuts rides';

export interface CalendarFeedLinks {
  https: string;
  webcal: string;
  google: string;
  outlook: string;
}

export function calendarFeedLinks(supabaseUrl: string, token: string): CalendarFeedLinks | null {
  if (!supabaseUrl || !/^[0-9a-f]{64}$/.test(token)) return null;
  const https = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/calendar-feed/${token}.ics`;
  const webcal = https.replace(/^https:\/\//, 'webcal://');
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(CALENDAR_NAME)}`,
  };
}
