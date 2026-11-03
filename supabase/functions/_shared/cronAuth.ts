// Shared by the functions pg_cron calls with no sign-in (send-push, sync-rides, purge-files). With the
// CRON_SECRET secret set on a function, a call must carry the same value in an x-cron-secret header.
// With it unset every call is refused (fails closed, ChatGPT audit F02): a missing secret is a set-up
// mistake, and the scheduled jobs then show 401s rather than the door standing open.
// Tested in src/data/cronAuth.test.ts.

export const CRON_HEADER = 'x-cron-secret';

export function cronCallAllowed(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  if (!header || header.length !== secret.length) return false;
  let differ = 0;
  for (let i = 0; i < secret.length; i++) differ |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return differ === 0;
}
