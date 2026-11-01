# Feedback & issues: members tell us what's wrong with the app

Status: approved by Claude 1 Nov 2026 (standing self-approval), shown to Jeff, who can veto.
Classification: architectural (a new table, storage bucket, push triggers, two screens).

## What Jeff asked for

"We also need to add a feedback or issues tab for members to tell us issues with the app."
(1 Nov 2026.) The tester build is out with Jeff, Roger and Chris now, and more members follow at
launch, so problems need one place to land instead of texts and Messenger.

**Success:** any member can, in under a minute, say what went wrong (or what they'd like), attach a
screenshot, and send it. The people who look after the app get a push, see it with the phone
details needed to chase it, mark it "looking" or "done", and reply. The member sees the reply.

## Who

- **Senders:** anyone approved in the app, Family included (they use it too). Not applicants, not
  deleted accounts, not signed-out people.
- **App keepers** (who read and answer them): anyone in a current **Treasurer** seat (either
  chapter), or the **NEC Chairman** or **NEC Secretary**. Today that's Jeff. A keeper sees every
  report from both chapters. Nobody else sees anyone's report; a sender sees only their own.

Why the treasurer and not the whole board: the treasurer looks after the app today, and app bugs
aren't chapter business. The two NEC officers are there so it never goes unread if the treasurer
seat changes hands.

## The member side

Me → new card "Feedback & issues" (member Me and Family Me), under Sponsors and above Privacy, with
a subtitle "Something broken, or an idea? Tell us." It opens a screen with:

1. **What is it?** chips: Something's wrong (`bug`) · An idea (`idea`) · Other (`other`). Default
   none; must pick.
2. **Tell us** (multiline, 1 to 1,000 characters).
3. **Where in the app?** optional short line (60 characters), e.g. "Rides, the map".
4. **Screenshot** optional, one image from the phone's photos (shrunk like other uploads).
5. A fine-print line saying what's attached automatically: app version, build and phone, e.g.
   "Sent with: v0.1.0 · update 3f2a… · Android 15 · SM-S938B".
6. **Send** button. After sending: "Thanks. It's with the club." and the form clears.

Below the form, **Your reports**, newest first: kind chip, date, status chip (New / Looking into it /
Done), the text, and the keeper's reply if there is one.

Limits: 1,000 characters, at most 5 reports per member per day ("That's five today. Send more
tomorrow, or message the treasurer.").

## The keeper side

Board screen, a new section **App feedback** (count of not-done ones), shown only to keepers, below
Website enquiries. Each card: who sent it, date, kind chip, status chip, the text, where, the
device line, the screenshot (tap to open full size), and if done/replied the reply.

Actions on an open card: **Looking into it** / **Done** status buttons, a **Reply** field (600
characters) with **Send reply**, and **Email** (opens the mail app to the member's email when the
keeper can see it, with subject "Your Rustnuts app feedback"). Order: new first, then looking, then
done; newest first within each.

Board screen is board-only, and today every keeper holds a board seat (Treasurer, NEC). That's
enough; no new tab.

## Notifications

- New report → push to every keeper: title "App feedback", body "<short name>: <first 80 chars>".
  Uses the existing outbox (held while push is off), one per report (`feedback:<id>`), honouring
  the keeper's "approvals" setting like join requests. Tap opens the Board screen.
- Reply saved → push to the sender: "Reply to your feedback", body the first 80 characters of the
  reply, once per reply (`feedback-reply:<id>:<n>`). Marked done with no reply → "Your feedback is
  marked done" once (`feedback-done:<id>`). Tap opens the Feedback screen. These always go (it's
  their own report).

## Data

`public.app_feedback`: id, member_id, kind (`bug|idea|other`), body (1–1000), where_in_app (≤60,
null), screenshot_path (null), app_version (≤40), build (≤80), device (≤120), status
(`new|looking|done`), reply (≤600, null), replied_by, replied_at, reply_count, status_changed_at,
created_at. RLS: select own rows or keeper; no direct writes.

- `public.send_app_feedback(kind, body, where, screenshot_path, app_version, build, device)` →
  id. Refusals in order: sign in; approved in the app; kind; body empty / long; where long;
  screenshot must be the caller's own upload in `feedback-media`; tech strings trimmed and cut to
  size (never refused); five a day.
- `public.answer_app_feedback(id, status, reply)` keeper only. Status required; reply optional
  (empty keeps the old reply). Refusals: sign in; keeper; no such report; bad status; reply long.
- `public.list_app_feedback()` → rows the caller may see, with sender name and (keepers only)
  sender email, in Board order.
- Storage bucket `feedback-media` (private, 10 MB, jpeg/png/webp): upload into own folder by anyone
  approved in the app; read own files or keeper; delete own files not on a report.
- Delete my account: a trigger on `members.account_deleted_on` deletes their reports and queues
  their `feedback-media` files on `private.storage_purge`.

The same rules in `src/domain/feedback.ts`, with the same words, and the demo build keeps two
sample reports in memory.

## Not doing (YAGNI)

No threads of back-and-forth (one reply, which can be replaced), no voting, no public list of known
issues, no auto-capture of logs, no new tab bar slot, no GitHub issue creation (keepers can do that
by hand).

## Testing

- `src/domain/feedback.test.ts`: send/answer problems in order, who sees what, sort order, device
  line, limits.
- `supabase/tests/app_feedback_test.sql`: send refusals and words, five a day, RLS (own vs keeper vs
  other member vs board non-keeper), answer refusals, push rows written, storage policies, the
  account-deletion clean-up.
- Screens checked at 390×844 in the demo build (member form, Your reports, Board section).

## Shipping

Migration `20270700000000_app_feedback.sql`, copied to `/mnt/project-files/build/app-feedback.sql`
as paste-queue item 53. Works in the demo build straight away; the live app shows the Me card only
once the table is live (it calls `list_app_feedback` and shows a soft "Not switched on yet" when the
function is missing).
