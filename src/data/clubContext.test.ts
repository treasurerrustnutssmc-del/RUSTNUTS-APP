import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateApplicationBike, validateBike } from './clubContext';

const TODAY = '2026-10-24';
const bike = (make: string, model: string, year: number | null) => ({
  id: null, make, model, year, nickname: null, isProject: false,
});
const ok = (problem: string | null) => problem === null;

test('a bike needs a make and a model', () => {
  assert.equal(ok(validateBike(bike('', 'Street Bob', 2019), TODAY)), false);
  assert.equal(ok(validateBike(bike('Harley-Davidson', ' ', 2019), TODAY)), false);
  assert.equal(ok(validateBike(bike('Harley-Davidson', 'Street Bob', null), TODAY)), true);
});

test('a bike year runs from 1885 to next year', () => {
  assert.equal(ok(validateBike(bike('Benz', 'Patent', 1884), TODAY)), false);
  assert.equal(ok(validateBike(bike('Benz', 'Patent', 1885), TODAY)), true);
  assert.equal(ok(validateBike(bike('Harley-Davidson', 'Breakout', 2027), TODAY)), true);
  assert.equal(ok(validateBike(bike('Harley-Davidson', 'Breakout', 2028), TODAY)), false);
});

test('the join form takes a whole bike or none at all', () => {
  assert.equal(ok(validateApplicationBike(null, TODAY)), true);
  assert.equal(ok(validateApplicationBike({ make: ' ', model: '', year: null }, TODAY)), true);
  assert.equal(ok(validateApplicationBike({ make: 'Triumph', model: '', year: null }, TODAY)), false);
  assert.equal(ok(validateApplicationBike({ make: '', model: 'Bonneville', year: 2020 }, TODAY)), false);
  assert.equal(ok(validateApplicationBike({ make: 'Triumph', model: 'Bonneville', year: 9999 }, TODAY)), false);
  assert.equal(ok(validateApplicationBike({ make: 'Triumph', model: 'Bonneville', year: 2020 }, TODAY)), true);
});

test('a year on its own, with no make or model, is flagged rather than dropped', () => {
  assert.equal(ok(validateApplicationBike({ make: '', model: '', year: 2019 }, TODAY)), false);
});
