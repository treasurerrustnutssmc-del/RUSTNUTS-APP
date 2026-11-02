# Club shop product pictures (2 Nov 2026)

Jeff: "can we fix up the in app merch store to include pictures for all the items in each tier".
Bounded work. Claude approved this design (Jeff's standing rule) and shows it to Jeff, who can veto.

## What exists
- The live catalogue (item 60): 4 designs (Member, Family, Better with you, R U OK), 74 garments, no pictures.
- The only product artwork anywhere: 9 photos in the club website's shop (`rustnutssmc/shop/*.jpg`):
  Member front/back, Family front/back, Better with you front/back (black hoodie), its Hi-Vis hoodie
  front and Hi-Vis tee back, and the R U OK front (grey tee). Nothing in the treasurer Drive or the brand folder.
  Each photo shows the design on ONE garment; there are no per-garment photos.

## Design
- `shop_pictures`: a picture belongs to a design (`garment_id` null, shown on all its garments) or one
  garment; for one colour or any (`colour` null); `front` or `back`; a file in the public `shop-pictures`
  bucket at `<design id>/<file>`. Public because the same artwork is public on the website.
- `merch_catalogue()` gives each design a `pictures` list. Old app builds ignore it (OTA-safe, no native change).
- Which picture a garment shows (`picturesFor`, src/domain/shopPictures.ts), per side: its own in the colour,
  its own for any colour, the design's in the colour, the design's for any colour. Only when none of those
  exist on either side: its own, then the design's, in another colour (with a note saying so). Another
  garment's pictures never show (no black hoodie front on the hi-vis tee).
- Members: each garment card shows the picture following the colour picked, Front/Back chips, and a note
  when it's the design pictured on another garment or in another colour. Design rows get a 56pt thumbnail.
- Shop runners: a Pictures section on each design (list, Take it out with ConfirmButton, Add a picture:
  whole design or a garment, colour or any, front or back, pick the photo; shrunk to a 2048px JPEG), and
  "Still needs a picture" (garments and colours with no picture of their colour). The catalogue rows count them.
- `add_shop_picture` / `remove_shop_picture` refuse with the domain's words; storage policies go through
  definer helpers (members can't read the shop tables). An upload in use can't be deleted from the bucket.

## Seeding
Upload the 9 website photos and record them: design-level for Member, Family, Better with you (Black),
R U OK (Grey); Hi-Vis hoodie front on that garment; Hi-Vis tee back on that garment.
