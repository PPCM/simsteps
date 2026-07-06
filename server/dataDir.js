// Dossier de travail data/ : les fichiers de démonstration (demo/)
// y sont copiés au premier démarrage, fichier par fichier — un fichier
// déjà présent n'est jamais écrasé, l'utilisateur peut donc modifier
// ses copies (et restaurer une démo en la recopiant depuis demo/).
// data/ est fait pour être monté en volume : les fichiers ajoutés par
// l'utilisateur survivent aux redémarrages et aux mises à jour d'image.

import { mkdir, readdir, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Prépare le dossier de travail : le crée s'il manque et y copie les
 * fichiers de démonstration absents.
 * @param {string} demoDir dossier source (livré avec l'application)
 * @param {string} dataDir dossier de travail (volume persistant)
 * @returns {Promise<string[]>} noms des fichiers copiés (vide si tout existait)
 */
export async function ensureDataDir(demoDir, dataDir) {
  await mkdir(dataDir, { recursive: true });
  const copied = [];
  for (const file of (await readdir(demoDir)).sort()) {
    try {
      await access(join(dataDir, file));
    } catch {
      await copyFile(join(demoDir, file), join(dataDir, file));
      copied.push(file);
    }
  }
  return copied;
}
