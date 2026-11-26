# Sklip — historique de la conversation et état du projet

Ce fichier remplace la conversation Claude d'origine (projet « Clip Montage »), pour reprendre le travail
dans Claude Code sans rien perdre. Dernière mise à jour : 24/11/2026, 22 h 35.

---

## 1. L'idée de départ (demande initiale de Sky, conversation sur téléphone)

> « Je voudrais créer une appli ou quelque chose comme ça pour mon PC qui récupère les moments importants
> de mon stream Twitch, comme par exemple les raids, les peaks de viewers, mais aussi chaque kill que je
> fais sur Valorant, mais aussi les aces etc., et que je donne un thème, par exemple "kills" ou
> "moments drôles", et que le montage se fasse tout seul, puis que je regarde et valide ou modifie en
> déplaçant les différents clips. »

Cette première conversation (sur téléphone) a fixé le cahier des charges complet : voir
`docs/CAHIER-DES-CHARGES.md`. Décisions principales prises à ce moment-là :
- nom **Sklip** ; appli Windows clé en main, **gratuite**, d'abord pour Sky et ses potes streamers ;
- **OBS Studio uniquement** ; **Valorant uniquement** (passages hors Valorant repérés automatiquement,
  utiles pour les thèmes Drôle et Communauté) ;
- interface **en français**, design sombre gaming, accent violet Twitch ;
- **tout le périmètre en v1** ;
- montages **courts, 15 à 60 s** ; découpe **≈ 4 s avant / 2 s après** chaque moment ;
- formats **16:9 et 9:16** (9:16 par défaut : cam en haut, jeu en bas ; modifiable par clip) ;
- **sous-titres auto** style TikTok mot par mot, en français ; textes à l'écran (ACE, compteur, pseudo)
  désactivés par défaut ;
- musique : soit un morceau de la bibliothèque (coupes calées sur le BPM détecté), soit **sans musique
  calée sur un BPM choisi** (métronome d'aperçu, BPM dans le nom du fichier, 1re coupe sur le temps 1,
  musique ajoutée ensuite dans TikTok Studio) ;
- 5 pistes audio (mix, jeu, micro, Discord, musique), mixeur 4 pistes dans l'éditeur, Discord actif par
  défaut, **musique coupée par défaut à l'export** (droits d'auteur) ;
- un **dossier par stream** (`Sklip/Streams/AAAA-MM-JJ_titre/` avec `stats.html`, `moments/`, `montages/`)
  + écran **Historique** ;
- analyse au choix : auto à la fin du live / pendant le live (PC puissants, priorité basse) / manuelle ;
  test de performances au premier lancement pour proposer le mode ;
- marqueurs manuels : raccourci clavier (marche en jeu), `!clip` (streamer + modos), Stream Deck ;
- peaks de viewers : critère au choix (record du stream, montée rapide +X % en N minutes, seuil fixe) ;
- pics de chat : emotes de base + liste perso de mots-clés par streamer (« mdr », « ptdr »…) ;
- export = fichier sur le PC + ouverture du dossier, **pas de publication automatique** ;
- mises à jour **automatiques au lancement** via GitHub ; Sklip **ne se lance pas avec Windows** ;
- multi-streamers : toutes résolutions (dont 4:3 étirée), tous GPU (NVIDIA / AMD / Intel / CPU),
  position de webcam réglable.

## 2. Conversation sur PC (24/11/2026, soir)

### 20 h 11 — reprise sur PC
Sky demande si Claude a la conversation du téléphone → oui via le cahier des charges du projet et la mémoire.

### 20 h 12 — nouvelle exigence importante
> « Je voudrais aussi que quand le streamer lance ce clip, ça lui change pas ses paramètres OBS, les pistes, etc. »

Conséquences (cahier des charges mis à jour) :
- plus d'assistant qui reconfigure OBS (avant, Sklip devait créer les 5 pistes dans OBS) ;
- OBS en **lecture seule** via obs-websocket + **liste blanche** de requêtes ;
- option « Lancer l'enregistrement OBS au début du live » : appuie seulement sur le bouton, avec les
  réglages du streamer ; n'arrête que l'enregistrement qu'il a lui-même lancé ;
- **pistes séparées capturées par Sklip lui-même** (capture audio par application Windows : VALORANT,
  Discord, lecteur de musique + micro choisi dans Sklip), puis **synchronisées** sur la vidéo OBS par
  corrélation audio ;
- si le streamer a déjà des pistes séparées dans son enregistrement, Sklip peut les utiliser ;
- limite acceptée : sans Sklip ouvert pendant le live (VOD seule), seul le mix est disponible ;
- l'enregistrement OBS original n'est jamais supprimé ni déplacé.

### 20 h 13 — « tu peux commencer » → version 0.1
Construit et testé : structure du projet, client OBS lecture seule (+ tests), moments / scores / thèmes /
sélection, synchro audio, BPM + métronome, rendu FFmpeg 16:9 / 9:16 (cam en haut / en bas / jeu seul,
4:3 étirée, mix 4 pistes, encodeur GPU auto), dossier de stream + `stats.html`, interface
(Accueil, Historique, Réglages), pont Electron ↔ moteur Python.

### 22 h 16 — Sky ne va pas live, « pose-moi des questions avant de continuer »
Réponses de Sky :
- travailler sur **les 4** : éditeur de montage, connexion Twitch, sous-titres et textes, installeur Windows ;
- enregistrements pour calibrer : **des VOD Twitch** ;
- outils sur le PC : « je ne sais pas » ;
- comptes : **ni GitHub ni appli Twitch Developer** au départ.

### 22 h 19 — liste des VOD de Sky (capture du Tableau de bord Twitch)
Toutes en 1080p, catégorie VALORANT sauf la dernière :
| Titre | Date | Durée |
|---|---|---|
| SWIFT CHILL | 22/11/2026 | 6:16:35 |
| RANKED PLAT NEON | 18/11/2026 | 3:19:57 |
| ranked plat | 15/11/2026 | 5:23:29 |
| VALO CHILL | 13/11/2026 | 1:57:16 |
| VALO CHILL | 01/11/2026 | 3:45:36 |
| Elles veulent faire un live (Just Chatting) | 01/11/2026 | 0:08:48 |

Conseillées pour calibrer : **VALO CHILL du 13/11** (la plus courte) + **RANKED PLAT NEON du 18/11**.
Constat : plusieurs VOD ont des passages **« Son coupé »** (musique retirée par Twitch) → l'audio des VOD
n'est pas fiable ; la webcam de Sky est **en haut à gauche**.

### 22 h 22 — vérification du PC
Résultats (Claude a regardé les dossiers ; Sky a confirmé dans l'invite de commandes) :
- Node.js **v24.22.0** ✅, Python **3.15.0** ✅ (trop récent pour certaines libs → Python 3.13 via uv pour Sklip),
  **uv** ✅, Git ✅, OBS Studio ✅ ;
- FFmpeg absent → Sky l'a installé : `winget install Gyan.FFmpeg` → **FFmpeg 9.1** ✅
  (rouvrir l'invite de commandes pour que le PATH soit pris en compte).
- Sky a un dossier `C:\projets` (contient aussi « Myst of you ») → Sklip vit dans **`C:\projets\Sklip`**.

### 22 h 16 → 22 h 28 — version 0.2
- **Éditeur de montage** (testé dans un navigateur : glisser-déposer, rognage, ajout de raid, lecture, export).
- **Connexion Twitch** (Device Code Flow, EventSub, Helix) + conversion en moments.
- **Sous-titres TikTok** mot par mot + textes ACE / KILLS / CLUTCH / pseudo (vérifiés sur images rendues).
- **Installeur** : PyInstaller + electron-builder + GitHub Actions + FFmpeg embarqué + mises à jour auto.
- Icône de l'appli (S blanc sur violet + triangle lecture jaune).

### 22 h 29 — comptes de Sky
- GitHub : **`skyjoytgg`** (dépôt prévu : `skyjoytgg/sklip`, déjà mis dans `app/package.json`).
- Appli Twitch Developer **« Sklip »** créée (URL `http://localhost`) ; Client ID :
  **`88d0w53zc9hsemjvt486ekjgmkep9k`** (dans `app/config.json`). Vérifier dans la console Twitch que
  le type de client est bien **Public** (sinon le Device Code Flow sans secret ne marche pas).
- Sky a créé `C:\projets\Sklip\vods` et y a mis les VOD.

### 22 h 33 — passage à Claude Code
Sky veut continuer dans Claude Code « sans rien oublier » → ce fichier + `CLAUDE.md` + le code.

---

## 3. Ce qui est fait (v0.2) — 31 tests moteur + 25 tests appli, tous verts

| Domaine | Fichiers | État |
|---|---|---|
| OBS lecture seule | `app/src/main/obs-watcher.js` | ✅ testé avec un faux OBS (pas encore sur le vrai OBS) |
| Réglages | `app/src/main/settings.js` | ✅ |
| Pont appli ↔ moteur | `app/src/main/engine-bridge.js`, `engine/sklip_engine/__main__.py` | ✅ testé (commandes JSON) |
| Moments, thèmes, sélection | `engine/sklip_engine/moments.py`, `selection.py` | ✅ |
| Synchro des pistes | `engine/sklip_engine/audio_sync.py` | ✅ (précision ~1 ms sur signaux de test) |
| BPM, grille, métronome | `engine/sklip_engine/beat.py` | ✅ |
| Rendu | `engine/sklip_engine/render.py` | ✅ (x264 testé ; NVENC/AMF/QSV détectés automatiquement, non testés ici) |
| Sous-titres et textes | `engine/sklip_engine/overlays.py` + `fonts/Montserrat.ttf` (OFL) | ✅ incrustation ; transcription faster-whisper écrite mais **non testée** (pas installable dans l'environnement de Claude) |
| Dossier de stream | `engine/sklip_engine/stream_folder.py` | ✅ |
| Éditeur | `app/src/renderer/editor.jsx`, `editor-model.js` | ✅ testé en navigateur avec données d'exemple |
| Twitch | `app/src/main/twitch.js`, `twitch-moments.js` | ✅ testé avec de faux serveurs ; **pas encore testé sur le vrai Twitch** |
| Interface | `app/src/renderer/app.jsx`, `api.js`, `styles.css` | ✅ (Accueil, Montage, Historique, Réglages) |
| Installeur | `engine/build.bat`, `app/package.json`, `.github/workflows/release.yml` | ✅ écrit ; **jamais construit** (se fera sur GitHub ou sur le PC) |

Points jamais exécutés pour de vrai (à vérifier en premier sur le PC de Sky) :
1. `npm install` + `npm start` (Electron n'était pas installable dans l'environnement de Claude) ;
2. connexion au vrai OBS (activer : OBS → Outils → Paramètres du serveur WebSocket) ;
3. connexion au vrai Twitch avec le Client ID ;
4. `engine\setup-dev.bat` (uv + Python 3.13) et la transcription faster-whisper ;
5. `engine\build.bat` (PyInstaller) et l'installeur.

## 4. À faire (ordre proposé)

1. **Vérifier que tout démarre sur le PC** (liste ci-dessus).
2. **Détection à l'image sur les VOD de `vods/`** (OpenCV) :
   - bannière de kill du joueur (icône centrale en bas, n'apparaît que pour SES kills ; 1 à 5 → multi-kill / ace) ;
   - killfeed en haut à droite (confirmation, nom du joueur surligné) ;
   - HUD du haut (joueurs vivants des deux équipes, score des rounds) → clutchs, fin de round ;
   - présence du HUD Valorant → passages Valorant / hors Valorant ;
   - coordonnées normalisées selon la résolution (16:9, 4:3 étirée) ; analyse à quelques images/s
     (pas besoin de 60 i/s), décodage FFmpeg réduit pour aller vite ;
   - outil de calibrage : extraire des images autour des kills et vérifier à l'œil.
3. **Capture audio** pendant le live : module natif Windows (WASAPI, capture par processus) pour
   VALORANT, Discord, lecteur de musique + micro.
4. **Rires / cris** (pistes micro + Discord), **morts drôles** (mort + réaction chat/audio).
5. **Marqueurs** : raccourci clavier global (marche en jeu), Stream Deck.
6. **Relier le tout** : fin du live → analyse → dossier de stream → éditeur ouvert avec les clips proposés
   (aujourd'hui l'éditeur utilise `app/src/renderer/demo-data.js`).
7. Premier lancement : assistant (connexion OBS, Twitch, position de la webcam, test de performances).
8. Mettre le code sur GitHub (`skyjoytgg/sklip`), ajouter la variable `SKLIP_TWITCH_CLIENT_ID`, première release.

---

## 5. Claude Code — 24/11/2026, soirée

- Environnement installé : `engine\.venv` (Python 3.13), `app\node_modules` ; 40 tests moteur + 25 tests appli verts ; `git init` (rien commité).
  - `setup-dev.bat` / `build.bat` étaient en fins de ligne Unix → mal lus par cmd ; remis en CRLF (+ `.gitattributes`).
  - uv n'arrivait pas à suivre son lien vers Python 3.13 : venv créé en donnant directement
    `%APPDATA%\uv\python\cpython-3.13.18-windows-x86_64-none\python.exe`.
- VOD présentes : VALO CHILL du 01/11 (3 h 45, fichier `2916761426-…`) et RANKED PLAT NEON du 18/11 (3 h 20, `2932517166-…`).
- **Détection des kills à l'image : `engine/sklip_engine/kill_detect.py`** (commande moteur `detect-kills`).
  - Emblème de kill en bas au centre (centre 960,862 en 1080p) ; son dessin dépend du skin, mais il est
    toujours circulaire (cercle complet ou arcs) → score « contours circulaires centrés » en coordonnées polaires.
  - **Kills des mates regardés après la mort** (demande de Sky) : écartés grâce à l'icône « < souris > »
    de la carte « CHANGER DE JOUEUR » en bas à gauche (`assets/spectate_icon.png`), indépendante de la langue.
  - Faux positifs de l'écran de choix d'agent écartés (cercles affichés longtemps).
  - Sur la VOD du 01/11 : 70 kills de Sky, 108 kills de mates écartés ; les 4 kills donnés par Sky retrouvés
    (34:35, 43:10, 49:51, 52:48) ; les 70 emblèmes vérifiés à l'œil.
  - Vitesse : ~41 min pour 3 h 45 (CPU, 4 i/s). À accélérer.
- Reste à faire pour cette étape : regrouper les kills par round (multi-kills, aces), clutchs (HUD du haut),
  confirmation par le fil des kills en haut à droite (pseudo du streamer), deux kills enchaînés comptés comme un seul,
  autres résolutions (4:3 étirée), VOD du 18/11.
- **Rounds, multi-kills, aces : `engine/sklip_engine/rounds.py`** (idée de Sky : le score en haut change à chaque round).
  - Score lu seulement sur les images clés (`-skip_frame nokey`, une toutes les ~4 s) → toute la VOD en ~1 min 40.
  - Chiffres reconnus par modèles (`assets/score_digits.npz`, extraits de la VOD du 01/11) ; somme des scores
    qui monte = round suivant, qui retombe = nouvelle partie.
  - VOD du 01/11 : 16 parties (beaucoup d'Escarmouche 2v2), 139 rounds ; 70 kills de Sky → 50 kills seuls +
    9 multi-kills (8 × 2K, 1 × 4K à 2:38:14 → 2:38:47, score resté 2-2), pas d'ace.
  - Un multi-kill/ace = un seul moment (au dernier kill, `meta.t_start` = premier kill) → un seul clip qui couvre tout.

## 6. Claude Code — nuit du 24 au 25/11/2026 (Sky au téléphone : « lance tout ce qu'il y a à améliorer »)

- **Morts de Sky** (`kill_detect.find_deaths`) : début du mode spectateur − 2,5 s. VOD 01/11 : 97 morts ; VOD 18/11 : 76.
  Limite : mort en dernier de son équipe non vue.
- **Kills enchaînés** (`kill_detect._retriggers`) : l'emblème « redémarre » (score sous la moitié puis remonte).
  Vérifié avec le fil des kills (contour jaune = kills du joueur) : 25:30, 2:10:37, 2:22:08 (×3), 3:44:18.
  VOD 01/11 : 13 multi-kills (12 × 2K, 1 × 3K, 1 × 4K) au lieu de 9.
- **Joueurs en vie** (`rounds.read_hud`) : portraits du bandeau du haut (5 cases par équipe, serrés vers le centre,
  un mort disparaît) ; lus avec le score sur les images clés.
- **Clutchs** (`rounds.find_clutches`) : Sky dernier vivant de son équipe (et pas en spectateur, en regardant
  4 s après car la carte spectateur arrive 2,5 s après la mort) face à ≥ 2, round gagné (notre score monte).
  On ignore les 10 s après un changement de score (fin du round précédent).
  Résultat : **0 clutch de Sky sur les 2 VOD** — les 2 candidats étaient des clutchs de mates (Vermaille, darkz).
  Pas encore vu de vrai clutch de Sky pour valider. Idée : Valorant affiche « CLUTCH » à l'écran.
- **VOD 18/11 (RANKED PLAT NEON)** : 62 kills de Sky (tous vérifiés à l'œil), 87 de mates écartés, 76 morts,
  5 parties, 100 rounds, 13 multi-kills, 0 ace. Doublé suspect à vérifier : 2:09:31 → 2:10:42 (71 s d'écart).
- **Appli** : bug au lancement corrigé — Electron 33 (Node 20) n'avait pas WebSocket → OBS ne se connectait jamais.
  Passage à **Electron 45**, electron-builder 26, esbuild 0.28 (accord de Sky). Failles npm : 19 → 6 modérées
  (outils de construction seulement, 0 dans l'appli livrée). Le binaire Electron s'installe avec
  `node node_modules/electron/install.js` si npm ne l'a pas téléchargé (nouvelle politique `allowScripts`).
  Appli lancée et vérifiée (accueil + éditeur) ; l'éditeur utilise encore `demo-data.js`.
- Moteur : tolère le BOM ajouté par PowerShell sur l'entrée JSON. 50 tests moteur, 25 tests appli verts.
- `detect-kills` renvoie maintenant : moments (kill / multikill / ace / clutch), morts, rounds, parties ;
  `scan_file` / `hud_file` pour mettre les mesures en cache.

### Reste à faire
1. Relier analyse → dossier de stream → éditeur (remplacer `demo-data.js`).
2. Vitesse de l'analyse des kills (~40 min pour 3 h 45) : essayer `-skip_frame noref`, analyse pendant le live.
3. Vérifier un vrai clutch de Sky dès qu'il y en a un ; valider sur une VOD d'un pote (autre résolution).
4. Tester le vrai OBS et le vrai Twitch (besoin de Sky devant le PC).
5. Capture audio WASAPI, rires/cris, marqueurs, Stream Deck.

## 7. Claude Code — 25/11/2026 : tuto de départ et test du PC

Demande de Sky : un tuto au premier lancement (réglages + apprendre le montage, avec une option pour le passer)
et une analyse du PC pour savoir si faire les clips pendant le jeu va laguer ; le streamer choisit ensuite.

Choix de Sky : bulles guidées dans le vrai éditeur ; test lancé avant le stream ou une partie ;
réglages du départ = OBS + Twitch, webcam, thèmes et formats, pistes audio.

- **Assistant de départ** (`app/src/renderer/onboarding.jsx`) : s'affiche tant que `firstRunDone` est faux.
  7 étapes : bienvenue → OBS (aide pour activer obs-websocket) + Twitch → position et taille de la webcam
  (4 coins ou « pas de webcam », réglage `cam`) → thèmes, formats, durée → son (capture séparée, Discord oui,
  musique non par défaut) → test du PC + choix du mode d'analyse → fin. « Passer le tuto » à chaque étape
  (passe aussi les bulles de l'éditeur).
- **Bulles guidées** (`app/src/renderer/tour.jsx`) : à la première ouverture de « Montage » (`editorTourDone`),
  7 bulles qui éclairent les zones de l'éditeur (attributs `data-tour`) : moments, timeline, aperçu, clip,
  mixeur, format/durée, export. Échap ou « Passer le tuto » pour quitter.
- **Test du PC** : moteur `benchmark` (`engine/sklip_engine/benchmark.py`) fabrique 15 s de vidéo 1080p60
  bruitée et mesure la vitesse d'analyse avec un seul processus (celui d'un live) + l'encodeur de la carte
  graphique. L'appli (`app/src/main/perf.js`) ajoute processeur, RAM, carte graphique, charge actuelle et
  détecte si Valorant / OBS sont ouverts (sinon elle suppose 55 % de charge pour le jeu). Verdict
  `live` / `limite` / `apres`, avec les raisons ; le mode conseillé est marqué « Conseillé » mais c'est
  le streamer qui choisit. Résultat gardé dans `pcTest`.
  Sur le PC de Sky (Ryzen 7 5800X, 32 Go, RX 6600 AMF) : analyse ~11–14× le temps réel (une vraie VOD : ~10×),
  verdict « pendant le live OK ».
- **Réglages** : bloc « Test du PC » (refaire le test) et bouton « Relancer le tuto ».
- Tests : 51 côté moteur (dont le test du PC), 30 côté appli (dont 5 pour le verdict), tous OK.

### Garder la musique du live sur un clip (25/11/2026)
Demande de Sky : pouvoir garder, clip par clip, la chanson qui passait pendant le live (ex. quand il chante dessus).
- Éditeur → « Clip sélectionné » : case **🎵 Garder la musique du live** (`setLiveMusic` / `hasLiveMusic` dans
  `editor-model.js`) ; la timeline affiche 🎵 sur ces clips. Par défaut la musique reste coupée (droits d'auteur).
- Si une musique est ajoutée sur tout le montage (`music_file`), elle est coupée pendant ces clips pour ne pas
  entendre deux chansons (`live_music_ranges` / `added_music_volume` dans `render.py`). Son volume a maintenant
  son propre réglage `music_volume` (avant, il partageait celui de la musique du live).
- Sans piste musique séparée (VOD, Sklip lancé en retard), la musique est déjà dans le son du stream :
  l'éditeur le signale.
- Test de rendu réel : la musique (900 Hz) s'entend sur le clip gardé et disparaît sur le suivant.

## 8. Claude Code — 25/11/2026 : la grande série d'améliorations

Demande de Sky : « fais tout sauf la publication (mais prévois-la) ; je récupérerai une VOD d'un pote plus tard ».

- **Tests sur GitHub** (`.github/workflows/tests.yml`) : moteur + appli à chaque envoi sur `main`.
  `release.yml` installe maintenant FFmpeg **avant** les tests (les tests de rendu en ont besoin).
- **Journal de bug** (`app/src/main/logger.js`) : `logs/sklip-AAAA-MM-JJ.log` (7 jours), erreurs du moteur,
  d'OBS, de Twitch et de l'interface. Réglages → « Créer un rapport de bug » : un .txt sur le Bureau,
  mots de passe et jetons masqués.
- **Analyse 5× plus rapide** : on ne décode plus les images B (`-skip_frame noref`) et un seul FFmpeg à la fois
  (plusieurs en parallèle se gênaient : 4 → 8× le temps réel, 1 → 16×). Le décodage par la carte graphique
  (RX 6600) a été mesuré : pas plus rapide (13×), donc pas utilisé.
  VOD du 01/11 (3 h 45) : **8 min 37 au lieu de 41 min**, mêmes 75 kills et 97 morts.
- **Analyse → éditeur** (`engine/sklip_engine/analyze.py`, commande `analyze`) : vidéo → kills / multi-kills /
  aces / clutchs / morts + moments Twitch et marqueurs → classement → clips par thème → dossier du stream
  (`session.json`, `stats.json`, `stats.html`, cache `.sklip/`). Côté appli (`pipeline.js`, `main.js`) :
  fin d'enregistrement OBS → analyse automatique (sauf mode manuel ; on attend 90 s le résumé Twitch),
  notification Windows « Tes montages sont prêts », bandeau dans l'appli, Historique → « Monter ».
  L'éditeur ouvre le vrai stream (vidéo, moments, thèmes) ; les données d'exemple ne servent plus que dans un navigateur.
- **Classement plus malin** (`ranking.py`) : bonus si le chat réagit, si le streamer rit, si un viewer a clippé
  ou si un marqueur est proche (plafond +40). Nouvelles « morts drôles » : mort suivie d'un rire ou d'un pic de chat.
- **Marqueur** (`markers.js`) : raccourci global (F9, réglable ; vérifie s'il est libre) et, pour le Stream Deck,
  `http://127.0.0.1:47811/marker` (local uniquement). Compté seulement pendant un enregistrement OBS ;
  la barre latérale affiche « 📍 3 marqueurs ».
- **Capture du son à part** (`audio_capture.py`, commande `capture`) : « process loopback » de Windows → une piste
  par logiciel (Valorant, Discord, Spotify — réglables) + le micro par défaut, encodées en Opus 160 kb/s,
  silence ajouté quand un logiciel se tait ou n'est pas ouvert. Démarre/s'arrête avec l'enregistrement OBS
  (fichier `stop`). Décalage = horloge, affiné par corrélation sur le son du jeu (`tracks_for_video`).
  Testé pour de vrai : un son de 1000 Hz joué par un processus n'apparaît que sur sa piste.
  Captures gardées dans `captures/` (supprimées après « Garder les fichiers de travail » jours).
  **Pas encore testé pendant un vrai live** avec Valorant/Discord/Spotify.
- **Analyse pendant le live** (`live-analysis.js`, commande `scan-chunk`) : en mode « Pendant le stream »,
  toutes les 5 min, Sklip mesure le morceau d'enregistrement déjà écrit (fichier trouvé avec `GetRecordDirectory`,
  lecture seule) ; à la fin il ne reste que les dernières minutes. Vérifié sur un MKV en cours d'écriture.
  Un MP4 classique n'est pas lisible pendant l'écriture → on retombe sur l'analyse après le live.
- **Publication (plus tard)** : chaque export écrit une fiche `montage.json` à côté de la vidéo (titre proposé,
  description, hashtags, format, durée, `published: {}`) — une future publication TikTok / YouTube n'aura qu'à l'envoyer.
- Webcam par défaut calée sur la vraie cam de Sky (x 2,6 %, y 5,6 %, 22,4 × 22,2 %).
- Essai de bout en bout dans l'appli : extrait de 4 min de la VOD du 01/11 → analyse en 13 s → éditeur avec
  le kill de 34:38 et un 2K → export 9:16 de 24 s + fiche de publication.
- Tests : 62 moteur, 43 appli, tous OK.

### Reste à faire
1. Tester pendant un vrai live : capture des pistes (Valorant, Discord, Spotify), marqueur F9, analyse auto.
2. VOD d'un pote (autre résolution, 4:3 étiré) quand Sky l'aura.
3. Publication TikTok / YouTube Shorts (la fiche .json est prête).
4. Détecter les rires et les cris dans la piste micro (maintenant qu'elle existe).
5. Détecter la webcam automatiquement (aujourd'hui : coins ou position de Sky par défaut).

## 9. Claude Code — 25/11/2026 : sous-titres modifiables et mixage automatique

Demande de Sky : pouvoir corriger les sous-titres générés (erreurs, blagues) et un mixage cohérent
(la musique pas plus forte que la voix).

**Sous-titres**
- Générés automatiquement à l'ouverture de l'éditeur (faster-whisper, piste micro si elle existe),
  commande moteur `transcribe`. Ponctuation et élisions recollées (« T'es », « ça! »).
- Panneau de droite : une zone de texte par ligne, on retape ce qu'on veut, ✕ pour supprimer,
  « + Ajouter une ligne ici » (à la position de lecture), « Regénérer » (avec confirmation).
  Si le nombre de mots change, les nouveaux mots sont répartis sur la durée de la ligne.
- Aperçu en direct dans l'éditeur, mot prononcé surligné ; même rendu incrusté à l'export
  (une seule phrase à l'écran à la fois).
- Le montage est sauvegardé tout seul (`montage-<thème>.json` dans le dossier du stream) :
  corrections gardées si on ferme l'appli.

**Mixage automatique** (`engine/sklip_engine/mixing.py`, case « Mixage auto » cochée par défaut)
1. Chaque piste est ramenée à son niveau : voix −18 dB, Discord −20, jeu −24, musique −29
   (mesuré seulement quand la piste fait du bruit). Les curseurs du streamer s'appliquent ensuite.
2. Quand le streamer parle, la musique baisse fort et le jeu un peu (ducking).
3. Volume final du montage à −14 LUFS (recommandation TikTok / YouTube), crêtes à −1,5 dB.
Vérifié : test avec voix + jeu + musique synthétiques (voix devant, musique qui remonte dans les pauses),
et export réel dans l'appli (−14,8 LUFS, sous-titre corrigé visible dans la vidéo).

## 10. Claude Code — 25/11/2026 : réactions des amis de confiance

Demande de Sky : quand il fait un ace ou un clutch en chat partagé avec un pote, récupérer la réaction
du pote (sa vidéo ; son son est déjà sur la piste Discord de Sky), sans demander toute sa VOD.
Choix de Sky : amis de confiance (le pote a Sklip), webcam du pote **en incrustation par défaut**,
le streamer peut passer en **plan de coupe** ; les extraits passent par un **dossier partagé** (OneDrive / Google Drive).

**Comment ça marche** (`app/src/main/friends.js`, `engine/sklip_engine/friends.py`)
- Réglages → Amis de confiance : dossier partagé, pseudo (Twitch par défaut), liste des potes,
  « Envoyer ma réaction sans me demander » (sinon le pote valide chaque demande), demandes reçues.
- Pendant l'enregistrement, Sklip regarde toutes les 2 min qui est dans le chat partagé Twitch
  (`GET /shared_chat/session`, aucun droit en plus). Après l'analyse : une demande par ace/clutch
  et par ami de confiance présent. Dans l'éditeur : bouton « Demander sa réaction » sur n'importe quel clip.
- Dossier partagé : `demandes/<id>.json` (heures de début/fin), `extraits/<id>.json` + `.mp4`.
  Rien de local (dossiers du PC) n'est écrit dedans ; tout est effacé une fois la réaction récupérée.
- Côté pote : Sklip note chaque enregistrement OBS (`recordings.json`), retrouve le passage, découpe
  **seulement sa webcam** (480p) sur ces secondes. Jamais pendant son live (fait après). OBS non modifié, enregistrement juste lu.
- Côté streamer : la réaction est copiée dans `<stream>/reactions/`, calée au son sur la piste Discord
  (corrige l'écart d'horloge entre les PC), listée dans `reactions.json`, ajoutée au clip du moment.
- Éditeur : Incrustation (coin au choix, cadre violet) / Plan de coupe (« Placer ici », 1,5 / 2,5 / 4 s), « Retirer la réaction ».
- `session.json` contient maintenant `record_started_at` (heure du début de l'enregistrement).

Vérifié : tests moteur (découpe webcam, calage au son avec 2,4 s d'écart d'horloge, rendu incrustation et
plan de coupe) et appli (aller-retour complet entre deux Sklip, refus, pote en live, fichier en cours de synchro) ;
puis deux Sklip lancés en même temps sur le PC de Sky avec un dossier partagé : réaction reçue en 26 s,
horloge du « pote » décalée de 1,5 s corrigée exactement, exports incrustation et plan de coupe vérifiés à l'image.
Pas encore testé : un vrai chat partagé Twitch et un vrai dossier OneDrive entre deux PC.

### 10 bis. Même jour : chat partagé obligatoire et mini-serveur (plus de dossier partagé)

Demandes de Sky : même un ami de confiance ne reçoit la webcam **que si on était en chat partagé** ;
et le streamer doit avoir le moins possible à régler. Choix de Sky : **mini-serveur gratuit**.
- Règle du chat partagé vérifiée **chez le pote** : son Sklip relève lui-même le chat partagé Twitch toutes les 2 min
  pendant ses lives (`presence.json`, gardé 30 jours). Sans relevé commun → réponse `not_together`, rien n'est découpé.
  Dans l'éditeur, « Demander sa réaction » ne propose que les potes vus en chat partagé pendant le clip.
- Le dossier partagé (OneDrive) est supprimé. À la place : `relay/` = Cloudflare Workers + D1 (offre gratuite).
  Identité = le jeton Twitch déjà dans Sklip (vérifié auprès de Twitch, seulement les jetons de l'appli Sklip).
  Messages et fichiers (morceaux de 1 Mo) lisibles seulement par l'expéditeur et le destinataire, effacés dès récupération,
  ménage quotidien après 7 jours. Tables créées automatiquement. Client : `app/src/main/relay.js`.
- Réglages → Amis de confiance : juste les pseudos Twitch des potes (+ « Envoyer ma réaction sans me demander »).
- Extraits limités à ~900 kbit/s (16 s ≈ 1 Mo).
- Adresse du serveur : `relayUrl` dans `app/config.json` (vide tant que Sky ne l'a pas mis en ligne :
  voir `docs/SERVEUR-AMIS.md`). Tests GitHub : ajout des tests du serveur.
Vérifié : tests serveur (6), appli (53, avec le vrai code du serveur en mémoire, dont « pote pas en chat partagé »),
serveur lancé en local avec la vraie base D1, deux Sklip sur le PC : réaction reçue en 111 s, calage exact,
serveur vide après récupération. Pas encore testé : le serveur en ligne et un vrai chat partagé Twitch.

## 11. Claude Code — 25/11/2026 : webcam trouvée toute seule, rires et cris

Demande de Sky : « 1 2 et 3 mais pour le 3 je veux qu'on puisse aussi le régler manuellement »
(1 = commit/push c6809c3, 2 = rires/cris dans la piste micro, 3 = webcam détectée automatiquement).
- **Webcam** (`engine/sklip_engine/camdetect.py`) : 24 images réparties sur le stream ; le jeu change tout le temps,
  la webcam montre toujours la même pièce → grand rectangle calme aux bords nets. Aucun modèle à télécharger.
  Résultat sur les 2 VOD : à 1–2 px près, ~11 s par vidéo. Gardé en cache (`.sklip/cam.json`).
  Réglage `cam.auto` (vrai par défaut). Si rien n'est trouvé : réglage de base + ⚠ sur le bouton « 📷 Webcam ».
- **Réglage à la main** : bouton « 📷 Webcam » dans l'éditeur → fenêtre avec une image du stream, cadre violet à
  déplacer / redimensionner, « Garder ce réglage pour mes prochains streams », « Automatique », « Pas de webcam ».
  L'aperçu montre la vraie webcam découpée, comme à l'export. Vérifié à l'écran (glisser-déposer à la souris).
- **Rires et cris** (`engine/sklip_engine/voice.py`), seulement dans la piste micro capturée par Sklip :
  cri = voix ≥ 10 dB au-dessus du niveau de parole habituel pendant ≥ 0,3 s ; rire = petites rafales voisées
  régulières (3 à 8 par seconde). Les tirs/explosions sont écartés (pas une voix). Chaque passage candidat est
  ensuite écouté par Whisper (un seul appel, chaque passage à part) : « hahaha / mdr » ou rien → rire,
  exclamation courte (« NOOON », « regarde regarde », « oh stop ») → cri, une phrase dite fort (« Merci ») → rien.
  Au plus 8 rires et 8 cris par heure. Nouveau type de moment `scream` (« Cri », thème Moments drôles),
  bonus de classement pour un kill suivi d'un cri, « mort drôle » aussi après un cri. Cache `.sklip/voice.json`.
Vérifié : tests moteur (dont 16 sur la voix, 5 sur la webcam), appli 54. Sur 20 min de vraie VOD (son mixé, faute
de piste micro séparée) : 3 cris et 2 rires plausibles en 96 s, dont le vrai « Ha ha ha ha ».
Pas encore testé : une vraie piste micro séparée pendant un live.

## 12. Claude Code — 25/11/2026 : améliorations faites pendant que Sky n'était pas devant l'ordi

Demande de Sky : « Fait les tous », et « ce serait compliqué d'analyser ce qui est dit pour couper le clip au bon moment ?
Ou avoir une marge pour raccourcir ou allonger le clip ? »
- **Coupe aux fins de phrase** : à l'analyse, Sklip repère quand le streamer parle (piste micro, sinon le son de la vidéo :
  ~40 s pour 3 h 30). Si un clip commence ou finit au milieu d'une phrase, le début recule (≤ 2,5 s) / la fin attend
  la fin de la phrase (≤ 3 s). `selection.snap_to_speech`, phrases gardées dans `session.json` (`speech`).
- **Marge dans l'éditeur** : la vidéo du stream continue de chaque côté du clip. Boutons Début/Fin −1 s / +1 s,
  bords de la timeline aimantés aux débuts/fins de phrase, bord en jaune + « ✂️ Ce clip coupe une phrase » →
  « Ajuster aux phrases » (≤ 6 s). Vérifié à l'écran.
- **Longs streams** : la piste micro est lue par morceaux de 10 min (`voice.track_features`) au lieu d'un bloc
  (~1 Go pour 4 h avant). Transcription des passages candidats : un seul appel Whisper, chaque passage à part.
- **Webcam** : la détection regarde de préférence les instants où le HUD de Valorant est lu (pas les scènes
  « Just Chatting » / pause, où la webcam est ailleurs).
- **Export plus rapide** : l'encodage AMD (AMF) passe de « quality » à « balanced » (l'encodeur était le goulot),
  2 clips préparés en même temps. 35 s de montage : 17,7 s → 11,1 s, image vérifiée.
- **Réactions des potes** : requêtes au serveur réessayées 2 fois (coupure, erreur 500) ; demandes gardées dans une boîte
  d'envoi si pas d'internet à la fin du live, renvoyées toutes seules ; une tâche qui échoue 5 fois est abandonnée et
  le pote prévenu (« error ») ; demandes sans réponse depuis 7 jours → « expired ». Réglages → Amis affiche
  « serveur injoignable », les demandes pas encore envoyées et celles en attente.
- **Répétition générale** (faux OBS sur le PC, `obs-websocket` imité) : enregistrement de 5 min qui grossit en temps
  réel, capture audio par Sklip, 2 marqueurs Stream Deck, arrêt → analyse automatique en 24 s, 3 moments
  (2 marqueurs + 1 kill), webcam trouvée, enregistrement intact. Sklip n'a envoyé à OBS que GetStreamStatus /
  GetRecordStatus. La capture audio démarre ~2,5 s après OBS (décalage bien corrigé). L'analyse pendant le live
  fait sa 1re mesure à 5 min : rien à mesurer sur un live de 5 min, normal.
- **Installeur** : `engine\build.bat` utilise maintenant `engine\.venv` (Python 3.13) s'il existe, jamais le Python 3.15
  du système. Moteur construit en local (455 Mo) et testé (transcription, sélection). `vendor/` ignoré par git.
Pas encore testé : un vrai live avec Valorant, micro et Discord réels.

## 13. Chat partagé précis, journal du live en frise, fiche premier live (25/11/2026)
- **Chat partagé** : relevé toutes les minutes (avant : 2 min). Un moment ne compte qu'entre le premier et le dernier
  relevé où le pote était là, plus 1 min de marge (avant : ±3 min autour de n'importe quel relevé, donc un ace fait
  juste avant d'entrer en chat partagé pouvait compter). Un relevé raté ne coupe pas le passage.
- **Journal du live** (`app/src/main/live-journal.js`) : chaque étape d'un enregistrement est notée (capture audio et
  pistes trouvées, marqueurs, pote en chat partagé, analyse pendant le live toutes les 30 min, raids, analyse finale,
  erreurs). Affiché sur l'accueil en **frise chronologique avec marque-pages** (`live-journal.jsx`), en direct pendant
  le live ; « ! » orange/rouge = point à vérifier. Aussi écrit dans le journal texte (rapport de bug). 20 lives gardés.
  Sky veut voir ce que ça donne : peut-être retiré ensuite.
- **docs/PREMIER-LIVE.md** : fiche courte avant / pendant / après le premier vrai live.
- Ménage : installeur, moteur construit et `vendor/ffmpeg` supprimés (≈ 3 Go, tout se reconstruit : `engine\build.bat`,
  copie de ffmpeg.exe/ffprobe.exe dans `vendor\ffmpeg`, `npm run dist`).
- **Retour de Sky sur la frise** : il aime le principe mais pas les émojis → icônes dessinées (`icons.jsx`).
  Filtre « une seule catégorie à la fois » (Tout, Kills, Multi-kills, Aces, Clutchs, Rires, Cris, Marqueurs,
  Communauté, Coulisses). Nouvel onglet **Lives** (`lives.jsx`, `app/src/main/lives.js`) : une ligne par live
  (miniature tirée de l'enregistrement au plus beau moment, titre, date, durée, kills/aces/clutchs/clips) ; un clic
  ouvre la page du live : stats, frise (moments + coulisses du journal + clips le long de l'axe, cliquables vers
  l'éditeur) et liste des clips. Au-delà de 45 événements, les kills deviennent des points sur l'axe.
  Moteur : commande `thumb` (miniature, vidéo seulement lue).
- **Changement de jeu / Just Chatting** (Sky : Valorant surtout, mais Just Chatting en début/fin de live, caméra en
  grand). On ne peut pas enregistrer la webcam à part (Windows la réserve à OBS) → Sklip **demande à OBS, en lecture
  seule**, la scène affichée et la position de la webcam dedans (`obs-scenes.js` : GetCurrentProgramScene,
  GetSceneItemList, GetGroupSceneItemList ; source « Périphérique de capture vidéo », groupes et scènes imbriquées
  suivis), à chaque changement de scène et chaque minute. Il note aussi la **catégorie Twitch** (Helix /channels).
  À la fin : passages `segments` (main/segments.js → moteur). Chaque clip prend la mise en page de son passage :
  Valorant → cam en haut + jeu ; ailleurs → **« Cam en grand »** (webcam recadrée 9:16, choix « a » de Sky).
  Sans infos (VOD) : passages d'après le bandeau de score Valorant. Frise : une couleur par catégorie
  (Valorant rouge, Just Chatting bleu) + temps passé sur chacune. Limite : recadrage centré sur la webcam (pas
  encore centré sur le visage).
- **Types de scène** (accord de Sky) : c'est la **scène OBS** qui décide de la mise en page, plus la catégorie Twitch
  (souvent déjà « VALORANT » pendant le Just Chatting ; elle ne sert plus qu'aux couleurs de la frise). Chaque scène
  est **Jeu** (capture de jeu ≥ 50 % de l'image), **Discussion** (webcam visible, sinon) ou **Pause** (ni l'un ni
  l'autre : « Je reviens »… → aucun clip). Deviné en lisant la scène dans OBS (GetSceneList ajouté à la liste blanche,
  lecture seule), confirmé/corrigé par le streamer : nouvelle étape « Tes scènes OBS » de l'assistant + Réglages
  (`scene-types.jsx`, réglage `sceneTypes`). Le choix du streamer passe avant la devinette.
- **Overlays des potes** (question de Sky, capture d'un overlay « Rang actuel » en haut à droite) : sans effet, Sklip
  ne lit pas le killfeed. Il lit l'emblème de kill (bas-centre), le score (haut-centre) et l'icône spectateur
  (bas-gauche) : un overlay posé sur ces zones-là empêcherait la détection.

## 14. Alerte overlays, cam centrée sur le visage, thème Discussion, répétition avec scènes (25/11/2026)
Sky : « Fait tout ça y compris le commite » (commit 25f4aa1 poussé avant de commencer).
- **Alerte overlay** (`obs-scenes.js`, `READ_ZONES`, `overlaysOnZones`) : dans une scène de jeu, toute source posée
  PAR-DESSUS la capture du jeu qui cache au moins 15 % d'une zone lue (score en haut au centre, bannière des kills en
  bas au centre, icône spectateur en bas à gauche) est signalée dans « Tes scènes OBS » (Réglages + assistant),
  avec son nom. Ignorés : sources sous le jeu, webcam, overlays plein écran (alertes, en général transparents).
  Toujours en lecture seule.
- **« Cam en grand » centrée sur le visage** (`engine/sklip_engine/camfocus.py`) : OpenCV 5 n'embarque plus de
  détecteur de visage sans modèle à télécharger → même idée que la détection de webcam : dans la webcam la pièce est
  fixe, le streamer bouge ; on prend le plus gros bloc qui bouge sur 8 images du clip, le haut de ce bloc = la tête.
  Résultat `focus` {x, y} sur le clip → rendu (`_layout`, recadrage qui reste dans la webcam) et aperçu de l'éditeur.
  Rien ne bouge → centre de la webcam. Vérifié sur la VOD (3 cas sur 4 pile sur la tête ; le 4e : cadre de test
  qui débordait sur le jeu, ce qui n'arrive pas avec le cadre lu dans OBS).
- **Thème « Discussion (Just Chatting) »** : rires, cris, chat qui s'emballe, raids, marqueurs, clips de viewers,
  peaks — seulement pendant les passages discussion (scène OBS, sinon hors du bandeau de score Valorant).
  Titre proposé « En direct avec le chat 🎙️ », #justchatting.
- **Bug corrigé** (vu pendant la répétition) : OBS déjà ouvert au lancement de Sklip → la connexion se faisait avant
  que la fenêtre soit prête, l'accueil affichait « OBS non connecté » / « Pas d'enregistrement ». La fenêtre demande
  maintenant l'état d'OBS à l'ouverture (`obs:current`) et l'état d'enregistrement est envoyé à chaque début/fin.
- **Couleurs de la frise sans catégorie Twitch** : une scène de discussion / pause prend le nom de sa scène OBS
  (« Just Chatting » en bleu) au lieu de la devinette du bandeau de score.
- **Répétition générale avec scènes** (faux OBS v5 : Just Chatting cam en grand → Valorant avec webcam en haut à
  gauche + overlays « Rang actuel », « Logo » sur la bannière des kills, « Alertes » plein écran → Just Chatting ;
  4 min de live, 2 marqueurs Stream Deck) dans la vraie appli : Sklip n'a envoyé que GetStreamStatus,
  GetRecordStatus, GetCurrentProgramScene, GetVideoSettings, GetSceneItemList, GetSceneList ; journal avec les
  3 changements de scène ; 3 passages ; clips de jeu en « cam en haut », marqueur du Just Chatting en « Cam en
  grand » avec cadrage visage, thème Discussion limité à ce passage ; seul « Logo » signalé dans les Réglages ;
  onglet Lives (miniature, stats, frise bleu/rouge/bleu) OK.
- Reste à vérifier pendant un vrai live : vrai OBS de Sky, vraie catégorie Twitch, cadrage visage sur une vraie
  scène Just Chatting.

### 14 bis. Même jour : corrections et finitions (Sky : « Fait tout maintenant »)
- **Bug : image floue sur une VOD** : hors jeu, une VOD (sans OBS) passait en « Cam en grand » avec la petite webcam
  de jeu (≈ 430 × 240 px) agrandie en plein écran vertical. Maintenant « Cam en grand » seulement si la webcam fait au
  moins la moitié de la hauteur de l'image (`segments.FULL_MIN_H`), sinon webcam en haut + image.
- **Cadrage visage depuis l'éditeur** : passer un clip en « Cam en grand » demande au moteur où est le visage
  (commande `focus`) ; aperçu et export centrés dessus. `focus` : absent = pas encore cherché, null = pas trouvé.
- **Analyse** : un clip présent dans deux thèmes n'est regardé qu'une fois pour le cadrage (cache).
- **Overlay gênant** dessiné en jaune dans la mini-scène des Réglages, et noté dans le **journal du live** (en
  orange, une fois par scène et par overlay) s'il apparaît pendant le live.
- Vérifié dans la vraie appli avec le faux OBS (live de 90 s) : alerte dans le journal au passage sur Valorant,
  overlay dessiné, « Cam en grand » choisi dans l'éditeur → visage centré, cadrage enregistré dans le montage.

### 14 ter. Bouton « Vérifier avant le live » (accueil)
- `app/src/main/precheck.js` + `precheck.jsx` : un clic juste avant le live. OBS connecté ? scènes de jeu /
  discussion reconnues, overlays gênants, place libre sur le disque de l'enregistrement (GetRecordDirectory, lecture
  seule ; rouge < 10 Go, orange < 30 Go), micro essayé 2 s par la capture de Sklip (fichier temporaire supprimé),
  Valorant / Discord / musique ouverts (liste des logiciels ; « pas encore ouvert » n'est pas une erreur : la capture
  les attrape dès qu'ils démarrent), Twitch connecté, marqueurs (F9, Stream Deck), mode d'analyse. Résumé :
  « Tout est prêt », « Prêt, N points à vérifier » ou « N problèmes à régler ».
- Essayé sur le PC de Sky : OBS fermé → rouge avec la marche à suivre ; micro capté, Discord et Spotify vus ; avec le
  faux OBS : scènes, overlay « Logo », 160 Go libres. Requêtes OBS : toujours uniquement des Get….
- **Installeur construit sur le PC de Sky** (`engine\build.bat` puis `npm run dist`, rien de publié) :
  Sklip-Setup-0.1.0.exe (619 Mo). Version dépaquetée (`app\dist\win-unpacked\Sklip.exe`) lancée avec un profil de
  test : démarre, moteur empaqueté OK (commande `focus`, essai du micro de « Vérifier avant le live »).
- **2e VOD analysée de bout en bout** (3 h 20, 5 parties) : 62 kills, 13 multi-kills, 0 ace / clutch, 76 morts ;
  passages Valorant / hors jeu retrouvés ; webcam trouvée (en haut à gauche). Montage Kills 30 s = 2 multi-kills
  (27 s), version 60 s = 5 clips. Drôle / Communauté / Discussion vides sur une VOD (ni micro séparé, ni chat, ni
  marqueurs) : normal. Copies légères pour le téléphone dans `apercus/` (ignoré par git).
- Nouveau test `syntax.test.js` : vérifie la syntaxe de tout le processus principal (une erreur dans main.js
  empêchait Sklip de démarrer et aucun test ne le voyait).
- **Proposition « ce sera flou »** (éditeur) : un clip mis à la main en « Cam en grand » avec une petite webcam
  (moins de la moitié de la hauteur, même seuil que le moteur) affiche un conseil en jaune et un bouton
  « Mettre « Cam en haut » ». Rien n'est imposé.

### 14 quater. Optimisations (Sky : « Oui » aux points 1, 2, 3)
- **Exports plus légers** (`render.encoder_args`) : débit cible 8 Mbit/s, plafond 12 Mbit/s, pour tous les encodeurs
  (AMD, NVIDIA, Intel, CPU). La carte AMD de Sky en « qualité fixe » sortait ~15 Mbit/s : 58 s = 112 Mo → 61 Mo,
  aucune différence visible (comparaison image par image), et TikTok / YouTube réencodent de toute façon.
- **Installeur plus petit** : scipy retiré (seuls `fftconvolve` et `stft` servaient, réécrits avec numpy, résultats
  identiques à 1e-17), `hf_xet` et `onnxruntime.transformers` exclus, DLL vidéo d'OpenCV supprimée après
  construction (les vidéos sont lues par FFmpeg). Moteur 455 → 335 Mo.
  **Bug trouvé** : `"files": ["dist/**"]` embarquait dans l'appli… les installeurs précédents rangés dans app/dist
  (sur le PC : 242 → 619 → 995 Mo à chaque construction ; pas sur GitHub où le dossier part vide). Maintenant
  `dist/renderer.js` seulement. Installeur : 619 → 217 Mo. Moteur empaqueté vérifié : analyse complète, BPM
  (119,8 pour 120), calage audio (7,3 s retrouvé), cadrage visage.
- **Best-of du live** (thème `bestof`, 60 s) : tous les types de moments, répartis entre les parties (chaque clip
  déjà pris dans une partie rend les suivants de cette partie moins prioritaires). Ajouté tout seul aux lives
  d'au moins 45 min avec au moins 10 moments. 2e VOD : 4 clips sur 4 parties différentes (60 s).
- Attention en local : un fichier .bat réécrit avec des fins de ligne Linux casse `build.bat` (Windows lit mal) ;
  .gitattributes force déjà CRLF dans le dépôt.

### 14 quinquies. Retours de Sky sur le best-of de la 2e VOD
- **Kills très rapprochés** (« sur l'avant-dernier clip j'ai fait 3 kills ») : à 82:44 les deux premiers kills
  sont à ~0,3 s ; l'emblème ne « retombe » qu'1/10 s, invisible à 4 images/s. `kill_detect.refine_kills` relit
  chaque apparition de l'emblème à 10 images/s (2-3 s de vidéo à chaque fois, ~1 min 30 pour un live de 3 h 20)
  et sépare les kills ; il n'en retire jamais. 2e VOD : 62 → 66 kills de Sky, le clip devient un 3K.
- **Ordre du best-of** (« échanger les deux derniers clips ») : règle retenue, ordre du live mais le meilleur
  clip à la fin (`selection.finale_last`, à égalité le plus tardif).
- **Kills au couteau (« au cut »)** : Sky a confirmé que le 3e kill du 3K de 82:44 est au couteau (« 2 coups de
  shorty puis je le termine au couteau »). `killfeed.py` lit le fil des kills en haut à droite : sur les lignes
  « vert tue rouge », l'icône de l'arme est blanche et toujours dessinée pareil ; le couteau est la seule icône fine et
  pleine (63×12 px en 1080p, les armes ≥ 17 px de haut). Un kill du streamer est au couteau si une icône de couteau
  de plus apparaît dans le fil juste après lui. Sur les 2 VOD (137 kills) : exactement 1 trouvé, le bon.
  ~50 s de plus par live de 3 h. Bonus de score +55 (`KNIFE_BONUS`) : un kill au couteau seul passe devant un 3K.
  À l'écran : « 3 KILLS / AU COUTEAU » ; titre proposé « Kill au couteau 🔪 », hashtag #knife.
  Limite : un skin de couteau avec une icône très différente (large, ajourée) pourrait ne pas être reconnu.

### 14 sexies. Messages du chat sur la vidéo (TikTok de goomsii montré par Sky)
Sky : « quand je lis le message de quelqu'un sur le chat, une option pour mettre le message sur la vidéo ».
Réponses de Sky : 1C (automatique + à la main), 2A (style Twitch : fond sombre, pseudo dans sa couleur, badges).
- Pendant le live, `twitch.js` garde chaque message (pseudo, texte, badges, **couleur**). `pipeline.twitchExtras` les met
  dans le temps de l'enregistrement (sans les commandes « !… ») → `analyze` (paramètre `chat`) → `session.json`.
- `engine/sklip_engine/chatread.py` : dans chaque clip choisi qui a des messages récents (3 min avant), la piste micro
  est transcrite (faster-whisper) et Sklip cherche les mots du message prononcés dans l'ordre, après qu'il a été posté
  (fautes de transcription tolérées, mots ajoutés aussi ; messages de moins de 3 mots ignorés). Bulle affichée pendant
  la lecture (au moins 2,5 s). Testé sur la voix de Sky (VOD du 25/11, 10:45 « ça me rend fou avec la Fantôme »).
- Éditeur : « Messages du chat sur la vidéo » dans le clip sélectionné : les messages autour du clip, à cocher ;
  ceux lus sont cochés tout seuls (« lu par toi ») ; « Afficher à partir d'ici ». Deux bulles ne se chevauchent pas.
- Dessin de la bulle (`chat-bubble.js`, canvas) : le même PNG sert à l'aperçu et à l'export ; enregistré par
  `sticker:save` dans `.sklip/stickers` du dossier du stream ; posé par le moteur (`render.sticker_filter`, fondu).
  9:16 : à cheval entre la webcam et le jeu, comme sur le TikTok.
- Limite : les VOD téléchargées n'ont pas le chat (Twitch ne le donne pas) : seulement les lives enregistrés avec Sklip.

### 14 septies. L'agent qui parle, en grand sur la vidéo (même TikTok)
Réponses de Sky : 3A (pote sur Discord), 4A (Sklip devine l'agent), 5A (images officielles Riot téléchargées par Sklip).
Pour savoir qui parle, Sky a choisi C : d'abord B (Sklip propose, Sky choisit l'agent), puis A (empreintes vocales
des potes habituels). Il a aussi demandé : et les joueurs qui parlent dans le vocal **du jeu** ? → fait en premier.
- `app/src/main/agents.js` : liste des agents + icônes depuis valorant-api.com (rafraîchie toutes les 2 semaines,
  dans `<données Sklip>/agents`) ; grand portrait téléchargé au besoin et détouré (`cropTransparent`, nativeImage).
- `engine/sklip_engine/voicechat.py` : l'indicateur du vocal du jeu (en bas à gauche : icône de l'agent qui parle)
  est lu 2 fois/s (comparaison avec les icônes, `cv2.matchTemplate`), puis la piste jeu est transcrite et chaque
  phrase est donnée à l'agent qui parlait. L'agent de Sky (celui qui « parle » en même temps que son micro) est retiré.
  Vérifié sur la VOD du 24/11 vers 20:06–20:42 (bom = Viper, Reyna, Sky = Neon).
- Éditeur : « Ce que disent tes coéquipiers » : répliques entendues (non cochées par défaut), agent et texte
  modifiables, « + Faire parler un agent ici » (pour Discord en attendant B). À l'export : le portrait glisse depuis
  la droite, la phrase en grosses lettres blanches contour noir (`voice-card.js`) apparaît en fondu.
- Testé dans la vraie appli : aperçu + export 9:16 regardés image par image (Viper + « Oui oui c'est bon… »).
- Limite : sur une VOD, toutes les voix sont mélangées dans le son du stream → la phrase attribuée peut être un peu
  fausse (c'est pour ça qu'elle est modifiable). En live avec les pistes séparées de Sklip, c'est plus propre.
- Reste : B (transcrire la piste Discord, proposer les phrases, Sky choisit l'agent), puis A (empreintes vocales).

### Idées de Sky pour plus tard (26/11/2026)
- Durée des montages : pouvoir **choisir plusieurs durées** à la fois (ex. 15 s + 30 s + 60 s) au lieu d'une seule
  cible. Sky : « on le fera après ».
- Empêcher Sklip de s'ouvrir deux fois (raccourci du bureau `lancer-sklip.vbs` créé le 26/11) : proposé, pas encore fait.
- Publication (décision de Sky, 26/11) : **pas de connexion TikTok / YouTube pour l'instant**. Sklip prépare des
  montages prêts à poster (TikTok/Shorts 9:16 courts + **vidéo YouTube 16:9 d'environ 10 min** avec toutes les
  options), et le streamer les publie lui-même depuis son PC. Connexions directes plus tard (YouTube : vidéos privées
  tant que Google n'a pas vérifié l'appli ; TikTok : « moi seulement » et 5 comptes/jour sans validation).

### 14 octies. Avant la première version publique (26/11/2026)
- Enregistrement OBS lancé tout seul avec le streaming **par défaut** (tuto de départ + ligne « Enregistrement »
  dans « Avant le live »). Raccourci « Sklip » sur le bureau (`lancer-sklip.vbs`, version de développement).
- Discord (B) côté moteur : la piste Discord est transcrite dans chaque clip, les phrases sont proposées dans
  « Ce que disent tes coéquipiers » avec « Choisis l'agent… » (pas encore testé sur un vrai live).
- Vidéo YouTube 8–15 min : choix de Sky 1A (Just Chatting du début en premier, de la fin en dernier), 2C (écran
  « ROUND 7 · ACE » + swoosh), 3C, 4AB (description + chapitres + miniature), 5 = court « abonne-toi ».
  **Commencée, pas finie, pas dans la version 0.1.0** : brouillon du moteur gardé hors git dans
  `.claude/wip-video-youtube/` (youtube.py + render/analyze/moments/__main__ modifiés). Reste : appli (thème,
  16:9 par défaut, options cochées), tests, rendu regardé.
- Dépôt GitHub passé en public par Sky (pour que sa pote télécharge l'installeur et ait les mises à jour).
  `scripts/write-config.js` garde maintenant le config.json du dépôt (avant, il effaçait `relayUrl`),
  publication en « release » (pas en brouillon).
- Serveur des réactions **en ligne** (26/11) : `https://sklip-relay.sklip-relay.workers.dev` (compte Cloudflare de Sky,
  base D1 `sklip-relay` en Europe de l'Est), adresse dans `app/config.json`. Vérifié : répond 401 sans jeton Twitch.
  Pas encore testé : une vraie réaction entre deux PC.
- Piège trouvé : les commandes lancées depuis l'appli Claude écrivent dans une copie privée de %APPDATA% ;
  le Python 3.13 de uv (utilisé par `engine\.venv`) n'existait que là → copié dans le vrai `%APPDATA%\uv\python`.

### 14 nonies. Après le premier vrai live (26/11/2026)
- **Progression de l'analyse** : pastille « Analyse 42 % · environ N min » dans la barre de gauche et sur l'accueil.
- **Éditeur** : clic sur un moment = aperçu sans l'ajouter (« + Ajouter au montage » / « ✕ Revenir ») ;
  **✕** sur une ligne pour retirer un moment de la liste (« Voir les N moments retirés » → « Remettre »), gardé dans le montage.
- **Bots du chat** (WizeBot, Nightbot…, pseudos en « bot ») et commandes « ! » jamais en bulle (`chat-bots.js`).
- **Clips plus larges** (Sky : « 6 secondes c'est trop court, on n'a pas le contexte ») :
  montages auto 12 s avant / 5 s après (multi-kill : 6 s avant le 1er kill ; clip viewer : 25 s avant, il est créé
  après l'action), fin prolongée jusqu'à 8 s tant que le streamer parle ; éditeur (aperçu / « + Ajouter ») 30 s avant / 8 s après.
  Le streamer rogne ensuite.
- **Durée des montages** : 30 s, **1 min (défaut)**, 2, 3 ou 5 min. L'ancien défaut 30 s passe à 1 min une fois.
- **Kill raté** (live du 26/11, 20:09, 3e kill du round) : emblème pâle sur fond clair (score 19 < 30). 2e passage :
  emblème pâle gardé seulement si une ligne « allié tue ennemi » de plus apparaît dans le fil des kills.
  Sur les 3 h : 13 candidats, 1 confirmé (le bon), aucun faux kill.
- **Réanalyser** (page du live) : même dossier, image en cache (~2 min), reprend Twitch / marqueurs / pistes / passages ;
  les montages retouchés vont dans `.sklip/avant-reanalyse`.
- **Mises à jour** : electron-updater télécharge la nouvelle version au lancement, installée à la fermeture de Sklip.
- **Éditeur (v0.1.3)** : barre rouge qu'on attrape et glisse (règle, clic sur un clip, ⏮ / touche Début) ;
  « ✂ Couper ici » (touche C) coupe un clip en deux ; panneaux de gauche et de droite élargissables (bord à tirer,
  largeur gardée) ; l'éditeur ne déborde plus quand la fenêtre est petite ; sous-titres : case à cocher par ligne
  (cachée à l'aperçu et à l'export, texte gardé), « Tout cocher / Tout décocher ».
- **Releases** : la construction crée une seule release brouillon avant electron-builder et la publie à la fin
  (v0.1.0 et v0.1.1 étaient en double ; la v0.1.1 n'était pas trouvée par la mise à jour auto).
- **Clips viewers (v0.1.4)** : le viewer choisit son extrait jusqu'à ~90 s avant de créer le clip → la fenêtre
  remonte à ~1 min 25 avant (Sky : « 1 min à 1 min 30 »), ou découpe exactement le passage quand Twitch donne vod_offset.
- **Chat du jeu (v0.1.5)** : les messages écrits dans le chat de Valorant (en bas à gauche de l'enregistrement ;
  à droite c'est l'overlay du chat Twitch) sont lus avec la reconnaissance de texte de Windows
  (`engine/sklip_engine/gamechat.py`, commande moteur `game-chat`, à la demande pour les clips du montage).
  Pseudo bleu = allié, rouge = ennemi ; messages blancs (système) et pings « (Émission) » ignorés. Ils ne créent
  jamais de clip : l'éditeur les propose dans « Messages du chat sur la vidéo » (étiquette « jeu · allié/ennemi »),
  affichés 3 s par défaut. Vu sur le live du 26/11 : « (Tout) tuffboy : pd » (Omen ennemi) vers 19:50.
  Tuto de l'éditeur v3 : étapes « Nouveau » (retirer un moment, barre rouge et coupes, panneaux élargissables,
  sous-titres à cocher, chat du jeu). Sauvegarde du montage : automatique ~1 s après chaque changement.
- **Durée des montages 3 min par défaut (v0.1.6)** : Sky, 26/11 au soir. Migration une fois (`durationsV3`) :
  les anciens défauts (1 min, ou 30 s d'avant la v0.1.1) passent à 3 min ; un choix fait exprès est gardé.
  Sur le live du 26/11 : 7 clips pour Kills et Rires au lieu de 2.
- **v0.1.7 (26/11 au soir, idées de Sky)** :
  - **Durée par thème** (Réglages et premier lancement) : Kills / Drôle / Communauté / Discussion 1 min, Best-of 5 min.
    Dans l'éditeur, menu **« Durée »** à côté du thème (30 s, 1 min, 3 min, 5 min) : commande moteur `retarget`,
    refait les clips du thème avec les moments déjà trouvés (0 à 7 s), l'ancien montage gardé en
    `montage-<thème>.avant-duree.json`.
  - **Teaser** : 3 s des meilleurs instants au début (multi-kill : ~1 s autour de chacun des 3 derniers kills), le clip
    entier reste à sa place ; bouton « ⚡ Teaser ». Export : coupes franches (plus de fondu au noir de 0,12 s
    entre les coupes, qui faisait une « pause » entre les kills). Aperçu : 3 lecteurs de la même vidéo, les clips
    suivants préparés à l'avance (`buffered-video.jsx`) : chaque saut dans le live coûtait 0,04 à 0,55 s.
  - **Fins de partie** (`endgame.py`) : grand écran VICTOIRE / DÉFAITE au centre (pas la bannière de round, plus petite
    en haut avec « Équipe éliminée »…), puis « DÉTAILS DU RANG » « -25 SC » (masque des pixels colorés, plusieurs tailles,
    vote). Live du 26/11 : 5 défaites, VICTOIRE 13-11, RR -25 / +16 / -21. Chaque partie classée (écran du rang lu)
    ajoute en plus de la durée visée, dans l'ordre du live, aux montages Kills et Best-of : « win » / « loose » (~6 s)
    puis « rr+16 » (~5 s) (noms demandés par Sky).
  - **Titres et hashtags** proposés après l'export (« Copier titre + hashtags »).
  - **Export automatique** à la fin du live (case, décochée par défaut ; sans bulles du chat ni répliques).
  - **Apprendre de mes montages** (`style-model.js`) : après 3 montages retouchés, les suivants sont proposés comme le
    streamer les retouche (bords des clips, types retirés, mise en page, teaser, volumes) ; « Oublier mes habitudes ».
  - **Une seule fenêtre Sklip** ; **molette** pour défiler dans la timeline (Ctrl + molette : zoom) ; tuto v4.
  - **Analyse plus rapide** : fins de partie lues en parallèle du score / de la webcam / de la voix (cachées
    derrière, ~2 min 15 gagnées sur 3 h), lecture vidéo `-skip_frame noref` (chat du jeu 14 → 9 s). Lire plusieurs
    passages du chat en même temps perdait des messages : non retenu. Pistes audio déjà en Opus.
  - Reste : cases de style (« ensuite »), publication TikTok / YouTube (« pas encore »), rires / cris à tester en vrai live.
- **v0.1.8 (27/11)** :
  - Clips « win » / « loose » : **2 s** (Sky : « 6 s → 2 s »), qui commencent à l'apparition de l'écran VICTOIRE / DÉFAITE
    (`endgame.find_banners` relit les 4 s d'avant à 2 images/s : l'image clé tombait au milieu ou avant l'écran).
  - **Best-of dans l'ordre du live** (Sky 27/11) : plus de « meilleur clip à la fin » (`finale_last` retiré).
  - Éditeur : bouton **« 💬 Sous-titres »** en haut (toute la vidéo) ; listes séparées **« Chat du live (Twitch) »** et
    **« Chat en jeu (Valorant) »** ; teaser sélectionné → panneau « ⚡ Teaser » + « Aller au clip entier » (le « pd »
    introuvable : le teaser était sélectionné, ses coupes d'1 s n'ont pas de chat).
  - Montage refait (menu Durée, réanalyse) : les choix de l'ancien montage sont repris (`editor-model.carryChoices` :
    bulles cochées, répliques, sous-titres, textes, volumes, format, teaser enlevé).
  - Live analysé avant la v0.1.7 : « Réanalyser » une fois pour avoir les win / loose / rr.
