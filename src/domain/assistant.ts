// Ask the club, the phone's side: the snapshot of what the member can see, the card for each action
// the assistant proposes (checked with the same rules the app's own buttons use, so nothing gets
// through the assistant that a tap wouldn't), the ready-filled Google Calendar entry for a new ride,
// and the conversation the phone sends back (append-only: thinking and every block stay as they came).
// Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md

import type { ApiBlock, ApiMessage, AskReply, Proposal } from '../../supabase/functions/_shared/askClub';
import { activePositions, managesChapterRides } from './access';
import { big4GoingProblem } from './big4';
import { BUS_NO_RIDE, BUS_PURPOSES, bookProblem, bookedStraightAway, busPurposeLabel, busStatusLabel, cancelProblem, formatDays, type BusInput } from './bus';
import { formatKm, handKeysProblem, keyHolder, latestReading, logKmProblem, type KmInput } from './busLog';
import { crewFor, crewProblem, leaveProblem } from './crew';
import { addDays, formatAuDate, isRealIsoDate, weekday } from './dates';
import { chargeBalance, chargesOf, formatCents, totalOwing } from './fees';
import { ROLE_LABEL, STATUS_LABEL } from './labels';
import { displayName } from './profile';
import { activeCall, callProblem } from './rideCalls';
import { goingProblem } from './roadRules';
import { lastDay, melbourneDate, melbourneTime, rsvpCounts, rsvpProblem } from './rides';
import type { BusPurpose, ClubData, CrewRole, Member, Ride, RideCallState, RideCategory, RsvpAnswer } from './types';

/** The Rustnuts Rides Google calendar, which feeds the app and the website. */
export const RIDES_CALENDAR = 'rsmc.ridecommitee@gmail.com';
export const NOT_CONFIRMED = 'The member didn’t confirm this, so nothing was done.';
export const STARTERS = ['When’s the next ride?', 'What does the constitution say about FNGs?', 'Put me down for the next ride'];

const UPCOMING_DAYS = 90;
const MAX_UPCOMING = 40;
const RECENT_DAYS = 30;
const MAX_RECENT = 15;
const MAX_POST = 4000;

export interface ChatChoice {
  id: string;
  title: string;
}

export interface CardCtx {
  me: Member;
  data: ClubData;
  /** The chats the member can post in. */
  chats: ChatChoice[];
  now: string;
}

export type ActionPlan =
  | { kind: 'rsvp'; rideId: string; answer: RsvpAnswer }
  | { kind: 'join_crew'; rideId: string; role: CrewRole }
  | { kind: 'leave_crew'; rideId: string }
  | { kind: 'call_ride'; rideId: string; state: RideCallState; reason: string; newDay: string | null }
  | { kind: 'book_bus'; input: BusInput }
  | { kind: 'cancel_bus'; bookingId: string }
  | { kind: 'log_bus_km'; input: KmInput }
  | { kind: 'hand_bus_keys'; toId: string; note: string }
  | { kind: 'post_message'; chatId: string; text: string }
  | { kind: 'open_calendar'; url: string }
  | { kind: 'send_idea'; toId: string; text: string };

export interface ActionCard {
  /** The proposal's id, which its result answers. */
  id: string;
  heading: string;
  lines: string[];
  /** Why it can't be done; then there's no Confirm. */
  problem: string | null;
  confirm: string;
  plan: ActionPlan | null;
}

export type RideLabel = 'north' | 'west' | 'rustnuts' | 'supported' | 'non_nuts';

export interface RideDraft {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, or empty for all day. */
  start: string;
  /** HH:MM, or empty. */
  end: string;
  location: string;
  notes: string;
  label: RideLabel;
}

const CATEGORY_WORD: Record<RideCategory, string> = { north: 'North', west: 'West', club: 'Rustnuts', supported: 'Supported club ride', non_nuts: 'Non-Nuts' };
/** The "Label:" words the calendar sync reads (supabase/functions/_shared/ics.ts) and the website shows. */
const LABEL_WORD: Record<RideLabel, string> = { north: 'North', west: 'West', rustnuts: 'Rustnuts', supported: 'Supported Club Rides', non_nuts: 'Non-Nuts' };
const LABELS = Object.keys(LABEL_WORD) as RideLabel[];
const ANSWER_HEADING: Record<RsvpAnswer, string> = { going: 'GOING', maybe: 'MAYBE', no: 'CAN’T MAKE IT' };
const ANSWER_WORD: Record<RsvpAnswer, string> = { going: 'Going', maybe: 'Maybe', no: 'Can’t make it' };
const CALL_HEADING: Record<RideCallState, string> = { off: 'RIDE’S OFF', postponed: 'RIDE’S POSTPONED', on: 'RIDE’S BACK ON' };
const CREW_ROLES: CrewRole[] = ['road_captain', 'tail_gunner', 'assistant_tail_gunner', 'officer'];

const shownDay = (day: string) => `${weekday(day)} ${formatAuDate(day)}`;
const nameOf = (id: string | null, data: ClubData) => {
  const m = id ? data.members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : null;
};
const hhmm = (iso: string) => {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return t;
};
const positionsOf = (memberId: string, data: ClubData) =>
  activePositions(memberId, data.positions).map((p) => {
    const chapter = data.chapters.find((c) => c.id === p.chapterId)?.name;
    return chapter ? `${ROLE_LABEL[p.role]} (${chapter})` : ROLE_LABEL[p.role];
  });

// The snapshot ---------------------------------------------------------------------------------

function rideFacts(ride: Ride, me: Member, data: ClubData) {
  const day = melbourneDate(ride.startsAt);
  const call = activeCall(ride.id, data);
  const counts = rsvpCounts(ride.id, data.rsvps);
  return {
    id: ride.id,
    day,
    shown: shownDay(day),
    start: ride.allDay ? 'all day' : hhmm(ride.startsAt),
    last_day: lastDay(ride) === day ? undefined : lastDay(ride),
    title: ride.title,
    place: ride.location ?? undefined,
    label: CATEGORY_WORD[ride.category],
    notes: ride.notes ? ride.notes.slice(0, 600) : undefined,
    cancelled: ride.cancelledAt ? true : undefined,
    called: call ? (call.state === 'off' ? 'off' : call.state === 'postponed' ? `postponed${call.newDay ? ` to ${formatAuDate(call.newDay)}` : ''}` : undefined) : undefined,
    my_answer: data.rsvps.find((r) => r.rideId === ride.id && r.memberId === me.id)?.answer ?? null,
    going: counts.going,
    maybe: counts.maybe,
    crew: crewFor(ride.id, data.crew ?? []).map((s) => ({ role: ROLE_LABEL[s.role], name: nameOf(s.memberId, data) ?? 'A former member' })),
  };
}

/** What the member can see, for the assistant: fixed for a conversation, so its cache holds. */
export function buildSnapshot(me: Member, data: ClubData, chats: ChatChoice[], now: string): string {
  const today = melbourneDate(now);
  const until = addDays(today, UPCOMING_DAYS);
  const since = addDays(today, -RECENT_DAYS);
  const byStart = [...data.rides].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const upcoming = byStart.filter((r) => lastDay(r) >= today && melbourneDate(r.startsAt) <= until).slice(0, MAX_UPCOMING);
  const recent = byStart.filter((r) => lastDay(r) < today && lastDay(r) >= since).slice(-MAX_RECENT);
  const bookings = (data.busBookings ?? [])
    .filter((b) => b.lastDay >= today && (b.status === 'requested' || b.status === 'approved'))
    .sort((a, b) => a.firstDay.localeCompare(b.firstDay))
    .map((b) => ({
      id: b.id, days: formatDays(b.firstDay, b.lastDay), status: busStatusLabel(b.status), purpose: busPurposeLabel(b.purpose),
      ride_id: b.rideId ?? undefined, driver: nameOf(b.driverId, data) ?? undefined, booked_by: nameOf(b.bookedBy, data) ?? undefined,
    }));
  const payments = data.payments ?? [];
  const charges = chargesOf(me.id, data)
    .map((c) => ({ c, b: chargeBalance(c, payments) }))
    .filter(({ b }) => b.owingCents > 0)
    .map(({ c, b }) => ({ what: c.description ?? 'Club fee', owing: formatCents(b.owingCents), due: formatAuDate(c.dueOn) }));
  const meetings = (data.meetings ?? [])
    .filter((m) => !m.cancelledAt && melbourneDate(m.startsAt) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 10)
    .map((m) => ({
      title: m.title, when: `${shownDay(melbourneDate(m.startsAt))} ${melbourneTime(m.startsAt)}`, place: m.location ?? undefined,
      chapter: data.chapters.find((c) => c.id === m.chapterId)?.name ?? 'Whole club',
    }));
  const members = data.members
    .filter((m) => m.approval === 'approved')
    .sort((a, b) => displayName(a).localeCompare(displayName(b)) || a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id, name: m.fullName, road_name: m.roadName ?? undefined, chapter: data.chapters.find((c) => c.id === m.chapterId)?.name,
      status: STATUS_LABEL[m.status], positions: positionsOf(m.id, data),
    }));
  const reading = latestReading(data);
  const snapshot = {
    today: `${shownDay(today)} (${today})`,
    time_now: hhmm(now),
    me: {
      id: me.id, name: me.fullName, road_name: me.roadName ?? undefined, chapter: data.chapters.find((c) => c.id === me.chapterId)?.name,
      status: STATUS_LABEL[me.status], positions: positionsOf(me.id, data),
    },
    upcoming_rides: upcoming.map((r) => rideFacts(r, me, data)),
    recent_rides: recent.map((r) => ({ id: r.id, shown: shownDay(melbourneDate(r.startsAt)), title: r.title, label: CATEGORY_WORD[r.category] })),
    rusty_bus: {
      bookings,
      keys_with: nameOf(keyHolder(data)?.toId ?? null, data) ?? undefined,
      last_odometer: reading ? `${formatKm(reading.km)} on ${formatAuDate(reading.readOn)}` : undefined,
    },
    my_charges: charges,
    my_total_owing: formatCents(totalOwing(me.id, data)),
    meetings,
    members,
    chats,
  };
  return `<club_snapshot>\n${JSON.stringify(snapshot)}\n</club_snapshot>`;
}

// The cards ------------------------------------------------------------------------------------

const rideLines = (ride: Ride) => [`${shownDay(melbourneDate(ride.startsAt))} · ${ride.allDay ? 'All day' : melbourneTime(ride.startsAt)}`, ride.title];
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

function card(id: string, heading: string, lines: string[], problem: string | null, plan: ActionPlan, confirm = 'CONFIRM'): ActionCard {
  return { id, heading, lines: lines.filter(Boolean), problem, confirm, plan: problem ? null : plan };
}

function rideCard(proposal: Proposal, ctx: CardCtx, build: (ride: Ride) => ActionCard): ActionCard {
  const id = typeof proposal.input.ride_id === 'string' ? proposal.input.ride_id : '';
  const ride = ctx.data.rides.find((r) => r.id === id);
  if (!ride) return { id: proposal.id, heading: 'RIDE', lines: [], problem: BUS_NO_RIDE, confirm: 'CONFIRM', plan: null };
  return build(ride);
}

/** The card for one proposed action, checked with the app's own rules. */
export function cardFor(proposal: Proposal, ctx: CardCtx): ActionCard {
  const { me, data, now } = ctx;
  const today = melbourneDate(now);
  const s = (key: string) => (typeof proposal.input[key] === 'string' ? (proposal.input[key] as string).trim() : '');
  const id = proposal.id;

  switch (proposal.name) {
    case 'rsvp':
      return rideCard(proposal, ctx, (ride) => {
        const answer = s('answer') as RsvpAnswer;
        if (!(answer in ANSWER_HEADING)) return card(id, 'ANSWER', rideLines(ride), 'Pick Going, Maybe or Can’t make it.', { kind: 'rsvp', rideId: ride.id, answer: 'maybe' });
        const problem = rsvpProblem(me, ride, now) ?? goingProblem(me, answer, data, today) ?? big4GoingProblem(me, ride.id, answer, data, today);
        return card(id, ANSWER_HEADING[answer], rideLines(ride), problem, { kind: 'rsvp', rideId: ride.id, answer });
      });
    case 'join_crew':
      return rideCard(proposal, ctx, (ride) => {
        const role = s('role') as CrewRole;
        if (!CREW_ROLES.includes(role)) return card(id, 'CREW', rideLines(ride), 'Pick a crew spot.', { kind: 'leave_crew', rideId: ride.id });
        const problem = crewProblem(me, ride, me, role, data, now);
        return card(id, ROLE_LABEL[role].toUpperCase(), rideLines(ride), problem, { kind: 'join_crew', rideId: ride.id, role });
      });
    case 'leave_crew':
      return rideCard(proposal, ctx, (ride) =>
        card(id, 'OFF THE CREW', rideLines(ride), leaveProblem(me, ride, me.id, data, now), { kind: 'leave_crew', rideId: ride.id }));
    case 'call_ride':
      return rideCard(proposal, ctx, (ride) => {
        const state = s('state') as RideCallState;
        if (!(state in CALL_HEADING)) return card(id, 'CALL THE RIDE', rideLines(ride), 'Pick off, postponed or back on.', { kind: 'leave_crew', rideId: ride.id });
        const reason = state === 'on' ? '' : s('reason');
        const newDay = state === 'postponed' && s('new_day') ? s('new_day') : null;
        const problem = callProblem(me, ride, state, reason, newDay, data, now);
        const lines = [...rideLines(ride), reason, newDay ? `New day: ${formatAuDate(newDay)}` : '', 'It goes in the ride’s chat too.'];
        return card(id, CALL_HEADING[state], lines, problem, { kind: 'call_ride', rideId: ride.id, state, reason, newDay });
      });
    case 'book_bus': {
      const purpose = (BUS_PURPOSES as readonly string[]).includes(s('purpose')) ? (s('purpose') as BusPurpose) : null;
      const input: BusInput = {
        firstDay: s('first_day'), lastDay: s('last_day'), purpose, rideId: s('ride_id') || null, driverId: s('driver_id') || null, notes: s('notes'),
      };
      const ride = input.rideId ? data.rides.find((r) => r.id === input.rideId) : undefined;
      const driver = nameOf(input.driverId, data);
      const problem = bookProblem(me, input, data, today);
      const lines = [
        isRealIsoDate(input.firstDay) && isRealIsoDate(input.lastDay) ? formatDays(input.firstDay, input.lastDay) : '',
        purpose ? busPurposeLabel(purpose) : '',
        ride ? `For: ${ride.title}` : '',
        driver ? `Driver: ${driver}` : '',
        input.notes,
        problem ? '' : bookedStraightAway(me, input, today, data) ? 'Booked straight away.' : 'Waits for a yes from the board.',
      ];
      return card(id, 'RUSTY BUS', lines, problem, { kind: 'book_bus', input });
    }
    case 'cancel_bus': {
      const booking = (data.busBookings ?? []).find((b) => b.id === s('booking_id'));
      const lines = booking ? [formatDays(booking.firstDay, booking.lastDay), busPurposeLabel(booking.purpose)] : [];
      return card(id, 'CANCEL THE BUS', lines, cancelProblem(me, booking, data, today), { kind: 'cancel_bus', bookingId: booking?.id ?? '' });
    }
    case 'log_bus_km': {
      const km = typeof proposal.input.km === 'number' ? proposal.input.km : NaN;
      const input: KmInput = { km, readOn: s('read_on'), bookingId: null, note: s('note') };
      const problem = logKmProblem(me, input, data, today);
      const lines = [Number.isFinite(km) ? formatKm(km) : '', isRealIsoDate(input.readOn) ? formatAuDate(input.readOn) : '', input.note];
      return card(id, 'BUS KM', lines, problem, { kind: 'log_bus_km', input });
    }
    case 'hand_bus_keys': {
      const toId = s('to_member_id');
      const note = s('note');
      const to = nameOf(toId, data);
      return card(id, 'BUS KEYS', [to ? `To ${to}` : '', note], handKeysProblem(me, toId || null, note, data), { kind: 'hand_bus_keys', toId, note });
    }
    case 'post_message': {
      const chat = ctx.chats.find((c) => c.id === s('chat_id'));
      const text = s('text');
      const problem = !chat ? 'You can’t post in that chat.' : !text ? 'There’s nothing to post.' : [...text].length > MAX_POST ? 'Keep it under 4,000 characters.' : null;
      return card(id, chat ? `POST IN ${chat.title.toUpperCase()}` : 'POST', [text], problem, { kind: 'post_message', chatId: chat?.id ?? '', text });
    }
    case 'add_ride':
      return rideIdeaCard(id, proposal, ctx);
    default:
      return { id, heading: 'NOT YET', lines: [], problem: 'The app can’t do that yet.', confirm: 'CONFIRM', plan: null };
  }
}

// A new ride ------------------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why the ride can't go on the calendar like this, or null. */
export function rideDraftProblem(d: RideDraft, today: string): string | null {
  if (!d.title.trim()) return 'Give the ride a title.';
  if ([...d.title.trim()].length > 100) return 'Keep the title to 100 characters.';
  if (!isRealIsoDate(d.date)) return 'Pick the ride’s day.';
  if (d.date < today) return 'That day has passed.';
  if (d.date > addDays(today, 365)) return 'Pick a day within 12 months.';
  if ((d.start && !TIME.test(d.start)) || (d.end && !TIME.test(d.end))) return 'Times are like 09:30.';
  if (d.end && !d.start) return 'Give a start time with the finish time.';
  if (d.start && d.end && d.end <= d.start) return 'The finish has to be after the start.';
  if ([...d.notes].length > 2000) return 'Keep the notes to 2,000 characters.';
  if (!LABELS.includes(d.label)) return 'Pick North, West, Rustnuts, Supported or Non-Nuts.';
  return null;
}

const compact = (day: string) => day.replaceAll('-', '');
const plusHours = (t: string, hours: number) => {
  const [h, m] = t.split(':').map(Number);
  return h + hours >= 24 ? '23:59' : `${String(h + hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** A ready-filled Google Calendar entry on the Rustnuts Rides calendar, in Melbourne time. */
export function calendarLink(d: RideDraft): string {
  const dates = d.start
    ? `${compact(d.date)}T${d.start.replace(':', '')}00/${compact(d.date)}T${(d.end || plusHours(d.start, 4)).replace(':', '')}00`
    : `${compact(d.date)}/${compact(addDays(d.date, 1))}`;
  const details = [d.notes.trim(), `Label: ${LABEL_WORD[d.label]}`].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: d.title.trim(), dates, ctz: 'Australia/Melbourne', details });
  if (d.location.trim()) params.set('location', d.location.trim());
  params.set('src', RIDES_CALENDAR);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Who a member's ride idea goes to: their chapter's Road Captain, or else its President. */
export function ideaRecipient(me: Member, data: ClubData): Member | null {
  for (const role of ['road_captain', 'president'] as const) {
    const seat = data.positions.find(
      (p) => p.chapterId === me.chapterId && p.role === role && p.memberId !== me.id && activePositions(p.memberId, data.positions).some((x) => x.id === p.id),
    );
    const holder = seat && data.members.find((m) => m.id === seat.memberId && m.approval === 'approved');
    if (holder) return holder;
  }
  return null;
}

const draftWhen = (d: RideDraft) =>
  `${shownDay(d.date)} · ${d.start ? `${clock(d.start)}${d.end ? ` – ${clock(d.end)}` : ''}` : 'All day'}`;

/** The private message a member's ride idea goes as. */
export function rideIdeaText(d: RideDraft): string {
  return [
    'Ride idea (from Ask the club):',
    d.title.trim(),
    draftWhen(d),
    d.location.trim() ? `From: ${d.location.trim()}` : '',
    LABEL_WORD[d.label],
    d.notes.trim(),
    '',
    'Could it go on the Rustnuts Rides calendar?',
  ].filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n');
}

function rideIdeaCard(id: string, proposal: Proposal, ctx: CardCtx): ActionCard {
  const s = (key: string) => (typeof proposal.input[key] === 'string' ? (proposal.input[key] as string).trim() : '');
  const draft: RideDraft = {
    title: s('title'), date: s('date'), start: s('start_time'), end: s('end_time'), location: s('location'), notes: s('notes'),
    label: (LABELS as string[]).includes(s('label')) ? (s('label') as RideLabel) : ('' as RideLabel),
  };
  const today = melbourneDate(ctx.now);
  const problem = rideDraftProblem(draft, today);
  const lines = problem
    ? [draft.title]
    : [draftWhen(draft), draft.title, draft.location ? `From: ${draft.location}` : '', LABEL_WORD[draft.label], draft.notes];
  const chapterId = draft.label === 'north' || draft.label === 'west' ? ctx.data.chapters.find((c) => c.slug === draft.label)?.id ?? null : null;
  if (managesChapterRides(ctx.me, chapterId, ctx.data)) {
    return card(id, 'NEW RIDE', [...lines, problem ? '' : 'Check it and press Save in Google Calendar. The app picks it up within 15 minutes.'], problem,
      { kind: 'open_calendar', url: problem ? '' : calendarLink(draft) }, 'OPEN IN GOOGLE CALENDAR');
  }
  const to = ideaRecipient(ctx.me, ctx.data);
  const isRc = !!to && ctx.data.positions.some((p) => p.memberId === to.id && p.role === 'road_captain' && p.chapterId === ctx.me.chapterId && !p.endedOn);
  const noOne = to ? null : 'Your chapter has no Road Captain or President in the app to send it to.';
  return card(id, 'NEW RIDE', [...lines, to && !problem ? `Goes to ${displayName(to)} as a private message.` : ''], problem ?? noOne,
    { kind: 'send_idea', toId: to?.id ?? '', text: problem ? '' : rideIdeaText(draft) }, isRc ? 'SEND TO THE ROAD CAPTAIN' : 'SEND TO THE PRESIDENT');
}

// The conversation -----------------------------------------------------------------------------

/** The proposals in the last answer that still need a result. */
export function pendingToolIds(history: ApiMessage[]): string[] {
  const last = history.at(-1);
  if (!last || last.role !== 'assistant') return [];
  return last.content.filter((b) => b.type === 'tool_use' && typeof b.id === 'string').map((b) => b.id as string);
}

/**
 * The conversation with the member's next question: a result for every proposal in the last answer
 * (those not confirmed say nothing was done), the snapshot on the very first question, then the words.
 */
export function nextMessages(history: ApiMessage[], results: Record<string, string>, question: string, snapshot: string | null): ApiMessage[] {
  const content: ApiBlock[] = pendingToolIds(history).map((id) => ({ type: 'tool_result', tool_use_id: id, content: results[id] ?? NOT_CONFIRMED }));
  if (history.length === 0 && snapshot) content.push({ type: 'text', text: snapshot });
  content.push({ type: 'text', text: question.trim() });
  return [...history, { role: 'user', content }];
}

/** The conversation after an answer. An empty answer (a refusal) takes the question back out. */
export function withReply(before: ApiMessage[], sent: ApiMessage[], reply: AskReply): ApiMessage[] {
  if (reply.content.length === 0) return before;
  return [...sent, { role: 'assistant', content: reply.content }];
}

/** What a confirmed card tells the assistant it did. */
export function doneLine(plan: ActionPlan, data: ClubData): string {
  const ride = 'rideId' in plan ? data.rides.find((r) => r.id === plan.rideId)?.title : undefined;
  switch (plan.kind) {
    case 'rsvp': return `Done: answered ${ANSWER_WORD[plan.answer]} for ${ride}.`;
    case 'join_crew': return `Done: on the crew for ${ride} as ${ROLE_LABEL[plan.role]}.`;
    case 'leave_crew': return `Done: off the crew for ${ride}.`;
    case 'call_ride': return `Done: ${ride} called ${plan.state === 'on' ? 'back on' : plan.state}, and it’s in the ride’s chat.`;
    case 'book_bus': return 'Done: the Rusty Bus booking is in.';
    case 'cancel_bus': return 'Done: the Rusty Bus booking is cancelled.';
    case 'log_bus_km': return `Done: logged ${formatKm(plan.input.km)}.`;
    case 'hand_bus_keys': return `Done: the keys are logged with ${nameOf(plan.toId, data)}.`;
    case 'post_message': return 'Done: posted.';
    case 'open_calendar': return 'The member opened the calendar entry. It’s only on the calendar once they press Save in Google Calendar.';
    case 'send_idea': return `Done: the ride idea went to ${nameOf(plan.toId, data)} as a private message.`;
  }
}
