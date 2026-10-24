import { useFonts } from 'expo-font';

/**
 * Rustnuts Stencil, the club typeface (a heavier, renamed Stardos Stencil; licence in
 * assets/fonts/OFL.txt). Bundled with the app, so phones and the web preview load the same file.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({ RustnutsStencil: require('../assets/fonts/RustnutsStencil-Regular.ttf') });
  // If the font ever fails to load, show the app in the fallback face rather than a blank screen.
  return loaded || error != null;
}
