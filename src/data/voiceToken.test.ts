import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceToken, NOT_SWITCHED_ON, TOKEN_TTL_SECONDS, voiceGrant } from '../../supabase/functions/_shared/voiceToken';

const env = { LIVEKIT_URL: 'wss://rustnuts.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' };
const deps = {
  userId: async () => 'm-1',
  room: async (rideId: string) => ({ room: `ride-${rideId}`, name: 'Rusty' }),
  sign: async (who: { identity: string; name: string }, room: string) => `token:${who.identity}:${who.name}:${room}`,
};

test('the grant is audio only, for one room, with nothing recorded', () => {
  assert.deepEqual(voiceGrant('ride-r1'), {
    room: 'ride-r1',
    roomJoin: true,
    canPublish: true,
    canPublishSources: ['microphone'],
    canSubscribe: true,
    canPublishData: false,
  });
  assert.equal(TOKEN_TTL_SECONDS, 3 * 60 * 60);
});

test('a member allowed in gets the server address and a token for their ride', async () => {
  const res = await handleVoiceToken(env, { rideId: 'r1' }, deps);
  assert.deepEqual(res, { status: 200, body: { url: 'wss://rustnuts.livekit.cloud', token: 'token:m-1:Rusty:ride-r1' } });
});

test('before Jeff sets the LiveKit secrets, it says so', async () => {
  const res = await handleVoiceToken({ ...env, LIVEKIT_API_SECRET: '' }, { rideId: 'r1' }, deps);
  assert.deepEqual(res, { status: 503, body: { error: NOT_SWITCHED_ON } });
  assert.equal(NOT_SWITCHED_ON, 'Ride comms isn’t switched on yet.');
});

test('the database’s words come back when the member can’t join', async () => {
  const res = await handleVoiceToken(env, { rideId: 'r1' }, {
    ...deps,
    room: async () => {
      throw new Error('Live ride opens 2 hours before the start.');
    },
  });
  assert.deepEqual(res, { status: 403, body: { error: 'Live ride opens 2 hours before the start.' } });
});

test('signed out, or no ride named, is refused', async () => {
  assert.deepEqual(await handleVoiceToken(env, { rideId: 'r1' }, { ...deps, userId: async () => null }), {
    status: 401,
    body: { error: 'Sign in first.' },
  });
  assert.deepEqual(await handleVoiceToken(env, {}, deps), { status: 400, body: { error: 'Which ride?' } });
});
