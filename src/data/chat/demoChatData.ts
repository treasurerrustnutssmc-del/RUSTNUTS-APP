// Made-up chats for the demo, from the demo members in ../demoData. Times count back from when the
// demo opens, so the chats always look busy, and the lines that name a ride's day read it from that
// ride. The pictures and the voice note are in ./demoMedia, so this file loads under node.

import type { Conversation, Message, MessageMedia } from '../../domain/chat';
import { melbourneInstant } from '../../domain/business';
import { addDays } from '../../domain/dates';
import { melbourneDate } from '../../domain/rides';
import type { Ride } from '../../domain/types';
import { dayMonth, dayOrdinal, weekdayName } from '../demoStory';
import type { LinkPreview } from './chatContext';
import type { ChatData } from './demoChatActions';

/** The demo makes no web requests, so its one link has its card written out. */
export const DEMO_PREVIEWS: Record<string, LinkPreview> = {
  'https://www.vicroads.vic.gov.au': {
    url: 'https://www.vicroads.vic.gov.au', site: 'VicRoads', title: 'Check registration',
    description: 'Check the registration status of a vehicle in Victoria.', image: null,
  },
};

/** A ride that already happened (a fortnight and a day ago), so the demo has a ride wall to look at. */
export function demoPastRides(now: Date): Ride[] {
  const day = addDays(melbourneDate(now.toISOString()), -15);
  return [
    {
      id: 'r-past-1', title: 'Run to Lorne', startsAt: melbourneInstant(day, '09:00')!, endsAt: melbourneInstant(day, '17:00')!,
      allDay: false, location: 'Caltex Laverton North', notes: 'Great Ocean Road, fish and chips at Lorne.', category: 'club', cancelledAt: null,
      source: 'feed', website: true,
    },
  ];
}

const conv = (id: string, over: Partial<Conversation> & Pick<Conversation, 'kind'>): Conversation => ({
  id, chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [], ...over,
});

/** The demo's chats as they stand at `now`, around the club's `rides`. */
export function demoChatData(now: Date, rides: Ride[]): ChatData {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const messages: Message[] = [];
  let n = 0;
  const say = (
    chat: string,
    authorId: string,
    minutesAgo: number,
    body: string | null,
    extra: { photos?: [string, number, number][]; voice?: [string, number]; reactions?: [string, string][]; replyTo?: string } = {},
  ) => {
    const id = `dm-${++n}`;
    const media: MessageMedia[] = extra.voice
      ? [{ id: `${id}-0`, messageId: id, kind: 'voice', path: extra.voice[0], posterPath: null, width: 0, height: 0, durationMs: extra.voice[1], position: 0 }]
      : (extra.photos ?? []).map(([path, width, height], position) => ({
          id: `${id}-${position}`, messageId: id, kind: 'photo', path, posterPath: null, width, height, durationMs: null, position,
        }));
    messages.push({
      id, conversationId: chat, authorId, body, createdAt: ago(minutesAgo), removedAt: null, replyToId: extra.replyTo ?? null,
      media, reactions: (extra.reactions ?? []).map(([memberId, emoji]) => ({ messageId: id, memberId, emoji })),
    });
    return id;
  };

  // The two lines that name a ride's day read it from the ride, so they can't disagree with it.
  const dayOf = (id: string) => {
    const ride = rides.find((r) => r.id === id);
    return ride ? melbourneDate(ride.startsAt) : null;
  };
  const breakfastDay = dayOf('r-1');
  const toyRunDay = dayOf('r-3');

  const lunchRide = say('club', 'm-rusty', 2 * 24 * 60, 'Who’s keen for the club lunch ride? Clubhouse is booked, raffle after.', {
    reactions: [['m-diesel', '🍺'], ['m-smokey', '🍺'], ['m-jet', '👍']],
  });
  say('club', 'm-diesel', 2 * 24 * 60 - 20, 'In. Go easy on the raffle tickets this time, Gravel.', { replyTo: lunchRide, reactions: [['m-gravel', '😂']] });
  say('club', 'm-smokey', 26 * 60, 'North’s coming down in force.');
  say('club', 'm-spanner', 20 * 60, 'Not a bad way to finish a ride.', {
    photos: [['demo/dusk-run.jpg', 1200, 900]], reactions: [['m-rusty', '🔥'], ['m-throttle', '🔥'], ['m-jet', '❤️']],
  });
  say('club', 'm-throttle', 5 * 60, 'Little Red’s got new pipes. Sorry in advance, neighbours.', { reactions: [['m-chook', '😂']] });
  say('club', 'm-rusty', 3 * 60, 'Rego reminder: check yours at https://www.vicroads.vic.gov.au before the club lunch ride.');
  say('club', 'm-gravel', 55, null, { voice: ['demo/voice-late.m4a', 7300], reactions: [['m-diesel', '😂']] });
  say('club', 'm-ben', 40, 'G’day all, Ben here. Rode with North last month. Keen for the club lunch ride if there’s room.', {
    reactions: [['m-smokey', '👍'], ['m-jet', '👍']],
  });

  // Family chat: members and Family accounts together. Kerry is the demo's Family persona.
  const bbq = say('family', 'm-torque', 2 * 24 * 60 + 30, 'West family day at the clubhouse is locked in. Marquee’s up from 10, barbie at noon. Kids welcome, dogs on a lead.', {
    reactions: [['m-kerry', '❤️'], ['m-diesel', '👍']],
  });
  say('family', 'm-kerry', 2 * 24 * 60, 'We’ll bring a pasta salad and the cricket set.', { replyTo: bbq, reactions: [['m-torque', '🔥']] });
  say('family', 'm-spanner', 30 * 60, 'Anyone got a spare kids’ helmet, size small? Ours has outgrown his.');
  say('family', 'm-kerry', 22 * 60, 'Diesel says there’s one in our shed. I’ll bring it to the next ride.', { reactions: [['m-spanner', '🍺']] });

  say('chapter:ch-west', 'm-torque', 3 * 24 * 60, 'Meeting’s at the clubhouse, 7:30. Bring your club lunch ride numbers.');
  say('chapter:ch-west', 'm-spanner', 9 * 60, 'Who’s got a spare 10 mm socket? Asking for the CB750.');
  say('chapter:ch-west', 'm-chook', 9 * 60 - 3, 'Under your seat. Where you left it.', { reactions: [['m-gravel', '😂'], ['m-sparks', '😂']] });
  say('chapter:ch-west', 'm-gravel', 2 * 60, breakfastDay
    ? `Breakfast run on the ${dayOrdinal(breakfastDay)}, KSU 8:30. Tail gunner in hi-vis.`
    : 'Breakfast run is on, KSU 8:30. Tail gunner in hi-vis.');

  say('chapter:ch-north', 'm-jet', 30 * 60, 'Coffee run is on, Kilmore Bakery, 9 sharp.');
  say('chapter:ch-north', 'm-ace', 28 * 60, 'Back way through Pyalong was mint.', { photos: [['demo/twisties.jpg', 900, 1200]] });
  say('chapter:ch-north', 'm-ratchet', 6 * 60, 'Phoning in from the Sunshine Coast. Save me a vanilla slice.');

  say('board:ch-west', 'm-torque', 2 * 24 * 60, 'Draft agenda is up. Sparks has the Treasurer’s report.');
  say('board:ch-west', 'm-sparks', 2 * 24 * 60 - 45, 'Done. Rusty Bus rego is paid up for the year.');
  say('board:ch-north', 'm-smokey', 4 * 24 * 60, 'Lefty’s coming along well. Worth a chat at the next meeting.');

  say('nec', 'm-rusty', 3 * 24 * 60, 'Club lunch ride numbers are building across both chapters.');
  say('nec', 'm-smokey', 3 * 24 * 60 - 60, 'North will have a few more by the meeting.');

  const recce = say('committee:ride', 'm-diesel', 4 * 24 * 60, 'Ran the Daylesford loop for the breakfast run. Roadworks at Glenlyon, 20 min wait.');
  say('committee:ride', 'm-crank', 4 * 24 * 60 - 90, 'Go via Kyneton then, adds 10 minutes and skips the lights.', { replyTo: recce });
  say('committee:charity', 'm-jet', 5 * 24 * 60, toyRunDay
    ? `Toy Run’s on ${weekdayName(toyRunDay)} ${dayMonth(toyRunDay)}. Rusty Bus can carry the toys from the clubhouse.`
    : 'Toy Run’s coming up. Rusty Bus can carry the toys from the clubhouse.');

  say('ride:r-past-1', 'm-rusty', 14 * 24 * 60, 'Great day. Thanks all, and thanks to Spanner for sweeping.');
  say('ride:r-past-1', 'm-sparks', 14 * 24 * 60 - 30, null, { photos: [['demo/coast-road.jpg', 1200, 900], ['demo/servo-night.jpg', 1200, 900]] });
  say('ride:r-1', 'm-spanner', 6 * 60, 'I’ll be at the back in the hi-vis. Wave if you need a hand.');

  say('direct:m-rusty:m-spanner', 'm-rusty', 4 * 60, 'Can you bring the first aid kit to the breakfast run?');
  say('direct:m-rusty:m-spanner', 'm-spanner', 3 * 60 + 50, 'Already in the panniers.');

  const chapters = ['ch-west', 'ch-north'];
  return {
    conversations: [
      conv('club', { kind: 'club', pinnedMessageId: lunchRide }),
      conv('family', { kind: 'family', pinnedMessageId: bbq }),
      conv('nec', { kind: 'nec' }),
      conv('committee:ride', { kind: 'committee', committee: 'ride' }),
      conv('committee:charity', { kind: 'committee', committee: 'charity' }),
      ...chapters.flatMap((c) => [conv(`chapter:${c}`, { kind: 'chapter', chapterId: c }), conv(`board:${c}`, { kind: 'board', chapterId: c })]),
      ...[...demoPastRides(now), ...rides].map((r) => conv(`ride:${r.id}`, { kind: 'ride', rideId: r.id })),
      conv('direct:m-rusty:m-spanner', { kind: 'direct', memberIds: ['m-rusty', 'm-spanner'] }),
    ],
    messages,
    reads: [],
    blocks: [],
    reports: [],
  };
}
