// Jeff, 21 Nov 2026: "anything that can be a clickable should be easy to find .. not listed and hidden
// behind other options". Every folded group on Me, the Board, Members, Rides and the public screen starts
// open, so each button can be seen without opening anything first. A group can still be folded by hand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('Me and the Board show every group open unless the person folds it', () => {
  for (const f of ['me.tsx', 'board.tsx']) {
    const src = read(f);
    assert.ok(src.includes('const isOpen = chosen[g.id] ?? true;'), `${f}: groups start open`);
    assert.ok(!src.includes('chosen[g.id] ?? false'), `${f}: nothing starts folded`);
  }
});

test('Members, Rides and the public screen show their extra links without a tap', () => {
  // Members' extras aren't folded at all now: one card under the member list (21 Nov 2026).
  assert.ok(!read('members.tsx').includes('<Disclosure title={MORE_FROM_CLUB.title}'), 'More from the club is not a fold');
  assert.ok(read('rides.tsx').includes('const [toolsOpen, setToolsOpen] = useState(true);'), 'Ride tools');
  assert.ok(read('public.tsx').includes('const [linksOpen, setLinksOpen] = useState(true);'), 'Find the club online');
});
