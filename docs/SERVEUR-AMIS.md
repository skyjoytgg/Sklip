# Mettre en ligne le serveur des amis (une seule fois, par Sky)

Le serveur des amis est une petite boîte aux lettres : les Sklip des potes s'y déposent les extraits de webcam
(réactions sur un ace ou un clutch en chat partagé). Les streamers n'ont **rien** à régler : leur connexion Twitch
dans Sklip suffit. Seul Sky le met en ligne, une fois.

- Hébergé sur Cloudflare Workers, **offre gratuite** (Workers + base D1). Largement assez pour Sky et ses potes.
- Chaque extrait est effacé dès qu'il est récupéré, et tout est effacé au bout de 7 jours au plus tard.
- Seuls les jetons Twitch de l'appli Sklip sont acceptés. Personne ne peut lire les messages ou fichiers des autres.
- Le code est dans `relay/` (logique dans `relay/src/relay.js`, testée par `npm test`).

## Étape 1 — Créer le compte Cloudflare (Sky, ~3 min)
1. Va sur https://dash.cloudflare.com/sign-up
2. Mets ton e-mail et un mot de passe, puis valide l'e-mail reçu.
3. Rien d'autre : pas besoin de nom de domaine ni de carte bancaire pour cette offre gratuite.

## Étape 2 — Autoriser ce PC (Sky, ~1 min)
Dans PowerShell :
```powershell
cd C:\projets\Sklip\relay
npx wrangler login
```
Une page Cloudflare s'ouvre : clique sur **Allow** (Autoriser).

## Étape 3 — Le reste (Claude)
Dis à Claude « c'est fait ». Il va :
1. créer la base : `npx wrangler d1 create sklip-relay`, et mettre son identifiant dans `relay/wrangler.toml` ;
2. envoyer le serveur : `npx wrangler deploy` (adresse du type `https://sklip-relay.<ton-compte>.workers.dev`) ;
3. mettre cette adresse dans `app/config.json` (`relayUrl`), vérifier avec un test, puis te proposer le commit
   et une nouvelle version de Sklip pour tes potes.

## Plus tard
- Mettre à jour le serveur après une modification : `cd relay` puis `npx wrangler deploy`.
- Tester sur le PC sans rien envoyer : `npm run dev` dans `relay/` (jetons factices `dev:<pseudo>`), puis lancer Sklip
  avec `SKLIP_RELAY_URL=http://127.0.0.1:8787` et `SKLIP_DEV_LOGIN=<pseudo>` (version de dev seulement).
