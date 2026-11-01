import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensInApp } from './inAppBrowser';
import { CLUB_LINK_GROUPS, SUPPORT_URL } from './clubLinks';

const link = (id: string) => CLUB_LINK_GROUPS.flatMap((g) => g.links).find((l) => l.id === id)!.url;

test('the club website, its shop and its support page open inside the app', () => {
  assert.equal(opensInApp(link('website')), true);
  assert.equal(opensInApp(link('shop')), true);
  assert.equal(opensInApp(SUPPORT_URL), true);
  assert.equal(opensInApp('https://rustnutssmc.com.au/'), true);
});

test("the app's own public pages and other plain websites open inside the app too", () => {
  assert.equal(opensInApp('https://treasurerrustnutssmc-del.github.io/RUSTNUTS-APP/privacy.html'), true);
  assert.equal(opensInApp('https://deadsetsafety.com.au/'), true);
  assert.equal(opensInApp('http://example.org/page'), true);
});

test('places with their own phone app still open in that app', () => {
  for (const id of ['podcast-spotify', 'podcast-youtube', 'podcast-facebook', 'podcast-instagram', 'west-facebook', 'club-instagram', 'discord-shop', 'discord']) {
    assert.equal(opensInApp(link(id)), false, id);
  }
  assert.equal(opensInApp('https://m.facebook.com/x'), false);
  assert.equal(opensInApp('https://youtu.be/abc'), false);
  assert.equal(opensInApp('https://maps.google.com/?q=Bendigo'), false);
  assert.equal(opensInApp('https://www.google.com/maps/dir/?api=1&destination=x'), false);
  assert.equal(opensInApp('https://calendar.google.com/calendar/render?action=TEMPLATE&text=Ride'), false);
  assert.equal(opensInApp('https://play.google.com/store/apps/details?id=x'), false);
  assert.equal(opensInApp('https://wa.me/61400000000'), false);
  assert.equal(opensInApp('https://www.strava.com/activities/1'), false);
});

test('only the real site counts, not a look-alike name', () => {
  assert.equal(opensInApp('https://evilfacebook.com.attacker.net/'), true);
  assert.equal(opensInApp('https://notfacebook.com/'), true);
  assert.equal(opensInApp('https://FACEBOOK.com/RustnutsSMC'), false);
});

test('phone, text, email and broken links never open the in-app browser', () => {
  assert.equal(opensInApp('tel:0400000000'), false);
  assert.equal(opensInApp('sms:0400000000'), false);
  assert.equal(opensInApp('mailto:apps@rustnutssmc.com.au'), false);
  assert.equal(opensInApp('not a url'), false);
  assert.equal(opensInApp(''), false);
});
