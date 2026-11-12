import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dismissToast, initialToasts, pushToast, toastDuration } from './toast';

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
