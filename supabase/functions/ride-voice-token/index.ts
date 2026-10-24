// ride-voice-token: a LiveKit token for the ride's voice room, for a member the database lets in.
// Deployed with verify_jwt on. Needs the Edge Function secrets LIVEKIT_URL, LIVEKIT_API_KEY and
// LIVEKIT_API_SECRET (from Jeff's LiveKit Cloud project); without them it answers "not switched on".

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2.19.1';
import { handleVoiceToken, TOKEN_TTL_SECONDS, voiceGrant } from '../_shared/voiceToken.ts';

Deno.serve(async (req) => {
  const env = {
    LIVEKIT_URL: Deno.env.get('LIVEKIT_URL'),
    LIVEKIT_API_KEY: Deno.env.get('LIVEKIT_API_KEY'),
    LIVEKIT_API_SECRET: Deno.env.get('LIVEKIT_API_SECRET'),
  };
  // As the member, so the database's rules decide.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  const answer = await handleVoiceToken(env, body, {
    userId: async () => (await db.auth.getUser()).data.user?.id ?? null,
    room: async (rideId) => {
      const r = await db.rpc('ride_voice_room', { p_ride: rideId });
      if (r.error) throw new Error(r.error.message);
      return r.data as { room: string; name: string };
    },
    sign: async (who, room) => {
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { ...who, ttl: TOKEN_TTL_SECONDS });
      // The SDK writes the sources as "microphone" in the token; it takes them as its enum.
      at.addGrant({ ...voiceGrant(room), canPublishSources: [TrackSource.MICROPHONE] });
      return at.toJwt();
    },
  });
  return Response.json(answer.body, { status: answer.status });
});
