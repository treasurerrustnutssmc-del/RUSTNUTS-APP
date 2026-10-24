import { useFonts, SairaStencilOne_400Regular } from '@expo-google-fonts/saira-stencil-one';
import { Platform } from 'react-native';

const GOOGLE_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Saira+Stencil+One&display=swap';

function ensureWebFontLink() {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[href="${GOOGLE_FONTS_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
}

/**
 * Phones load the stencil face from the app bundle. The web build pulls the same face
 * from Google Fonts, so the preview page doesn't need to ship font files.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(Platform.OS === 'web' ? {} : { SairaStencilOne_400Regular });
  if (Platform.OS === 'web') {
    ensureWebFontLink();
    return true;
  }
  return loaded;
}
