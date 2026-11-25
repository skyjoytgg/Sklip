// Test du PC : faut-il faire l'analyse et les clips pendant le live, ou après ?
// Rien n'est modifié sur le PC : on lit seulement des infos (processeur, RAM, carte graphique, logiciels ouverts).

const os = require('node:os');
const { execFile } = require('node:child_process');

const GAME_EXES = ['VALORANT-Win64-Shipping.exe'];
const OBS_EXES = ['obs64.exe', 'obs32.exe'];
// Charge supposée du jeu + OBS quand ils ne sont pas ouverts pendant le test (en % de tout le processeur).
const ASSUMED_GAME_LOAD = 55;
const HW_ENCODERS = { h264_nvenc: 'NVIDIA (NVENC)', h264_amf: 'AMD (AMF)', h264_qsv: 'Intel (Quick Sync)' };

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10000 }, (err, out) => resolve(err ? '' : String(out)));
  });
}

async function runningExes() {
  if (process.platform !== 'win32') return [];
  const out = await run('tasklist', ['/fo', 'csv', '/nh']);
  return out.split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, '')).filter(Boolean);
}

async function gpuNames() {
  if (process.platform !== 'win32') return [];
  const out = await run('powershell', ['-NoProfile', '-Command',
    '(Get-CimInstance Win32_VideoController).Name']);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Charge moyenne du processeur (0–100 %) mesurée pendant `ms` millisecondes. */
function cpuLoad(ms = 2000) {
  const snap = () => os.cpus().map((c) => c.times);
  const a = snap();
  return new Promise((resolve) => setTimeout(() => {
    const b = snap();
    let idle = 0; let total = 0;
    b.forEach((t, i) => {
      const d = (k) => t[k] - a[i][k];
      idle += d('idle');
      total += d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    });
    resolve(total ? Math.round(100 * (1 - idle / total)) : 0);
  }, ms));
}

async function systemInfo() {
  const exes = (await runningExes()).map((e) => e.toLowerCase());
  const has = (list) => list.some((e) => exes.includes(e.toLowerCase()));
  return {
    cpu: (os.cpus()[0] || {}).model?.trim() || 'Inconnu',
    cores: os.cpus().length,
    ramGB: Math.round(os.totalmem() / 2 ** 30),
    freeRamGB: Math.round(os.freemem() / 2 ** 30 * 10) / 10,
    gpus: await gpuNames(),
    gameRunning: has(GAME_EXES),
    obsRunning: has(OBS_EXES),
    load: await cpuLoad(),
  };
}

/**
 * Verdict à partir des mesures. Pur (testable) :
 * - speed : vitesse d'analyse d'un seul processus, en « fois le temps réel » ;
 * - load : charge du processeur pendant le test ; si le jeu n'était pas ouvert, on suppose qu'il en prendra ASSUMED_GAME_LOAD.
 * Renvoie { verdict: 'live' | 'limite' | 'apres', mode, projected, reasons[] }.
 */
function verdict({ speed, cores, ramGB, freeRamGB, load, gameRunning, obsRunning, encoder }) {
  const reasons = [];
  const hw = HW_ENCODERS[encoder];
  // Analyse en direct : 4 images/s, un processus → occupe 1/speed d'un cœur.
  const analysis = speed > 0 ? 100 / (speed * cores) : 100;
  // Fabriquer les clips pendant le live : léger avec l'encodeur de la carte graphique, lourd sans.
  const render = hw ? 4 : Math.min(40, 400 / cores);
  const base = gameRunning ? load : Math.max(load, ASSUMED_GAME_LOAD);
  const projected = Math.round(base + analysis + render);

  if (!gameRunning) reasons.push(`Valorant n'était pas ouvert : on a supposé qu'il prendrait ~${ASSUMED_GAME_LOAD} % du processeur.`);
  if (gameRunning && !obsRunning) reasons.push("OBS n'était pas ouvert pendant le test : le résultat est un peu optimiste.");
  reasons.push(`Analyse : ${speed.toFixed(1)}× plus rapide que le temps réel (${analysis < 1 ? 'moins de 1' : Math.round(analysis)} % du processeur en plus pendant le live).`);
  reasons.push(hw ? `Les clips sont encodés par la carte graphique ${hw} : presque rien sur le processeur.`
    : 'Pas d\'encodeur sur la carte graphique : les clips sont encodés par le processeur (lourd).');
  if (ramGB < 16) reasons.push(`${ramGB} Go de RAM : un peu juste pour jouer, streamer et analyser en même temps (16 Go conseillés).`);
  reasons.push(`Charge estimée pendant un live : ${Math.min(projected, 100)} % du processeur.`);

  let v = 'apres';
  if (speed >= 3 && projected <= 75 && ramGB >= 16 && freeRamGB >= 3) v = 'live';
  else if (speed >= 1.5 && projected <= 90 && ramGB >= 12) v = 'limite';
  return { verdict: v, mode: v === 'live' ? 'live' : 'end_of_stream', projected, reasons };
}

module.exports = { systemInfo, verdict, cpuLoad, ASSUMED_GAME_LOAD };
