// Draft from Otter in the demo (the web preview and the store review): a sample Otter-style
// transcript to try it with, and a scripted draft built from the demo meeting and its chapter's
// members, with an unmatched visitor and an unclear vote so every part of the check screen shows.
// Spec: docs/superpowers/specs/2026-11-01-otter-minutes-design.md ("The demo")

import type { MinutesDraft, MinutesPerson } from '../../supabase/functions/_shared/minutesDraft';
import { formatAuDate } from '../domain/dates';
import { minutesPeople } from '../domain/otterMinutes';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type { ClubData, Meeting } from '../domain/types';

export interface DraftResult {
  draft: MinutesDraft;
  people: MinutesPerson[];
}

/** A short made-up Otter export, so the demo can be tried without a real recording. */
export function sampleTranscript(meeting: Meeting, data: ClubData): string {
  const people = minutesPeople(meeting, data).filter((p) => p.chapter === chapterName(meeting, data));
  const say = (i: number) => people[i % Math.max(people.length, 1)]?.roadName ?? people[i % Math.max(people.length, 1)]?.name ?? 'Someone';
  const items = meeting.agenda.length ? meeting.agenda : [{ title: 'General business', notes: null }];
  const lines = [
    `Speaker 1  0:00`,
    `Righto, it’s ${melbourneTime(meeting.startsAt)}, let’s get going. Welcome to the ${meeting.title}. Apologies from ${say(3)}, couldn’t make it.`,
    `Speaker 2  0:41`,
    `${say(1)} here, ${say(2)} and Bluey from the bakery ride are in too.`,
    ...items.flatMap((a, i) => [
      `Speaker 1  ${4 + i * 6}:12`,
      `Next up, ${a.title}. ${i === 0 ? `${say(1)}, you want to move it?` : 'Any thoughts?'}`,
      `Speaker 2  ${5 + i * 6}:03`,
      i === 0
        ? `I move we go ahead with it. ${say(2)} seconds. Show of hands… that’s carried, I think everyone.`
        : `${say(2)} will chase it up and report back next meeting, say by the end of the month.`,
    ]),
    `Speaker 1  31:40`,
    `Anything else? No? Meeting closed, 8:42.`,
  ];
  return lines.join('\n');
}

const chapterName = (meeting: Meeting, data: ClubData) => data.chapters.find((c) => c.id === meeting.chapterId)?.name ?? null;

/** The demo's draft, built from the demo meeting and its chapter's members. */
export function demoDraft(meeting: Meeting, data: ClubData): DraftResult {
  const people = minutesPeople(meeting, data);
  const home = people.filter((p) => meeting.chapterId === null || p.chapter === chapterName(meeting, data));
  const pick = (i: number) => home[i % Math.max(home.length, 1)];
  const show = (p: MinutesPerson | undefined) => (p ? (p.roadName ? `${p.name} (${p.roadName})` : p.name) : 'Someone');
  const day = melbourneDate(meeting.startsAt);
  const there = [pick(0), pick(1), pick(2)].filter((p, i, all): p is MinutesPerson => !!p && all.findIndex((q) => q?.id === p.id) === i);
  const away = pick(3);
  const items = meeting.agenda.length ? meeting.agenda : [{ title: 'General business', notes: null }];
  const due = new Date(`${day}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  const dueOn = due.toISOString().slice(0, 10);
  const minutes = [
    `RUSTNUTS SMC ${(chapterName(meeting, data) ?? 'NATIONAL').toUpperCase()}`,
    `MINUTES OF THE ${meeting.title.toUpperCase()}`,
    `${formatAuDate(day)}, opened ${melbourneTime(meeting.startsAt)}, ${meeting.location ?? 'place not said'}`,
    `Chair: ${show(there[0])}`,
    '',
    `Present: ${[...there.map(show), 'Bluey (visitor, not matched)'].join(', ')}`,
    `Apologies: ${show(away)}`,
    '',
    ...items.flatMap((a, i) => [
      `${i + 1}. ${a.title}`,
      i === 0
        ? `Discussed and agreed to go ahead.\nMotion: That we go ahead with ${a.title.toLowerCase()}. Moved: ${show(there[1])}. Seconded: ${show(there[2])}. Result: Carried (numbers not clear in the recording).`
        : `${show(there[2])} to follow it up and report back at the next meeting.`,
      '',
    ]),
    'Action items:',
    `- ${items[Math.min(1, items.length - 1)].title}: ${show(there[2])}, by ${formatAuDate(dueOn)}`,
    `- Send the draft minutes to members: ${show(there[0])}`,
    '',
    'Meeting closed: 8:42 pm.',
  ].join('\n');
  const draft: MinutesDraft = {
    minutes,
    present: [...there.map((p) => ({ heard: p.roadName ?? p.name, memberId: p.id })), { heard: 'Bluey', memberId: null }],
    apologies: away ? [{ heard: away.roadName ?? away.name, memberId: away.id }] : [],
    actionItems: [
      { title: `Follow up ${items[Math.min(1, items.length - 1)].title.toLowerCase()}`, ownerId: there[2]?.id ?? null, ownerHeard: there[2]?.roadName ?? 'not clear', dueOn },
      { title: 'Send the draft minutes to members', ownerId: there[0]?.id ?? null, ownerHeard: there[0]?.roadName ?? 'not clear', dueOn: null },
    ],
    checkThese: ['The vote count on the first motion wasn’t clear in the recording.', 'Bluey isn’t on the club list: a visitor?'],
  };
  return { draft, people };
}

