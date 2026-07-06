// Rendu Markdown minimal vers HTML pour l'affichage des procédures
// (doc/procedures/*.md) dans l'interface. Sous-ensemble suffisant :
// titres, paragraphes, gras, code en ligne, blocs de code, listes,
// tableaux et liens. Tout le texte est échappé avant la mise en forme.
// Module pur (aucun DOM), testable sous Node.

export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mise en forme en ligne : code, gras, liens. Les liens relatifs (vers
// d'autres documents du dépôt) ne sont pas navigables dans l'application
// et deviennent du texte mis en évidence ; les liens http(s) s'ouvrent
// dans un nouvel onglet.
export function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) =>
    /^https?:\/\//.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>`
      : `<em>${label}</em>`
  );
  return html;
}

// Un item de liste : marqueur puis lignes de continuation indentées
function collectListItem(lines, start, marker) {
  const parts = [lines[start].replace(marker, '')];
  let i = start + 1;
  while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(-|\d+\.)\s/.test(lines[i])) {
    parts.push(lines[i].trim());
    i++;
  }
  return { html: renderInline(parts.join(' ')), next: i };
}

export function renderMarkdown(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Bloc de code clôturé (```)
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++; // ligne de clôture
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Titres # à ####
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Tableau : ligne d'en-tête |…| suivie du séparateur |---|
    if (line.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const cells = (row) => row.split('|').slice(1, -1).map((c) => renderInline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>'
      );
      continue;
    }

    // Listes à puces ou numérotées (items multilignes par indentation)
    if (/^\s*-\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const markerOf = (l) => (ordered ? /^\s*\d+\.\s+/ : /^\s*-\s+/).exec(l)?.[0];
      const items = [];
      while (i < lines.length && markerOf(lines[i])) {
        const item = collectListItem(lines, i, markerOf(lines[i]));
        items.push(`<li>${item.html}</li>`);
        i = item.next;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraphe : lignes contiguës jusqu'à une ligne vide ou un bloc
    const paragraph = [];
    while (
      i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```|\|)/.test(lines[i]) && !/^\s*(-|\d+\.)\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}
