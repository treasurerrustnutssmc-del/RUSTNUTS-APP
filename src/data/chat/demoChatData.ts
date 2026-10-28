// Made-up chats for the demo, from the demo members in ../demoData. Times count back from when the
// demo opens, so the chats always look busy. The photos are drawn scenes, not real members' photos.

import type { Conversation, Message, MessageMedia } from '../../domain/chat';
import type { Ride } from '../../domain/types';
import type { LinkPreview } from './chatContext';
import type { ChatData } from './demoChatActions';

/** The demo's pictures, by the path a message stores. */
export const DEMO_MEDIA: Record<string, number> = {
  'demo/dusk-run.jpg': require('../../../assets/demo/dusk-run.jpg'),
  'demo/coast-road.jpg': require('../../../assets/demo/coast-road.jpg'),
  'demo/twisties.jpg': require('../../../assets/demo/twisties.jpg'),
  'demo/servo-night.jpg': require('../../../assets/demo/servo-night.jpg'),
  // A made-up voice note, spoken by a computer voice, not a member's.
  'demo/voice-late.m4a': require('../../../assets/demo/voice-late.m4a'),
};

/** The demo makes no web requests, so its one link has its card written out. */
export const DEMO_PREVIEWS: Record<string, LinkPreview> = {
  'https://www.vicroads.vic.gov.au': {
    url: 'https://www.vicroads.vic.gov.au', site: 'VicRoads', title: 'Check registration',
    description: 'Check the registration status of a vehicle in Victoria.', image: null,
  },
};

/** A ride that already happened, so the demo has a ride wall to look at. */
export const DEMO_PAST_RIDES: Ride[] = [
  {
    id: 'r-past-1', title: 'Spring run to Lorne', startsAt: '2026-10-10T22:00:00.000Z', endsAt: '2026-10-11T06:00:00.000Z',
    allDay: false, location: 'Caltex Laverton North', notes: 'Great Ocean Road, fish and chips at Lorne.', category: 'club', cancelledAt: null,
  },
];

const conv = (id: string, over: Partial<Conversation> & Pick<Conversation, 'kind'>): Conversation => ({
  id, chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [], ...over,
});

export function demoChatData(now = new Date(), rides: Ride[] = []): ChatData {
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

  const xmas = say('club', 'm-rusty', 2 * 24 * 60, 'Who’s keen for the Christmas ride? Lunch is sorted, Kris Kringle after.', {
    reactions: [['m-diesel', '🍺'], ['m-smokey', '🍺'], ['m-jet', '👍']],
  });
  say('club', 'm-diesel', 2 * 24 * 60 - 20, 'In. Ten dollar limit on the Kris Kringle this year, Gravel.', { replyTo: xmas, reactions: [['m-gravel', '😂']] });
  say('club', 'm-smokey', 26 * 60, 'North’s coming down in force.');
  say('club', 'm-spanner', 20 * 60, 'Sunday arvo. Not a bad way to finish the weekend.', {
    photos: [['demo/dusk-run.jpg', 1200, 900]], reactions: [['m-rusty', '🔥'], ['m-throttle', '🔥'], ['m-jet', '❤️']],
  });
  say('club', 'm-throttle', 5 * 60, 'Little Red’s got new pipes. Sorry in advance, neighbours.', { reactions: [['m-chook', '😂']] });
  say('club', 'm-rusty', 3 * 60, 'Rego reminder for the summer runs: check yours at https://www.vicroads.vic.gov.au before the Christmas ride.');
  say('club', 'm-gravel', 55, null, { voice: ['demo/voice-late.m4a', 6300], reactions: [['m-diesel', '😂']] });
  say('club', 'm-ben', 40, 'G’day all, Ben here. Rode with North last month. Keen for the Christmas ride if there’s room.', {
    reactions: [['m-smokey', '👍'], ['m-jet', '👍']],
  });

  say('chapter:ch-west', 'm-torque', 3 * 24 * 60, 'Meeting Thursday 7:30 at the clubhouse. Bring your Christmas ride numbers.');
  say('chapter:ch-west', 'm-spanner', 9 * 60, 'Who’s got a spare 10 mm socket? Asking for the CB750.');
  say('chapter:ch-west', 'm-chook', 9 * 60 - 3, 'Under your seat. Where you left it.', { reactions: [['m-gravel', '😂'], ['m-sparks', '😂']] });
  say('chapter:ch-west', 'm-gravel', 2 * 60, 'Breakfast run on the 8th, KSU 8:30. Tail gunner in hi-vis.');

  say('chapter:ch-north', 'm-jet', 30 * 60, 'Coffee run is on, Kilmore Bakery, 9 sharp.');
  say('chapter:ch-north', 'm-ace', 28 * 60, 'Back way through Pyalong was mint.', { photos: [['demo/twisties.jpg', 900, 1200]] });
  say('chapter:ch-north', 'm-ratchet', 6 * 60, 'Phoning in from the Sunshine Coast. Save me a vanilla slice.');

  say('board:ch-west', 'm-torque', 2 * 24 * 60, 'Draft agenda is up. Sparks has the Treasurer’s report.');
  say('board:ch-west', 'm-sparks', 2 * 24 * 60 - 45, 'Done. Rusty Bus rego is due in December.');
  say('board:ch-north', 'm-smokey', 4 * 24 * 60, 'Lefty’s FNG time is up in January. Worth a chat at the next meeting.');

  say('nec', 'm-rusty', 3 * 24 * 60, 'Christmas ride numbers so far: 23 across both chapters.');
  say('nec', 'm-smokey', 3 * 24 * 60 - 60, 'North will have a few more by Thursday.');

  const recce = say('committee:ride', 'm-diesel', 4 * 24 * 60, 'Ran the Daylesford loop for the breakfast run. Roadworks at Glenlyon, 20 min wait.');
  say('committee:ride', 'm-crank', 4 * 24 * 60 - 90, 'Go via Kyneton then, adds 10 minutes and skips the lights.', { replyTo: recce });
  say('committee:charity', 'm-jet', 5 * 24 * 60, 'Toy Run’s on the 28th. Rusty Bus can carry the toys from the clubhouse.');

  say('ride:r-past-1', 'm-rusty', 14 * 24 * 60, 'Great day. Thanks all, and thanks to Spanner for sweeping.');
  say('ride:r-past-1', 'm-sparks', 14 * 24 * 60 - 30, null, { photos: [['demo/coast-road.jpg', 1200, 900], ['demo/servo-night.jpg', 1200, 900]] });
  say('ride:r-1', 'm-spanner', 6 * 60, 'I’ll be at the back in the hi-vis. Wave if you need a hand.');

  say('direct:m-rusty:m-spanner', 'm-rusty', 4 * 60, 'Can you bring the first aid kit on the 8th?');
  say('direct:m-rusty:m-spanner', 'm-spanner', 3 * 60 + 50, 'Already in the panniers.');

  const chapters = ['ch-west', 'ch-north'];
  return {
    conversations: [
      conv('club', { kind: 'club', pinnedMessageId: xmas }),
      conv('nec', { kind: 'nec' }),
      conv('committee:ride', { kind: 'committee', committee: 'ride' }),
      conv('committee:charity', { kind: 'committee', committee: 'charity' }),
      ...chapters.flatMap((c) => [conv(`chapter:${c}`, { kind: 'chapter', chapterId: c }), conv(`board:${c}`, { kind: 'board', chapterId: c })]),
      ...[...DEMO_PAST_RIDES, ...rides].map((r) => conv(`ride:${r.id}`, { kind: 'ride', rideId: r.id })),
      conv('direct:m-rusty:m-spanner', { kind: 'direct', memberIds: ['m-rusty', 'm-spanner'] }),
    ],
    messages,
    reads: [],
    blocks: [],
    reports: [],
  };
}
