# Fees by club year (AGM to AGM), with pro rata for patch-ins

Status: approved by Claude 25 Oct 2026 (Jeff can veto). Architectural: it changes what the fee year means in the app and the database.

## What Jeff said (25 Oct 2026)

"fee amounts are 360 for the full year and prorata agm to agm if patched in an incomplete year"

## What the constitution says (v4, 25 Oct 2026)

- Club Year: "From the close of one Association AGM to the close of the next". The Financial Year (1 July to 30 June) stays for the books.
- The statutory AGM is "intended to be held in August after the Financial Year" (10.3), so its date moves a little each year.
- The FNG continuation fee is 50% of the applicable annual fee, charged once (4.11). That is already built.

## Design

**Fees run by club year.** The treasurer's books (ledger, openings, cash float, budgets) stay on the financial year and are not touched.

- A new table `agms (year int primary key, held_on date)` keeps the date of each year's AGM. The National Chairman or Secretary records it with `record_agm(held_on)`, and recording again for the same year replaces it. Approved members can read it.
- Until an AGM is recorded for a year, the app assumes it falls on **1 August**.
- Club year *N* runs from the AGM in *N* to the AGM in *N+1*, and is labelled "2026–27".
- `fee_rates.fy` and `charges.fy` (and receipt numbers, W26-0001) now mean the club year. The columns keep their names. Live has no rates or charges yet, so nothing needs converting.
- The yearly check-in count ("Turned up") also counts by club year, since the constitution measures attendance by club year.

**Pro rata.** A Full member patched after the club year started pays for the whole months left, counting the month they were patched, up to the month of the next AGM: `amount × months / 12`, rounded to the nearest dollar. For example, someone patched in October with the AGM in August pays for 10 of 12 months, so $360 becomes $300. Someone patched in the AGM's own month, after the AGM, pays the full year.

- The next AGM is the one recorded, otherwise 1 August.
- Only Full members are pro rata, because Jeff's rule is about being patched in. Other statuses pay the full rate if they have one.
- **Raise fees** charges pro rata to anyone already patched after the year started. Being patched in later (by an FNG review, a status change or an NEC reinstatement) adds the pro rata charge automatically, if that year's Full fee is set and they have no fee charge for that year yet. In the database this is one trigger on `members` (status changes to Full from anything other than Full or Nomad), so every route is covered.
- A pro rata charge has a description such as "Pro rata, 10 of 12 months", and the fees screens show it.

**Screens.** "Fees 2026–27" replaces "FY26–27" on the fees and check-in screens. The chapter fees screen gains an AGM line, "This club year started at the AGM on 01/08/2026 (assumed)", and the National Chairman or Secretary can record the real date there.

**Live data (after merge, with Jeff's yes, which he gave):** Full $360 for 2026–27 for every chapter, due 31/12/2026, until Jeff says otherwise. No other status gets a rate, so the continuation fee is $0 until there is an FNG fee. Charges are not raised until the treasurer presses Raise fees.

## Testing

- Domain (node:test): clubYearOf on, before and after a recorded AGM and the 1 August default; label; proRataCents (Oct to Aug = 10/12 → $300; patched on the AGM day = full; AGM month after the AGM = full; rounding to the dollar; patched before the year = full).
- Demo actions: raise fees pro rata; patch-in adds a charge once; no charge without a Full rate; on hiatus pays nothing.
- Database (members_money_test, parity): the same, plus record_agm is NEC Chair/Secretary only, the trigger fires once, and receipts use the club year.
