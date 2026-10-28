// Turns the constitution PDF's text into the document library's text format (# headings,
// - bullets, blank lines between paragraphs), for the demo and the live paste file.
//
//   pdftotext "<v4>.pdf" plain.txt && pdftotext -layout "<v4>.pdf" layout.txt
//   npx tsx scripts/clean-constitution.mts plain.txt layout.txt > out.txt
//
// pdftotext's reading order keeps table cells apart, but it drops the hyphen when a hyphenated
// word wraps, so the layout copy is used to put those hyphens back. Page headers and footers,
// the cover and the printed contents table go (the app builds its own contents). Two-column
// tables become "- Term: meaning" bullets. Clause numbers and bullets start new paragraphs.

import { readFileSync } from 'node:fs';

const [plainPath, layoutPath] = process.argv.slice(2);
if (!plainPath || !layoutPath) throw new Error('Usage: clean-constitution.mts plain.txt layout.txt');

const FOOTER = [/^RUST TILL DUST$/, /^v4 \| FINAL CLUB EDITION$/, /^\d+ \/ \d+$/, /^CONSTITUTION \/ INTERNAL CLUB BYLAWS$/];
const TABLES: [string, string][] = [
  ['Document control', 'Details'],
  ['Term', 'Meaning'],
  ['Position', 'Primary internal function'],
  ['Order', 'Patch or status'],
  ['Front Personal Side', 'Front Club Side'],
];
const CLAUSE = /^(\d+[A-Z]?\.\d+[A-Z]?\.|[A-Z]\. )/;
const BULLET = /^•\s*/;

/**
 * Words that wrapped at a hyphen in the layout copy, as joined-up → hyphenated. The rest of the
 * word can sit anywhere on the next line (another column may come first), so every word on the next two lines is
 * tried against the reading-order text.
 */
function wrappedHyphens(layout: string, plain: string): Map<string, string> {
  const fixes = new Map<string, string>();
  const lines = layout.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const end = /([A-Za-z]+)-\s*$/.exec(lines[i]);
    if (!end) continue;
    const next = lines.slice(i + 1).filter((l) => l.trim() !== '').slice(0, 2).join(' ');
    for (const word of next.match(/[A-Za-z]+/g) ?? []) {
      if (new RegExp(`\\b${end[1]}${word}\\b`).test(plain)) fixes.set(end[1] + word, `${end[1]}-${word}`);
    }
  }
  return fixes;
}

const isHeading = (line: string) =>
  line.length >= 4 && !line.includes('|') && /[A-Z]{2}/.test(line) && !/[a-z]/.test(line) && !/^\d+$/.test(line) && !/^[A-Z]\d*$/.test(line);

/** Section titles from the printed contents table, by number, in capitals. */
function sectionTitles(lines: string[]): Map<string, string> {
  const titles = new Map<string, string>();
  const at = lines.indexOf('CONTENTS');
  for (let i = at; i >= 0 && i < lines.length && !lines[i].startsWith('How to read'); i++) {
    if (/^\d+$/.test(lines[i]) && lines[i + 1] && !/^\d+$/.test(lines[i + 1])) titles.set(lines[i], lines[i + 1].toUpperCase());
  }
  return titles;
}

function blocksOf(plain: string): string[][] {
  const lines = plain.split('\n').map((l) => l.trim()).filter((l) => !FOOTER.some((re) => re.test(l)));
  const titles = sectionTitles(lines.filter((l) => l !== ''));
  // Table header lines, only where both of a pair appear one after the other.
  const header = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    if (TABLES.some(([a, b]) => lines[i] === a && lines[j] === b)) header.add(i).add(j);
  }
  const blocks: string[][] = [];
  let cur: string[] = [];
  let title: { target: string; block: string[] } | null = null;
  const flush = () => {
    if (cur.length) blocks.push(cur);
    cur = [];
  };
  lines.forEach((line, i) => {
    if (line === '') return flush();
    if (title && isHeading(line) && title.block[0].length - 2 < title.target.length) {
      // A numbered section title wrapping onto more lines, up to its contents-table length.
      title.block[0] += ` ${line}`;
      return;
    }
    title = null;
    if (header.has(i)) {
      flush();
      blocks.push([line]);
    } else if (isHeading(line)) {
      flush();
      const block = [`# ${line}`];
      blocks.push(block);
      const n = /^(\d+)\. /.exec(line)?.[1];
      const target = n ? titles.get(n) : undefined;
      if (target) title = { target: `${n}. ${target}`, block };
    } else cur.push(line);
  });
  flush();
  return blocks;
}

function paragraphs(block: string[]): string[] {
  const paras: string[][] = [];
  for (const line of block) {
    if (CLAUSE.test(line) || BULLET.test(line) || paras.length === 0) paras.push([line.replace(BULLET, '- ')]);
    else paras.at(-1)!.push(line);
  }
  const first = paras[0];
  // A short title line on top of a paragraph, as in the quick reference: "Title: text".
  if (first && first.length > 1 && !/^\d/.test(first[0]) && first[0].length < 50 && !/[.;:,]$/.test(first[0])) {
    first.splice(0, 2, `${first[0]}: ${first[1]}`);
  }
  return paras.map((p) => p.join(' '));
}

function clean(plain: string, layout: string): string {
  const blocks = blocksOf(plain);
  const start = blocks.findIndex((b) => b[0] === '# CLUB-APPROVED FINAL EDITION');
  const out: string[] = [];
  const tableAt = (i: number) => TABLES.find(([a, b]) => blocks[i]?.[0] === a && blocks[i + 1]?.[0] === b);
  for (let i = start; i < blocks.length; i++) {
    const b = blocks[i];
    if (b[0] === '# CONTENTS') {
      // The printed contents table runs to "How to read this document".
      while (i + 1 < blocks.length && !blocks[i + 1][0].startsWith('How to read')) i++;
      continue;
    }
    const table = tableAt(i);
    if (table && table[0] === 'Front Personal Side') {
      // Column titles over one paragraph each.
      out.push(`- ${table[0]}: ${blocks[i + 2].join(' ')}`, `- ${table[1]}: ${blocks[i + 3].join(' ')}`);
      i += 3;
      continue;
    }
    if (table) {
      i += 2;
      while (i + 1 < blocks.length) {
        if (tableAt(i)) {
          i += 2; // the header repeated on a new page
          continue;
        }
        const cell = blocks[i];
        if (tableAt(i + 1) || cell[0].startsWith('# ') || CLAUSE.test(cell[0]) || cell.length > 3 || cell.some((l) => l.length > 45)) break;
        out.push(`- ${cell.join(' ')}: ${blocks[i + 1].join(' ')}`);
        i += 2;
      }
      i--;
      continue;
    }
    if (b[0].startsWith('# ')) out.push(b[0]);
    else out.push(...paragraphs(b));
  }
  let text = out.join('\n\n');
  for (const [joined, hyphenated] of wrappedHyphens(layout, plain)) text = text.replace(new RegExp(`\\b${joined}\\b`, 'g'), hyphenated);
  return `${text}\n`;
}

process.stdout.write(clean(readFileSync(plainPath, 'utf8'), readFileSync(layoutPath, 'utf8')));
