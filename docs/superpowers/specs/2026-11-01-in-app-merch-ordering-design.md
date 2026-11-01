# Ordering members' merch inside the app (1 Nov 2026)

Self-approved by Claude under Jeff's standing rule (24 Oct 2026); Jeff can veto any ruling below.
Built on Chris's (Dysco) section 6 of the Discord bot README (dysco54/rustnuts-discord, branch
feature/merch-shop-cog) and his Make blueprint "Rustnuts Merch Order Intake" (treasurer Drive folder
"Shop automation (Make blueprints)"). Jeff answered Chris's six questions by tap on 1 Nov 2026
(11:39 to 11:43 UTC); those answers are rulings, not Claude's calls.

**Kind of work:** architectural. A new order flow, new tables, a new Edge Function and new screens,
plugged into a pipeline outside the app.

## What it's for

Members buy club gear (Member, Family, Better with you, R U OK designs on hoodies, tees and the
like). Today the members' shop is `/buy` in the Discord `#merch-shop` channel: Chris's bot takes the
order and posts it to his Make.com scenario, which logs a row in the Orders sheet, numbers the order
(RSMC#0001…), makes a pro forma invoice from a Docs template, and emails it with the club's bank
details through Resend. The member pays by bank transfer; Chris fulfils the order (supplier purchase
orders go to orders@dawnstudios.com.au through the "Rustnuts P/O" scenario). The public shop on the
website (Supporter and R U OK gear, Jotform) is separate and stays as it is.

This lets a member order the same gear from the app's Merch tab, into the **same** Make pipeline,
so Chris's side doesn't change, and records the order in the app so the treasurer can book the money
when it lands.

## Jeff's rulings (1 Nov 2026)

1. **Both routes.** The app orders alongside Discord `/buy`; both feed the same Make webhook. `/buy`
   can be retired later; nothing in Chris's bot changes now.
2. **Who orders which design:** Member = Full and Nomad; Family = Family members plus Full and Nomad;
   Better with you and R U OK = any approved member; Legacy = nothing.
3. **The price list lives in the app's database.** The people who run the shop edit it in the app.
   The bot and website may read it later (Chris's call, outside this spec).
4. **App orders go into the club's books.** The treasurer marks an order paid when the transfer
   lands and the money books as CR-005, like the app's existing merch orders. Make still logs its
   Sheets row and emails the invoice.
5. **Delivery address saved on the profile, editable** each time. The privacy policy says so.
6. **Bank transfer only for now.** Card payments are noted as a later piece that needs a payments
   account and Jeff's yes; nothing here depends on it.

Jeff also asked whether this keeps what Chris built: yes. Bot, `/buy`, Make scenarios, Sheets,
invoice template, Resend and Chris's fulfilment all stay. Only the price list moves into the app.

## What it is

**For a member (Merch tab):** a **Club shop** section above the Discord and website rows. Designs
the member may order (ruling 2) show as cards; a card opens the design with its garments, sizes,
colours and prices. Add up to 10 lines (1 to 10 each) to a cart, then **Checkout**: your name, road
name, email and mobile from your profile (editable mobile and email for this order), **Ship to me**
(street, suburb, state, postcode, Standard or Express; prefilled from your saved address, with
"Save for next time") or **Collect at the next club meeting** (no address). The cart shows the items
subtotal and, for shipping, the shipping cost from the app's shipping table, with the line "Your
invoice is the final word on the total." **Send order** sends it. Afterwards: "Order sent. Your
invoice with the club's bank details is on its way to <email>. Pay by bank transfer; the order number
on the invoice is the reference." **My orders** lists the member's app orders with status; an order
opens to its lines, delivery, total and the club's bank details (the existing How to pay block).
A member can cancel an order while it is only **Sent** (not yet paid); the cancellation is theirs to
tell Chris about (the screen says so and gives the email line), since Make has already made the
invoice.

Discord `/buy` orders don't appear in the app (they live in the Orders sheet); the Merch tab keeps
the Discord row with the line "Orders made in Discord don't show here."

**For the people who run the shop (Board screen, "Club shop" card):** the catalogue editor (designs,
garments, sizes, colours, prices, on or off sale; the shipping table by state and method), and the
**Shop orders** list: every app order with buyer, lines, delivery and status; **Mark posted** or
**Mark collected**; **Resend to Make** for a held order (see below).

**For the treasurer (same list):** **Mark paid**: the day it was paid and the amount received
(defaults to the app's total; editable, since the invoice total is Make's). That makes one CR-005
ledger line in the Club fund: "Shop order <ref>: Member hoodie (L, Black) ×1, Member tee (M) ×2 for
Dysco". Nobody marks their own order paid.

**Who runs the shop:** the national office-bearers (NEC Chair and Secretary, not the Auditor), the
sitting Presidents and Treasurers, and anyone one of them names as a **shop runner** (Chris). Shop
runners see the orders and the catalogue; only the books-keepers mark paid (the Club fund's rule:
any chapter Treasurer or the NEC Chair or Secretary).

**What the member's order carries to Make:** exactly the bot's Jotform-shaped payload (field names
`q3_name`, `q4_email`, `q11_myProducts`, `q15_phoneNumber`, `q16_deliveryMethod`, `q17_roadName`,
`q18_streetAddress`, `q19_suburb`, `q20_state`, `q21_postcode`, `q22_shippingMethod`), wrapped as the
`rawRequest` JSON string the scenario parses. `q11_myProducts.products[]` has `productName`,
`quantity`, `productOptions` (size, colour) and `totalInfo.totalSum` in dollars. Make works out
shipping from its own datastore (keyed `STATE_METHOD`) and the order number from its counter, so the
app never sets those. The app's shipping table mirrors Make's datastore so the cart can show a total;
if they drift, the invoice wins and the treasurer's "amount received" catches it.

## Rules

Rules live in `src/domain/shop.ts` with tests; the database refuses with the same words in the same
order; `supabase/tests/parity.json` gets the who-can-see-and-order cases.

**Eligibility** (`canOrderDesign(me, design)`): not signed in or not approved: the usual sign-in
problem. Legacy: `Legacy members can’t order merch.` Design eligibility `patched` and the member isn't
Full or Nomad: `That design is for Full and Nomad members.` Eligibility `family` and the member isn't
Family, Full or Nomad: `That design is for Family members and patched members.` Eligibility `any`:
fine. A design or garment that is off sale: `That isn’t on sale.`

**Cart** (`orderProblem`): no lines: `Add something first.` More than 10 lines: `Up to 10 lines an
order.` A line with qty outside 1 to 10: `Order 1 to 10 of each.` A size not on the garment: `Pick a
size.` A colour not on the garment: `Pick a colour.` (A garment with no sizes or no colours skips
that pick.) The same garment, size and colour twice: lines merge in the cart (not a refusal).

**Checkout:** name comes from the member record (not typed). Email: the member's saved email, or
one typed for this order: `That email address does not look right.` Mobile: optional, up to 30
characters: `Keep the phone number to 30 characters.` Delivery `ship`: street (1 to 120), suburb (1 to
60), state (one of the eight states and territories), postcode (four digits), method `standard` or
`express`: `Fill in the delivery address.` / `Pick a state.` / `Postcode is four digits.` Delivery
`collect`: no address needed; the payload sends `Collect at next club meeting`. Daily limit: five
orders a member a day: `That’s enough orders for one day. Try again tomorrow.`

**Idempotency:** the phone makes a `clientRef` (uuid) per cart; the same member sending the same
`clientRef` twice gets the first order back, not a second one.

**Orders:** statuses `held` (saved, Make hasn't accepted it yet), `sent` (Make accepted it),
`paid`, `posted`, `collected`, `cancelled`. Mark paid needs `sent` (`Mark it paid once it has been
sent to Make.`), a paid day not in the future and not before the order (`Pick the day it was paid.`),
an amount from $0.01 to $10,000 (`Enter the amount received.`), someone other than the buyer
(`Someone else records your own payment.`), and a books-keeper (`KEEPS_ONLY` wording from the
ledger). Mark posted / collected needs `paid` (`Mark it paid first.`) and a shop runner. Cancel: the
buyer while `held` or `sent`, or a shop runner while not `paid` or later: `That order can’t be
cancelled now.` Resend to Make: shop runner, `held` only.

**Catalogue:** shop runners add and edit designs (name 1 to 60, eligibility, blurb up to 300, sort
order, on sale), garments under a design (name 1 to 60, price $0.01 to $1,000, sizes up to 12 of 10
characters, colours up to 12 of 20 characters, on sale) and the shipping table (state × method →
cents). No two-person rule here (Claude's call: the catalogue copies prices Chris already set; Jeff
can veto). The existing board-run "club gear" (`merch_items`, Stage 5D) stays untouched for one-off
chapter gear; it keeps its own approval rule.

**Visibility:** every approved member reads the catalogue (`merch_catalogue()`); a member reads
their own orders; shop runners and books-keepers read all orders; nobody else. The saved address sits
on `member_private` (the member, their chapter board and the national office-bearers, as for email
and phone today). Family-view accounts don't see the shop (they don't see merch).

**Deleting an account:** `private.forget_member` also clears the saved address and blanks the
address and phone on that member's orders; the orders themselves stay (the books outlive the
account), as merch orders do today.

## Database

New migration (prefix assigned by the coordinator), one paste file `build/shop/in-app-shop.sql`:

- `shop_designs` (id, name, eligibility `any|patched|family`, blurb, sort, on_sale, updated_by,
  updated_at); `shop_garments` (id, design_id, name, price_cents, sizes text[], colours text[], sort,
  on_sale); `shop_shipping` (state, method, cents, primary key (state, method));
  `shop_runners` (member_id, named_by, named_on).
- `member_private` gains `street`, `suburb`, `state`, `postcode` (nullable).
- `shop_orders` (id, member_id on delete restrict, client_ref, buyer_name, road_name, email, phone,
  delivery `ship|collect`, street, suburb, state, postcode, shipping_method, subtotal_cents,
  shipping_cents, status, make_sent_at, make_error, paid_on, paid_cents, ledger_entry_id,
  handed_over_on, cancelled_at, cancelled_by, ordered_at; unique (member_id, client_ref));
  `shop_order_lines` (id, order_id, garment_id, design_name, garment_name, size, colour, qty,
  unit_cents). Names and prices are copied at order time so the history survives catalogue edits.
- RPCs: `merch_catalogue()` (designs the caller may order, with garments and the shipping table;
  returns `may_order` per design so the screen can grey out the rest), `place_shop_order(client_ref,
  lines jsonb, email, phone, delivery, address…, save_address)` (inserts `held` and returns the order
  id; it never talks to Make), `shop_order_sent(order, ok, error)` (service role only, called by the
  function), `pay_shop_order(order, paid_on, cents)`, `hand_over_shop_order(order, kind)`,
  `cancel_shop_order(order)`, `set_shop_design`, `set_shop_garment`, `set_shop_shipping`,
  `name_shop_runner` / `unname_shop_runner`, `save_delivery_address`.
- RLS mirrors the visibility rules above; private helpers `private.runs_shop()` and
  `private.may_order_design(design)`.
- `npm run test:db` cases: catalogue visible to approved only; Legacy refused; eligibility per
  status; address visibility; buyer can't mark own order paid; books-keeper only for paid; shop runner
  only for posted/collected.

## The Edge Function

`shop-order` (verify JWT on), `_shared/shopOrder.ts` holds the logic so `npm test` covers it:

1. Reads the caller from the JWT; calls `place_shop_order` as the caller (the database enforces
   every rule and the idempotency; a repeat `clientRef` returns the existing order and the function
   doesn't post again if it is already `sent`).
2. Builds the Jotform-shaped payload from the saved order (never from the request body) and POSTs it
   to `MAKE_WEBHOOK_MEMBER_URL` (an Edge Function secret Jeff pastes; the URL is readable in the Make
   scenario, and Claude may not type secrets).
3. On 2xx: `shop_order_sent(order, true)` → status `sent`. Otherwise `shop_order_sent(order, false,
   error)` → stays `held` with the error; the phone shows "We’ve kept your order; the shop will send it
   on." Fixes Chris's weak spot 1 (an order lost when Make is down).
4. Returns `{ orderId, status }`. Errors come back as the database's words.

Make's free plan allows 1,000 operations a month; one order costs about 13, the same as from the bot.

## App

- `src/domain/shop.ts` (+ tests), `src/domain/types.ts` (ShopDesign, ShopGarment, ShopOrder,
  ShopOrderLine, DeliveryAddress on MemberPrivate).
- Demo and live providers: `shopCatalogue`, `shopOrders`, actions `placeShopOrder` (demo: `sent`
  straight away), `payShopOrder`, `handOverShopOrder`, `cancelShopOrder`, `resendShopOrder`, catalogue
  edits, `saveDeliveryAddress`. Live `placeShopOrder` calls `supabase().functions.invoke('shop-order')`.
- Screens: `src/screens/shop.tsx` (Club shop section on the Merch tab, Design, Cart, Checkout, Sent,
  My orders, Order), `src/screens/shopAdmin.tsx` (catalogue editor, shipping table, shop runners,
  Shop orders). Club font on titles, names, prices, chips and buttons; body font for typed input and
  the fine print. `ConfirmButton` for cancel and mark paid. Phone size checked in demo and live.
- `PRODUCT.md`: the Merch section gains the club shop and who runs it. `DESIGN.md`: a cart line and
  a status chip if new patterns appear.
- Privacy policy (`src/domain/privacyPolicy.ts`, both copies): under "What we collect", your delivery
  address if you save one and the details of each shop order; under "Who else sees it", Make.com (runs
  the club's order automation), Google Sheets, Docs and Drive (the club's order log and invoices) and
  Resend (sends the invoice email) see the name, contact details, address and items of an order.
  Bump `PRIVACY_UPDATED_ON`.

## Seeding the catalogue

The live catalogue is loaded by a second SQL paste, `build/shop/catalogue.sql`, written from the
bot's `cogs/shop.py` (designs, garments, sizes, colours, prices) and Make's shipping datastore
(treasurer account reads both; Claude reads them in Jeff's Chrome). If any price is unclear, the
paste waits for Chris's list by email from the treasurer Gmail (Jeff presses Send).

## Build order (pieces for the coordinator to route)

1. **Rules, database, parity** (`shop.ts`, migration, paste file as the next queue item, parity
   cases). Model: Fable 5.1 (money and access rules).
2. **Edge Function `shop-order`** with `_shared/shopOrder.ts` and tests; deploy needs Jeff's
   Deploy press and the `MAKE_WEBHOOK_MEMBER_URL` secret.
3. **Member screens** (shop, cart, checkout, my orders) in demo and live; privacy policy line;
   PRODUCT.md. Opus 5.5.
4. **Shop runner and treasurer screens** (catalogue editor, shipping, runners, orders, mark paid /
   posted / collected / resend). Opus 5.5.
5. **Catalogue seed paste** and naming Chris as a shop runner (Jeff's tap, real member data).
6. Email to Chris from the treasurer Gmail: the app now orders into his Make pipeline, nothing for
   him to change, the price list lives in the app, and the optional `shop-order-status` callback if he
   wants Make to report invoiced/paid back (Chris's section 6.4; not built here).

Pieces 1 and 2 can be one PR; 3 and 4 follow once 1 is merged. Each PR gets the independent review
and the full checks (`npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`).

## Later, not here

- `shop-order-status` callback so Make can mark orders invoiced and carry the RSMC number back.
- Card payments (ruling 6: needs a payments account and Jeff's yes).
- The bot and website reading `merch_catalogue()` (Chris's call).
- The website's dead "club code word" removal (Chris said it does nothing; a website repo tidy).
