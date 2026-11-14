// Website enquiries as rows from the database, and the demo build's made-up ones.
import type { Enquiry } from '../domain/enquiries';

export interface EnquiryRow {
  id: string;
  name: string;
  email: string;
  chapter_slug: string;
  about: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
  note: string | null;
}

export function toEnquiries(rows: EnquiryRow[]): Enquiry[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    chapter: r.chapter_slug as Enquiry['chapter'],
    about: r.about,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledBy: r.handled_by,
    note: r.note,
  }));
}

const HOUR_MS = 3_600_000;

/** Two sample enquiries so the demo Board screen shows what the section looks like: one 38 hours old, one handled. */
export function demoEnquiries(now: Date): Enquiry[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  return [
    {
      id: 'demo-enquiry-1',
      name: 'Sam Rider',
      email: 'sam.rider@example.com',
      chapter: 'west',
      about: 'Ride a 2019 Street Glide, out Werribee way. Keen for the Sunday runs and a beer after.',
      createdAt: ago(38),
      handledAt: null,
      handledBy: null,
      note: null,
    },
    {
      id: 'demo-enquiry-2',
      name: 'Priya Nair',
      email: 'priya.n@example.com',
      chapter: 'either',
      about: 'New to Melbourne, Triumph Bonneville. Which chapter rides nearest Sunbury?',
      createdAt: ago(4 * 24),
      handledAt: ago(4 * 24 - 10),
      handledBy: 'demo-pres',
      note: 'Emailed her the North ride calendar.',
    },
  ];
}

/** Marks one handled in the demo list. */
export function demoHandleEnquiry(list: Enquiry[], id: string, handledBy: string, note: string, now: string): Enquiry[] {
  const trimmed = note.trim();
  return list.map((e) => (e.id === id ? { ...e, handledAt: now, handledBy, note: trimmed ? trimmed : null } : e));
}
