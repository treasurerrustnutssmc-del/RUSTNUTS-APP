// The digital membership card: who you are in the club, this club year, and whether this year's
// dues are paid. The member disc only shows for Full and Nomad members (brand rule).

import { clubYearLabel, clubYearOf } from './clubYear';
import { chargeBalance } from './fees';
import { hasEarnedDisc } from './profile';
import type { ClubData, Member } from './types';

export type CardDues = { state: 'paid' } | { state: 'due'; dueOn: string } | null;

export interface CardInfo {
  showDisc: boolean;
  clubYear: string;
  dues: CardDues;
}

export function cardOf(member: Member, data: ClubData, today: string): CardInfo {
  const year = clubYearOf(today, data.agms);
  const charge = (data.charges ?? []).find((c) => c.memberId === member.id && c.fy === year && c.kind === 'annual');
  let dues: CardDues = null;
  if (charge) {
    const balance = chargeBalance(charge, data.payments ?? []);
    dues = balance.owingCents === 0 ? { state: 'paid' } : { state: 'due', dueOn: charge.dueOn };
  }
  return { showDisc: hasEarnedDisc(member), clubYear: clubYearLabel(year), dues };
}
