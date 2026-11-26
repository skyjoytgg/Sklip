// Avancement de l'analyse affiché à l'accueil et dans la colonne de gauche : pourcentage + temps restant estimé.

/** « 42 % » */
function percent(a) {
  return `${Math.max(0, Math.min(100, Math.round((a && a.fraction ? a.fraction : 0) * 100)))} %`;
}

/**
 * Temps restant estimé d'après le temps déjà passé (la lecture de la vidéo avance à peu près régulièrement).
 * Sur la fin (écoute des voix, cadrage), l'avancement n'est plus régulier : « presque fini ».
 */
function remaining(a, now = Date.now()) {
  if (!a || !a.running) return '';
  const f = a.fraction || 0;
  if (f >= 0.95) return 'presque fini';
  const elapsed = (now - (a.startedAt || now)) / 1000;
  if (f < 0.03 || elapsed < 20) return 'calcul du temps restant…';
  const left = (elapsed * (1 - f)) / f;
  if (left < 60) return "moins d'une minute";
  const min = Math.round(left / 60);
  return min >= 90 ? `environ ${Math.round(min / 60)} h` : `environ ${min} min`;
}

module.exports = { percent, remaining };
