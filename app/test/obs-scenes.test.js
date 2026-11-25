const test = require('node:test');
const assert = require('node:assert');
const { itemRect, readCam, readScenes, guessType } = require('../src/main/obs-scenes');

const T = (o) => ({ sourceWidth: 1920, sourceHeight: 1080, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', ...o });

test('position d’une source : échelle, recadrage, alignement, boîte', () => {
  assert.deepStrictEqual(itemRect(T({ positionX: 0, positionY: 0, scaleX: 0.25, scaleY: 0.25 })), { x: 0, y: 0, w: 480, h: 270 });
  assert.deepStrictEqual(itemRect(T({ positionX: 100, positionY: 50, cropLeft: 320, cropRight: 320, scaleX: 0.5, scaleY: 0.5 })),
    { x: 100, y: 50, w: 640, h: 540 });
  assert.deepStrictEqual(itemRect(T({ positionX: 960, positionY: 540, alignment: 0, scaleX: 0.5, scaleY: 0.5 })), { x: 480, y: 270, w: 960, h: 540 });
  // Boîte 800x800 « adapter à l'intérieur » : la webcam 16:9 est centrée dedans.
  assert.deepStrictEqual(itemRect(T({ positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 800, boundsHeight: 800 })),
    { x: 0, y: 175, w: 800, h: 450 });
});

// Faux OBS : scène Valorant (cam en haut à gauche) et scène Just Chatting (cam en grand dans une scène imbriquée).
function fakeObs(current) {
  const calls = [];
  const scenes = {
    Valorant: [
      { sourceName: 'Jeu', inputKind: 'game_capture', sceneItemTransform: T({}) },
      { sourceName: 'Webcam', inputKind: 'dshow_input', sceneItemTransform: T({ positionX: 0, positionY: 0, scaleX: 0.22, scaleY: 0.3 }) },
      { sourceName: 'Cam cachée', inputKind: 'dshow_input', sceneItemEnabled: false, sceneItemTransform: T({ scaleX: 1, scaleY: 1 }) },
    ],
    'Just Chatting': [
      { sourceName: 'Fond', inputKind: 'image_source', sceneItemTransform: T({}) },
      { sourceName: 'Cam', sourceType: 'OBS_SOURCE_TYPE_SCENE', inputKind: null, sceneItemTransform: T({ positionX: 240, positionY: 0, scaleX: 0.75, scaleY: 1 }) },
    ],
    Cam: [{ sourceName: 'Webcam', inputKind: 'dshow_input', sceneItemTransform: T({}) }],
    Pause: [{ sourceName: 'Image', inputKind: 'image_source', sceneItemTransform: T({}) }],
  };
  const list = [{ sceneName: 'Pause', sceneIndex: 0 }, { sceneName: 'Valorant', sceneIndex: 1 }, { sceneName: 'Just Chatting', sceneIndex: 2 }];
  return {
    calls,
    request: async (type, data) => {
      calls.push(type);
      if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: current };
      if (type === 'GetVideoSettings') return { baseWidth: 1920, baseHeight: 1080 };
      if (type === 'GetSceneList') return { scenes: list };
      return { sceneItems: scenes[data.sceneName] || [] };
    },
  };
}

test('webcam demandée à OBS, scène par scène (lecture seule) + type de scène deviné ou choisi', async () => {
  const v = await readCam(fakeObs('Valorant'));
  assert.deepStrictEqual(v, { scene: 'Valorant', cam: { x: 0, y: 0, w: 0.22, h: 0.3 }, full: false, type: 'jeu', guess: 'jeu' });
  const jc = fakeObs('Just Chatting');
  const j = await readCam(jc);
  assert.deepStrictEqual(j, { scene: 'Just Chatting', cam: { x: 0.125, y: 0, w: 0.75, h: 1 }, full: true, type: 'discussion', guess: 'discussion' });
  assert.ok(jc.calls.every((c) => c.startsWith('Get')));
  assert.deepStrictEqual(await readCam(fakeObs('Pause')), { scene: 'Pause', cam: null, full: false, type: 'pause', guess: 'pause' });
  // Le choix du streamer passe avant la devinette.
  assert.strictEqual((await readCam(fakeObs('Valorant'), { Valorant: 'discussion' })).type, 'discussion');
});

test('liste des scènes d’OBS dans l’ordre d’OBS, avec le type deviné et le choix du streamer', async () => {
  const obs = fakeObs('Valorant');
  const scenes = await readScenes(obs, { Pause: 'discussion' });
  assert.deepStrictEqual(scenes.map((s) => [s.name, s.guess, s.type, s.chosen]),
    [['Just Chatting', 'discussion', 'discussion', false], ['Valorant', 'jeu', 'jeu', false], ['Pause', 'pause', 'discussion', true]]);
  assert.ok(obs.calls.every((c) => c.startsWith('Get')));
  assert.strictEqual(guessType(0.05, 0.9), 'jeu');        // jeu plein écran + petite cam
  assert.strictEqual(guessType(0.5, 0.3), 'discussion');  // grande cam, jeu en petit
  assert.strictEqual(guessType(0.3, 0), 'discussion');
  assert.strictEqual(guessType(0, 0), 'pause');
});
