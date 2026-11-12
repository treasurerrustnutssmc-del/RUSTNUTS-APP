import assert from 'node:assert/strict';
import { test } from 'node:test';
import { garmentsLine } from './shopLayout';

test('a few garments are named in full', () => {
  assert.equal(garmentsLine(['Hoodie']), 'Hoodie');
  assert.equal(garmentsLine(['Hoodie', 'Tee']), 'Hoodie and Tee');
  assert.equal(garmentsLine(['Hoodie', 'Tee', 'Cap']), 'Hoodie, Tee and Cap');
});

test('a long list shows three names and how many more, not all of them', () => {
  const names = ['Classic Tee', 'Low Down Singlet', 'Made Hood', 'Made Crew', 'Stencil Hood', 'Zip Hood', 'Stencil Crew', 'Heavy Tee', 'Classic L/S Tee', 'Barnard Tank', 'Womens Classic Tee', 'Womens Classic L/S Tee'];
  assert.equal(garmentsLine(names), 'Classic Tee, Low Down Singlet, Made Hood and 9 more');
  assert.equal(garmentsLine(['A', 'B', 'C', 'D']), 'A, B, C and 1 more');
});

test('no garments gives an empty line', () => {
  assert.equal(garmentsLine([]), '');
});
