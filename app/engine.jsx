// Continuous-composition animation engine, trimmed from Claude Design's animations-v3.jsx
// for a standalone artifact: no host timeline, no video export, no watercolor kit.
// The whole video is one element tree rendered as a pure function of authored time T.

const Easing = {
  linear: (t) => t,
  easeOutCubic: (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const TimelineContext = React.createContext({ time: 0, duration: 10, playing: false });
const useTimeline = () => React.useContext(TimelineContext);
// which frame the stage shows: { tall: false } for landscape, { tall: true, height } for the portrait one
const FrameContext = React.createContext({ tall: false });
const useFrame = () => React.useContext(FrameContext);


function Stage({ width, height, portrait, menu, onLayout, duration, background, playback, nav, children }) {
  const playTimes = playback && playback.mode === 'times' ? playback.count : null;
  const loop = !playback || playback.mode === 'loop';
  // The page opens paused on the composition's start frame (setStart); the first Play from that untouched frame
  // starts the video from 0:00, the title card
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const timeRef = React.useRef(0), playingRef = React.useRef(false), freshRef = React.useRef(null);
  timeRef.current = time; playingRef.current = playing;
  const setStart = React.useCallback((t) => { setTime(t); freshRef.current = t; }, []);
  const togglePlay = () => {
    if (!playingRef.current && freshRef.current != null && Math.abs(timeRef.current - freshRef.current) < 1e-6) setTime(0);
    freshRef.current = null;
    setPlaying((p) => !p);
  };
  const [hoverTime, setHoverTime] = React.useState(null);
  const [scale, setScale] = React.useState(0.2);
  const [frame, setFrame] = React.useState({ tall: false });
  const tallRef = React.useRef(false);
  const tall = frame.tall;
  const areaRef = React.useRef(null);
  const lastTsRef = React.useRef(null);
  const passesRef = React.useRef(0);


  React.useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // The portrait frame takes over when it would show noticeably larger than the landscape one;
    // the 1.1–1.15 band keeps a window at the boundary from flipping back and forth.
    // It is as tall as the area allows (between its min and max height), so it fills a phone screen.
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      const sl = Math.min(w / width, h / height);
      const sp = portrait ? Math.min(w / portrait.width, h / portrait.minHeight) : 0;
      const next = sp > sl * (tallRef.current ? 1.1 : 1.15);
      tallRef.current = next;
      const ph = next ? clamp(Math.floor(h / sp), portrait.minHeight, portrait.maxHeight) : 0;
      setFrame((f) => (f.tall === next && (f.height || 0) === ph ? f : next ? { tall: true, height: ph } : { tall: false }));
      setScale(Math.max(0.05, next ? sp : sl));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, portrait && portrait.width, portrait && portrait.minHeight, portrait && portrait.maxHeight]);
  React.useEffect(() => { if (onLayout) onLayout(tall); }, [tall]);

  React.useEffect(() => {
    if (!playing) { lastTsRef.current = null; return; }
    passesRef.current = 0;
    let raf;
    const step = (ts) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          if (playTimes !== null) {
            passesRef.current += 1;
            if (passesRef.current >= playTimes) { next = duration; setPlaying(false); } else next = next % duration;
          } else if (loop) next = next % duration;
          else { next = duration; setPlaying(false); }
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); lastTsRef.current = null; };
  }, [playing, duration, loop, playTimes]);

  // Keyboard: space = play/pause, arrows = seek (shift for 1 s), 0/Home = start
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft') setTime((t) => clamp(t - (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.code === 'ArrowRight') setTime((t) => clamp(t + (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.key === '0' || e.code === 'Home') setTime(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration]);

  // Page controls outside the stage (Queen panel) pause and seek through this event
  React.useEffect(() => {
    const onSeek = (e) => { setPlaying(false); if (e.detail && isFinite(e.detail.time)) setTime(clamp(e.detail.time, 0, duration)); };
    window.addEventListener('chess-video:seek', onSeek);
    return () => window.removeEventListener('chess-video:seek', onSeek);
  }, [duration]);

  const displayTime = hoverTime != null ? hoverTime : time;
  const fw = tall ? portrait.width : width, fh = tall ? frame.height : height;
  const ctx = React.useMemo(() => ({ time: displayTime, duration, playing, setTime, setPlaying, setStart }), [displayTime, duration, playing]);

  return (
    <div className={'stage' + (tall ? ' stage-tall' : '')}>
      <div ref={areaRef} className="stage-area">
        <div className="stage-frame" style={{ width: fw * scale, height: fh * scale }}>
          <div style={{ width: fw, height: fh, background, position: 'relative', overflow: 'hidden', transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <FrameContext.Provider value={frame}>
              <TimelineContext.Provider value={ctx}>{children}</TimelineContext.Provider>
            </FrameContext.Provider>
          </div>
        </div>
      </div>
      <PlaybackBar time={displayTime} duration={duration} playing={playing} nav={nav} menu={menu}
        onPlayPause={togglePlay} onReset={() => setTime(0)}
        onSeek={(t) => setTime(t)} onHover={(t) => setHoverTime(t)} />
    </div>
  );
}

function PlaybackBar({ time, duration, playing, nav, menu, onPlayPause, onReset, onSeek, onHover }) {
  const trackRef = React.useRef(null);
  const dragging = React.useRef(false);
  // the video calls nav.listen when its move label changes while the playhead is still (stepping through a line)
  const [, redraw] = React.useState(0);
  React.useEffect(() => {
    if (!nav) return;
    nav.listen = () => redraw((x) => x + 1);
    return () => { nav.listen = null; };
  }, [nav]);
  const timeAt = (e) => { const r = trackRef.current.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * duration; };
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const fmt = (t) => { const x = Math.max(0, t); return `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}.${String(Math.floor((x * 100) % 100)).padStart(2, '0')}`; };
  return (
    <div className="pbar">
      <button type="button" className="pbtn" onClick={onReset} aria-label="Back to start (0)" title="Back to start (0)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2v10M12 2L5 7l7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
      </button>
      {nav && nav.current && (
        <button type="button" className="pbtn pnav" disabled={!nav.current.hasPrev} onClick={() => nav.current.prev()} aria-label="Previous move (←)" title="Previous move (←)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <button type="button" className="pbtn" onClick={onPlayPause} aria-label={playing ? 'Pause (space)' : 'Play (space)'} title={playing ? 'Pause (space)' : 'Play (space)'}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2l9 5-9 5V2z" fill="currentColor" /></svg>}
      </button>
      {nav && nav.current && (
        <button type="button" className="pbtn pnav" disabled={!nav.current.hasNext} onClick={() => nav.current.next()} aria-label="Next move (→)" title="Next move (→)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {nav && nav.current && <span className="plabel" style={{ color: nav.current.color }} aria-live="polite">{nav.current.label}</span>}
      <span className="ptime">{fmt(time)}</span>
      <div ref={trackRef} className="ptrack" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
        onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} onSeek(timeAt(e)); onHover(null); }}
        onPointerMove={(e) => { if (dragging.current) onSeek(timeAt(e)); else if (e.pointerType === 'mouse') onHover(timeAt(e)); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onPointerLeave={() => { if (!dragging.current) onHover(null); }}>
        <div className="ptrack-bg" />
        <div className="ptrack-fill" style={{ width: `${pct}%` }} />
        <div className="ptrack-knob" style={{ left: `${pct}%` }} />
      </div>
      <span className="ptime ptime-total">{fmt(duration)}</span>
      {menu}
    </div>
  );
}

// ── Continuous composition: scene list → cue table; T is the authored clock ──
function parseScenes(raw) {
  try {
    const s = JSON.parse(raw);
    if (!Array.isArray(s) || !s.length) return null;
    return s.every((x) => x && typeof x.name === 'string' && isFinite(x.dur) && x.dur > 0) ? s : null;
  } catch (e) { return null; }
}
function deriveCues(scenes) {
  let start = 0; const table = {}, sections = [];
  scenes.forEach((s) => { sections.push({ name: s.name, start, dur: s.dur }); if (!(s.name in table)) table[s.name] = Math.round(start * 1000) / 1000; start += s.dur; });
  return { table, sections, total: Math.round(start * 1000) / 1000 };
}

const CompositionContext = React.createContext(null);
function useComposition() {
  const c = React.useContext(CompositionContext);
  if (!c) throw new Error('useComposition() must be called inside <CompositionStage>');
  return c;
}
function CompositionClock({ derived, children }) {
  const tl = useTimeline();
  const T = Math.min(tl.time, derived.total);
  const value = React.useMemo(() => ({ T, CUES: derived.table, time: tl.time, duration: tl.duration, authoredTotal: derived.total, playing: tl.playing }), [T, derived, tl.time, tl.duration, tl.playing]);
  return <CompositionContext.Provider value={value}>{children}</CompositionContext.Provider>;
}

function CompositionStage({ width, height, portrait, menu, onLayout, scenes, playback, bg, nav, children }) {
  const parsed = React.useMemo(() => parseScenes(scenes), [scenes]);
  const derived = React.useMemo(() => (parsed ? deriveCues(parsed) : null), [parsed]);
  const pb = React.useMemo(() => { try { return JSON.parse(playback); } catch (e) { return null; } }, [playback]);
  if (!derived) return <div className="stage-error">This game produced an invalid scene list.</div>;
  return (
    <Stage width={width} height={height} portrait={portrait} menu={menu} onLayout={onLayout} duration={derived.total} background={bg} playback={pb} nav={nav}>
      <CompositionClock derived={derived}>{children}</CompositionClock>
    </Stage>
  );
}

Object.assign(window, { Easing, clamp, CompositionStage, useComposition, useTimeline, useFrame });
