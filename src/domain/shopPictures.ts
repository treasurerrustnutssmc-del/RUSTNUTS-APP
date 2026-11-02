// Product pictures in the club shop: which picture a garment shows in the colour picked, which
// garments and colours still have none of their own colour, and the rules for adding and removing
// one. The database refuses with the same words, in the same order
// (supabase/migrations/20270780000000_shop_pictures.sql). Spec:
// docs/superpowers/specs/2026-11-02-shop-pictures-design.md.

import { RUNS_SHOP_ONLY, NO_DESIGN, NO_GARMENT, runsShop, signedInProblem } from './shop';
import type { ClubData, Member, ShopDesign, ShopGarment, ShopPicture, ShopPictureSide } from './types';

export const MAX_PICTURES = 40;
export const SIDES: ShopPictureSide[] = ['front', 'back'];
export const SIDE_LABEL: Record<ShopPictureSide, string> = { front: 'Front', back: 'Back' };

export const PICK_ITS_COLOUR = 'Pick one of its colours, or any colour.';
export const PICK_SIDE = 'Pick front or back.';
export const UPLOAD_FIRST = 'Upload the picture first.';
export const TOO_MANY_PICTURES = 'Up to 40 pictures a design.';
export const NO_PICTURE = 'No such picture.';

/** What the shop runner picks for a new picture. */
export interface PictureInput {
  designId: string;
  garmentId: string | null;
  colour: string | null;
  side: ShopPictureSide;
}

export interface AddPictureInput extends PictureInput {
  /** Where the upload went: `<design id>/<file>`. */
  path: string;
}

export interface GarmentPictures {
  /** Front first, then back. Empty when there's nothing to show. */
  pictures: ShopPicture[];
  /** Every picture is of this garment, not the design shown on another one. */
  ofThisGarment: boolean;
  /** Every picture is this colour (or fits any colour). */
  ofThisColour: boolean;
}

const bySort = (a: ShopPicture, b: ShopPicture) => a.sort - b.sort || a.id.localeCompare(b.id);

/**
 * The pictures a garment shows in a colour (none picked yet: its first colour). For each side the
 * best there is: its own picture in that colour, its own for any colour, the design's in that
 * colour, the design's for any colour. Only when none of those exist on either side does it fall
 * back to its own, then the design's, in another colour. Another garment's pictures never show.
 */
export function picturesFor(data: ClubData, garment: ShopGarment, colour: string | null): GarmentPictures {
  const want = colour ?? garment.colours[0] ?? null;
  const mine = (data.shopPictures ?? []).filter(
    (p) => p.designId === garment.designId && (p.garmentId === null || p.garmentId === garment.id),
  );
  const own = (p: ShopPicture) => p.garmentId === garment.id;
  const right: ((p: ShopPicture) => boolean)[] = [
    (p) => own(p) && want !== null && p.colour === want,
    (p) => own(p) && p.colour === null,
    (p) => !own(p) && want !== null && p.colour === want,
    (p) => !own(p) && p.colour === null,
  ];
  const other: ((p: ShopPicture) => boolean)[] = [
    (p) => own(p) && p.colour !== null && p.colour !== want,
    (p) => !own(p) && p.colour !== null && p.colour !== want,
  ];
  const pick = (tiers: ((p: ShopPicture) => boolean)[]) =>
    SIDES.flatMap((side) => {
      const ofSide = mine.filter((p) => p.side === side);
      for (const tier of tiers) {
        const found = ofSide.filter(tier);
        if (found.length) {
          // In another colour, keep to the one colour that matched first.
          const first = found.sort(bySort)[0];
          return found.filter((p) => p.colour === first.colour && p.garmentId === first.garmentId);
        }
      }
      return [];
    });
  let pictures = pick(right);
  const ofThisColour = pictures.length > 0;
  if (!ofThisColour) pictures = pick(other);
  return {
    pictures,
    ofThisGarment: pictures.length > 0 && pictures.every(own),
    ofThisColour: ofThisColour || pictures.length === 0,
  };
}

export interface PictureGap {
  design: ShopDesign;
  garment: ShopGarment;
  colour: string | null;
  /** `none`: nothing to show at all. `colour`: only a picture in another colour. */
  missing: 'none' | 'colour';
}

/** Each garment and colour on sale that shows no picture of its own colour, in shop order. */
export function pictureGaps(data: ClubData): PictureGap[] {
  const designs = (data.shopDesigns ?? []).filter((d) => d.onSale).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return designs.flatMap((design) =>
    (data.shopGarments ?? [])
      .filter((g) => g.designId === design.id && g.onSale)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .flatMap((garment) =>
        (garment.colours.length ? garment.colours : [null]).flatMap((colour): PictureGap[] => {
          const r = picturesFor(data, garment, colour);
          if (r.pictures.length === 0) return [{ design, garment, colour, missing: 'none' }];
          return r.ofThisColour ? [] : [{ design, garment, colour, missing: 'colour' }];
        }),
      ),
  );
}

/** Where a new upload goes: the design's own folder. */
export const shopPicturePath = (designId: string, fileId: string) => `${designId}/${fileId}.jpg`;

function runsShopProblem(me: Member | null, data: ClubData): string | null {
  return signedInProblem(me) ?? (runsShop(me, data) ? null : RUNS_SHOP_ONLY);
}

export function addShopPictureProblem(me: Member | null, input: AddPictureInput, data: ClubData): string | null {
  const runs = runsShopProblem(me, data);
  if (runs) return runs;
  if (!(data.shopDesigns ?? []).some((d) => d.id === input.designId)) return NO_DESIGN;
  const garments = (data.shopGarments ?? []).filter((g) => g.designId === input.designId);
  const garment = input.garmentId === null ? null : garments.find((g) => g.id === input.garmentId);
  if (garment === undefined) return NO_GARMENT;
  if (input.colour !== null) {
    const colours = garment ? garment.colours : garments.flatMap((g) => g.colours);
    if (!colours.includes(input.colour)) return PICK_ITS_COLOUR;
  }
  if (!SIDES.includes(input.side)) return PICK_SIDE;
  if (!input.path.startsWith(`${input.designId}/`) || input.path.length <= input.designId.length + 1) return UPLOAD_FIRST;
  if ((data.shopPictures ?? []).filter((p) => p.designId === input.designId).length >= MAX_PICTURES) return TOO_MANY_PICTURES;
  return null;
}

export function removeShopPictureProblem(me: Member | null, id: string, data: ClubData): string | null {
  const runs = runsShopProblem(me, data);
  if (runs) return runs;
  return (data.shopPictures ?? []).some((p) => p.id === id) ? null : NO_PICTURE;
}
