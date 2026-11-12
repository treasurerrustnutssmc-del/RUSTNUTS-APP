// Home used to end with a "Your profile 5 of 5 done" card and a counts table, both taking room on
// every visit. The profile card now shows only while something is left, and the numbers fold away.

/** Show the profile checklist only while it has something left to do. */
export function showProfileCard(done: number, total: number): boolean {
  return total > 0 && done < total;
}

export const CLUB_NUMBERS = {
  title: 'The club in numbers',
  summary: 'Members by chapter, and how many have joined the app',
} as const;
