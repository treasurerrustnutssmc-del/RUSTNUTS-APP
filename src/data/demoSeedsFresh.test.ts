// The demo's other seeds on every instant: chat, invites, club news, the board lists and the site
// photos are built for the day the demo is opened, from the one session clock, and their words
// agree with the club's dates. Spec: docs/superpowers/specs/2026-11-14-demo-dates-follow-today-design.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { melbourneHhmm, melbourneInstant } from '../domain/business';
import { addDays, daysBetween } from '../domain/dates';
import { invitesIn, invitesOutByRide } from '../domain/invites';
import { melbourneDate } from '../domain/rides';
import { publicNews } from '../domain/siteNews';
import type { ClubData } from '../domain/types';
import { createAppMode } from './appMode';
import { demoReply } from './assistantDemo';
import { demoChatData, demoPastRides } from './chat/demoChatData';
import { createDemoSession } from './demoSession';
import { dayMonth, dayOrdinal, weekdayName } from './demoStory';
import { INSTANTS, builtFor } from './demoStory.testkit';
import { demoEnquiries } from './enquiriesData';
import { demoFeedback } from './feedbackData';
import { demoSiteNews } from './siteNewsData';
import { demoSitePhotoCrew, demoSitePhotos } from './sitePhotosData';
import { demoSocialData } from './social/demoSocialData';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const eachInstant = () => INSTANTS.map((now) => ({ now, today: melbourneDate(now), data: builtFor(now) }));
const rideOf = (data: ClubData, id: string) => data.rides.find((r) => r.id === id)!;
const minus = (now: string, ms: number) => new Date(Date.parse(now) - ms).toISOString();
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

test('invites match the calendar', () => {
  for (const { now, today, data } of eachInstant()) {
    const social = demoSocialData(today);
    const invite = (id: string) => social.invites.find((i) => i.id === id)!;
    assert.equal(invite('inv-1').eventOn, melbourneDate(rideOf(data, 'r-3').startsAt), `inv-1 on the Toy Run at ${now}`);
    assert.equal(invite('inv-2').eventOn, melbourneDate(rideOf(data, 'r-6').startsAt), `inv-2 on Ride for Kids at ${now}`);
    assert.ok(invitesIn(social.invites, today).upcoming.length >= 3, `three coming up at ${now}`);
    const out = invitesOutByRide(social.invites, data.rides, today);
    assert.equal(out[0].ride.id, 'r-4', now);
    assert.equal(out[0].invites.length, 2, `both outgoing invites on r-4 at ${now}`);
    for (const i of social.invites) {
      if (i.answeredAt) assert.ok(i.answeredAt <= now, `${i.id} answered after now at ${now}`);
      assert.ok(i.addedAt <= now, `${i.id} added after now at ${now}`);
    }
    for (const m of social.mechanics) assert.ok(m.addedAt <= now, `${m.id} added after now at ${now}`);
    for (const c of social.otherClubs) assert.ok(c.addedAt <= now, `${c.id} added after now at ${now}`);
    // The social stamps are story dates moved by weeks: each stays the same distance before today.
    const back = (iso: string) => daysBetween(melbourneDate(iso), today);
    const within = (iso: string, lo: number, hi: number, what: string) => {
      const d = back(iso);
      assert.ok(d >= lo && d <= hi, `${what} ${d} days back at ${now}, not ${lo} to ${hi}`);
    };
    within(invite('inv-1').answeredAt!, 13, 19, 'inv-1 answered');
    within(invite('inv-2').answeredAt!, 11, 17, 'inv-2 answered');
    within(invite('inv-4').answeredAt!, 5, 11, 'inv-4 answered');
    for (const i of social.invites) within(i.addedAt, 15, 21, `${i.id} added`);
    for (const c of social.otherClubs) within(c.addedAt, 15, 21, `${c.id} added`);
    for (const m of social.mechanics) within(m.addedAt, 54, 60, `${m.id} added`);
    const report = social.contentReports.find((r) => r.id === 'cr-1')!;
    assert.ok(report.createdAt <= now, `cr-1 after now at ${now}`);
    assert.equal(report.createdAt, melbourneInstant(addDays(today, -1), '09:00'), `cr-1 at 9 am yesterday at ${now}`);
  }
});

test('club news stays on Home', () => {
  for (const { now, today, data } of eachInstant()) {
    const news = demoSiteNews(new Date(now));
    assert.deepEqual(publicNews(news, new Date(now)).map((n) => n.id).sort(), ['demo-news-1', 'demo-news-2'], now);
    const toy = news.find((n) => n.id === 'demo-news-1')!;
    const open = news.find((n) => n.id === 'demo-news-2')!;
    const day = melbourneDate(rideOf(data, 'r-3').startsAt);
    assert.equal(toy.title, `Toy run, ${weekdayName(day)} ${dayMonth(day)}`, now);
    assert.equal(toy.body, 'Bring a wrapped toy. West leaves Laverton at 9am sharp and rides in to Werribee Racecourse for a 10am start. Everyone welcome to wave us off.');
    const openDay = open.body.match(/^Saturday (\d{1,2} [A-Z][a-z]+),/)?.[1];
    assert.ok(openDay, `open day named at ${now}: ${open.body}`);
    // The open day is a Saturday 14 to 20 days on, and the notice names that day.
    const hits = Array.from({ length: 7 }, (_, i) => addDays(today, 14 + i)).filter((x) => weekdayName(x) === 'Saturday');
    assert.equal(hits.length, 1, now);
    assert.ok(open.body.includes(`Saturday ${dayMonth(hits[0])}`), `open day ${open.body} at ${now}`);
    assert.equal(open.body, `Saturday ${dayMonth(hits[0])}, 11am to 3pm. Come and meet the club, see the bikes, have a sausage.`);
    assert.equal(toy.createdAt, minus(now, 3 * DAY_MS), now);
    assert.equal(open.createdAt, minus(now, 12 * DAY_MS), now);
    assert.deepEqual(news.map((n) => n.postedBy), ['demo-pres', 'demo-pres']);
  }
});

test('board lists look tended', () => {
  for (const { now } of eachInstant()) {
    const [open, handled] = demoEnquiries(new Date(now));
    assert.equal(open.id, 'demo-enquiry-1');
    assert.equal(open.createdAt, minus(now, 38 * HOUR_MS), now);
    assert.equal(open.handledAt, null);
    assert.equal(handled.id, 'demo-enquiry-2');
    assert.equal(handled.createdAt, minus(now, 4 * DAY_MS), now);
    assert.equal(handled.handledAt, plus(handled.createdAt, 10 * HOUR_MS), now);
    const [fresh, answered] = demoFeedback(new Date(now));
    assert.equal(fresh.id, 'demo-feedback-1');
    assert.equal(fresh.createdAt, minus(now, 5 * HOUR_MS), now);
    assert.equal(answered.id, 'demo-feedback-2');
    assert.equal(answered.createdAt, minus(now, 3 * DAY_MS), now);
    assert.equal(answered.repliedAt, plus(answered.createdAt, 5 * HOUR_MS), now);
    assert.equal(answered.device, 'iOS 26.1 · iPhone 17');
    for (const stamp of [open.createdAt, handled.createdAt, handled.handledAt!, fresh.createdAt, answered.createdAt, answered.repliedAt!]) {
      assert.ok(stamp <= now, `${stamp} after ${now}`);
    }
  }
});

test('site photos: picked, decided and removed in order, never ahead of now', () => {
  for (const { now, data } of eachInstant()) {
    const photos = demoSitePhotos('m-spanner', (path) => `mm-${path}`, new Date(now));
    const photo = (id: string) => photos.find((p) => p.id === id)!;
    const lorne = photo('demo-sp-1');
    assert.equal(lorne.caption, 'Run to Lorne');
    assert.equal(lorne.pickedAt, minus(now, 12 * DAY_MS), now);
    assert.equal(lorne.decidedAt, plus(lorne.pickedAt, 2 * HOUR_MS + 20 * 60_000), now);
    const dusk = photo('demo-sp-2');
    assert.equal(dusk.pickedAt, minus(now, 10 * HOUR_MS), now);
    assert.equal(dusk.decidedAt, dusk.pickedAt, now);
    const removed = photo('demo-sp-3');
    assert.equal(removed.pickedAt, minus(now, 11 * DAY_MS), now);
    assert.equal(removed.decidedAt, removed.pickedAt, now);
    assert.equal(removed.removedAt, plus(removed.decidedAt!, 4 * HOUR_MS), now);
    for (const p of photos) {
      assert.ok(p.pickedAt <= p.decidedAt! && p.decidedAt! <= now, `${p.id} at ${now}`);
      if (p.removedAt) assert.ok(p.removedAt >= p.decidedAt! && p.removedAt <= now, `${p.id} removed at ${now}`);
    }
    // The dusk-run photo was picked after its chat picture was posted.
    const chat = demoChatData(new Date(now), data.rides);
    const posted = chat.messages.find((m) => m.media.some((x) => x.path === 'demo/dusk-run.jpg'))!;
    assert.equal(posted.createdAt, minus(now, 20 * HOUR_MS), now);
    assert.ok(posted.createdAt < dusk.pickedAt, now);
    for (const c of demoSitePhotoCrew(new Date(now))) assert.equal(c.addedAt, minus(now, 20 * DAY_MS), now);
    assert.deepEqual(demoSitePhotoCrew(new Date(now)).map((c) => c.memberId), ['m-torque', 'm-jet']);
  }
});

test('the past ride is a fortnight back, and its chat comes after it', () => {
  for (const { now, today, data } of eachInstant()) {
    const [ride] = demoPastRides(new Date(now));
    assert.equal(ride.id, 'r-past-1');
    assert.equal(ride.title, 'Run to Lorne');
    assert.equal(melbourneDate(ride.startsAt), addDays(today, -15), now);
    assert.equal(melbourneHhmm(ride.startsAt), '09:00', now);
    assert.equal(melbourneDate(ride.endsAt!), addDays(today, -15), now);
    assert.equal(melbourneHhmm(ride.endsAt!), '17:00', now);
    const wall = demoChatData(new Date(now), data.rides).messages.filter((m) => m.conversationId === 'ride:r-past-1');
    assert.equal(wall.length, 2);
    for (const m of wall) {
      assert.ok(m.createdAt > ride.endsAt!, `${m.id} before the ride ended at ${now}`);
      assert.ok(Date.parse(now) - Date.parse(m.createdAt) <= 14 * DAY_MS, `${m.id} about 14 days ago at ${now}`);
    }
  }
});

// The spec's chat table, "New" and "Old" columns (section 6).
const NEW_LINES = [
  'Who’s keen for the club lunch ride? Clubhouse is booked, raffle after.',
  'In. Go easy on the raffle tickets this time, Gravel.',
  'Not a bad way to finish a ride.',
  'Rego reminder: check yours at https://www.vicroads.vic.gov.au before the club lunch ride.',
  'G’day all, Ben here. Rode with North last month. Keen for the club lunch ride if there’s room.',
  'West family day at the clubhouse is locked in. Marquee’s up from 10, barbie at noon. Kids welcome, dogs on a lead.',
  'Diesel says there’s one in our shed. I’ll bring it to the next ride.',
  'Meeting’s at the clubhouse, 7:30. Bring your club lunch ride numbers.',
  'Done. Rusty Bus rego is paid up for the year.',
  'Lefty’s coming along well. Worth a chat at the next meeting.',
  'Club lunch ride numbers are building across both chapters.',
  'North will have a few more by the meeting.',
  'Can you bring the first aid kit to the breakfast run?',
];
const OLD_LINES = [
  'Who’s keen for the Christmas ride? Lunch is sorted, Kris Kringle after.',
  'In. Ten dollar limit on the Kris Kringle this year, Gravel.',
  'Sunday arvo. Not a bad way to finish the weekend.',
  'Rego reminder for the summer runs: check yours at https://www.vicroads.vic.gov.au before the Christmas ride.',
  'G’day all, Ben here. Rode with North last month. Keen for the Christmas ride if there’s room.',
  'West family day at the clubhouse on the 16th. Marquee’s up from 10, barbie at noon. Kids welcome, dogs on a lead.',
  'Diesel says there’s one in our shed. I’ll bring it Sunday.',
  'Meeting Thursday 7:30 at the clubhouse. Bring your Christmas ride numbers.',
  'Done. Rusty Bus rego is due in December.',
  'Lefty’s FNG time is up in January. Worth a chat at the next meeting.',
  'Christmas ride numbers so far: 23 across both chapters.',
  'North will have a few more by Thursday.',
  'Can you bring the first aid kit on the 8th?',
];

/** The voice note's real length in ms, or null when ffprobe isn't on this machine. */
const voiceFileMs = (() => {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(__dirname, '../../assets/demo/voice-late.m4a')], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) * 1000);
  } catch {
    return null;
  }
})();

test('chat words agree with the calendar', () => {
  for (const { now, data } of eachInstant()) {
    const chat = demoChatData(new Date(now), data.rides);
    const bodies = chat.messages.map((m) => m.body).filter((b): b is string => b !== null);
    const r1Day = melbourneDate(rideOf(data, 'r-1').startsAt);
    const toyDay = melbourneDate(rideOf(data, 'r-3').startsAt);
    const breakfast = `Breakfast run on the ${dayOrdinal(r1Day)}, KSU 8:30. Tail gunner in hi-vis.`;
    const toy = `Toy Run’s on ${weekdayName(toyDay)} ${dayMonth(toyDay)}. Rusty Bus can carry the toys from the clubhouse.`;
    assert.ok(bodies.includes(breakfast), `${breakfast} at ${now}`);
    assert.ok(bodies.includes(toy), `${toy} at ${now}`);
    for (const line of NEW_LINES) assert.ok(bodies.includes(line), `missing: ${line}`);
    for (const line of OLD_LINES) assert.ok(!bodies.includes(line), `still there: ${line}`);
    // The two generated lines name their own ride's day on purpose; they are checked exactly above.
    for (const body of bodies.filter((b) => b !== breakfast && b !== toy)) {
      assert.doesNotMatch(body, /Christmas|Kris Kringle|Thursday|Sunday|weekend|December|January|summer/, now);
    }
    for (const m of chat.messages) assert.ok(m.createdAt <= now, `${m.id} after now at ${now}`);
  }
  const bare = demoChatData(new Date(INSTANTS[0]), []).messages.map((m) => m.body);
  assert.ok(bare.includes('Breakfast run is on, KSU 8:30. Tail gunner in hi-vis.'));
  assert.ok(bare.includes('Toy Run’s coming up. Rusty Bus can carry the toys from the clubhouse.'));
});

test('the voice note’s length is the real file’s', (t) => {
  const voice = demoChatData(new Date(INSTANTS[0]), []).messages.flatMap((m) => m.media).find((x) => x.kind === 'voice')!;
  assert.equal(voice.path, 'demo/voice-late.m4a');
  if (voiceFileMs === null) {
    t.skip('ffprobe is not on this machine');
    return;
  }
  assert.ok(Math.abs(voice.durationMs! - voiceFileMs) <= 100, `seed ${voice.durationMs} ms, file ${voiceFileMs} ms`);
});

const planARide = (data: ClubData, now: string) => {
  const me = data.members.find((m) => m.id === 'm-spanner')!;
  const reply = demoReply([{ role: 'user', content: [{ type: 'text', text: 'Plan a ride for me' }] }], { me, data, now });
  assert.equal(reply.proposals[0]?.name, 'add_ride', now);
  return reply.proposals[0].input.date as string;
};

test('the assistant proposes a free Sunday at least a fortnight out', () => {
  for (const { now, today, data } of eachInstant()) {
    const day = planARide(data, now);
    assert.equal(weekdayName(day), 'Sunday', now);
    assert.ok(daysBetween(today, day) >= 14, `${day} at ${now}`);
    assert.ok(!data.rides.some((r) => melbourneDate(r.startsAt) === day), `${day} already has a ride at ${now}`);
  }
});

test('no seed reads the machine clock', () => {
  const RealDate = Date;
  class NoClock extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error('read the machine clock: new Date()');
      super(...(args as [number]));
    }
    static now(): number { throw new Error('read the machine clock: Date.now()'); }
  }
  // Everything the seeds are given is made before the clock is taken away.
  const cases = eachInstant().map((x) => ({ ...x, at: new RealDate(x.now) }));
  globalThis.Date = NoClock as DateConstructor;
  try {
    for (const { now, today, data, at } of cases) {
      assert.doesNotThrow(() => demoChatData(at, data.rides), `demoChatData at ${now}`);
      assert.doesNotThrow(() => demoPastRides(at), `demoPastRides at ${now}`);
      assert.doesNotThrow(() => demoSocialData(today), `demoSocialData at ${now}`);
      assert.doesNotThrow(() => demoSiteNews(at), `demoSiteNews at ${now}`);
      assert.doesNotThrow(() => demoEnquiries(at), `demoEnquiries at ${now}`);
      assert.doesNotThrow(() => demoFeedback(at), `demoFeedback at ${now}`);
      assert.doesNotThrow(() => demoSitePhotos('m-spanner', () => null, at), `demoSitePhotos at ${now}`);
      assert.doesNotThrow(() => demoSitePhotoCrew(at), `demoSitePhotoCrew at ${now}`);
      assert.doesNotThrow(() => planARide(data, now), `the ride proposal at ${now}`);
    }
  } finally {
    globalThis.Date = RealDate;
  }
});

test('a store that reseeds on a mode change sees the new session', async () => {
  const memory = new Map<string, string>();
  const mode = createAppMode({
    getItem: async (k) => memory.get(k) ?? null,
    setItem: async (k, v) => void memory.set(k, v),
    removeItem: async (k) => void memory.delete(k),
  }, true);
  const clock = [new Date('2026-11-14T02:00:00.000Z'), new Date('2026-11-17T02:00:00.000Z'), new Date('2026-11-20T02:00:00.000Z')];
  let reads = 0;
  const session = createDemoSession(mode.subscribe, () => clock[reads++]);
  const seen: string[] = [];
  mode.subscribe(() => seen.push(session.now().toISOString())); // a store reseeding, as siteNews.tsx does
  assert.equal(session.now().toISOString(), '2026-11-14T02:00:00.000Z');
  await mode.load();
  assert.deepEqual(seen, ['2026-11-17T02:00:00.000Z']);
  await mode.startReview();
  assert.deepEqual(seen, ['2026-11-17T02:00:00.000Z', '2026-11-20T02:00:00.000Z'], 'the store saw the new instant, not the old one');

  // And the app's one session is made on the line after appMode, before anything else subscribes.
  const source = readFileSync(join(__dirname, 'reviewMode.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const lines = source.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const at = lines.findIndex((l) => l.startsWith('export const appMode = createAppMode('));
  assert.ok(at >= 0, 'appMode is made in reviewMode.ts');
  assert.equal(lines[at + 1], 'export const demoSession = createDemoSession(appMode.subscribe);');
  assert.ok(!lines.slice(0, at + 1).some((l) => /\.subscribe\(/.test(l)), 'nothing subscribes before the session');
});

test('the session feeds every demo provider and store', () => {
  // Every call of a demo seed in these files is handed demoSession.now() in its own argument list,
  // however it is laid out, so no store can slip the machine clock (or an alias of it) into a seed.
  const SEED = /\b(buildDemoData|demoTodayRide|demoChatData|demoPastRides|demoSocialData|demoSiteNews|demoEnquiries|demoFeedback|demoSitePhotos|demoSitePhotoCrew)\(/g;
  const argsAt = (src: string, open: number) => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
    }
    return src.slice(open + 1);
  };
  let calls = 0;
  for (const file of ['DemoClubProvider.tsx', 'chat/DemoChatProvider.tsx', 'social/DemoSocialProvider.tsx', 'siteNews.tsx', 'enquiries.tsx', 'feedback.tsx', 'sitePhotos.tsx']) {
    const source = readFileSync(join(__dirname, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\s;,({])\/\/.*$/gm, '$1');
    const found = [...source.matchAll(SEED)];
    assert.ok(found.length > 0, `${file} calls a demo seed`);
    for (const m of found) {
      calls++;
      const args = argsAt(source, m.index! + m[0].length - 1);
      assert.ok(args.includes('demoSession.now()'), `${file}: ${m[1]}(${args.replace(/\s+/g, ' ')}) is not handed demoSession.now()`);
    }
  }
  assert.ok(calls >= 12, `${calls} seed calls found`);
});
