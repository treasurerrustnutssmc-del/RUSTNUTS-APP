// Ask the club: running a card the member confirmed. Every action is the app's own one, run as the
// member, so the database's rules apply exactly as they do to a tap on the ride or bus screen.
// Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md

import { doneLine, type ActionPlan } from '../domain/assistant';
import type { ClubData, Member } from '../domain/types';
import type { ChatContextValue } from './chat/chatContext';
import type { ClubContextValue } from './clubContext';

export interface RunDeps {
  club: Pick<ClubContextValue, 'setRsvp' | 'setCrew' | 'leaveCrew' | 'callRide' | 'bookBus' | 'cancelBus' | 'logBusKm' | 'handBusKeys'>;
  chat: Pick<ChatContextValue, 'send' | 'openDirect'>;
  me: Member;
  data: ClubData;
  openUrl(url: string): Promise<void>;
}

/** Runs the plan and gives the line told back to the assistant. A failure throws its own words. */
export async function runAction(plan: ActionPlan, deps: RunDeps): Promise<string> {
  const { club, chat, me } = deps;
  switch (plan.kind) {
    case 'rsvp': await club.setRsvp(plan.rideId, plan.answer); break;
    case 'join_crew': await club.setCrew(plan.rideId, me.id, plan.role); break;
    case 'leave_crew': await club.leaveCrew(plan.rideId, me.id); break;
    case 'call_ride': await club.callRide(plan.rideId, plan.state, plan.reason, plan.newDay); break;
    case 'book_bus': await club.bookBus(plan.input); break;
    case 'cancel_bus': await club.cancelBus(plan.bookingId); break;
    case 'log_bus_km': await club.logBusKm(plan.input); break;
    case 'hand_bus_keys': await club.handBusKeys(plan.toId, plan.note); break;
    case 'post_message': await chat.send(plan.chatId, plan.text, [], null); break;
    case 'open_calendar': await deps.openUrl(plan.url); break;
    case 'send_idea': {
      const chatId = await chat.openDirect(plan.toId);
      await chat.send(chatId, plan.text, [], null);
      break;
    }
  }
  return doneLine(plan, deps.data);
}
