// The member welcome guide (site/guide.html) is the page every invite links to. It is written by
// hand, so it drifts: on 14 Nov 2026 it still said five tabs (Merch made six on 1 Nov), told members
// to sign the Road Rules "if the app asks" and gave the Rides path only for an RSVP. These checks tie
// what the page says to the names the app itself shows, so the next rename fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('the guide counts the tabs a member has and gives Merch its own row', () => {
  const where = section('where-things-are');
  assert.match(where, /Six tabs run along the bottom/);
  assert.match(where, /Board members get a seventh, Board/);
  assert.doesNotMatch(text, /Five tabs/);
  const rows = [...html.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['Home', 'Chat', 'Rides', 'Members', 'Merch', 'Me']);
  assert.match(where, /Club shop/);
});

test('the Me row names every group Me folds into, by the title the app shows', () => {
  const where = section('where-things-are');
  for (const g of groups) assert.ok(where.includes(g.title), `the Me row should name "${g.title}"`);
  assert.match(where, /Sign out is at the bottom/);
});

test('the Rides row sends members to Ride tools and explains the ride colours', () => {
  const where = section('where-things-are');
  assert.ok(where.includes(`Open ${RIDE_TOOLS.title} for the route library`), 'names the Ride tools group');
  assert.match(where, /Show my usual/);
});

test('family members are told their app is smaller', () => {
  assert.match(section('where-things-are'), /Family accounts get a smaller app: four tabs \(Home, Chat, Rides and Me\)/);
});

test('signing in covers the rules screen and the notifications card', () => {
  const signIn = section('sign-in');
  assert.ok(signIn.includes(`the app shows the ${POSTING_RULES_TITLE}`), 'names the rules screen');
  assert.match(signIn, /tap I agree/);
  assert.ok(signIn.includes(`a card called ${NOTIFY_INTRO.title}, tap ${NOTIFY_INTRO.turnOn}`), 'names the notifications card');
  assert.doesNotMatch(signIn, /When the app asks to send you notifications/);
  assert.match(signIn, /at the end of a three-step form/);
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
  assert.ok(first.includes(`on Home, tap ${RSVP_LABEL.going}, ${RSVP_LABEL.maybe} or Can’t go under Next ride`), 'RSVP from Home');
  assert.match(first, /If anything is owing, pay by PayID or bank transfer/);
  assert.match(first, /tap I’ve paid this, check the amount and tap Tell the treasurer/);
});

test('on ride day the guide covers iPhones as well as Android', () => {
  assert.match(section('on-ride-day'), /On an iPhone, allowing it while you use the app is enough/);
});

test('help and privacy name the help group, the full list of services and what deleting does not do', () => {
  const help = section('help');
  assert.ok(help.includes(`Me › ${group('help')} has Club words, Show the quick tour again, Feedback and issues`));
  assert.match(help, /lists every outside service the app uses and what each one gets/);
  assert.doesNotMatch(help, /Google, GIPHY and the club website/);
  assert.ok(help.includes(`Me › ${group('settings')} › Share my mobile with members`));
  assert.match(help, /isn’t resigning from the club: talk to your chapter Secretary/);
});

test('the guide shows the day it was last changed', () => {
  assert.match(text, /Last updated 14\/11\/2026/);
});
