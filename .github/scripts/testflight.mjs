// TestFlight jobs through the App Store Connect API, using the team key the Store build workflow uses,
// so none of them needs someone signed in to App Store Connect in a browser.
//
//   add-members            puts every App Store Connect user (members who accepted their invite) in
//                          the inside-testers group, so TestFlight emails them the app
//   status                 prints the newest builds, their processing and Beta App Review states
//   send-build-for-review  gives build N to the public-link group and sends it for Beta App Review
//
// The repository is public, so its Actions logs are too: this prints counts and build states only,
// never a member's name or email. Run by .github/workflows/testflight.yml.
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

function client(token) {
  async function call(method, path, body) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      // Apple's error codes and titles name the problem without repeating anyone's details.
      const why = (json.errors ?? []).map((e) => `${e.code}: ${e.title}`).join('; ');
      const err = new Error(`${method} ${path.split('?')[0]} → ${res.status} ${why}`);
      err.status = res.status;
      err.errors = json.errors ?? [];
      throw err;
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

async function addMembers(api) {
  const users = await api.all('/v1/users?limit=200');
  const testers = await api.all(`/v1/betaGroups/${INSIDE_GROUP}/betaTesters?limit=200`);
  const todo = membersToAdd(users, testers);
  let added = 0;
  let failed = 0;
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
      failed++;
      console.error(`::warning::One member couldn't be added: ${e.message.split('→')[1]?.trim()}`);
    }
  }
  console.log(`App Store Connect users: ${users.length}. Inside testers before: ${testers.length}. Added: ${added}. Failed: ${failed}.`);
  if (failed) process.exitCode = 1;
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
  const locs = await api.all(`/v1/builds/${build.id}/betaBuildLocalizations`);
  if (!locs.some((l) => l.attributes?.whatsNew)) {
    await api.call('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-AU', whatsNew: WHAT_TO_TEST },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
    console.log(`Build ${number}: "What to Test" filled in.`);
  }
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
    if (e.status === 409 && /already|exists/i.test(JSON.stringify(e.errors))) {
      console.log(`Build ${number}: already sent for Beta App Review.`);
    } else throw e;
  }
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
  else throw new Error(`Unknown action ${action}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
