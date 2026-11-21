// 21 Nov 2026: Jeff wants anything tappable easy to find, so the Chat list's top icons carry a word each.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const chat = fs.readFileSync(path.resolve(import.meta.dirname, 'chat.tsx'), 'utf8');
const bits = fs.readFileSync(path.resolve(import.meta.dirname, '../ui/ChatBits.tsx'), 'utf8');

test('the Chat list header icons say what they do', () => {
  assert.match(chat, /label="Photos and ride walls" caption="Photos"/);
  assert.match(chat, /label="New group" caption="New group"/);
  assert.match(chat, /label="New private chat" caption="Message"/);
  assert.match(bits, /caption\?: string/);
});
