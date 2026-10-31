# Member content rules (App Store Guideline 1.2): design

31/10/2026. Architectural (a new table, a new `members` column, six posting functions redefined, a
new gate screen, a new board action). Claude approves its own specs since 24 Oct; Jeff can veto.

## Why

Apple's App Review Guideline 1.2 asks every app with content members post to have: terms members
agree to that say there is no tolerance for objectionable content or abusive members; a way to
filter such content; a way to report it, with a response within 24 hours; a way to block abusive
members; and published contact details. The 31/10/2026 iOS readiness audit
(`/mnt/project-files/build/ios/ugc-findings.md`) found the app has Report on chat messages only,
Block only on a member's screen, no terms, and no way to cut a member's access in one step. The
app's category is Social Networking with user content and messaging answered Yes, so a reviewer
will look for all of it.

## What changes

### 1. Club rules for chats and posts (the terms)

- The text lives in `src/domain/postingRules.ts`, like the privacy policy: a short intro and a
  handful of sections, with a last-updated date. The gist: be decent; no abuse, threats, slurs,
  sexual or violent material, other people's private details, anything illegal, or anything that
  would shame the club; the board removes reported content and can suspend a member's app access,
  normally within 24 hours; reports go to the board, and apps@rustnutssmc.com.au reaches the club;
  the club's constitution and Road Rules still apply. Plain English, no legalese.
- Every approved member (not Family, who can't post) agrees once. `members.posting_rules_accepted_on`
  (a date) records it; `public.accept_posting_rules()` sets it to today.
- The app shows a **Club rules** screen in place of the tabs until an approved member has agreed:
  logo, the rules, an **I agree** button, then Sign out and Delete my account underneath. Family,
  applicants and declined people never see it.
- The posting functions refuse `Agree to the club rules for chats and posts first.` until the
  date is set: `send_message`, `save_listing`, `post_build_update`, `nominate`, `save_mechanic`,
  and `save_profile` when a bio is being saved (an applicant can still save their name). The app's
  rule functions say the same, in the same place: last, after every check on the content itself,
  because the database applies it as a trigger when the row goes in.
- The rules can be read again from Me (Privacy section) and from the Pending screen's footer
  links, and are published at `site/posting-rules.html` (built by `npm run build:privacy` next to
  the privacy page, same look). The same text is what the iOS thread pastes into App Store Connect
  as the custom licence agreement.

### 2. Report anything a member posts

- One new table, `public.content_reports`: `kind` (`listing`, `build_update`, `nomination`,
  `mechanic`, `profile`), `target_id`, `reporter_id`, an optional reason (500 characters),
  a `snapshot` of what was there (title and text) for whoever deals with it, `created_at`,
  `resolved_at`, `resolved_by`, `outcome` (`removed` or `dismissed`). One open report per member
  per thing; reporting again changes the reason. Chat messages keep `message_reports` as they are.
- `public.report_content(p_kind, p_target, p_reason)`: signed in, approved, the thing exists and is
  still up, not your own, reason under 500 characters. Words: `No such listing.` / `No such
  update.` / `No such nomination.` / `No such workshop.` / `That member no longer exists.`;
  `That listing has been taken down.` / `That update has been taken down.` / `That nomination has
  been withdrawn.` / `That workshop is off the list.`; `You can’t report your own listing.` (and
  update, nomination, workshop, profile); `Keep the reason under 500 characters.`
- Who deals with a report (`private.can_act_on_content_report`, mirrored by
  `canActOnContentReport`): a profile report goes to that member's chapter board (the people who
  manage the member); the rest go to any board member or the NEC, who can already take those
  things down.
- `public.content_reports()` lists open reports the caller can act on, newest first.
  `public.resolve_content_report(p_report, p_remove)`: remove takes the thing down the way the
  board already can (listing taken down, update taken down, nomination withdrawn whatever the
  award's phase, workshop off the list, bio cleared), or dismisses; either way every open report on
  that thing closes. Words: `No such report.`, `Only the board can do that.` /
  `Only that member’s chapter board can do that.`, `That report was already dealt with.`
- `public.my_open_reports()` gives the caller their own open reports (message ids and content
  kind/id). The app hides anything you've reported from you straight away, until the board deals
  with it. With board approval of every member and the no-tolerance rules, that is the app's
  "filter": nothing you've flagged stays in front of you, and nothing stays up for anyone once the
  board acts. There is no word list: the club's chats are adult banter by design (GIFs are rated R
  and the store age rating is 18+), and a word list would get in the way without catching what
  matters.
- In the app, a **Report** action (a quiet chip that opens an optional reason and a Send report
  button, then "Reported. The board will look at it within 24 hours.") appears on: a listing that
  isn't yours; each build update that isn't yours; each nomination that isn't yours; a workshop
  someone else added; another member's screen (reports their profile). The chat message Report
  stays as it is. The Photos viewer already has "Open the chat", which reaches it.
- The board's queue: the Chats tab's "Reports to look at (n)" row counts chat reports and content
  reports together, and the Reports screen shows both kinds. A content report card shows what was
  reported (the snapshot), who posted it, who reported it and why, with **Remove it** and
  **Leave it up**, and an Open button that goes to the listing, build, award or member.
- The demo seeds one open content report (a listing reported by Diesel) so a board persona sees
  the queue straight away.

### 3. Block from a message

- Other people's messages get a **Block** chip beside Report (a `ConfirmButton`, since blocking
  is a big step), which calls the existing `set_block`. The message's author line becomes
  tappable and opens the member's screen, where Block already lives. No database change.

### 4. Suspend a member's app access

- Two board actions, `public.suspend_member_access(p_member)` and
  `public.restore_member_access(p_member)`, set `members.approval` to `suspended` and back to
  `approved`. The database's `approval_state` has had `suspended` since the foundations; nothing
  set it. Because every members-only check already requires `approved`, suspension cuts chats,
  listings, builds, nominations, the directory and the rest in one step, and the suspended member's
  board seats stop working while it lasts (their seat records stay).
- Rules (mirrored in `src/domain/access.ts`): that member's chapter board only (`is_board_of`,
  `Only that member’s chapter board can do that.`); not yourself (`You can’t suspend your own
  access.` / `…restore…`); to suspend, the member must be approved (`They’re not an approved
  member.`); to restore, they must be suspended (`Their access isn’t suspended.`).
- Manage member gets a **Suspend app access** `ConfirmButton` (note: "They lose the chats, the
  directory and everything members-only straight away, and they're told it was the board. Record
  the conduct decision separately.") and, for a suspended member, **Restore app access**. Conduct
  records stay a separate, manual step, as Jeff wants.
- The suspended member sees the Pending screen with its own words: "Your app access is
  suspended. The {chapter} chapter board has paused your access to the club's chats, posts and
  records. Talk to your chapter board about what happens next." Sign out, Delete my account, the
  documents and the privacy policy stay reachable.

### 5. Store paperwork

- The iOS thread rewrites the App Review notes and sets the custom EULA; this lane sends it the
  rules text (`src/domain/postingRules.ts`) and the public page address when they exist.

## Demo and parity

- Demo members all have the rules agreed except Spanner (the reviewer's persona), so the reviewer
  sees the gate first. Demo actions: `acceptPostingRules`, `reportContent`,
  `resolveContentReport`, `suspendAccess`, `restoreAccess`, in `src/data` beside the existing ones.
- `supabase/tests/parity.json`: fixture members agree on 01/01/2024 unless a case says
  `rulesNotAgreed: true` (nulled for that case only, like `noRoadRules`); a fixture member
  `benched` (West, Full, suspended). New cases: `agreePostingRules` (approved yes, pending no,
  signed out no); `chatSend`, `socialSaveListing`, `socialPostBuildUpdate`, `socialNominate`,
  `socialSaveMechanic` and a bio save with `rulesNotAgreed`; `reportContent` for each kind (allowed,
  own thing, taken-down thing, long reason, missing thing); `suspendAccess` and `restoreAccess`
  (chapter board yes, other chapter no, self no, wrong state no, member no, signed out no).
- `supabase/tests/member_content_rules_test.sql`: the gate refuses before and allows after
  agreeing; a report lands with its snapshot; the right people see it; remove takes the thing down
  and closes every report on it; dismiss closes them without touching the thing; the reporter's
  own open reports come back from `my_open_reports()`; suspend locks a member out of the chat and
  the directory and restore lets them back. The migration needs only tables that are already live
  (members, messages and the social tables), so it has no order check.

## Not doing

- No word list (see above). Can be added later in the same rule functions if the club wants one.
- No push to the board when a report lands: the database has no per-member "is on a board" helper
  to send it with, and App Review doesn't check it. The Chats tab shows the count every time a
  board member opens it. Follow-up.
- No report from the Photos viewer (it opens the chat, which has Report).
- Blocks don't yet hide nominations or workshops (they hide messages, listings and builds). Follow-up.
