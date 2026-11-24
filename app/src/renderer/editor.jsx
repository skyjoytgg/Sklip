import { useEffect, useMemo, useRef, useState } from 'react';
import * as M from './editor-model.js';
import { MOMENT_INFO } from './demo-data.js';
import { api } from './api.js';

const info = (t) => MOMENT_INFO[t] || { label: t, color: '#8a8a99' };
const mainMoment = (clip) => [...(clip.moments || [])].sort((a, b) => (b.score || 0) - (a.score || 0))[0];

function initProject(session) {
  const clips = session.clips.map((c) => ({
    ...c, moments: session.moments.filter((m) => m.t >= c.start && m.t <= c.end),
  }));
  return M.createProject({ clips, streamDuration: session.stream.duration, fmt: '9x16' });
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

function Preview({ project, player, videoSrc }) {
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
  const camBox = <div className="pv-cam">CAM</div>;
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
        {gameBox}
        {vertical && layout === 'cam_bottom' && camBox}
        {!vertical && <div className="pv-cam pv-cam-corner">CAM</div>}
        {showText && mm.type === 'ace' && project.texts.ace && <div className="pv-text big">ACE</div>}
        {showText && ['multikill', 'kill'].includes(mm.type) && project.texts.killCounter && (
          <div className="pv-text">{mm.meta?.count ? `${mm.meta.count} KILLS` : 'KILL'}</div>)}
        {project.texts.enabled && project.texts.pseudo && <div className="pv-pseudo">{project.texts.pseudo}</div>}
        {project.texts.subtitles && clip && <div className={'pv-sub' + (vertical ? '' : ' h')}>OH NON <span>REGARDE</span></div>}
      </div>
    </div>
  );
}

// ---------- Timeline ----------
function Timeline({ project, setProject, selected, setSelected, player }) {
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
      setProject(M.trimClip(drag.snap, drag.id, drag.edge, dx / pps));
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
    <div className="timeline-wrap">
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
              return (
                <div key={c.id}
                  className={'tl-clip' + (selected === c.id ? ' sel' : '') + (dragging ? ' dragging' : '')}
                  style={{ left: offsets[i] * pps, width: (c.end - c.start) * pps, '--c': mm ? info(mm.type).color : '#666',
                    transform: dragging ? `translateX(${drag.dx}px)` : undefined }}
                  onPointerDown={(e) => onClipDown(e, c)}>
                  <div className="h l" onPointerDown={(e) => onTrimDown(e, c, 'start')} />
                  <div className="tl-label">
                    <b>{mm ? info(mm.type).label : 'Clip'}</b>
                    <span>{(c.end - c.start).toFixed(1)} s</span>
                  </div>
                  <div className="h r" onPointerDown={(e) => onTrimDown(e, c, 'end')} />
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
export function Editor({ session, onBack }) {
  const [project, setProject] = useState(() => initProject(session));
  const [selected, setSelected] = useState(project.clips[0]?.id || null);
  const [exportState, setExportState] = useState(null);
  const player = usePlayer(project);
  const clip = project.clips.find((c) => c.id === selected);
  const total = M.totalDuration(project);

  useEffect(() => api.onEngineProgress((p) => p.command === 'render' && setExportState((s) => ({ ...s, ...p }))), []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); player.setPlaying(!player.playing); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        setProject((p) => M.removeClip(p, selected)); setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const moments = useMemo(() => [...session.moments].sort((a, b) => a.t - b.t), [session]);

  const doExport = async () => {
    setExportState({ fraction: 0, message: 'Préparation…' });
    const name = `sklip_${session.theme}_${project.fmt}${project.bpm ? `_${Math.round(project.bpm)}bpm` : ''}.mp4`;
    const output = session.stream.folder ? `${session.stream.folder}/montages/${name}` : name;
    const spec = M.toRenderSpec(project, { video: session.stream.video, output, cam: session.cam, tracks: session.tracks });
    try {
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
            <div className="note">Thème : {session.theme} · cible {session.target} s</div>
          </div>
        </div>
        <div className="row">
          <div className="seg">
            {['9x16', '16x9'].map((f) => (
              <button key={f} className={project.fmt === f ? 'on' : ''} onClick={() => setProject({ ...project, fmt: f })}>
                {f.replace('x', ':')}</button>))}
          </div>
          <label className="row nowrap note">BPM
            <input type="number" min="60" max="200" placeholder="—" value={project.bpm || ''} style={{ width: 70 }}
              onChange={(e) => setProject({ ...project, bpm: e.target.value ? Number(e.target.value) : null })} />
          </label>
          <div className={'dur' + (total > 60 ? ' over' : '')}>{total.toFixed(1)} s</div>
          <button className="btn" onClick={doExport} disabled={!project.clips.length}>Exporter</button>
        </div>
      </header>

      <div className="ed-body">
        <section className="panel moments">
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

        <section className="stage">
          <Preview project={project} player={player} videoSrc={session.stream.video ? `file:///${session.stream.video}` : null} />
          <div className="transport">
            <button className="btn sm" onClick={() => player.setPlaying(!player.playing)}>{player.playing ? '⏸ Pause' : '▶ Lire'}</button>
            <span className="note">{M.fmtTime(player.t)} / {M.fmtTime(total)}</span>
          </div>
        </section>

        <section className="panel props">
          {clip ? (
            <>
              <h3>Clip sélectionné</h3>
              <div className="note" style={{ marginBottom: 12 }}>
                Dans le stream : {M.fmtTime(clip.start)} → {M.fmtTime(clip.end)} ({(clip.end - clip.start).toFixed(1)} s)
              </div>
              {project.fmt === '9x16' && (
                <>
                  <div className="lbl">Mise en page 9:16</div>
                  <div className="seg full">
                    {Object.entries(M.LAYOUTS).map(([k, v]) => (
                      <button key={k} className={clip.layout === k ? 'on' : ''}
                        onClick={() => setProject(M.updateClip(project, clip.id, { layout: k }))}>{v}</button>))}
                  </div>
                </>)}
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
              <button className="btn ghost danger" style={{ marginTop: 14 }}
                onClick={() => { setProject(M.removeClip(project, clip.id)); setSelected(null); }}>Retirer ce clip</button>
            </>
          ) : <div className="note">Sélectionne un clip dans la timeline.</div>}

          <h3 style={{ marginTop: 26 }}>Sous-titres</h3>
          <label className="check"><input type="checkbox" checked={project.texts.subtitles}
            onChange={(e) => setProject({ ...project, texts: { ...project.texts, subtitles: e.target.checked } })} /> Sous-titres auto, mot par mot</label>

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

      <div className="mixer">
        <div className="mixer-title">Mixeur<span className="note">tout le montage</span></div>
        {M.TRACKS.map((tr) => (
          <Fader key={tr} label={M.TRACK_LABELS[tr]} value={project.volumes[tr]}
            onChange={(v) => setProject(M.setGlobalVolume(project, tr, v))} />))}
        {project.volumes.music === 0 && <div className="note mixer-hint">Musique coupée : évite les problèmes de droits sur TikTok et YouTube.</div>}
      </div>

      <Timeline project={project} setProject={setProject} selected={selected} setSelected={setSelected} player={player} />

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
