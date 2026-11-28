// Chat tags (Jeff, 28 Nov 2026: "a tagging system that rings the phone of the person tagged. Like
// @everyone, or @tinman"). See docs/superpowers/specs/2026-11-28-chat-tags-design.md.
//
// A tag is @ (at the start, or after anything but a letter, digit or _) then a member's name as the app
// shows it, any case, not run into another letter, digit or _. @everyone tags everyone in the chat.
// The database tells the people tagged by the same rule (private.tags_name in
// supabase/migrations/20271020000000_chat_tags.sql); the app only helps type them and shows them.

export const EVERYONE = 'everyone';

const WORD = /[\p{L}\p{N}_]/u;

/** What's typed after an @ just before the cursor (the end of the message unless given; '' just after
 *  the @), or null when no tag is being typed there. */
export function tagQuery(draft: string, cursor = draft.length): string | null {
  const m = /(^|[^\p{L}\p{N}_])@([^\s@]*)$/u.exec(draft.slice(0, cursor));
  return m ? m[2] : null;
}

export interface TagChoice {
  /** The member, or null for @everyone. */
  id: string | null;
  name: string;
}

/** The pick list for what's typed: @everyone first, then names starting with it, then names with a
 *  later word starting with it, each A to Z. */
export function tagSuggestions(query: string, people: { id: string; name: string }[], limit = 6): TagChoice[] {
  const q = query.toLowerCase();
  const byName = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const starts = byName.filter((p) => p.name.toLowerCase().startsWith(q));
  const later = byName.filter((p) => !starts.includes(p) && p.name.toLowerCase().split(/\s+/).slice(1).some((w) => w.startsWith(q)));
  const all: TagChoice[] = [...(EVERYONE.startsWith(q) ? [{ id: null, name: EVERYONE }] : []), ...starts, ...later].map((p) => ({ id: p.id, name: p.name }));
  return all.slice(0, limit);
}

/** The message with the tag being typed at the cursor swapped for the whole tag, and a space unless one
 *  follows already. */
export function insertTag(draft: string, name: string, cursor = draft.length): string {
  const q = tagQuery(draft, cursor);
  if (q === null) return draft;
  const rest = draft.slice(cursor);
  return `${draft.slice(0, cursor - q.length - 1)}@${name}${rest.startsWith(' ') ? '' : ' '}${rest}`;
}

/** Lower case, letter for letter: a letter that grows when lower-cased (İ) stays as it is, so places in
 *  this line up with places in the message. */
function lowerSameLength(text: string): string {
  return text.replace(/[\s\S]/gu, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c));
}

/** Where '@name' starts in the text as a tag at or after `from`, or -1. */
function tagAt(lower: string, name: string, from: number): number {
  const n = `@${name.toLowerCase()}`;
  for (let at = lower.indexOf(n, from); at !== -1; at = lower.indexOf(n, at + 1)) {
    const before = at === 0 ? '' : lower[at - 1];
    const after = lower.slice(at + n.length, at + n.length + 1);
    if (!WORD.test(before) && !WORD.test(after)) return at;
  }
  return -1;
}

/** Whether the message tags this name. */
export function isTagged(body: string, name: string): boolean {
  return name.trim() !== '' && tagAt(lowerSameLength(body), name, 0) !== -1;
}

/** The message in pieces for showing: plain words, and tags with the name they tag (or EVERYONE). */
export function tagParts(body: string, names: string[]): { text: string; tag?: string }[] {
  const lower = lowerSameLength(body);
  // Longest first, so "@Big Dave" is Big Dave's tag and not Dave's.
  const all = [EVERYONE, ...names.filter((n) => n.trim() !== '')].sort((a, b) => b.length - a.length);
  const out: { text: string; tag?: string }[] = [];
  let i = 0;
  while (i < body.length) {
    let best: { at: number; name: string } | null = null;
    for (const name of all) {
      const at = tagAt(lower, name, i);
      if (at !== -1 && (!best || at < best.at)) best = { at, name };
    }
    if (!best) break;
    if (best.at > i) out.push({ text: body.slice(i, best.at) });
    const end = best.at + best.name.length + 1;
    out.push({ text: body.slice(best.at, end), tag: best.name });
    i = end;
  }
  if (i < body.length) out.push({ text: body.slice(i) });
  return out;
}
