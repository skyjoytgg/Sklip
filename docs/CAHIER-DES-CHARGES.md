# Sklip — Cahier des charges (v1)

> Copie du cahier des charges du projet Claude « Clip Montage » (24/11/2026). Si tu le modifies ici,
> c'est cette version qui fait foi pour la suite du travail dans Claude Code.

## Objectif
Sklip est une appli Windows clé en main, gratuite, d'abord pour un petit cercle de streamers. Elle repère les moments forts d'un stream Twitch Valorant, monte automatiquement une vidéo selon un thème (« kills », « moments drôles »…), puis le streamer valide ou réorganise les clips sur une timeline en glisser-déposer.

## Décisions prises
- **Nom** : Sklip.
- **Logiciel de stream** : OBS Studio uniquement (tous les streamers du cercle l'utilisent).
- **OBS n'est jamais modifié** : Sklip ne touche à aucun réglage OBS (profil, scènes, sources, pistes audio, format ou dossier d'enregistrement, raccourcis). Il se contente d'observer.
- **Sources vidéo** : enregistrement OBS local en priorité, VOD Twitch téléchargée en secours.
- **Jeu** : Valorant uniquement. Les passages hors Valorant (Just Chatting, autres jeux) sont repérés automatiquement : on n'y cherche pas de kills, mais ils comptent pour les thèmes Drôle et Communauté.
- **Compte Twitch** : bouton « Se connecter avec Twitch ». Le streamer valide un code sur la page Twitch officielle (aucun mot de passe saisi dans Sklip). Une seule application Twitch Developer, celle de Sky, de type « Public » (pas de secret à cacher). Les jetons sont chiffrés sur le PC (coffre Windows).
- **Démarrage** : Sklip ne se lance pas avec Windows ; le streamer l'ouvre quand il stream.
- **Multi-streamers** : toutes résolutions (16:9, 4:3 étirée…), tous GPU (NVIDIA / AMD / Intel / CPU), position de la webcam réglable par streamer (par défaut en haut à gauche, comme chez Sky).
- **Langue de l'interface** : français.
- **Design** : sombre, style gaming, accent violet Twitch.
- **Périmètre v1** : tout en même temps.
- **Durée des montages** : courts, 15 à 60 s.
- **Découpe autour d'un moment** : environ 4 s avant et 2 s après.
- **Export** : fichier enregistré sur le PC + ouverture du dossier. Pas de publication automatique.
- **Mises à jour** : automatiques au lancement (releases hébergées sur GitHub).

## Enregistrement (OBS en lecture seule)
- Sklip se connecte à OBS via obs-websocket (intégré depuis OBS 28) **uniquement pour observer** : début et fin du live, début et fin de l'enregistrement, chemin du fichier enregistré.
- **Aucune modification de la configuration OBS**, ni au premier lancement ni ensuite. Pas d'assistant qui reconfigure OBS.
- **Vidéo** : Sklip utilise l'enregistrement OBS tel que le streamer l'a réglé (format, qualité et dossier inchangés).
  - Option « Lancer l'enregistrement OBS au début du live » : Sklip appuie simplement sur « Démarrer l'enregistrement » avec les réglages du streamer, sans en changer aucun. Il n'arrête que l'enregistrement qu'il a lui-même lancé. Le choix est proposé au premier lancement.
  - Sans enregistrement local, Sklip télécharge la VOD Twitch.
- Sklip ne capture pas la vidéo et ne lit rien dans Valorant : il analyse la vidéo enregistrée.

### Pistes audio séparées (capturées par Sklip, pas par OBS)
Pour ne pas toucher aux pistes OBS, Sklip enregistre lui-même les sons séparés pendant le stream, dans des fichiers à part :

| Piste | Contenu | Capture par Sklip |
|---|---|---|
| Mix | Mix complet (celui envoyé sur Twitch) | Piste audio de l'enregistrement OBS ou de la VOD |
| Jeu | Son de Valorant | Capture audio d'application Windows → VALORANT |
| Micro | Voix du streamer | Micro choisi dans les réglages de Sklip |
| Discord | Vocal Discord | Capture audio d'application Windows → Discord |
| Musique | Spotify ou autre lecteur | Capture audio d'application Windows → lecteur choisi |

- **Synchronisation** automatique avec la vidéo OBS : Sklip aligne ses pistes sur le son de la vidéo (corrélation audio), au besoin à la milliseconde près.
- Si l'enregistrement du streamer contient déjà des pistes séparées, Sklip peut les utiliser à la place (choix dans les réglages).
- La capture audio ne tourne que si Sklip est ouvert pendant le stream. Pour une VOD seule, ou si Sklip a été ouvert en retard, seul le mix est disponible : le mixeur est alors limité à une piste, et la détection des rires travaille sur le mix.
- Les VOD Twitch peuvent avoir des passages en « Son coupé » (musique protégée) : la détection audio ne peut pas s'appuyer dessus, d'où l'intérêt des pistes capturées par Sklip.
- La piste micro séparée améliore la détection des rires et des cris, ainsi que les sous-titres.
- Prérequis : Windows 10 (2004+) ou 11 pour la capture audio par application.

### Dans l'éditeur de montage
- 4 pistes réglables (Jeu, Micro, Discord, Musique), avec volume et coupure du son, sur tout le montage et clip par clip.
- Discord est actif par défaut.
- Par défaut, la piste Musique est coupée à l'export (droits d'auteur sur TikTok et YouTube). Le streamer peut la réactiver.

## Dossier par stream
À la fin de chaque stream, Sklip crée automatiquement un dossier :

```
Sklip/Streams/2026-11-24_titre-du-stream/
├── stats.html          ← récap du stream, s'ouvre d'un double-clic
├── moments/            ← un fichier vidéo par moment détecté
│   ├── 00-12-34_ace.mp4
│   ├── 00-47-10_raid.mp4
│   └── …
└── montages/           ← montages exportés (un par thème)
    ├── sklip_kills_9x16.mp4
    └── …
```

- **Stats du stream** (dans `stats.html` et dans l'appli) : kills, multi-kills, aces, clutchs, morts, raids (avec le nom de la chaîne et le nombre de viewers), peak de viewers, pics de chat, clips créés par les viewers, marqueurs, durée du stream, temps passé sur Valorant.
- **Écran Historique** dans l'appli : la liste des streams passés, avec leurs stats, leurs moments et leurs montages, pour refaire un montage plus tard.

### Stockage
- Les pistes audio capturées par Sklip sont supprimées après X jours (durée réglable), en même temps que la copie de travail du stream.
- L'enregistrement OBS original n'est jamais supprimé ni déplacé par Sklip : il reste dans le dossier choisi par le streamer.
- Le dossier du stream (moments, montages, stats) est conservé.

## Déclenchement de l'analyse (au choix du streamer dans les réglages)
- **Auto à la fin du stream** : l'appli repère la fin du live et analyse en arrière-plan.
- **Pendant le stream** : analyse en direct, pour les PC puissants. Priorité basse, et une analyse moins fréquente pour ne pas faire baisser les FPS.
- **Manuel** : toujours disponible (choisir un fichier ou une VOD → « Analyser »).
- Au premier lancement, un petit test de performances propose le mode adapté au PC.

## Moments détectés
| Type | Méthode |
|---|---|
| Kills du streamer uniquement | Bannière de kill du joueur (n'apparaît que pour ses propres kills) + killfeed, coordonnées normalisées selon la résolution |
| Multi-kills, aces (prioritaires) | Comptage des kills par round (bannière 1 à 5) |
| Clutchs | Joueurs vivants des deux équipes (HUD du haut) + victoire du round |
| Morts drôles | Mort détectée à l'écran, gardée seulement si le chat ou l'audio s'emballent juste après |
| Passages Valorant / hors Valorant | Catégorie Twitch du stream + présence du HUD Valorant à l'image |
| Raids | API Twitch (EventSub) |
| Peaks de viewers | API Twitch (relevé chaque minute). Critère choisi par le streamer : record du stream, montée rapide (ex. +20 % en quelques minutes) ou seuil fixe |
| Pics de chat | Emotes Twitch de base (LUL, KEKW…) + liste perso d'emotes et de mots-clés propre à chaque streamer (« mdr », « ptdr »…) ; pic = bien plus de réactions que d'habitude sur 10 s |
| Clips créés par les viewers | API Twitch (Get Clips), position exacte grâce à la VOD |
| Rires / cris | Analyse audio des pistes micro et Discord (volume + classification des sons) |
| Marqueurs manuels | Raccourci clavier propre à Sklip, réglable (fonctionne en jeu, n'utilise pas les raccourcis OBS), commande chat `!clip` (streamer + modérateurs), bouton Stream Deck |

## Montage automatique
- **Thèmes fournis** : Kills / Aces / Clutchs, Moments drôles, Moments communauté (raids, peaks, clips viewers).
- **Thèmes perso** : le streamer en crée en cochant les types de moments à inclure.
- **Un montage par thème choisi** : le streamer coche les thèmes avant l'analyse.
- Sélection des meilleurs moments par score, jusqu'à la durée cible (15-60 s).
- **Formats** : 16:9 et 9:16.
  - Mise en page 9:16 par défaut : cam en haut, jeu en bas.
  - Mise en page modifiable clip par clip dans l'éditeur (cam en haut, cam en bas, jeu seul).
- **Sous-titres auto** : style TikTok mot par mot (le mot prononcé en couleur), en français uniquement. Activés par défaut, désactivables dans l'éditeur.
- **Textes à l'écran** (« ACE », compteur de kills, « CLUTCH », pseudo) : désactivés par défaut, activables dans l'éditeur.
- Transitions courtes (fondus) entre les clips.

### Musique (au choix du streamer)
1. **Musique de sa bibliothèque** : il choisit un morceau local, Sklip en détecte le BPM et cale les coupes sur les beats.
2. **Sans musique, calée sur un BPM** : il choisit un BPM (ex. 120). Sklip coupe les clips sur cette grille rythmique et exporte la vidéo sans musique. Il ajoute ensuite dans TikTok Studio une musique de ce BPM.
   - Aperçu avec un métronome dans Sklip pour vérifier le rythme.
   - Le BPM est indiqué dans le nom du fichier exporté (ex. `sklip_kills_9x16_120bpm.mp4`).
   - La première coupe tombe sur le temps 1 : il suffit d'aligner le début de la musique sur le début de la vidéo dans TikTok.

## Éditeur
- Déplacer les clips en glisser-déposer sur la timeline.
- Rogner le début et la fin d'un clip en tirant ses bords (calé sur la grille si un BPM est choisi).
- Ajouter ou retirer des clips depuis la liste de tous les moments détectés.
- Mixeur 4 pistes (volume et coupure du son, global et par clip).
- Choix de la mise en page 9:16 par clip.
- Sous-titres et textes à l'écran.
- Aperçu (Espace = lecture / pause, Suppr = retirer le clip sélectionné), zoom de la timeline, export.

## Architecture
- **Interface** : Electron + React (timeline glisser-déposer, mixeur 4 pistes, aperçu, historique, réglages), mises à jour auto via electron-updater + GitHub Releases.
- **Capture audio** : petit module natif Windows (WASAPI, capture par processus) qui enregistre Jeu, Micro, Discord et Musique pendant le stream, en priorité basse.
- **Moteur** : Python 3.13 (OpenCV pour l'image, faster-whisper pour les sous-titres, analyse audio, synchronisation des pistes, détection de BPM), empaqueté avec PyInstaller.
- **Rendu** : FFmpeg (livré avec l'installeur), encodeur choisi automatiquement (NVENC / AMF / QSV / x264), mixage des pistes audio, sous-titres et textes incrustés (police Montserrat).
- **Installeur** : .exe Windows construit et publié automatiquement par GitHub Actions à chaque nouvelle version. Non signé au départ (avertissement Windows SmartScreen à passer une fois).

## Fourni par Sky (24/11/2026)
- VOD Valorant téléchargées dans `C:\projets\Sklip\vods` (pour calibrer la détection des kills).
- Application Twitch Developer « Sklip » → Client ID `88d0w53zc9hsemjvt486ekjgmkep9k` (vérifier le type « Public »).
- Compte GitHub : `skyjoytgg` (dépôt prévu `skyjoytgg/sklip`).
