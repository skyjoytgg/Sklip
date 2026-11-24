# Sklip

Montage automatique des moments forts de tes streams Twitch Valorant.
Le cahier des charges complet est dans le projet Claude « Clip Montage ».

**Règle n° 1 : Sklip ne modifie jamais OBS.** Il observe OBS en lecture seule (obs-websocket) :
aucune scène, source, piste, aucun format ou dossier d'enregistrement n'est touché.
Toutes les requêtes envoyées à OBS passent par une liste blanche (`app/src/main/obs-watcher.js`).

## Organisation

```
sklip/
├── vods/                       ← VOD de test (non envoyées sur GitHub)
├── app/                        ← l'appli Windows (Electron + React)
│   ├── src/main/
│   │   ├── obs-watcher.js      ← OBS en lecture seule + liste blanche
│   │   ├── twitch.js           ← « Se connecter avec Twitch », API, EventSub (raids, chat, live)
│   │   ├── twitch-moments.js   ← raids, peaks, pics de chat, !clip, clips viewers → moments
│   │   ├── engine-bridge.js    ← lance le moteur Python
│   │   ├── settings.js
│   │   └── main.js
│   ├── src/renderer/
│   │   ├── editor.jsx          ← éditeur de montage (timeline, mixeur, aperçu)
│   │   ├── editor-model.js     ← logique de l'éditeur (testée)
│   │   └── app.jsx             ← Accueil, Montage, Historique, Réglages
│   ├── scripts/write-config.js ← injecte le Client ID Twitch au moment de la publication
│   └── test/
├── engine/                     ← moteur Python
│   ├── sklip_engine/
│   │   ├── moments.py, selection.py   ← moments, scores, thèmes, choix des clips
│   │   ├── audio_sync.py              ← calage des pistes Sklip sur la vidéo OBS
│   │   ├── beat.py                    ← BPM, grille rythmique, métronome
│   │   ├── overlays.py                ← sous-titres mot par mot, « ACE », compteur de kills, pseudo
│   │   ├── render.py                  ← rendu FFmpeg 16:9 / 9:16, mix 4 pistes, encodeur GPU auto
│   │   ├── stream_folder.py           ← dossier du stream + stats.html
│   │   └── fonts/                     ← police Montserrat (licence OFL)
│   ├── setup-dev.bat           ← prépare Python 3.13 avec uv
│   ├── build.bat               ← construit sklip-engine.exe (PyInstaller)
│   └── tests/
└── .github/workflows/release.yml  ← tag « v0.2.0 » → installeur publié sur GitHub
```

## Lancer en développement (Windows)

Déjà installés sur le PC de Sky : Node.js 24, Python 3.15, uv, Git, OBS, FFmpeg 9.1.

```bat
cd engine
setup-dev.bat          :: crée un Python 3.13 rien que pour Sklip et lance les tests

cd ..\app
npm install
npm test
npm start
```

Le moteur utilise Python 3.13 (dans `engine\.venv`), car certaines bibliothèques (OpenCV, faster-whisper)
ne sont pas toujours disponibles tout de suite pour la toute dernière version de Python.

Dans OBS : **Outils → Paramètres du serveur WebSocket** → cocher « Activer le serveur WebSocket ».
C'est le seul réglage à faire, et c'est le streamer qui le fait lui-même.

## Publier une version (installeur + mises à jour automatiques)

1. Mettre le code sur GitHub : dépôt `skyjoytgg/sklip`.
2. Dans le dépôt : **Settings → Secrets and variables → Actions → Variables** → ajouter `SKLIP_TWITCH_CLIENT_ID`.
3. Pousser un tag : `git tag v0.2.0 && git push --tags`.
   GitHub construit `Sklip-Setup-0.2.0.exe` (moteur + FFmpeg inclus) et le publie.
   Les potes l'installent une fois ; ensuite Sklip se met à jour tout seul au lancement.

L'installeur n'est pas signé : Windows affichera « Windows a protégé votre ordinateur »
→ **Informations complémentaires → Exécuter quand même**. Une signature de code payante enlève ce message.

## État d'avancement

Fait :
- OBS en lecture seule (tests : aucune requête de modification ne part) ;
- moments, thèmes, sélection 15–60 s, calage BPM ;
- synchronisation des pistes audio séparées ;
- rendu 16:9 / 9:16, 4:3 étirée, mix 4 pistes, musique coupée par défaut, NVENC / AMF / QSV / x264 ;
- sous-titres style TikTok (mot prononcé en couleur), textes « ACE », compteur de kills, pseudo, fondus ;
- éditeur : glisser-déposer, rognage (calé sur le BPM si choisi), ajout / retrait de moments,
  mixeur global et par clip, mise en page par clip, aperçu, export ;
- Twitch : connexion par code (sans mot de passe ni secret), raids, viewers, chat, `!clip`, clips des viewers ;
- installeur Windows + mises à jour via GitHub Releases.

À faire ensuite :
1. Détection des kills / aces / clutchs à l'image (calibrage sur les VOD de Sky).
2. Capture audio par application (module natif WASAPI) pendant le stream.
3. Rires et cris, morts drôles, raccourci clavier et Stream Deck pour les marqueurs.
4. Relier le tout : fin du live → analyse → éditeur ouvert avec les clips proposés.
