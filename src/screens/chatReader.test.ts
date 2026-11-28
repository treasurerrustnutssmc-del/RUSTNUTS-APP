// On iPhone, VoiceOver reads a button as one item and never looks inside it. A chat message's own button
// held the voice note's play button, the photos, the link card and the links in the words, so VoiceOver
// couldn't reach any of them. On iPhone only, the message's button now stands aside for VoiceOver (it
// keeps every tap) and a plain View behind the content carries the message's words and its double-tap.
// The plain words are hidden from VoiceOver so nothing is read twice, and each control is a stop of its own.
// Android (TalkBack) and the web already reach each control, so they keep exactly what they had.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8');
const block = (src: string, start: string, end: string) => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `found ${start}`);
  return src.slice(at, src.indexOf(end, at));
};
const HINT = 'accessibilityHint="Shows reactions and what you can do with this message"';
const message = () => block(read('chat.tsx'), 'const renderMessage = ', '\n  };\n');
/** The message's own Pressable, from its opening tag to its close. */
const messageButton = () => {
  const msg = message();
  const hint = msg.indexOf(HINT);
  const open = msg.lastIndexOf('<Pressable', hint);
  return msg.slice(open, msg.indexOf('</Pressable>', hint));
};

test('on iPhone the message’s button keeps every tap but stops being one VoiceOver item', () => {
  const msg = message();
  assert.match(msg, /const ios = Platform\.OS === 'ios';/);
  assert.match(msg, /const toggle = \(\) => \{\s*setSelected\(isSelected \? null : m\.id\);\s*setReporting\(null\);\s*\};/);
  const tag = messageButton().slice(0, messageButton().indexOf('>\n'));
  assert.match(tag, /onPress=\{toggle\}/);
  assert.match(tag, /accessible=\{ios \? false : undefined\}/, 'Android and the web keep the default');
  assert.match(tag, /accessibilityRole="button"/);
});

test('the message’s own VoiceOver stop is the first thing inside it, iPhone only, and takes no touches', () => {
  const button = messageButton();
  const body = button.slice(button.indexOf('>\n') + 2);
  // First child: the reader, only on iPhone.
  assert.match(body, /^\s*(\{\/\*[\s\S]*?\*\/\}\s*)?\{ios \? \(\s*<View\b/, 'the reader comes first, so everything else sits above it for taps');
  const reader = body.slice(body.indexOf('<View'), body.indexOf('/>', body.indexOf('<View')));
  assert.match(reader, /\baccessible\b/);
  assert.match(reader, /accessibilityRole="button"/);
  assert.match(reader, /accessibilityLabel=\{spoken\}/);
  assert.ok(reader.includes(HINT), 'the same hint as the message');
  assert.match(reader, /accessibilityState=\{\{ selected: isSelected \}\}/);
  assert.match(reader, /onAccessibilityTap=\{toggle\}/, 'without it VoiceOver taps the middle of the bubble, which can open a photo');
  // Exactly the bubble's box: VoiceOver draws its own square focus ring, so corner styles would do nothing.
  assert.match(reader, /style=\{StyleSheet\.absoluteFill\}/);
  assert.doesNotMatch(read('chat.tsx'), /bubbleReader/);
  // A plain View with no touch handling: a tap anywhere still reaches the message's button.
  assert.doesNotMatch(reader, /onPress|onPressIn|onLongPress|onStartShouldSetResponder|onResponder|pointerEvents|accessibilityActions|zIndex|backgroundColor|borderWidth/);
});

test('the reader says what is on screen, in the same words the bubble shows', () => {
  const msg = message();
  const spoken = block(msg, 'const spoken = ', ';\n');
  assert.match(spoken, /ios\s*\?\s*messageSpoken\(/, 'built only on iPhone');
  assert.match(spoken, /author: showAuthor && !nameLinks \? authorSpoken\(author, data\) : undefined/, 'the name only when it is no button of its own');
  assert.match(spoken, /quote: m\.replyToId \? \{ name: replied \? nameOf\(replied\.authorId\) : '', words: quoteWords\(replied\) \} : undefined/);
  assert.match(spoken, /media: m\.media/);
  assert.match(spoken, /body: m\.body/);
  assert.match(spoken, /time: last \|\| isSelected \? melbourneTime\(m\.createdAt\) : undefined/, 'the time only when it shows');
  // The time on screen shows under the same rule.
  assert.match(msg, /\{last \|\| isSelected \? <Text accessibilityElementsHidden=\{ios\}/);
});

test('the plain words inside a message are hidden from VoiceOver on iPhone, so nothing is read twice', () => {
  const button = messageButton();
  assert.match(button, /<View style=\{styles\.bubbleNameText\} accessibilityElementsHidden=\{ios\}>/);
  assert.match(button, /<ReplyQuote message=\{replied\} author=\{replied \? nameOf\(replied\.authorId\) : ''\} spokenByMessage=\{ios\} \/>/);
  assert.match(button, /<VoiceNote [^>]*hideTimeFromReader=\{ios\} \/>/);
  assert.match(button, /<MessageText body=\{m\.body\} spokenByMessage=\{ios\}[^>]*\/>/);
  // A GIF tile does what the message's stop does (a double-tap selects the message), so on iPhone the
  // reader's "GIF" covers it; photos and videos open the viewer and stay stops of their own.
  assert.match(button, /<MediaGrid\b[^/]*spokenByMessage=\{ios\}/);
  // Every way of selecting the message is the same toggle, so the GIF also closes an open report.
  assert.match(button, /if \(shown\.kind === 'gif'\) return toggle\(\);/);
  assert.equal(message().match(/setSelected\(isSelected \? null : m\.id\)/g)?.length, 1, 'only toggle selects the message');
  assert.match(button, /<LinkCard url=\{firstLink\} \/>/);
});

/** The opening tag of the first Pressable after a marker, so a prop on it is checked wherever it sits. */
const pressableAfter = (src: string, marker: string) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `found ${marker}`);
  const open = src.indexOf('<Pressable', at);
  return src.slice(open, src.indexOf('>\n', open));
};
const NOT_HIDDEN = /accessible=\{false\}|accessibilityElementsHidden|importantForAccessibility/;

test('the controls inside a message stay VoiceOver stops of their own', () => {
  const bits = read('../ui/ChatBits.tsx');
  // Each photo or video tile: an image button, hidden only when it is a GIF the message's stop covers.
  const tile = pressableAfter(bits, 'export function MediaTile(');
  assert.match(tile, /accessibilityRole=\{onPress \? 'imagebutton' : 'image'\}/);
  assert.match(tile, /accessibilityElementsHidden=\{hiddenFromReader\}/);
  assert.doesNotMatch(tile, /accessible=\{false\}|importantForAccessibility/);
  const grid = block(bits, 'export function MediaGrid(', '\n}\n');
  assert.equal(grid.match(/hiddenFromReader=\{spokenByMessage && m\.kind === 'gif'\}/g)?.length, 2, 'one photo or a grid');
  // The link card: one link stop.
  const card = pressableAfter(bits, 'export function LinkCard(');
  assert.match(card, /accessibilityRole="link"/);
  assert.doesNotMatch(card, NOT_HIDDEN);
  // The play button: never hidden, whatever the time beside it does.
  const voice = read('../ui/VoiceBits.tsx');
  const play = pressableAfter(voice, 'export function VoiceNote(');
  assert.match(play, /onPress=\{toggle\}/);
  assert.match(play, /accessibilityRole="button"/);
  assert.doesNotMatch(play, NOT_HIDDEN);
});

test('elsewhere the quote and the voice note stay as they were (the composer and the report screen)', () => {
  const chat = read('chat.tsx');
  assert.match(chat, /<ReplyQuote message=\{replyTo\} author=\{`Replying to \$\{nameOf\(replyTo\.authorId\)\}`\} \/>/);
  assert.match(chat, /<VoiceNote media=\{r\.message\.voice\} width=\{260\} \/>/);
});

test('ChatBits: the quote, the words and the tiles share their words with the reader', () => {
  const bits = read('../ui/ChatBits.tsx');
  const quote = block(bits, 'export function ReplyQuote(', '\n}\n');
  assert.match(quote, /spokenByMessage\?: boolean/);
  assert.match(quote, /const words = quoteWords\(message\);/);
  assert.match(quote, /<View style=\{styles\.quote\} accessibilityElementsHidden=\{spokenByMessage\}>/);
  const tile = block(bits, 'export function MediaTile(', '\n}\n');
  assert.match(tile, /const kindWord = mediaKindWord\(media\.kind\);/);
});

test('MessageText on iPhone: the words are hidden, and each link is a link stop behind the words', () => {
  const bits = read('../ui/ChatBits.tsx');
  const text = block(bits, 'export function MessageText(', '\n}\n');
  assert.match(text, /spokenByMessage\?: boolean/);
  assert.match(text, /<Text style=\{styles\.body\} selectable accessibilityElementsHidden=\{spokenByMessage\}>/);
  assert.match(text, /const parts = findLinks\(body\);/);
  assert.match(text, /const links = parts\.filter\(\(p\) => p\.url\);/);
  assert.match(text, /if \(!spokenByMessage \|\| !links\.length\) return words;/, 'otherwise the words exactly as before');
  // A wrapper with no style, so the layout is the same; the link stops come before the words, so the
  // words stay on top for taps, links and Copy.
  assert.match(text, /return \(\s*<View>\s*\{links\.map\(/, 'an unstyled wrapper, link stops first');
  const from = text.indexOf('links.map(');
  assert.ok(from < text.indexOf('{words}'), 'link stops first');
  const stop = text.slice(text.indexOf('<View', from), text.indexOf('/>', text.indexOf('<View', from)));
  assert.match(stop, /\baccessible\b/);
  assert.match(stop, /accessibilityRole="link"/);
  assert.match(stop, /accessibilityLabel=\{p\.text\}/);
  assert.match(stop, /onAccessibilityTap=\{\(\) => openLink\(p\.url!\)\.catch\(\(\) => \{\}\)\}/);
  assert.match(stop, /StyleSheet\.absoluteFill/);
  assert.doesNotMatch(stop, /onPress|pointerEvents|zIndex|backgroundColor/);
});

test('VoiceNote on iPhone: the time beside the play button is hidden while it shows the length the button says', () => {
  const voice = read('../ui/VoiceBits.tsx');
  const note = block(voice, 'export function VoiceNote(', '\n}\n');
  assert.match(note, /hideTimeFromReader\?: boolean/);
  assert.match(note, /<Text style=\{styles\.cant\} numberOfLines=\{1\} accessibilityElementsHidden=\{hideTimeFromReader\}>/);
  // Once played, the time shows how far through, which the button doesn't say, so VoiceOver reads it.
  assert.match(note, /const showsAt = status\.playing \|\| at > 0;/);
  assert.match(note, /<Text style=\{styles\.noteTime\} accessibilityElementsHidden=\{hideTimeFromReader && !showsAt\}>\{clock\(showsAt \? at : length\)\}<\/Text>/);
  // The play button already says the length, or that it can't be played.
  assert.match(note, /accessibilityLabel=\{broken \? 'Voice note that can’t be played' : `\$\{status\.playing \? 'Pause' : 'Play'\} voice note, \$\{clock\(length\)\}`\}/);
});
