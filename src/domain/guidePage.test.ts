// The member welcome guide (site/guide.html) is the page every invite links to. It is written by
// hand, so it drifts: on 14 Nov 2026 it still said five tabs (Merch made six on 1 Nov), told members
// to sign the Road Rules "if the app asks" and gave the Rides path only for an RSVP. These checks tie
// what the page says to the names the app itself shows, so the next rename fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOIN_STEPS } from './joinSteps';
import { RSVP_LABEL } from './labels';
import { meGroups } from './meLayout';
import { NOTIFY_INTRO } from './notifyIntro';
import { POSTING_RULES_TITLE } from './postingRules';
import { RIDE_TOOLS } from './ridesLayout';

const html = readFileSync(join(__dirname, '../../site/guide.html'), 'utf8');
const text = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const section = (id: string) => {
  const m = html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`));
  assert.ok(m, `the guide has a section with id ${id}`);
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
};
const groups = meGroups({ contacts: 0, bikes: 0, owingCents: 0, onHiatus: false, roadRules: null });
const group = (id: string) => groups.find((g) => g.id === id)!.title;

// The tab bar is written out in RootNavigator.tsx, so the labels are read from there: each
// Tabs.Screen shows its title, or its name when it has none.
const nav = readFileSync(join(__dirname, '../navigation/RootNavigator.tsx'), 'utf8');
const tabLabels = (from: string, to: string) =>
  [...nav.slice(nav.indexOf(`function ${from}(`), nav.indexOf(`function ${to}(`)).matchAll(/<Tabs\.Screen\b([\s\S]*?)\/>/g)].map(
    (m) => (m[1].match(/title: '([^']+)'/) ?? m[1].match(/name="([^"]+)"/)!)[1],
  );
const mainTabs = tabLabels('MainTabs', 'FamilyTabs');
const memberTabs = mainTabs.filter((t) => t !== 'Board');
const familyTabs = tabLabels('FamilyTabs', 'RootNavigator');
const COUNT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

test('the guide counts the tabs a member has and gives Merch its own row', () => {
  const where = section('where-things-are');
  assert.ok(mainTabs.includes('Board') && memberTabs.includes('Merch'), 'the tab bar was read from RootNavigator.tsx');
  assert.ok(where.includes(`${capital(COUNT[memberTabs.length])} tabs run along the bottom`), 'counts the member tabs');
  assert.ok(where.includes(`Board members get a ${ORDINAL[mainTabs.length]}, Board`), 'counts the Board tab on top');
  assert.doesNotMatch(text, /Five tabs/);
  const rows = [...html.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(rows, memberTabs, 'one row per member tab, in the order the app shows them');
  assert.match(where, /When there’s gear on sale for you, order from the Club shop in the app/);
});

test('the Me row names every group Me folds into, by the title the app shows', () => {
  const where = section('where-things-are');
  for (const g of groups) assert.ok(where.includes(g.title), `the Me row should name "${g.title}"`);
  assert.ok(where.includes(`then ${COUNT[groups.length]} groups you tap to open`), 'counts the groups');
  assert.match(where, /Sign out is at the bottom/);
});

test('the Rides row sends members to Ride tools and explains the ride colours', () => {
  const where = section('where-things-are');
  assert.ok(where.includes(`Open ${RIDE_TOOLS.title} for the route library`), 'names the Ride tools group');
  assert.match(where, /your own chapter’s rides plus Rustnuts and Supported rides/);
  assert.match(where, /Tap a colour to show the others, and tap Show my usual to put it back/);
});

test('family members are told their app is smaller and where they agree to the rules', () => {
  const where = section('where-things-are');
  const list = `${familyTabs.slice(0, -1).join(', ')} and ${familyTabs.at(-1)}`;
  assert.ok(where.includes(`Family accounts get a smaller app: ${COUNT[familyTabs.length]} tabs (${list})`), 'names the Family tabs');
  // Family never see the rules screen at sign-in (needsPostingRules leaves them out): the Family chat asks.
  assert.match(where, /Family members agree to the club rules in the Family chat, before their first message/);
});

test('signing in covers the rules screen and the notifications card', () => {
  const signIn = section('sign-in');
  assert.ok(signIn.includes(`the app shows the ${POSTING_RULES_TITLE}`), 'names the rules screen');
  assert.match(signIn, /tap I agree/);
  assert.ok(signIn.includes(`a card called ${NOTIFY_INTRO.title}, tap ${NOTIFY_INTRO.turnOn}`), 'names the notifications card');
  assert.doesNotMatch(signIn, /When the app asks to send you notifications/);
  assert.ok(signIn.includes(`at the end of a ${COUNT[JOIN_STEPS.length]}-step form`), 'counts the Ask to join steps');
  assert.match(signIn, /Sign out under the form, just above Delete my account/);
});

test('the first five minutes follow the app: Road Rules before a ride, RSVP on Home, fees told to the treasurer', () => {
  const first = section('first-five-minutes');
  assert.ok(first.includes(`Me › ${group('details')} › Emergency contacts`));
  assert.ok(first.includes(`Me › ${group('details')} › Garage › Add a bike`));
  assert.ok(first.includes(`Me › ${group('rules')} › Road Rules`), 'gives the Road Rules path');
  assert.match(first, /Sign the Road Rules before your first ride/);
  assert.match(first, /Legacy and Family members aren’t asked to sign/);
  assert.doesNotMatch(first, /if the app asks you to/);
  // "Can’t go" is the Home card's own short label (rides.tsx). RSVP_LABEL.no, "Can’t make it", is the one on the ride.
  assert.ok(first.includes(`on Home, tap ${RSVP_LABEL.going}, ${RSVP_LABEL.maybe} or Can’t go under Next ride`), 'RSVP from Home');
  assert.match(first, /The buttons show once you’ve signed the Road Rules/);
  assert.ok(first.includes(`Me › ${group('fees')}, or the fees card on Home when something is owing. Tap it to open Your fees`), 'where fees are');
  assert.match(first, /If anything is owing, pay by PayID or bank transfer/);
  assert.match(first, /tap I’ve paid this, check the amount and tap Tell the treasurer/);
});

test('on ride day the guide covers iPhones as well as Android', () => {
  assert.match(section('on-ride-day'), /On an iPhone, allowing it while you use the app is enough/);
});

test('help and privacy name the help group, the full list of services and what deleting does not do', () => {
  const help = section('help');
  assert.match(help, /Ask your chapter Secretary, or email/);
  assert.ok(help.includes(`Me › ${group('help')} has Club words, Show the quick tour again, Feedback and issues`));
  assert.match(help, /lists every outside service the app uses and what each one gets/);
  assert.doesNotMatch(help, /Google, GIPHY and the club website/);
  assert.ok(help.includes(`Me › ${group('settings')} › Share my mobile with members`));
  assert.match(help, /isn’t resigning from the club: talk to your chapter Secretary/);
});

test('the guide shows the day it was last changed', () => {
  assert.match(text, /Last updated \d{2}\/\d{2}\/\d{4}/);
});
