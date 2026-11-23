# Board files: a folder for every seat

Date: 24/11/2026 (Melbourne). Asked by Jeff (Treasurer, Secretary, NEC Chair), 23 Nov, "Ideas for the app" point 3;
he tapped "Build board files, ask about chats". Kind of work: architectural (new table, private Storage bucket,
policies, actions, two screens). Claude approved this design (Jeff's 24 Oct rule); Jeff can veto.

## The ask

> "would having a board only document section with sub folders for each position be possible/useful (central
> storage location for all club info so that any board member can access them as stop annoying you for info like
> basic business info, insurance and the like) and anyone that takes over a position already has what they need
> when they take over a position (the one thing I like about BACA system)"

Today the Club documents library holds typed text that every approved member reads. There is no place for the
board's own files (PDFs, photos, Word and Excel files), and nothing that belongs to a seat rather than a person.

## What it does

- **Board › Board files** (a row in the club admin card, under Club documents), for anyone who sees the
  "All boards" chat: a board seat in any chapter, covered or not, or the NEC (`isAnyBoard`, `private.is_any_board`).
- The **Board files** screen lists folders:
  - **Club info**: business details, insurance, certificates, bank letters. Whole club.
  - **Each chapter's board seats**: President, Vice President, Secretary, Treasurer, Sergeant at Arms, Road
    Captain. The reader's own chapter first, then the others.
  - **National seats**: National Chairman, National Secretary.
  - Each row shows the seat's holder now (or "Vacant") and how many files it holds.
- A **folder** shows its files, newest first: name, kind, size, date added and who added it. Tapping a file
  opens it (in-app browser sheet on phones, a new tab on the web, with a 10 minute signed address).
- **Files belong to the seat.** When the Treasurer changes, the new Treasurer finds the folder as it was and
  can add to it and tidy it. The person who added a file can't remove it after leaving the seat.
- **Add file** (phone's file picker) and **Add photo** (photo library, one at a time) for those who can add.
  **Remove** is a `ConfirmButton` on each file.

## Who can do what (the same in `src/domain/boardFiles.ts` and the database)

- Read every folder: `isAnyBoard(me)`. Everyone else sees nothing, and the Board row isn't shown.
- Add to or remove from a **seat folder**: whoever does that seat's duties now (an acting holder does, a covered
  holder doesn't: `dutyPositions`), or the National Chairman or Secretary (to stock a vacant seat or tidy up).
- Add to or remove from **Club info**: any reader.
- Refusals: "Sign in first." / "Board files are for board members and the NEC." / "Only whoever holds this seat, or the
  National Chairman or Secretary, can change this folder." / "That folder isn't one the club has." / "That file isn't in
  board files." / "Pick a PDF, photo, Word, Excel or text file." / "That file is over 20 MB. Save a smaller copy and
  try again."
- Kinds by name ending: pdf, jpg, jpeg, png, heic, webp, doc, docx, xls, xlsx, csv, txt. The name decides the
  kind (Android often doesn't label files), and the upload says the matching content type.
- Name shown: the picked name trimmed, cut to 120 characters; blank gets "Board file" plus the ending.

## Database (`supabase/migrations/20270970000000_board_files.sql`)

- `public.board_files`: `id`, `chapter_id` (null for Club info and national seats), `role` (null for Club info),
  `path` (unique), `name` (1 to 120), `size_bytes`, `added_by` (members, set null if they're deleted), `added_at`.
  A check keeps the folder real: no chapter means Club info or `nec_chair` / `nec_secretary`; a chapter means one
  of the six board seats.
- RLS: select for `private.is_any_board()`; no direct writes (actions only).
- Private bucket `board-files`, 20 MB, the content types above. Path `<chapter id or club>/<role or info>/<random>.<ending>`.
- `private.board_folder_writer(p_chapter, p_role)` and `private.board_path_writer(name)` read the folder from
  the path. Storage policies: insert by the folder's writer; select by any reader; delete by the folder's writer
  only when no row uses the path (tidying a refused add).
- `public.add_board_file(p_chapter, p_role, p_path, p_name, p_size)` returns the new id: the writer, a real
  folder, the path is under that folder with an allowed ending and is in Storage. 
- `public.remove_board_file(p_id)`: the folder's writer; the row goes and the file is queued on
  `private.storage_purge`.

## App

- `src/domain/boardFiles.ts`: folders, `readsBoardFiles`, `writesBoardFolder`, `addBoardFileProblem`,
  `removeBoardFileProblem`, `boardFileName`, `boardFileKind`, `folderFiles`, `folderLabel`, `formatBytes`.
- `BoardFile` type and `ClubData.boardFiles`. Live loads `board_files` (empty before the migration).
- `src/data/boardFilePick.ts` (+ `.web.ts`): pick a file or a photo, and read its bytes.
- Club context: `addBoardFile(folder, file)`, `removeBoardFile(id)`, `boardFileUrl(path)`. Live: upload, then
  the action; a refused action takes the upload back out. Demo: keeps the picked file's local address; the seeded
  demo files say they don't open.
- Screens `BoardFiles` and `BoardFolder` in `src/screens/boardFiles.tsx`, registered in the root stack.
- Everything already in the build (`expo-document-picker`, `expo-image-picker`, `expo-file-system`), so it ships
  over the air plus the one SQL file.

## Tests first

- `npm test`: the rules above (readers, seat writers, acting and covered holders, NEC officers, Club info, kinds,
  size, names, unknown folder and file), the folder list and counts, demo add and remove, the live read.
- `npm run test:db` (`supabase/tests/board_files_test.sql`): who reads the rows and the bucket, who uploads where,
  the actions' refusals in the app's words, removal queues the file, tidying only unused paths.

## Not doing (yet)

- Sub-folders inside a seat, renaming, moving files between folders, versions. Easy to add if the board asks.
- Chat topics (Jeff's point 2) and downloads for everyone (point 1) are in their own threads.
