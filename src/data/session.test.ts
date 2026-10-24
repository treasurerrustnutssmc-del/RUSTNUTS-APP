import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshError, sessionView } from './session';

const view = (
  userId: string | null,
  loadedFor: string | null,
  loadError: string | null,
  hasMe: boolean,
  justApplied = false,
) => sessionView({ userId, loadedFor, loadError, hasMe, justApplied });

test('nobody signed in', () => {
  assert.equal(view(null, null, null, false), 'signed-out');
  assert.equal(view(null, null, 'No connection', false), 'signed-out');
});

test('signed in but the club data has not arrived yet is loading, not "ask to join"', () => {
  assert.equal(view('u1', null, null, false), 'loading');
  // data still belongs to whoever was signed in before
  assert.equal(view('u1', 'u0', null, false), 'loading');
});

test('loaded for this person with no member record means they still need to apply', () => {
  assert.equal(view('u1', 'u1', null, false), 'needs-application');
});

test('a member whose data loaded is ready', () => {
  assert.equal(view('u1', 'u1', null, true), 'ready');
  // a later refresh failing keeps the data on screen
  assert.equal(view('u1', 'u1', 'No connection', true), 'ready');
});

test('a failed first load is an error with a way to retry, never the join form', () => {
  assert.equal(view('u1', null, 'No connection', false), 'error');
  assert.equal(view('u1', 'u0', 'No connection', false), 'error');
});

test('a reload that fails right after applying shows Try again, not the join form again', () => {
  assert.equal(view('u1', 'u1', 'No connection', false, true), 'error');
});

test('a refresh that fails while someone is still filling in the join form keeps the form', () => {
  assert.equal(view('u1', 'u1', 'No connection', false, false), 'needs-application');
});

test('a failed refresh while data is on screen is reported as a small notice, not hidden', () => {
  assert.equal(refreshError('ready', 'No connection.'), 'No connection.');
  assert.equal(refreshError('needs-application', 'No connection.'), 'No connection.');
  assert.equal(refreshError('error', 'No connection.'), null); // the full error screen covers it
  assert.equal(refreshError('ready', null), null);
});
