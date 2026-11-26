import { useEffect, useMemo, useRef, useState } from 'react';
import { CamEditor, CamCrop, camStatus } from './cam-editor.jsx';
import * as M from './editor-model.js';
import { MOMENT_INFO } from './demo-data.js';
import { api } from './api.js';
import { Tour, EDITOR_TOUR } from './tour.jsx';
import { THEMES } from './constants.js';
import { chatBubbleImage, userColor } from './chat-bubble.js';
import { voiceTextImage } from './voice-card.js';

const THEME_LABELS = Object.fromEntries(THEMES.map((t) => [t.id, t.label]));

const info = (t) => MOMENT_INFO[t] || { label: t, color: '#8a8a99' };
const mainMoment = (clip) => [...(clip.moments || [])].sort((a, b) => (b.score || 0) - (a.score || 0))[0];

function initProject(session) {
  // Montage déjà retouché (sauvegardé dans le dossier du stream) : on le reprend tel quel.
  if (session.project && session.project.clips) return M.attachReactions({ ...M.createProject({}), ...session.project }, session.reactions);
  const clips = session.clips.map((c) => ({
    ...c, moments: session.moments.filter((m) => m.t >= c.start && m.t <= c.end),
  }));
  return M.attachReactions(M.createProject({ clips, streamDuration: session.stream.duration, fmt: '9x16' }), session.reactions);
}

// ---------- Lecture (aperçu) ----------
function usePlayer(project) {
  const [t, setT] = useState(0);          // temps dans le montage
  const [playing, setPlaying] = useState(false);
  const total = M.totalDuration(project);
  const last = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const step = (now) => {
      const dt = last.current != null ? (now - last.current) / 1000 : 0;
      last.current = now;
      if (dt > 0) {
        setT((x) => {
          const nx = x + dt;
          if (nx >= total) { setPlaying(false); return total; }
          return nx;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, total]);
  useEffect(() => { if (t > total) setT(total); }, [total]);
  const offsets = M.clipOffsets(project);
  let idx = offsets.findIndex((o, i) => t >= o && t < o + (project.clips[i].end - project.clips[i].start));
  if (idx < 0) idx = project.clips.length - 1;
  const local = idx >= 0 ? t - offsets[idx] : 0;
  return { t, setT, playing, setPlaying: (v) => { if (v && t >= total) setT(0); setPlaying(v); }, idx, local, total };
}

/** La webcam du pote dans l'aperçu : incrustée dans un coin, ou en plein écran pendant le plan de coupe. */
function FriendPreview({ clip, t, playing, vertical }) {
  const ref = useRef(null);
  const fr = M.friendAt(clip, t);
  useEffect(() => {
    const v = ref.current;
    if (!v || !fr) return;
    if (Math.abs(v.currentTime - fr.u) > 0.3) v.currentTime = fr.u;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  });
  if (!fr) return null;
  const pos = clip.friend.pos || (vertical ? 'tr' : 'br');
  const top = vertical && clip.layout === 'cam_top' ? 35 : 2;
  const style = fr.full ? {} : {
    [pos[0] === 't' ? 'top' : 'bottom']: pos[0] === 't' ? `${top}%` : '2%', [pos[1] === 'r' ? 'right' : 'left']: '3%',
  };
  return (
    <div className={'pv-friend' + (fr.full ? ' full' : '')} style={style}>
      <video ref={ref} src={`file:///${clip.friend.file}`} muted />
      {!fr.full && <span>{clip.friend.name}</span>}
    </div>
  );
}

/** Bulle d'un message du chat dans l'aperçu : la même image que celle posée sur la vidéo à l'export. */
function ChatBubbleView({ b, fmt, layout }) {
  const img = chatBubbleImage(b, M.chatWidth(fmt));
  const pl = M.chatPlacement(fmt, layout, img.h);
  const [W, H] = fmt === '9x16' ? [1080, 1920] : [1920, 1080];
  return <img className="pv-chat" src={img.url} alt="" style={{ left: `${(pl.x / W) * 100}%`, top: `${(pl.y / H) * 100}%`, width: `${(pl.w / W) * 100}%` }} />;
}

/** Messages du chat autour du clip : cocher = bulle sur la vidéo. Ceux que tu lis à voix haute sont cochés tout seuls. */
function ChatPicker({ project, setProject, clip, chat, now }) {
  const near = M.chatNear(chat, clip).slice(0, 40);
  if (!chat.length) {
    return <div className="note">Pendant tes lives (Twitch connecté), Sklip garde les messages du chat : ceux que tu lis à voix haute
      s'affichent tout seuls, et tu pourras en ajouter ici.</div>;
  }
  if (!near.length) return <div className="note">Aucun message dans le chat pendant ce clip ni juste avant.</div>;
  return (
    <div className="chatpick">
      {near.map((m) => {
        const shown = (clip.chat || []).find((b) => b.t === m.t && b.user === m.user && b.text === m.text);
        const ago = clip.start - m.t;
        return (
          <div key={`${m.t}-${m.user}`} className={'chatrow' + (shown ? ' on' : '')}>
            <label className="check">
              <input type="checkbox" checked={!!shown} onChange={() => setProject(M.toggleChat(project, clip.id, m))} />
              <span><b style={{ color: userColor(m.user, m.color) }}>{m.user}</b> : {m.text}</span>
            </label>
            <div className="note">
              {ago > 0 ? `${Math.round(ago)} s avant le clip` : 'pendant le clip'}
              {shown && shown.auto ? ' · lu par toi' : ''}
              {shown && <button className="link" onClick={() => setProject(M.moveChat(project, clip.id, m, now))}>Afficher à partir d'ici</button>}
            </div>
          </div>);
      })}
    </div>
  );
}

/** Réplique d'un coéquipier dans l'aperçu : son agent en grand (il glisse depuis la droite) + le texte façon BD. */
function VoiceView({ v, fmt, layout, portrait }) {
  const [W, H] = fmt === '9x16' ? [1080, 1920] : [1920, 1080];
  const ratio = portrait && portrait.width ? portrait.height / portrait.width : 1.6;
  const pl = M.voicePlacement(fmt, layout, ratio);
  const txt = voiceTextImage(v.text, pl.text.w);
  const box = (r) => ({ left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%` });
  return (
    <>
      {portrait && <img className="pv-agent" src={`file:///${portrait.file}`} alt={v.name} style={box(pl.agent)} />}
      <img className="pv-voice" src={txt.url} alt="" style={box(pl.text)} />
    </>
  );
}

/** Répliques des coéquipiers (vocal du jeu) : cocher = l'agent et sa phrase s'affichent sur la vidéo. */
function VoicePicker({ project, setProject, clip, agents, now }) {
  const voices = clip.voices || [];
  return (
    <div className="voicepick">
      {!voices.length && <div className="note">Personne n'a parlé dans le vocal du jeu pendant ce clip (ou Sklip ne l'a pas vu).
        Tu peux quand même faire parler un agent :</div>}
      {voices.map((v, i) => (
        <div key={i} className={'voicerow' + (v.on ? ' on' : '')}>
          <div className="row nowrap">
            <input type="checkbox" checked={!!v.on} title="Afficher sur la vidéo"
              onChange={(e) => setProject(M.setVoice(project, clip.id, i, { on: e.target.checked }))} />
            <select value={v.agent || ''} onChange={(e) => {
              const a = agents.find((x) => x.uuid === e.target.value);
              setProject(M.setVoice(project, clip.id, i, { agent: a ? a.uuid : null, name: a ? a.name : '?' }));
            }}>
              {!agents.some((a) => a.uuid === v.agent) && <option value={v.agent || ''}>{v.name || 'Agent ?'}</option>}
              {agents.map((a) => <option key={a.uuid} value={a.uuid}>{a.name}</option>)}
            </select>
            <span className="note">{M.fmtTime(v.start)}{v.auto ? ' · entendu' : ''}</span>
            <button className="link" onClick={() => setProject(M.removeVoice(project, clip.id, i))}>Retirer</button>
          </div>
          <input className="voicetext" value={v.text} placeholder="Ce que dit l'agent…"
            onChange={(e) => setProject(M.setVoice(project, clip.id, i, { text: e.target.value }))} />
        </div>))}
      <button className="btn ghost sm" disabled={!agents.length}
        onClick={() => setProject(M.addVoice(project, clip.id, now, agents[0]))}>+ Faire parler un agent ici</button>
      {!agents.length && <div className="note">Liste des agents indisponible (pas de connexion internet ?).</div>}
    </div>
  );
}

function Preview({ project, player, videoSrc, cam, camManual = false, portraits = {}, needPortrait = () => {} }) {
  const clip = project.clips[player.idx];
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip) return;
    const want = clip.start + player.local;
    if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
    if (player.playing && v.paused) v.play().catch(() => {});
    if (!player.playing && !v.paused) v.pause();
  });
  const vertical = project.fmt === '9x16';
  const layout = clip ? clip.layout : 'cam_top';
  const mm = clip && mainMoment(clip);
  const showText = project.texts.enabled && mm;
  const theCam = clip ? M.clipCam(clip, cam, camManual) : cam;
  const camBox = videoSrc && theCam && clip
    ? <CamCrop src={videoSrc} cam={theCam} time={clip.start + player.local} playing={player.playing} boxRatio={1080 / 640} />
    : <div className="pv-cam">CAM</div>;
  const camFull = vertical && layout === 'cam_full';
  const gameBox = (
    <div className="pv-game" style={{ '--c': mm ? info(mm.type).color : '#333' }}>
      {videoSrc ? <video ref={videoRef} src={videoSrc} muted={false} /> : (
        <span>{clip ? `${mm ? info(mm.type).label : 'Clip'} · ${M.fmtTime(clip.start + player.local)}` : 'Aucun clip'}</span>
      )}
    </div>
  );
  return (
    <div className={'preview ' + (vertical ? 'v' : 'h')}>
      <div className="pv-frame">
        {vertical && layout === 'cam_top' && camBox}
        {camFull && (videoSrc && theCam && clip
          ? <CamCrop src={videoSrc} cam={theCam} time={clip.start + player.local} playing={player.playing} boxRatio={1080 / 1920} full focus={clip.focus} />
          : <div className="pv-cam full">CAM EN GRAND</div>)}
        {camFull ? <div className="pv-hidden">{gameBox}</div> : gameBox}
        {vertical && layout === 'cam_bottom' && camBox}
        {!vertical && !videoSrc && <div className="pv-cam pv-cam-corner">CAM</div>}
        {showText && mm.type === 'ace' && project.texts.ace && <div className="pv-text big">ACE</div>}
        {showText && ['multikill', 'kill'].includes(mm.type) && project.texts.killCounter && (
          <div className="pv-text">{mm.meta?.count ? `${mm.meta.count} KILLS` : 'KILL'}{mm.meta?.knives?.length ? <><br />AU COUTEAU</> : null}</div>)}
        {clip && clip.friend && <FriendPreview clip={clip} t={clip.start + player.local} playing={player.playing} vertical={vertical} />}
        {clip && (() => {
          const v = M.voiceAt(clip, clip.start + player.local);
          if (!v) return null;
          if (!(v.agent in portraits)) needPortrait(v.agent);
          return <VoiceView v={v} fmt={project.fmt} layout={layout} portrait={portraits[v.agent]} />;
        })()}
        {clip && M.chatAt(clip, clip.start + player.local).map((b) => (
          <ChatBubbleView key={`${b.t}-${b.user}`} b={b} fmt={project.fmt} layout={layout} />))}
        {project.texts.enabled && project.texts.pseudo && <div className="pv-pseudo">{project.texts.pseudo}</div>}
        {project.texts.subtitles && clip && (() => {
          const st = M.subtitleAt(clip, clip.start + player.local);
          if (!st) return null;
          return <div className={'pv-sub' + (vertical ? '' : ' h')}>{st.words.map((w, i) => (
            <span key={i} className={i === st.current ? 'on' : ''}>{w.toUpperCase()} </span>))}</div>;
        })()}
      </div>
    </div>
  );
}

// ---------- Timeline ----------
function Timeline({ project, setProject, selected, setSelected, player, speech }) {
  const [pps, setPps] = useState(28);        // pixels par seconde (zoom)
  const [drag, setDrag] = useState(null);    // { id, x0, dx, insert } | { trim, id, edge, x0, snap }
  const offsets = M.clipOffsets(project);
  const total = M.totalDuration(project);
  const ref = useRef(null);

  const onClipDown = (e, clip) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(clip.id);
    setDrag({ id: clip.id, x0: e.clientX, dx: 0, insert: null });
  };
  const onTrimDown = (e, clip, edge) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(clip.id);
    setDrag({ trim: true, id: clip.id, edge, x0: e.clientX, snap: project });
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    if (drag.trim) {
      setProject(M.trimClip(drag.snap, drag.id, drag.edge, dx / pps, speech));
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left + ref.current.scrollLeft - 12) / pps;
    let insert = project.clips.length;
    for (let i = 0; i < project.clips.length; i++) {
      const mid = offsets[i] + (project.clips[i].end - project.clips[i].start) / 2;
      if (x < mid) { insert = i; break; }
    }
    setDrag({ ...drag, dx, insert });
  };
  const onUp = () => {
    if (drag && !drag.trim && Math.abs(drag.dx) > 4 && drag.insert != null) {
      setProject(M.moveClip(project, drag.id, drag.insert));
    }
    setDrag(null);
  };
  const seek = (e) => {
    if (e.target !== e.currentTarget && !e.target.classList.contains('ruler')) return;
    const rect = ref.current.getBoundingClientRect();
    player.setT(Math.max(0, Math.min(total, (e.clientX - rect.left + ref.current.scrollLeft - 12) / pps)));
  };

  const ticks = [];
  const tickStep = pps > 40 ? 1 : pps > 15 ? 5 : 10;
  for (let s = 0; s <= total + tickStep; s += tickStep) ticks.push(s);
  const beats = project.bpm ? Array.from({ length: Math.floor(total * project.bpm / 60) + 1 }, (_, i) => i * 60 / project.bpm) : [];
  const insertX = drag && !drag.trim && drag.insert != null && Math.abs(drag.dx) > 4
    ? (drag.insert < project.clips.length ? offsets[drag.insert] : total) * pps : null;

  return (
    <div className="timeline-wrap" data-tour="timeline">
      <div className="tl-tools">
        <span className="note">Glisse un clip pour le déplacer · tire ses bords pour le rogner</span>
        <div className="row">
          <span className="note">Zoom</span>
          <input type="range" min="8" max="80" value={pps} onChange={(e) => setPps(Number(e.target.value))} />
        </div>
      </div>
      <div className="timeline" ref={ref} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={seek}>
        <div className="tl-inner" style={{ width: Math.max(total * pps + 200, 600) }}>
          <div className="ruler">
            {ticks.map((s) => <span key={s} style={{ left: s * pps }}>{M.fmtTime(s)}</span>)}
          </div>
          {beats.map((b, i) => <div key={i} className={'beat' + (i % 4 === 0 ? ' bar1' : '')} style={{ left: b * pps }} />)}
          <div className="tl-track">
            {project.clips.map((c, i) => {
              const mm = mainMoment(c);
              const dragging = drag && !drag.trim && drag.id === c.id && Math.abs(drag.dx) > 4;
              const cut = M.cutsSentence(c, speech);
              return (
                <div key={c.id}
                  className={'tl-clip' + (selected === c.id ? ' sel' : '') + (dragging ? ' dragging' : '')}
                  style={{ left: offsets[i] * pps, width: (c.end - c.start) * pps, '--c': mm ? info(mm.type).color : '#666',
                    transform: dragging ? `translateX(${drag.dx}px)` : undefined }}
                  onPointerDown={(e) => onClipDown(e, c)}>
                  <div className={'h l' + (cut.start ? ' cuts' : '')} title={cut.start ? 'Coupe une phrase' : undefined}
                    onPointerDown={(e) => onTrimDown(e, c, 'start')} />
                  <div className="tl-label">
                    <b>{mm ? info(mm.type).label : 'Clip'}{M.hasLiveMusic(project, c) && <span title="Musique du live gardée"> 🎵</span>}</b>
                    <span>{(c.end - c.start).toFixed(1)} s</span>
                  </div>
                  <div className={'h r' + (cut.end ? ' cuts' : '')} title={cut.end ? 'Coupe une phrase' : undefined}
                    onPointerDown={(e) => onTrimDown(e, c, 'end')} />
                </div>
              );
            })}
            {insertX != null && <div className="insert" style={{ left: insertX }} />}
          </div>
          <div className="playhead" style={{ left: player.t * pps }} />
        </div>
      </div>
    </div>
  );
}

// ---------- Mixeur ----------
/** Allonger / raccourcir un clip : la vidéo du stream continue de chaque côté, on peut toujours reprendre plus large. */
function ClipBounds({ project, setProject, clip, speech }) {
  const nudge = (edge, d) => setProject(M.trimClip(project, clip.id, edge, d));
  const cut = M.cutsSentence(clip, speech);
  return (
    <div className="bounds">
      <div className="bounds-row">
        <span>Début</span>
        <button className="btn sm ghost" title="Commencer 1 s plus tôt" onClick={() => nudge('start', -1)}>−1 s</button>
        <button className="btn sm ghost" title="Commencer 1 s plus tard" onClick={() => nudge('start', 1)}>+1 s</button>
        <span className="sp" />
        <span>Fin</span>
        <button className="btn sm ghost" title="Finir 1 s plus tôt" onClick={() => nudge('end', -1)}>−1 s</button>
        <button className="btn sm ghost" title="Finir 1 s plus tard" onClick={() => nudge('end', 1)}>+1 s</button>
      </div>
      {(cut.start || cut.end) && (
        <div className="bounds-warn">
          ✂️ Ce clip coupe une phrase {cut.start && cut.end ? 'au début et à la fin' : cut.start ? 'au début' : 'à la fin'}.
          <button className="link" onClick={() => setProject(M.fitToSentences(project, clip.id, speech))}>Ajuster aux phrases</button>
        </div>)}
    </div>
  );
}

function Fader({ label, value, onChange, inherited }) {
  const muted = value === 0;
  return (
    <div className={'fader' + (inherited ? ' inherit' : '')}>
      <div className="fader-top"><span>{label}</span><span className="note">{Math.round(value * 100)} %</span></div>
      <div className="row nowrap">
        <button className={'mute' + (muted ? ' on' : '')} title={muted ? 'Réactiver' : 'Couper'}
          onClick={() => onChange(muted ? 1 : 0)}>{muted ? '🔇' : '🔊'}</button>
        <input type="range" min="0" max="2" step="0.05" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

// ---------- Éditeur ----------
export function Editor({ session, onBack, onTheme, showTour, onTourDone }) {
  const [project, setProject] = useState(() => initProject(session));
  // Sauvegarde automatique (1 s après la dernière modification) : rien n'est perdu en fermant l'éditeur.
  useEffect(() => {
    if (!session.stream.folder || !window.sklip) return undefined;
    const t = setTimeout(() => api.saveProject(session.stream.folder, session.theme, project), 1000);
    return () => clearTimeout(t);
  }, [project]);
  const [selected, setSelected] = useState(project.clips[0]?.id || null);
  const [exportState, setExportState] = useState(null);
  const player = usePlayer(project);
  const clip = project.clips.find((c) => c.id === selected);
  const [subsJob, setSubsJob] = useState(null);
  const [friendMsg, setFriendMsg] = useState(null);
  const [agents, setAgents] = useState([]);           // agents Valorant (liste de l'éditeur)
  const [portraits, setPortraits] = useState({});     // uuid → { file, width, height } | null
  useEffect(() => { if (api.agentsList) api.agentsList().then((l) => setAgents(l || [])).catch(() => {}); }, []);
  const portraitAsked = useRef(new Set());
  const needPortrait = (uuid) => {
    if (!uuid || portraitAsked.current.has(uuid) || !api.agentPortrait) return;
    portraitAsked.current.add(uuid);
    api.agentPortrait(uuid).then((p) => setPortraits((x) => ({ ...x, [uuid]: p || null }))).catch(() => {});
  };
  const [askTo, setAskTo] = useState('');
  const [together, setTogether] = useState([]);   // potes en chat partagé pendant le clip sélectionné
  const selClip = project.clips.find((c) => c.id === selected);
  useEffect(() => {
    setFriendMsg(null);
    if (!selClip || !session.stream.folder || !api.friendsForClip) { setTogether([]); return; }
    api.friendsForClip(session.stream.folder, { start: selClip.start, end: selClip.end })
      .then((l) => { setTogether(l || []); setAskTo((l || [])[0] || ''); }).catch(() => setTogether([]));
  }, [selected, selClip && selClip.start, selClip && selClip.end]);
  // Réaction d'un pote reçue pendant que l'éditeur est ouvert : on l'ajoute au clip concerné.
  useEffect(() => api.onFriendsEvent && api.onFriendsEvent(async (ev) => {
    if (ev.type !== 'reaction-received' || !session.stream.folder) return;
    const es = await api.editorSession(session.stream.folder, session.theme);
    setProject((p) => M.attachReactions(p, es.reactions));
    setFriendMsg(ev.status === 'ok' ? `Réaction de ${ev.friend} reçue` : `${ev.friend} : ${M.reactionStatusText(ev.status)}`);
  }), []);
  const subsPending = useRef(new Set());

  // Sous-titres activés : on génère ceux des clips qui n'en ont pas encore (clips ajoutés compris).
  useEffect(() => {
    if (!project.texts.subtitles || !session.stream.video) return;
    const missing = project.clips.filter((c) => c.subs === null && !subsPending.current.has(c.id));
    if (!missing.length) return;
    missing.forEach((c) => subsPending.current.add(c.id));
    setSubsJob({ count: missing.length });
    api.engine('transcribe', { video: session.stream.video, tracks: session.tracks || {},
      clips: missing.map((c) => ({ id: c.id, start: c.start, end: c.end })) })
      .then((r) => setProject((p) => Object.entries(r.clips || {}).reduce((acc, [id, words]) => M.setClipWords(acc, id, words), p)))
      .catch((e) => setSubsJob({ error: String(e.message || e) }))
      .finally(() => { missing.forEach((c) => subsPending.current.delete(c.id)); setSubsJob((j) => (j && j.error ? j : null)); });
  }, [project.texts.subtitles, project.clips.map((c) => `${c.id}:${c.subs === null}`).join()]);

  const seekStream = (c, t) => {
    const i = project.clips.findIndex((x) => x.id === c.id);
    player.setT(M.clipOffsets(project)[i] + Math.max(0, t - c.start));
  };
  const total = M.totalDuration(project);

  useEffect(() => api.onEngineProgress((p) => p.command === 'render' && setExportState((s) => ({ ...s, ...p }))), []);
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;   // on écrit : pas de raccourci
      if (e.code === 'Space') { e.preventDefault(); player.setPlaying(!player.playing); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        setProject((p) => M.removeClip(p, selected)); setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const moments = useMemo(() => [...session.moments].sort((a, b) => a.t - b.t), [session]);

  // Webcam : réglage de ce stream (project.cam) s'il existe, sinon celle trouvée toute seule / le réglage de base.
  const [camOpen, setCamOpen] = useState(false);
  const cam = project.cam ? (project.cam.enabled === false ? null : project.cam) : session.cam;
  const camSource = project.cam ? (project.cam.enabled === false ? 'none' : project.cam.auto ? 'auto' : 'project') : session.camSource;

  // « Cam en grand » choisi dans l'éditeur : on demande au moteur où est le visage (une fois par clip).
  // focus : undefined = pas encore cherché, null = rien trouvé (centre de la webcam).
  const focusPending = useRef(new Set());
  useEffect(() => {
    if (!session.stream.video || !window.sklip) return;
    for (const c of project.clips) {
      const camC = M.clipCam(c, cam, ['manual', 'project'].includes(camSource));
      if (c.layout !== 'cam_full' || c.focus !== undefined || !camC || focusPending.current.has(c.id)) continue;
      focusPending.current.add(c.id);
      api.engine('focus', { video: session.stream.video, cam: camC, start: c.start, end: c.end })
        .then((r) => setProject((p) => M.updateClip(p, c.id, { focus: (r && r.focus) || null })))
        .catch(() => setProject((p) => M.updateClip(p, c.id, { focus: null })))
        .finally(() => focusPending.current.delete(c.id));
    }
  }, [project.clips.map((c) => `${c.id}:${c.layout}:${c.focus === undefined}`).join(), cam]);

  const doExport = async () => {
    setExportState({ fraction: 0, message: 'Préparation…' });
    const name = `sklip_${session.theme}_${project.fmt}${project.bpm ? `_${Math.round(project.bpm)}bpm` : ''}.mp4`;
    const output = session.stream.folder ? `${session.stream.folder}/montages/${name}` : name;
    const post = M.suggestPost(project, { streamTitle: session.stream.title, theme: session.theme, channel: session.channel });
    try {
      // Bulles du chat : dessinées ici (comme dans l'aperçu), enregistrées en PNG, posées sur la vidéo par le moteur.
      const stickers = {};
      for (const c of project.clips) {
        for (const [k, b] of (c.chat || []).entries()) {
          if (b.end <= c.start || b.start >= c.end) continue;      // clip raccourci depuis : la bulle n'y est plus
          const img = chatBubbleImage(b, M.chatWidth(project.fmt));
          const file = await api.saveSticker(session.stream.folder, `chat_${c.id}_${k}`, img.url);
          if (!file) continue;
          const pl = M.chatPlacement(project.fmt, c.layout, img.h);
          (stickers[c.id] = stickers[c.id] || []).push({ file, start: Math.max(0, b.start - c.start), end: Math.min(c.end, b.end) - c.start,
            x: pl.x, y: pl.y, w: pl.w, anim: 'fade' });
        }
      }
      // Répliques des coéquipiers : le grand portrait de l'agent (glisse depuis la droite) puis sa phrase façon BD.
      for (const c of project.clips) {
        for (const [k, v] of (c.voices || []).entries()) {
          if (!v.on || !v.agent || !v.text.trim()) continue;
          const shown = M.voiceShown(c, v);
          if (shown.end <= shown.start) continue;
          const portrait = await api.agentPortrait(v.agent).catch(() => null);
          const ratio = portrait && portrait.width ? portrait.height / portrait.width : 1.6;
          const pl = M.voicePlacement(project.fmt, c.layout, ratio);
          const txt = voiceTextImage(v.text, pl.text.w);
          const txtFile = await api.saveSticker(session.stream.folder, `voice_${c.id}_${k}`, txt.url);
          const at = { start: shown.start - c.start, end: shown.end - c.start };
          const list = (stickers[c.id] = stickers[c.id] || []);
          if (portrait) list.push({ file: portrait.file, ...at, ...pl.agent, anim: 'slide' });
          if (txtFile) list.push({ file: txtFile, ...at, ...pl.text, anim: 'fade' });
        }
      }
      const spec = M.toRenderSpec(project, { video: session.stream.video, output, cam, tracks: session.tracks || {}, post,
        camManual: ['manual', 'project'].includes(camSource), stickers });
      const res = await api.engine('render', spec);
      setExportState({ fraction: 1, message: 'Montage exporté', output: res.output });
    } catch (e) {
      setExportState({ error: String(e.message || e) });
    }
  };

  return (
    <div className="editor">
      <header className="ed-head">
        <div className="row">
          <button className="btn ghost sm" onClick={onBack}>← Retour</button>
          <div>
            <div className="ed-title">{session.stream.title}</div>
            <div className="note row nowrap">Thème :
              {(session.themes || [session.theme]).length > 1 ? (
                <select value={session.theme} onChange={(e) => onTheme && onTheme(e.target.value)} style={{ padding: '2px 6px' }}>
                  {session.themes.map((t) => <option key={t} value={t}>{THEME_LABELS[t] || t}</option>)}</select>
              ) : ` ${THEME_LABELS[session.theme] || session.theme}`} · cible {session.target} s</div>
          </div>
        </div>
        <div className="row">
          <div className="row" data-tour="format"><div className="seg">
            {['9x16', '16x9'].map((f) => (
              <button key={f} className={project.fmt === f ? 'on' : ''} onClick={() => setProject({ ...project, fmt: f })}>
                {f.replace('x', ':')}</button>))}
          </div>
          <label className="row nowrap note">BPM
            <input type="number" min="60" max="200" placeholder="—" value={project.bpm || ''} style={{ width: 70 }}
              onChange={(e) => setProject({ ...project, bpm: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <div className={'dur' + (total > 60 ? ' over' : '')}>{total.toFixed(1)} s</div></div>
          <button className="btn ghost sm" title={`Webcam : ${camStatus(camSource)}`} onClick={() => setCamOpen(true)}>
            📷 Webcam{camSource === 'auto_failed' ? ' ⚠' : ''}</button>
          <button className="btn" data-tour="export" onClick={doExport} disabled={!project.clips.length}>Exporter</button>
        </div>
      </header>

      <div className="ed-body">
        <section className="panel moments" data-tour="moments">
          <h3>Moments détectés</h3>
          <div className="list">
            {moments.map((m, i) => {
              const used = M.isMomentUsed(project, m);
              return (
                <div key={i} className={'mrow' + (used ? ' used' : '')}>
                  <span className="mdot" style={{ background: info(m.type).color }} />
                  <div className="grow">
                    <div>{info(m.type).label}{m.meta?.count ? ` ×${m.meta.count}` : ''}{m.meta?.channel ? ` · ${m.meta.channel}` : ''}</div>
                    <div className="note">{M.fmtTime(m.t)}</div>
                  </div>
                  {used ? <span className="note">dans le montage</span> : (
                    <button className="btn ghost sm" onClick={() => {
                      const p = M.addMoment(project, m);
                      setProject(p); setSelected(p.clips[p.clips.length - 1].id);
                    }}>+ Ajouter</button>)}
                </div>);
            })}
          </div>
        </section>

        <section className="stage" data-tour="preview">
          <Preview project={project} player={player} videoSrc={session.stream.video ? `file:///${session.stream.video}` : null} cam={cam}
            camManual={['manual', 'project'].includes(camSource)} portraits={portraits} needPortrait={needPortrait} />
          <div className="transport">
            <button className="btn sm" onClick={() => player.setPlaying(!player.playing)}>{player.playing ? '⏸ Pause' : '▶ Lire'}</button>
            <span className="note">{M.fmtTime(player.t)} / {M.fmtTime(total)}</span>
          </div>
        </section>

        <section className="panel props" data-tour="props">
          {clip ? (
            <>
              <h3>Clip sélectionné</h3>
              <div className="note" style={{ marginBottom: 12 }}>
                Dans le stream : {M.fmtTime(clip.start)} → {M.fmtTime(clip.end)} ({(clip.end - clip.start).toFixed(1)} s)
              </div>
              <ClipBounds project={project} setProject={setProject} clip={clip} speech={session.speech} />
              {project.fmt === '9x16' && (
                <>
                  <div className="lbl">Mise en page 9:16</div>
                  <div className="seg full">
                    {Object.entries(M.LAYOUTS).map(([k, v]) => (
                      <button key={k} className={clip.layout === k ? 'on' : ''}
                        onClick={() => setProject(M.updateClip(project, clip.id, { layout: k }))}>{v}</button>))}
                  </div>
                  {M.blurryFull(clip, cam, ['manual', 'project'].includes(camSource)) && (
                    <div className="blur-tip">
                      Ta webcam est petite dans ce passage : en grand, l'image sera floue.
                      <button className="link" onClick={() => setProject(M.updateClip(project, clip.id, { layout: 'cam_top' }))}>Mettre « Cam en haut »</button>
                    </div>)}
                </>)}
              <label className={'livemusic' + (M.hasLiveMusic(project, clip) ? ' on' : '')}>
                <input type="checkbox" checked={M.hasLiveMusic(project, clip)}
                  onChange={(e) => setProject(M.setLiveMusic(project, clip.id, e.target.checked))} />
                <div>
                  <b>🎵 Garder la musique du live</b>
                  <div className="note">On entend la chanson qui passait pendant cet extrait (pratique si tu chantes dessus).
                    {session.tracks && !session.tracks.music
                      ? " Ici, la musique est déjà mélangée au son du stream : elle s'entend dans tous les cas."
                      : ' Attention : une chanson connue peut faire couper le son ou bloquer la vidéo sur TikTok / YouTube.'}</div>
                </div>
              </label>
              <div className="lbl">Son de ce clip</div>
              {M.TRACKS.map((tr) => (
                <div key={tr} className="clipfader">
                  <Fader label={M.TRACK_LABELS[tr]} value={M.effectiveVolume(project, clip, tr)}
                    inherited={clip.volumes[tr] == null}
                    onChange={(v) => setProject(M.setClipVolume(project, clip.id, tr, v))} />
                  {clip.volumes[tr] != null && (
                    <button className="link" onClick={() => setProject(M.setClipVolume(project, clip.id, tr, null))}>
                      Suivre le réglage global</button>)}
                </div>))}
              <div className="lbl">Réaction d'un pote</div>
              {clip.friend ? (
                <div className="friendbox">
                  <div><b>{clip.friend.name}</b> <span className="note">(sa webcam, son son vient de ta piste Discord)</span></div>
                  <div className="seg full">
                    {Object.entries(M.REACTION_MODES).map(([k, v]) => (
                      <button key={k} className={clip.friend.mode === k ? 'on' : ''}
                        onClick={() => setProject(M.setFriend(project, clip.id, { mode: k }))}>{v}</button>))}
                  </div>
                  {clip.friend.mode === 'pip' ? (
                    <select value={clip.friend.pos || (project.fmt === '9x16' ? 'tr' : 'br')}
                      onChange={(e) => setProject(M.setFriend(project, clip.id, { pos: e.target.value }))}>
                      {Object.entries(M.PIP_POSITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : (
                    <div className="row">
                      <span className="note">À {M.fmtTime(clip.friend.cutT)}</span>
                      <button className="btn ghost sm" onClick={() => setProject(M.setFriend(project, clip.id, { cutT: Math.round((clip.start + player.local) * 100) / 100 }))}>Placer ici</button>
                      <select value={clip.friend.cutDur} onChange={(e) => setProject(M.setFriend(project, clip.id, { cutDur: Number(e.target.value) }))}>
                        {M.CUT_DURATIONS.map((d) => <option key={d} value={d}>{d} s</option>)}
                      </select>
                    </div>
                  )}
                  <button className="link" onClick={() => setProject(M.setFriend(project, clip.id, null))}>Retirer la réaction</button>
                </div>
              ) : together.length ? (
                <div className="row">
                  <select value={askTo} onChange={(e) => setAskTo(e.target.value)}>
                    {together.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button className="btn ghost sm" onClick={async () => {
                    try {
                      await api.friendsRequest(session.stream.folder, { start: clip.start, end: clip.end, moments: clip.moments }, askTo);
                      setFriendMsg(`Demande envoyée à ${askTo}. Sa réaction arrivera ici toute seule.`);
                    } catch (e) { setFriendMsg(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
                  }}>Demander sa réaction</button>
                </div>
              ) : <div className="note">Aucun ami de confiance en chat partagé avec toi pendant ce clip.</div>}
              {friendMsg && <div className="note friendmsg">{friendMsg}</div>}
              <div className="lbl">Ce que disent tes coéquipiers</div>
              <VoicePicker project={project} setProject={setProject} clip={clip} agents={agents}
                now={Math.round((clip.start + player.local) * 100) / 100} />
              <div className="lbl">Messages du chat sur la vidéo</div>
              <ChatPicker project={project} setProject={setProject} clip={clip} chat={session.chat || []}
                now={Math.round((clip.start + player.local) * 100) / 100} />
              <button className="btn ghost danger" style={{ marginTop: 14 }}
                onClick={() => { setProject(M.removeClip(project, clip.id)); setSelected(null); }}>Retirer ce clip</button>
            </>
          ) : <div className="note">Sélectionne un clip dans la timeline.</div>}

          <h3 style={{ marginTop: 26 }}>Sous-titres</h3>
          <label className="check"><input type="checkbox" checked={project.texts.subtitles}
            onChange={(e) => setProject({ ...project, texts: { ...project.texts, subtitles: e.target.checked } })} /> Sous-titres auto, mot par mot</label>
          {project.texts.subtitles && clip && (
            <div className="subs">
              {subsJob && !subsJob.error && <div className="note">Écoute de ta voix et écriture des sous-titres…</div>}
              {subsJob && subsJob.error && <div className="bad">Sous-titres impossibles : {subsJob.error}</div>}
              {clip.subs && clip.subs.length === 0 && <div className="note">Rien n'a été dit dans ce clip.</div>}
              {clip.subs && clip.subs.map((line, i) => (
                <div key={`${line.start}-${M.lineText(line)}`} className="subline">
                  <button className="link" title="Écouter ce passage" onClick={() => seekStream(clip, line.start)}>{M.fmtTime(line.start - clip.start)}</button>
                  <textarea rows={2} defaultValue={M.lineText(line)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}
                    onBlur={(e) => { if (e.target.value !== M.lineText(line)) setProject(M.setLineText(project, clip.id, i, e.target.value)); }} />
                  <button className="link danger" title="Supprimer la ligne" onClick={() => setProject(M.setLineText(project, clip.id, i, ''))}>✕</button>
                </div>))}
              {clip.subs && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn ghost sm" onClick={() => {
                    const here = project.clips[player.idx]?.id === clip.id ? clip.start + player.local : clip.start;
                    setProject(M.addLine(project, clip.id, here, 'Ton texte'));
                  }}>+ Ajouter une ligne ici</button>
                  <button className="link" onClick={() => { if (window.confirm('Réécrire les sous-titres de ce clip ? Tes corrections seront perdues.')) setProject(M.updateClip(project, clip.id, { subs: null })); }}>Regénérer</button>
                </div>)}
              <div className="note">Clique dans une ligne pour corriger une faute ou écrire une blague. Entrée pour valider.</div>
            </div>)}

          <h3 style={{ marginTop: 26 }}>Textes à l'écran</h3>
          <label className="check"><input type="checkbox" checked={project.texts.enabled}
            onChange={(e) => setProject({ ...project, texts: { ...project.texts, enabled: e.target.checked } })} /> Activer</label>
          {project.texts.enabled && (
            <>
              <label className="check"><input type="checkbox" checked={project.texts.ace}
                onChange={(e) => setProject({ ...project, texts: { ...project.texts, ace: e.target.checked } })} /> « ACE »</label>
              <label className="check"><input type="checkbox" checked={project.texts.killCounter}
                onChange={(e) => setProject({ ...project, texts: { ...project.texts, killCounter: e.target.checked } })} /> Compteur de kills</label>
              <input placeholder="Pseudo (optionnel)" value={project.texts.pseudo}
                onChange={(e) => setProject({ ...project, texts: { ...project.texts, pseudo: e.target.value } })} />
            </>)}
        </section>
      </div>

      <div className="mixer" data-tour="mixer">
        <div className="mixer-title">Mixeur<span className="note">tout le montage</span></div>
        {M.TRACKS.map((tr) => (
          <Fader key={tr} label={M.TRACK_LABELS[tr]} value={project.volumes[tr]}
            onChange={(v) => setProject(M.setGlobalVolume(project, tr, v))} />))}
        <div className="mixer-hint">
          <label className="check" title="Chaque son est remis à niveau, la musique baisse quand tu parles, et le volume final suit TikTok / YouTube.">
            <input type="checkbox" checked={project.autoMix !== false} onChange={(e) => setProject({ ...project, autoMix: e.target.checked })} />
            <b>Mixage auto</b></label>
          <div className="note">{project.autoMix !== false
            ? 'Ta voix reste devant : le jeu et la musique sont remis à niveau et baissent quand tu parles. 100 % = niveau idéal.'
            : "Volumes bruts : chaque piste garde son volume d'origine."}
            {project.volumes.music === 0 && ' Musique coupée : évite les problèmes de droits.'}</div>
        </div>
      </div>

      <Timeline project={project} setProject={setProject} selected={selected} setSelected={setSelected} player={player}
        speech={session.speech} />

      {showTour && <Tour steps={EDITOR_TOUR} onDone={onTourDone} />}

      {camOpen && (
        <CamEditor videoSrc={session.stream.video ? `file:///${session.stream.video}` : null}
          time={clip ? clip.start + (player.idx >= 0 && project.clips[player.idx] === clip ? player.local : 0) : 0}
          cam={cam} detected={session.camDetected}
          onApply={async (rect, remember) => {
            setProject({ ...project, cam: { ...rect, enabled: true } });
            if (remember) await api.updateSettings({ cam: { ...rect, enabled: true, auto: false } });
            setCamOpen(false);
          }}
          onAuto={async () => {
            const d = session.camDetected;
            setProject({ ...project, cam: { x: d.x, y: d.y, w: d.w, h: d.h, enabled: true, auto: true } });
            await api.updateSettings({ cam: { enabled: true, auto: true } });
            setCamOpen(false);
          }}
          onNone={() => { setProject({ ...project, cam: { enabled: false } }); setCamOpen(false); }}
          onClose={() => setCamOpen(false)} />
      )}
      {exportState && (
        <div className="toast">
          {exportState.error ? <span className="bad">Échec de l'export : {exportState.error}</span> : (
            <>
              <div>{exportState.message}</div>
              <div className="bar"><div style={{ width: `${Math.round((exportState.fraction || 0) * 100)}%` }} /></div>
            </>)}
          <button className="link" onClick={() => setExportState(null)}>Fermer</button>
        </div>)}
    </div>
  );
}
