import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_GROUPS, telUrl, smsUrl } from './supportLines';

const all = SUPPORT_GROUPS.flatMap((g) => g.lines);

test('the crisis lines live in the app, so they work offline and when the website is down', () => {
  assert.deepEqual(
    SUPPORT_GROUPS.map((g) => g.title),
    ['Mental health and crisis, 24/7', 'Family and safety'],
  );
  assert.ok(all.length >= 7);
});

test('the numbers match the club website Support page', () => {
  const byName = Object.fromEntries(all.map((l) => [l.name, l.phone]));
  assert.equal(byName['Lifeline'], '13 11 14');
  assert.equal(byName['MensLine Australia'], '1300 78 99 78');
  assert.equal(byName['Beyond Blue'], '1300 22 4636');
  assert.equal(byName['Suicide Call Back Service'], '1300 659 467');
  assert.equal(byName['SuicideLine Victoria'], '1300 651 251');
  assert.equal(byName['1800RESPECT'], '1800 737 732');
  assert.equal(byName["Men's Referral Service"], '1300 766 491');
});

test('Lifeline and 1800RESPECT can also be texted', () => {
  assert.equal(all.find((l) => l.name === 'Lifeline')?.text, '0477 13 11 14');
  assert.equal(all.find((l) => l.name === '1800RESPECT')?.text, '0458 737 732');
});

test('every line has its own id and a short detail line', () => {
  assert.equal(new Set(all.map((l) => l.id)).size, all.length);
  for (const l of all) assert.ok(l.detail.length > 0 && l.detail.length <= 90, l.name);
});

test('tap-to-call and tap-to-text addresses keep only the digits', () => {
  assert.equal(telUrl('13 11 14'), 'tel:131114');
  assert.equal(telUrl('1300 22 4636'), 'tel:1300224636');
  assert.equal(telUrl('000'), 'tel:000');
  assert.equal(smsUrl('0477 13 11 14'), 'sms:0477131114');
});
