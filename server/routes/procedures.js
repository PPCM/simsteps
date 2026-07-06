// Procédures métier (doc/procedures/*.md) exposées à l'interface :
// liste des documents avec leur titre, puis contenu Markdown brut.
// Le dossier est injecté pour rester testable sans arborescence réelle.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Titre = premier en-tête de niveau 1 ; à défaut, le nom du fichier
function extractTitle(markdown, file) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : file.replace(/\.md$/, '');
}

// Noms de fichiers sans séparateur de chemin : pas de traversée possible
const FILE_PATTERN = /^[\w.-]+\.md$/;

export function registerProcedureRoutes(app, proceduresRoot) {
  app.get('/api/procedures', async () => {
    if (!proceduresRoot) return [];
    let files;
    try {
      files = await readdir(proceduresRoot);
    } catch {
      return []; // dossier absent : aucune procédure
    }
    const docs = await Promise.all(
      files
        .filter((file) => FILE_PATTERN.test(file))
        .map(async (file) => {
          const markdown = await readFile(join(proceduresRoot, file), 'utf8');
          return { file, title: extractTitle(markdown, file) };
        })
    );
    return docs.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  });

  app.get('/api/procedures/:file', async (request, reply) => {
    const { file } = request.params;
    if (!proceduresRoot || !FILE_PATTERN.test(file)) {
      return reply.code(404).send({ error: 'Procédure introuvable' });
    }
    try {
      const markdown = await readFile(join(proceduresRoot, file), 'utf8');
      return { file, title: extractTitle(markdown, file), markdown };
    } catch {
      return reply.code(404).send({ error: 'Procédure introuvable' });
    }
  });
}
