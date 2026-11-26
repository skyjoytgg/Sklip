import { useEffect, useRef, useState } from 'react';

// Aperçu sans temps de chargement entre les clips (Sky, 26/11 : « une pause entre les kills du teaser »).
// Les clips d'un montage viennent d'endroits différents d'un live de plusieurs heures : sauter de l'un à l'autre
// oblige le lecteur à chercher puis décoder jusqu'à 4 s d'images (une image clé toutes les ~4 s chez OBS).
// Ici, plusieurs lecteurs de la même vidéo : un joue le clip en cours, les autres attendent déjà, en pause, au
// début des clips suivants. Au changement de clip, on montre celui qui est prêt : la coupe est instantanée.
const SLOTS = 3;
const NEAR = 0.3;          // s : écart toléré entre la vidéo et le temps du montage

/**
 * `time` : instant de la vidéo à montrer ; `upcoming` : débuts des prochains clips (préparés à l'avance).
 * `stallRef` (option) : reçoit une fonction qui dit si la vidéo affichée attend encore ses images (le chrono
 * du montage s'arrête alors, au lieu de partir devant et de relancer une recherche).
 */
export function BufferedVideo({ src, time, playing, upcoming = [], muted = true, stallRef = null, style = {} }) {
  const refs = useRef([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const vids = refs.current.slice(0, SLOTS);
    if (vids.length < SLOTS || vids.some((v) => !v)) return;
    let a = active;
    if (Math.abs(vids[a].currentTime - time) > NEAR) {
      const ready = vids.findIndex((v, i) => i !== a && Math.abs(v.currentTime - time) <= NEAR);
      if (ready >= 0) a = ready;
      else vids[a].currentTime = time;
    }
    const cur = vids[a];
    if (playing && cur.paused) cur.play().catch(() => {});
    if (!playing && !cur.paused) cur.pause();
    // Les autres lecteurs : en pause, au début des prochains clips (sans relancer une recherche déjà faite).
    const others = vids.filter((_, i) => i !== a);
    const free = [...others];
    const todo = [];
    for (const t of upcoming.slice(0, others.length)) {
      const k = free.findIndex((v) => Math.abs(v.currentTime - t) <= NEAR);
      if (k >= 0) free.splice(k, 1);
      else todo.push(t);
    }
    for (const v of others) if (!v.paused) v.pause();
    todo.forEach((t, i) => { if (free[i]) free[i].currentTime = t; });
    if (stallRef) stallRef.current = () => playing && (cur.seeking || cur.readyState < 3);
    if (a !== active) setActive(a);
  });
  useEffect(() => () => { if (stallRef) stallRef.current = null; }, []);
  return (
    <>
      {Array.from({ length: SLOTS }, (_, i) => (
        <video key={i} ref={(el) => { refs.current[i] = el; }} src={src} preload="auto" muted={muted || i !== active}
          style={{ ...style, opacity: i === active ? 1 : 0 }} />
      ))}
    </>
  );
}
