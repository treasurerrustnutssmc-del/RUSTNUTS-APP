import { describeExpiry, expiryState, type ExpiryState } from './dates';
import type { ClubData, Member } from './types';

export interface ChecklistItem {
  key: 'phone' | 'emergency' | 'bike' | 'rego' | 'licence';
  label: string;
  done: boolean;
}

/** What a member still needs to fill in. Emergency contact comes first: it matters on ride day. */
export function profileChecklist(member: Member, data: ClubData): ChecklistItem[] {
  const priv = data.privates.find((p) => p.memberId === member.id);
  const bikes = data.bikes.filter((b) => b.memberId === member.id);
  const regos = bikes
    .filter((b) => !b.isProject)
    .map((b) => data.registrations.find((r) => r.bikeId === b.id));
  const contacts = data.emergencyContacts.filter((c) => c.memberId === member.id);

  return [
    { key: 'emergency', label: 'Emergency contact', done: contacts.length > 0 },
    { key: 'phone', label: 'Mobile number', done: !!priv?.phone },
    { key: 'bike', label: 'Your bike', done: bikes.length > 0 },
    {
      key: 'rego',
      label: 'Bike rego and expiry',
      done: regos.length > 0 && regos.every((r) => !!r?.rego && !!r?.regoExpiry),
    },
    { key: 'licence', label: 'Licence and expiry', done: !!priv?.licenceClass && !!priv?.licenceExpiry },
  ];
}

export interface ExpiryAlert {
  memberId: string;
  kind: 'rego' | 'licence' | 'first_aid';
  label: string; // "Rego · Big Red (1AB 2CD)"
  expiry: string;
  state: Exclude<ExpiryState, 'ok' | 'missing'>;
  description: string;
}

/** Regos, licences and first aid certificates that have expired or expire within 30 days. */
export function expiryAlerts(members: Member[], data: ClubData, today: string): ExpiryAlert[] {
  const alerts: ExpiryAlert[] = [];
  const push = (memberId: string, kind: ExpiryAlert['kind'], label: string, expiry: string | null) => {
    const state = expiryState(expiry, today);
    if (expiry && (state === 'soon' || state === 'expired')) {
      alerts.push({ memberId, kind, label, expiry, state, description: describeExpiry(expiry, today) });
    }
  };

  for (const m of members) {
    const priv = data.privates.find((p) => p.memberId === m.id);
    push(m.id, 'licence', 'Licence', priv?.licenceExpiry ?? null);
    push(m.id, 'first_aid', 'First aid certificate', priv?.firstAidExpiry ?? null);
    for (const bike of data.bikes.filter((b) => b.memberId === m.id && !b.isProject)) {
      const reg = data.registrations.find((r) => r.bikeId === bike.id);
      const name = bike.nickname ?? `${bike.make} ${bike.model}`;
      push(m.id, 'rego', `Rego · ${name}${reg?.rego ? ` (${reg.rego})` : ''}`, reg?.regoExpiry ?? null);
    }
  }
  return alerts.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** The MEMBER disc is earned at full membership (nomads are full members living away), never given. */
export function hasEarnedDisc(m: Pick<Member, 'status' | 'approval'>): boolean {
  return m.approval === 'approved' && (m.status === 'full' || m.status === 'nomad');
}

export function displayName(m: Pick<Member, 'roadName' | 'fullName'>): string {
  return m.roadName ?? m.fullName.split(' ')[0];
}

export function initials(m: Pick<Member, 'roadName' | 'fullName'>): string {
  const src = m.roadName ?? m.fullName;
  const parts = src.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2)).toUpperCase();
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/**
 * FNG reviews fall at 6, 9 and 12 months (constitution 5.2 and 5.4), then every
 * 3 months if no decision has been made (5.5). Returns the next one on or after today.
 */
export function nextFngReview(fngStartedOn: string, today: string): { atMonths: number; date: string; overdue12: boolean } {
  let months = 6;
  while (addMonths(fngStartedOn, months) < today) months += 3;
  return { atMonths: months, date: addMonths(fngStartedOn, months), overdue12: months > 12 };
}
