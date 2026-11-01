// The club website's one door into the app, without the network or the database (both are passed
// in), so `npm test` runs exactly what the site-api Edge Function runs.
//   GET  /sponsors  the public sponsor list (no member deals), logos as signed URLs
//   GET  /rides     the public ride list (public.public_rides: no RSVPs, no member data)
//   POST /enquiry   a "Ride With Us" join enquiry, checked here and again in the database
// The check words are the app's (src/domain/enquiries.ts); a test keeps them the same.

export const ALLOWED_ORIGINS = ['https://www.rustnutssmc.com.au', 'https://rustnutssmc.com.au'];
export const SPONSORS_CACHE = 'public, max-age=900';
/** Signed logo links outlive the cached list, so a cached page never shows a dead logo. */
export const LOGO_URL_LIFE_S = 3600;
export const CLUB_EMAIL = 'rustnutssmc@outlook.com';

export const ENQUIRY_WORDS = {
  noName: 'Tell us your name.',
  longName: 'Keep your name to 80 characters.',
  badEmail: 'That email address does not look right.',
  noChapter: 'Pick a chapter: West, North or either.',
  longAbout: 'Keep it to 600 characters.',
  tooMany: 'Too many enquiries just now. Try again later, or email the club.',
} as const;
const CHAPTERS = ['west', 'north', 'either'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SponsorRow {
  id: string;
  name: string;
  blurb: string | null;
  url: string | null;
  deal: string | null;
  logo_path: string | null;
}

export interface PublicRide {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  category: string;
  location: string | null;
  notes: string | null;
  cancelled_at: string | null;
}

export interface CleanEnquiry {
  name: string;
  email: string;
  chapter: string;
  about: string | null;
}

export interface SiteApiDeps {
  /** public.list_sponsors() as anon. */
  listSponsors: () => Promise<SponsorRow[]>;
  /** public.public_rides() as anon. */
  listRides: () => Promise<PublicRide[]>;
  /** A signed URL for a logo in the sponsor-logos bucket, or null when it won't sign. */
  signLogo: (path: string) => Promise<string | null>;
  /** public.site_enquiry(...) with the service role: the database's refusal, or null when kept. */
  enquire: (enquiry: CleanEnquiry) => Promise<string | null>;
}

export interface SiteRequest {
  method: string;
  /** The path after the function name, like "/sponsors". */
  path: string;
  origin: string | null;
  body: unknown;
}

export interface SiteResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function corsFor(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Why this form can't be kept, or null, in the app's order and words. */
export function enquiryProblem(input: { name: string; email: string; chapter: string; about: string }): string | null {
  const name = input.name.trim();
  if (!name) return ENQUIRY_WORDS.noName;
  if (name.length > 80) return ENQUIRY_WORDS.longName;
  const email = input.email.trim();
  if (email.length > 200 || !EMAIL.test(email)) return ENQUIRY_WORDS.badEmail;
  if (!CHAPTERS.includes(input.chapter)) return ENQUIRY_WORDS.noChapter;
  if (input.about.trim().length > 600) return ENQUIRY_WORDS.longAbout;
  return null;
}

export async function handleSiteApi(req: SiteRequest, deps: SiteApiDeps): Promise<SiteResponse> {
  const cors = corsFor(req.origin);
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}): SiteResponse => ({
    status, body, headers: { ...cors, ...extra },
  });
  const path = req.path.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return reply(204, null);

  if (path === '/sponsors') {
    if (req.method !== 'GET') return reply(405, { error: 'GET the sponsors.' });
    let rows: SponsorRow[];
    try {
      rows = await deps.listSponsors();
    } catch {
      return reply(503, { error: 'The sponsor list is not available just now.' }, { 'cache-control': 'no-store' });
    }
    const sponsors = await Promise.all(rows.map(async (s) => ({
      id: s.id,
      name: s.name,
      blurb: s.blurb,
      url: s.url,
      logo: s.logo_path ? await deps.signLogo(s.logo_path).catch(() => null) : null,
    })));
    return reply(200, { sponsors }, { 'cache-control': SPONSORS_CACHE });
  }

  if (path === '/rides') {
    if (req.method !== 'GET') return reply(405, { error: 'GET the rides.' });
    try {
      return reply(200, { rides: await deps.listRides() }, { 'cache-control': SPONSORS_CACHE });
    } catch {
      return reply(503, { error: 'The ride list is not available just now.' }, { 'cache-control': 'no-store' });
    }
  }

  if (path === '/enquiry') {
    if (req.method !== 'POST') return reply(405, { error: 'POST an enquiry.' });
    // A browser on another site: the form is the club website's only.
    if (req.origin && !ALLOWED_ORIGINS.includes(req.origin)) return reply(403, { error: 'Enquiries come from the club website.' });
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    // The honeypot: a field people never see. Filled in means a robot; say thanks and keep nothing.
    if (str(b.website).trim()) return reply(200, { ok: true });
    const input = { name: str(b.name), email: str(b.email), chapter: str(b.chapter), about: str(b.about) };
    const problem = enquiryProblem(input);
    if (problem) return reply(400, { error: problem });
    const about = input.about.trim();
    const clean: CleanEnquiry = {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      chapter: input.chapter,
      about: about ? about : null,
    };
    let refusal: string | null;
    try {
      refusal = await deps.enquire(clean);
    } catch {
      return reply(503, { error: `Something went wrong on our side. Email the club at ${CLUB_EMAIL}.` });
    }
    if (refusal === ENQUIRY_WORDS.tooMany) return reply(429, { error: refusal });
    if (refusal && (Object.values(ENQUIRY_WORDS) as string[]).includes(refusal)) return reply(400, { error: refusal });
    // Anything else the database said (a grant, a constraint) isn't for the public.
    if (refusal) return reply(503, { error: `Something went wrong on our side. Email the club at ${CLUB_EMAIL}.` });
    return reply(200, { ok: true });
  }

  return reply(404, { error: 'No such page.' });
}
