// Bulle d'un message du chat, dessinée comme le chat Twitch (fond sombre, badges, pseudo dans sa couleur).
// Le même dessin sert à l'aperçu de l'éditeur et à l'export (image PNG posée sur la vidéo par le moteur).

const TWITCH_DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57',
  '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const BADGES = {   // couleur de fond et dessin de chaque badge (simplifiés)
  broadcaster: { bg: '#E91916', draw: 'camera' },
  moderator: { bg: '#00AD03', draw: 'sword' },
  vip: { bg: '#E005B9', draw: 'diamond' },
  subscriber: { bg: '#9146FF', draw: 'star' },
  founder: { bg: '#9146FF', draw: 'star' },
  artist: { bg: '#1F69FF', draw: 'brush' },
  partner: { bg: '#9146FF', draw: 'check' },
};

/** Couleur du pseudo : celle choisie sur Twitch, sinon celle que Twitch donne par défaut ; éclaircie si trop sombre. */
export function userColor(user, color) {
  let c = color;
  if (!c) {
    let h = 0;
    for (const ch of String(user || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    c = TWITCH_DEFAULT_COLORS[h % TWITCH_DEFAULT_COLORS.length];
  }
  const n = parseInt(c.replace('#', ''), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.45) {   // comme Twitch en thème sombre : on éclaircit les pseudos peu lisibles
    const k = (0.45 - lum) / 0.45 * 0.75 + 0.25;
    [r, g, b] = [r, g, b].map((v) => Math.round(v + (255 - v) * k));
  }
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBadge(ctx, kind, x, y, s) {
  const b = BADGES[kind] || { bg: '#9146FF', draw: 'star' };
  ctx.fillStyle = b.bg;
  roundRect(ctx, x, y, s, s, s * 0.2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.1;
  const cx = x + s / 2, cy = y + s / 2, u = s / 10;
  ctx.beginPath();
  if (b.draw === 'camera') {
    ctx.rect(x + 2 * u, y + 3.2 * u, 4.4 * u, 3.6 * u);
    ctx.moveTo(x + 6.4 * u, cy); ctx.lineTo(x + 8.2 * u, y + 3.4 * u); ctx.lineTo(x + 8.2 * u, y + 6.6 * u); ctx.closePath();
    ctx.fill();
  } else if (b.draw === 'sword') {
    ctx.moveTo(x + 7.6 * u, y + 2 * u); ctx.lineTo(x + 3.4 * u, y + 6.2 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 2.4 * u, y + 5.4 * u); ctx.lineTo(x + 4.6 * u, y + 7.6 * u); ctx.stroke();
  } else if (b.draw === 'diamond') {
    ctx.moveTo(cx, y + 2 * u); ctx.lineTo(x + 8 * u, cy); ctx.lineTo(cx, y + 8 * u); ctx.lineTo(x + 2 * u, cy); ctx.closePath(); ctx.fill();
  } else if (b.draw === 'check') {
    ctx.moveTo(x + 2.6 * u, cy); ctx.lineTo(x + 4.4 * u, y + 7 * u); ctx.lineTo(x + 7.6 * u, y + 3 * u); ctx.stroke();
  } else {   // étoile
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 1.6 * u : 3.6 * u;
      ctx[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath(); ctx.fill();
  }
}

/**
 * Dessine la bulle sur un canvas de `width` px (taille finale dans la vidéo). msg = { user, text, color, badges }.
 * Renvoie le canvas (hauteur ajustée au texte).
 */
export function drawChatBubble(msg, width = 920, doc = document) {
  const size = Math.round(width * 0.046);          // ~42 px pour 920 px de large
  const pad = Math.round(size * 0.75);
  const lineH = Math.round(size * 1.32);
  const badge = Math.round(size * 0.95);
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const bold = `700 ${size}px ${FONT}`;
  const normal = `500 ${size}px ${FONT}`;
  const maxX = width - pad;

  // Mise en page : badges, « pseudo: », puis les mots du message à la suite, avec retour à la ligne.
  const items = [];
  let x = pad, line = 0;
  const badges = (msg.badges || []).filter((b) => b !== 'no_audio' && b !== 'no_video').slice(0, 3);
  for (const b of badges) { items.push({ kind: 'badge', b, x, line }); x += badge + size * 0.25; }
  ctx.font = bold;
  const name = `${msg.user || '?'}:`;
  items.push({ kind: 'name', text: name, x, line });
  x += ctx.measureText(name).width + size * 0.3;
  ctx.font = normal;
  const space = ctx.measureText(' ').width;
  for (const word of String(msg.text || '').split(/\s+/).filter(Boolean)) {
    let w = ctx.measureText(word).width;
    let text = word;
    if (w > maxX - pad) {                         // mot très long (lien…) : coupé
      while (text.length > 4 && ctx.measureText(text + '…').width > maxX - pad) text = text.slice(0, -1);
      text += '…'; w = ctx.measureText(text).width;
    }
    if (x + w > maxX && x > pad) { line += 1; x = pad; }
    items.push({ kind: 'word', text, x, line });
    x += w + space;
  }
  const lines = line + 1;
  const height = pad * 2 + lines * lineH - (lineH - size) * 0.4;
  canvas.width = width;
  canvas.height = Math.round(height);

  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = 'rgba(24,24,27,0.93)';
  roundRect(ctx, size * 0.15, size * 0.15, width - size * 0.3, canvas.height - size * 0.3, size * 0.55);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.textBaseline = 'alphabetic';
  const baseY = (l) => pad + l * lineH + size * 0.82;
  for (const it of items) {
    if (it.kind === 'badge') drawBadge(ctx, it.b, it.x, baseY(it.line) - size * 0.82 + (size - badge) / 2, badge);
    else if (it.kind === 'name') { ctx.font = bold; ctx.fillStyle = userColor(msg.user, msg.color); ctx.fillText(it.text, it.x, baseY(it.line)); }
    else { ctx.font = normal; ctx.fillStyle = '#EFEFF1'; ctx.fillText(it.text, it.x, baseY(it.line)); }
  }
  return canvas;
}

const cache = new Map();
/** Image (data URL PNG) de la bulle, gardée en mémoire : l'aperçu la redessine sans arrêt. */
export function chatBubbleImage(msg, width) {
  const key = JSON.stringify([msg.user, msg.text, msg.color, msg.badges, width]);
  if (!cache.has(key)) {
    const c = drawChatBubble(msg, width);
    cache.set(key, { url: c.toDataURL('image/png'), w: c.width, h: c.height });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
