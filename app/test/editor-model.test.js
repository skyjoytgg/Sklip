const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/renderer/editor-model');

const base = () => m.createProject({
  streamDuration: 3600,
  clips: [
    { id: 'a', start: 96, end: 102 },
    { id: 'b', start: 296, end: 305 },
    { id: 'c', start: 1196, end: 1202 },
  ],
});

test('durée totale et positions', () => {
  const p = base();
  assert.strictEqual(m.totalDuration(p), 21);
  assert.deepStrictEqual(m.clipOffsets(p), [0, 6, 15]);
});

test('glisser-déposer : déplacer un clip', () => {
  const ids = (p) => p.clips.map((c) => c.id).join('');
  assert.strictEqual(ids(m.moveClip(base(), 'c', 0)), 'cab');
  assert.strictEqual(ids(m.moveClip(base(), 'a', 3)), 'bca');
  assert.strictEqual(ids(m.moveClip(base(), 'a', 2)), 'bac');
  assert.strictEqual(ids(m.moveClip(base(), 'b', 1)), 'abc');
});

test('rognage : bornes et durée minimale', () => {
  let p = m.trimClip(base(), 'a', 'start', -200);
  assert.strictEqual(p.clips[0].start, 0);
  p = m.trimClip(base(), 'a', 'start', 50);
  assert.strictEqual(p.clips[0].start, 101);  // 1 s minimum
  p = m.trimClip(base(), 'c', 'end', 9999);
  assert.strictEqual(p.clips[2].end, 3600);   // fin du stream
});

test('rognage calé sur le BPM', () => {
  let p = { ...base(), bpm: 120 };
  p = m.trimClip(p, 'a', 'end', 0.7);
  const d = p.clips[0].end - p.clips[0].start;
  assert.ok(Math.abs(d / 0.5 - Math.round(d / 0.5)) < 1e-6, String(d));
});

test('ajouter un moment, retirer un clip', () => {
  let p = m.addMoment(base(), { type: 'raid', t: 2000 }, 1);
  assert.strictEqual(p.clips.length, 4);
  assert.deepStrictEqual([p.clips[1].start, p.clips[1].end], [1970, 2008]);
  assert.ok(m.isMomentUsed(p, { t: 2000 }));
  p = m.removeClip(p, p.clips[1].id);
  assert.ok(!m.isMomentUsed(p, { t: 2000 }));
});

test('volumes : global, par clip, musique coupée par défaut', () => {
  let p = base();
  assert.strictEqual(p.volumes.music, 0);
  assert.strictEqual(p.volumes.discord, 1);
  p = m.setGlobalVolume(p, 'mic', 0.5);
  p = m.setClipVolume(p, 'b', 'mic', 1.5);
  assert.strictEqual(m.effectiveVolume(p, p.clips[0], 'mic'), 0.5);
  assert.strictEqual(m.effectiveVolume(p, p.clips[1], 'mic'), 1.5);
  p = m.setClipVolume(p, 'b', 'mic', null);
  assert.strictEqual(m.effectiveVolume(p, p.clips[1], 'mic'), 0.5);
});

test('spécification de rendu', () => {
  const p = m.updateClip(base(), 'b', { layout: 'game_only' });
  const spec = m.toRenderSpec(p, { video: 'rec.mkv', output: 'out.mp4' });
  assert.strictEqual(spec.clips.length, 3);
  assert.strictEqual(spec.clips[1].layout, 'game_only');
  assert.strictEqual(spec.fmt, '9x16');
});

test('format du temps', () => {
  assert.strictEqual(m.fmtTime(65), '1:05');
  assert.strictEqual(m.fmtTime(3725), '1:02:05');
});

test('garder la musique du live sur un seul clip', () => {
  let p = m.createProject({ clips: [{ start: 10, end: 20 }, { start: 40, end: 50 }], streamDuration: 100 });
  const [a, b] = p.clips;
  assert.equal(m.hasLiveMusic(p, a), false);                 // musique coupée par défaut
  p = m.setLiveMusic(p, a.id, true);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), true);
  assert.equal(m.hasLiveMusic(p, p.clips[1]), false);
  assert.equal(m.toRenderSpec(p, { video: 'v', output: 'o' }).clips[0].volumes.music, 1);
  p = m.setLiveMusic(p, a.id, false);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), false);
  assert.equal('music' in p.clips[0].volumes, false);        // retour au réglage global
  // Musique montée dans le mixeur global : décocher la coupe pour ce clip seulement.
  p = m.setGlobalVolume(p, 'music', 0.6);
  p = m.setLiveMusic(p, b.id, false);
  assert.equal(m.hasLiveMusic(p, p.clips[1]), false);
  assert.equal(m.hasLiveMusic(p, p.clips[0]), true);
});

test('texte proposé pour poster la vidéo', () => {
  let p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'multikill', t: 15, meta: { count: 3 } }] }], streamDuration: 100 });
  let post = m.suggestPost(p, { streamTitle: 'RANKED PLAT NEON', channel: 'sky' });
  assert.equal(post.title, '3K 😤');
  assert.ok(post.hashtags.includes('#shorts'));
  assert.match(post.description, /RANKED PLAT NEON.*twitch\.tv\/sky/);
  p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'clutch', t: 15, meta: { vs: 3 } }] }], streamDuration: 100, fmt: '16x9' });
  post = m.suggestPost(p);
  assert.equal(post.title, 'Clutch 1v3 🧠');
  assert.ok(!post.hashtags.includes('#shorts'));
  assert.equal(m.toRenderSpec(p, { video: 'v', output: 'o', post }).post.title, 'Clutch 1v3 🧠');
  p = m.createProject({ clips: [{ start: 10, end: 20, moments: [{ type: 'multikill', t: 15, meta: { count: 3, knives: [15] } }] }], streamDuration: 100 });
  post = m.suggestPost(p);
  assert.equal(post.title, 'Kill au couteau 🔪');
  assert.ok(post.hashtags.includes('#knife'));
});

test('messages du chat sur la vidéo : proposés, ajoutés, placés, exportés', () => {
  const chat = [{ t: 50, user: 'Lila', text: 'trop fort le kill', color: '#FF69B4', badges: ['vip'] },
    { t: 95, user: 'Kamel', text: 'gg', badges: [] }, { t: 300, user: 'Plus tard', text: 'x', badges: [] }];
  let p = m.createProject({ clips: [{ id: 'a', start: 90, end: 110 }], streamDuration: 400 });
  const c = p.clips[0];
  assert.deepEqual(m.chatNear(chat, c).map((x) => x.user), ['Kamel', 'Lila']);     // 3 min avant → fin du clip
  p = m.toggleChat(p, 'a', chat[0]);                                                // posté avant le clip : au début
  let b = p.clips[0].chat[0];
  assert.equal(b.start, 90.2); assert.equal(b.auto, false);
  assert.ok(b.end - b.start >= 2.5 && b.end <= 110);
  assert.ok(m.isChatShown(p.clips[0], chat[0]));
  assert.equal(m.chatAt(p.clips[0], 91).length, 1); assert.equal(m.chatAt(p.clips[0], 100).length, 0);
  p = m.moveChat(p, 'a', chat[0], 108);                                             // ne sort pas du clip
  b = p.clips[0].chat[0];
  assert.ok(b.end <= 110 && b.start < 108);
  p = m.toggleChat(p, 'a', chat[1]);
  assert.equal(p.clips[0].chat.find((x) => x.user === 'Kamel').start, 95.2);        // posté pendant le clip : à ce moment
  p = m.toggleChat(p, 'a', chat[0]);
  assert.deepEqual(p.clips[0].chat.map((x) => x.user), ['Kamel']);
  assert.deepEqual(m.chatPlacement('9x16', 'cam_top', 200), { x: 80, y: 520, w: 920 });  // à cheval cam / jeu
  assert.equal(m.chatPlacement('9x16', 'game_only', 200).y, 260);
  assert.equal(m.chatReadTime('gg'), 2.5); assert.equal(m.chatReadTime('a '.repeat(40)), 7);
  const st = { a: [{ file: 'b.png', start: 0.3, end: 3, x: 80, y: 520, w: 920, anim: 'fade' }] };
  const spec = m.toRenderSpec(p, { video: 'v', output: 'o', stickers: st });
  assert.equal(spec.clips[0].stickers[0].file, 'b.png');
  assert.equal(m.toRenderSpec(p, { video: 'v', output: 'o' }).clips[0].stickers, undefined);
});

test('sous-titres : lignes, correction, blague, rendu', () => {
  const words = [
    { start: 30.14, end: 30.56, text: 'Tu' }, { start: 30.56, end: 30.66, text: 'mets' }, { start: 30.66, end: 31.02, text: 'ton...' },
    { start: 31.02, end: 32.04, text: 'Oulah!' }, { start: 40.84, end: 41.48, text: '50' }, { start: 41.48, end: 42.12, text: 'Renault!' },
  ];
  let p = m.createProject({ clips: [{ id: 'k', start: 28, end: 44 }], streamDuration: 100 });
  p = m.setClipWords(p, 'k', words);
  const lines = p.clips[0].subs;
  assert.deepEqual(lines.map(m.lineText), ['Tu mets ton...', 'Oulah!', '50 Renault!']);
  // Faute corrigée : même nombre de mots → chaque mot garde son timing.
  p = m.setLineText(p, 'k', 2, '50 Raze!');
  assert.deepEqual(p.clips[0].subs[2].words.map((w) => [w.start, w.text]), [[40.84, '50'], [41.48, 'Raze!']]);
  // Blague : phrase réécrite → les mots se partagent la durée de la ligne.
  p = m.setLineText(p, 'k', 1, 'il a eu peur du noir');
  const l = p.clips[0].subs[1];
  assert.equal(l.words.length, 6);
  assert.equal(l.words[0].start, 31.02);
  assert.ok(Math.abs(l.words[5].end - 32.04) < 0.01);
  // Ligne vidée = supprimée ; ligne ajoutée à la tête de lecture.
  p = m.setLineText(p, 'k', 0, '   ');
  p = m.addLine(p, 'k', 35, 'GG');
  assert.deepEqual(p.clips[0].subs.map(m.lineText), ['il a eu peur du noir', 'GG', '50 Raze!']);
  // Rendu : temps relatifs au clip, seulement si les sous-titres sont activés.
  const spec = m.toRenderSpec(p, { video: 'v', output: 'o' });
  assert.deepEqual(spec.clips[0].words[6], { start: 7, end: 8.5, text: 'GG' });
  assert.equal(m.toRenderSpec({ ...p, texts: { ...p.texts, subtitles: false } }, { video: 'v', output: 'o' }).clips[0].words, undefined);
  // Rognage : le texte reste au même endroit du stream, ce qui sort du clip n'est plus rendu.
  p = m.updateClip(p, 'k', { start: 37 });
  assert.deepEqual(m.clipWordsForRender(p.clips[0]).map((w) => w.text), ['50', 'Raze!']);
  // Aperçu : la ligne et le mot prononcé.
  assert.deepEqual(m.subtitleAt(p.clips[0], 41.6), { words: ['50', 'Raze!'], current: 1 });
  assert.equal(m.subtitleAt(p.clips[0], 38), null);
  // Jamais générés : le moteur s'en charge.
  assert.equal(m.clipWordsForRender(m.createProject({ clips: [{ start: 0, end: 5 }] }).clips[0]), undefined);
});

test('marge : allonger au-delà du découpage de départ, aimant sur les phrases', () => {
  const speech = [[90, 95.5], [101, 104], [290, 310]];
  let p = m.trimClip(base(), 'a', 'start', -10);                  // la vidéo continue avant le clip
  assert.strictEqual(p.clips[0].start, 86);
  p = m.trimClip(base(), 'a', 'end', 2.1, speech);               // 104.1 : collé à la fin de phrase (104.2)
  assert.strictEqual(p.clips[0].end, 104.2);
  p = m.trimClip(base(), 'a', 'start', -0.5, speech);            // 95.5 : rien d'assez près → pas d'aimant
  assert.strictEqual(p.clips[0].start, 95.5);
  p = m.trimClip(base(), 'a', 'start', 0.5, speech);             // sans BPM seulement : avec BPM, la grille gagne
  assert.strictEqual(p.clips[0].start, 96.5);
});

test('ajuster aux phrases', () => {
  const speech = [[90, 95.5], [101, 104], [280, 320]];
  const p = base();
  assert.deepStrictEqual(m.cutsSentence(p.clips[0], speech), { start: false, end: true });
  const q = m.fitToSentences(p, 'a', speech);
  assert.deepStrictEqual([q.clips[0].start, q.clips[0].end], [96, 104.2]);
  const r = m.fitToSentences(p, 'b', speech);                     // phrase de 40 s : on ne bouge pas de 16 s
  assert.deepStrictEqual([r.clips[1].start, r.clips[1].end], [296, 305]);
  assert.deepStrictEqual(m.cutsSentence(p.clips[0], null), { start: false, end: false });
});

test("répliques des coéquipiers : affichées, modifiées, ajoutées, placées", () => {
  let p = m.createProject({ streamDuration: 3600, clips: [{ id: 'a', start: 100, end: 120,
    voices: [{ agent: 'v1', name: 'Viper', start: 105, end: 106, text: 'oui oui', on: false, auto: true }] }] });
  let c = p.clips[0];
  assert.equal(m.voiceAt(c, 105.5), null);                          // pas cochée : rien à l'écran
  p = m.setVoice(p, 'a', 0, { on: true });
  c = p.clips[0];
  assert.deepEqual(m.voiceShown(c, c.voices[0]), { start: 104.8, end: 107.3 }); // au moins 2,5 s
  assert.equal(m.voiceAt(c, 105.5).name, 'Viper');
  assert.equal(m.voiceAt(c, 108), null);
  p = m.setVoice(p, 'a', 0, { text: '   ' });
  assert.equal(m.voiceAt(p.clips[0], 105.5), null);                 // texte vide : rien
  p = m.addVoice(p, 'a', 119.5, { uuid: 'r1', name: 'Reyna' });      // ne sort pas du clip
  const v = p.clips[0].voices[1];
  assert.deepEqual([v.agent, v.start, v.end, v.on, v.auto], ['r1', 119, 120, true, false]);
  p = m.removeVoice(p, 'a', 0);
  assert.deepEqual(p.clips[0].voices.map((x) => x.name), ['Reyna']);
  const pl = m.voicePlacement('9x16', 'cam_top', 2);
  assert.equal(pl.agent.y + Math.round(pl.agent.w * 2), 1920);       // collé en bas de l'image
  assert.ok(pl.text.y >= 640);                                       // texte sous la cam
  assert.ok(m.voicePlacement('16x9', 'cam_top').agent.x > 960);      // 16:9 : agent à droite
});

test("aperçu d'un moment sans l'ajouter : même découpe, mise en page du clip qui le contient", () => {
  const p = base();
  const m = { type: 'laugh', t: 543, meta: {} };
  const m_peek = require('../src/renderer/editor-model').peekProject;
  const peek = m_peek(p, m, [{ start: 540, end: 550, layout: 'cam_full', focus: { x: 0.4, y: 0.5 } }]);
  assert.strictEqual(peek.clips.length, 1);
  assert.deepStrictEqual([peek.clips[0].start, peek.clips[0].end, peek.clips[0].layout], [513, 551, 'cam_full']);
  assert.strictEqual(p.clips.length, 3);                       // le montage n'a pas bougé
});

test('moments retirés de la liste : retirés, gardés dans le projet, remis', () => {
  const mm = require('../src/renderer/editor-model');
  const k = { type: 'laugh', t: 543.04 };
  let p = mm.hideMoment(base(), k);
  assert.ok(mm.isMomentHidden(p, k));
  assert.ok(!mm.isMomentHidden(p, { type: 'kill', t: 543.04 }));
  assert.ok(mm.isMomentHidden(JSON.parse(JSON.stringify(p)), { type: 'laugh', t: 543.0 }));   // relu depuis le fichier
  p = mm.hideMoment(p, k, false);
  assert.ok(!mm.isMomentHidden(p, k));
  assert.strictEqual(p.clips.length, 3);
});

test('contexte autour des moments : 30 s avant, multi-kill depuis le 1er kill, clip viewer avant sa création', () => {
  const w = (mo) => { const x = m.momentWindow(mo); return [x.start, x.end]; };
  assert.deepStrictEqual(w({ type: 'laugh', t: 600 }), [570, 608]);
  // live du 26/11 : kills à 19:44, 20:03 et 20:09 (multi-kill ×3)
  assert.deepStrictEqual(w({ type: 'multikill', t: 1208.75, meta: { t_start: 1183.75 } }), [1173.75, 1216.75]);
  assert.deepStrictEqual(w({ type: 'viewer_clip', t: 1318 }), [1293, 1326]);
});

test('couper un clip en deux à la tête de lecture', () => {
  let p = m.createProject({ clips: [{ start: 100, end: 130, layout: 'cam_full', moments: [{ type: 'kill', t: 105 }, { type: 'laugh', t: 125 }],
    voices: [{ start: 110, end: 112, text: 'go' }], chat: [{ t: 120, user: 'a', text: 'lol' }] }] });
  const id = p.clips[0].id;
  assert.strictEqual(m.splitClip(p, id, 100.5), p);              // morceau trop court : rien
  p = m.splitClip(p, id, 115);
  assert.strictEqual(p.clips.length, 2);
  const [a, b] = p.clips;
  assert.deepStrictEqual([a.start, a.end, b.start, b.end], [100, 115, 115, 130]);
  assert.notStrictEqual(a.id, b.id);
  assert.strictEqual(b.layout, 'cam_full');
  assert.deepStrictEqual([a.moments.map((x) => x.type), b.moments.map((x) => x.type)], [['kill'], ['laugh']]);
  assert.deepStrictEqual([a.voices.length, b.voices.length, a.chat.length, b.chat.length], [1, 0, 0, 1]);
  assert.strictEqual(m.totalDuration(p), 30);
});

test('sous-titres : décocher une ligne la cache (aperçu et export), le texte est gardé', () => {
  const w = (s, e, text) => ({ start: s, end: e, text });
  let p = m.createProject({ clips: [{ start: 100, end: 110,
    subs: [{ start: 101, end: 102, words: [w(101, 102, 'salut')] }, { start: 105, end: 106, words: [w(105, 106, 'oups')] }] }] });
  const id = p.clips[0].id;
  p = m.setLineOn(p, id, 1, false);
  assert.deepStrictEqual(m.clipWordsForRender(p.clips[0]).map((x) => x.text), ['salut']);
  assert.strictEqual(m.subtitleAt(p.clips[0], 105.5), null);
  assert.strictEqual(p.clips[0].subs[1].words[0].text, 'oups');
  p = m.setLineOn(p, id, null, false);
  assert.deepStrictEqual(m.clipWordsForRender(p.clips[0]), []);      // [] et pas undefined : le moteur ne les refait pas
  p = m.setLineOn(p, id, null, true);
  assert.strictEqual(m.clipWordsForRender(p.clips[0]).length, 2);
});
