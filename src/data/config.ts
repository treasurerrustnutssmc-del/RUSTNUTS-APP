// Which data source the app uses. Values come from .env at build time.
//   EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY  → live club database
//   EXPO_PUBLIC_FORCE_DEMO=1                                         → demo members, even if the above are set

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const FORCE_DEMO = process.env.EXPO_PUBLIC_FORCE_DEMO === '1';

export const USE_LIVE_DATA = !FORCE_DEMO && SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
