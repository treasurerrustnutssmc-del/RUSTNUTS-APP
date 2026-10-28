# Document library (Stage 5, part C)

**Type:** architectural (new tables, new database actions, new screens). Claude approved this spec
on 27 Oct 2026 under the self-approval rule in AGENTS.md. Jeff can veto any of it. Rules marked
*(inferred)* are Claude's reading where the constitution doesn't settle it.

This is lane D, so the migration is `20270101000300_documents.sql`.

## Where this comes from
Constitution v4 (in /mnt/project-files/reference/):
- **2.2, the order of authority:** applicable law; the Registered Rules; this internal
  Constitution; a valid NEC national policy; a compliant chapter bylaw or policy; then an
  operational procedure or direction. A lower document can't override a higher one.
- **15.3:** a Board may adopt written local operating policies within its authority.
- **15.4:** Road Rules, forms, procedures and operating instructions may be controlled separately.
  The NEC may keep schedules (patch administration, fees, rides and so on). A material rule change
  follows section 16.
- **15.5:** every controlled document states its title, version, approving body, approval date and
  commencement date. Current versions are reasonably available to affected members, and superseded
  versions are kept as club records.
- **15.7:** members and applicants get the Registered Rules free. The internal Constitution is
  supplied electronically, free.
- v4's own document control says "Approval / commencement: as recorded in the Club’s adoption
  resolution; the publication date is not the commencement date." So v4 goes in with its approval
  not yet recorded.

## Goal
- One library in the app for the club's controlled documents, listed in the 2.2 order.
- Every version shows the five 15.5 facts, and says plainly when one isn't recorded yet.
- Old versions stay readable, marked as superseded. Nothing is edited or removed: a correction is a
  new version.
- Long documents are readable on a phone: a contents list and a find box.
- A document can ask members to sign that they've read it, and its publishers see who hasn't.
- Each document can have a review cycle, and publishers see when a review is due.
- Constitution v4 is in the library from day one, free to members and applicants.

## Words
- **Document:** one controlled document, such as "Constitution" or "West Chapter bylaws". Fields:
  - `kind`: `registered_rules`, `constitution`, `policy` or `procedure`.
  - `chapter_id`: null for a club-wide document, or the chapter whose document it is.
  - `title`: 1 to 120 characters.
  - `asks_sign_off`: whether members sign that they've read it. It's set when the document is
    added.
  - `review_months`: null for no review cycle, or a whole number from 1 to 60.
  - `reviewed_on`: the last time a publisher marked it reviewed without a change.
  - `created_by` and `created_at`.
- **Authority level** (from 2.2), worked out from kind and scope:

  | Level | Shown as | Kind and scope |
  |---|---|---|
  | 1 | Registered Rules | `registered_rules` (club-wide only) |
  | 2 | Constitution | `constitution` (club-wide only) |
  | 3 | NEC policies and schedules | `policy`, club-wide |
  | 4 | Chapter bylaws and policies | `policy`, a chapter |
  | 5 | Procedures and forms | `procedure`, either scope |

  The library lists levels in that order, chapter documents grouped by chapter, then by title.
- **Version:** one published text of a document. Fields:
  - `number`: 1, 2, 3, and so on, per document.
  - `label`: what the club calls it, such as "v4". 1 to 20 characters.
  - `body`: the text, 1 to 200,000 characters. It uses the Road Rules format: `# ` starts a
    heading, `- ` a bullet, and a blank line ends a paragraph.
  - `what_changed`: optional, at most 500 characters.
  - `fresh_sign_off`: whether members sign again. Version 1 always does. Only matters when the
    document asks for sign-off.
  - `approving_body`, `approved_on` and `commences_on`: the 15.5 facts. They're either all set or
    all empty (not recorded yet).
  - `published_by` (null for an imported version) and `published_at`.
- **Approving bodies**, a fixed list *(inferred from 2.2, 15.3, 15.4 and section 16)*:
  - `association_general_meeting`: "Association general meeting"
  - `association_committee`: "Association Committee"
  - `full_members`: "Full Members’ vote"
  - `nec`: "NEC"
  - `chapter_board`: "Chapter Board"
- **Version state**, at a Melbourne date:
  - `awaiting`: approval not recorded yet. Shown as "Awaiting approval".
  - `upcoming`: approved, commencing after today. Shown as "Commences DD/MM/YYYY".
  - `in_force`: the highest-numbered version that is approved and has commenced. Shown as
    "In force".
  - `superseded`: an approved, commenced version below the one in force. Shown as "Superseded".
  - A version below the one in force that was never approved is also `superseded`.
- **Shown version:** the one a member reads first. It's the version in force, or, when nothing is
  in force yet, the highest-numbered version. When a newer version than the one in force is
  awaiting or upcoming, the document says so in a banner with a link to it.

## Who's who
- **Reads the library:** every approved member, Legacy included, reads every document and version.
- **Applicants** (signed in, not yet approved) read the Registered Rules and the Constitution only
  (15.7). The public reads nothing.
- **Publishes** a document (adds it, publishes versions, records approval, marks reviewed, sees
  who's signed):
  - club-wide: the NEC (`isNational`);
  - a chapter's: that chapter's board, or the NEC. This is the same as `runsScope`.
- **Asked to sign** a document that asks for sign-off: approved members who aren't Legacy. For a
  chapter's document, only that chapter's members.

## Rules (`src/domain/documents.ts`, mirrored by the database with the same words and order)
Every action first checks `Sign in first.` and `Only approved members can do that.`, then:

1. **Adding a document** (`create_document`):
   1. Not a publisher for that scope: `Only the NEC can do that.` or
      `Only that chapter’s board can do that.` (`scopeRefusal`).
   2. Registered Rules or Constitution for a chapter:
      `The Registered Rules and the Constitution are club-wide documents.`
   3. A Registered Rules or Constitution document already exists:
      `The library already has that document. Publish a new version of it instead.`
   4. Title empty after trimming: `Give the document a title.`
   5. Title over 120 characters: `Keep the title to 120 characters at most.`
   6. Review months not null and not a whole number from 1 to 60:
      `Pick a review cycle from 1 to 60 months, or none.`
2. **Publishing a version** (`publish_document_version`):
   1. No such document: `That document isn’t in the library.`
   2. Not a publisher: the scope refusal.
   3. The document's highest version number isn't the one the editor opened on (0 for none):
      `Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the document again.`
   4. Label empty after trimming: `Give the version a label, like v2.`
   5. Label over 20 characters: `Keep the label to 20 characters at most.`
   6. Body empty after trimming: `Write the document’s text first.`
   7. Body over 200,000 characters: `That’s too long (200000 characters at most).`
   8. What changed over 500 characters: `Keep what changed to 500 characters at most.`
   9. The approval checks below, when any approval field is given.
3. **Approval fields** (shared by publishing and `record_document_approval`):
   1. Some but not all of body, approved date and commencement date given:
      `Give the approving body, the approval date and the commencement date together.`
   2. Approving body not one of the five: `Pick who approved it.`
   3. Approved after today: `The approval date can’t be in the future.`
   4. Commences before approved: `It can’t commence before it was approved.`
4. **Recording approval later** (`record_document_approval`), for a version published as awaiting:
   1. No such version: `That version isn’t in the library.`
   2. Not a publisher: the scope refusal.
   3. Already recorded: `Its approval is already recorded.`
   4. All three fields missing: the first approval-fields message.
   5. Then the approval checks above.
5. **Marking reviewed** (`mark_document_reviewed`), recorded as today's Melbourne date:
   1. No such document: `That document isn’t in the library.`
   2. Not a publisher: the scope refusal.
   3. No review cycle: `This document has no review cycle.`
   4. Nothing in force: `Nothing is in force yet, so there’s nothing to review.`
6. **Signing** (`sign_document`), on a document that asks for it:
   1. No such version: `That version isn’t in the library.`
   2. The document doesn't ask for sign-off: `This document doesn’t ask for sign-off.`
   3. Not asked (Legacy, or another chapter's member):
      `You’re not asked to sign this document.`
   4. The version isn't the one in force:
      `That version isn’t the one in force. Open the document again, then sign.`

   Signing again is allowed and moves the date *(inferred, the same as Road Rules)*.
7. **Texts** are trimmed with JS `trim()` in the app and `private.trim_like_app` in the database.
   Lengths count code points.

## Sign-off and review status
- **Sign-off base:** the highest-numbered version at or below the one in force with
  `fresh_sign_off` (version 1 always counts).
- **Signed:** the member has a sign-off on a version at or above the base. There's no yearly
  expiry *(inferred: the Road Rules' yearly cycle comes from 7.10, which is about the Road Rules
  only)*. With nothing in force, nobody is asked yet.
- `signStatus(member, document, data)` returns `'none' | 'unsigned' | 'signed'`, where `none`
  means the document doesn't ask, the member isn't asked, or nothing is in force.
- **Review due on:** with a review cycle and a version in force, the later of the in-force
  version's commencement date and `reviewed_on`, plus `review_months` months (a 31st rolls back to
  the month's last day). `reviewState` is `ok`, `due_soon` (30 days or fewer left) or `overdue`
  (past). Only publishers see it.

## The Road Rules
The Road Rules keep their own screen, sign-off and yearly cycle (lane A). The library lists them as
an extra row at level 5, "Road Rules", with their current version number, opening the Road Rules
screen. They aren't copied into the document tables. Moving them in (and giving them the 15.5
approval facts) is a later change.

## Plumbing (the same pattern as meetings, votes and the ledger)
- Tables `public.documents`, `public.document_versions` (unique on document and number) and
  `public.document_signoffs` (keyed on version and member, with `signed_at`).
- Revoke table access for `anon` and `authenticated`, turn row-level security on with no
  policies. All access goes through SECURITY DEFINER functions with `search_path = ''`.
- **Reading:**
  - `club_documents()` returns jsonb `{ documents, versions, signoffs }`. Versions come without
    their body, so the list stays small. Applicants get only levels 1 and 2. Sign-offs: a member
    gets their own, and a publisher gets every sign-off for the documents they publish.
  - `document_body(version)` returns the text, with the same visibility.
- **Actions:**
  - `create_document(chapter, kind, title, asks_sign_off, review_months)` returns the id;
  - `publish_document_version(document, expected_number, label, body, what_changed,
    fresh_sign_off, approving_body, approved_on, commences_on)` returns the id;
  - `record_document_approval(version, approving_body, approved_on, commences_on)`;
  - `mark_document_reviewed(document)`;
  - `sign_document(version)`.
- "Today" is the Melbourne date in both the app and the database.
- Refusals use the same words as `src/domain/documents.ts`. Shared cases go in `parity.json`.
- The migration only adds. It has no "drop" and no "delete from".
- **v4 in live:** a separate data-only paste file adds the Constitution (club-wide, no sign-off,
  12-month review) and version 1 labelled "v4", approval not recorded, `published_by` null. It
  stops if a Constitution already exists. The text is the reference copy with page headers and
  footers taken out and clause numbers starting new paragraphs.

## Screens
- **Me → Club documents** for approved members and applicants. **Board → Documents** for
  publishers, with a count of reviews due.
- **Documents** (`Documents`):
  - the levels in order as section headings, then rows. Each row has the title, the version label
    and a state chip (In force, Awaiting approval or Commences DD/MM/YYYY). A "Sign" chip shows
    when the member needs to sign. Publishers also see a "Review due" or "Review overdue" chip.
  - The Road Rules row at level 5.
  - Publishers get **Add a document**.
  - With nothing in the library, "The club hasn’t put any documents in the app yet."
- **Document** (`Document`, params `{ id, version? }`):
  1. The control card: title, "Version v4 (number 1)", Approved by, Approved on, Commences, each
     with "Not recorded yet" when missing, and the state chip.
  2. A banner when a newer version is awaiting or upcoming, or when an older version is open
     ("You’re reading a superseded version." with a link to the one in force).
  3. "What changed", when there is one.
  4. A find box. Typing two or more characters lists up to 50 matching paragraphs, each tapping to
     its place in the text.
  5. **Contents**: the headings, each tapping to its place. Hidden when there are fewer than three
     headings.
  6. The text, in readable body type, selectable.
  7. The sign box, when the document asks and the member is asked: "I’ve read this document" and
     a big **Sign** button, or "Signed on DD/MM/YYYY." with a quiet **Sign again**.
  8. For publishers: **Publish a new version**, **Record approval** (when missing), **Mark
     reviewed** (with a review cycle, through `ConfirmButton`), **Who’s signed**, and the version
     list with numbers, labels, states and published dates. Older versions open read-only.
- **Add a document** (`NewDocument`): scope (Club or a chapter the member runs), kind (only the
  ones that fit the scope, and Registered Rules or Constitution only if not already there), title,
  the sign-off switch, and the review cycle (None, 12, 24 or 36 months). It then opens
  **Publish a version**.
- **Publish a version** (`PublishDocument`, params `{ id }`): label, the text (prefilled with the
  current text), what changed, the fresh sign-off switch (when the document asks), and "Record
  approval now" with the body chips and two dates. A failed publish keeps the typed text on screen.
- **Record approval** (`DocumentApproval`, params `{ versionId }`): body chips and two dates.
- **Who’s signed** (`DocumentSignoffs`, params `{ id }`): Not signed, then Signed, in name order,
  with the sign date.
- Everything follows DESIGN.md. Titles, labels, chips and dates on cards are in Rustnuts Stencil.
  The document text is in the body font, because it's running sentences.

## Tests
- `src/domain/documents.test.ts`: levels and order; who reads (applicants only levels 1 and 2);
  who publishes; every refusal in order; version states across approval and commencement dates;
  the shown version and banners; sign-off base and status; review due dates (month-end rolls and
  the 30-day window); `find` and contents from the text.
- `src/data/documents.test.ts`: demo actions and the live read mapping.
- `supabase/tests/documents_test.sql`: each action's refusals, applicants seeing only levels 1
  and 2 (list and body), sign-off visibility, and the table being closed to direct access.
- Parity cases for every shared refusal.

## Not covered yet
- PDF files on a version, and attaching files or library documents to minutes. That's the next
  part (5C-2), with a storage bucket.
- Linking a version's approval to a carried vote in the app.
- Moving the Road Rules into the library.
- Retiring a document altogether.
- Record requests under 15.8 to 15.10 (register, financial statements, other records).
