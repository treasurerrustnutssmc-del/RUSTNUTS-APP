// ask-club: Ask the club, the club AI assistant. A signed-in member's question goes to Claude with the
// constitution and Road Rules; the answer and any proposed actions go back to the phone, which shows
// each action on a card for the member to confirm. Deployed with verify_jwt on. Needs the Edge
// Function secret ANTHROPIC_API_KEY (the club's Anthropic Console key); without it, it answers
// "not switched on". The rules live in ../_shared/askClub.ts.

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleAskClub, type ClaudeResponse, type Sources } from '../_shared/askClub.ts';

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
  const answer = await handleAskClub({ ANTHROPIC_API_KEY: apiKey }, body, {
    start: async (): Promise<Sources> => {
      const r = await asMember.rpc('assistant_start');
      if (r.error) throw new Error(r.error.message);
      const d = r.data as { constitution: Sources['constitution']; road_rules: Sources['roadRules'] };
      return { constitution: d.constitution ?? null, roadRules: d.road_rules ?? null };
    },
    claude: async (request) => {
      // One try inside the Edge Function's time limit (150 seconds on the free plan): a slow answer
      // says try again rather than the function being cut off with nothing said.
      const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 0 });
      return (await client.beta.messages.create(request)) as unknown as ClaudeResponse;
    },
    spent: async (microusd) => {
      const r = await admin.rpc('assistant_spent', { p_microusd: microusd });
      if (r.error) console.error('assistant_spent', r.error.message);
    },
  });
  return Response.json(answer.body, { status: answer.status, headers: CORS });
});
