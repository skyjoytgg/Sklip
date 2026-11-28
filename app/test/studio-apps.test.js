const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../src/main/studio-apps');

test('appli TikTok du PC trouvée dans le menu Démarrer (pas TikTok LIVE Studio)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklip-start-'));
  fs.mkdirSync(path.join(root, 'Applications Chrome'));
  for (const n of ['Applications Chrome/TikTok.lnk', 'TikTok LIVE Studio.lnk', 'OBS Studio.lnk']) fs.writeFileSync(path.join(root, n), '');
  const links = S.startMenuLinks([root, path.join(root, 'absent')]);
  assert.strictEqual(path.basename(S.pickShortcut(links, 'tiktok')), 'TikTok.lnk');
  assert.strictEqual(S.pickShortcut(links, 'youtube'), null);
  assert.strictEqual(S.pickShortcut([...links, path.join(root, 'TikTok Studio.lnk')], 'tiktok'), path.join(root, 'TikTok Studio.lnk'));
});

test("appli web Chrome : ouverte directement sur la page d'envoi", () => {
  const link = { target: String.raw`C:\Program Files\Google\Chrome\Application\chrome_proxy.exe`,
    args: '--profile-directory="Profile 1" --app-id=nlalbmkafgmoifbeooblidblkmlhhpnc' };
  assert.deepStrictEqual(S.launchCommand(link, S.SITES.tiktok.url), { file: link.target, args: [
    '--profile-directory=Profile 1', '--app-id=nlalbmkafgmoifbeooblidblkmlhhpnc',
    '--app-launch-url-for-shortcuts-menu-item=https://www.tiktok.com/tiktokstudio/upload'] });
  assert.strictEqual(S.launchCommand({ target: String.raw`C:\x\tiktok.exe`, args: '' }, 'u'), null);       // pas une appli web : le site
  assert.strictEqual(S.launchCommand({ target: link.target, args: '--profile-directory=Default' }, 'u'), null);
});
