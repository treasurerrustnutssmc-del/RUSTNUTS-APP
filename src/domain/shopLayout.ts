// A shop design row used to name every garment in one line (up to 21 of them). It names the first
// three and says how many more, and the design page lists them all.
const SHOWN = 3;

/** "Hoodie, Tee and Cap", or "Classic Tee, Low Down Singlet, Made Hood and 9 more". */
export function garmentsLine(names: string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length <= SHOWN) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, SHOWN).join(', ')} and ${names.length - SHOWN} more`;
}
