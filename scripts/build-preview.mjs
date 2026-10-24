// Builds the web version of the app into ONE self-contained HTML file for a phone preview
// (a private Claude artifact page). Everything the page needs is inlined: the app code,
// the logo, the club stencil font, the icon font and the header arrows.
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

// The export can split the app into more than one script (a shared chunk plus the entry). Take
// them in the order index.html loads them, so the page runs them the same way.
const jsDir = join(dist, '_expo/static/js/web');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+\.js)"/g)].map((m) => join(dist, m[1]));
if (scripts.length === 0) throw new Error('No web bundle found in dist/index.html');
// Chunks the app loads on demand (for example the camera's barcode reader) are fetched by URL, which
// a one-file page can't serve, so they're left out: those features don't work in the preview, which
// has no camera anyway.
const onDemand = readdirSync(jsDir).filter((f) => f.endsWith('.js') && !scripts.includes(join(jsDir, f)));
if (onDemand.length) console.log(`Leaving out ${onDemand.length} on-demand chunk(s): ${onDemand.join(', ')}`);
let bundle = scripts.map((f) => readFileSync(f, 'utf8')).join(';\n');

// Assets the app actually shows. Everything else in the bundle (other icon sets) is never
// requested on the web.
const KEEP = [/\/assets\/assets\/(logo|flannel|member-disc|skull)\./, /\/assets\/assets\/fonts\/RustnutsStencil-/, /\/Fonts\/Ionicons\./, /@react-navigation\/elements\/lib\/module\/assets\//];
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
if (inlined < 4) throw new Error(`Expected to inline the logo, stencil font, icon font and arrows; only found ${inlined}`);

// Never let the app code close the script tag early.
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');

const page = `<title>Rustnuts App</title>
<meta name="description" content="Preview of the Rustnuts SMC members' app, Stage 1">
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
