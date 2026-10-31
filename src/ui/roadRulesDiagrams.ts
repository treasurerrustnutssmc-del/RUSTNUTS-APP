// The illustrated Road Rules' diagram images, bundled with the app. They're Chris's diagrams at
// their full 1600-pixel width, reduced to 128 colours so all 17 come to about 2.6 MB.

import type { DiagramId } from '../domain/roadRulesGuide';

/** Each source is a bundled asset: require() gives its module number. */
export const DIAGRAM_IMAGES: Record<DiagramId, { source: number; width: number; height: number }> = {
  roles: { source: require('../../assets/road-rules/roles.png'), width: 1600, height: 2280 },
  formation: { source: require('../../assets/road-rules/formation.png'), width: 1600, height: 2280 },
  'single-file': { source: require('../../assets/road-rules/single-file.png'), width: 1600, height: 2200 },
  'axle-to-axle': { source: require('../../assets/road-rules/axle-to-axle.png'), width: 1600, height: 2200 },
  readiness: { source: require('../../assets/road-rules/readiness.png'), width: 1600, height: 1560 },
  'signals-1': { source: require('../../assets/road-rules/signals-1.png'), width: 1600, height: 1960 },
  'signals-2': { source: require('../../assets/road-rules/signals-2.png'), width: 1600, height: 1960 },
  'signals-3': { source: require('../../assets/road-rules/signals-3.png'), width: 1600, height: 2220 },
  'pass-signal': { source: require('../../assets/road-rules/pass-signal.png'), width: 1600, height: 1580 },
  'arm-up': { source: require('../../assets/road-rules/arm-up.png'), width: 1600, height: 2260 },
  abort: { source: require('../../assets/road-rules/abort.png'), width: 1600, height: 2260 },
  turning: { source: require('../../assets/road-rules/turning.png'), width: 1600, height: 2000 },
  'keep-left': { source: require('../../assets/road-rules/keep-left.png'), width: 1600, height: 2100 },
  snake: { source: require('../../assets/road-rules/snake.png'), width: 1600, height: 1820 },
  protected: { source: require('../../assets/road-rules/protected.png'), width: 1600, height: 2060 },
  'support-vehicles': { source: require('../../assets/road-rules/support-vehicles.png'), width: 1600, height: 1800 },
  'tail-gunner': { source: require('../../assets/road-rules/tail-gunner.png'), width: 1600, height: 1900 },
};
