// Fees run by club year: from one Association AGM to the next (constitution v4, definitions). The
// AGM is meant to be in August, so until its date is recorded the app assumes 1 August. A Full
// member patched partway through a year pays for the whole months left (Jeff, 25 Oct 2026). The
// treasurer's books stay on the financial year (fyOf in fees.ts). The database applies the same
// rules (private.club_year_of, private.pro_rata and the patch-in trigger).

import { activePositions } from './access';
import { addDays } from './dates';
import type { Agm, Charge, ClubData, Member, Position } from './types';

export const DEFAULT_AGM = '08-01';
export const RECORD_AGM_ONLY = 'Only the National Chairman or Secretary records the AGM.';

/** The AGM in that calendar year: as recorded, or else 1 August. */
export function agmOn(year: number, agms: Agm[] = []): string {
  return agms.find((a) => a.year === year)?.heldOn ?? `${year}-${DEFAULT_AGM}`;
}

export function agmAssumed(year: number, agms: Agm[] = []): boolean {
  return !agms.some((a) => a.year === year);
}

/** The club year a date falls in, by the year its AGM is in (2026 = AGM 2026 to AGM 2027). */
export function clubYearOf(iso: string, agms: Agm[] = []): number {
  const y = Number(iso.slice(0, 4));
  return iso >= agmOn(y, agms) ? y : y - 1;
}

export function clubYearLabel(year: number): string {
  return `${year}–${String((year + 1) % 100).padStart(2, '0')}`;
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));

/**
 * A year's fee for someone patched on that date: the whole months left, counting the month they
 * were patched, up to the next AGM's month, to the nearest dollar. Patched on or before the
 * year's AGM, or in its own month, is the full year.
 */
export function proRata(amountCents: number, patchedOn: string, year: number, agms: Agm[] = []): { cents: number; months: number } {
  if (patchedOn <= agmOn(year, agms)) return { cents: amountCents, months: 12 };
  const months = Math.min(12, Math.max(1, monthIndex(agmOn(year + 1, agms)) - monthIndex(patchedOn)));
  if (months === 12) return { cents: amountCents, months };
  return { cents: Math.round((amountCents * months) / 12 / 100) * 100, months };
}

export const proRataNote = (months: number): string | null => (months < 12 ? `Pro rata, ${months} of 12 months` : null);

/**
 * The fee to add when someone becomes Full (from anything but Nomad): that club year's Full fee,
 * pro rata, if it's set and they have no fee for the year yet. Members on hiatus don't pay.
 */
export function patchInCharge(before: Member, after: Member, data: ClubData, today: string): Omit<Charge, 'id' | 'createdAt'> | null {
  if (after.status !== 'full' || before.status === 'full' || before.status === 'nomad') return null;
  if (after.approval !== 'approved' || after.onHiatus) return null;
  const year = clubYearOf(today, data.agms);
  const rate = (data.feeRates ?? []).find((r) => r.chapterId === after.chapterId && r.fy === year && r.status === 'full');
  if (!rate) return null;
  if ((data.charges ?? []).some((c) => c.memberId === after.id && c.fy === year && c.kind === 'annual')) return null;
  const { cents, months } = proRata(rate.amountCents, after.patchedOn ?? today, year, data.agms);
  const soonest = addDays(today, 30);
  return {
    memberId: after.id, chapterId: after.chapterId, fy: year, kind: 'annual', description: proRataNote(months),
    amountCents: cents, dueOn: rate.dueOn < soonest ? soonest : rate.dueOn, waivedAt: null,
  };
}

export function recordAgmProblem(me: Member | null, positions: Position[]): string | null {
  if (!me || me.approval !== 'approved') return RECORD_AGM_ONLY;
  const ok = activePositions(me.id, positions).some((p) => p.role === 'nec_chair' || p.role === 'nec_secretary');
  return ok ? null : RECORD_AGM_ONLY;
}
