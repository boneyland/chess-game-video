// ---------- loader ----------
// Replaces the Claude Design host hooks: commentary goes through the artifact `sample`
// capability, the notes file through `downloads`, and settings open from a page button.
const STORE = 'chess-video.files.v1';
const SAMPLE = { pgn: window.SAMPLE_PGN, analysis: window.SAMPLE_ANALYSIS, sampleNotes: window.SAMPLE_NOTES, sample: true };
// the published claude.ai artifact, where the `sample` capability lets Claude write commentary
const CLAUDE_URL = 'https://claude.ai/artifact/5yXwsRkre66WZZ8AEmLrqT';
function readStored() { try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && (s.pgn || s.analysis)) return s; } catch (e) {} return SAMPLE; }
const PLAYBACK = '{"mode":"loop"}';

function useCapability(name) {
  const [cap, setCap] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    if (window.claude && typeof window.claude.use === 'function') window.claude.use(name).then((c) => { if (live) setCap(c || null); }, () => {});
    return () => { live = false; };
  }, [name]);
  return cap;
}

// Auto follows the viewer's claude.ai theme (data-theme on the root) or the system setting; Light/Dark override both
function useScheme(pref) {
  // the notes site embeds this page in an iframe; its Material palette toggle sets data-md-color-scheme
  const parentScheme = () => {
    try { const b = window.parent !== window && window.parent.document.body; const s = b && b.getAttribute('data-md-color-scheme'); return s ? (s === 'slate' ? 'dark' : 'light') : null; } catch (e) { return null; }
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
    return () => { try { if (mq) mq.removeEventListener('change', update); } catch (e) {} mo.disconnect(); };
  }, [pref]);
  return mode;
}

function GameApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
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
  const [queenOpen, setQueenOpen] = React.useState(false);
  const [queenArrow, setQueenArrow] = React.useState(null);
  // the portrait layout folds the dock's buttons into a menu in the transport bar; it closes on a pick, an outside tap or Esc
  const [tall, setTall] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => { if (!tall) setMenu(false); }, [tall]);
  const dockRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (dockRef.current && !dockRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [menu]);
  const built = React.useMemo(() => { try { return { M: window.ChessCore.buildGame(files) }; } catch (e) { return { error: e.message }; } }, [files]);
  const lastGood = React.useRef(null);
  if (built.M) lastGood.current = built.M;
  const M = built.M || lastGood.current || window.ChessCore.buildGame(SAMPLE);
  const hf = useHfAuth();
  const Q = useQueen(M, mcp, hf);
  const engine = useEngine();
  const queenInVideo = t.queenInVideo !== false;
  const MV = React.useMemo(() => (queenInVideo ? withQueen(M, Q.resultAt) : M), [M, Q.cache, queenInVideo]);
  const TM = React.useMemo(() => window.ChessCore.timing(MV, { secondsPerMove: t.secondsPerMove, keyHold: t.keyHold, fastOpening: t.fastOpening }), [MV, t.secondsPerMove, t.keyHold, t.fastOpening]);
  const scenes = JSON.stringify(TM.scenes);
  const fmtLen = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  const closePanel = React.useCallback(() => setPanel(false), []);
  React.useEffect(() => { setQueenArrow(null); }, [M]);

  const commit = (next) => {
    try { window.ChessCore.buildGame(next); } catch (e) { setErr(e.message); return; }
    setErr(''); setFiles(next);
    try { if (next.sample && !next.evalSource && !next.aiNotes) localStorage.removeItem(STORE); else localStorage.setItem(STORE, JSON.stringify(next)); } catch (e) { setErr('Loaded, but the files are too large to remember after reload.'); }
  };
  const loadFiles = async (list) => {
    const batch = {};
    try {
      for (const f of Array.from(list)) { const text = await f.text(); const kind = window.ChessCore.classifyFile(f.name, text); batch[kind] = text; batch[kind + 'Name'] = f.name; }
    } catch (e) { setErr('Could not read that file: ' + ((e && e.message) || e)); return; }
    if (!batch.pgn && !batch.analysis && !batch.notes) { setErr('That file isn’t a PGN, an analysis JSON or a notes file.'); return; }
    let next;
    if (batch.pgn) {
      next = { ...batch, gameIndex: 0 };
      if (!batch.analysis && files.analysis && !files.sample) { try { window.ChessCore.buildGame({ ...next, analysis: files.analysis }); next.analysis = files.analysis; next.analysisName = files.analysisName; } catch (e) {} }
    } else next = { ...files, ...batch, sample: false };
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
      const p = window.ChessCore.commentaryPrompt(base, { tone: t.aiTone || 'Broadcast', density: t.aiDensity || 'Key moments', audience: t.aiAudience || 'Beginners' });
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
    const txt = files.aiNotes || files.notes || files.sampleNotes || '';
    if (!txt) { setSaveMsg('There is no commentary to save yet.'); return; }
    saveFile(fileStem + '_notes.txt', txt, 'text/plain');
  };
  const browserAnalysis = React.useMemo(() => sfIsBrowserAnalysis(files.analysis), [files.analysis]);
  const saveAnalysis = () => {
    const a = typeof files.analysis === 'string' ? files.analysis : JSON.stringify(files.analysis, null, 2);
    saveFile(files.analysisName || fileStem + '_analysis.json', a, 'application/json');
  };
  const analysis = useGameAnalysis(M, files, () => filesRef.current, commit, engine);
  // Lichess's opening book per ply, built after the first paint (about 0.25 s the first time)
  const [book, setBook] = React.useState(null);
  React.useEffect(() => { setBook(null); const id = setTimeout(() => { try { setBook(window.Openings.book().byPly(M.plies.map((p) => p.uci))); } catch (e) {} }, 50); return () => clearTimeout(id); }, [M]);
  const exportFps = EXPORT_FPS_OPTIONS.includes(+t.exportFps) ? +t.exportFps : 8;
  const video = useVideoExport({ total: TM.total, fps: exportFps, stem: fileStem, save: (name, blob) => saveFile(name, blob, blob.type) });
  const exportVideo = () => { setPanel(false); setQueenOpen(false); video.run(); };
  const askQueen = () => { setQueenOpen((q) => !q); setPanel(false); };
  const sf = { engine, book, status: engine.status, run: analysis, start: analysis.start, stop: analysis.stop, estimateMin: analysis.estimateMin };

  const status = `${M.white.short} – ${M.black.short} · ${M.plies.length} plies` + (M.evalSource === 'analysis' ? ' · analysis evals' : M.evalSource === 'pgn' ? ' · PGN evals' : '') + (M.hasNotes ? ' · notes' : '') + (M.hasAiNotes ? ' · AI commentary' : '') + (files.sample ? ' (sample)' : '') + ' · ' + fmtLen(TM.total);
  const shownErr = err || built.error;

  const dockItems = (
    <div id="dock-items" className="dock-items">
      {tall && <span className="dock-menu-status">{shownErr || status}</span>}
      <button type="button" className="dock-btn dock-primary" onClick={() => { setMenu(false); inputRef.current.click(); }}>Load game…</button>
      <button type="button" className="dock-btn dock-queen" aria-expanded={queenOpen} onClick={() => { setMenu(false); askQueen(); }}>Ask Queen</button>
      <button type="button" className="dock-btn" aria-expanded={panel} onClick={() => { setMenu(false); setPanel((p) => !p); setQueenOpen(false); }}>Settings</button>
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

  return (
    <React.Fragment>
      <CompositionStage nav={nav} width={1920} height={1080} portrait={PORTRAIT} menu={tall ? menuEl : null} onLayout={setTall} scenes={scenes} playback={PLAYBACK} bg={C.bg}>
        <GameVideo M={MV} tw={video.busy ? { ...t, cameraPush: false, exporting: true } : t} d={TM.d} probe={probe} queen={queenArrow} nav={nav} scheme={scheme} sf={sf} />
      </CompositionStage>
      <input ref={inputRef} id="game-files" type="file" multiple accept=".pgn,.txt,.json,application/json,text/plain" hidden onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
      {!tall && (
        <div className={'dock' + (shownErr ? ' dock-err' : '')}>
          <span className="dock-status">{shownErr || status}</span>
          {dockItems}
        </div>
      )}
      {hf.note && (
        <div className="signin-note" role="status">{hf.note}<button type="button" className="twk-x" aria-label="Dismiss" onClick={hf.clearNote}>✕</button></div>
      )}
      {drag && (
        <div className="drop">
          <div className="drop-box">Drop a PGN<br /><span>with this page’s analysis or notes files too, if you have them · if dropping doesn’t work here, use Load game…</span></div>
        </div>
      )}
      <ExportOverlay x={video} />
      {queenOpen && <QueenPanel M={M} Q={Q} mcp={mcp} hf={hf} probe={probe} onClose={() => setQueenOpen(false)} onOverlay={setQueenArrow} />}
      <TweaksPanel open={panel} onClose={closePanel}>
        <TweakSection label="Appearance" />
        <TweakRadio id="tw-scheme" label="Theme" value={t.scheme || 'Auto'} options={['Auto', 'Light', 'Dark']} onChange={(v) => setTweak('scheme', v)} />
        <TweakSection label="Game" />
        <div className={shownErr ? 'twk-note twk-err' : 'twk-note'}>{shownErr || status}</div>
        <TweakButton label="Load game (PGN)…" onClick={() => inputRef.current.click()} />
        <div className="twk-note">Evals in the PGN are used as they are: Lichess’s [%eval] or cutechess’s +0.25/20 comments. Without them, use “Analyse with Stockfish” in the Analysis panel. Analysis and notes files saved from this page load here too.</div>
        {!files.sample && <TweakButton secondary label="Back to sample game" onClick={() => commit(SAMPLE)} />}
        {M.canChooseSource && (
          <TweakRadio id="tw-source" label="Evaluations from" value={M.evalSource === 'pgn' ? 'PGN' : 'Analysis'} options={['Analysis', 'PGN']} onChange={(v) => commit({ ...files, evalSource: v === 'PGN' ? 'pgn' : 'analysis' })} />
        )}
        {M.gameCount > 1 && (
          <TweakSelect id="tw-game" label="Game in PGN" value={String((files.gameIndex || 0) + 1)} options={Array.from({ length: M.gameCount }, (_, i) => String(i + 1))} onChange={(v) => commit({ ...files, gameIndex: +v - 1, analysis: null, analysisName: null })} />
        )}
        <TweakSection label="Commentary" />
        <TweakRadio id="tw-tone" label="Style" value={t.aiTone || 'Broadcast'} options={['Broadcast', 'Lesson', 'Concise']} onChange={(v) => setTweak('aiTone', v)} />
        <TweakRadio id="tw-aud" label="Audience" value={t.aiAudience || 'Beginners'} options={['Beginners', 'Club players', 'Experts']} onChange={(v) => setTweak('aiAudience', v)} />
        <TweakRadio id="tw-dens" label="Amount" value={t.aiDensity || 'Key moments'} options={['Key moments', 'Detailed']} onChange={(v) => setTweak('aiDensity', v)} />
        {sample
          ? <TweakButton disabled={ai.busy} label={ai.busy ? `Writing commentary…${ai.chars ? ' ' + ai.chars + ' chars' : ''}` : M.hasAiNotes ? 'Rewrite commentary with Claude' : 'Write commentary with Claude'} onClick={writeCommentary} />
          : !IN_CLAUDE && <div className="twk-note">To have Claude write the commentary, <a href={CLAUDE_URL} target="_blank" rel="noopener">open this page on claude.ai</a> and load the game there.</div>}
        {ai.err && <div className="twk-note twk-err">{ai.err}</div>}
        {M.hasNotes && <div className="twk-note">Your notes file takes priority over Claude's comments on the same move.</div>}
        {M.hasAiNotes && <TweakButton secondary label="Remove Claude's commentary" onClick={() => commit({ ...files, aiNotes: null, sampleNotes: files.sample ? window.SAMPLE_NOTES : null })} />}
        {(downloads || !IN_CLAUDE) && <TweakButton secondary label="Save commentary as notes file" onClick={downloadNotes} />}
        {browserAnalysis && (downloads || !IN_CLAUDE) && <TweakButton secondary label="Save analysis" onClick={saveAnalysis} />}
        {saveMsg && <div className="twk-note">{saveMsg}</div>}
        <TweakSection label="Pace" />
        <div className="twk-note">Video length {fmtLen(TM.total)}{TM.capped ? ' (capped at 5:00)' : ''}</div>
        <TweakSlider id="tw-spm" label="Seconds per move" value={t.secondsPerMove} min={0.5} max={4} step={0.1} unit="s" onChange={(v) => setTweak('secondsPerMove', v)} />
        <TweakSlider id="tw-hold" label="Extra hold on marked moves" value={t.keyHold} min={0} max={6} step={0.5} unit="s" onChange={(v) => setTweak('keyHold', v)} />
        <TweakToggle id="tw-fast" label="Faster opening" value={t.fastOpening} onChange={(v) => setTweak('fastOpening', v)} />
        <TweakSection label="Video" />
        <div className="twk-note">Drag a piece (or tap it, then tap a square) to try your own moves from any position. Click a move in the Moves panel to jump to it. Keys: ← → step through moves, Shift+← → scrub by 1 s, Space plays or pauses, End jumps to the last move.</div>
        {(downloads || !IN_CLAUDE) && <TweakSelect id="tw-fps" label="Export frame rate" value={exportFps + ' fps'} options={EXPORT_FPS_OPTIONS.map((f) => f + ' fps')} onChange={(v) => setTweak('exportFps', parseInt(v, 10))} />}
        {(downloads || !IN_CLAUDE) && <TweakButton label={`Export video (MP4, ${exportFps} fps)`} disabled={video.busy} onClick={exportVideo} />}
        {(downloads || !IN_CLAUDE) && <div className="twk-note">Draws every frame in this tab: about {fmtLen(Math.ceil(TM.total * exportFps * 0.17))} for this game, longer on a phone. More frames per second play smoother and take longer. The camera push is left out.</div>}
        <TweakToggle id="tw-arrows" label="Best-move arrows" value={t.bestArrows} onChange={(v) => setTweak('bestArrows', v)} />
        <TweakToggle id="tw-push" label="Camera push on blunders" value={t.cameraPush} onChange={(v) => setTweak('cameraPush', v)} />
        <TweakToggle id="tw-queen" label="Queen in the video" value={queenInVideo} onChange={(v) => setTweak('queenInVideo', v)} />
        <div className="twk-note">Shows Queen’s answers in Commentary and Analysis on the moves it has analysed. Moves with a Queen sentence stay on screen longer.</div>
        <TweakSection label="Engine" />
        <div className="twk-note">Your own moves and “Analyse with Stockfish” use Stockfish 19 lite running in your browser: depth 22 or 3 s per position for a game, depth 24 or 3 s for your moves. Stockfish is free software under the GPL-3.0; <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">source</a>.</div>
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<GameApp />);
