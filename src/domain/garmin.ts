// A Garmin-ready copy of a route's GPX file, for the Tread, Explore and Drive apps and for zūmo
// units over USB or BaseCamp. The uploaded file can carry other apps' extensions, route points a
// Garmin re-routes between, and more points than a unit keeps, so this writes a fresh plain
// GPX 1.1 file: the stops as waypoints and one track, followed as drawn.

import { readGpxPoints, simplifyIndices } from './gpx';

/** The most track points a zūmo or Edge keeps in one track. */
export const GARMIN_MAX_POINTS = 10_000;
/** File names are cut to this many characters before `.gpx`. */
const FILE_NAME_MAX = 40;

/** The text with XML's special characters escaped and characters XML refuses left out. */
function xmlText(text: string): string {
  return text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const at = (lat: number, lng: number) => `lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"`;

/**
 * Writes the route as a plain GPX 1.1 file named `name`, or returns readGpx's message when the
 * stored file can't be read.
 */
export function garminGpx(text: string, name: string): { gpx: string } | string {
  const read = readGpxPoints(text);
  if (typeof read === 'string') return read;

  const pairs = read.track.map((p): [number, number] => [p.lat, p.lng]);
  const kept = simplifyIndices(pairs, GARMIN_MAX_POINTS).map((k) => read.track[k]);

  const title = `<name>${xmlText(name)}</name>`;
  const wpts = read.stops.map((s) => `<wpt ${at(s.lat, s.lng)}><name>${xmlText(s.name)}</name></wpt>`);
  const trkpts = kept.map((p) => (p.ele === null ? `<trkpt ${at(p.lat, p.lng)}/>` : `<trkpt ${at(p.lat, p.lng)}><ele>${p.ele.toFixed(1)}</ele></trkpt>`));
  const gpx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Rustnuts SMC" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata>${title}</metadata>`,
    ...wpts,
    `<trk>${title}<trkseg>`,
    ...trkpts,
    '</trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
  return { gpx };
}

/**
 * The Garmin copy's file name: ASCII letters, digits, spaces, hyphens and underscores only, with
 * accents folded, because older units and BaseCamp mangle other characters.
 */
export function garminFileName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    // Separators become spaces, so "Omeo/Dargo" doesn't run together; other characters go.
    .replace(/[/\\:.,;|+&]/g, ' ')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FILE_NAME_MAX)
    .trim();
  return `${ascii || 'Rustnuts route'}.gpx`;
}
