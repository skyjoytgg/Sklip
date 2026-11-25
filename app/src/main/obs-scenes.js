// Scènes OBS : où est la webcam, et à quoi sert chaque scène (jeu, discussion, pause) ? On le DEMANDE à OBS,
// en lecture seule (GetSceneList, GetCurrentProgramScene, GetSceneItemList, GetGroupSceneItemList,
// GetVideoSettings) : rien n'est modifié.
// Windows ne laisse qu'un logiciel utiliser la webcam (OBS) : Sklip ne peut pas l'enregistrer à part comme le micro,
// mais il sait ainsi exactement où elle est dans l'image, scène par scène.

const CAM_KINDS = new Set(['dshow_input', 'av_capture_input', 'av_capture_input_v2', 'v4l2_input', 'macos-avcapture']);
// Capture de jeu / de fenêtre / d'écran : ce qui montre le jeu.
const GAME_KINDS = new Set(['game_capture', 'window_capture', 'monitor_capture', 'screen_capture', 'xcomposite_input',
  'display_capture', 'screen_capture_kit']);
const ALIGN = { LEFT: 1, RIGHT: 2, TOP: 4, BOTTOM: 8 };
const FULL = 0.45;        // la webcam occupe au moins 45 % de l'image : « caméra en grand »
const GAME_MIN = 0.5;     // une capture de jeu sur au moins la moitié de l'image : scène de jeu
const CAM_MIN = 0.04;     // en dessous, ce n'est pas vraiment une webcam affichée

// Zones de l'image de Valorant que Sklip LIT pour repérer les moments (fractions de l'image, cf. moteur :
// kill_detect.py et rounds.py). Un overlay posé dessus (rang, alertes, chat…) peut cacher un kill ou le score.
const READ_ZONES = {
  score: { label: 'le score en haut au centre', x: 0.23, y: 0, w: 0.55, h: 0.09 },
  kill: { label: 'la bannière des kills en bas au centre', x: 0.4375, y: 0.687, w: 0.125, h: 0.222 },
  spectate: { label: "l'icône de spectateur en bas à gauche", x: 0.045, y: 0.765, w: 0.06, h: 0.065 },
};
const OVERLAP = 0.15;     // un overlay qui cache au moins 15 % d'une zone gêne la lecture
const HUGE = 0.6;         // overlay plein écran (alertes, cadre) : en général transparent au milieu, ignoré

/** Types de scène que le streamer peut choisir. */
const SCENE_TYPES = { jeu: 'Jeu', discussion: 'Discussion (Just Chatting)', pause: 'Pause (pas de clips)' };

/** Rectangle occupé à l'écran par un élément de scène (pixels du canevas). Rotation ignorée. */
function itemRect(tr) {
  const srcW = Math.max(0, (tr.sourceWidth || 0) - (tr.cropLeft || 0) - (tr.cropRight || 0));
  const srcH = Math.max(0, (tr.sourceHeight || 0) - (tr.cropTop || 0) - (tr.cropBottom || 0));
  let w; let h;
  const bounded = tr.boundsType && tr.boundsType !== 'OBS_BOUNDS_NONE';
  if (bounded) {
    const bw = tr.boundsWidth || 0; const bh = tr.boundsHeight || 0;
    if (tr.boundsType === 'OBS_BOUNDS_STRETCH' || !srcW || !srcH) { w = bw; h = bh; } else {
      const k = tr.boundsType === 'OBS_BOUNDS_SCALE_OUTER' ? Math.max(bw / srcW, bh / srcH)
        : tr.boundsType === 'OBS_BOUNDS_SCALE_TO_WIDTH' ? bw / srcW
          : tr.boundsType === 'OBS_BOUNDS_SCALE_TO_HEIGHT' ? bh / srcH : Math.min(bw / srcW, bh / srcH);
      w = srcW * k; h = srcH * k;
    }
    // La boîte est placée selon `alignment`, le contenu dans la boîte selon `boundsAlignment`.
    const box = place(tr.positionX || 0, tr.positionY || 0, bw, bh, tr.alignment ?? 5);
    const ba = tr.boundsAlignment ?? 0;
    const x = ba & ALIGN.LEFT ? box.x : ba & ALIGN.RIGHT ? box.x + bw - w : box.x + (bw - w) / 2;
    const y = ba & ALIGN.TOP ? box.y : ba & ALIGN.BOTTOM ? box.y + bh - h : box.y + (bh - h) / 2;
    return { x, y, w, h };
  }
  w = srcW * Math.abs(tr.scaleX ?? 1); h = srcH * Math.abs(tr.scaleY ?? 1);
  return { ...place(tr.positionX || 0, tr.positionY || 0, w, h, tr.alignment ?? 5), w, h };
}

function place(px, py, w, h, a) {
  const x = a & ALIGN.LEFT ? px : a & ALIGN.RIGHT ? px - w : px - w / 2;
  const y = a & ALIGN.TOP ? py : a & ALIGN.BOTTOM ? py - h : py - h / 2;
  return { x, y };
}

/** Rectangle dans le canevas, ramené entre 0 et 1 (coupé aux bords). null s'il est hors de l'image. */
function normalize(r, baseW, baseH) {
  const x0 = Math.max(0, r.x); const y0 = Math.max(0, r.y);
  const x1 = Math.min(baseW, r.x + r.w); const y1 = Math.min(baseH, r.y + r.h);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const k = (v) => Math.round(v * 10000) / 10000;
  return { x: k(x0 / baseW), y: k(y0 / baseH), w: k((x1 - x0) / baseW), h: k((y1 - y0) / baseH) };
}

/**
 * Sources affichées dans une scène, avec leur place à l'écran, en suivant les groupes et les scènes imbriquées.
 * `list(name, isGroup)` → éléments de scène (réponse d'OBS). Renvoie [{ kind, rect (pixels) }].
 */
async function flatten(list, sceneName, isGroup = false, depth = 0, off = { x: 0, y: 0, sx: 1, sy: 1 }) {
  if (depth > 4) return [];
  const out = [];
  for (const it of (await list(sceneName, isGroup)) || []) {
    if (it.sceneItemEnabled === false) continue;
    const tr = it.sceneItemTransform || {};
    const r = itemRect(tr);
    const abs = { x: off.x + r.x * off.sx, y: off.y + r.y * off.sy, w: r.w * off.sx, h: r.h * off.sy };
    if (it.isGroup || it.sourceType === 'OBS_SOURCE_TYPE_SCENE') {
      // Scène imbriquée / groupe : ses éléments sont dans son propre repère, mis à l'échelle de l'élément.
      const sx = tr.sourceWidth ? r.w / tr.sourceWidth : 1; const sy = tr.sourceHeight ? r.h / tr.sourceHeight : 1;
      out.push(...await flatten(list, it.sourceName, !!it.isGroup, depth + 1,
        { x: abs.x, y: abs.y, sx: off.sx * sx, sy: off.sy * sy }));
    } else {
      out.push({ kind: it.inputKind || '', name: it.sourceName || '', rect: abs });
    }
  }
  return out;
}

const area = (r) => (r ? r.w * r.h : 0);
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Overlays posés PAR-DESSUS le jeu sur une zone lue par Sklip. `items` dans l'ordre d'OBS (du bas vers le haut),
 * avec `n` = rectangle ramené entre 0 et 1. → [{ name, zones: ['kill', …] }]
 */
function overlaysOnZones(items) {
  const gameAt = items.findIndex((it) => GAME_KINDS.has(it.kind));
  if (gameAt < 0) return [];
  const out = [];
  for (const it of items.slice(gameAt + 1)) {
    if (CAM_KINDS.has(it.kind) || GAME_KINDS.has(it.kind) || area(it.n) >= HUGE) continue;
    const zones = Object.entries(READ_ZONES).filter(([, z]) => overlap(it.n, z) >= OVERLAP * area(z)).map(([id]) => id);
    if (zones.length) out.push({ name: it.name, zones });
  }
  return out;
}

/** Webcam (la plus grande), place du jeu, overlays gênants dans une scène, + type deviné. */
async function sceneInfo(list, sceneName, baseW, baseH) {
  const items = (await flatten(list, sceneName)).map((it) => ({ ...it, n: normalize(it.rect, baseW, baseH) }))
    .filter((it) => it.n);
  let cam = null; let game = 0;
  for (const it of items) {
    if (CAM_KINDS.has(it.kind) && area(it.n) > area(cam)) cam = it.n;
    if (GAME_KINDS.has(it.kind)) game = Math.max(game, area(it.n));
  }
  return { cam, full: area(cam) >= FULL, guess: guessType(area(cam), game), overlays: overlaysOnZones(items) };
}

/** Type deviné : beaucoup de jeu → jeu ; sinon une webcam → discussion ; sinon pause (« Je reviens »…). */
function guessType(camArea, gameArea) {
  if (gameArea >= GAME_MIN && gameArea >= camArea) return 'jeu';
  if (camArea >= CAM_MIN) return 'discussion';
  return 'pause';
}

async function canvas(obs) {
  const video = await obs.request('GetVideoSettings');
  return { baseW: video.baseWidth || 1920, baseH: video.baseHeight || 1080 };
}
const lister = (obs) => async (name, isGroup) => (await obs.request(isGroup ? 'GetGroupSceneItemList' : 'GetSceneItemList',
  { sceneName: name })).sceneItems || [];

/** Ce que montre OBS en ce moment : { scene, cam (0..1) | null, full, type } (type choisi par le streamer, sinon deviné). */
async function readCam(obs, chosen = {}) {
  const [{ currentProgramSceneName: scene }, { baseW, baseH }] = await Promise.all([
    obs.request('GetCurrentProgramScene'), canvas(obs)]);
  const info = await sceneInfo(lister(obs), scene, baseW, baseH);
  return { scene, cam: info.cam, full: info.full, type: chosen[scene] || info.guess, guess: info.guess };
}

/** Toutes les scènes d'OBS avec leur type deviné (pour l'assistant et les réglages). */
async function readScenes(obs, chosen = {}) {
  const [{ scenes = [] }, { baseW, baseH }] = await Promise.all([obs.request('GetSceneList'), canvas(obs)]);
  const list = lister(obs);
  const out = [];
  // OBS renvoie les scènes de bas en haut : on les remet dans l'ordre de sa liste.
  for (const s of [...scenes].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0))) {
    const info = await sceneInfo(list, s.sceneName, baseW, baseH);
    out.push({ name: s.sceneName, guess: info.guess, type: chosen[s.sceneName] || info.guess, chosen: !!chosen[s.sceneName],
      cam: info.cam, full: info.full, overlays: info.overlays });
  }
  return out;
}

module.exports = { itemRect, normalize, flatten, sceneInfo, guessType, overlaysOnZones, READ_ZONES, readCam, readScenes, SCENE_TYPES, CAM_KINDS, GAME_KINDS, FULL };
