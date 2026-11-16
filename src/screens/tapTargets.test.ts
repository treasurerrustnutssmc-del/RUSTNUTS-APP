// Small things stay easy to hit: a chat author's name is a 25px line, so its button is itself 44pt tall,
// and it's a button of its own above the message's, so a screen reader reaches it. The Welcome page folds its 13 club links into one group so the first screen is calm.
// Home's three answers under Next ride stay one even row, and don't change height while one saves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');

test('the author name above a chat message is itself 44pt tall, not just given a bigger invisible area', () => {
  const chat = read('chat.tsx');
  const at = chat.indexOf('accessibilityLabel={authorPageLabel(author, data)}');
  const block = chat.slice(at - 500, at + 400);
  assert.match(block, /style=\{styles\.bubbleName\}/);
  // 44 tall under its 8 of top padding, which it takes over from the bubble.
  assert.match(chat, /bubbleName: \{ minHeight: 44 \+ space\.sm, paddingTop: space\.sm,/);
});

test('the chat name and the message are two buttons, the name above the message, so iPhone VoiceOver can stop on the name', () => {
  // VoiceOver treats a button as one item, so a name button inside the message's button can't be reached.
  const chat = read('chat.tsx');
  const start = chat.indexOf('const renderMessage = ');
  const msg = chat.slice(start, chat.indexOf('\n  };\n', start));
  const shell = msg.indexOf('<View style={[styles.bubbleShell');
  const name = msg.indexOf('accessibilityLabel={authorPageLabel(author, data)}');
  const body = msg.indexOf('accessibilityHint="Shows reactions and what you can do with this message"');
  assert.ok(shell > 0 && name > shell && body > name, 'shell, then the name button, then the message button');
  // The name button closes before the message button opens: siblings, not nested.
  const between = msg.slice(name, body);
  assert.match(between, /<\/Pressable>[\s\S]*<Pressable/);
  // The shell keeps everything the bubble's look needs: its colour or border, its width limit, the selected border.
  assert.match(msg, /<View style=\{\[styles\.bubbleShell, mine \? styles\.bubbleMine : styles\.bubbleTheirs, \{ maxWidth: bubbleWidth \}, isSelected && styles\.bubbleSelected\]\}>/);
  const bodyTag = msg.slice(msg.lastIndexOf('<Pressable', body), msg.indexOf('>\n', body));
  assert.doesNotMatch(bodyTag, /bubbleSelected|bubbleTheirs|bubbleMine|maxWidth/, 'the look stays on the shell, not on the message button');
  // The two buttons cover the whole bubble, at the sizes it had: 8 above the 44pt name, 6 under it, 12 at the sides.
  // Each button has the bubble's rounded corners on its outer edges, so a keyboard focus ring on the web follows the bubble.
  assert.match(chat, /bubbleShell: \{ borderRadius: radius\.md \},/);
  assert.match(chat, /bubbleName: \{ minHeight: 44 \+ space\.sm, paddingTop: space\.sm, paddingHorizontal: space\.md, justifyContent: 'center', borderTopLeftRadius: radius\.md, borderTopRightRadius: radius\.md \},/);
  assert.match(chat, /bubbleBody: \{ paddingHorizontal: space\.md, paddingVertical: space\.sm, gap: 6, borderRadius: radius\.md \},/);
  assert.match(chat, /bubbleBodyUnderName: \{ paddingTop: 6, borderTopLeftRadius: 0, borderTopRightRadius: 0 \},/);
  assert.match(msg, /style=\{\[styles\.bubbleBody, nameLinks && styles\.bubbleBodyUnderName\]\}/);
});

test('a chat name that opens no page (Family viewers, a former member) stays inside the message button', () => {
  // A disabled button takes no tap, so beside the message it would leave a dead strip; inside, a tap selects the message.
  const chat = read('chat.tsx');
  const start = chat.indexOf('const renderMessage = ');
  const msg = chat.slice(start, chat.indexOf('\n  };\n', start));
  assert.match(msg, /const nameLinks = showAuthor && author !== undefined && !family;/);
  assert.match(msg, /\{nameLinks \? \(\s*<Pressable\b/, 'only a name that opens a page is a button of its own');
  assert.doesNotMatch(msg, /disabled=\{!author \|\| family\}/, 'no disabled name button left beside the message');
  const body = msg.indexOf('accessibilityHint="Shows reactions and what you can do with this message"');
  const inside = msg.slice(body, msg.indexOf('</Pressable>', body));
  assert.match(inside, /\{showAuthor && !nameLinks \? \(\s*<View style=\{styles\.bubbleNameText\}>\s*<AuthorLine member=\{author\} data=\{data\} \/>/);
  assert.match(chat, /bubbleNameText: \{ minHeight: 44, justifyContent: 'center' \},/);
});

test('a reaction chip under a message is 44pt tall', () => {
  const bits = fs.readFileSync(path.resolve(import.meta.dirname, '../ui/ChatBits.tsx'), 'utf8');
  const at = bits.indexOf('  pill: {');
  assert.match(bits.slice(at, at + 400), /minHeight: 44/);
});

test('the Welcome page folds the club links into one group', () => {
  const pub = read('public.tsx');
  const start = pub.indexOf('export function WelcomeScreen');
  const welcome = pub.slice(start, pub.indexOf('export function SignInScreen'));
  assert.match(welcome, /<Disclosure[^>]*title="Find the club online"/);
});

// The three answer buttons under Next ride on Home, from the opening tag to its close, so a prop written
// above the label is checked too.
const homeAnswers = () => {
  const rides = read('rides.tsx');
  const start = rides.indexOf('export function HomeNextRideCard');
  const card = rides.slice(start, rides.indexOf('export function RideRow'));
  const at = card.indexOf("a === 'no' ? 'Can’t go'");
  assert.ok(at >= 0, 'the Home card keeps its own short label');
  const open = card.lastIndexOf('<Button', at);
  assert.ok(open >= 0, 'the answers are Buttons');
  return { card, button: card.slice(open, card.indexOf('/>', at)) };
};

test('the three one-tap answers under Next ride on Home stay one row of equal buttons', () => {
  // "Can’t go" is the longest of the three. With the full button padding it wrapped to two lines in a
  // third of a phone's width, which left that button taller than Going and Maybe.
  const { button } = homeAnswers();
  // Equal thirds; slim sides give the label room; stretching keeps the three the same height where one
  // still wraps (a narrow phone, or large text).
  assert.match(button, /flex: 1/);
  assert.match(button, /paddingHorizontal: space\.xs/);
  assert.match(button, /alignSelf: 'stretch'/);
  // The answers stay full-size buttons: the 48pt touch target comes from the regular size.
  assert.doesNotMatch(button, /size="small"/);
});

test('saving an answer on Home does not make the row jump', () => {
  // A spinner beside the label takes 28pt, enough to push "Can’t go" onto a second line and stretch all
  // three buttons for the length of the save. The answer being saved shows as chosen instead, the other
  // two dim, and another tap is ignored while the first saves.
  const { card, button } = homeAnswers();
  assert.doesNotMatch(button, /\bbusy=\{/, 'no spinner beside these labels');
  assert.match(button, /kind=\{\(busy \?\? mine\) === a \? 'primary' : 'secondary'\}/);
  assert.match(button, /disabled=\{busy !== null && busy !== a\}/);
  const answer = card.slice(card.indexOf('const answer = async'), card.indexOf('setBusy(a)'));
  assert.match(answer, /if \(saving\.current\) return;\s+saving\.current = true;/, 'another tap is ignored while the first saves');
  assert.match(card, /finally \{\s+saving\.current = false;\s+setBusy\(null\);/, 'the next tap works once the save has finished');
});
