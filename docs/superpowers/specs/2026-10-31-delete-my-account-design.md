# Delete my account: design

31/10/2026. Architectural (schema change to `members`, a trigger on `auth.users`). Claude approves its own specs since 24 Oct; Jeff can veto.

## Why

Apple (5.1.1(v)) and Google Play both require that anyone who can make an account in the app can delete it from inside the app, and Play also wants a web page where people can ask for deletion without the app. Today Me has only Sign out.

## What the member sees

- Me, at the bottom under Sign out: a quiet **Delete my account** row. It opens a **Delete account** screen.
- The screen says plainly, in three short lists:
  - **Deleted now:** your sign-in, contact details, licence and first aid dates, emergency contacts, bikes and regos, chat messages and reactions, ride sign-ups, crew spots, ratings, swap and sell listings, build threads, skills, birthday, notification settings and phones.
  - **Kept by the club, without your name:** fees, payments and anything in the club's books; meeting minutes, votes and action items; attendance, status changes, 5.5 notices and conduct records; past board seats. These show as "Former member". Associations have to keep their books and minutes.
  - **Not changed:** your club membership. Deleting the app account isn't resigning: talk to your chapter secretary for that. The board's own member register (the sheet) isn't touched.
- A `ConfirmButton` "Delete my account" / "Yes, delete it for good" (no `Alert`, house rule). Then the app signs out to the welcome screen.
- If the member holds a board or national seat, the button is replaced by a notice: "Step down from your seat first, so the club can fill it. Then you can delete your account." (the step-down buttons already exist). Non-seat roles (Tail Gunner, officer, coach, social media) just end on the day.

## How it works in the database

- `public.delete_my_account()` (security definer, authenticated only): refuses when not signed in, refuses for a sitting board or national seat holder with the same message as the app, then `delete from auth.users where id = auth.uid()`.
- An `after delete` trigger on `auth.users` runs `private.forget_member(id)`, so deleting a user from the Supabase dashboard (how the board handles a web request) does exactly the same thing. From the dashboard a seat holder isn't refused; their open positions just end that day.
- `private.forget_member`:
  - deletes the personal and social rows listed above, including bragging rights nominations, but keeps any chat message someone has reported (with the report) for the board;
  - clears the phone, emergency contact, bike and seats from their `private.roster` row (matched by `claimed_by` or the sign-in email), so coming back with the same email restores their status but no seat or old details;
  - ends any open positions on the club's date (`private.club_date()`), and deletes ones that hadn't started;
  - turns the `members` row into a tombstone: `full_name = 'Former member'`, road name, bio and phone sharing cleared, `approval = 'declined'` (so it drops out of the directory, approvals, counts and every member check), `on_hiatus = false`, and a new `account_deleted_on` date. Same id, so every kept record still joins.
- `members.id` no longer has a foreign key to `auth.users` (it was `on delete cascade`, which either wiped club records with the member or, where the books hold `restrict`, blocked the delete outright). Nothing else relied on it: every insert into `members` takes `auth.uid()`.
- `private.roster.claimed_by` is already `on delete set null`, so the roster place is free to claim again if they come back with the same email.
- A login stays valid for up to an hour after deletion (another phone). Triggers refuse any update of a forgotten member row and any insert or update of their private details, bikes, emergency contacts, push devices, notification settings, birthday and skills, so it can't put anything back.
- Files (chat, swap, build and brag photos): Supabase doesn't allow deleting storage files from SQL. Once the rows that point at them are gone nobody can read them (each bucket's read rule checks those rows). The bytes are cleared later from the dashboard; the query to find them is in the web page notes.

## The web page (Play)

`site/delete-account.html`: a plain page saying how to delete in the app, and that anyone without the app can email apps@rustnutssmc.com.au from the address they signed in with; the board deletes the user in Supabase within 30 days, which runs the same trigger. It lists what's deleted and what's kept. Chris hosts it on the club website next to the privacy policy, and its address goes in the Play listing.

## Demo build

`deleteMyAccount` in the demo does the same to the made-up club (tombstone, personal rows gone, signed out), with the same seat refusal.

## Tests

- `src/domain/account.test.ts`: who's refused (board seat, national seat), who isn't (Tail Gunner, ended seat).
- `src/data/demoAccount.test.ts`: the demo tombstones the member and removes their personal rows, and keeps their charges.
- `supabase/tests/account_deletion_test.sql`: signed out refused; seat holder refused with the shared message; a member with charges, attendance, a vote ballot, a chat message, a bike and private details deletes: auth row gone, member row is "Former member" and declined, personal rows gone, charges/attendance/ballot still there; a dashboard delete of a seat holder ends the seat; `members_money_test.sql`'s old "can't delete a member with charges" check becomes "the charges outlive the account".

## Not doing

- No grace period or undo. Deletion is immediate (both stores accept that) and the confirm step says "for good".
- No scrubbing of names typed into free text (minutes, ledger payee names, chat quotes by others).
