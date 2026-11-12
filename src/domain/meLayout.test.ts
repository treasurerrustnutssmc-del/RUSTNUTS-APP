import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meGroups } from './meLayout';

const base = { contacts: 1, bikes: 1, owingCents: 0, onHiatus: false, roadRules: null };
const byId = (input: Parameters<typeof meGroups>[0]) => Object.fromEntries(meGroups(input).map((g) => [g.id, g]));

test('Me has six groups, in a fixed order', () => {
  assert.deepEqual(meGroups(base).map((g) => g.id), ['year', 'details', 'rules', 'fees', 'settings', 'help']);
});

test('with nothing to do, every group starts closed', () => {
  assert.deepEqual(meGroups(base).filter((g) => g.startsOpen), []);
});

test('no emergency contact opens My details and says so', () => {
  const g = byId({ ...base, contacts: 0 });
  assert.equal(g.details.startsOpen, true);
  assert.equal(g.details.summary, 'No emergency contact yet');
});

test('My details counts contacts and bikes in plain words', () => {
  assert.equal(byId({ ...base, contacts: 1, bikes: 1 }).details.summary, '1 emergency contact, 1 bike');
  assert.equal(byId({ ...base, contacts: 2, bikes: 3 }).details.summary, '2 emergency contacts, 3 bikes');
  assert.equal(byId({ ...base, contacts: 1, bikes: 0 }).details.summary, '1 emergency contact, no bikes');
});

test('Road Rules that need signing open Rules and papers; otherwise it shows where you stand', () => {
  const urgent = byId({ ...base, roadRules: { text: 'Not signed', urgent: true } });
  assert.equal(urgent.rules.startsOpen, true);
  assert.equal(urgent.rules.summary, 'Road Rules: not signed');
  const fine = byId({ ...base, roadRules: { text: 'Signed until 02/11/2027', urgent: false } });
  assert.equal(fine.rules.startsOpen, false);
  assert.equal(fine.rules.summary, 'Road Rules: signed until 02/11/2027');
  assert.equal(byId(base).rules.summary, 'Club documents and policies');
});

test('money owing opens Fees; paid up and on hiatus read plainly', () => {
  const owing = byId({ ...base, owingCents: 12500 });
  assert.equal(owing.fees.startsOpen, true);
  assert.equal(owing.fees.summary, '$125.00 owing');
  assert.equal(byId(base).fees.summary, 'All paid up');
  assert.equal(byId({ ...base, onHiatus: true }).fees.summary, 'On hiatus: no new fees');
});
