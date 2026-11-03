// voice-sweep: takes out of each ride's voice room anyone who has lost the right to be there, and
// closes the rooms of rides that are over or called off (ChatGPT audit F03). Runs every minute around
// a live ride (see migration 20270800000000_voice_sweep.sql). Deployed with verify_jwt off, like
// send-push: a call can only do what the database decides, and it must carry the CRON_SECRET in an
// x-cron-secret header. Needs the same LiveKit secrets as ride-voice-token; without them it does nothing.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { RoomServiceClient } from 'npm:livekit-server-sdk@2.19.1';
import { roomServiceHost, type SweepDecision, sweepVoice } from '../_shared/voiceSweep.ts';
import { CRON_HEADER, cronCallAllowed } from '../_shared/cronAuth.ts';

Deno.serve(async (req) => {
  if (!cronCallAllowed(req.headers.get(CRON_HEADER), Deno.env.get('CRON_SECRET'))) {
    return Response.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const env = {
    LIVEKIT_URL: Deno.env.get('LIVEKIT_URL'),
    LIVEKIT_API_KEY: Deno.env.get('LIVEKIT_API_KEY'),
    LIVEKIT_API_SECRET: Deno.env.get('LIVEKIT_API_SECRET'),
  };
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const lk = env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
    ? new RoomServiceClient(roomServiceHost(env.LIVEKIT_URL), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
    : null;
  try {
    const result = await sweepVoice(env, {
      listRooms: async () => (await lk!.listRooms()).map((r) => r.name),
      listParticipants: async (room) => (await lk!.listParticipants(room)).map((p) => p.identity),
      decide: async (rooms) => {
        const r = await db.rpc('voice_sweep', { p_rooms: rooms });
        if (r.error) throw new Error(r.error.message);
        return (r.data ?? []) as SweepDecision[];
      },
      closeRoom: async (room) => {
        await lk!.deleteRoom(room);
      },
      remove: async (room, identity) => {
        await lk!.removeParticipant(room, identity);
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
