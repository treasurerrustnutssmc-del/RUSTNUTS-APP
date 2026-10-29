// The Treasurer's Report in the web build: the page goes into a hidden frame and the browser's
// print dialog opens, where Save as PDF is one of the choices. Nothing here navigates, since the
// preview runs inside a page whose URL the app doesn't control.

import { Asset } from 'expo-asset';

const LOGO = require('../../assets/logo.png');
const STENCIL = require('../../assets/fonts/RustnutsStencil-Regular.ttf');

const absolute = (uri: string) => new URL(uri, window.location.href).href;

/** The logo and the stencil font, as addresses the printed page can load. */
export async function reportAssets(): Promise<{ logoSrc: string | null; fontSrc: string | null }> {
  try {
    return { logoSrc: absolute(Asset.fromModule(LOGO).uri), fontSrc: absolute(Asset.fromModule(STENCIL).uri) };
  } catch {
    return { logoSrc: null, fontSrc: null };
  }
}

/** Opens the print dialog for the page. The file name comes from the page's title. */
export function shareReportPdf(html: string, _fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    frame.onload = async () => {
      try {
        const doc = frame.contentDocument;
        await doc?.fonts?.ready;
        await Promise.all(Array.from(doc?.images ?? []).map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; }))));
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('The browser couldn’t print the report.'));
      } finally {
        // Printing blocks until the dialog closes in most browsers; give the rest a moment.
        setTimeout(() => frame.remove(), 60_000);
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
