// Catch me up in the demo: a scripted summary made from the demo chat's own newest messages, so the
// bar and card can be tried without the network. Spec: docs/superpowers/specs/2026-11-01-catch-me-up-design.md

import type { Message } from '../domain/chat';
import { displayName } from '../domain/profile';
import type { Member } from '../domain/types';

export function demoCatchUp(messages: Message[], members: Member[], me: Member, count: number): { summary: string; count: number } {
  const recent = messages.filter((m) => !m.removedAt).slice(-count);
  const name = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m ? displayName(m) : 'Someone';
  };
  const byAuthor = new Map<string, number>();
  for (const m of recent) if (m.authorId !== me.id) byAuthor.set(m.authorId, (byAuthor.get(m.authorId) ?? 0) + 1);
  const talkers = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => name(id));
  const mine = [me.roadName, me.fullName.split(' ')[0]].filter((n): n is string => !!n).map((n) => n.toLowerCase());
  const namesMe = recent.find((m) => m.authorId !== me.id && mine.some((n) => (m.body ?? '').toLowerCase().includes(n)));
  const latest = [...recent].reverse().find((m) => m.authorId !== me.id && m.body?.trim());
  const photos = recent.reduce((n, m) => n + m.media.filter((x) => x.kind === 'photo').length, 0);
  const lines = [
    namesMe ? `• ${name(namesMe.authorId)} mentioned you: “${namesMe.body!.trim().slice(0, 120)}”` : null,
    talkers.length ? `• Mostly ${talkers.join(' and ')} talking.` : null,
    latest ? `• Latest from ${name(latest.authorId)}: “${latest.body!.trim().slice(0, 120)}”` : null,
    photos ? `• ${photos} ${photos === 1 ? 'photo' : 'photos'} shared.` : null,
    '• In the real app, the club’s AI reads the messages and sums up decisions, plans and questions for you.',
  ].filter(Boolean);
  return { summary: lines.join('\n'), count: recent.length };
}
