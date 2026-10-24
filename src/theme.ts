// The Rustnuts look, taken from the club website (rustnutssmc.com.au/styles.css):
// ink background, bone text, the club red, Saira Stencil One for headings.

import { Platform } from 'react-native';

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
} as const;

export const fonts = {
  stencil: Platform.select({
    web: '"Saira Stencil One", "Arial Black", "Helvetica Neue", sans-serif',
    default: 'SairaStencilOne_400Regular',
  }),
  body: Platform.select({
    web: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    default: undefined,
  }),
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 4, md: 8, pill: 999 } as const;

export const type = {
  display: { fontFamily: fonts.stencil, fontSize: 34, letterSpacing: 1.5, color: colors.bone },
  h1: { fontFamily: fonts.stencil, fontSize: 26, letterSpacing: 1, color: colors.bone },
  h2: { fontFamily: fonts.stencil, fontSize: 19, letterSpacing: 1, color: colors.bone },
  label: {
    fontFamily: fonts.body,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    color: colors.boneMute,
  },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.boneDim },
  bodyStrong: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, fontWeight: '600' as const, color: colors.bone },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.boneMute },
} as const;

/** Content never stretches wider than a phone held sideways, even on a desktop browser. */
export const MAX_CONTENT_WIDTH = 640;
