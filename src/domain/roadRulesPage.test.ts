import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAMS, GUIDE_RULES } from './roadRulesGuide';
import { ROAD_RULES_IMAGE_DIR, renderRoadRulesPage } from './roadRulesPage';
import { mentionsStores, renderSitePage } from './sitePage';

// The public face of the Road Rules: Chris's diagrams only. The written rules members sign never
// leave the app.

test('the public Road Rules page shows every diagram, in the diagrams-only order, with its caption', () => {
  const page = renderRoadRulesPage();
  assert.equal(page.heading, 'Road Rules');
  let at = -1;
  for (const d of DIAGRAMS) {
    const i = page.body.indexOf(`src="${ROAD_RULES_IMAGE_DIR}/${d.id}.png"`);
    assert.ok(i > at, `${d.id} in order`);
    at = i;
    assert.ok(page.body.includes(`Rule ${d.rule} · ${d.caption}`), d.id);
  }
});

test('the public page carries none of the written rules', () => {
  const html = renderSitePage('road-rules', renderRoadRulesPage());
  for (const r of GUIDE_RULES) {
    for (const b of r.blocks) {
      if (b.kind === 'para' || b.kind === 'bullet') assert.ok(!html.includes(b.text.slice(0, 60)), `rule ${r.number}: ${b.text.slice(0, 40)}`);
    }
  }
  assert.ok(html.includes('<link rel="canonical" href="https://www.rustnutssmc.com.au/app/road-rules.html" />'));
  assert.ok(!html.includes('The members’ app'), 'not labelled as an app page');
  assert.ok(!html.includes('class="app-pages"'), 'no app-page footer links');
  assert.ok(!mentionsStores(html));
});
