/**
 * The privacy policy as a public web page (site/privacy.html), in the club's look: ink background,
 * bone text, the club red, the real logo and Rustnuts Stencil headings. `npm run build:privacy`
 * writes it, with the logo and font beside it. Colours match src/theme.ts (not imported, since the
 * theme pulls in React Native).
 */
import {
  PRIVACY_EMAIL,
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
  PRIVACY_URL,
  privacyUpdatedLine,
  type PrivacySection,
} from './privacyPolicy';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escapes the text, then turns the contact address into a mail link. */
function text(s: string): string {
  return esc(s).split(PRIVACY_EMAIL).join(`<a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a>`);
}

function section(s: PrivacySection): string {
  const body = s.blocks
    .map((b) =>
      typeof b === 'string'
        ? `      <p>${text(b)}</p>`
        : `      <ul>\n${b.points.map((p) => `        <li>${text(p)}</li>`).join('\n')}\n      </ul>`,
    )
    .join('\n');
  return `    <section id="${esc(s.id)}">\n      <h2>${esc(s.heading)}</h2>\n${body}\n    </section>`;
}

export function renderPrivacyPage(sections: PrivacySection[] = PRIVACY_SECTIONS): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rustnuts app privacy policy</title>
  <meta name="description" content="How the Rustnuts Social Motorcycle Club app collects, uses and protects your information.">
  <link rel="canonical" href="${PRIVACY_URL}">
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
      <h1>App privacy policy</h1>
      <p class="updated">${esc(privacyUpdatedLine())}</p>
    </header>
    <p class="intro">${text(PRIVACY_INTRO)}</p>
${sections.map(section).join('\n')}
    <footer>Rustnuts Social Motorcycle Club Incorporated · Victoria, Australia · ${text(PRIVACY_EMAIL)}</footer>
  </main>
</body>
</html>
`;
}
