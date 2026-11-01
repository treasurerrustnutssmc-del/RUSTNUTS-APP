// Picking an Otter transcript in the web build: a hidden file input, read as text. Backing out of
// the browser's chooser may never be reported, so the screen doesn't wait on this to free anything.

import { TRANSCRIPT_MAX } from '../domain/otterMinutes';

export const TRANSCRIPT_UNREADABLE = 'That file couldn’t be read. Export it from Otter as Text (.txt).';
const TOO_BIG = 'That file is too big for one meeting. Export it from Otter as Text (.txt).';
const MAX_FILE_BYTES = TRANSCRIPT_MAX * 4;
const PICKER_ATTR = 'data-rustnuts-transcript-picker';

export function pickTranscript(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    document.querySelectorAll(`input[${PICKER_ATTR}]`).forEach((old) => old.remove());
    const input = document.createElement('input');
    input.setAttribute(PICKER_ATTR, '');
    input.type = 'file';
    input.accept = '.txt,.srt,text/plain';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      if (file.size > MAX_FILE_BYTES) return reject(new Error(TOO_BIG));
      file.text().then((text) => resolve({ name: file.name, text }), () => reject(new Error(TRANSCRIPT_UNREADABLE)));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
