// The club's brand values with nothing React Native in them, so the website's brand block
// (src/domain/brandCss.ts, run by `npm run build:site`) and the tests can read them. theme.ts
// re-exports these; the app reads them through theme.ts as before.

export const colors = {
  ink: '#111010',
  ink2: '#171515',
  steel: '#2a2a2c',
  steelHi: '#353437',
  line: 'rgba(244,241,234,0.10)',
  lineStrong: 'rgba(244,241,234,0.22)',
  bone: '#F4F1EA',
  boneDim: '#d8d3c7',
  boneMute: '#96928a',
  red: '#8C1C24',
  redBright: '#B92632',
  redText: '#F2666F',
  // states (separate from the brand red)
  ok: '#7BC48F',
  okBg: 'rgba(123,196,143,0.12)',
  warn: '#E9A83A',
  warnBg: 'rgba(233,168,58,0.12)',
  danger: '#F2666F',
  dangerBg: 'rgba(242,102,111,0.12)',
  // The white the logo and the Road Rules diagrams sit on, as they're drawn on white.
  logoPlate: '#FFFFFF',
} as const;

/** Ride calendar colour key, matching the website's. Each label colour is at least 4.5:1 on its chip. */
export const rideColors = {
  north: { bg: '#2B64A8', fg: '#FFFFFF' },
  west: { bg: '#8C1C24', fg: '#F4F1EA' },
  club: { bg: '#F4F1EA', fg: '#111010' },
  supported: { bg: '#2A7048', fg: '#FFFFFF' },
  non_nuts: { bg: '#55555A', fg: '#FFFFFF' },
} as const;

/** The font stacks as the web (and the website) names them; native uses the family name alone. */
export const webFonts = {
  stencil: '"RustnutsStencil", "Arial Black", "Helvetica Neue", sans-serif',
  body: '"Helvetica Neue", Arial, sans-serif',
} as const;
