// Listes partagées entre l'accueil, les réglages et l'assistant de départ.
export const THEMES = [
  { id: 'kills', label: 'Kills / Aces / Clutchs' },
  { id: 'drole', label: 'Moments drôles' },
  { id: 'communaute', label: 'Moments communauté' },
  { id: 'discussion', label: 'Discussion (Just Chatting)' },
  { id: 'bestof', label: 'Best-of du live (1 min ou plus)' },
];

export const MODES = {
  end_of_stream: 'Auto à la fin du stream',
  live: 'Pendant le stream (PC puissant)',
  manual: 'Manuel',
};

export const DURATIONS = [30, 60, 120, 180, 300];      // secondes ; 180 (3 min) par défaut
export const durationLabel = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60}` : `${s / 60} min`);

export const FORMATS = [['9x16', '9:16 (TikTok, Shorts, Reels)'], ['16x9', '16:9 (YouTube)']];
