// The Rustnuts look, taken from the club website (rustnutssmc.com.au/styles.css):
// ink background, bone text, the club red, Rustnuts Stencil for headings.

import { Platform } from 'react-native';
import { colors, webFonts } from './brand';

export { colors, rideColors } from './brand';

export const fonts = {
  stencil: Platform.select({ web: webFonts.stencil, default: 'RustnutsStencil' }),
  body: Platform.select({ web: webFonts.body, default: undefined }),
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 4, md: 8, pill: 999 } as const;

export const type = {
  display: { fontFamily: fonts.stencil, fontSize: 34, letterSpacing: 1.5, color: colors.bone },
  h1: { fontFamily: fonts.stencil, fontSize: 26, letterSpacing: 1, color: colors.bone },
  h2: { fontFamily: fonts.stencil, fontSize: 19, letterSpacing: 1, color: colors.bone },
  /** Names, dates and numbers on cards: the stencil at reading size. */
  name: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, color: colors.bone },
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
