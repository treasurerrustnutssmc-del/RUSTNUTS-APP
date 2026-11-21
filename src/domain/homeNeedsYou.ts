/**
 * Home's "Needs you": everything waiting on the person signed in, so it's the first thing they see
 * when they open the app (Jeff, 21 Nov 2026: "if there is anything that someone needs to approve it
 * should be the first thing they see"). Approvals first, then what's waiting on them personally.
 * Rego, licence and first aid reminders are not here: they sit at the bottom of Home ("approvals
 * top, regos bottom"). Every row opens where it's dealt with.
 * Spec: docs/superpowers/specs/2026-11-21-home-needs-you-design.md
 */
import { accessLevel, pendingFor } from './access';
import { requestsToAnswer } from './audit';
import { boardRequests, boardScope, requestNext } from './boardLayout';
import { managesBus, waitingForYes } from './bus';
import { businessFor } from './business';
import { canManageFees, chargesOf, formatCents, totalOwing } from './fees';
import { fngDue } from './joining';
import { keepsBooks, needsMyApproval } from './ledger';
import { ordersToAct } from './merch';
import { contributionsToDecide } from './national';
import { openNoticesOf } from './notices';
import { boardWatchList } from './profile';
import { mustSignFirst } from './roadRules';
import { runsShop } from './shop';
import type { ClubData, Member } from './types';

export type NeedsYouGroup = 'approve' | 'you';

/** Where a row opens: a route and its params, as navigation takes them. */
export interface NeedsYouTarget {
  screen: string;
  params?: Record<string, unknown>;
}

export interface NeedsYouItem {
  key: string;
  group: NeedsYouGroup;
  icon: string;
  title: string;
  subtitle?: string;
  to: NeedsYouTarget;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything waiting on `me`, approvals first. Empty when there's nothing, so the card hides. */
export function homeNeedsYou(me: Member | null, data: ClubData, today: string, now: string): NeedsYouItem[] {
  if (!me || me.approval !== 'approved') return [];
  const level = accessLevel(me, data.positions);
  const isBoard = level === 'board' || level === 'national';
  const approve: NeedsYouItem[] = [];
  const you: NeedsYouItem[] = [];

  // People asking to join: the first thing a board member sees.
  const pending = pendingFor(me, data);
  if (pending.length) {
    approve.push({
      key: 'applicants',
      group: 'approve',
      icon: 'person-add',
      title: `${plural(pending.length, 'person', 'people')} waiting for approval`,
      subtitle: pending.map((p) => p.fullName).join(', '),
      to: { screen: 'Board', params: { focus: 'pending' } },
    });
  }

  // Acting and cover requests with a step for me: confirm it, or start the board vote. An open vote on
  // one is not counted here: casting it is a "votes" row, and once cast there's nothing left to do.
  const requests = boardRequests(me, data, now).filter((r) => {
    const next = requestNext(r, me, data, now);
    return next !== null && next.kind !== 'see';
  });
  if (requests.length) {
    approve.push({
      key: 'acting',
      group: 'approve',
      icon: 'swap-horizontal',
      title: plural(requests.length, 'acting or cover request to deal with', 'acting or cover requests to deal with'),
      to: { screen: 'Board' },
    });
  }

  // Rusty Bus bookings waiting for a yes or no.
  if (managesBus(me, data)) {
    const bus = waitingForYes(data, today);
    if (bus.length) {
      approve.push({
        key: 'bus',
        group: 'approve',
        icon: 'bus',
        title: plural(bus.length, 'Rusty Bus booking to say yes or no to', 'Rusty Bus bookings to say yes or no to'),
        to: bus.length === 1 ? { screen: 'BusBooking', params: { bookingId: bus[0].id } } : { screen: 'Bus' },
      });
    }
  }

  // Payments members say they've made, for the treasurer to check in the account (never their own).
  const claims = (data.payments ?? []).filter((p) => {
    if (p.state !== 'claimed') return false;
    const charge = (data.charges ?? []).find((c) => c.id === p.chargeId);
    return !!charge && charge.memberId !== me.id && canManageFees(me, charge.chapterId, data.positions);
  });
  if (claims.length) {
    const chapters = [
      ...new Set(claims.map((p) => (data.charges ?? []).find((c) => c.id === p.chargeId)!.chapterId)),
    ];
    approve.push({
      key: 'payments',
      group: 'approve',
      icon: 'cash-outline',
      title: plural(claims.length, 'payment to check in the account', 'payments to check in the account'),
      to: chapters.length === 1 ? { screen: 'ChapterFees', params: { chapterId: chapters[0] } } : { screen: 'Board' },
    });
  }

  // The books: entries waiting for this person's approval.
  const entries = needsMyApproval(me, data);
  if (entries.length) {
    approve.push({
      key: 'ledger',
      group: 'approve',
      icon: 'book-outline',
      title: plural(entries.length, 'book entry to approve', 'book entries to approve'),
      to: { screen: 'Treasury' },
    });
  }

  // Shop: in-app orders to resend or hand over (the shop runner), or to mark paid (the books-keepers);
  // and the older merch orders waiting on a yes, a hand-over or a payment.
  const shop = data.shopOrders ?? [];
  const shopToDo =
    (runsShop(me, data) ? shop.filter((o) => o.status === 'held' || o.status === 'paid').length : 0) +
    (keepsBooks(me, null, data.positions) ? shop.filter((o) => o.status === 'sent').length : 0);
  if (shopToDo) {
    approve.push({
      key: 'shop',
      group: 'approve',
      icon: 'shirt-outline',
      title: plural(shopToDo, 'shop order to deal with', 'shop orders to deal with'),
      to: { screen: 'ShopAdmin' },
    });
  }
  const merch = ordersToAct(me, data);
  if (merch.length) {
    approve.push({
      key: 'merch',
      group: 'approve',
      icon: 'pricetag-outline',
      title: plural(merch.length, 'merch order to deal with', 'merch orders to deal with'),
      to: { screen: 'Shop' },
    });
  }

  // National contributions this person's board still has to decide.
  const contributions = contributionsToDecide(me, data);
  if (contributions.length) {
    approve.push({
      key: 'contributions',
      group: 'approve',
      icon: 'flag',
      title: plural(contributions.length, 'national contribution to decide', 'national contributions to decide'),
      to: { screen: 'National' },
    });
  }

  // The National Auditor's questions to answer.
  const audit = requestsToAnswer(me, data);
  if (audit.length) {
    approve.push({
      key: 'audit',
      group: 'approve',
      icon: 'search',
      title: plural(audit.length, 'question from the Auditor to answer', 'questions from the Auditor to answer'),
      to: { screen: 'Audit' },
    });
  }

  // FNG reviews whose day has passed.
  if (isBoard) {
    const due = boardWatchList(data.members, boardScope(me, data.positions)).filter(
      (m) => m.status === 'fng' && fngDue(m, data.decisions ?? [], today)?.overdue,
    );
    if (due.length) {
      approve.push({
        key: 'fng-reviews',
        group: 'approve',
        icon: 'ribbon-outline',
        title: plural(due.length, 'FNG review due', 'FNG reviews due'),
        subtitle: due.map((m) => m.roadName ?? m.fullName).join(', '),
        to: due.length === 1 ? { screen: 'FngReview', params: { memberId: due[0].id } } : { screen: 'Board', params: { focus: 'fngs' } },
      });
    }
  }

  // Waiting on me personally: votes to cast, a 5.5 notice to answer, the Road Rules to sign, fees owing.
  const votes = businessFor(me, data, now).needsMe;
  if (votes.length) {
    you.push({
      key: 'votes',
      group: 'you',
      icon: 'hand-left-outline',
      title: plural(votes.length, 'vote waiting for you', 'votes waiting for you'),
      subtitle: votes.length === 1 ? votes[0].question : undefined,
      to: votes.length === 1 ? { screen: 'Vote', params: { voteId: votes[0].id } } : { screen: 'Business' },
    });
  }
  const notices = openNoticesOf(me.id, data).filter((n) => n.respondBy >= today);
  for (const n of notices) {
    you.push({
      key: `notice-${n.id}`,
      group: 'you',
      icon: 'mail-unread-outline',
      title: 'A notice from your board to answer',
      to: { screen: 'StatusNotice', params: { noticeId: n.id } },
    });
  }
  if (mustSignFirst(me, data, today)) {
    you.push({
      key: 'road-rules',
      group: 'you',
      icon: 'document-text-outline',
      title: 'Sign the Road Rules',
      to: { screen: 'RoadRules' },
    });
  }
  // Fees still to pay, less what you've told the treasurer you've paid (it waits on them, not you).
  const mine = new Set(chargesOf(me.id, data).map((c) => c.id));
  const told = (data.payments ?? [])
    .filter((p) => p.state === 'claimed' && mine.has(p.chargeId))
    .reduce((sum, p) => sum + p.amountCents, 0);
  const toPay = totalOwing(me.id, data) - told;
  if (toPay > 0) {
    you.push({
      key: 'fees',
      group: 'you',
      icon: 'wallet-outline',
      title: `${formatCents(toPay)} in fees to pay`,
      subtitle: told > 0 ? `You’ve told the treasurer about ${formatCents(told)}` : undefined,
      to: { screen: 'MemberFees', params: { memberId: me.id } },
    });
  }

  return [...approve, ...you];
}
