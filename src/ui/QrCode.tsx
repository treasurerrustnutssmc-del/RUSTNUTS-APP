import React, { useMemo } from 'react';
import { View } from 'react-native';
import { colors, radius } from '../theme';
import { qrMatrix } from './qrMatrix';

const QUIET = 4; // modules of light margin a scanner needs around the code

/**
 * A QR code drawn with plain views: ink squares on a bone plate (scanners need dark on light, so
 * this is the one bright surface besides the logo plate). Each run of dark squares in a row is
 * one view, which keeps it to a few hundred views.
 */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const rows = useMemo(() => qrMatrix(value), [value]);
  const n = rows.length + QUIET * 2;
  const cell = size / n;
  const runs = useMemo(() => {
    const out: { r: number; c: number; len: number }[] = [];
    rows.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (!row[c]) {
          c++;
          continue;
        }
        let len = 1;
        while (row[c + len]) len++;
        out.push({ r, c, len });
        c += len;
      }
    });
    return out;
  }, [rows]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: colors.bone, borderRadius: radius.md }}
    >
      {runs.map(({ r, c, len }) => (
        <View
          key={`${r}-${c}`}
          style={{
            position: 'absolute',
            top: (r + QUIET) * cell,
            left: (c + QUIET) * cell,
            width: len * cell + 0.5, // the half point closes hairline gaps between squares
            height: cell + 0.5,
            backgroundColor: colors.ink,
          }}
        />
      ))}
    </View>
  );
}
