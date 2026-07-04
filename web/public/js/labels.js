// Étiquettes texte pour la scène 3D : sprites avec texture canvas,
// toujours face à la caméra et lisibles de loin.

import * as THREE from 'three';

/**
 * Crée un sprite texte.
 * @param {string} text
 * @param {{color?: string, background?: string, worldHeight?: number}} [options]
 *        worldHeight : hauteur du sprite en mètres dans la scène
 */
export function makeTextSprite(text, { color = '#e6e8ea', background = null, worldHeight = 1.4 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 44px ui-monospace, Menlo, Consolas, monospace';
  ctx.font = font;
  const padding = 18;
  const textWidth = Math.ceil(ctx.measureText(text).width);
  canvas.width = textWidth + padding * 2;
  canvas.height = 64 + padding;

  // Le changement de taille du canvas réinitialise le contexte
  ctx.font = font;
  ctx.textBaseline = 'middle';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldHeight * (canvas.width / canvas.height), worldHeight, 1);
  return sprite;
}
