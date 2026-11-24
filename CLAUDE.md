# Sklip — instructions pour Claude Code

Tu reprends le projet **Sklip** de Sky, commencé dans une conversation Claude (projet « Clip Montage »).
Lis d'abord `docs/HISTORIQUE.md` (tout ce qui a été dit et décidé) puis `docs/CAHIER-DES-CHARGES.md`.

## Qui, quoi
- Sky streame Valorant sur Twitch (chaîne avec VOD « VALO CHILL », « RANKED PLAT NEON »…). Pseudo GitHub : `skyjoytgg`.
- Sklip = appli Windows gratuite, d'abord pour Sky et ses potes streamers : elle repère les moments forts
  d'un stream (kills, aces, clutchs, raids, peaks, chat, rires…), monte automatiquement des vidéos courtes
  (15–60 s, 16:9 et 9:16) par thème, puis le streamer ajuste dans un éditeur à timeline.
- **Toujours répondre en français**, simplement, sans jargon inutile. Sky n'est pas développeur de métier :
  explique ce qu'il doit faire en étapes concrètes (quoi cliquer, quoi coller).

## Règles non négociables
1. **Sklip ne modifie JAMAIS OBS** (profil, scènes, sources, pistes audio, format/dossier d'enregistrement,
   raccourcis). OBS est observé en lecture seule via obs-websocket, avec une liste blanche de requêtes
   (`app/src/main/obs-watcher.js`). Seule exception, en option : appuyer sur « Démarrer/Arrêter
   l'enregistrement » avec les réglages du streamer, et n'arrêter que l'enregistrement lancé par Sklip.
   Les tests vérifient qu'aucune requête de modification ne part : garde-les verts.
2. Les pistes audio séparées (jeu, micro, Discord, musique) sont capturées **par Sklip lui-même**,
   puis calées sur la vidéo OBS (`engine/sklip_engine/audio_sync.py`).
3. L'enregistrement OBS original n'est jamais supprimé ni déplacé.
4. Musique coupée par défaut à l'export (droits d'auteur), Discord actif par défaut.
5. Interface en français, thème sombre gaming, accent violet Twitch `#9146FF`.

## Environnement du PC de Sky (vérifié le 24/11/2026)
- Windows 11, Node.js 24.22, Python 3.15 (système), **uv** installé, Git, OBS Studio, FFmpeg 9.1 (winget Gyan.FFmpeg).
- Le moteur utilise **Python 3.13** dans `engine\.venv` (créé par `engine\setup-dev.bat` avec uv),
  car OpenCV / faster-whisper peuvent ne pas exister encore pour Python 3.15. Ne touche pas au Python 3.15.
- Webcam de Sky : en haut à gauche de l'image (réglage par défaut `cam` dans `app/src/main/settings.js`).
- VOD de test : `vods/` (dans ce dossier, ignoré par git). Ce sont des VOD Twitch téléchargées ;
  certaines ont des passages « Son coupé » par Twitch (musique) → ne pas compter sur l'audio pour calibrer.

## Twitch
- Application Twitch Developer « Sklip », URL de redirection `http://localhost`, type de client **Public**.
- Client ID : `88d0w53zc9hsemjvt486ekjgmkep9k` (pas un secret : client public, pas de secret client).
  Il est dans `app/config.json` ; pour les releases GitHub, variable de dépôt `SKLIP_TWITCH_CLIENT_ID`.
- Connexion par Device Code Flow (`app/src/main/twitch.js`), jetons chiffrés avec safeStorage.

## Commandes
```bat
cd engine && setup-dev.bat            :: Python 3.13 + dépendances + tests du moteur
cd app && npm install && npm test     :: tests de l'appli
cd app && npm start                   :: lance Sklip (Electron)
```
Publication : tag `vX.Y.Z` poussé sur `skyjoytgg/sklip` → GitHub Actions construit l'installeur
(`.github/workflows/release.yml`) et le publie ; electron-updater met à jour les PC au lancement.

## Prochaine étape prioritaire
**Détection des kills / aces / clutchs à l'image** sur les VOD de `vods/`
(voir « À faire » dans `docs/HISTORIQUE.md`). Ensuite : capture audio WASAPI, rires/cris,
raccourci marqueur + Stream Deck, puis relier fin du live → analyse → éditeur.

## Manière de travailler avec Sky
- Pose des questions avant les choix importants (il l'a demandé explicitement).
- Teste ce que tu écris (pytest, `node --test`), regarde le résultat visuel quand c'est de l'interface ou de la vidéo.
- Ne commit / push que quand Sky le demande.
