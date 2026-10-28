import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveBike } from './demoActions';
import { DEMO_DATA as demoData } from './demoData';

test('saving a bike in the demo keeps its range (save_bike leaves range_km alone)', () => {
  const me = demoData.members.find((m) => m.id === 'm-spanner')!;
  const bike = demoData.bikes.find((b) => b.id === 'b-6')!;
  assert.equal(bike.rangeKm, 230);
  const { data } = saveBike(
    { data: demoData, me, today: '2026-10-28' },
    { id: 'b-6', make: bike.make, model: 'Softail Slim S', year: bike.year, nickname: bike.nickname, isProject: false },
    { rego: null, regoExpiry: null },
  );
  const saved = data.bikes.find((b) => b.id === 'b-6')!;
  assert.equal(saved.model, 'Softail Slim S');
  assert.equal(saved.rangeKm, 230);
});
