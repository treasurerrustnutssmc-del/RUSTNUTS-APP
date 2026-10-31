import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction, type RunDeps } from './assistantRun';
import { planningClub, who } from '../domain/planning.testkit';

function fakes() {
  const calls: unknown[][] = [];
  const rec = (name: string, result: unknown = undefined) => async (...args: unknown[]) => { calls.push([name, ...args]); return result; };
  const data = planningClub();
  const deps: RunDeps = {
    club: {
      setRsvp: rec('setRsvp'), setCrew: rec('setCrew'), leaveCrew: rec('leaveCrew'), callRide: rec('callRide'),
      bookBus: rec('bookBus', 'b-1') as RunDeps['club']['bookBus'], cancelBus: rec('cancelBus'), logBusKm: rec('logBusKm'), handBusKeys: rec('handBusKeys'),
    },
    chat: { send: rec('send'), openDirect: rec('openDirect', 'chat-direct') as RunDeps['chat']['openDirect'] },
    me: who(data, 'rider'),
    data,
    openUrl: rec('openUrl'),
  };
  return { deps, calls };
}

test('each plan runs the app’s own action as the member', async () => {
  const cases: [Parameters<typeof runAction>[0], unknown[][], RegExp][] = [
    [{ kind: 'rsvp', rideId: 'r-west', answer: 'going' }, [['setRsvp', 'r-west', 'going']], /^Done: answered Going for Coffee run\.$/],
    [{ kind: 'join_crew', rideId: 'r-west', role: 'officer' }, [['setCrew', 'r-west', 'rider', 'officer']], /as Officer/],
    [{ kind: 'leave_crew', rideId: 'r-west' }, [['leaveCrew', 'r-west', 'rider']], /off the crew/],
    [{ kind: 'call_ride', rideId: 'r-west', state: 'off', reason: 'Rain', newDay: null }, [['callRide', 'r-west', 'off', 'Rain', null]], /called off/],
    [{ kind: 'book_bus', input: { firstDay: '2026-11-08', lastDay: '2026-11-08', purpose: 'other', rideId: null, driverId: 'rider', notes: '' } },
      [['bookBus', { firstDay: '2026-11-08', lastDay: '2026-11-08', purpose: 'other', rideId: null, driverId: 'rider', notes: '' }]], /booking is in/],
    [{ kind: 'cancel_bus', bookingId: 'b-1' }, [['cancelBus', 'b-1']], /cancelled/],
    [{ kind: 'log_bus_km', input: { km: 45210, readOn: '2026-11-01', bookingId: null, note: '' } }, [['logBusKm', { km: 45210, readOn: '2026-11-01', bookingId: null, note: '' }]], /45,210 km/],
    [{ kind: 'hand_bus_keys', toId: 'tg', note: '' }, [['handBusKeys', 'tg', '']], /with tg/],
    [{ kind: 'post_message', chatId: 'chat-west', text: 'Hi' }, [['send', 'chat-west', 'Hi', [], null]], /posted/],
    [{ kind: 'open_calendar', url: 'https://calendar.google.com/x' }, [['openUrl', 'https://calendar.google.com/x']], /press Save/],
    [{ kind: 'send_idea', toId: 'rc', text: 'Ride idea' }, [['openDirect', 'rc'], ['send', 'chat-direct', 'Ride idea', [], null]], /went to rc/],
  ];
  for (const [plan, expected, said] of cases) {
    const { deps, calls } = fakes();
    const result = await runAction(plan, deps);
    assert.deepEqual(calls, expected, plan.kind);
    assert.match(result, said, plan.kind);
  }
});

test('a failing action throws its own words', async () => {
  const { deps } = fakes();
  deps.club.setRsvp = async () => { throw new Error('That ride has already started.'); };
  await assert.rejects(runAction({ kind: 'rsvp', rideId: 'r-west', answer: 'going' }, deps), /already started/);
});
