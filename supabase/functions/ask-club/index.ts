// ask-club: Ask the club, the club AI assistant. A signed-in member's question goes to Claude with the
// constitution and Road Rules; the answer and any proposed actions go back to the phone, which shows
// each action on a card for the member to confirm. Deployed with verify_jwt on. Needs the Edge
// Function secret ANTHROPIC_API_KEY (the club's Anthropic Console key); without it, it answers
// "not switched on". The rules live in ../_shared/askClub.ts.
// The same function drafts meeting minutes from an Otter transcript ({ mode: 'minutes' }, rules in
// ../_shared/minutesDraft.ts) and sums up missed chat ({ mode: 'catchup' }, ../_shared/catchUp.ts),
// so all three share the key, the budget and one deploy.

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleAskClub, type ClaudeResponse, type Sources } from '../_shared/askClub.ts';
import { handleCatchUp, type CatchUpContext } from '../_shared/catchUp.ts';
import { handleMinutesDraft, type MinutesContext } from '../_shared/minutesDraft.ts';

// The web build calls from the browser, which asks first (OPTIONS) and needs these headers back.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return Response.json({ error: 'POST a question.' }, { status: 405, headers: CORS });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  // As the member, so the database decides who may ask.
  const asMember = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const body = await req.json().catch(() => ({}));
  const spent = async (microusd: number) => {
    const r = await admin.rpc('assistant_spent', { p_microusd: microusd });
    if (r.error) console.error('assistant_spent', r.error.message);
  };
  // One try inside the Edge Function's time limit (150 seconds on the free plan): a slow answer
  // says try again rather than the function being cut off with nothing said.
  const claude = async (request: unknown) => {
    const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });
    // deno-lint-ignore no-explicit-any
    return (await client.beta.messages.create(request as any)) as unknown as ClaudeResponse;
  };
  if ((body as { mode?: unknown })?.mode === 'minutes') {
    const drafted = await handleMinutesDraft({ ANTHROPIC_API_KEY: apiKey }, body, {
      start: async (meetingId): Promise<MinutesContext> => {
        const r = await asMember.rpc('minutes_draft_start', { p_meeting: meetingId });
        if (r.error) throw new Error(r.error.message);
        return r.data as MinutesContext;
      },
      claude,
      spent,
    });
    return Response.json(drafted.body, { status: drafted.status, headers: CORS });
  }
  if ((body as { mode?: unknown })?.mode === 'catchup') {
    const caught = await handleCatchUp({ ANTHROPIC_API_KEY: apiKey }, body, {
      start: async (chatId, count): Promise<CatchUpContext> => {
        const r = await asMember.rpc('catchup_start', { p_chat: chatId, p_count: count });
        if (r.error) throw new Error(r.error.message);
        return r.data as CatchUpContext;
      },
      claude,
      spent,
    });
    return Response.json(caught.body, { status: caught.status, headers: CORS });
  }
  const answer = await handleAskClub({ ANTHROPIC_API_KEY: apiKey }, body, {
    start: async (): Promise<Sources> => {
      const r = await asMember.rpc('assistant_start');
      if (r.error) throw new Error(r.error.message);
      const d = r.data as { constitution: Sources['constitution']; road_rules: Sources['roadRules'] };
      return { constitution: d.constitution ?? null, roadRules: d.road_rules ?? null };
    },
    claude,
    spent,
  });
  return Response.json(answer.body, { status: answer.status, headers: CORS });
});
