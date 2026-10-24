// Builds the web version of the app into ONE self-contained HTML file for a phone preview
// (a private Claude artifact page). Everything the page needs is inlined: the app code,
// the logo, the icon font and the header arrows. Only the stencil font comes from Google Fonts.
//
//   npm run build:preview   →   preview/rustnuts-preview.html

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'preview');

// The preview page always runs on the made-up demo members, even when .env points at the live database.
execSync('npx expo export --platform web --output-dir dist --clear', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_FORCE_DEMO: '1', EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' },
});

const jsDir = join(dist, '_expo/static/js/web');
const bundleFile = readdirSync(jsDir).find((f) => f.endsWith('.js'));
if (!bundleFile) throw new Error('No web bundle found');
let bundle = readFileSync(join(jsDir, bundleFile), 'utf8');

// Assets the app actually shows. Everything else in the bundle (other icon sets,
// the native-only font file) is never requested on the web.
const KEEP = [/\/assets\/assets\/(logo|flannel|member-disc|skull)\./, /\/Fonts\/Ionicons\./, /@react-navigation\/elements\/lib\/module\/assets\//];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf' };

let inlined = 0;
bundle = bundle.replace(/"(\/assets\/[^"]+)"/g, (match, assetPath) => {
  if (!KEEP.some((re) => re.test(assetPath))) return match;
  const file = join(dist, assetPath);
  if (!existsSync(file)) throw new Error(`Missing asset ${assetPath}`);
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`No MIME type for ${assetPath}`);
  inlined += 1;
  return `"data:${mime};base64,${readFileSync(file).toString('base64')}"`;
});
if (inlined < 3) throw new Error(`Expected to inline the logo, icon font and arrows; only found ${inlined}`);

// Never let the app code close the script tag early.
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');

const page = `<title>Rustnuts App</title>
<meta name="description" content="Preview of the Rustnuts SMC members' app, Stage 1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Saira+Stencil+One&display=swap">
<style>
  /* One-screen app: the app scrolls inside itself, the page never does. */
  :root { --ink: #111010; --bone: #F4F1EA; color-scheme: dark; box-sizing: border-box; background: var(--ink); }
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; background: var(--ink); color: var(--bone); }
  #root { display: flex; height: 100%; flex: 1; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
<div id="root"></div>
<script>window.__RUSTNUTS_PREVIEW__ = true;</script>
<script>${safeBundle}</script>
`;

mkdirSync(out, { recursive: true });
const target = join(out, 'rustnuts-preview.html');
writeFileSync(target, page);
console.log(`Preview written: ${target} (${(page.length / 1024 / 1024).toFixed(2)} MB, ${inlined} assets inlined)`);
