const test = require('node:test');
const assert = require('node:assert');
const { isBot, cleanChatText, isViewerMessage } = require('../src/main/chat-bots');
const M = require('../src/renderer/editor-model');

test('chat : bots et commandes jamais proposés en bulle, « /me » nettoyé', () => {
  assert.ok(isBot('WizeBot') && isBot('nightbot') && isBot('Mon_Bot') && !isBot('Lilacassette'));
  assert.strictEqual(cleanChatText('\u0001ACTION 🚀 Level UP\u0001'), '🚀 Level UP');
  assert.ok(!isViewerMessage({ user: 'kamel', text: '!discord' }));
  assert.ok(isViewerMessage({ user: 'kamel', text: 'trop fort' }));
  const chat = [{ t: 95, user: 'WizeBot', text: '\u0001ACTION Level UP\u0001' }, { t: 96, user: 'kamel', text: '\u0001ACTION danse\u0001' }];
  assert.deepStrictEqual(M.chatNear(chat, { start: 96, end: 102 }).map((m) => [m.user, m.text]), [['kamel', 'danse']]);
});
