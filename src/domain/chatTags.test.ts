import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERYONE, insertTag, isTagged, tagParts, tagQuery, tagSuggestions } from './chatTags';

test('a tag is being typed when the message ends in @ and a word, at the start or after a space', () => {
  assert.equal(tagQuery('@'), '');
  assert.equal(tagQuery('hey @ti'), 'ti');
  assert.equal(tagQuery('hey (@Tin'), 'Tin');
  assert.equal(tagQuery('hey @tinman '), null, 'finished with a space');
  assert.equal(tagQuery('mail me at jeff@ex'), null, 'an email address');
  assert.equal(tagQuery('no tag here'), null);
  assert.equal(tagQuery(''), null);
});

const people = [
  { id: 't', name: 'Tinman' },
  { id: 'c', name: 'Cobra' },
  { id: 'b', name: 'Big Dave' },
  { id: 'd', name: 'Dave' },
];

test('the pick list offers everyone first, then names that start with what’s typed, then names with a word that does', () => {
  assert.deepEqual(tagSuggestions('', people).map((s) => s.name), [EVERYONE, 'Big Dave', 'Cobra', 'Dave', 'Tinman']);
  assert.deepEqual(tagSuggestions('ti', people).map((s) => s.name), ['Tinman']);
  assert.deepEqual(tagSuggestions('EV', people).map((s) => s.name), [EVERYONE]);
  assert.deepEqual(tagSuggestions('dav', people).map((s) => s.name), ['Dave', 'Big Dave']);
  assert.deepEqual(tagSuggestions('zz', people), []);
  assert.equal(tagSuggestions('', [...people, ...people.map((p) => ({ ...p, id: p.id + '2' }))], 4).length, 4);
});

test('picking a name swaps what’s typed for the whole tag and a space', () => {
  assert.equal(insertTag('hey @ti', 'Tinman'), 'hey @Tinman ');
  assert.equal(insertTag('@', EVERYONE), '@everyone ');
  assert.equal(insertTag('no tag', 'Tinman'), 'no tag', 'nothing being typed: unchanged');
});

test('a name is tagged by @ and the whole name, any case, not run into more letters (the same rule as the database)', () => {
  assert.equal(isTagged('@tinman you coming?', 'Tinman'), true);
  assert.equal(isTagged('Ride Sunday @TINMAN.', 'Tinman'), true);
  assert.equal(isTagged('(@Tinman)', 'Tinman'), true);
  assert.equal(isTagged('@Tinmans bike', 'Tinman'), false);
  assert.equal(isTagged('jeff@tinman.com', 'Tinman'), false);
  assert.equal(isTagged('Tinman, you coming?', 'Tinman'), false);
  assert.equal(isTagged('hey @Big Dave', 'Big Dave'), true);
  assert.equal(isTagged('hey @Big Dave', 'Dave'), false);
  assert.equal(isTagged('', 'Tinman'), false);
});

test('a message splits into words and tags for showing, longest name first', () => {
  assert.deepEqual(tagParts('hey @big dave and @Everyone!', ['Dave', 'Big Dave']), [
    { text: 'hey ' },
    { text: '@big dave', tag: 'Big Dave' },
    { text: ' and ' },
    { text: '@Everyone', tag: EVERYONE },
    { text: '!' },
  ]);
  assert.deepEqual(tagParts('no tags', ['Dave']), [{ text: 'no tags' }]);
  assert.deepEqual(tagParts('jeff@dave.com', ['Dave']), [{ text: 'jeff@dave.com' }]);
});

test('a tag typed in the middle of a message is found at the cursor, and picking it keeps the rest', () => {
  assert.equal(tagQuery('hey @ti see you', 7), 'ti');
  assert.equal(tagQuery('hey @ti see you', 15), null);
  assert.equal(insertTag('hey @ti see you', 'Tinman', 7), 'hey @Tinman see you');
  assert.equal(insertTag('hey @ti', 'Tinman', 7), 'hey @Tinman ');
});

test('letters that grow when lower-cased don’t throw the tags out of line', () => {
  assert.deepEqual(tagParts('İ @Dave hi', ['Dave']), [{ text: 'İ ' }, { text: '@Dave', tag: 'Dave' }, { text: ' hi' }]);
});
