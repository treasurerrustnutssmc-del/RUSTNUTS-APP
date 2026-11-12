import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearIfOlder, dismissToast, initialToasts, pushToast, toastDuration } from './toast';

test('a new toast shows, and only the latest one is ever on screen', () => {
  let s = pushToast(initialToasts, { text: 'Saved' });
  assert.equal(s.current?.text, 'Saved');
  s = pushToast(s, { text: 'Going' });
  assert.equal(s.current?.text, 'Going', 'the newer toast replaces the older one');
});

test('each toast gets its own id, so an old timer cannot close a newer toast', () => {
  let s = pushToast(initialToasts, { text: 'one' });
  const first = s.current!.id;
  s = pushToast(s, { text: 'two' });
  assert.notEqual(s.current!.id, first);
  assert.equal(dismissToast(s, first).current?.text, 'two', 'dismissing the old id leaves the new toast');
  assert.equal(dismissToast(s, s.current!.id).current, null);
});

test('a toast with an Undo stays longer than a plain one', () => {
  assert.equal(toastDuration({ text: 'Saved' }), 3500);
  assert.equal(toastDuration({ text: 'Going', actionLabel: 'Undo', onAction: () => undefined }), 10000);
});

test('someone using a screen reader gets three times as long, so the toast is not gone before it is read', () => {
  assert.equal(toastDuration({ text: 'Saved' }, true), 3500 * 3);
  assert.equal(toastDuration({ text: 'Going', actionLabel: 'Undo', onAction: () => undefined }, true), 10000 * 3);
});


test('moving to another screen clears a toast that has been up a while, but not one just shown before a "go back"', () => {
  const s = pushToast(initialToasts, { text: 'Profile saved' }, 1000);
  assert.equal(clearIfOlder(s, 1500, 1500).current?.text, 'Profile saved', 'a save toast shown just before going back stays');
  assert.equal(clearIfOlder(s, 3000, 1500).current, null, 'an older one clears when you move on');
  assert.equal(clearIfOlder(initialToasts, 3000, 1500), initialToasts, 'nothing to clear leaves the state alone');
});
