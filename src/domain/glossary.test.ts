import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLOSSARY, rideColourLegend, roleKey } from './glossary';
import { ROLE_LABEL, ROLE_SHORT } from './labels';
import type { PositionRole } from './types';

const entries = GLOSSARY.flatMap((g) => g.entries);

test('every club word the review found unclear is explained', () => {
  const terms = entries.map((e) => e.term);
  for (const t of ['FNG', 'Hang Around', 'Applicant', 'Full member', 'Nomad', 'Legacy', 'Supporter', 'Family', 'The disc', 'Big 4', 'Supported ride', 'Non-Nuts ride', 'KSU', 'Board', 'NEC', 'Monthly chapter meeting', 'Annual Chapter Meeting', 'Association AGM']) {
    assert.ok(terms.includes(t), `missing ${t}`);
  }
});

test('each entry is a short plain sentence, written once', () => {
  assert.equal(new Set(entries.map((e) => e.term)).size, entries.length, 'no word listed twice');
  for (const e of entries) {
    assert.ok(e.meaning.length > 10 && e.meaning.length <= 140, `${e.term} meaning length ${e.meaning.length}`);
    assert.ok(!e.meaning.includes('—'), `${e.term} has an em dash`);
    assert.ok(/[.]$/.test(e.meaning), `${e.term} ends with a full stop`);
  }
});

test('the key lists every short form shown on a chip with its full title', () => {
  const key = roleKey();
  for (const role of Object.keys(ROLE_SHORT) as PositionRole[]) {
    const row = key.find((k) => k.short === ROLE_SHORT[role]);
    assert.ok(row, `no key row for ${ROLE_SHORT[role]}`);
    assert.equal(row!.title, ROLE_LABEL[role]);
  }
});


test('the Rides legend explains the two ride colours people ask about, using the glossary wording', () => {
  const legend = rideColourLegend();
  assert.match(legend, /Supported/);
  assert.match(legend, /Non-Nuts/);
  assert.match(legend, /Another club’s ride that we support/);
  assert.match(legend, /A ride organised by someone else/);
});
