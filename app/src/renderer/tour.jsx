// Bulles guidées : chaque étape éclaire une zone de l'écran (attribut data-tour) et l'explique.
import { useEffect, useLayoutEffect, useState } from 'react';

export const EDITOR_TOUR = [
  { target: 'moments', title: 'Les moments détectés',
    text: "Tout ce que Sklip a trouvé dans ton stream : kills, multi-kills, aces, clutchs, raids… Clique « + Ajouter » pour mettre un moment dans ton montage." },
  { target: 'moments', since: 3, title: 'Voir ou retirer un moment',
    text: "Clique sur un moment pour le regarder sans l'ajouter à ton montage. Le ✕ au bout de la ligne le retire de la liste si tu n'en veux pas (« Voir les moments retirés » pour le remettre)." },
  { target: 'moments', since: 4, title: 'Victoires, défaites et RR',
    text: "Sklip repère aussi la fin de tes parties : « Victoire » (vert), « Défaite » (rouge) et les points de rang gagnés ou perdus (RR). Ils sont dans la liste, et les victoires vont dans le montage Kills et le Best-of." },
  { target: 'timeline', title: 'La timeline',
    text: "Ton montage, clip après clip. Glisse un clip pour changer l'ordre, tire ses bords pour le raccourcir ou le rallonger. Touche Suppr pour retirer le clip sélectionné." },
  { target: 'timeline', since: 3, title: 'La barre rouge et les coupes',
    text: "Attrape la barre rouge (ou clique sur la règle du temps) et glisse-la pour revoir un passage ; ⏮ te ramène au début. « ✂ Couper ici » (touche C) coupe le clip en deux à la barre rouge : tu peux ensuite supprimer un morceau (touche Suppr)." },
  { target: 'timeline', since: 4, title: 'Le teaser et la molette',
    text: "Le clip violet « ⚡ Teaser » au début : les meilleurs instants en coupes rapides (3 s), pour accrocher. Le clip entier est rejoué plus loin. Fais tourner la molette pour défiler, Ctrl + molette pour zoomer." },
  { target: 'preview', title: "L'aperçu",
    text: 'Regarde ton montage ici. Barre espace pour lire ou mettre en pause. Clique dans la timeline pour te placer à un endroit.' },
  { target: 'props', title: 'Le clip sélectionné',
    text: 'Choisis la mise en page en 9:16 (webcam en haut ou jeu seul), le son de ce clip, les sous-titres et les textes à l\'écran.' },
  { target: 'props', since: 3, title: 'Agrandir les panneaux',
    text: "Mets ta souris sur le bord d'un panneau (ici ou celui des moments) : il devient violet. Tire-le pour l'élargir. Sklip garde la largeur pour la prochaine fois." },
  { target: 'subs', since: 3, title: 'Choisir les sous-titres',
    text: "Décoche une ligne de sous-titre pour la cacher (le texte est gardé, tu peux la recocher). « Tout cocher / Tout décocher » pour le clip entier." },
  { target: 'voices', since: 2, title: 'Tes coéquipiers parlent',
    text: "Quand un coéquipier parle dans le vocal du jeu, Sklip devine son agent et note sa phrase. Coche-la : l'agent arrive en grand sur la vidéo avec sa phrase façon BD. Tu peux changer l'agent ou corriger le texte. « + Faire parler un agent ici » pour en ajouter un toi-même (un pote sur Discord par exemple)." },
  { target: 'chat', since: 2, title: 'Les messages du chat',
    text: "Quand tu lis un message du chat à voix haute, Sklip le met tout seul sur la vidéo en bulle façon Twitch. Tu peux en cocher d'autres. Marche pour les lives enregistrés avec Sklip (Twitch connecté)." },
  { target: 'gamechat', since: 3, title: 'Le chat en jeu',
    text: "Juste en dessous, « Chat en jeu » : les messages écrits dans le chat de Valorant pendant le clip, lus tout seuls (étiquette bleue « allié » ou rouge « ennemi »). Coche-en un : il s'affiche 3 s sur la vidéo, comme un message Twitch." },
  { target: 'mixer', title: 'Le mixeur',
    text: 'Règle le son de tout le montage : jeu, micro, Discord, musique. La musique est coupée par défaut à cause des droits d\'auteur.' },
  { target: 'bgm', since: 5, title: 'Musique libre de droits',
    text: "Coche « 🎶 Musique libre » : Sklip choisit une musique libre de droits selon la durée du montage (plusieurs enchaînées pour un long Best-of). ▶ pour écouter, « 🔀 Changer » pour en prendre d'autres. Ajoute les tiennes dans « Mes musiques »." },
  { target: 'format', title: 'Format et durée',
    text: '9:16 pour TikTok, Shorts et Reels, 16:9 pour YouTube. La durée visée se règle par thème dans les Réglages (1 min pour un TikTok, 5 min pour le Best-of).' },
  { target: 'duree', since: 4, title: 'La durée du montage',
    text: "À côté du thème, choisis la durée : 30 s, 1 min, 3 min ou 5 min. Sklip refait aussitôt le montage de ce thème à cette durée, avec les mêmes moments repérés (pas besoin de relancer l'analyse)." },
  { target: 'teaser', since: 4, title: 'Teaser et habitudes',
    text: "« ⚡ Teaser » enlève ou remet le teaser. Sklip retient aussi ce que tu changes dans tes montages (début des clips, clips retirés, mise en page…) : après 3 montages retouchés, il te les propose comme tu les aimes (« ✨ Selon tes habitudes »)." },
  { target: 'export', title: 'Exporter',
    text: 'Quand ça te plaît, clique « Exporter ». La vidéo arrive dans le dossier de ton stream, prête à poster. À toi de jouer !' },
  { target: 'export', since: 4, title: 'Titre et hashtags',
    text: "Après l'export, Sklip te propose un titre et des hashtags : « Copier titre + hashtags » puis colle-les sur TikTok ou YouTube. Dans les Réglages, tu peux aussi faire exporter tes montages tout seuls à la fin du live." },
];

/** Version du tuto : les étapes `since` plus récentes que ce qu'a vu le streamer lui sont montrées seules. */
export const TOUR_VERSION = 5;
export function tourSteps(steps, seen) {
  return seen ? steps.filter((s) => (s.since || 1) > seen).map((s) => ({ ...s, title: `Nouveau : ${s.title}` })) : steps;
}

function rectOf(target) {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest' });            // zone dans un panneau qui défile (clip sélectionné)
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Place la bulle à côté de la zone, sans sortir de la fenêtre. */
export function bubblePosition(rect, view, bubble = { w: 340, h: 190 }, gap = 14) {
  if (!rect) return { left: (view.w - bubble.w) / 2, top: (view.h - bubble.h) / 2 };
  const clampX = (x) => Math.max(12, Math.min(view.w - bubble.w - 12, x));
  const clampY = (y) => Math.max(12, Math.min(view.h - bubble.h - 12, y));
  if (rect.top + rect.height + gap + bubble.h <= view.h) return { left: clampX(rect.left), top: rect.top + rect.height + gap };
  if (rect.top - gap - bubble.h >= 0) return { left: clampX(rect.left), top: rect.top - gap - bubble.h };
  if (rect.left + rect.width + gap + bubble.w <= view.w) return { left: rect.left + rect.width + gap, top: clampY(rect.top) };
  if (rect.left - gap - bubble.w >= 0) return { left: rect.left - gap - bubble.w, top: clampY(rect.top) };
  return { left: clampX(rect.left + rect.width / 2 - bubble.w / 2), top: clampY(rect.top + rect.height / 2 - bubble.h / 2) };
}

export function Tour({ steps, onDone }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const step = steps[i];
  useLayoutEffect(() => { setRect(rectOf(step.target)); }, [i, view]);
  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e) => { if (e.key === 'Escape') onDone(true); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, []);
  const pos = bubblePosition(rect, view);
  const last = i === steps.length - 1;
  return (
    <div className="tour">
      {rect ? <div className="tour-hole" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />
        : <div className="tour-dim" />}
      <div className="tour-bubble" style={pos}>
        <div className="note">Étape {i + 1} / {steps.length}</div>
        <b>{step.title}</b>
        <p>{step.text}</p>
        <div className="row">
          <button className="link" onClick={() => onDone(true)}>Passer le tuto</button>
          <span className="grow" />
          {i > 0 && <button className="btn ghost sm" onClick={() => setI(i - 1)}>Précédent</button>}
          <button className="btn sm" onClick={() => (last ? onDone(false) : setI(i + 1))}>{last ? 'Terminer' : 'Suivant'}</button>
        </div>
      </div>
    </div>
  );
}
