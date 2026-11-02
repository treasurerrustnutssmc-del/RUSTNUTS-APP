import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CONSENT,
  AI_FEATURES,
  AI_PROVIDER_LINE,
  aiConsentKey,
  hasAiConsent,
  parseAiConsent,
  readAiConsent,
  saveAiConsent,
  withAiConsent,
  type ConsentStore,
} from './aiConsent';

const memoryStore = (seed: Record<string, string> = {}): ConsentStore & { data: Record<string, string> } => {
  const data = { ...seed };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
};

test('agreement is kept per member, so another member on the same phone is asked again', () => {
  assert.notEqual(aiConsentKey('m1'), aiConsentKey('m2'));
  assert.ok(aiConsentKey('m1').includes('m1'));
});

test('nothing saved, or junk saved, means not agreed', () => {
  for (const raw of [null, '', 'not json', '[]', '42', '{"askClub":5}', '{"askClub":"yesterday"}']) {
    const record = parseAiConsent(raw);
    assert.equal(hasAiConsent(record, 'askClub'), false, String(raw));
    assert.equal(hasAiConsent(record, 'catchUp'), false, String(raw));
  }
});

test('agreeing to one feature does not agree to the other', () => {
  const record = withAiConsent({}, 'askClub', '2026-11-02');
  assert.equal(hasAiConsent(record, 'askClub'), true);
  assert.equal(hasAiConsent(record, 'catchUp'), false);
  const both = withAiConsent(record, 'catchUp', '2026-11-03');
  assert.deepEqual(both, { askClub: '2026-11-02', catchUp: '2026-11-03' });
});

test('a saved agreement round-trips through the store', async () => {
  const store = memoryStore();
  assert.equal(hasAiConsent(await readAiConsent(store, 'm1'), 'catchUp'), false);
  await saveAiConsent(store, 'm1', 'catchUp', '2026-11-02');
  assert.equal(hasAiConsent(await readAiConsent(store, 'm1'), 'catchUp'), true);
  assert.equal(hasAiConsent(await readAiConsent(store, 'm2'), 'catchUp'), false);
  // Agreeing to the second feature keeps the first.
  await saveAiConsent(store, 'm1', 'askClub', '2026-11-03');
  const record = await readAiConsent(store, 'm1');
  assert.equal(hasAiConsent(record, 'catchUp'), true);
  assert.equal(hasAiConsent(record, 'askClub'), true);
});

test('a store that fails to read counts as not agreed', async () => {
  const broken: ConsentStore = { getItem: () => Promise.reject(new Error('x')), setItem: async () => undefined };
  assert.equal(hasAiConsent(await readAiConsent(broken, 'm1'), 'askClub'), false);
});

test('each consent card names Anthropic (Claude), says what is sent, no training, not kept', () => {
  for (const feature of AI_FEATURES) {
    const c = AI_CONSENT[feature];
    const all = [c.heading, c.intro, ...c.sends, c.promise].join(' ');
    assert.ok(all.includes('Anthropic (Claude)'), `${feature}: names Anthropic (Claude)`);
    assert.ok(/train/i.test(c.promise), `${feature}: not used to train AI`);
    assert.ok(/kept/i.test(c.promise), `${feature}: not kept`);
    assert.ok(c.sends.length > 0, `${feature}: says what is sent`);
    assert.equal(c.agree, 'Agree');
    assert.equal(c.notNow, 'Not now');
  }
  const ask = AI_CONSENT.askClub.sends.join(' ').toLowerCase();
  for (const words of ['question', 'conversation so far', 'calendar', 'rusty bus', 'fees', 'names and roles', 'chats you can post in']) {
    assert.ok(ask.includes(words), `askClub sends: ${words}`);
  }
  const catchUp = AI_CONSENT.catchUp.sends.join(' ').toLowerCase();
  for (const words of ['newest messages', 'who wrote', 'when']) assert.ok(catchUp.includes(words), `catchUp sends: ${words}`);
});

test('the standing provider lines name Anthropic', () => {
  for (const feature of AI_FEATURES) assert.ok(AI_PROVIDER_LINE[feature].includes('Anthropic'), feature);
});
