// Whether a collapsible group (Board, Me) is open. A group that needs the person opens by itself,
// and then stays open: it must not fold away the moment they fix the thing that opened it (add the
// emergency contact, sign the Road Rules, approve the last applicant). What the person chose wins.
//
// `chosen` is kept in state. This returns it unchanged when nothing new needs opening, so the
// screen can set it only when it really changed.

export function settleOpen<Id extends string>(
  chosen: Partial<Record<Id, boolean>>,
  groups: { id: Id; startsOpen: boolean }[],
): Partial<Record<Id, boolean>> {
  const opening = groups.filter((g) => g.startsOpen && chosen[g.id] === undefined);
  if (opening.length === 0) return chosen;
  const next = { ...chosen };
  for (const g of opening) next[g.id] = true;
  return next;
}
