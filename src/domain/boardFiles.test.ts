import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import {
  addBoardFileProblem, BF_BIG, BF_MAX_BYTES, BF_NO_FILE, BF_NO_FOLDER, BF_READERS, BF_SEAT_ONLY, BF_TYPE, boardFileKind, boardFileName,
  boardFilePath, boardFolders, folderFiles, folderLabel, formatBytes, readsBoardFiles, removeBoardFileProblem, writesBoardFolder,
  type BoardFolderRef,
} from './boardFiles';
import type { BoardFile, ClubData, Member } from './types';

const file = (over: Partial<BoardFile>): BoardFile => ({
  id: 'bf-x', chapterId: null, role: null, path: 'club/info/x.pdf', name: 'x.pdf', sizeBytes: 1000, addedBy: 'm-rusty',
  addedAt: '2026-10-20T01:00:00.000Z', ...over,
});

const data: ClubData = {
  ...DEMO_DATA,
  boardFiles: [
    file({ id: 'bf-1', name: 'Public liability 2026.pdf', addedAt: '2026-10-01T01:00:00.000Z' }),
    file({ id: 'bf-2', name: 'Certificate of incorporation.pdf', addedAt: '2026-10-05T01:00:00.000Z' }),
    file({ id: 'bf-3', chapterId: 'ch-west', role: 'treasurer', path: 'ch-west/treasurer/a.xlsx', name: 'Budget.xlsx', addedBy: 'm-gravel' }),
    file({ id: 'bf-4', chapterId: null, role: 'nec_chair', path: 'club/nec_chair/b.docx', name: 'Chair handover.docx' }),
  ],
};
const me = (id: string): Member => data.members.find((m) => m.id === id)!;
const CLUB: BoardFolderRef = { chapterId: null, role: null };
const WEST_TREASURER: BoardFolderRef = { chapterId: 'ch-west', role: 'treasurer' };
const NORTH_TREASURER: BoardFolderRef = { chapterId: 'ch-north', role: 'treasurer' };
const NEC_CHAIR: BoardFolderRef = { chapterId: null, role: 'nec_chair' };
const pdf = { name: 'Insurance.pdf', size: 200_000, mimeType: 'application/pdf' };

test('board files are read by board members of any chapter and the NEC, nobody else', () => {
  for (const id of ['m-rusty', 'm-torque', 'm-sparks', 'm-diesel', 'm-gravel', 'm-smokey', 'm-jet', 'm-crank']) {
    assert.equal(readsBoardFiles(me(id), data.positions), true, id);
  }
  // The Auditor (an Officer too), a Tail Gunner, a plain member, Legacy, Family, an applicant, nobody.
  for (const id of ['m-ace', 'm-spanner', 'm-chook', 'm-rooster', 'm-kerry', 'm-dylan']) {
    assert.equal(readsBoardFiles(me(id), data.positions), false, id);
  }
  assert.equal(readsBoardFiles(null, data.positions), false);
});

test('a seat folder is changed by whoever does the seat’s duties, or the National Chairman or Secretary', () => {
  assert.equal(writesBoardFolder(me('m-sparks'), WEST_TREASURER, data), true, 'the Treasurer');
  assert.equal(writesBoardFolder(me('m-torque'), WEST_TREASURER, data), false, 'the Secretary isn’t the Treasurer');
  assert.equal(writesBoardFolder(me('m-gravel'), WEST_TREASURER, data), false, 'a past Treasurer has handed it on');
  assert.equal(writesBoardFolder(me('m-rusty'), WEST_TREASURER, data), true, 'the National Chairman');
  assert.equal(writesBoardFolder(me('m-crank'), NORTH_TREASURER, data), true, 'an Acting Treasurer does the duties');
  assert.equal(writesBoardFolder(me('m-crank'), WEST_TREASURER, data), false, 'not another chapter’s');
  assert.equal(writesBoardFolder(me('m-smokey'), NORTH_TREASURER, data), false, 'a President isn’t the Treasurer');
  assert.equal(writesBoardFolder(me('m-rusty'), NEC_CHAIR, data), true);
  assert.equal(writesBoardFolder(me('m-smokey'), NEC_CHAIR, data), false);
  // A covered holder hands the duties to the cover while it lasts.
  const covered: ClubData = {
    ...data,
    positions: [
      ...data.positions,
      { id: 'p-cv', memberId: 'm-jet', chapterId: 'ch-west', role: 'treasurer', startedOn: '2026-10-01', endedOn: null, actingUntil: '2026-12-01', covers: 'p-5' },
    ],
  };
  assert.equal(writesBoardFolder(me('m-sparks'), WEST_TREASURER, covered), false, 'covered');
  assert.equal(writesBoardFolder(me('m-jet'), WEST_TREASURER, covered), true, 'the cover');
  assert.equal(readsBoardFiles(me('m-sparks'), covered.positions), true, 'a covered holder still reads');
});

test('Club info is changed by any reader', () => {
  for (const id of ['m-rusty', 'm-torque', 'm-sparks', 'm-jet', 'm-crank']) assert.equal(writesBoardFolder(me(id), CLUB, data), true, id);
  for (const id of ['m-ace', 'm-chook']) assert.equal(writesBoardFolder(me(id), CLUB, data), false, id);
});

test('adding a file: the folder’s writer, a real folder, a kind the club keeps, 20 MB or less', () => {
  assert.equal(addBoardFileProblem(me('m-sparks'), WEST_TREASURER, pdf, data), null);
  assert.equal(addBoardFileProblem(null, WEST_TREASURER, pdf, data), 'Sign in first.');
  assert.equal(addBoardFileProblem(me('m-chook'), CLUB, pdf, data), BF_READERS);
  assert.equal(addBoardFileProblem(me('m-torque'), WEST_TREASURER, pdf, data), BF_SEAT_ONLY);
  assert.equal(addBoardFileProblem(me('m-rusty'), { chapterId: 'ch-west', role: 'tail_gunner' }, pdf, data), BF_NO_FOLDER);
  assert.equal(addBoardFileProblem(me('m-rusty'), { chapterId: 'ch-nowhere', role: 'treasurer' }, pdf, data), BF_NO_FOLDER);
  assert.equal(addBoardFileProblem(me('m-rusty'), { chapterId: null, role: 'nec_auditor' }, pdf, data), BF_NO_FOLDER);
  assert.equal(addBoardFileProblem(me('m-rusty'), { chapterId: 'ch-west', role: null }, pdf, data), BF_NO_FOLDER);
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { name: 'tool.exe', size: 10, mimeType: 'application/octet-stream' }, data), BF_TYPE);
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { name: 'IMG_0042', size: 10, mimeType: 'image/jpeg' }, data), null, 'the type is enough');
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { name: 'Minutes.DOCX', size: 10, mimeType: null }, data), null, 'so is the name');
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { ...pdf, size: BF_MAX_BYTES }, data), null, '20 MB is fine');
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { ...pdf, size: BF_MAX_BYTES + 1 }, data), BF_BIG);
  assert.equal(addBoardFileProblem(me('m-sparks'), CLUB, { ...pdf, size: null }, data), null, 'an unknown size is left to the bucket');
});

test('removing a file: the writer of its folder, whoever added it', () => {
  assert.equal(removeBoardFileProblem(me('m-sparks'), 'bf-3', data), null, 'the Treasurer tidies a file a past Treasurer added');
  assert.equal(removeBoardFileProblem(me('m-gravel'), 'bf-3', data), BF_SEAT_ONLY, 'who added it has left the seat');
  assert.equal(removeBoardFileProblem(me('m-jet'), 'bf-1', data), null, 'Club info');
  assert.equal(removeBoardFileProblem(me('m-chook'), 'bf-1', data), BF_READERS);
  assert.equal(removeBoardFileProblem(me('m-sparks'), 'bf-9', data), BF_NO_FILE);
  assert.equal(removeBoardFileProblem(null, 'bf-1', data), 'Sign in first.');
});

test('kinds, names, paths and sizes', () => {
  assert.deepEqual(boardFileKind('Budget.XLSX', null), {
    ending: 'xlsx', label: 'Excel', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  assert.equal(boardFileKind('scan.jpeg', null)?.label, 'Photo');
  assert.equal(boardFileKind('IMG_1', 'image/heic')?.ending, 'heic');
  assert.equal(boardFileKind('notes', 'text/plain')?.ending, 'txt');
  assert.equal(boardFileKind('a.pdf', 'image/png')?.ending, 'pdf', 'the name wins over the type');
  assert.equal(boardFileKind('a.zip', 'application/zip'), null);
  assert.equal(boardFileName('  Insurance.pdf  ', 'pdf'), 'Insurance.pdf');
  assert.equal(boardFileName('IMG_0042', 'jpg'), 'IMG_0042.jpg', 'the ending is added');
  assert.equal(boardFileName('   ', 'pdf'), 'Board file.pdf');
  const long = boardFileName('x'.repeat(130) + '.docx', 'docx');
  assert.equal([...long].length, 120);
  assert.ok(long.endsWith('.docx'), 'a long name keeps its ending');
  assert.equal(boardFilePath(CLUB, 'r1', 'pdf'), 'club/info/r1.pdf');
  assert.equal(boardFilePath(NEC_CHAIR, 'r1', 'docx'), 'club/nec_chair/r1.docx');
  assert.equal(boardFilePath(WEST_TREASURER, 'r1', 'xlsx'), 'ch-west/treasurer/r1.xlsx');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1_572_864), '1.5 MB');
  assert.equal(formatBytes(null), '');
});

test('the folder list: Club info, my chapter’s seats, the other chapter’s, then the national seats', () => {
  const folders = boardFolders(me('m-smokey'), data);
  assert.deepEqual(folders.map((f) => f.title), [
    'Club info',
    'President', 'Vice President', 'Secretary', 'Treasurer', 'Sergeant at Arms', 'Road Captain',
    'President', 'Vice President', 'Secretary', 'Treasurer', 'Sergeant at Arms', 'Road Captain',
    'National Chairman', 'National Secretary',
  ]);
  assert.deepEqual([...new Set(folders.map((f) => f.section))], ['Whole club', 'North', 'West', 'National']);
  const club = folders[0];
  assert.equal(club.count, 2);
  assert.equal(club.holder, null);
  const northTreasurer = folders.find((f) => f.section === 'North' && f.title === 'Treasurer')!;
  assert.equal(northTreasurer.holder, 'Crank (acting)');
  assert.equal(northTreasurer.canWrite, false);
  const northSecretary = folders.find((f) => f.section === 'North' && f.title === 'Secretary')!;
  assert.equal(northSecretary.holder, null, 'vacant');
  const westTreasurer = folders.find((f) => f.section === 'West' && f.title === 'Treasurer')!;
  assert.deepEqual([westTreasurer.holder, westTreasurer.count], ['Sparks', 1]);
  assert.deepEqual(boardFolders(me('m-chook'), data), [], 'nothing for a non-reader');
  assert.equal(folderLabel(WEST_TREASURER, data), 'West Treasurer');
  assert.equal(folderLabel(NEC_CHAIR, data), 'National Chairman');
  assert.equal(folderLabel(CLUB, data), 'Club info');
});

test('a folder’s files, newest first', () => {
  assert.deepEqual(folderFiles(CLUB, data).map((f) => f.id), ['bf-2', 'bf-1']);
  assert.deepEqual(folderFiles(WEST_TREASURER, data).map((f) => f.id), ['bf-3']);
  assert.deepEqual(folderFiles(NORTH_TREASURER, data), []);
});
