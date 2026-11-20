// Picking the treasurer's own PDF in the web build: a hidden file input. Backing out of the
// browser's chooser may never be reported, so the screen doesn't wait on this to free anything.

import type { PickedPdf } from '../domain/meetingReport';

export type PickedPdfFile = PickedPdf & { uri: string };

const PICKER_ATTR = 'data-rustnuts-report-pdf-picker';

export function pickReportPdf(): Promise<PickedPdfFile | null> {
  return new Promise((resolve) => {
    document.querySelectorAll(`input[${PICKER_ATTR}]`).forEach((old) => old.remove());
    const input = document.createElement('input');
    input.setAttribute(PICKER_ATTR, '');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ uri: URL.createObjectURL(file), name: file.name, size: file.size, mimeType: file.type || null });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** The picked file's bytes, to upload. The live build lets go of the picked file once it's read. */
export async function reportPdfBytes(file: PickedPdfFile): Promise<ArrayBuffer> {
  try {
    return await (await fetch(file.uri)).arrayBuffer();
  } finally {
    URL.revokeObjectURL(file.uri);
  }
}
