// "Ask to join" used to be ten fields on one 1,500px page, with every error shown only after the
// whole form was sent. It is now three short steps, and a field's problem shows once the person
// has left it. The checks themselves stay in the screen (they match the database's own).

export const JOIN_FIELDS = ['fullName', 'email', 'phone', 'adult', 'chapter', 'bikeParts', 'year'] as const;
export type JoinField = (typeof JOIN_FIELDS)[number];

export const JOIN_STEPS: { title: string; fields: JoinField[] }[] = [
  { title: 'About you', fields: ['fullName', 'email', 'phone', 'adult'] },
  { title: 'How you’re joining', fields: ['chapter'] },
  { title: 'Your bike', fields: ['bikeParts', 'year'] },
];

/** The fields on this step that still have a problem. Empty means the person can move on. */
export function stepProblems(errors: Record<JoinField, string | null>, step: number): JoinField[] {
  return JOIN_STEPS[step].fields.filter((f) => errors[f] !== null);
}

/** A problem is shown only once the person has left the field (or tried to go on). */
export function shownError(error: string | null, touched: boolean): string | null {
  return touched ? error : null;
}
