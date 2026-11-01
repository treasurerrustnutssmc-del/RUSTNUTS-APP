// The club website's one door into the app, without the network or the database (both are passed
// in), so `npm test` runs exactly what the site-api Edge Function runs.
//   GET  /sponsors  the public sponsor list (no member deals), logos as signed URLs
//   GET  /rides     the public ride list (public.public_rides: no RSVPs, no member data)
//   POST /enquiry   a "Ride With Us" join enquiry, checked here and again in the database
//   GET  /charity-rides   charity rides taking sign-ups from the website (public.public_charity_rides)
//   POST /charity-signup  a sign-up for one of them, checked here and again in the database
//   GET  /documents  the Constitution as the library shows it (public.public_documents), for the site's page
//   GET  /news      club news the board posted for the website (public.public_site_news): newest five, nothing personal
// The check words are the app's (src/domain/enquiries.ts, src/domain/websiteSignups.ts); tests keep them the same.

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
export const CHARITY_CACHE = 'public, max-age=300';
/** The Constitution changes rarely and weighs 90 KB: an hour. */
export const DOCUMENTS_CACHE = 'public, max-age=3600';
/** A taken-down notice should leave the home page within a few minutes. */
export const NEWS_CACHE = 'public, max-age=300';
export const SIGNUP_WORDS = {
  notOnWebsite: 'This ride isn’t taking sign-ups from the website.',
  closed: 'Sign-ups have closed.',
  noName: 'Tell us your name.',
  longName: 'Keep your name to 80 characters.',
  badEmail: 'That email address does not look right.',
  longPhone: 'Keep the phone number to 30 characters.',
  nothingPicked: 'Say you’re riding, or pick a job to help with.',
  pillionNeedsRider: 'A pillion needs a rider: say you’re riding too.',
  guests: 'Guests: 0 to 10.',
  jobNotListed: 'That job isn’t on the list.',
  tooLong: 'Keep it short: 200 characters for guests’ names, 200 for notes.',
  tooMany: 'Too many sign-ups just now. Try again later, or email the club.',
  full: 'The ride’s full.',
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

export interface PublicCharityRide {
  ride_id: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  location: string | null;
  cause: string;
  about: string | null;
  closes_on: string | null;
  jobs: string[];
  places: number | null;
  places_left: number | null;
  open: boolean;
}

export interface PublicDocument {
  kind: string;
  title: string;
  label: string;
  approving_body: string | null;
  approved_on: string | null;
  commences_on: string | null;
  published_at: string;
  body: string;
}

/** One notice as public_site_news() returns it (src/domain/siteNews.ts PublicNews). */
export interface PublicNews {
  id: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
}

export interface CleanSignup {
  ride: string;
  name: string;
  email: string;
  phone: string | null;
  riding: boolean;
  pillion: boolean;
  guests: number;
  guest_names: string | null;
  job: string | null;
  notes: string | null;
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
  /** public.public_charity_rides() as anon. */
  listCharityRides: () => Promise<PublicCharityRide[]>;
  /** public.website_signup(...) with the service role: the database's refusal, or null when kept. */
  websiteSignup: (signup: CleanSignup) => Promise<string | null>;
  /** public.public_documents() as anon. */
  listDocuments: () => Promise<PublicDocument[]>;
  /** public.public_site_news() as anon. */
  listNews: () => Promise<PublicNews[]>;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignupForm {
  ride: string;
  name: string;
  email: string;
  phone: string;
  riding: boolean;
  pillion: boolean;
  guests: number;
  guestNames: string;
  job: string;
  notes: string;
}

/**
 * Why a website sign-up form can't be sent on, or null, in the database's order and words. The
 * ride itself (does it take website sign-ups, is it closed, is the job on its list, is it full) is
 * the database's to judge, so here it's the form alone; a job is checked against the list there.
 */
export function signupProblem(f: SignupForm): string | null {
  if (!UUID.test(f.ride)) return SIGNUP_WORDS.notOnWebsite;
  const name = f.name.trim();
  if (!name) return SIGNUP_WORDS.noName;
  if (name.length > 80) return SIGNUP_WORDS.longName;
  const email = f.email.trim();
  if (email.length > 200 || !EMAIL.test(email)) return SIGNUP_WORDS.badEmail;
  if (f.phone.trim().length > 30) return SIGNUP_WORDS.longPhone;
  const job = f.job.trim();
  if (!f.riding && !job) return SIGNUP_WORDS.nothingPicked;
  if (!f.riding && f.pillion) return SIGNUP_WORDS.pillionNeedsRider;
  if (!Number.isInteger(f.guests) || f.guests < 0 || f.guests > 10) return SIGNUP_WORDS.guests;
  if (f.guestNames.trim().length > 200 || f.notes.trim().length > 200) return SIGNUP_WORDS.tooLong;
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

  if (path === '/charity-rides') {
    if (req.method !== 'GET') return reply(405, { error: 'GET the charity rides.' });
    try {
      return reply(200, { rides: await deps.listCharityRides() }, { 'cache-control': CHARITY_CACHE });
    } catch {
      return reply(503, { error: 'The charity ride list is not available just now.' }, { 'cache-control': 'no-store' });
    }
  }

  if (path === '/documents') {
    if (req.method !== 'GET') return reply(405, { error: 'GET the documents.' });
    try {
      return reply(200, { documents: await deps.listDocuments() }, { 'cache-control': DOCUMENTS_CACHE });
    } catch {
      return reply(503, { error: 'The club documents are not available just now.' }, { 'cache-control': 'no-store' });
    }
  }

  if (path === '/news') {
    if (req.method !== 'GET') return reply(405, { error: 'GET the news.' });
    try {
      return reply(200, { news: await deps.listNews() }, { 'cache-control': NEWS_CACHE });
    } catch {
      return reply(503, { error: 'Club news is not available just now.' }, { 'cache-control': 'no-store' });
    }
  }

  if (path === '/charity-signup') {
    if (req.method !== 'POST') return reply(405, { error: 'POST a sign-up.' });
    if (req.origin && !ALLOWED_ORIGINS.includes(req.origin)) return reply(403, { error: 'Sign-ups come from the club website.' });
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (str(b.website).trim()) return reply(200, { ok: true });
    const form: SignupForm = {
      ride: str(b.ride), name: str(b.name), email: str(b.email), phone: str(b.phone),
      riding: b.riding === true, pillion: b.pillion === true, guests: typeof b.guests === 'number' ? b.guests : Number.NaN,
      guestNames: str(b.guestNames), job: str(b.job), notes: str(b.notes),
    };
    const problem = signupProblem(form);
    if (problem) return reply(400, { error: problem });
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    const clean: CleanSignup = {
      ride: form.ride, name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: orNull(form.phone),
      riding: form.riding, pillion: form.riding && form.pillion, guests: form.guests, guest_names: orNull(form.guestNames),
      job: orNull(form.job), notes: orNull(form.notes),
    };
    let refusal: string | null;
    try {
      refusal = await deps.websiteSignup(clean);
    } catch {
      return reply(503, { error: `Something went wrong on our side. Email the club at ${CLUB_EMAIL}.` });
    }
    if (refusal === SIGNUP_WORDS.tooMany) return reply(429, { error: refusal });
    if (refusal && (Object.values(SIGNUP_WORDS) as string[]).includes(refusal)) return reply(400, { error: refusal });
    if (refusal) return reply(503, { error: `Something went wrong on our side. Email the club at ${CLUB_EMAIL}.` });
    return reply(200, { ok: true });
  }

  return reply(404, { error: 'No such page.' });
}
