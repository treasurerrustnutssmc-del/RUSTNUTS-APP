// Small phones: at 360 wide a sweep found names, titles and dates cut short with "…" beside a chip,
// a button or a time. Each row below either shows its text in full (ListRow lines="all", or no
// numberOfLines on its own Text) or gets a second line. A few previews keep their clamp on purpose:
// they are a taste of a message, and the whole message is a tap away.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, file), 'utf8');

/** One top-level function or component: from `signature` to the first `}` alone on its line. */
function block(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `found ${signature}`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `found where ${signature} ends`);
  return source.slice(start, end);
}

/** The opening tag that starts at `start`, up to its `>` outside any `{…}`. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`the tag at ${start} never closes`);
}

/** The opening tag of the `<name>` element that holds `marker`, as one of its props or as its first child. */
function tagHolding(source: string, marker: string, name: string): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `found ${marker}`);
  assert.equal(source.indexOf(marker, at + 1), -1, `${marker} appears once`);
  let start = source.lastIndexOf(`<${name}`, at - 1);
  while (start !== -1 && !/[\s>]/.test(source[start + name.length + 1])) start = source.lastIndexOf(`<${name}`, start - 1);
  assert.notEqual(start, -1, `found the <${name}> around ${marker}`);
  const tag = openingTag(source, start);
  const inside = start + tag.length > at;
  assert.ok(inside || /^\s*$/.test(source.slice(start + tag.length, at)), `${marker} is in that <${name}> or its first child`);
  return tag;
}

const ALL = /\blines="all"/;
const CLAMP = /\bnumberOfLines=/;
const TWO = /\bnumberOfLines=\{2\}/;

// ---------------------------------------------------------------------------
// Matter today, with the demo data
// ---------------------------------------------------------------------------

test('Home shout-outs: the Today chip only on your own shout-out, so the name and reason have room beside G’day', () => {
  const row = block(read('social.tsx'), 'function ShoutoutRow(');
  assert.match(row, /const gday = today && !s\.isMe;/, 'one test for when the G’day button shows');
  assert.match(row, /\{gday \? null : today \? \(\s*<View[^>]*>\s*<Chip label="Today" tone="red" \/>/, 'no chip when G’day follows');
  assert.match(row, /\{gday \? \(\s*<Pressable[\s\S]*?<Text style=\{type\.name\}>G’day<\/Text>/, 'G’day stays');
  assert.equal(row.match(/<Chip label="Today"/g)?.length, 1);
  assert.match(tagHolding(row, '{name}</Text>', 'Text'), TWO, 'a long road name takes two lines');
  assert.match(tagHolding(row, '{shoutoutLine(s)}</Small>', 'Small'), TWO, 'the reason takes two lines');
  assert.match(tagHolding(row, '{shoutoutLine(s)}</Small>', 'Small'), /flexShrink: 1/, 'the reason wraps beside its icon');
});

test('Illustrated Road Rules: a rule title shows in full', () => {
  const tag = tagHolding(read('roadRulesGuide.tsx'), 'title={r.title}', 'ListRow');
  assert.match(tag, ALL);
});

test('Ask the club: the starter questions show in full', () => {
  const tag = tagHolding(read('askClub.tsx'), 'title={s}', 'ListRow');
  assert.match(tag, ALL);
});

test('Board: an FNG review row shows its review date beside the Overdue chip', () => {
  const tag = tagHolding(read('board.tsx'), '-month review ${formatLongDate(', 'ListRow');
  assert.match(tag, ALL);
});

test('Chat list: a chat name takes two lines beside the time', () => {
  const list = block(read('chat.tsx'), 'export function ChatListScreen(');
  assert.match(tagHolding(list, '{s.title}</Text>', 'Text'), TWO);
});

test('Chat and ride wall: the header title wraps to two lines in the header stencil, and the title is still set', () => {
  const nav = read('../navigation/RootNavigator.tsx');
  // The header's own stencil and colour, with a line height that fits two lines in the bar. iOS lays
  // a custom title out as wide as the screen, under its back arrow, so it keeps its native title.
  assert.match(
    nav,
    /const twoLineHeader: NativeStackNavigationOptions =\s*Platform\.OS === 'ios'\s*\? \{\}\s*: \{ headerTitle: \(props\) => <HeaderTitle \{\.\.\.props\} numberOfLines=\{2\} style=\{\[headerOptions\.headerTitleStyle, \{ lineHeight: 24 \}\]\} \/> \};/,
  );
  assert.match(nav, /import \{ HeaderBackButton, HeaderTitle \} from '@react-navigation\/elements';/);
  const chats = nav.match(/<Stack\.Screen name="Chat" [^\n]*\/>/g) ?? [];
  assert.equal(chats.length, 2, 'the member and the Family chat screens');
  for (const c of chats) assert.match(c, /options=\{\{ title: 'Chat', \.\.\.twoLineHeader \}\}/);
  assert.match(nav, /<Stack\.Screen name="RideWall" component=\{RideWallScreen\} options=\{\{ title: 'Ride wall', \.\.\.twoLineHeader \}\} \/>/);
  // The title string stays: screen readers and the web tab title read it.
  assert.match(read('chat.tsx'), /navigation\.setOptions\(\{ title \}\);/);
  assert.match(read('photos.tsx'), /navigation\.setOptions\(\{ title: wall\.ride\.title \}\);/);
});

test('Rides list and Home Next ride: a ride title is never cut short', () => {
  const rides = read('rides.tsx');
  const row = block(rides, 'export function RideRow(');
  const tag = tagHolding(row, '{ride.title}\n', 'Text');
  assert.doesNotMatch(tag, CLAMP);
  assert.match(tag, /type\.name/);
  const next = block(rides, 'export function HomeNextRideCard(');
  assert.match(next, /<RideRow\b/, 'Home Next ride is the same row');
  assert.doesNotMatch(next, CLAMP, 'with no clamp of its own');
});

test('Club documents: a title shows in full beside a Review overdue or Sign chip', () => {
  const tag = tagHolding(block(read('documents.tsx'), 'function DocumentRow('), 'title={doc.title}', 'ListRow');
  assert.match(tag, ALL);
});

test('Treasury ledger: an entry title takes two lines', () => {
  const tag = tagHolding(block(read('treasury.tsx'), 'function EntryRow('), '{entry.description}</Text>', 'Text');
  assert.match(tag, TWO);
});

// ---------------------------------------------------------------------------
// Show with longer real names, or a little today
// ---------------------------------------------------------------------------

test('Club business: a meeting row’s time, chapter and place take two lines', () => {
  const row = block(read('business.tsx'), 'function MeetingRow(');
  assert.match(tagHolding(row, '<Text style={styles.metaTime}>{melbourneTime(', 'Text'), TWO);
});

test('Rides list: the time and meeting place take two lines', () => {
  const row = block(read('rides.tsx'), 'export function RideRow(');
  assert.match(tagHolding(row, '<Text style={styles.metaTime}>{startLabel(ride)}', 'Text'), TWO);
});

test('Rusty Bus bookings: the ride line takes two lines', () => {
  const row = block(read('bus.tsx'), 'function BookingRow(');
  assert.match(tagHolding(row, '{ride.title}\n', 'Text'), TWO);
});

test('Book the Rusty Bus: a “For a ride?” option shows in full', () => {
  const radio = block(read('bus.tsx'), 'function RadioRow(');
  const tag = tagHolding(radio, '{label}\n', 'Text');
  assert.doesNotMatch(tag, CLAMP);
  assert.match(tag, /type\.name/);
});

test('Home check-in card: a check-in title shows in full', () => {
  const card = block(read('checkin.tsx'), 'export function HomeCheckinCard(');
  assert.match(tagHolding(card, 'title={r.title}', 'ListRow'), ALL);
});

test('Route library and Choose route: a route name is never cut short', () => {
  const tag = tagHolding(block(read('../ui/RouteBits.tsx'), 'export function RouteRow('), '{route.name}\n', 'Text');
  assert.doesNotMatch(tag, CLAMP);
  assert.match(tag, /type\.name/);
});

test('Route screen: “Rides using it” shows each ride title in full', () => {
  const screen = block(read('routes.tsx'), 'export function RouteScreen(');
  assert.match(tagHolding(screen, 'title={r.title}', 'ListRow'), ALL);
});

test('Ride weather: a stop label is never cut short', () => {
  const tag = tagHolding(block(read('rideWeather.tsx'), 'function Forecast('), '{r.label}\n', 'Text');
  assert.doesNotMatch(tag, CLAMP);
  assert.match(tag, /type\.name/);
});

test('Ride plan: a stop or fuel stop name is never cut short', () => {
  const tag = tagHolding(block(read('ridePlanning.tsx'), 'function StopRows('), '{s.name}</Text>', 'Text');
  assert.doesNotMatch(tag, CLAMP);
  assert.match(tag, /type\.name/);
});

test('Run a check-in: the Excused list shows names and reasons in full', () => {
  const screen = block(read('checkin.tsx'), 'export function RunCheckinScreen(');
  assert.match(tagHolding(screen, 'subtitle={e.reason}', 'ListRow'), ALL);
});

test('Charity ride: the Riding list shows in full, and the helper lists (with their notes) keep two lines', () => {
  const sheet = block(read('charity.tsx'), 'function CharitySheet(');
  assert.match(sheet, /const row = \(s: CharitySignup, i: number, list: CharitySignup\[\], subtitle: string, lines\?: 'all'\) =>/);
  assert.match(tagHolding(sheet, 'subtitle={subtitle}', 'ListRow'), /\blines=\{lines\}/);
  assert.match(sheet, /riders\.map\(\(s, i, list\) => row\(s, i, list, subtitleOf\(s\), 'all'\)\)/);
  const helpers = sheet.split('\n').find((l) => l.includes('helpers.map((s, i, list) => row('));
  assert.ok(helpers, 'found the helper rows');
  assert.doesNotMatch(helpers, /'all'/);
});

test('Registrations: “Who’s coming” shows names and how they stay in full', () => {
  const hub = block(read('ridePlanning.tsx'), 'export function HubScreen(');
  assert.match(tagHolding(hub, 'subtitle={[STAYING_LABEL[r.staying]', 'ListRow'), ALL);
});

test('Who can help?: a trusted mechanic row shows in full', () => {
  const screen = block(read('help.tsx'), 'export function WhoCanHelpScreen(');
  assert.match(tagHolding(screen, 'title={m.name}', 'ListRow'), ALL);
});

test('National: contribution titles are never cut short', () => {
  const screen = block(read('national.tsx'), 'export function NationalScreen(');
  assert.match(tagHolding(screen, 'title={k.title}', 'ListRow'), ALL, 'Your board’s decision');
  const title = tagHolding(screen, '{k.title}</Text>', 'Text');
  assert.doesNotMatch(title, CLAMP, 'Contributions');
  assert.match(title, /type\.name/);
});

test('Attendance and terms: a term row shows the seat and its date in full', () => {
  const card = block(read('attendance.tsx'), 'export function BoardAttendance(');
  assert.match(tagHolding(card, 'title={`${m ? displayName(m) : \'Someone\'} · ${seatTitle(', 'ListRow'), ALL);
});

test('Club shop: a design row shows its name and garments in full, price line order kept', () => {
  const section = block(read('shop.tsx'), 'export function ClubShopSection(');
  const tag = tagHolding(section, 'title={d.name}', 'ListRow');
  assert.match(tag, ALL);
  assert.doesNotMatch(tag, CLAMP, 'the garments line has no clamp of its own');
  assert.match(tag, /\{`\$\{garmentsLine\(garments\.map\(\(g\) => g\.name\)\)\} · from \$\{formatCents\(from\)\}`\}/);
});

test('Run the club shop: a catalogue row shows its name in full', () => {
  const screen = block(read('shopAdmin.tsx'), 'export function ShopAdminScreen(');
  assert.match(tagHolding(screen, 'title={d.name}', 'ListRow'), ALL);
});

test('Merch: item rows and order rows show in full', () => {
  const merch = read('merch.tsx');
  assert.match(tagHolding(block(merch, 'function ItemRow('), 'title={item.name}', 'ListRow'), ALL);
  assert.match(tagHolding(block(merch, 'function OrderRow('), 'title={showBuyer ?', 'ListRow'), ALL);
});

test('Garage: a bike row shows in full, for members and for Family', () => {
  const bike = 'title={b.nickname ?? `${b.make} ${b.model}`}';
  assert.match(tagHolding(block(read('me.tsx'), 'export function MeScreen('), bike, 'ListRow'), ALL);
  assert.match(tagHolding(block(read('family.tsx'), 'export function FamilyMeScreen('), bike, 'ListRow'), ALL);
});

test('Bragging rights: a ride in the picker takes two lines', () => {
  const tag = tagHolding(block(read('brag.tsx'), 'export function NominateScreen('), '{r.title}\n', 'Text');
  assert.match(tag, TWO);
});

test('In-app notice banner: the title takes two lines', () => {
  const tag = tagHolding(read('../ui/IncomingBanner.tsx'), '{notice.title}\n', 'Text');
  assert.match(tag, TWO);
});

// ---------------------------------------------------------------------------
// Left alone on purpose
// ---------------------------------------------------------------------------

test('Chat list: the last-message preview still keeps to one line', () => {
  const list = block(read('chat.tsx'), 'export function ChatListScreen(');
  assert.match(tagHolding(list, '{preview(s, me, people)}', 'Small'), /\bnumberOfLines=\{1\}/);
});

test('A chat’s pinned bar (the Family chat too) still keeps to two lines', () => {
  const chat = read('chat.tsx');
  assert.match(tagHolding(chat, '{nameOf(pinned.authorId)}: ', 'Small'), TWO);
});
