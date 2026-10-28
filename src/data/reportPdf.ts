// The Treasurer's Report as a PDF on the phone: expo-print turns the page into a PDF in the cache,
// it's renamed to something a person can recognise, and the share sheet opens. The web build has
// its own version beside this one (reportPdf.web.ts). The logo and the stencil font go into the
// page as data, since the print view can't reach the app's bundled files.

import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const LOGO = require('../../assets/logo.png');
const STENCIL = require('../../assets/fonts/RustnutsStencil-Regular.ttf');

async function dataUri(module: number, mime: string): Promise<string | null> {
  try {
    const asset = await Asset.fromModule(module).downloadAsync();
    if (!asset.localUri) return null;
    return `data:${mime};base64,${await new File(asset.localUri).base64()}`;
  } catch {
    return null; // the report still prints, without the logo or the stencil
  }
}

/** The logo and the stencil font, ready to go in the printed page. */
export async function reportAssets(): Promise<{ logoSrc: string | null; fontSrc: string | null }> {
  const [logoSrc, fontSrc] = await Promise.all([dataUri(LOGO, 'image/png'), dataUri(STENCIL, 'font/ttf')]);
  return { logoSrc, fontSrc };
}

/** Makes the PDF (A4) and opens the share sheet. `fileName` ends in .pdf. */
export async function shareReportPdf(html: string, fileName: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone can’t share files with other apps.');
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const named = new File(Paths.cache, fileName);
  if (named.exists) named.delete();
  await new File(uri).move(named);
  await Sharing.shareAsync(named.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share the Treasurer’s Report' });
}
