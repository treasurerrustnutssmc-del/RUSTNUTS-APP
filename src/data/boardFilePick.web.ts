// Picking a file or a photo for Board files in the web build: a hidden file input. Backing out of
// the browser's chooser may never be reported, so the screen doesn't wait on this to free anything.

import { BOARD_FILE_KINDS, type PickedBoardFile } from '../domain/boardFiles';

export type PickedBoardUpload = PickedBoardFile & { uri: string };

const PICKER_ATTR = 'data-rustnuts-board-file-picker';

function pick(accept: string): Promise<PickedBoardUpload | null> {
  return new Promise((resolve) => {
    document.querySelectorAll(`input[${PICKER_ATTR}]`).forEach((old) => old.remove());
    const input = document.createElement('input');
    input.setAttribute(PICKER_ATTR, '');
    input.type = 'file';
    input.accept = accept;
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

export const pickBoardFile = () => pick(BOARD_FILE_KINDS.map((k) => `.${k.ending}`).join(','));
export const pickBoardPhoto = () => pick('image/*');

/** The picked file's bytes, to upload. The live build lets go of the picked file once it's read. */
export async function boardFileBytes(file: PickedBoardUpload): Promise<ArrayBuffer> {
  try {
    return await (await fetch(file.uri)).arrayBuffer();
  } finally {
    URL.revokeObjectURL(file.uri);
  }
}
