// Board files (spec docs/superpowers/specs/2026-11-24-board-files-design.md): a folder for every
// board seat and one for Club info, so the club's paperwork lives with the seat and a new office
// holder has it on day one. The database's add_board_file, remove_board_file and the board-files
// bucket (supabase/migrations/20270970000000_board_files.sql) check the same, in the same words.

import { isActing } from './acting';
import { activePositions, isNecOfficer } from './access';
import { BOARD_ROLES, ROLE_LABEL } from './labels';
import { signedInProblem } from './meetings';
import { displayName } from './profile';
import { isAnyBoard } from './social/help';
import type { BoardFile, ClubData, Member, Position, PositionRole } from './types';

export const BF_READERS = 'Board files are for board members and the NEC.';
export const BF_SEAT_ONLY = 'Only whoever holds this seat, or the National Chairman or Secretary, can change this folder.';
export const BF_NO_FOLDER = 'That folder isn’t one the club has.';
export const BF_NO_FILE = 'That file isn’t in board files.';
export const BF_TYPE = 'Pick a PDF, photo, Word, Excel or text file.';
export const BF_BIG = 'That file is over 20 MB. Save a smaller copy and try again.';
export const BF_UPLOAD = 'That file didn’t upload. Try again.';
export const BF_MAX_BYTES = 20 * 1024 * 1024;
const NAME_MAX = 120;

/** The national seats with a folder. The Auditor reviews the board and isn't one of its readers (11.8). */
export const NATIONAL_FOLDER_ROLES: PositionRole[] = ['nec_chair', 'nec_secretary'];

/** A folder: Club info (no chapter, no role), a national seat (no chapter) or a chapter's board seat. */
export type BoardFolderRef = { chapterId: string | null; role: PositionRole | null };

/** A file picked from the phone, as far as the rules need it. */
export interface PickedBoardFile {
  name: string;
  /** Bytes; null when the phone didn't say. */
  size: number | null;
  mimeType: string | null;
}

export type BoardFileKind = { ending: string; label: string; contentType: string };

const WORD_X = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXCEL_X = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The kinds the club keeps, by name ending. The bucket allows exactly these content types. */
export const BOARD_FILE_KINDS: BoardFileKind[] = [
  { ending: 'pdf', label: 'PDF', contentType: 'application/pdf' },
  { ending: 'jpg', label: 'Photo', contentType: 'image/jpeg' },
  { ending: 'jpeg', label: 'Photo', contentType: 'image/jpeg' },
  { ending: 'png', label: 'Photo', contentType: 'image/png' },
  { ending: 'heic', label: 'Photo', contentType: 'image/heic' },
  { ending: 'webp', label: 'Photo', contentType: 'image/webp' },
  { ending: 'doc', label: 'Word', contentType: 'application/msword' },
  { ending: 'docx', label: 'Word', contentType: WORD_X },
  { ending: 'xls', label: 'Excel', contentType: 'application/vnd.ms-excel' },
  { ending: 'xlsx', label: 'Excel', contentType: EXCEL_X },
  { ending: 'csv', label: 'Spreadsheet', contentType: 'text/csv' },
  { ending: 'txt', label: 'Text', contentType: 'text/plain' },
];

/** The kind of a picked file: its name's ending, or else the type the phone gave. Null when the club doesn't keep it. */
export function boardFileKind(name: string, mimeType: string | null): BoardFileKind | null {
  const ending = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ending) {
    const byName = BOARD_FILE_KINDS.find((k) => k.ending === ending);
    if (byName) return byName;
  }
  const type = (mimeType ?? '').toLowerCase();
  return BOARD_FILE_KINDS.find((k) => k.contentType === type) ?? null;
}

/** The name shown: trimmed, with its ending, 120 characters at most. A blank one is "Board file". */
export function boardFileName(name: string, ending: string): string {
  let base = name.trim();
  const tail = `.${ending}`;
  if (base.toLowerCase().endsWith(tail)) base = base.slice(0, base.length - tail.length);
  if (base.trim() === '') base = 'Board file';
  const room = NAME_MAX - [...tail].length;
  return [...base].slice(0, room).join('').trimEnd() + tail;
}

/** Where a file goes in the bucket: `<chapter or club>/<role or info>/<ref>.<ending>`. */
export function boardFilePath(folder: BoardFolderRef, ref: string, ending: string): string {
  return `${folder.chapterId ?? 'club'}/${folder.role ?? 'info'}/${ref}.${ending}`;
}

/** Whether a folder is one the club has. */
export function isBoardFolder(folder: BoardFolderRef, data: ClubData): boolean {
  if (folder.chapterId === null) return folder.role === null || NATIONAL_FOLDER_ROLES.includes(folder.role);
  return folder.role !== null && BOARD_ROLES.includes(folder.role) && data.chapters.some((c) => c.id === folder.chapterId);
}

/** Reads every board folder: a board seat in any chapter (covered or not), or the NEC. Mirrors private.is_any_board. */
export function readsBoardFiles(me: Member | null, positions: Position[]): boolean {
  return isAnyBoard(me, positions);
}

/**
 * Adds to and removes from a folder: any reader for Club info; for a seat, whoever does its duties
 * now (an acting holder does, a covered one doesn't) or the National Chairman or Secretary.
 * Mirrors private.board_folder_writer.
 */
export function writesBoardFolder(me: Member | null, folder: BoardFolderRef, data: ClubData): boolean {
  if (!me || !readsBoardFiles(me, data.positions)) return false;
  if (folder.role === null) return true;
  if (isNecOfficer(me.id, data.positions)) return true;
  return activePositions(me.id, data.positions).some((p) => p.role === folder.role && p.chapterId === folder.chapterId);
}

function folderProblem(me: Member | null, folder: BoardFolderRef, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!readsBoardFiles(me, data.positions)) return BF_READERS;
  if (!isBoardFolder(folder, data)) return BF_NO_FOLDER;
  return writesBoardFolder(me, folder, data) ? null : BF_SEAT_ONLY;
}

export function addBoardFileProblem(me: Member | null, folder: BoardFolderRef, file: PickedBoardFile, data: ClubData): string | null {
  const problem = folderProblem(me, folder, data);
  if (problem) return problem;
  if (!boardFileKind(file.name, file.mimeType)) return BF_TYPE;
  if (file.size !== null && file.size > BF_MAX_BYTES) return BF_BIG;
  return null;
}

export function removeBoardFileProblem(me: Member | null, id: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!readsBoardFiles(me, data.positions)) return BF_READERS;
  const f = (data.boardFiles ?? []).find((x) => x.id === id);
  if (!f) return BF_NO_FILE;
  return folderProblem(me, { chapterId: f.chapterId, role: f.role }, data);
}

// Screens --------------------------------------------------------------------------------------

const sameFolder = (f: BoardFile, folder: BoardFolderRef) => f.chapterId === folder.chapterId && f.role === folder.role;

/** A folder's files, newest first. */
export function folderFiles(folder: BoardFolderRef, data: ClubData): BoardFile[] {
  return (data.boardFiles ?? []).filter((f) => sameFolder(f, folder)).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/** A folder's full name: "Club info", "National Chairman", "West Treasurer". */
export function folderLabel(folder: BoardFolderRef, data: ClubData): string {
  if (folder.role === null) return 'Club info';
  if (folder.chapterId === null) return ROLE_LABEL[folder.role];
  const chapter = data.chapters.find((c) => c.id === folder.chapterId);
  return `${chapter?.name ?? 'Chapter'} ${ROLE_LABEL[folder.role]}`;
}

/** Who does the seat's duties now, by name ("Crank (acting)"); null when it's vacant. */
export function seatHolder(folder: BoardFolderRef, data: ClubData): string | null {
  if (folder.role === null) return null;
  const doing = data.positions.filter(
    (p) => p.role === folder.role && p.chapterId === folder.chapterId && activePositions(p.memberId, data.positions).some((a) => a.id === p.id),
  );
  const names = doing.map((p) => {
    const m = data.members.find((x) => x.id === p.memberId);
    return m ? `${displayName(m)}${isActing(p) ? ' (acting)' : ''}` : null;
  }).filter((n): n is string => n !== null);
  return names.length ? names.join(', ') : null;
}

export type BoardFolderRow = BoardFolderRef & {
  key: string;
  /** The heading it sits under: "Whole club", a chapter's name, or "National". */
  section: string;
  title: string;
  holder: string | null;
  count: number;
  canWrite: boolean;
};

/** Every folder `me` can open: Club info, my chapter's seats, the other chapters', then the national seats. */
export function boardFolders(me: Member | null, data: ClubData): BoardFolderRow[] {
  if (!me || !readsBoardFiles(me, data.positions)) return [];
  const row = (folder: BoardFolderRef, section: string): BoardFolderRow => ({
    ...folder,
    key: `${folder.chapterId ?? 'club'}/${folder.role ?? 'info'}`,
    section,
    title: folder.role === null ? 'Club info' : ROLE_LABEL[folder.role],
    holder: seatHolder(folder, data),
    count: folderFiles(folder, data).length,
    canWrite: writesBoardFolder(me, folder, data),
  });
  const chapters = [...data.chapters].sort((a, b) => Number(b.id === me.chapterId) - Number(a.id === me.chapterId));
  return [
    row({ chapterId: null, role: null }, 'Whole club'),
    ...chapters.flatMap((c) => BOARD_ROLES.map((role) => row({ chapterId: c.id, role }, c.name))),
    ...NATIONAL_FOLDER_ROLES.map((role) => row({ chapterId: null, role }, 'National')),
  ];
}

/** A file's size for people: "900 B", "2 KB", "1.5 MB". Blank when unknown. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}
