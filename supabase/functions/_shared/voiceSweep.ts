// The voice sweep (ChatGPT audit F03): a LiveKit token only matters when someone joins, so this takes
// out of a ride's voice room anyone who has lost the right to be there, and closes the rooms of rides
// that are over or called off. The database decides (public.voice_sweep, the same rule as joining);
// LiveKit and the database are passed in, so `npm test` runs exactly what the voice-sweep Edge
// Function runs. Spec: docs/superpowers/specs/2026-11-03-audit-deferred-f03-f09-design.md.

/** The same three secrets as ride-voice-token. */
export interface VoiceEnv {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}

export interface SweepDecision {
  room: string;
  close: boolean;
  remove: string[];
}

export interface SweepDeps {
  /** Names of LiveKit's open rooms. */
  listRooms: () => Promise<string[]>;
  /** Identities (member ids) in a room. */
  listParticipants: (room: string) => Promise<string[]>;
  /** public.voice_sweep with the service role. */
  decide: (rooms: { room: string; members: string[] }[]) => Promise<SweepDecision[]>;
  /** Ends the room, which takes everyone out. */
  closeRoom: (room: string) => Promise<void>;
  remove: (room: string, identity: string) => Promise<void>;
}

export interface SweepResult {
  switchedOn: boolean;
  rooms: number;
  closed: number;
  removed: number;
  failed: number;
}

/** LiveKit's room service lives at the same host as the voice server, over http(s). */
export function roomServiceHost(url: string): string {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export async function sweepVoice(env: VoiceEnv, deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { switchedOn: false, rooms: 0, closed: 0, removed: 0, failed: 0 };
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return result;
  result.switchedOn = true;
  const rooms = (await deps.listRooms()).filter((r) => r.startsWith('ride-'));
  result.rooms = rooms.length;
  if (!rooms.length) return result;
  const list = [];
  for (const room of rooms) {
    try {
      list.push({ room, members: await deps.listParticipants(room) });
    } catch (e) {
      // Most likely it closed itself (empty) since the list; the next sweep sees it either way.
      result.failed++;
      console.error('voice-sweep list', room, (e as Error).message);
    }
  }
  if (!list.length) return result;
  for (const d of await deps.decide(list)) {
    if (d.close) {
      try {
        await deps.closeRoom(d.room);
        result.closed++;
      } catch (e) {
        result.failed++;
        console.error('voice-sweep close', d.room, (e as Error).message);
      }
      continue;
    }
    for (const who of d.remove) {
      try {
        await deps.remove(d.room, who);
        result.removed++;
      } catch (e) {
        result.failed++;
        console.error('voice-sweep remove', d.room, who, (e as Error).message);
      }
    }
  }
  return result;
}
