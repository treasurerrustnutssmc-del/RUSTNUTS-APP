// Ask the club in the demo (the web preview and the store review): a small scripted assistant that
// never touches the network. It answers from the demo club's own rides and charges, cites the FNG
// clauses, and proposes a Going card, a bus booking and a new ride, so every kind of card can be seen.
// Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md ("The demo")

import type { ApiBlock, ApiMessage, AskReply, Proposal, ToolName } from '../../supabase/functions/_shared/askClub';
import { addDays, formatAuDate, weekday } from '../domain/dates';
import { chargeBalance, chargesOf, formatCents, totalOwing } from '../domain/fees';
import { lastDay, melbourneDate, melbourneTime } from '../domain/rides';
import type { ClubData, Member, Ride } from '../domain/types';

export const DEMO_FALLBACK = 'In the demo I can answer a few things: try one of the starters.';

export interface DemoCtx {
  me: Member;
  data: ClubData;
  now: string;
}

const FNG_ANSWER =
  'The FNG pathway runs at least nine months before Full membership, and FNGs can’t vote on internal club matters (4.6). ' +
  'The Board does a feedback review at six months and can look at Full membership from nine (4.7). ' +
  'Full membership then needs a yes from every eligible Full member of the home chapter, in a confidential vote the President runs (4.8–4.9). ' +
  'If it hasn’t happened by twelve months, the Board reviews within 14 days (4.10), and staying on as an FNG past twelve months costs a one-off 50% of the yearly fee (4.11). ' +
  'All of that is clauses 4.6–4.11.';

/** The next ride that hasn't finished: the soonest, and on a tie the member's own chapter's. */
function nextRide(ctx: DemoCtx): Ride | undefined {
  const today = melbourneDate(ctx.now);
  const slug = ctx.data.chapters.find((c) => c.id === ctx.me.chapterId)?.slug;
  const own = (r: Ride) => (r.category === slug ? 0 : 1);
  return ctx.data.rides
    .filter((r) => !r.cancelledAt && lastDay(r) >= today && r.startsAt >= ctx.now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || own(a) - own(b) || a.id.localeCompare(b.id))[0];
}

const when = (r: Ride) => {
  const day = melbourneDate(r.startsAt);
  return `${weekday(day)} ${formatAuDate(day)}${r.allDay ? '' : ` at ${melbourneTime(r.startsAt)}`}`;
};

const lastQuestion = (messages: ApiMessage[]) => {
  const last = messages.at(-1);
  const texts = (last?.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string);
  return (texts.at(-1) ?? '').toLowerCase().replaceAll('’', '\'');
};

const toolUses = (messages: ApiMessage[]) =>
  messages.reduce((n, m) => n + (m.role === 'assistant' ? m.content.filter((b) => b.type === 'tool_use').length : 0), 0);

function say(text: string): AskReply {
  return { content: [{ type: 'text', text }], text, proposals: [], note: null };
}

function propose(messages: ApiMessage[], text: string, name: ToolName, input: Record<string, unknown>): AskReply {
  const proposal: Proposal = { id: `demo_tool_${toolUses(messages) + 1}`, name, input };
  const content: ApiBlock[] = [{ type: 'text', text }, { type: 'tool_use', id: proposal.id, name, input }];
  return { content, text, proposals: [proposal], note: null };
}

function owing(ctx: DemoCtx): string {
  const total = totalOwing(ctx.me.id, ctx.data);
  if (total <= 0) return 'You’re all square: nothing owing on your account.';
  const payments = ctx.data.payments ?? [];
  const lines = chargesOf(ctx.me.id, ctx.data)
    .map((c) => ({ c, b: chargeBalance(c, payments) }))
    .filter(({ b }) => b.owingCents > 0)
    .map(({ c, b }) => `${c.description ?? 'Club fee'}, ${formatCents(b.owingCents)} due ${formatAuDate(c.dueOn)}`);
  return `You owe ${formatCents(total)}: ${lines.join('; ')}. The details are under Me, in Fees.`;
}

/** The demo's answer to the member's last question. Pure. */
export function demoReply(messages: ApiMessage[], ctx: DemoCtx): AskReply {
  const q = lastQuestion(messages);
  const ride = nextRide(ctx);
  const noRide = 'There’s no ride on the calendar yet.';

  if (/put me down|count me in|i'm going|rsvp|mark me/.test(q)) {
    if (!ride) return say(noRide);
    return propose(messages, `Here’s Going for ${ride.title} on ${when(ride)}. Press Confirm and it’s in.`, 'rsvp', { ride_id: ride.id, answer: 'going' });
  }
  if (/\bbus\b/.test(q)) {
    const day = ride ? melbourneDate(ride.startsAt) : addDays(melbourneDate(ctx.now), 7);
    return propose(messages, `Here’s the Rusty Bus for ${weekday(day)} ${formatAuDate(day)}, with you driving. Change anything by asking again.`, 'book_bus', {
      first_day: day, last_day: day, purpose: 'club_event', ride_id: ride?.id ?? '', driver_id: ctx.me.id, notes: '',
    });
  }
  if (/add a ride|new ride|ride idea|plan a ride/.test(q)) {
    // The first Sunday at least a fortnight away.
    let day = addDays(melbourneDate(ctx.now), 14);
    while (weekday(day) !== 'Sun') day = addDays(day, 1);
    const chapter = ctx.data.chapters.find((c) => c.id === ctx.me.chapterId)?.slug;
    return propose(messages, `Here’s a ride for ${weekday(day)} ${formatAuDate(day)}, leaving at 9:00 am.`, 'add_ride', {
      title: 'Sunday ride', date: day, start_time: '09:00', end_time: '', location: '', notes: '',
      label: chapter === 'north' || chapter === 'west' ? chapter : 'rustnuts',
    });
  }
  if (/\bfngs?\b|constitution/.test(q)) return say(FNG_ANSWER);
  if (/\bowe\b|fees?\b|pay\b|money/.test(q)) return say(owing(ctx));
  if (/next ride|ride/.test(q)) {
    if (!ride) return say(noRide);
    return say(`The next ride is ${ride.title} on ${when(ride)}${ride.location ? `, from ${ride.location}` : ''}.`);
  }
  return say(DEMO_FALLBACK);
}
