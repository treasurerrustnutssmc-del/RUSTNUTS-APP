// Picking the treasurer's own PDF on the phone, for a Treasurer's Report for a meeting. The web
// build has its own version beside this one (reportPdfFile.web.ts). The rules (a PDF, 10 MB or
// less) are checked by attachPdfProblem before anything goes up.

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { PickedPdf } from '../domain/meetingReport';

export type PickedPdfFile = PickedPdf & { uri: string };

/** Lets the treasurer pick one PDF. Null when they back out. */
export async function pickReportPdf(): Promise<PickedPdfFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const a = result.assets[0];
  return { uri: a.uri, name: a.name ?? '', size: typeof a.size === 'number' ? a.size : null, mimeType: a.mimeType ?? null };
}

/** The picked file's bytes, to upload. */
export function reportPdfBytes(file: PickedPdfFile): Promise<ArrayBuffer> {
  return new File(file.uri).arrayBuffer();
}
