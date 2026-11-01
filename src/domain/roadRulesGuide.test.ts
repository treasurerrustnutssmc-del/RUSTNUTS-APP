import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGRAMS,
  GUIDE_RULES,
  diagramById,
  diagramLabel,
  figureNumber,
  adoptionInput,
  guideStatus,
  neighbours,
  ruleByNumber,
  ruleNeighbours,
  rulesWithDiagram,
  writtenRulesText,
} from './roadRulesGuide';
import { MAX_RULES_TEXT, draftProblem, rulesBlocks } from './roadRules';

test('Chris’s diagrams-only document: 17 diagrams, each once, in his order', () => {
  assert.equal(DIAGRAMS.length, 17);
  assert.equal(new Set(DIAGRAMS.map((d) => d.id)).size, 17);
  assert.deepEqual(
    DIAGRAMS.map((d) => d.id),
    [
      'roles',
      'formation',
      'single-file',
      'axle-to-axle',
      'readiness',
      'signals-1',
      'signals-2',
      'signals-3',
      'pass-signal',
      'arm-up',
      'abort',
      'turning',
      'keep-left',
      'snake',
      'protected',
      'support-vehicles',
      'tail-gunner',
    ],
  );
});

test('the condensed rules: 18 rules, numbered 1 to 18 in order, none empty', () => {
  assert.deepEqual(
    GUIDE_RULES.map((r) => r.number),
    Array.from({ length: 18 }, (_, i) => i + 1),
  );
  for (const r of GUIDE_RULES) {
    assert.ok(r.title.length > 0);
    assert.ok(r.blocks.some((b) => b.kind !== 'diagram'), `rule ${r.number} has words`);
  }
  assert.equal(GUIDE_RULES[0].title, 'Why We Have Road Rules');
  assert.equal(GUIDE_RULES[17].title, 'If Someone Does Not Follow the Rules');
});

test('every diagram sits in the condensed rules exactly once, and nothing else does', () => {
  const placed = GUIDE_RULES.flatMap((r) => r.blocks.flatMap((b) => (b.kind === 'diagram' ? [b.id] : [])));
  assert.equal(placed.length, 17);
  assert.deepEqual([...placed].sort(), DIAGRAMS.map((d) => d.id).sort());
});

test('figure numbers follow the condensed document', () => {
  assert.equal(figureNumber('roles'), 1);
  assert.equal(figureNumber('readiness'), 4);
  assert.equal(figureNumber('axle-to-axle'), 5);
  assert.equal(figureNumber('support-vehicles'), 6);
  assert.equal(figureNumber('tail-gunner'), 17);
});

test('each diagram names the rule printed on it', () => {
  assert.equal(diagramById('roles')?.rule, 3);
  assert.equal(diagramById('readiness')?.rule, 8);
  assert.equal(diagramById('signals-3')?.rule, 11);
  assert.equal(diagramById('tail-gunner')?.rule, 17);
  assert.equal(diagramById('nope'), undefined);
  assert.equal(diagramLabel(diagramById('abort')!), 'Rule 12 · Closing the passing window and aborting');
});

test('the readiness diagram is printed under Rule 9, but labelled Rule 8', () => {
  // Where a diagram sits in the condensed text and the rule it belongs to can differ.
  assert.deepEqual(rulesWithDiagram('readiness'), [9]);
});

test('previous and next diagram, in the diagrams-only order', () => {
  assert.deepEqual(neighbours('roles'), { prev: null, next: 'formation' });
  assert.deepEqual(neighbours('axle-to-axle'), { prev: 'single-file', next: 'readiness' });
  assert.deepEqual(neighbours('tail-gunner'), { prev: 'support-vehicles', next: null });
});

test('previous and next rule', () => {
  assert.equal(ruleByNumber(7)?.title, 'Formation and Position Order');
  assert.equal(ruleByNumber(19), undefined);
  assert.deepEqual(ruleNeighbours(1), { prev: null, next: 2 });
  assert.deepEqual(ruleNeighbours(18), { prev: 17, next: null });
});

// Adoption: the NEC publishes the written rules as a Road Rules version, which members sign. The
// illustrated guide stays beside it for members; only its diagrams go public.


test('the written rules: every rule as a heading, every word in order, each diagram named by figure', () => {
  const text = writtenRulesText();
  const blocks = rulesBlocks(text);
  const expected: string[] = [];
  for (const r of GUIDE_RULES) {
    expected.push(`heading:${r.number}. ${r.title}`);
    for (const b of r.blocks) {
      if (b.kind === 'diagram') {
        const d = diagramById(b.id)!;
        expected.push(`para:Figure ${figureNumber(d.id)}: ${d.caption} (in the illustrated Road Rules).`);
      } else expected.push(`${b.kind === 'bullet' ? 'bullet' : 'para'}:${b.text}`);
    }
  }
  assert.deepEqual(blocks.map((b) => `${b.kind}:${b.text}`), expected);
  assert.equal(blocks.filter((b) => b.kind === 'heading').length, 18);
});

test('the written rules fit one Road Rules version and publish as they are', () => {
  const text = writtenRulesText();
  assert.ok([...text.trim()].length <= MAX_RULES_TEXT);
  assert.equal(draftProblem({ body: text, changes: '', fresh: true }), null);
  assert.ok(!text.includes('.png'));
});

test('before adoption the illustrated set is labelled a draft; after, the illustrated version', () => {
  const draft = guideStatus(false);
  assert.equal(draft.chip, 'Club adoption pending');
  assert.equal(draft.tone, 'warn');
  assert.equal(draft.section, 'Illustrated draft');
  assert.match(draft.line, /^Draft · 30\/10\/2026$/);
  assert.match(draft.note, /Until the club adopts it/);

  const adopted = guideStatus(true);
  assert.equal(adopted.chip, 'Adopted');
  assert.equal(adopted.tone, 'ok');
  assert.equal(adopted.section, 'Illustrated version');
  assert.equal(adopted.line, '30/10/2026');
  assert.ok(!/draft/i.test(`${adopted.chip} ${adopted.section} ${adopted.line} ${adopted.noteTitle} ${adopted.note}`));
  assert.match(adopted.note, /written Road Rules are the ones you sign/);
});

test('one-press adoption publishes the written rules as a fresh version with a short note', () => {
  const input = adoptionInput();
  assert.equal(input.body, writtenRulesText());
  assert.equal(input.fresh, true);
  assert.equal(input.changes, 'Adopted by the NEC: the club’s Road Rules, from the illustrated set of 30/10/2026.');
  assert.equal(draftProblem(input), null);
});
