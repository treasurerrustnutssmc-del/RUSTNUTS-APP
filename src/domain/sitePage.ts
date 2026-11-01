/**
 * The app's public pages on the club website (www.rustnutssmc.com.au/app/…): privacy policy, the
 * club rules for chats and posts, support, the member welcome guide and account deletion.
 *
 * The words live here in the app repo, in site/ (two generated from code, three hand-written) and
 * published by GitHub Pages at the old addresses. `npm run build:site` takes each page apart with
 * `extractPage` and dresses it in the website's shell with `renderSitePage`, writing the result into
 * the website repo's app/ folder (../rustnutssmc by default). The old copies keep their words and
 * say where the page now lives (`movedTo` in policyPage.ts), so the store links keep working even
 * when the website is down.
 *
 * Launch rule: none of these pages is linked from the site's nav or sitemap, and none may name the
 * app stores, until Apple approves the iPhone app (`mentionsStores` keeps that honest).
 */

export const SITE_ORIGIN = 'https://www.rustnutssmc.com.au';
export const APP_PAGES = ['privacy', 'posting-rules', 'support', 'guide', 'delete-account'] as const;
export type AppPageSlug = (typeof APP_PAGES)[number];
/** Pages that name the stores (the welcome guide's "Get the app"), so they stay off the website until launch. */
export const HELD_UNTIL_LAUNCH: readonly AppPageSlug[] = ['guide'];
/** The pages the website carries now. */
export const SITE_PAGES: readonly AppPageSlug[] = APP_PAGES.filter((p) => !HELD_UNTIL_LAUNCH.includes(p));

/** Every page the build writes into the website's app/ folder: the app pages and the illustrated Road Rules. */
export type SitePageSlug = AppPageSlug | 'road-rules';

/** The club-domain address of one page. */
export const sitePageUrl = (slug: SitePageSlug): string => `${SITE_ORIGIN}/app/${slug}.html`;
const isAppPage = (slug: SitePageSlug): slug is AppPageSlug => (APP_PAGES as readonly string[]).includes(slug);

/** The links in the footer of every app page. */
const FOOTER_LINKS: { slug: AppPageSlug; label: string }[] = [
  { slug: 'privacy', label: 'Privacy policy' },
  { slug: 'posting-rules', label: 'Chat and posting rules' },
  { slug: 'support', label: 'App support' },
  { slug: 'guide', label: 'Welcome guide' },
  { slug: 'delete-account', label: 'Delete your account' },
];

export interface PageParts {
  title: string;
  description: string;
  heading: string;
  /** "Last updated 01/11/2026", when the page has one. */
  updated: string | null;
  /** The inside of <main>, without its logo header and footer. */
  body: string;
}

/** Keep the `<main>`, `<header>`, `<h1>`, `<footer>` and description tags bare (no attributes): that is what this reads. */
const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (html: string): string => html.replace(/<[^>]+>/g, '').trim();

/** Takes a GitHub Pages copy (site/<slug>.html) apart into the pieces the site shell needs. */
export function extractPage(html: string): PageParts {
  const title = unescape(strip(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? ''));
  const description = unescape(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');
  let body = /<main>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
  const header = /<header>[\s\S]*?<\/header>/.exec(body)?.[0] ?? '';
  const headingSource = header || body;
  const heading = unescape(strip(/<h1>([\s\S]*?)<\/h1>/.exec(headingSource)?.[1] ?? ''));
  const updated = /<p class="updated">([\s\S]*?)<\/p>/.exec(headingSource)?.[1]?.trim() ?? null;
  body = body.replace(header, '').replace(/<footer>[\s\S]*?<\/footer>/, '').replace(/\s*<p class="moved">[\s\S]*?<\/p>/, '');
  if (!header) body = body.replace(/<h1>[\s\S]*?<\/h1>/, '');
  return { title, description, heading, updated: updated ? unescape(updated) : null, body: body.replace(/^\s*\n/, '').replace(/\s+$/, '\n') };
}

/** True when the page names an app store, by link or by name: not allowed on the club site before launch. */
export function mentionsStores(html: string): boolean {
  return /apps\.apple\.com|play\.google\.com|itunes\.apple\.com|app store|google play|play store|testflight|in the stores/i.test(html);
}

/** The diagrams' frames on the Road Rules page. */
const ROAD_RULES_CSS = `  .rr-figure{margin:28px 0}
  .rr-figure img{display:block;width:100%;height:auto;border-radius:6px;background:#fff}
  .rr-figure figcaption{font-family:var(--stencil);color:var(--bone);letter-spacing:0.04em;margin-top:10px}
`;

/** The page in the club website's clothes: its header, nav, fonts and footer, served at /app/<slug>.html. */
export function renderSitePage(slug: SitePageSlug, page: PageParts): string {
  const url = sitePageUrl(slug);
  const appPage = isAppPage(slug);
  const footer = FOOTER_LINKS.filter((l) => !HELD_UNTIL_LAUNCH.includes(l.slug)).map((l) => (l.slug === slug ? `<span>${esc(l.label)}</span>` : `<a href="${l.slug}.html">${esc(l.label)}</a>`)).join(' · ');
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- Generated from the Rustnuts app repo (${appPage ? `site/${slug}.html` : 'src/domain/roadRulesPage.ts'}) by \`npm run build:site\`. Change the words there, not here. -->
<title>${esc(page.title)} | Rustnuts SMC</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#8C1C24" />
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Rustnuts SMC" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:image" content="${SITE_ORIGIN}/rustnuts-smc-logo.jpg" />
<meta property="og:url" content="${url}" />
<meta property="og:locale" content="en_AU" />
<link rel="preload" href="../fonts/RustnutsStencil-Regular.ttf" as="font" type="font/ttf" crossorigin />
<link rel="stylesheet" href="../styles.css" />
<style>
  /* the app's pages, in the site's clothes */
  body{background:var(--ink);overflow-x:hidden}
  .app-hero{
    padding:130px 28px 36px;text-align:center;position:relative;z-index:2;
    background:radial-gradient(circle at 70% 30%, rgba(140,28,36,0.35), transparent 55%), var(--ink);
  }
  .app-hero h1{font-size:clamp(2rem,6vw,3.4rem);margin-bottom:10px}
  .app-hero .updated{font-family:var(--stencil);color:var(--bone-mute);letter-spacing:0.08em;text-transform:uppercase;font-size:0.85rem}
  .app-page{position:relative;z-index:2;padding:10px 28px 80px}
  .app-page .wrap{max-width:760px;margin:0 auto;color:var(--bone-dim);font-size:1.02rem}
  .app-page h2{font-family:var(--stencil);font-weight:400;text-transform:uppercase;letter-spacing:0.03em;color:var(--bone);font-size:1.4rem;margin:36px 0 10px}
  .app-page section{margin:0 0 8px}
  .app-page p{margin:10px 0}
  .app-page .intro{font-size:1.12rem;color:var(--bone)}
  .app-page ul,.app-page ol{padding-left:22px;margin:8px 0}
  .app-page li{margin:6px 0}
  .app-page li::marker{color:var(--red-bright)}
  .app-page strong{color:var(--bone);font-weight:600}
  .app-page a{color:var(--red-text)}
  .app-page .small{color:var(--bone-mute);font-size:0.9rem}
  .app-page table{width:100%;border-collapse:collapse;margin:12px 0}
  .app-page th,.app-page td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,0.12)}
  .app-page th{font-family:var(--stencil);font-weight:400;letter-spacing:0.04em;color:var(--bone)}
  .app-page tbody th{white-space:nowrap}
  .app-pages{max-width:760px;margin:40px auto 0;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);color:var(--bone-mute);font-size:0.9rem;text-align:center}
  .app-pages a{color:var(--bone-dim);text-decoration:none;border-bottom:1px solid transparent}
  .app-pages a:hover{color:var(--red-text);border-bottom-color:var(--red-text)}
${appPage ? '' : ROAD_RULES_CSS}</style>
</head>
<body>

<header>
  <a href="../index.html" class="brand">
    <img src="../rustnuts-smc-logo.jpg" alt="Rustnuts SMC logo" />
  </a>
  <nav class="nav-links">
    <a href="../index.html">Home</a>
    <a href="../charity.html">Charity Rides</a>
    <a href="../resources.html">Support</a>
    <a href="../shop.html" class="nav-shop">Shop</a>
    <a href="../index.html#join">Join</a>
  </nav>
  <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-label="Menu" aria-controls="nav-mobile">
    <span></span><span></span><span></span>
  </button>
</header>
<nav class="nav-mobile" id="nav-mobile" aria-label="Mobile navigation">
  <a href="../index.html">Home</a>
  <a href="../charity.html">Charity Rides</a>
  <a href="../resources.html">Support</a>
  <a href="../shop.html" class="nav-shop">Shop</a>
  <a href="../index.html#join">Join</a>
</nav>

<section class="app-hero">
  <p class="eyebrow" style="color:var(--red-text);font-weight:800;letter-spacing:0.25em;text-transform:uppercase;font-size:0.75rem;margin-bottom:12px">${appPage ? 'The members’ app' : 'The rulebook'}</p>
  <h1 class="display">${esc(page.heading)}</h1>
${page.updated ? `  <p class="updated">${esc(page.updated)}</p>\n` : ''}</section>

<section class="app-page">
  <div class="wrap">
${page.body}  </div>
${appPage ? `  <p class="app-pages">${footer}</p>\n` : ''}</section>

<footer>
  <p class="motto">Rust Till Dust</p>
  <p><strong>Rustnuts SMC</strong> — Rustnuts Social Motorcycle Club Incorporated</p>
  <p>Greater Melbourne, Victoria, Australia &nbsp;|&nbsp; <a href="../index.html">Back to home</a></p>
  <p style="margin-top:10px">&copy; <span id="yr"></span> Rustnuts SMC. All rights reserved.</p>
</footer>

<script>
  document.getElementById('yr').textContent=new Date().getFullYear();
  (function(){
    const toggle = document.getElementById('nav-toggle');
    const panel = document.getElementById('nav-mobile');
    if(!toggle || !panel) return;
    function closeMenu(){ toggle.setAttribute('aria-expanded','false'); panel.classList.remove('open'); }
    function openMenu(){ toggle.setAttribute('aria-expanded','true'); panel.classList.add('open'); }
    toggle.addEventListener('click', ()=>{
      if(toggle.getAttribute('aria-expanded')==='true'){ closeMenu(); } else { openMenu(); }
    });
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape' && toggle.getAttribute('aria-expanded')==='true'){ closeMenu(); toggle.focus(); }
    });
    panel.querySelectorAll('a').forEach(a=>a.addEventListener('click', closeMenu));
  })();
</script>
</body>
</html>
`;
}
