// "Leave without saving?": whether a form has anything typed that would be lost. Empty, missing
// and blank count as the same, and trailing spaces are ignored, so opening a form and backing out
// never nags.

type Value = string | number | boolean | null | undefined;

const norm = (v: Value): Value => (typeof v === 'string' ? v.trim() : v ?? '');

export function hasChanges(initial: Record<string, Value>, current: Record<string, Value>): boolean {
  return Object.keys({ ...initial, ...current }).some((k) => norm(initial[k]) !== norm(current[k]));
}
