// Icônes dessinées (traits simples, même style partout) pour la frise des lives.
const P = {
  kill: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  multikill: <><path d="M12 22c4 0 7-2.8 7-6.8 0-3.2-2-5.6-3.6-7.2-.3 1.8-1.2 3-2.4 3.6C13 8 11.6 4.6 8.6 2.4 8.8 6 5 8.6 5 13.6 5 18.4 8 22 12 22z" /><path d="M12 22c-1.8 0-3-1.3-3-3.1 0-2 1.6-3 3-4.9 1.4 1.9 3 2.9 3 4.9 0 1.8-1.2 3.1-3 3.1z" /></>,
  ace: <><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /><path d="M5 19h14" /></>,
  clutch: <><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  funny_death: <><path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.2 4.6 3 5.8V20h10v-3.2c1.8-1.2 3-3.2 3-5.8a8 8 0 0 0-8-8z" /><circle cx="9" cy="11.5" r="1.6" fill="currentColor" /><circle cx="15" cy="11.5" r="1.6" fill="currentColor" /><path d="M10 20v-2M14 20v-2" /></>,
  laugh: <><circle cx="12" cy="12" r="9" /><path d="M7.5 13.5h9a4.5 4.5 0 0 1-9 0z" /><path d="M8 9.5l1.5-1 1.5 1M13 9.5l1.5-1 1.5 1" /></>,
  scream: <><path d="M3 10v4h3l7 4.5v-13L6 10z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13" /></>,
  marker: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  community: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.6" /><path d="M16 14.2c2.9.1 5 2.6 5 5.8" /></>,
  record: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" /></>,
  audio: <><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  chat: <><path d="M4 5h11v8H9l-4 3.5V13H4z" /><path d="M15 9h5v8h-1v3l-3.5-3H11v-2" /></>,
  scan: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  twitch: <><path d="M5 3h15v10.5L15.5 18H12l-3 3H7v-3H4V6z" /><path d="M11 7.5v4.5M15.5 7.5v4.5" /></>,
  analysis: <><path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" /><path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" /></>,
  scene: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><rect x="5.5" y="7" width="5" height="4" rx="1" /><path d="M8 21h8M12 17v4" /></>,
  all: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
};

export function Icon({ name, size = 16, stroke = 2 }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] || P.marker}
    </svg>
  );
}
