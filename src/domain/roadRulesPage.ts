/**
 * The Road Rules' public face on the club website (www.rustnutssmc.com.au/app/road-rules.html):
 * Chris's diagrams on their own, in the diagrams-only document's order, with their captions. The
 * written rules members sign stay in the app (roadRulesGuide.ts writtenRulesText, published by the
 * NEC into the members-only Road Rules versions). `npm run build:site` writes the page and copies
 * the diagrams beside it.
 */

import { DIAGRAMS } from './roadRulesGuide';
import type { PageParts } from './sitePage';

/** Where the diagrams sit, beside the page in the website's app/ folder. */
export const ROAD_RULES_IMAGE_DIR = 'road-rules';

/** The diagrams' sizes, matching assets/road-rules (all 1600 wide). */
const HEIGHTS: Record<string, number> = {
  roles: 2280, formation: 2280, 'single-file': 2200, 'axle-to-axle': 2200, readiness: 1560,
  'signals-1': 1960, 'signals-2': 1960, 'signals-3': 2220, 'pass-signal': 1580, 'arm-up': 2260,
  abort: 2260, turning: 2000, 'keep-left': 2100, snake: 1820, protected: 2060,
  'support-vehicles': 1800, 'tail-gunner': 1900,
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderRoadRulesPage(): PageParts {
  const figures = DIAGRAMS.map((d) => {
    const src = `${ROAD_RULES_IMAGE_DIR}/${d.id}.png`;
    const label = esc(`Rule ${d.rule} · ${d.caption}`);
    return `    <figure class="rr-figure" id="${d.id}">
      <a href="${src}"><img src="${src}" width="1600" height="${HEIGHTS[d.id] ?? 2000}" loading="lazy" alt="${esc(d.caption)}" /></a>
      <figcaption>${label}</figcaption>
    </figure>
`;
  }).join('');
  return {
    title: 'Road Rules',
    description: 'How Rustnuts SMC rides together and stays safe: the club’s group riding procedures, illustrated.',
    heading: 'Road Rules',
    updated: 'Group riding procedures, illustrated',
    body: `    <p class="intro">How we ride together and stay safe. These diagrams show the club’s group riding procedures: who does what in the pack, formation, hand signals, passing, turns, lane changes and stops.</p>
    <p>Members read the full written Road Rules and sign them each year. Road law applies at all times, and nothing here gives anyone right of way. Tap a diagram to see it full size.</p>
${figures}`,
  };
}
