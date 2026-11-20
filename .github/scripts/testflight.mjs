// TestFlight jobs through the App Store Connect API, using the team key the Store build workflow uses,
// so none of them needs someone signed in to App Store Connect in a browser.
//
//   add-members            puts every App Store Connect user (members who accepted their invite) in
//                          the inside-testers group, so TestFlight emails them the app
//   status                 prints the newest builds, their processing and Beta App Review states
//   send-build-for-review  gives build N to the public-link group and sends it for Beta App Review
//   retire-build           expires build N (never the newest), which also takes it out of Beta App
//                          Review; Apple reviews one build at a time. It can't be undone.
//
// The repository is public, so its Actions logs are too: this prints counts and build states only,
// never a member's name or email. Run by .github/workflows/testflight.yml.
import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com';
const APP_ID = '6837151025';
const INSIDE_GROUP = 'a4717950-8d8d-4216-a803-d8149b306207'; // "Team (Expo)", internal, every build
const PUBLIC_GROUP = '80c82ad4-9090-4888-a728-3b2b12d89b11'; // "Rustnuts members", the public link
const WHAT_TO_TEST =
  'Sign in with your club email (a 6-digit code is emailed to you), then try the ride calendar, RSVPs, chats, live ride, your membership card and fees.';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** An ES256 token for the App Store Connect API (Apple allows up to 20 minutes). */
export function makeToken({ keyPem, keyId, issuerId, now = Math.floor(Date.now() / 1000) }) {
  const head = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64url({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), {
    key: createPrivateKey(keyPem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

/** App Store Connect users who aren't testers in the group yet (emails compared without case). */
export function membersToAdd(users, testers) {
  const have = new Set(testers.map((t) => String(t.attributes?.email ?? '').toLowerCase()));
  return users
    .map((u) => ({
      email: String(u.attributes?.username ?? '').trim().toLowerCase(),
      firstName: u.attributes?.firstName ?? '',
      lastName: u.attributes?.lastName ?? '',
    }))
    .filter((m) => m.email && !have.has(m.email));
}

/** The build with this build number, once App Store Connect has finished processing it. */
export function pickBuild(builds, number) {
  const build = builds.find((b) => String(b.attributes?.version) === String(number));
  if (!build) throw new Error(`No build ${number} in App Store Connect yet (upload it with Store build › ios-submit)`);
  if (build.attributes.expired) throw new Error(`Build ${number} has expired`);
  if (build.attributes.processingState !== 'VALID')
    throw new Error(`Build ${number} is still processing (${build.attributes.processingState}); run this again in a few minutes`);
  return build;
}

/** Build N, if it can be retired: not already expired, and not the newest build still working. */
export function buildToRetire(builds, number) {
  const build = builds.find((b) => String(b.attributes?.version) === String(number));
  if (!build) throw new Error(`No build ${number} in App Store Connect`);
  if (build.attributes.expired) throw new Error(`Build ${number} is already retired (expired)`);
  const newest = builds
    .filter((b) => !b.attributes.expired && b.attributes.processingState === 'VALID')
    .reduce((a, b) => (Number(b.attributes.version) > Number(a?.attributes.version ?? -1) ? b : a), null);
  if (newest?.id === build.id) throw new Error(`Build ${number} is the newest working build; upload a newer one first`);
  return build;
}

/**
 * How to fill "What to Test": App Store Connect may already have made an empty locale for the build,
 * and a second one for the same locale is refused, so an empty one is filled in place.
 */
export function whatToTestStep(locs) {
  if (locs.some((l) => l.attributes?.whatsNew)) return null;
  const empty = locs.find((l) => l.attributes?.locale === 'en-AU') ?? locs[0];
  return empty ? { method: 'PATCH', id: empty.id } : { method: 'POST' };
}

export function client(token, fetchImpl = fetch) {
  async function call(method, path, body) {
    const where = `${method} ${new URL(path, API).pathname}`;
    const res = await fetchImpl(path.startsWith('http') ? path : API + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // A parse error quotes the text around it, which could be someone's details: say only where.
      throw Object.assign(new Error(`${where} → ${res.status}, reply wasn't JSON`), { status: res.status });
    }
    if (!res.ok) {
      // Apple's error codes and titles name the problem; its "detail" can repeat an email, so it's left out.
      const errors = Array.isArray(json.errors) ? json.errors : [];
      const why = errors.map((e) => `${e.code}: ${e.title}`).join('; ');
      throw Object.assign(new Error(`${where} → ${res.status} ${why}`.trim()), {
        status: res.status,
        codes: errors.map((e) => e.code),
      });
    }
    return json;
  }
  async function all(path) {
    const out = [];
    for (let next = path; next; ) {
      const page = await call('GET', next);
      out.push(...(page.data ?? []));
      next = page.links?.next;
    }
    return out;
  }
  return { call, all };
}

/** Puts every App Store Connect user in the inside group. One Apple won't take is a warning only. */
export async function addMembers(api, out = { log: console.log, warn: console.error }) {
  const users = await api.all('/v1/users?limit=200');
  const testers = await api.all(`/v1/betaGroups/${INSIDE_GROUP}/betaTesters?limit=200`);
  const todo = membersToAdd(users, testers);
  let added = 0;
  let skipped = 0;
  for (const m of todo) {
    try {
      await api.call('POST', '/v1/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: m,
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: INSIDE_GROUP }] } },
        },
      });
      added++;
    } catch (e) {
      skipped++;
      out.warn(`::warning::Apple didn't take one member as an inside tester (${e.status ?? 'no reply'})`);
    }
  }
  const result = { users: users.length, testersBefore: testers.length, added, skipped };
  out.log(`App Store Connect users: ${result.users}. Inside testers before: ${result.testersBefore}. Added: ${added}. Not taken: ${skipped}.`);
  return result;
}

async function status(api) {
  const res = await api.call(
    'GET',
    `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,expired,uploadedDate,buildBetaDetail,betaAppReviewSubmission&include=buildBetaDetail,betaAppReviewSubmission`,
  );
  const inc = new Map((res.included ?? []).map((i) => [`${i.type}/${i.id}`, i.attributes]));
  for (const b of res.data) {
    const detail = inc.get(`buildBetaDetails/${b.relationships?.buildBetaDetail?.data?.id}`) ?? {};
    const review = inc.get(`betaAppReviewSubmissions/${b.relationships?.betaAppReviewSubmission?.data?.id}`);
    console.log(
      `Build ${b.attributes.version}: ${b.attributes.processingState}${b.attributes.expired ? ' (expired)' : ''}, ` +
        `inside ${detail.internalBuildState ?? '?'}, public ${detail.externalBuildState ?? '?'}, ` +
        `Beta App Review ${review?.betaReviewState ?? 'not sent'}, uploaded ${b.attributes.uploadedDate}`,
    );
  }
  const inside = await api.all(`/v1/betaGroups/${INSIDE_GROUP}/betaTesters?limit=200`);
  console.log(`Inside testers: ${inside.length}.`);
}

async function sendBuildForReview(api, number) {
  if (!/^\d+$/.test(String(number ?? ''))) throw new Error('Give the build number to send (for example 4)');
  const builds = await api.all(`/v1/builds?filter[app]=${APP_ID}&filter[version]=${number}&limit=10`);
  const build = pickBuild(builds, number);
  const step = whatToTestStep(await api.all(`/v1/builds/${build.id}/betaBuildLocalizations`));
  if (step?.method === 'PATCH') {
    await api.call('PATCH', `/v1/betaBuildLocalizations/${step.id}`, {
      data: { type: 'betaBuildLocalizations', id: step.id, attributes: { whatsNew: WHAT_TO_TEST } },
    });
  } else if (step?.method === 'POST') {
    await api.call('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-AU', whatsNew: WHAT_TO_TEST },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
  }
  if (step) console.log(`Build ${number}: "What to Test" filled in.`);
  await api.call('POST', `/v1/betaGroups/${PUBLIC_GROUP}/relationships/builds`, {
    data: [{ type: 'builds', id: build.id }],
  });
  console.log(`Build ${number}: given to the public-link group.`);
  try {
    await api.call('POST', '/v1/betaAppReviewSubmissions', {
      data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
    });
    console.log(`Build ${number}: sent for Beta App Review.`);
  } catch (e) {
    if (e.status === 409 && /already|exists/i.test(e.message)) {
      console.log(`Build ${number}: already sent for Beta App Review.`);
    } else throw e;
  }
}

async function retireBuild(api, number) {
  if (!/^\d+$/.test(String(number ?? ''))) throw new Error('Give the build number to retire (for example 3)');
  const builds = await api.all(`/v1/builds?filter[app]=${APP_ID}&limit=50&fields[builds]=version,processingState,expired`);
  const build = buildToRetire(builds, number);
  await api.call('PATCH', `/v1/builds/${build.id}`, { data: { type: 'builds', id: build.id, attributes: { expired: true } } });
  console.log(`Build ${number}: retired (expired).`);
}

async function main() {
  const [action = 'add-members', number] = process.argv.slice(2);
  const token = makeToken({
    keyPem: readFileSync(process.env.ASC_KEY_PATH ?? '../asc/AuthKey.p8', 'utf8'),
    keyId: process.env.ASC_KEY_ID,
    issuerId: process.env.ASC_ISSUER_ID,
  });
  const api = client(token);
  if (action === 'add-members') await addMembers(api);
  else if (action === 'status') await status(api);
  else if (action === 'send-build-for-review') await sendBuildForReview(api, number);
  else if (action === 'retire-build') await retireBuild(api, number);
  else throw new Error(`Unknown action ${action}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
