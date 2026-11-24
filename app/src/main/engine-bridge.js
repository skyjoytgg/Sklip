// Pont entre l'appli et le moteur Python (sklip_engine).
// En dev : `python -m sklip_engine`. Une fois installé : l'exécutable PyInstaller dans resources/engine.

const { spawn } = require('node:child_process');
const path = require('node:path');

function engineCommand({ packaged, resourcesPath, devEngineDir }) {
  if (packaged) {
    return { cmd: path.join(resourcesPath, 'engine', 'sklip-engine.exe'), args: [], cwd: undefined };
  }
  // Python 3.13 de l'environnement préparé par engine/setup-dev.bat, sinon le Python du système.
  const venv = process.platform === 'win32'
    ? path.join(devEngineDir, '.venv', 'Scripts', 'python.exe')
    : path.join(devEngineDir, '.venv', 'bin', 'python');
  const python = require('node:fs').existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3');
  return { cmd: python, args: ['-m', 'sklip_engine'], cwd: devEngineDir };
}

/**
 * Lance une commande du moteur. `onProgress({fraction, message})` reçoit l'avancement.
 * Le moteur tourne en priorité basse pour ne pas faire baisser les FPS pendant le stream.
 */
function runEngine(location, command, params = {}, onProgress) {
  const { cmd, args, cwd } = engineCommand(location);
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    if (location.packaged) {
      // FFmpeg est livré avec l'installeur : on le met en tête du PATH du moteur.
      env.PATH = `${path.join(location.resourcesPath, 'ffmpeg')}${path.delimiter}${env.PATH || ''}`;
    }
    const child = spawn(cmd, [...args, command], { cwd, env, windowsHide: true });
    try { require('node:os').setPriority(child.pid, 10); } catch { /* pas bloquant */ }
    let buffer = '';
    let result = null;
    let error = null;
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'progress' && onProgress) onProgress(msg);
        else if (msg.type === 'result') result = msg.data;
        else if (msg.type === 'error') error = new Error(msg.message);
      }
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (error) reject(error);
      else if (code !== 0 || result === null) reject(new Error(`Moteur Sklip : échec (${code}) ${stderr.slice(-500)}`));
      else resolve(result);
    });
    child.stdin.end(JSON.stringify(params));
  });
}

module.exports = { runEngine, engineCommand };
