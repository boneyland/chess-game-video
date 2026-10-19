// ---------- loader ----------
// Replaces the Claude Design host hooks: commentary goes through the artifact `sample`
// capability, the notes file through `downloads`, and settings open from a page button.
const STORE = 'chess-video.files.v1';
const SAMPLE = { pgn: window.SAMPLE_PGN, analysis: window.SAMPLE_ANALYSIS, sampleNotes: window.SAMPLE_NOTES, sample: true };
// the published claude.ai artifact, where the `sample` capability lets Claude write commentary
const CLAUDE_URL = 'https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT';
// a free board is stored as { board: BoardCore.save(…) } in the loaded game's place; one that no longer restores gives the sample
function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s && s.board) return window.BoardCore.restore(s.board) ? { board: s.board } : SAMPLE;
    if (s && (s.pgn || s.analysis)) return s;
  } catch (e) {}
  return SAMPLE;
}
const PLAYBACK = '{"mode":"loop"}';

// Full screen hides the browser's bars, and the phone layouts grow into the space. iPhone Safari has no element
// full screen (only <video>) and a frame may not allow it, so the item shows only where the browser says it works;
// an installed copy opened full screen (the manifest) has no bars to hide
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const FS_OK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !(() => { try { return window.matchMedia('(display-mode: fullscreen)').matches; } catch (e) { return false; } })();
function useFullscreen() {
  const [on, setOn] = React.useState(() => !!fsElement());
  React.useEffect(() => {
    const sync = () => setOn(!!fsElement());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
  }, []);
  // called from the tap itself: browsers refuse full screen outside a user gesture (iPad Safari's prefixed call returns no promise)
  const toggle = () => {
    const el = document.documentElement;
    try {
      const r = fsElement() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {}
  };
  return { ok: FS_OK, on, toggle };
}

function useCapability(name) {
  const [cap, setCap] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    if (window.claude && typeof window.claude.use === 'function') window.claude.use(name).then((c) => { if (live) setCap(c || null); }, () => {});
    return () => { live = false; };
  }, [name]);
  return cap;
}

// An embedding page on another origin (the notes site) can't be read, so it posts its scheme instead:
// this page sends { type: 'chess-replay:scheme?' } (again after 0.5 s and 2 s while unanswered, in case the parent's
// listener wasn't attached yet), and the parent answers, then posts again on each toggle,
//   { type: 'chess-replay:scheme', scheme: 'dark' | 'light' }
const SCHEME_MSG = 'chess-replay:scheme';
let postedScheme = null;
const schemeListeners = new Set();
if (window.parent !== window && !IN_CLAUDE) {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window.parent || !d || d.type !== SCHEME_MSG || (d.scheme !== 'dark' && d.scheme !== 'light')) return;
    postedScheme = d.scheme;
    schemeListeners.forEach((f) => f());
  });
  const ask = () => { if (!postedScheme) try { window.parent.postMessage({ type: SCHEME_MSG + '?' }, '*'); } catch (e) {} };
  ask(); setTimeout(ask, 500); setTimeout(ask, 2000);
}

// Auto follows the embedding page, the viewer's claude.ai theme (data-theme on the root) or the system setting; Light/Dark override all
function useScheme(pref) {
  // a same-origin embed with a Material palette toggle (data-md-color-scheme) is read directly
  const parentScheme = () => {
    try { const b = window.parent !== window && window.parent.document.body; const s = b && b.getAttribute('data-md-color-scheme'); if (s) return s === 'slate' ? 'dark' : 'light'; } catch (e) {}
    return postedScheme;
  };
  const read = () => {
    if (pref === 'Light') return 'light';
    if (pref === 'Dark') return 'dark';
    const ps = parentScheme();
    if (ps) return ps;
    const host = document.documentElement.getAttribute('data-theme');
    if (host === 'light' || host === 'dark') return host;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'dark'; }
  };
  const [mode, setMode] = React.useState(read);
  React.useEffect(() => {
    const el = document.documentElement;
    const update = () => {
      const m = read();
      setMode(m);
      if (pref === 'Light' || pref === 'Dark' || parentScheme()) el.setAttribute('data-scheme', m); else el.removeAttribute('data-scheme');
    };
    update();
    let mq = null;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', update); } catch (e) {}
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    try { if (window.parent !== window && window.parent.document.body) mo.observe(window.parent.document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] }); } catch (e) {}
    schemeListeners.add(update);
    return () => { try { if (mq) mq.removeEventListener('change', update); } catch (e) {} mo.disconnect(); schemeListeners.delete(update); };
  }, [pref]);
  return mode;
}

function GameApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const flipRef = React.useRef(false);
  flipRef.current = !!t.flip;
  const busyRef = React.useRef(false);
  const scheme = useScheme(t.scheme || 'Auto');
  setPalette(scheme);
  const [files, setFiles] = React.useState(readStored);
  const filesRef = React.useRef(files);
  filesRef.current = files;
  const [err, setErr] = React.useState('');
  const [drag, setDrag] = React.useState(false);
  const [panel, setPanel] = React.useState(false);
  const [ai, setAi] = React.useState({ busy: false, err: '', chars: 0 });
  const [saveMsg, setSaveMsg] = React.useState('');
  const inputRef = React.useRef(null);
  const sample = useCapability('sample');
  const downloads = useCapability('downloads');
  const mcp = useCapability('mcp');
  const probe = React.useRef(null);
  const nav = React.useRef(null);
  const fullscreen = useFullscreen();
  const [queenOpen, setQueenOpen] = React.useState(false);
  const [queenArrow, setQueenArrow] = React.useState(null);
  // the phone layouts (portrait, or a narrow one held sideways) fold the dock's buttons into a menu in the transport bar; it closes on a pick, an outside tap or Esc
  const [tall, setTall] = React.useState(false), [frameW, setFrameW] = React.useState(1920);
  const onLayout = React.useCallback((phone, w) => { setTall(phone); setFrameW(w); }, []);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => { if (!tall) setMenu(false); }, [tall]);
  // the dock's New board menu (landscape); on a phone its items sit in the folded menu instead
  const [newMenu, setNewMenu] = React.useState(false);
  const newRef = React.useRef(null);
  React.useEffect(() => {
    if (!newMenu) return;
    const away = (e) => { if (newRef.current && !newRef.current.contains(e.target)) setNewMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setNewMenu(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [newMenu]);
  React.useEffect(() => { if (tall) setNewMenu(false); }, [tall]);
  const dockRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (dockRef.current && !dockRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [menu]);
  // F turns the board round (not in a field, not with a modifier, which belongs to the browser)
  React.useEffect(() => {
    const onF = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || e.repeat || (e.key || '').toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable) || busyRef.current) return;
      setTweak('flip', !flipRef.current);
    };
    window.addEventListener('keydown', onF);
    return () => window.removeEventListener('keydown', onF);
  }, []);
  const lastGood = React.useRef(null);
  // a free board keeps the last good game (the sample on a fresh page) for the hooks that want one
  const built = React.useMemo(() => {
    if (files.board) return { M: lastGood.current || window.ChessCore.buildGame(SAMPLE) };
    try { return { M: window.ChessCore.buildGame(files) }; } catch (e) { return { error: e.message }; }
  }, [files]);
  // the board's state, restored from its stored form; a board this page just committed is used as it is
  const boardSaved = React.useRef(null);
  const board = React.useMemo(() => (!files.board ? null : boardSaved.current && boardSaved.current.saved === files.board ? boardSaved.current.board : window.BoardCore.restore(files.board)), [files.board]);
  if (built.M) lastGood.current = built.M;
  const M = built.M || lastGood.current || window.ChessCore.buildGame(SAMPLE);
  const hf = useHfAuth();
  const Q = useQueen(M, mcp, hf);
  const ES = React.useMemo(() => window.AnalysisCore.engineSettings(t), [t.sfDepth, t.sfTime, t.sfOwnDepth, t.sfOwnTime, t.sfHash]);
  const engine = useEngine(ES.game.hash_mb);
  const queenInVideo = t.queenInVideo !== false;
  const showCommentary = t.commentary !== false;
  // commentary off: no comments, intro or conclusion, so the video's timing drops their reading time too
  const MV = React.useMemo(() => {
    const G = queenInVideo ? withQueen(M, Q.resultAt) : M;
    return showCommentary ? G : { ...G, intro: '', conclusion: '', plies: G.plies.map((p) => ({ ...p, comment: '' })) };
  }, [M, Q.cache, queenInVideo, showCommentary]);
  const TM = React.useMemo(() => window.ChessCore.timing(MV, { secondsPerMove: t.secondsPerMove, keyHold: t.keyHold, fastOpening: t.fastOpening }), [MV, t.secondsPerMove, t.keyHold, t.fastOpening]);
  const scenes = JSON.stringify(TM.scenes);
  const fmtLen = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  const closePanel = React.useCallback(() => setPanel(false), []);
  const closeQueen = React.useCallback(() => setQueenOpen(false), []);
  React.useEffect(() => { setQueenArrow(null); }, [M]);

  const commit = (next) => {
    if (!next.board) try { window.ChessCore.buildGame(next); } catch (e) { setErr(e.message); return; }
    setErr(''); setFiles(next);
    try { if (next.sample && !next.evalSource && !next.aiNotes) localStorage.removeItem(STORE); else localStorage.setItem(STORE, JSON.stringify(next)); } catch (e) { setErr('Loaded, but the files are too large to remember after reload.'); }
  };
  const commitBoard = (b) => { const saved = window.BoardCore.save(b); boardSaved.current = { saved, board: b }; commit({ board: saved }); };
  const newBoard = () => { setNewMenu(false); setMenu(false); setQueenOpen(false); commitBoard(window.BoardCore.fromFen()); };
  const loadFiles = async (list) => {
    const batch = {};
    try {
      for (const f of Array.from(list)) { const text = await f.text(); const kind = window.ChessCore.classifyFile(f.name, text); batch[kind] = text; batch[kind + 'Name'] = f.name; }
    } catch (e) { setErr('Could not read that file: ' + ((e && e.message) || e)); return; }
    if (batch.queen) {
      const answers = window.QueenCore.readQueenFile(batch.queen);
      delete batch.queen; delete batch.queenName;
      if (answers) { Q.merge(answers); setErr(''); setQueenOpen(true); setPanel(false); }
      if (!batch.pgn && !batch.analysis && !batch.notes) return;
    }
    if (!batch.pgn && !batch.analysis && !batch.notes) { setErr('That file isn’t a PGN, an analysis JSON or a notes file.'); return; }
    let next;
    if (batch.pgn) {
      next = { ...batch, gameIndex: 0 };
      if (!batch.analysis && files.analysis && !files.sample) { try { window.ChessCore.buildGame({ ...next, analysis: files.analysis }); next.analysis = files.analysis; next.analysisName = files.analysisName; } catch (e) {} }
    } else next = { ...(board ? {} : files), ...batch, sample: false };
    commit(next);
  };
  // Drag-and-drop: dragover repeats every few ms while a file is over the page, so the overlay hides itself
  // shortly after those stop (dropped elsewhere, cancelled, or swallowed by the frame around the artifact)
  const dragTimer = React.useRef(null);
  const loadRef = React.useRef(loadFiles);
  loadRef.current = loadFiles; // the listeners below are registered once and always load with the current files
  React.useEffect(() => {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const hideSoon = (ms) => { clearTimeout(dragTimer.current); dragTimer.current = setTimeout(() => setDrag(false), ms); };
    const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); hideSoon(400); };
    const leave = (e) => { if (!e.relatedTarget) hideSoon(80); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); clearTimeout(dragTimer.current); setDrag(false);
      let list = Array.from(e.dataTransfer.files || []);
      if (!list.length) list = Array.from(e.dataTransfer.items || []).filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
      if (list.length) loadRef.current(list); else setErr('The drop arrived without a file. Use “Load game…” to pick the files instead.');
    };
    const end = () => { clearTimeout(dragTimer.current); setDrag(false); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('dragend', end);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('dragend', end); clearTimeout(dragTimer.current); };
  }, []);

  const writeCommentary = async () => {
    if (!sample || ai.busy) return;
    setAi({ busy: true, err: '', chars: 0 });
    try {
      const base = window.ChessCore.buildGame({ ...files, aiNotes: null, sampleNotes: null });
      const p = window.ChessCore.commentaryPrompt(base, { tone: t.aiTone || window.TWEAK_DEFAULTS.aiTone, density: t.aiDensity || window.TWEAK_DEFAULTS.aiDensity, audience: t.aiAudience || window.TWEAK_DEFAULTS.aiAudience });
      const res = await sample(p.system + '\n\n' + p.user, { modelTier: 'default', onText: ({ text }) => setAi((a) => ({ ...a, chars: text.length })) });
      if (res.truncated) throw new Error('the reply was cut off. Try "Key moments" for fewer comments.');
      const aiNotes = window.ChessCore.parseCommentary(res.text, base.plies.length);
      commit({ ...filesRef.current, aiNotes, sampleNotes: null });
      setAi({ busy: false, err: '', chars: 0 });
    } catch (e) {
      const code = e && e.code;
      const msg = code === 'not_granted' ? 'Claude was not allowed for this page.' : code === 'rate_limited' ? 'Claude is busy. Wait a minute, then try again.' : 'Commentary failed: ' + ((e && e.message) || e);
      setAi({ busy: false, err: msg, chars: 0 });
    }
  };
  // txt is a string or a Blob
  const saveFile = async (name, txt, type) => {
    if (!downloads) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    try { const r = await downloads.save({ filename: name, data: txt }); setSaveMsg(r.status === 'saved' ? 'Saved ' + name : ''); }
    catch (e) { setSaveMsg(e && e.code === 'declined' ? '' : 'Could not save the file here.'); }
  };
  const fileStem = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_');
  const downloadNotes = () => {
    if (!downloads && IN_CLAUDE) return;
    if (files.aiNotes) saveFile(fileStem + '_notes.txt', files.aiNotes, 'text/plain');
  };
  const browserAnalysis = React.useMemo(() => sfIsBrowserAnalysis(files.analysis), [files.analysis]);
  const saveAnalysis = () => {
    const a = typeof files.analysis === 'string' ? files.analysis : JSON.stringify(files.analysis, null, 2);
    saveFile(files.analysisName || fileStem + '_analysis.json', a, 'application/json');
  };
  // the whole annotation whatever the video shows: commentary even when hidden, Queen's answers even when out of the video
  const savePgn = () => saveFile(fileStem + '_annotated.pgn', window.ChessCore.annotatedPgn(withQueen(M, Q.resultAt)), 'application/x-chess-pgn');
  const saveQueen = () => saveFile(fileStem + '_queen.json', JSON.stringify(Q.saved(), null, 1), 'application/json');
  const analysis = useGameAnalysis(M, files, () => filesRef.current, commit, engine, ES.game);
  // Lichess's opening book per ply, built after the first paint (about 0.25 s the first time)
  const [book, setBook] = React.useState(null);
  React.useEffect(() => { setBook(null); const id = setTimeout(() => { try { setBook(window.Openings.book().byPly(M.plies.map((p) => p.uci), M.start.fen)); } catch (e) {} }, 50); return () => clearTimeout(id); }, [M]);
  const soundSet = window.Sfx.SETS.includes(t.soundSet) ? t.soundSet : window.Sfx.SETS[0];
  const soundVolume = Number.isFinite(+t.soundVolume) ? +t.soundVolume : 70;
  const exportFps = EXPORT_FPS_OPTIONS.includes(+t.exportFps) ? +t.exportFps : 8;
  const exportFormat = EXPORT_FORMATS.includes(t.exportFormat) ? t.exportFormat : EXPORT_FORMATS[0], webp = exportFormat === 'WebP';
  // WebP widths, largest first: the frame's own (0), half of it ('Half', the default, so a phone's 840 frame gives 420) and fixed ones below the frame's
  const halfW = Math.round(frameW / 2), wPx = (x) => (x === 'Half' ? halfW : x || frameW), webpPx = (x) => (x === 'Half' ? `${halfW} px (half)` : x ? x + ' px' : `${frameW} px (full)`);
  const webpWidths = [0].concat(WEBP_WIDTHS.filter((x) => x < frameW && x !== halfW), 'Half').sort((a, b) => wPx(b) - wPx(a));
  const webpWidth = webpWidths.includes(t.webpWidth) ? t.webpWidth : webpWidths.includes(+t.webpWidth) ? +t.webpWidth : 'Half';
  // the old setting was a ratio, 'Full' or 'Half': carry it over once
  React.useEffect(() => { if (t.webpSize !== undefined) { setTweak('webpWidth', t.webpSize === 'Full' ? 0 : 'Half'); setTweak('webpSize', undefined); } }, []);
  const webpQuality = Math.min(WEBP_QUALITY.max, Math.max(WEBP_QUALITY.min, +t.webpQuality || 75));
  const video = useVideoExport({ fps: exportFps, format: exportFormat, webp: { width: wPx(webpWidth), quality: webpQuality }, stem: fileStem, save: (name, blob) => saveFile(name, blob, blob.type) });
  busyRef.current = video.busy;
  // the stretch to export, in plies: from -1 starts on the title card, to N (the ply count) ends after the end card
  const [clip, setClip] = React.useState({ from: -1, to: Infinity });
  React.useEffect(() => { setClip({ from: -1, to: Infinity }); }, [M]);
  const NP = MV.plies.length, clipFrom = Math.min(clip.from, NP - 1), clipTo = Math.max(clipFrom, Math.min(clip.to, NP));
  const clipOpts = React.useMemo(() => {
    const at = window.ChessCore.clipRange(MV, TM), ply = MV.plies.map((p, i) => ({ i, l: label(MV, i), t: at(i, i) }));
    return {
      at, S: window.ChessCore.schedule(MV, window.ChessCore.cues(TM.scenes), TM.d),
      from: [{ i: -1, s: 'Title card · 0:00' }].concat(ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.start)}` }))),
      to: ply.map((o) => ({ i: o.i, s: `${o.l} · ${fmtLen(o.t.end)}` })).concat([{ i: NP, s: `End card · ${fmtLen(TM.total)}` }]),
    };
  }, [MV, TM]);
  const clipT = clipOpts.at(clipFrom, clipTo), clipFromOpts = clipOpts.from, clipToOpts = clipOpts.to.filter((o) => o.i >= clipFrom);
  const plyTag = (i) => `${Math.floor((MV.ply0 + i) / 2) + 1}${(MV.ply0 + i) % 2 ? 'b' : 'w'}`;
  const clipSuffix = clipFrom < 0 && clipTo >= NP ? '' : `_${clipFrom < 0 ? 'start' : plyTag(clipFrom)}-${clipTo >= NP ? 'end' : plyTag(clipTo)}`;
  const exportVideo = () => { setPanel(false); setQueenOpen(false); video.run({ start: clipT.start, end: clipT.end, suffix: clipSuffix, audio: t.sound === false || webp ? null
    : () => window.Sfx.renderTrack(window.SFX_DATA || {}, soundSet, window.Sfx.track(MV, clipOpts.S, clipT.start, clipT.end), soundVolume, clipT.end - clipT.start) }); };
  const SFL = window.AnalysisCore.SEARCH_LIMITS, SF_KEYS = ['sfDepth', 'sfTime', 'sfOwnDepth', 'sfOwnTime', 'sfHash'];
  const sfChanged = JSON.stringify(ES) !== JSON.stringify(window.AnalysisCore.engineSettings(window.TWEAK_DEFAULTS));
  const askQueen = () => { setQueenOpen((q) => !q); setPanel(false); };
  // landscape: the Queen panel opens centred over its button in the transport bar, kept on screen
  const queenBtn = React.useRef(null);
  const [queenLeft, setQueenLeft] = React.useState(null);
  React.useLayoutEffect(() => {
    if (!queenOpen || tall) { setQueenLeft(null); return; }
    const place = () => {
      const b = queenBtn.current && queenBtn.current.getBoundingClientRect();
      if (!b) return;
      const w = Math.min(400, window.innerWidth - 32);
      setQueenLeft(Math.round(Math.max(16, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - 16 - w))));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [queenOpen, tall]);
  const sf = { engine, own: ES.own, book, status: engine.status, run: analysis, start: analysis.start, stop: analysis.stop, estimateMin: analysis.estimateMin };

  const boardStatus = board && `Free board · ${board.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a FEN'} · ${board.steps.length} move${board.steps.length === 1 ? '' : 's'}`;
  const status = boardStatus || `${M.white.short} – ${M.black.short} · ${M.plies.length} plies` + (M.evalSource === 'analysis' ? ' · analysis evals' : M.evalSource === 'pgn' ? ' · PGN evals' : '') + (M.hasNotes ? ' · notes' : '') + (M.hasAiNotes ? ' · AI commentary' : '') + (files.sample ? ' (sample)' : '') + ' · ' + fmtLen(TM.total);
  const shownErr = err || built.error;

  const newItems = [{ label: 'Starting position', run: newBoard }];
  const dockItems = (
    <div id="dock-items" className="dock-items">
      {tall && <span className="dock-menu-status">{shownErr || status}</span>}
      <button type="button" className="dock-btn dock-primary" onClick={() => { setMenu(false); inputRef.current.click(); }}>Load game…</button>
      {/* a list, so the later starting points (a pasted FEN, games) join it */}
      {tall ? <React.Fragment>
        <span className="dock-menu-label">New board</span>
        {newItems.map((it) => <button key={it.label} type="button" className="dock-btn" onClick={it.run}>{it.label}</button>)}
      </React.Fragment> : (
        <div ref={newRef} className="dock-new">
          <button type="button" className="dock-btn" aria-haspopup="menu" aria-expanded={newMenu} onClick={() => setNewMenu((m) => !m)}>New board</button>
          {newMenu && (
            <div className="dock-pop" role="menu" aria-label="New board">
              {newItems.map((it) => <button key={it.label} type="button" role="menuitem" className="dock-btn" onClick={it.run}>{it.label}</button>)}
            </div>
          )}
        </div>
      )}
      {!board && <button ref={queenBtn} type="button" className="dock-btn dock-queen" aria-expanded={queenOpen} onClick={() => { setMenu(false); askQueen(); }}>Ask Queen</button>}
      <button type="button" className="dock-btn" aria-expanded={panel} onClick={() => { setMenu(false); setPanel((p) => !p); setQueenOpen(false); }}>Settings</button>
      {fullscreen.ok && <button type="button" className="dock-btn" onClick={() => { setMenu(false); fullscreen.toggle(); }}>{fullscreen.on ? 'Exit full screen' : 'Full screen'}</button>}
    </div>
  );
  const menuEl = (
    <div ref={dockRef} className={'pmenu' + (shownErr ? ' pmenu-err' : '') + (menu ? ' pmenu-open' : '')}>
      <button type="button" className="pbtn dock-menu" aria-label="Menu" aria-expanded={menu} aria-controls="dock-items" onClick={() => setMenu((m) => !m)}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          {menu
            ? <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            : <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        </svg>
      </button>
      {dockItems}
    </div>
  );
  // landscape: the buttons sit at the end of the transport bar, with an error above them
  const deskDock = (
    <div className="pdock">
      {shownErr && <span className="dock-status" role="alert">{shownErr}</span>}
      {dockItems}
    </div>
  );

  return (
    <React.Fragment>
      <CompositionStage nav={nav} width={1920} height={1080} portrait={PORTRAIT} short={SHORT} menu={<React.Fragment><SoundButton on={t.sound !== false} onChange={(v) => setTweak('sound', v)} />{tall ? menuEl : deskDock}</React.Fragment>} onLayout={onLayout} scenes={scenes} playback={PLAYBACK} bg={C.bg} still={!!board}>
        {board
          ? <FreeBoard board={board} onChange={commitBoard} tw={t} sf={sf} nav={nav} orient={t.flip ? 'b' : 'w'} book={book ? window.Openings.book() : null} />
          : <GameVideo M={MV} tw={video.busy ? { ...t, cameraPush: false, exporting: true } : t} d={TM.d} probe={probe} queen={queenArrow} nav={nav} scheme={scheme} sf={sf} orient={t.flip ? 'b' : 'w'} />}
      </CompositionStage>
      <input ref={inputRef} id="game-files" type="file" multiple accept=".pgn,.txt,.json,application/json,text/plain" hidden onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
      {hf.note && (
        <div className="signin-note" role="status">{hf.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={hf.clearNote}>✕</button></div>
      )}
      {drag && (
        <div className="drop">
          <div className="drop-box">Drop a PGN<br /><span>with this page’s analysis or notes files too, if you have them · if dropping doesn’t work here, use Load game…</span></div>
        </div>
      )}
      <ExportOverlay x={video} />
      {queenOpen && !board && <QueenPanel M={M} Q={Q} mcp={mcp} hf={hf} probe={probe} onClose={closeQueen} onOverlay={setQueenArrow} onSave={downloads || !IN_CLAUDE ? saveQueen : null} left={queenLeft} />}
      <TweaksPanel open={panel} onClose={closePanel} wide>
        <TweakColumn>
          <TweakSection label="Appearance">
            <TweakRadio id="tw-scheme" label="Theme" value={t.scheme || 'Auto'} options={['Auto', 'Light', 'Dark']} onChange={(v) => setTweak('scheme', v)} />
          </TweakSection>
          <TweakSection label="Game">
            <div className={shownErr ? 'twk-note twk-err' : 'twk-note'}>{shownErr || status}</div>
            <TweakButton label="Load game…" onClick={() => inputRef.current.click()} />
            {!board && <div className="twk-note">Uses the PGN’s own evals (Lichess [%eval] or cutechess +0.25/20). Without them, run “Analyse with Stockfish” from Analysis or Engine. Saved analysis, notes and Queen files load here too.</div>}
            {!files.sample && <TweakButton secondary label="Back to sample game" onClick={() => commit(SAMPLE)} />}
            {!board && M.canChooseSource && (
              <TweakRadio id="tw-source" label="Evaluations from" value={M.evalSource === 'pgn' ? 'PGN' : 'Analysis'} options={['Analysis', 'PGN']} onChange={(v) => commit({ ...files, evalSource: v === 'PGN' ? 'pgn' : 'analysis' })} />
            )}
            {!board && M.gameCount > 1 && (
              <TweakSelect id="tw-game" label="Game in PGN" value={String((files.gameIndex || 0) + 1)} options={Array.from({ length: M.gameCount }, (_, i) => String(i + 1))} onChange={(v) => commit({ ...files, gameIndex: +v - 1, analysis: null, analysisName: null })} />
            )}
          </TweakSection>
          <TweakSection label="Sound">
            <TweakToggle id="tw-sound" label="Move sounds" value={t.sound !== false} onChange={(v) => setTweak('sound', v)} />
            <TweakSelect id="tw-sset" label="Sound set" value={soundSet} options={window.Sfx.SETS} onChange={(v) => { setTweak('soundSet', v); sfxPlayer.play(v, ['move'], soundVolume); }} />
            <TweakSlider id="tw-vol" label="Volume" value={soundVolume} min={0} max={100} step={5} unit="%" onChange={(v) => { setTweak('soundVolume', v); sfxPlayer.play(soundSet, ['move'], v); }} />
            <div className="twk-note">The Lichess sets are by <a href="https://github.com/Enigmahack" target="_blank" rel="noopener">Enigmahack</a>, from <a href="https://github.com/lichess-org/lila" target="_blank" rel="noopener">Lichess’s source</a>, under the AGPL-3.0-or-later. Wood is made in your browser.</div>
          </TweakSection>
        </TweakColumn>
        <TweakColumn>
          <TweakSection label="Engine">
            <div className="twk-note">Stockfish 19 lite runs in your browser, for your own moves and “Analyse with Stockfish”. Each search stops at its depth or time limit, whichever comes first.</div>
            <TweakSlider id="tw-sf-depth" label="Game analysis: depth" value={ES.game.depth} min={SFL.depth[0]} max={SFL.depth[1]} step={1} onChange={(v) => setTweak('sfDepth', v)} />
            <TweakSlider id="tw-sf-time" label="Game analysis: time limit per position" value={ES.game.time_limit} min={SFL.seconds[0]} max={SFL.seconds[1]} step={0.5} unit="s" onChange={(v) => setTweak('sfTime', v)} />
            <TweakSlider id="tw-sf-odepth" label="Your moves: depth" value={ES.own.depth} min={SFL.depth[0]} max={SFL.depth[1]} step={1} onChange={(v) => setTweak('sfOwnDepth', v)} />
            <TweakSlider id="tw-sf-otime" label="Your moves: time limit per position" value={ES.own.time_limit} min={SFL.seconds[0]} max={SFL.seconds[1]} step={0.5} unit="s" onChange={(v) => setTweak('sfOwnTime', v)} />
            <TweakSelect id="tw-sf-hash" label="Hash table (helps long searches; a phone may run out of memory)" value={ES.game.hash_mb + ' MB'} options={window.AnalysisCore.HASH_MB.map((x) => x + ' MB')} onChange={(v) => setTweak('sfHash', parseInt(v, 10))} />
            {sfChanged && <TweakButton secondary label="Reset engine settings" onClick={() => SF_KEYS.forEach((k) => setTweak(k, window.TWEAK_DEFAULTS[k]))} />}
            {!board && (analysis.state === 'running'
              ? <>
                <div className="twk-note">Analysing {analysis.done} of {analysis.total} positions{analysis.etaSec != null ? ` · about ${Math.max(1, Math.round(analysis.etaSec / 60))} min left` : ''}</div>
                <TweakButton secondary label="Stop the analysis" onClick={analysis.stop} />
              </>
              : <TweakButton disabled={engine.status === 'unavailable'} label={`${analysis.resumeAt ? `Resume analysis from move ${Math.floor((MV.ply0 + analysis.resumeAt) / 2) + 1}` : files.analysis ? 'Analyse again' : 'Analyse with Stockfish'} · about ${analysis.estimateMin} min`} onClick={analysis.start} />)}
            {!board && analysis.err && <div className="twk-note twk-err">{analysis.err}</div>}
            {!board && files.analysis && analysis.state !== 'running' && <TweakButton secondary label="Remove analysis" onClick={() => commit({ ...files, analysis: null, analysisName: null, evalSource: null })} />}
            <div className="twk-note">{board ? 'On the free board every move is rated with the “Your moves” settings.' : <>New settings apply to the next analysis{files.analysis ? ', which replaces this one' : ''}; a stopped analysis resumes with its original settings.</>} Stockfish is free software under the GPL-3.0; <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">source</a>.</div>
          </TweakSection>
        </TweakColumn>
        {!board && <TweakColumn>
          <TweakSection label="Commentary">
            <TweakToggle id="tw-comm" label="Show commentary" value={showCommentary} onChange={(v) => setTweak('commentary', v)} />
            {sample && <>
              <TweakRadio id="tw-tone" label="Style" value={t.aiTone || window.TWEAK_DEFAULTS.aiTone} options={['Broadcast', 'Lesson', 'Concise']} onChange={(v) => setTweak('aiTone', v)} />
              <TweakRadio id="tw-aud" label="Audience" value={t.aiAudience || window.TWEAK_DEFAULTS.aiAudience} options={['Beginners', 'Club players', 'Experts']} onChange={(v) => setTweak('aiAudience', v)} />
              <TweakRadio id="tw-dens" label="Amount" value={t.aiDensity || window.TWEAK_DEFAULTS.aiDensity} options={['Key moments', 'Detailed']} onChange={(v) => setTweak('aiDensity', v)} />
            </>}
            {sample
              ? <TweakButton disabled={ai.busy} label={ai.busy ? `Writing commentary…${ai.chars ? ' ' + ai.chars + ' chars' : ''}` : M.hasAiNotes ? 'Rewrite commentary with Claude' : 'Write commentary with Claude'} onClick={writeCommentary} />
              : !IN_CLAUDE && <div className="twk-note">To have Claude write the commentary, <a href={CLAUDE_URL} target="_blank" rel="noopener">open this page on claude.ai</a> and load the game there.</div>}
            {ai.err && <div className="twk-note twk-err">{ai.err}</div>}
            {M.hasNotes && <div className="twk-note">Where both comment on a move, your notes file wins.</div>}
            {M.hasAiNotes && <TweakButton secondary label="Remove Claude's commentary" onClick={() => commit({ ...files, aiNotes: null, sampleNotes: files.sample ? window.SAMPLE_NOTES : null })} />}
            {M.hasAiNotes && (downloads || !IN_CLAUDE) && <>
              <TweakButton secondary label="Save Claude's commentary as a notes file" onClick={downloadNotes} />
              <div className="twk-note">Load the notes file with the PGN to restore Claude’s commentary; the annotated PGN includes all of it.</div>
            </>}
            {browserAnalysis && (downloads || !IN_CLAUDE) && <TweakButton secondary label="Save analysis" onClick={saveAnalysis} />}
            {(downloads || !IN_CLAUDE) && <TweakButton secondary label="Save as annotated PGN" onClick={savePgn} />}
            {saveMsg && <div className="twk-note">{saveMsg}</div>}
          </TweakSection>
          <TweakSection label="Pace">
            <div className="twk-note">Video length {fmtLen(TM.total)}{TM.capped ? ' (capped at 5:00)' : ''}</div>
            <TweakSlider id="tw-spm" label="Seconds per move" value={t.secondsPerMove} min={0.5} max={4} step={0.1} unit="s" onChange={(v) => setTweak('secondsPerMove', v)} />
            <TweakSlider id="tw-hold" label="Extra hold on !/? moves and uncommented mates" value={t.keyHold} min={0} max={6} step={0.5} unit="s" onChange={(v) => setTweak('keyHold', v)} />
            <TweakToggle id="tw-fast" label="Faster opening" value={t.fastOpening} onChange={(v) => setTweak('fastOpening', v)} />
          </TweakSection>
        </TweakColumn>}
        <TweakColumn>
          {board ? (
            <TweakSection label="Board">
              <div className="twk-note">Drag or tap a piece to play a move, for either side; Stockfish rates each one. Keys: ← → moves, Home the start, End the last move, F flips the board.</div>
              <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} />
            </TweakSection>
          ) : <TweakSection label="Video">
            <div className="twk-note">Drag or tap a piece to try your own moves; click a move in Moves to jump to it. Keys: ← → moves, Shift+← → 1 s, Space play/pause, Home or 0 start, End last move.</div>
            {(downloads || !IN_CLAUDE) && <TweakRadio id="tw-format" label="Export as" value={exportFormat} options={EXPORT_FORMATS} onChange={(v) => setTweak('exportFormat', v)} />}
            {(downloads || !IN_CLAUDE) && webp && <>
              <TweakSelect id="tw-webp-width" label="WebP width" value={webpPx(webpWidth)} options={webpWidths.map(webpPx)} onChange={(v) => setTweak('webpWidth', webpWidths.find((x) => webpPx(x) === v))} />
              <TweakSlider id="tw-webp-q" label="WebP quality" value={webpQuality} min={WEBP_QUALITY.min} max={WEBP_QUALITY.max} step={WEBP_QUALITY.step} onChange={(v) => setTweak('webpQuality', v)} />
            </>}
            {(downloads || !IN_CLAUDE) && <TweakSelect id="tw-fps" label="Export frame rate" value={exportFps + ' fps'} options={EXPORT_FPS_OPTIONS.map((f) => f + ' fps')} onChange={(v) => setTweak('exportFps', parseInt(v, 10))} />}
            {(downloads || !IN_CLAUDE) && <>
              <div className="twk-pair">
                <TweakSelect id="tw-clip-from" label="From" aria="Export from" value={clipFromOpts.find((o) => o.i === clipFrom).s} options={clipFromOpts.map((o) => o.s)} onChange={(v) => setClip((c) => ({ ...c, from: clipFromOpts.find((o) => o.s === v).i }))} />
                <TweakSelect id="tw-clip-to" label="To" aria="Export to" value={clipToOpts.find((o) => o.i === clipTo).s} options={clipToOpts.map((o) => o.s)} onChange={(v) => setClip((c) => ({ ...c, to: clipToOpts.find((o) => o.s === v).i }))} />
              </div>
              <TweakButton label={`${webp ? 'Export animated WebP (' : 'Export video (MP4, '}${exportFps} fps, ${fmtLen(clipT.end - clipT.start)})`} disabled={video.busy} onClick={exportVideo} />
              <div className="twk-note">Renders every frame in this tab: about {fmtLen(Math.ceil((clipT.end - clipT.start) * exportFps * 0.17))} for {clipSuffix ? 'these moves' : 'this game'}, longer on a phone. Higher frame rates are smoother but slower. Each move’s clip runs from just before it until the board settles. {webp ? 'No sound, and it loops; a smaller width or quality makes a smaller file.' : 'Includes move sounds when on.'} No camera push.</div>
            </>}
            <TweakToggle id="tw-flip" label="Flip board" value={!!t.flip} onChange={(v) => setTweak('flip', v)} />
            <TweakToggle id="tw-arrows" label="Best-move arrows" value={t.bestArrows} onChange={(v) => setTweak('bestArrows', v)} />
            <TweakToggle id="tw-push" label="Camera push on blunders" value={t.cameraPush} onChange={(v) => setTweak('cameraPush', v)} />
            <TweakToggle id="tw-glow" label="Red glow on blunders and mates" value={t.blunderGlow !== false} onChange={(v) => setTweak('blunderGlow', v)} />
            <TweakToggle id="tw-queen" label="Queen in the video" value={queenInVideo} onChange={(v) => setTweak('queenInVideo', v)} />
            <div className="twk-note">Shows Queen’s comments and lines on the moves it has analysed; those moves stay on screen longer.</div>
          </TweakSection>}
          <TweakSection label="About">
            <div className="twk-note">This player is free software under the GPL-3.0-or-later; <a href="https://github.com/boneyland/chess-replay" target="_blank" rel="noopener">source on GitHub</a>.</div>
          </TweakSection>
        </TweakColumn>
      </TweaksPanel>
    </React.Fragment>
  );
}

// A render error would leave a blank page, and saved data could bring it back on every visit: offer to clear it
// (the loaded game, Queen's answers and settings; the Hugging Face sign-in stays)
class Recover extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const reset = () => {
      try { Object.keys(localStorage).filter((k) => k.startsWith('chess-video.') && k !== AUTH_STORE).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    };
    return (
      <div role="alert" style={{ maxWidth: 520, margin: '15vh auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--ink)', font: '15px/1.55 var(--sans)' }}>
        <strong style={{ fontSize: 18 }}>Something on this page broke.</strong>
        <span>It may be a file loaded earlier, which the page reloads on every visit. Clearing the saved game, Queen’s answers and settings usually fixes it.</span>
        <span style={{ font: '13px var(--mono)', color: 'var(--dim)' }}>{String((this.state.error && this.state.error.message) || this.state.error)}</span>
        <button type="button" className="twk-btn" style={{ alignSelf: 'flex-start' }} onClick={reset}>Clear saved data and reload</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<Recover><GameApp /></Recover>);
