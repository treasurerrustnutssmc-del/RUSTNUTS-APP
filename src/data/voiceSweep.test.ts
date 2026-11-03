import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomServiceHost, sweepVoice } from '../../supabase/functions/_shared/voiceSweep';

const env = { LIVEKIT_URL: 'wss://rustnuts.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' };

function fake(rooms: Record<string, string[]>, decisions: { room: string; close: boolean; remove: string[] }[]) {
  const done: string[] = [];
  const asked: unknown[] = [];
  return {
    done,
    asked,
    deps: {
      listRooms: async () => Object.keys(rooms),
      listParticipants: async (room: string) => rooms[room],
      decide: async (list: { room: string; members: string[] }[]) => {
        asked.push(list);
        return decisions;
      },
      closeRoom: async (room: string) => {
        done.push(`close ${room}`);
      },
      remove: async (room: string, who: string) => {
        if (who === 'stuck') throw new Error('LiveKit said no');
        done.push(`remove ${who} from ${room}`);
      },
    },
  };
}

test('ride rooms and who is in them go to the database, and its answer is carried out', async () => {
  const f = fake(
    { 'ride-r1': ['m1', 'm2'], 'ride-r2': ['m1'], 'someone-else': ['x'] },
    [{ room: 'ride-r1', close: false, remove: ['m2'] }, { room: 'ride-r2', close: true, remove: [] }],
  );
  const result = await sweepVoice(env, f.deps);
  assert.deepEqual(f.asked, [[{ room: 'ride-r1', members: ['m1', 'm2'] }, { room: 'ride-r2', members: ['m1'] }]]);
  assert.deepEqual(f.done, ['remove m2 from ride-r1', 'close ride-r2']);
  assert.deepEqual(result, { switchedOn: true, rooms: 2, closed: 1, removed: 1, failed: 0 });
});

test('no ride rooms open: the database is not asked', async () => {
  const f = fake({ 'someone-else': ['x'] }, []);
  assert.deepEqual(await sweepVoice(env, f.deps), { switchedOn: true, rooms: 0, closed: 0, removed: 0, failed: 0 });
  assert.deepEqual(f.asked, []);
});

test('one thing LiveKit refuses does not stop the rest', async () => {
  const f = fake({ 'ride-r1': ['stuck', 'm2'] }, [{ room: 'ride-r1', close: false, remove: ['stuck', 'm2'] }]);
  assert.deepEqual(await sweepVoice(env, f.deps), { switchedOn: true, rooms: 1, closed: 0, removed: 1, failed: 1 });
  assert.deepEqual(f.done, ['remove m2 from ride-r1']);
});

test('without the LiveKit secrets nothing is called', async () => {
  const f = fake({ 'ride-r1': ['m1'] }, []);
  assert.deepEqual(await sweepVoice({ LIVEKIT_URL: 'wss://x' }, f.deps), { switchedOn: false, rooms: 0, closed: 0, removed: 0, failed: 0 });
  assert.deepEqual(f.asked, []);
});

test('the room service is reached over https at the same host', () => {
  assert.equal(roomServiceHost('wss://rustnuts.livekit.cloud'), 'https://rustnuts.livekit.cloud');
  assert.equal(roomServiceHost('ws://localhost:7880'), 'http://localhost:7880');
  assert.equal(roomServiceHost('https://rustnuts.livekit.cloud/'), 'https://rustnuts.livekit.cloud/');
});

test('a room that closes while the sweep runs is skipped, not the end of the sweep', async () => {
  const f = fake({ 'ride-gone': ['m1'], 'ride-r1': ['m2'] }, [{ room: 'ride-r1', close: false, remove: ['m2'] }]);
  const deps = { ...f.deps, listParticipants: async (room: string) => {
    if (room === 'ride-gone') throw new Error('room not found');
    return ['m2'];
  } };
  assert.deepEqual(await sweepVoice(env, deps), { switchedOn: true, rooms: 2, closed: 0, removed: 1, failed: 1 });
  assert.deepEqual(f.asked, [[{ room: 'ride-r1', members: ['m2'] }]]);
});
