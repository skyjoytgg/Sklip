import { useEffect, useRef, useState } from 'react';

const SOURCES = {
  auto: 'trouvée automatiquement',
  auto_failed: 'pas trouvée : réglage de base utilisé',
  manual: 'réglée à la main',
  none: 'pas de webcam',
  project: 'réglée à la main pour ce stream',
};

export const camStatus = (source) => SOURCES[source] || '';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Fenêtre « Webcam » : une image du stream, et un rectangle à déplacer / redimensionner à la souris.
 * Rien n'est appliqué tant qu'on n'a pas validé.
 */
export function CamEditor({ videoSrc, time, cam, detected, onApply, onAuto, onNone, onClose }) {
  const [rect, setRect] = useState(cam || detected || { x: 0.03, y: 0.05, w: 0.22, h: 0.22 });
  const [remember, setRemember] = useState(false);
  const box = useRef(null);
  const drag = useRef(null);
  const videoRef = useRef(null);
  useEffect(() => { if (videoRef.current) videoRef.current.currentTime = time || 0; }, []);

  const down = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x0: e.clientX, y0: e.clientY, r0: rect };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const dx = (e.clientX - d.x0) / b.width;
    const dy = (e.clientY - d.y0) / b.height;
    const r = { ...d.r0 };
    if (d.mode === 'move') {
      r.x = clamp(r.x + dx, 0, 1 - r.w);
      r.y = clamp(r.y + dy, 0, 1 - r.h);
    } else {
      if (d.mode.includes('l')) { const x = clamp(r.x + dx, 0, r.x + r.w - 0.04); r.w += r.x - x; r.x = x; }
      if (d.mode.includes('r')) r.w = clamp(r.w + dx, 0.04, 1 - r.x);
      if (d.mode.includes('t')) { const y = clamp(r.y + dy, 0, r.y + r.h - 0.04); r.h += r.y - y; r.y = y; }
      if (d.mode.includes('b')) r.h = clamp(r.h + dy, 0.04, 1 - r.y);
    }
    setRect(r);
  };
  const up = () => { drag.current = null; };
  const round = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));

  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal cam-editor" onPointerDown={(e) => e.stopPropagation()}>
        <h3>Où est ta webcam ?</h3>
        <p className="note">Déplace le cadre violet sur ta webcam et tire ses coins pour l'ajuster au bord près.</p>
        <div className="cam-stage" ref={box} onPointerMove={move} onPointerUp={up}>
          {videoSrc ? <video ref={videoRef} src={videoSrc} muted preload="auto" /> : <div className="camgame">Ton jeu</div>}
          <div className="cam-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            onPointerDown={(e) => down(e, 'move')}>
            {['tl', 'tr', 'bl', 'br'].map((c) => <span key={c} className={`h ${c}`} onPointerDown={(e) => down(e, c)} />)}
          </div>
        </div>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Garder ce réglage pour mes prochains streams (sinon : seulement ce stream)</label>
        <div className="row modal-actions">
          <button className="btn" onClick={() => onApply(round(rect), remember)}>Valider</button>
          {detected && <button className="btn ghost" onClick={onAuto}>Automatique</button>}
          <button className="btn ghost" onClick={onNone}>Pas de webcam</button>
          <button className="link" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}

/** La vraie webcam dans l'aperçu (découpée dans la vidéo du stream), comme à l'export. */
export function CamCrop({ src, cam, time, playing, boxRatio, full = false, focus = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Math.abs(v.currentTime - time) > 0.3) v.currentTime = time;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  });
  // Comme FFmpeg : la webcam remplit la case (on coupe ce qui dépasse), sans être déformée,
  // centrée sur le visage s'il est connu (« Cam en grand »), sinon au milieu.
  const camRatio = (cam.w * 16) / (cam.h * 9);
  const fx = focus ? focus.x : 0.5; const fy = focus ? focus.y : 0.5;
  const shift = (k, f) => -Math.min(Math.max(f * k - 0.5, 0), k - 1) * 100;
  const inner = camRatio >= boxRatio
    ? { height: '100%', width: `${(camRatio / boxRatio) * 100}%`, left: `${shift(camRatio / boxRatio, fx)}%`, top: 0 }
    : { width: '100%', height: `${(boxRatio / camRatio) * 100}%`, top: `${shift(boxRatio / camRatio, fy)}%`, left: 0 };
  return (
    <div className={'pv-cam real' + (full ? ' full' : '')}>
      <div className="cam-inner" style={inner}>
        <video ref={ref} src={src} muted style={{ width: `${100 / cam.w}%`, height: `${100 / cam.h}%`,
          left: `${(-cam.x / cam.w) * 100}%`, top: `${(-cam.y / cam.h) * 100}%` }} />
      </div>
    </div>
  );
}
