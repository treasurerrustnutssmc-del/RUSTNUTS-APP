// Both providers show the club as it stands today. They keep the stored rows as `raw` and hand every
// screen, guard and demo action `settleActing(raw, today)`, where `today` comes from useClubToday,
// which moves on at Melbourne midnight and whenever the app comes back to the front. So a stint that
// ends tonight ends on a phone left open, with no reload and no scheduled job (spec: "Ending on its
// own, with no scheduled job", 3). The providers are React Native and can't run under node, so their
// wiring is read from the source; the clock itself (everyClubDay) runs here on node's mock timers.

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { everyClubDay } from '../domain/acting';

/** A file in src/data with its comment-only lines and block comments left out. */
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');

/** The body of one action in a provider's value, from its key to the next action's key. */
function actionBody(src: string, name: string): string {
  const start = src.indexOf(`\n    ${name}: async (`);
  assert.ok(start >= 0, `${name} is on the club`);
  const rest = src.slice(start + 1);
  const next = rest.slice(1).search(/\n {4}[A-Za-z0-9]+: (async )?\(/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('both providers settle on the ticking today', () => {
  for (const file of ['DemoClubProvider.tsx', 'LiveClubProvider.tsx']) {
    const src = read(file);
    assert.match(src, /const \[raw, setData\] = useState<ClubData>\(/, `${file} keeps the stored rows as raw`);
    assert.match(src, /const today = useClubToday\(\);/, `${file} reads the ticking today`);
    assert.doesNotMatch(src, /const today = melbourneDate\(/, `${file} no longer reads the day once a render`);
    assert.match(src, /const data = useMemo\(\(\) => settleActing\(raw, today\), \[raw, today\]\);/, `${file} settles them`);
    // Every other read goes through the settled rows: raw shows only where it's kept, settled, or
    // checked for the viewer's own rows ending.
    for (const line of src.split('\n').filter((l) => /\braw\b/.test(l))) {
      assert.match(line, /useState<ClubData>|settleActing\(raw, |\[raw, today/, `${file} reads raw rows: ${line.trim()}`);
    }
  }
  // The demo's actions, its live ride and the steps of a several-step press read the settled rows,
  // so writing them back is the demo's lazy close.
  const demo = read('DemoClubProvider.tsx');
  assert.match(demo, /const ctx: act\.DemoCtx = \{ data, me, today \};/);
  assert.match(demo, /bindDemoLive\(\(\) => \(\{ data, me \}\)\)/);
  assert.match(demo, /latest\.current = data;/);
  // Live: the access level, the action guards and the Family view read them too.
  const live = read('LiveClubProvider.tsx');
  assert.match(live, /const level = accessLevel\(visibleMe, data\.positions\);/);
  assert.match(live, /appointProblem\(visibleMe, target, chapterId, role, data, today\)/);
});

test('useClubToday re-reads at the next club day and on foreground', () => {
  const hook = read('useClubToday.ts');
  assert.match(hook, /export function useClubToday\(\): string/);
  assert.match(hook, /useEffect\(\(\) => everyClubDay\(setToday\), \[\]\);/, 'a timer for each Melbourne midnight, stopped on unmount');
  assert.match(hook, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) setToday\(clubToday\(\)\);/);
  assert.match(hook, /return \(\) => sub\.remove\(\);/);

  // The clock: 11 pm in Melbourne on 3 October 2026, the night summer time starts.
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-03T13:00:00.000Z') });
  try {
    const days: string[] = [];
    const stop = everyClubDay((day) => days.push(day));
    mock.timers.tick(3_599_999);
    assert.deepEqual(days, [], 'not before midnight');
    mock.timers.tick(1);
    assert.deepEqual(days, ['2026-10-04'], 'at midnight');
    mock.timers.tick(82_799_999);
    assert.deepEqual(days, ['2026-10-04'], 'the 23-hour day isn’t over yet');
    mock.timers.tick(1);
    assert.deepEqual(days, ['2026-10-04', '2026-10-05'], 'and the next midnight after it');
    stop();
    mock.timers.tick(2 * 90_000_000);
    assert.deepEqual(days, ['2026-10-04', '2026-10-05'], 'stopped');
  } finally {
    mock.timers.reset();
  }

  // Half past midnight on 4 April 2027, the 25-hour day summer time ends.
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2027-04-03T13:30:00.000Z') });
  try {
    const days: string[] = [];
    const stop = everyClubDay((day) => days.push(day));
    mock.timers.tick(88_199_999);
    assert.deepEqual(days, [], 'twenty-four and a half hours on, it’s still the 4th');
    mock.timers.tick(1);
    assert.deepEqual(days, ['2027-04-05']);
    stop();
  } finally {
    mock.timers.reset();
  }
});

test('a failed reload after a settle drops the saved copy', () => {
  const live = read('LiveClubProvider.tsx');
  // reload says whether it failed; a newer load taking over isn't a failure.
  assert.match(live, /const reload = useCallback\(async \(uid: string \| null\): Promise<boolean> => \{/);
  // The day the rows on screen were loaded (or the saved copy saved), so only a stint that has ended
  // since then calls for a reload, and a fresh load of a row the database hasn't closed yet doesn't loop.
  assert.match(live, /loadedOn\.current = melbourneDate\(saved\.savedAt\);/);
  assert.match(live, /loadedOn\.current = loadedDay;/);
  const at = live.indexOf('lapsedOwnRows(');
  assert.ok(at >= 0, 'live checks whether a settle ends one of the viewer’s own rows');
  const effect = live.slice(at, at + 400);
  assert.match(effect, /^lapsedOwnRows\(settleActing\(raw, loadedOn\.current\), today, userId\)/);
  assert.match(effect, /reload\(userId\)\.then\(\(loaded\) => \{\s*if \(!loaded\) clubCache\.clear\(\);/);
  assert.match(effect, /\}, \[raw, today, userId, reload\]\);/);
});

test('the club offers every acting action; live checks the settled rows first, the demo runs the writer', () => {
  const context = read('clubContext.ts');
  const live = read('LiveClubProvider.tsx');
  const demo = read('DemoClubProvider.tsx');
  const actions: [string, string, RegExp][] = [
    ['appointActing', 'appoint_acting', /appointActingProblem\(visibleMe, target, chapterId, role, until, why, data, today\)/],
    ['requestCover', 'request_cover', /requestCoverProblem\(visibleMe, data\.positions\.find\(\(p\) => p\.id === positionId\), target, until, why, data, today\)/],
    ['requestActing', 'request_acting', /requestActingProblem\(visibleMe, target, chapterId, role, covers, until, why, data, today\)/],
    ['withdrawActingRequest', 'withdraw_acting_request', /withdrawRequestProblem\(visibleMe, request, data, today\)/],
    ['confirmActing', 'confirm_acting', /confirmActingProblem\(visibleMe, request, data, today\)/],
    ['setActingUntil', 'set_acting_until', /setActingUntilProblem\(visibleMe, position, until, data, today\)/],
    ['openActingVote', 'open_acting_vote', /openActingVoteProblem\(visibleMe, .+, quorum, closesAt, meetingId, data, new Date\(\)\.toISOString\(\)\)/],
  ];
  for (const [name, rpc, check] of actions) {
    assert.match(context, new RegExp(`\\n  ${name}: \\(`), `ClubContextValue has ${name}`);
    const body = actionBody(live, name);
    const checked = body.search(check);
    assert.ok(checked >= 0, `live ${name} checks first:\n${body}`);
    const called = body.indexOf(`supabase().rpc('${rpc}'`);
    assert.ok(called > checked, `live ${name} then calls ${rpc}`);
    assert.ok(body.indexOf('await after();') > called, `live ${name} loads again after`);
    assert.match(actionBody(demo, name), new RegExp(`acting\\.${name}\\(fresh\\(\\), `), `the demo's ${name} runs its writer on the latest rows`);
  }
});
