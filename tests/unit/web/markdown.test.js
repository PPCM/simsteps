// Tests du rendu Markdown minimal utilisé par l'aide « Procédures ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, escapeHtml } from '../../../web/public/js/markdown.js';

test('les titres # à #### deviennent des balises h1 à h4', () => {
  const html = renderMarkdown('# Titre\n\n## Section\n\n#### Détail');
  assert.match(html, /<h1>Titre<\/h1>/);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<h4>Détail<\/h4>/);
});

test('le HTML du document est échappé (aucune injection possible)', () => {
  const html = renderMarkdown('Un <script>alert(1)</script> piégé');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.equal(escapeHtml('a "b" & <c>'), 'a &quot;b&quot; &amp; &lt;c&gt;');
});

test('gras et code en ligne', () => {
  assert.equal(
    renderInline('du **gras** et du `code`'),
    'du <strong>gras</strong> et du <code>code</code>'
  );
});

test('lien http en nouvel onglet, lien relatif neutralisé en texte', () => {
  assert.match(
    renderInline('voir [le site](https://exemple.fr/page)'),
    /<a href="https:\/\/exemple.fr\/page" target="_blank" rel="noopener">le site<\/a>/
  );
  assert.equal(
    renderInline('voir [personnalisation](personnalisation.md)'),
    'voir <em>personnalisation</em>'
  );
});

test('liste à puces avec continuation indentée regroupée dans l’item', () => {
  const html = renderMarkdown('- premier item\n  suite de l’item ;\n- second item');
  assert.match(html, /<ul><li>premier item suite de l’item ;<\/li><li>second item<\/li><\/ul>/);
});

test('liste numérotée rendue en ol', () => {
  const html = renderMarkdown('1. un\n2. deux');
  assert.match(html, /<ol><li>un<\/li><li>deux<\/li><\/ol>/);
});

test('tableau avec en-tête et lignes', () => {
  const html = renderMarkdown('| Colonne | Rôle |\n|---|---|\n| `a` | valeur A |\n| b | valeur B |');
  assert.match(html, /<table><thead><tr><th>Colonne<\/th><th>Rôle<\/th><\/tr><\/thead>/);
  assert.match(html, /<td><code>a<\/code><\/td><td>valeur A<\/td>/);
  assert.match(html, /<td>b<\/td><td>valeur B<\/td>/);
});

test('bloc de code clôturé rendu en pre, contenu échappé et non formaté', () => {
  const html = renderMarkdown('```bash\ncurl -X POST <url> **pas de gras**\n```');
  assert.match(html, /<pre><code>curl -X POST &lt;url&gt; \*\*pas de gras\*\*<\/code><\/pre>/);
});

test('les lignes contiguës forment un seul paragraphe', () => {
  const html = renderMarkdown('une phrase\ncoupée en deux\n\nun autre paragraphe');
  assert.match(html, /<p>une phrase coupée en deux<\/p>/);
  assert.match(html, /<p>un autre paragraphe<\/p>/);
});

test('la procédure Reflex complète se rend sans erreur', async () => {
  const { readFile } = await import('node:fs/promises');
  const markdown = await readFile(
    new URL('../../../doc/procedures/import-reflex.md', import.meta.url),
    'utf8'
  );
  const html = renderMarkdown(markdown);
  assert.match(html, /<h1>Importer des données Reflex WMS dans SimSteps<\/h1>/);
  assert.match(html, /<table>/);
  assert.ok(!html.includes('<script'));
});
