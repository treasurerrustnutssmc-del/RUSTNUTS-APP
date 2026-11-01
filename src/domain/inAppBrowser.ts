/**
 * Which web links open inside the app (a browser sheet with a close button that comes straight
 * back to the screen you were on) and which are handed to the phone.
 *
 * Plain web pages, like the club website, its shop and support page, sponsors' sites and the
 * app's own public pages, open inside the app. Places that have their own phone app (Facebook,
 * Instagram, Spotify, YouTube, iHeart, maps, Google Calendar, the app stores, WhatsApp, Strava,
 * Discord)
 * keep opening in that app, and phone, text and email
 * links go to the phone as before.
 */

const OWN_APP_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'spotify.com',
  'youtube.com',
  'youtu.be',
  'iheart.com',
  'calendar.google.com',
  'maps.google.com',
  'maps.apple.com',
  'goo.gl',
  'waze.com',
  'play.google.com',
  'apps.apple.com',
  'music.apple.com',
  'podcasts.apple.com',
  'whatsapp.com',
  'wa.me',
  'messenger.com',
  'm.me',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'strava.com',
  'discord.com',
  'discord.gg',
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function opensInApp(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (OWN_APP_HOSTS.some((d) => hostMatches(host, d))) return false;
  // Google Maps links on www.google.com/maps open the maps app.
  if (hostMatches(host, 'google.com') && parsed.pathname.startsWith('/maps')) return false;
  return true;
}
