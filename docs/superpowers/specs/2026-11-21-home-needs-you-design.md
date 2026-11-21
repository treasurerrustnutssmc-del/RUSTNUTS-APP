# Home: approvals first, reminders last (21 Nov 2026)

**Why.** Jeff, 21 Nov 2026: "if there is anything that someone needs to approve it should be the
first thing they see when they open the app", then "Approvals top regos bottom". Bounded work:
one new domain rule and a re-ordered Home screen. No database change, no native change (ships by OTA).

## The new Home order

1. Greeting (Flannel)
2. **Needs you** (`HomeNeedsYouCard`, red border, count in the corner). Hidden when empty.
3. Cover panels, first-run card
4. Next ride (one-tap Going / Maybe / Can't go, as before)
5. Today's check-in
6. **Quick buttons** (`HomeQuickActions`): My fees, Rusty Bus, Documents, Tell us. Only jobs that
   aren't already a tab, so the tab bar isn't repeated.
7. Road Rules row, Club business row
8. Shout-outs, On this day, Club news, Ask the club, profile card, The club in numbers
9. **Reminders** (`HomeReminders`): your own rego, licence and first aid boxes (tap to update), and
   for board members the chapter's renewals row (opens Board at the alerts list). Very bottom.

## Needs you (`src/domain/homeNeedsYou.ts`)

Approvals first (red icon), each opening where it's dealt with: people waiting to join, acting or
cover requests with a step for you, Rusty Bus bookings, payments to check, book entries, shop and
merch orders, national contributions, Auditor questions, overdue FNG reviews. Then what's waiting on
you personally: votes, a board notice to answer, the Road Rules to sign, fees owing.

Rego, licence and first aid are never in it. The old Fees card and the inline Board card are gone
from Home: both now live as Needs you rows, so nothing shows twice.

Left out of v1 (stay on the Board tab, which still shows its own list): chat reports, enquiries and
feedback, because they load separately from the club data.

## Tests

`src/domain/homeNeedsYou.test.ts` (rules), `src/screens/homeOrder.test.ts` (Home order);
`actingTitles`, `boardOrder` and `homeRowLines` source tests follow the code into `homeCards.tsx`.
