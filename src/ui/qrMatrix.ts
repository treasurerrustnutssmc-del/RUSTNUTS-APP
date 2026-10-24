// The dark and light squares of a QR code, as rows of booleans (true = dark). Kept apart from the
// drawing so it can be tested without React.

import { create } from 'qrcode';

export function qrMatrix(text: string): boolean[][] {
  // Medium error correction: still scans off a scratched phone screen or in glare.
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const rows: boolean[][] = [];
  for (let r = 0; r < modules.size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < modules.size; c++) row.push(!!modules.get(r, c));
    rows.push(row);
  }
  return rows;
}
