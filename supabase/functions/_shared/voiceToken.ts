// Ride comms tokens: who gets into which ride's voice room, and what they can do there. The database
// decides who (public.ride_voice_room, with the live ride rules); this turns its answer into a
// LiveKit token. Shared by the ride-voice-token Edge Function and the app's tests.

export const TOKEN_TTL_SECONDS = 3 * 60 * 60;
export const NOT_SWITCHED_ON = 'Ride comms isn’t switched on yet.';

export interface VoiceEnv {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}

/** Audio only, one room, no data and nothing recorded (no recording rights are ever granted). */
export function voiceGrant(room: string) {
  return {
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: ['microphone'],
    canSubscribe: true,
    canPublishData: false,
  };
}

export interface VoiceDeps {
  /** The signed-in member's id, or null. */
  userId: () => Promise<string | null>;
  /** public.ride_voice_room as the member: throws the database's words when they can't join. */
  room: (rideId: string) => Promise<{ room: string; name: string; closes: string }>;
  /** `ttl` in seconds. */
  sign: (who: { identity: string; name: string }, room: string, ttl: number) => Promise<string>;
  now?: () => number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VoiceAnswer =
  | { status: 200; body: { url: string; token: string } }
  | { status: 400 | 401 | 403 | 503; body: { error: string } };

export async function handleVoiceToken(env: VoiceEnv, request: { rideId?: unknown }, deps: VoiceDeps): Promise<VoiceAnswer> {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return { status: 503, body: { error: NOT_SWITCHED_ON } };
  const rideId = typeof request.rideId === 'string' ? request.rideId : '';
  if (!UUID.test(rideId)) return { status: 400, body: { error: 'Which ride?' } };
  const identity = await deps.userId();
  if (!identity) return { status: 401, body: { error: 'Sign in first.' } };
  let room: { room: string; name: string; closes: string };
  try {
    room = await deps.room(rideId);
  } catch (e) {
    return { status: 403, body: { error: (e as Error).message } };
  }
  // Never past the live window's close, so nobody can join after the ride. (Someone already in is
  // hung up by their app; removing them from the server side is a later step.)
  const left = Math.floor((Date.parse(room.closes) - (deps.now ?? Date.now)()) / 1000);
  const ttl = Math.max(60, Math.min(TOKEN_TTL_SECONDS, left));
  const token = await deps.sign({ identity, name: room.name }, room.room, ttl);
  return { status: 200, body: { url: env.LIVEKIT_URL, token } };
}
