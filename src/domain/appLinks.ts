// Website links that open the app (website-and-app task 15). Only links under /open/ on the club
// website open the app; every other page on the site stays a web page. The phone settings
// (app.json: Android intent filter, iPhone associated domain) and the website's .well-known files
// name the same host and path. Spec: docs/superpowers/specs/2026-11-14-app-links-and-1-0-settings-design.md

export const APP_LINK_HOST = 'www.rustnutssmc.com.au';
/** The path every app link starts with. Android matches "/open/" as a prefix (so /opener.html
 *  stays a web page); the app also accepts the bare "/open". */
export const APP_LINK_PATH = '/open';
const ORIGIN = `https://${APP_LINK_HOST}`;

/** Where a link takes someone: the app as it opens, or one ride. */
export type AppLinkTarget = { kind: 'home' } | { kind: 'ride'; rideId: string };

/** The link to a ride: opens it in the app, or the website's "this opens in the app" page. */
export function rideLink(rideId: string): string {
  return `${ORIGIN}${APP_LINK_PATH}/?ride=${encodeURIComponent(rideId)}`;
}

// The bare domain redirects to www, so a link typed without www still counts.
const HOSTS = new Set([APP_LINK_HOST, 'rustnutssmc.com.au']);
// Ride ids are uuids (demo ids are short words); anything else is a mangled link.
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What an incoming link opens, or null when it isn't an app link (another website page, another
 * site, a mail link). Accepts https or http on www or the bare domain, and the app's own scheme
 * (rustnuts://open/…). A link under /open/ that names nothing the app knows just opens the app.
 */
export function appLinkTarget(url: string): AppLinkTarget | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(url.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  let path = m[3];
  if (scheme === 'rustnuts') {
    // rustnuts://open/?ride=… (host "open") or rustnuts:///open/?ride=… (empty host).
    if (authority === 'open') path = `/open${path}`;
    else if (authority !== '') return null;
  } else if (scheme === 'https' || scheme === 'http') {
    if (!HOSTS.has(authority)) return null; // also refuses user@host and host:port tricks
  } else {
    return null;
  }
  if (path !== APP_LINK_PATH && path !== `${APP_LINK_PATH}/` && path !== `${APP_LINK_PATH}/index.html`) return null;
  const query = new URLSearchParams(m[4] ?? '');
  const ride = query.get('ride');
  if (ride && ID.test(ride)) return { kind: 'ride', rideId: ride };
  return { kind: 'home' };
}

/** A link that arrived while signed out waits this long for the person to sign in, then is
 *  dropped, so nobody is thrown into a ride they tapped hours ago. */
export const APP_LINK_FRESH_MS = 5 * 60_000;

/** A link waiting to be opened: what it opens and when it arrived. */
export type WaitingLink = { target: AppLinkTarget; at: number };

/** The ride screen to open for a waiting link, or null when there's nothing to open (just the
 *  app, nothing waiting, or it went stale). */
export function linkToOpen(waiting: WaitingLink | null, now: number): { rideId: string } | null {
  if (!waiting || now - waiting.at > APP_LINK_FRESH_MS) return null;
  return waiting.target.kind === 'ride' ? { rideId: waiting.target.rideId } : null;
}
