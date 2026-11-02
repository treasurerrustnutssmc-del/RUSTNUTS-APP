import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNS_SHOP_ONLY } from './shop';
import {
  MAX_PICTURES, NO_PICTURE, PICK_ITS_COLOUR, PICK_SIDE, TOO_MANY_PICTURES, UPLOAD_FIRST,
  addShopPictureProblem, pictureGaps, picturesFor, removeShopPictureProblem, shopPicturePath,
} from './shopPictures';
import { club, member } from './stage4.testkit';
import type { ClubData, ShopDesign, ShopGarment, ShopPicture } from './types';

const AT = '2026-10-20T00:00:00.000Z';
const design = (id: string, over: Partial<ShopDesign> = {}): ShopDesign => ({
  id, name: id, eligibility: 'any', blurb: '', sort: 0, onSale: true, updatedBy: null, updatedAt: AT, ...over,
});
const garment = (id: string, designId: string, over: Partial<ShopGarment> = {}): ShopGarment => ({
  id, designId, name: `${id} garment`, priceCents: 4500, sizes: ['M'], colours: ['Black', 'Grey'], sort: 0, onSale: true, ...over,
});
let n = 0;
const pic = (designId: string, over: Partial<ShopPicture> = {}): ShopPicture => ({
  id: `p${++n}`, designId, garmentId: null, colour: null, side: 'front', path: `${designId}/p${n}.jpg`, url: `https://x/${designId}/p${n}.jpg`,
  sort: n, ...over,
});

const data = (pictures: ShopPicture[], over: Partial<ClubData> = {}): ClubData => {
  const base = club();
  return {
    ...base,
    members: [
      ...base.members,
      member('pres'),
      member('rider'),
    ],
    positions: [...base.positions, { id: 'p-pres', memberId: 'pres', chapterId: 'west', role: 'president', startedOn: '2025-01-01', endedOn: null }],
    shopDesigns: [design('better'), design('ruok')],
    shopGarments: [
      garment('tee', 'better'),
      garment('hivis', 'better', { colours: ['Hi-Vis'] }),
      garment('cap', 'better', { colours: [] }),
      garment('old', 'better', { onSale: false }),
      garment('ruok-tee', 'ruok'),
    ],
    shopPictures: pictures,
    ...over,
  };
};
const who = (d: ClubData, id: string) => d.members.find((m) => m.id === id)!;
const g = (d: ClubData, id: string) => d.shopGarments!.find((x) => x.id === id)!;
const ids = (ps: ShopPicture[]) => ps.map((p) => p.id);

test('a garment shows its own picture in its colour before the design’s', () => {
  const own = pic('better', { garmentId: 'tee', colour: 'Grey' });
  const ownAny = pic('better', { garmentId: 'tee' });
  const designGrey = pic('better', { colour: 'Grey' });
  const designAny = pic('better');
  const d = data([designAny, designGrey, ownAny, own]);
  const r = picturesFor(d, g(d, 'tee'), 'Grey');
  assert.deepEqual(ids(r.pictures), [own.id]);
  assert.equal(r.ofThisGarment, true);
  assert.equal(r.ofThisColour, true);
  assert.deepEqual(ids(picturesFor(data([designAny, designGrey, ownAny]), g(d, 'tee'), 'Grey').pictures), [ownAny.id]);
  assert.deepEqual(ids(picturesFor(data([designAny, designGrey]), g(d, 'tee'), 'Grey').pictures), [designGrey.id]);
  const designOnly = picturesFor(data([designAny]), g(d, 'tee'), 'Grey');
  assert.deepEqual(ids(designOnly.pictures), [designAny.id]);
  assert.equal(designOnly.ofThisGarment, false);
  assert.equal(designOnly.ofThisColour, true, 'a picture with no colour fits every colour');
});

test('front and back are picked side by side, front first', () => {
  const back = pic('better', { side: 'back', colour: 'Black' });
  const front = pic('better', { side: 'front', colour: 'Black' });
  const ownBack = pic('better', { garmentId: 'tee', side: 'back' });
  const d = data([back, front, ownBack]);
  assert.deepEqual(ids(picturesFor(d, g(d, 'tee'), 'Black').pictures), [front.id, ownBack.id]);
});

test('another colour shows only when the right colour has nothing at all', () => {
  const black = pic('better', { colour: 'Black' });
  const blackBack = pic('better', { colour: 'Black', side: 'back' });
  const hivisBack = pic('better', { garmentId: 'hivis', colour: 'Hi-Vis', side: 'back' });
  const d = data([black, blackBack, hivisBack]);
  const hivis = picturesFor(d, g(d, 'hivis'), 'Hi-Vis');
  assert.deepEqual(ids(hivis.pictures), [hivisBack.id], 'never a black front on a hi-vis tee');
  const grey = picturesFor(d, g(d, 'tee'), 'Grey');
  assert.deepEqual(ids(grey.pictures), [black.id, blackBack.id]);
  assert.equal(grey.ofThisColour, false);
});

test('no colour picked yet means the first colour; a garment without colours takes colourless pictures', () => {
  const black = pic('better', { colour: 'Black' });
  const grey = pic('better', { colour: 'Grey' });
  const plain = pic('better');
  const d = data([grey, black, plain]);
  assert.deepEqual(ids(picturesFor(d, g(d, 'tee'), null).pictures), [black.id]);
  assert.deepEqual(ids(picturesFor(d, g(d, 'cap'), null).pictures), [plain.id]);
  assert.deepEqual(picturesFor(data([]), g(d, 'cap'), null).pictures, []);
});

test('another garment’s pictures never show', () => {
  const hivis = pic('better', { garmentId: 'hivis', colour: 'Hi-Vis' });
  const d = data([hivis]);
  assert.deepEqual(picturesFor(d, g(d, 'tee'), 'Black').pictures, []);
});

test('the gaps: every garment and colour on sale with no picture of its colour', () => {
  const black = pic('better', { colour: 'Black' });
  const hivis = pic('better', { garmentId: 'hivis', colour: 'Hi-Vis', side: 'back' });
  const plain = pic('better', { garmentId: 'cap' });
  const d = data([black, hivis, plain], { shopDesigns: [design('better'), design('ruok'), design('gone', { onSale: false })] });
  const gaps = pictureGaps(d).map((x) => `${x.design.id} ${x.garment.id} ${x.colour ?? '-'} ${x.missing}`);
  assert.deepEqual(gaps, [
    'better tee Grey colour',
    'ruok ruok-tee Black none',
    'ruok ruok-tee Grey none',
  ]);
});

test('adding a picture: the shop runs it, to a real design, garment and colour', () => {
  const d = data([]);
  const input = { designId: 'better', garmentId: 'tee', colour: 'Grey', side: 'front' as const, path: 'better/new.jpg' };
  assert.equal(addShopPictureProblem(who(d, 'pres'), input, d), null);
  assert.equal(addShopPictureProblem(who(d, 'rider'), input, d), RUNS_SHOP_ONLY);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, designId: 'nope', path: 'nope/new.jpg' }, d), 'No such design.');
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, garmentId: 'ruok-tee' }, d), 'No such garment.');
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, colour: 'Hi-Vis' }, d), PICK_ITS_COLOUR);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, garmentId: null, colour: 'Hi-Vis' }, d), null, 'any colour the design comes in');
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, garmentId: null, colour: 'Pink' }, d), PICK_ITS_COLOUR);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, colour: null }, d), null);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, side: 'left' as never }, d), PICK_SIDE);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, path: 'ruok/new.jpg' }, d), UPLOAD_FIRST);
  assert.equal(addShopPictureProblem(who(d, 'pres'), { ...input, path: '' }, d), UPLOAD_FIRST);
  const full = data(Array.from({ length: MAX_PICTURES }, () => pic('better')));
  assert.equal(addShopPictureProblem(who(full, 'pres'), input, full), TOO_MANY_PICTURES);
});

test('removing a picture', () => {
  const p = pic('better');
  const d = data([p]);
  assert.equal(removeShopPictureProblem(who(d, 'pres'), p.id, d), null);
  assert.equal(removeShopPictureProblem(who(d, 'rider'), p.id, d), RUNS_SHOP_ONLY);
  assert.equal(removeShopPictureProblem(who(d, 'pres'), 'nope', d), NO_PICTURE);
});

test('an upload goes in the design’s own folder', () => {
  assert.match(shopPicturePath('d1', 'abc'), /^d1\/abc\.jpg$/);
});
