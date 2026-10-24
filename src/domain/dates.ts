// Dates are stored as ISO (YYYY-MM-DD) and shown the Australian way (DD/MM/YYYY).

const pad = (n: number) => String(n).padStart(2, '0');

export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "08/11/2026" → "2026-11-08". Returns null for anything that isn't a real date. */
export function parseAuDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-08" → "8 Nov 2026" */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is in the past). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcMs(toIso) - utcMs(fromIso)) / 86_400_000);
}

export type ExpiryState = 'ok' | 'soon' | 'expired' | 'missing';

/** "soon" = within 30 days. */
export function expiryState(expiryIso: string | null, today: string, soonDays = 30): ExpiryState {
  if (!expiryIso) return 'missing';
  const d = daysBetween(today, expiryIso);
  if (d < 0) return 'expired';
  if (d <= soonDays) return 'soon';
  return 'ok';
}

export function describeExpiry(expiryIso: string | null, today: string): string {
  if (!expiryIso) return 'Not recorded';
  const d = daysBetween(today, expiryIso);
  if (d < 0) return `Expired ${formatLongDate(expiryIso)}`;
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  if (d <= 30) return `Expires in ${d} days`;
  return `Expires ${formatLongDate(expiryIso)}`;
}

/** Months between two ISO dates, rounded down (for "FNG for 7 months"). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}
