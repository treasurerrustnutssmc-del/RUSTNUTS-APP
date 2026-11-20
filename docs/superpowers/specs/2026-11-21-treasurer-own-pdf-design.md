# Attach the treasurer's own PDF to a meeting report

Date: 21/11/2026 (Melbourne). Asked by Jeff (Treasurer), project thread "Add a Treasurer report in the app".
Kind of work: architectural (a new column, a private Storage bucket, policies and an action). Claude approved this
design (Jeff's 24 Oct rule); Jeff can veto.

## The ask

Jeff writes his Treasurer's Report himself as a PDF. In the app he can make a report from the books and share it,
but there is no way to pick a PDF from his phone and put it in the app. He wants to upload his own.

## What it does

- On **Report for a meeting** (Board › Treasury), a saved draft gets a new card, **Your own PDF**:
  - **Attach a PDF** opens the phone's file picker, PDFs only. The file goes up and is linked to the report.
  - Once attached, the card shows the file name with **Open** and **Remove** (Remove is a `ConfirmButton`).
    Attaching again replaces the old file.
  - Before the first save the card says "Save the draft first, then attach your PDF."
- When the report is **presented**, the PDF is locked with it. Every member who can read presented reports
  (approved, not Legacy, the same as today) sees **The treasurer's PDF** with **Open the PDF** on the report.
- **Share as PDF** stays as it is: it still makes the app's own report from the books.
- One PDF per report, up to 10 MB, `application/pdf` only.

## Rules (the same in `src/domain/meetingReport.ts` and the database)

- Only whoever keeps the Club fund's books (`keepsBooks(me, null)`, `private.keeps_books(null)`) attaches or removes.
- Only on a draft. Presented: "That report is presented and can't be changed." (the existing MR_LOCKED).
- No such report: "No such report."
- The file must be a PDF ("Pick a PDF file.") and 10 MB or less ("That PDF is over 10 MB. Save a smaller copy and try again.").
- The name shown is the picked file's name, trimmed, cut to 120 characters.

## Database (`supabase/migrations/20270890000000_meeting_report_pdf.sql`)

- `treasurer_meeting_reports` gets `pdf_path text` and `pdf_name text` (both null, or both set; name 1 to 120 chars).
- Private bucket `treasurer-reports`, 10 MB, `application/pdf` only. Path: `<report id>/<random>.pdf`.
- Storage policies:
  - insert: keeps the Club books, and the first folder is a draft report's id.
  - select: keeps the Club books, or the file is a presented report's `pdf_path` and the reader is approved and not Legacy.
  - delete: keeps the Club books and the file isn't any report's `pdf_path`.
- `public.set_meeting_report_pdf(p_id uuid, p_path text, p_name text)`: books keeper, draft only, the path is
  under the report's folder and is in Storage. Null path removes it. A replaced or removed file is queued on
  `private.storage_purge` so the purge job clears the bytes.
- `delete_meeting_report` also queues the draft's file. `meeting_reports()` returns `pdf_path` and `pdf_name`.

## App

- `MeetingReport` type gets `pdfPath` and `pdfName`. `toMeetingReports` reads them.
- `src/data/reportPdfFile.ts` (+ `.web.ts`): pick one PDF and return `{ name, size, bytes }` or null.
  Native uses `expo-document-picker` (already in the build, so this ships over the air, no new phone build).
- Club context: `attachMeetingReportPdf(id, file)`, `removeMeetingReportPdf(id)`, `meetingReportPdfUrl(path)`.
  Live: upload, then the action; if the action refuses, the upload is removed. Demo: keeps the name and a local
  address only.
- Open uses a signed address (10 minutes): the in-app browser sheet on phones (`openLink`), a new tab opened during the tap on the web.
- A blank file name gets "Treasurer's report.pdf" on both sides.

## Tests first

- `npm test`: `attachPdfProblem` / `removePdfProblem` (signed out, not the books keeper, presented, no such report,
  not a PDF, too big), demo actions, `toMeetingReports` reading the new fields.
- `npm run test:db` (added to `supabase/tests/meeting_reports_test.sql`): who can upload, read and delete in the bucket;
  the action's refusals in the app's words; presented locks it; members read it once presented and not before;
  Legacy never; replace and remove queue the old file.

## Not doing

- No PDF on the monthly Treasurer's Report (only Report for a meeting). Easy to add later if Jeff wants it.
- No reading the figures out of the PDF.
