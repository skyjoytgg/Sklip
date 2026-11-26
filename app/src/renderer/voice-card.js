// Réplique d'un coéquipier, écrite façon BD (comme sur TikTok) : grosses lettres blanches, contour noir épais.
// Le même dessin sert à l'aperçu de l'éditeur et à l'export (PNG posé sur la vidéo par le moteur).

const FONT = '"Bangers", "Luckiest Guy", Impact, "Arial Black", sans-serif';

function layout(ctx, words, size, maxW) {
  ctx.font = `${size}px ${FONT}`;
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Canvas de `width` px avec le texte (4 lignes maximum : la police rapetisse pour un long texte). */
export function drawVoiceText(text, width = 980, doc = document) {
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const words = String(text || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const stroke = (s) => Math.round(s * 0.16);
  let size = Math.round(width * 0.078);
  let lines = layout(ctx, words, size, width - 2 * stroke(size));
  while (lines.length > 4 && size > width * 0.04) {
    size = Math.round(size * 0.9);
    lines = layout(ctx, words, size, width - 2 * stroke(size));
  }
  const lineH = Math.round(size * 1.12);
  canvas.width = width;
  canvas.height = Math.max(1, lines.length * lineH + 2 * stroke(size) + Math.round(size * 0.2));
  ctx.font = `${size}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  lines.forEach((ln, i) => {
    const x = stroke(size), y = stroke(size) + i * lineH;
    ctx.lineWidth = stroke(size) * 2;
    ctx.strokeStyle = '#000';
    ctx.strokeText(ln, x, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(ln, x, y);
  });
  return canvas;
}

const cache = new Map();
export function voiceTextImage(text, width) {
  const key = `${width}|${text}`;
  if (!cache.has(key)) {
    const c = drawVoiceText(text, width);
    cache.set(key, { url: c.toDataURL('image/png'), w: c.width, h: c.height });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
