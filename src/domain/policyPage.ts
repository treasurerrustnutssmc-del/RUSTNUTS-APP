/**
 * A club policy as a public web page (the privacy policy, the club rules for chats and posts), in
 * the club's look: ink background, bone text, the club red, the real logo and Rustnuts Stencil
 * headings. `npm run build:privacy` writes both pages into site/, with the logo and font beside
 * them. Colours match src/theme.ts (not imported, since the theme pulls in React Native).
 */

/** A paragraph, or a list of points. The privacy policy and the posting rules share this shape. */
export type PolicyBlock = string | { points: string[] };

export interface PolicySection {
  id: string;
  heading: string;
  blocks: PolicyBlock[];
}

export interface PolicyPage {
  /** The browser title. */
  title: string;
  /** The heading under the logo. */
  heading: string;
  /** The description search engines show. */
  description: string;
  /** Where the page lives (its canonical link). */
  url: string;
  /** "Last updated 31/10/2026". */
  updatedLine: string;
  intro: string;
  sections: PolicySection[];
  /** The contact address, turned into a mail link wherever it appears. */
  email: string;
  /** The club-domain address this copy has moved to: the page says so under its heading. */
  movedTo?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapes the text, then turns the contact address into a mail link. */
function text(s: string, email: string): string {
  return esc(s).split(email).join(`<a href="mailto:${email}">${email}</a>`);
}

function section(s: PolicySection, email: string): string {
  const body = s.blocks
    .map((b) =>
      typeof b === 'string'
        ? `      <p>${text(b, email)}</p>`
        : `      <ul>\n${b.points.map((p) => `        <li>${text(p, email)}</li>`).join('\n')}\n      </ul>`,
    )
    .join('\n');
  return `    <section id="${esc(s.id)}">\n      <h2>${esc(s.heading)}</h2>\n${body}\n    </section>`;
}

/** "This page now lives at www.rustnutssmc.com.au/app/….": shown on the old GitHub Pages copies. */
export function movedNote(url: string | undefined): string {
  if (!url) return '';
  return `      <p class="moved">This page now lives at <a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a>.</p>\n`;
}

export function renderPolicyPage(page: PolicyPage): string {
  const { email } = page;
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.description)}">
  <link rel="canonical" href="${page.url}">
  <style>
    @font-face { font-family: "RustnutsStencil"; src: url("RustnutsStencil-Regular.ttf") format("truetype"); font-display: swap; }
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #111010; color: #d8d3c7; font: 16px/1.6 "Helvetica Neue", Helvetica, Arial, sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
    header { text-align: center; padding-bottom: 24px; border-bottom: 1px solid rgba(244,241,234,0.22); }
    header img { width: min(260px, 70vw); height: auto; }
    h1, h2 { font-family: "RustnutsStencil", "Arial Black", sans-serif; font-weight: normal; color: #F4F1EA; letter-spacing: 1px; }
    h1 { font-size: 30px; margin: 16px 0 4px; }
    h2 { font-size: 21px; margin: 36px 0 8px; }
    .updated { font-family: "RustnutsStencil", "Arial Black", sans-serif; color: #96928a; letter-spacing: 0.5px; margin: 0; }
    .moved { font-size: 14px; color: #96928a; margin: 12px 0 0; }
    .intro { font-size: 17px; color: #F4F1EA; }
    ul { padding-left: 20px; }
    li { margin: 6px 0; }
    li::marker { color: #B92632; }
    a { color: #F2666F; }
    footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid rgba(244,241,234,0.22); font-size: 14px; color: #96928a; }
  </style>
</head>
<body>
  <main>
    <header>
      <img src="logo.png" alt="Rustnuts Social Motorcycle Club, est. 2019">
      <h1>${esc(page.heading)}</h1>
      <p class="updated">${esc(page.updatedLine)}</p>
${movedNote(page.movedTo)}    </header>
    <p class="intro">${text(page.intro, email)}</p>
${page.sections.map((s) => section(s, email)).join('\n')}
    <footer>Rustnuts Social Motorcycle Club Incorporated · Victoria, Australia · ${text(email, email)}</footer>
  </main>
</body>
</html>
`;
}
