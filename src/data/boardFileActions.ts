// Board files in the demo, and the live read (spec 2026-11-24-board-files-design.md). The live
// actions upload into the board-files bucket and call add_board_file / remove_board_file
// (LiveClubProvider); both apply the rules in src/domain/boardFiles.ts first.

import {
  addBoardFileProblem, boardFileKind, boardFileName, removeBoardFileProblem, type BoardFolderRef, type PickedBoardFile,
} from '../domain/boardFiles';
import type { BoardFile, ClubData } from '../domain/types';
import type { Database } from './database.types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = () => `bf-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

/** Files a picked file in a folder. The demo keeps the picked file's own address as its path. */
export function addBoardFile(ctx: DemoCtx, folder: BoardFolderRef, file: PickedBoardFile & { uri: string }): { data: ClubData; id: string } {
  refuse(addBoardFileProblem(ctx.me, folder, file, ctx.data));
  const kind = boardFileKind(file.name, file.mimeType)!;
  const added: BoardFile = {
    id: newId(), chapterId: folder.chapterId, role: folder.role, path: file.uri, name: boardFileName(file.name, kind.ending),
    sizeBytes: file.size, addedBy: ctx.me!.id, addedAt: ctx.now ?? new Date().toISOString(),
  };
  return { data: { ...ctx.data, boardFiles: [...(ctx.data.boardFiles ?? []), added] }, id: added.id };
}

export function removeBoardFile(ctx: DemoCtx, id: string): ClubData {
  refuse(removeBoardFileProblem(ctx.me, id, ctx.data));
  return { ...ctx.data, boardFiles: (ctx.data.boardFiles ?? []).filter((f) => f.id !== id) };
}

/** The seeded demo files have no bytes behind them; files added in the demo open from the phone. */
export const DEMO_FILE_PREFIX = 'demo/';
export function demoBoardFileUrl(path: string): string {
  if (path.startsWith(DEMO_FILE_PREFIX)) throw new NotAllowedError('The demo’s own files don’t open. Add one of yours to try it.');
  return path;
}

type BoardFileRow = Database['public']['Tables']['board_files']['Row'];

export function toBoardFiles(rows: BoardFileRow[] | null | undefined): BoardFile[] {
  return (rows ?? []).map((r) => ({
    id: r.id, chapterId: r.chapter_id, role: r.role, path: r.path, name: r.name,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes), addedBy: r.added_by, addedAt: new Date(r.added_at).toISOString(),
  }));
}
