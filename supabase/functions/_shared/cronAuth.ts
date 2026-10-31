// Shared by the functions pg_cron calls with no sign-in (send-push, sync-rides, purge-files). With the
// CRON_SECRET secret set on a function, a call must carry the same value in an x-cron-secret header;
// with it unset, any call is accepted (the pre-launch state, where a call can only do what the
// database has queued anyway). Tested in src/data/cronAuth.test.ts.

export const CRON_HEADER = 'x-cron-secret';

export function cronCallAllowed(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return true;
  if (!header || header.length !== secret.length) return false;
  let differ = 0;
  for (let i = 0; i < secret.length; i++) differ |= header.charCodeAt(i) ^ secret.charCodeAt(i);
  return differ === 0;
}
