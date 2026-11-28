// Mes têtes (Sky 28/11) : des photos détourées du streamer, une par expression, pour les miniatures YouTube
// (Documents/Sklip/Têtes). Le moteur choisit celle qui va avec le meilleur moment (youtube.pick_face).
const fs = require('node:fs');
const path = require('node:path');

const IMAGE = /\.(png|webp|jpe?g)$/i;
const dir = (root) => path.join(root, 'Têtes');

const README = [
  'Mes têtes pour les miniatures YouTube de Sklip',
  '',
  'Mets ici des photos de ta tête, une par expression. Sklip en choisit une qui va avec le meilleur moment',
  'de la vidéo ; le bouton « Autre tête » de l\'onglet Clips passe à la suivante.',
  '',
  '1. Fais une capture de ta webcam avec une grosse expression (bouche ouverte, sourcils levés…).',
  '2. Ouvre-la dans Paint (Windows 11) → bouton « Supprimer l\'arrière-plan » → Fichier → Enregistrer sous → PNG.',
  '3. Mets le fichier ici, avec l\'expression dans son nom :',
  '   rire.png, choc.png, content.png, rage.png (ou choc-2.png, rire-bouche-ouverte.png…).',
  '',
  '   rire     → fous rires, morts drôles',
  '   choc     → ace, clutch, gros multi-kill',
  '   content  → victoire, RR gagnés',
  '   rage     → défaite, RR perdus',
  '',
  'Sans photo ici, Sklip met ta webcam dans la miniature.',
  '',
].join('\r\n');

/** Crée « Têtes » avec la note la première fois ; renvoie le dossier. */
function ensureDir(root) {
  const d = dir(root);
  fs.mkdirSync(d, { recursive: true });
  const note = path.join(d, 'LISEZ-MOI.txt');
  if (!fs.existsSync(note)) fs.writeFileSync(note, README);
  return d;
}

/** Photos du dossier (noms seuls), triées. */
function list(root) {
  try { return fs.readdirSync(dir(root)).filter((n) => IMAGE.test(n)).sort(); } catch { return []; }
}

module.exports = { dir, ensureDir, list, README };
