// ---------- Stockfish in the browser ----------
// One engine per page, started on first use; a full-game analysis on request; the viewer's own moves.
const SF_SITE_URL = 'https://chess-replay.onrender.com/';
// the engine sits next to the page on the self-hosted copy; the claude.ai build sets window.SF_MAKE_WORKER
const SF_FILE = 'stockfish-19-lite-single';
const sfMakeWorker = () => (window.SF_MAKE_WORKER ? window.SF_MAKE_WORKER() : new Worker(SF_FILE + '.js'));
// A missing engine file only shows up inside the worker (it never reaches the page as an error), so the
// self-hosted copy checks the wasm is there first rather than waiting out the start timeout
const sfFilesPresent = () => (window.SF_MAKE_WORKER ? Promise.resolve(true)
  : fetch(SF_FILE + '.wasm', { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false));

function useEngine(hashMB) {
  const ref = React.useRef(null), hash = React.useRef(hashMB);
  hash.current = hashMB;
  React.useEffect(() => { if (ref.current) ref.current.then((eng) => eng.setHash(hashMB), () => {}); }, [hashMB]);
  const [status, setStatus] = React.useState('idle');
  const get = React.useCallback(() => {
    if (!ref.current) {
      setStatus('loading');
      // an engine that dies later is dropped too: the panels say so, and the next use starts a new one
      let mine = null;
      const start = async () => {
        if (!(await sfFilesPresent())) throw new Error('The Stockfish files are missing next to this page');
        const eng = window.SFEngine.create(sfMakeWorker, { hashMB: hash.current, onFail: () => { if (ref.current === mine) { ref.current = null; setStatus('stopped'); } } });
        await eng.ready();
        return eng;
      };
      mine = ref.current = start().then((eng) => { setStatus('ready'); return eng; }, (e) => { setStatus('unavailable'); ref.current = null; throw e; });
      mine.catch(() => {});
    }
    return ref.current;
  }, []);
  return { get, status };
}

const sfIsBrowserAnalysis = (analysis) => {
  try { const a = typeof analysis === 'string' ? JSON.parse(analysis) : analysis; return !!(a && a.engine && a.engine.name === window.AnalysisCore.ENGINE.name); } catch (e) { return false; }
};

// The searches of a run that stopped part-way, kept for one game (the latest) so starting again resumes it; a page
// reload keeps them too. Keyed by the game's moves and the engine settings, so they never fill in another game.
const SF_PARTIAL_STORE = 'chess-video.sf-partial.v1';
// A game from a start FEN adds it to the key; a standard game's key is as it always was.
const sfStartFen = (fen) => (fen && fen !== window.ChessCore.START_FEN ? fen : null);
const sfPartialKey = (ucis, settings, fen) => JSON.stringify(sfStartFen(fen) ? [fen, settings, ucis] : [settings, ucis]);
function readSfPartial(ucis, settings, fen) {
  try { const s = JSON.parse(localStorage.getItem(SF_PARTIAL_STORE) || 'null'); return s && s.key === sfPartialKey(ucis, settings, fen) && Array.isArray(s.searched) ? s.searched : []; } catch (e) { return []; }
}
function writeSfPartial(ucis, settings, searched, fen) {
  try { if (searched) localStorage.setItem(SF_PARTIAL_STORE, JSON.stringify({ key: sfPartialKey(ucis, settings, fen), searched })); else localStorage.removeItem(SF_PARTIAL_STORE); } catch (e) {}
}

// The full-game analysis. Loading other files (another game, the sample) abandons a run in progress; its searches
// so far are kept, and starting it again resumes from them.
// getFiles: the loaded files as they are now (notes or commentary may have changed during the run)
// settings: the engine settings for a game (AnalysisCore.engineSettings().game); a run keeps those it started with
function useGameAnalysis(M, files, getFiles, commit, engine, settings) {
  const setKey = JSON.stringify(settings), perPos = window.AnalysisCore.secondsPerPosition(settings);
  const idle = { state: 'idle', done: 0, total: 0, etaSec: null, err: '' };
  const [st, setSt] = React.useState(idle);
  const run = React.useRef(null);
  const ucisKey = M.plies.map((p) => p.uci).join(' ');
  const setKeyRef = React.useRef(setKey);
  setKeyRef.current = setKey;
  // moves already analysed by a run that stopped
  const [resumeAt, setResumeAt] = React.useState(0);
  React.useEffect(() => { setResumeAt(Math.max(0, readSfPartial(M.plies.map((p) => p.uci), settings, M.start.fen).length - 1)); }, [ucisKey, setKey, M.start.fen]);
  React.useEffect(() => () => { if (run.current) { run.current.signal.aborted = true; run.current = null; } setSt(idle); }, [files.pgn, files.gameIndex || 0, !!files.sample, files.analysis]);
  const start = async () => {
    if (run.current) return;
    const me = { signal: { aborted: false } };
    run.current = me;
    const ucis = M.plies.map((p) => p.uci), sans = M.plies.map((p) => p.san), N = ucis.length, t0 = Date.now();
    const S = settings, earlier = readSfPartial(ucis, S, M.start.fen), d0 = Math.max(0, earlier.length - 1);
    setSt({ state: 'running', done: d0, total: N, etaSec: Math.round((N + 1 - earlier.length) * perPos), err: '' });
    try {
      const eng = await engine.get();
      const json = await window.AnalysisCore.runAnalysis({
        engine: eng, ucis, sans, headers: M.headers, signal: me.signal, earlier, settings: S, startFen: M.start.fen,
        onSearched: (R) => { writeSfPartial(ucis, S, R, M.start.fen); if (JSON.stringify(S) === setKeyRef.current) setResumeAt(Math.max(0, R.length - 1)); },
        onProgress: (d, n) => { if (run.current === me && d > d0) setSt((s) => ({ ...s, done: d, total: n, etaSec: Math.round(((Date.now() - t0) / 1000 / (d - d0 + (d0 ? 0 : 1))) * (n - d)) })); },
      });
      if (run.current !== me) return;
      run.current = null;
      if (!json) { setSt(idle); return; }
      writeSfPartial(ucis, S, null, M.start.fen);
      setResumeAt(0);
      const name = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_') + '_analysis.json';
      setSt(idle);
      commit({ ...getFiles(), analysis: json, analysisName: name, evalSource: null }); // shown, even over PGN evals
    } catch (e) {
      if (run.current !== me) return;
      run.current = null;
      setSt({ ...idle, err: engine.status === 'unavailable' ? '' : 'Analysis stopped: ' + ((e && e.message) || e) });
    }
  };
  const stop = () => { if (run.current) { run.current.signal.aborted = true; run.current = null; } setSt(idle); };
  const left = M.plies.length + 1 - (resumeAt ? resumeAt + 1 : 0);
  return { ...st, start, stop, resumeAt, plies: M.plies.length, estimateMin: Math.max(1, Math.ceil(left * perPos / 60)) };
}

// A button inside the video frame (frame pixels, theme colours)
function FrameButton({ primary, color, onClick, children, label }) {
  const c = color || C.best;
  return (
    <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ font: `600 ${primary ? 20 : 15}px ${MONO}`, letterSpacing: primary ? '0.02em' : '0.1em', textTransform: primary ? 'none' : 'uppercase', padding: primary ? '12px 22px' : '5px 12px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${c}`, background: primary ? c : 'transparent', color: primary ? C.bg : c }}>
      {children}
    </button>
  );
}

const fmtEta = (s) => (s == null ? '' : s < 60 ? `about ${Math.max(5, Math.round(s / 5) * 5)} s left` : `about ${Math.round(s / 60)} min left`);

// The Analysis panel's body for a game without evals
// compact: a row under a panel that already shows PGN variations (no heading text)
function EngineEmptyState({ M, sf, paused, compact }) {
  const run = sf.run;
  if (run.state === 'running') {
    const k = run.total ? run.done / run.total : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ font: `500 22px ${MONO}`, color: C.ink }}>{sf.status !== 'ready' ? 'Starting Stockfish…' : `Analysing ${run.done} / ${run.total}${run.done > 0 ? ' · ' + fmtEta(run.etaSec) : ''}`}</span>
        <div style={{ height: 8, borderRadius: 4, background: C.off, overflow: 'hidden' }}><div style={{ width: `${(k * 100).toFixed(1)}%`, height: '100%', background: C.best }} /></div>
        {paused && <div><FrameButton onClick={sf.stop} label="Stop the analysis">Stop</FrameButton></div>}
      </div>
    );
  }
  const text = compact ? null : <span style={{ font: `400 26px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis for this game.</span>;
  if (!paused) return text;
  if (sf.status === 'unavailable') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {text}
        <span style={{ font: `500 17px ${MONO}`, color: C.dim }}>Stockfish can't run here.{IN_CLAUDE && <> Open the <a href={SF_SITE_URL} target="_blank" rel="noopener" style={{ color: C.best }}>self-hosted copy</a> to analyse.</>}</span>
        <div><FrameButton onClick={sf.start} label="Try starting Stockfish again">Try again</FrameButton></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
      {text}
      <FrameButton primary onClick={sf.start}>{run.resumeAt ? `Resume analysis from move ${Math.floor((M.ply0 + run.resumeAt) / 2) + 1} · about ${sf.estimateMin} min` : `Analyse with Stockfish · about ${sf.estimateMin} min`}</FrameButton>
      {run.resumeAt > 0 && <span style={{ font: `500 15px ${MONO}`, color: C.dim }}>{run.resumeAt} of {run.plies} moves analysed so far.</span>}
      {!compact && <span style={{ font: `500 15px ${MONO}`, color: C.dim }}>Stockfish 19 lite runs in your browser.</span>}
      {run.err && <span style={{ font: `500 15px ${MONO}`, color: C.blunder }}>{run.err}</span>}
    </div>
  );
}

// ---------- the viewer's own moves ----------
const SF_EVAL_CACHE = new Map(); // finished searches by settings and move list, for the session

// Evaluates the positions before and after the viewer's move (move lists from the start, or from fen); the score streams in.
// own: the search settings (AnalysisCore.engineSettings().own); fen: the game's start FEN, omitted for the standard start
function useMoveEval(engine, before, after, own, fen) {
  const search = { depth: own.depth, movetimeMs: own.time_limit * 1000 };
  const sfKey = (moves) => (sfStartFen(fen) ? fen + '|' : '') + `${search.depth}/${search.movetimeMs}:` + moves.join(' ');
  const key = after ? sfKey(after) : '';
  const empty = { key: '', before: null, after: null, pending: false };
  const [st, setSt] = React.useState(empty);
  React.useEffect(() => {
    if (!after) { setSt(empty); return; }
    let live = true;
    const handles = [], cached = (m) => SF_EVAL_CACHE.get(sfKey(m)) || null;
    setSt({ key, before: cached(before), after: cached(after), pending: !cached(after) || !cached(before) });
    (async () => {
      let eng;
      try { eng = await engine.get(); } catch (e) { if (live) setSt((s) => ({ ...s, pending: false })); return; }
      for (const [which, moves] of [['after', after], ['before', before]]) {
        if (!live) return;
        if (cached(moves)) continue;
        const h = eng.search({ moves, fen, ...search, priority: 'own', onInfo: (sc) => { if (live) setSt((s) => ({ ...s, [which]: { ...sc, best: sc.pv[0] || null, partial: true } })); } });
        handles.push(h);
        const r = await h.promise;
        if (!live) return;
        if (r && r.cp != null) { const fin = { ...r, best: window.AnalysisCore.bestOf(r) }; SF_EVAL_CACHE.set(sfKey(moves), fin); setSt((s) => ({ ...s, [which]: fin })); }
      }
      if (live) setSt((s) => ({ ...s, pending: false }));
    })();
    return () => { live = false; handles.forEach((h) => h.cancel()); };
  }, [key]);
  return st.key === key ? st : { ...empty, pending: !!after };
}

const fmtSf = (cp) => {
  if (cp == null) return '…';
  if (Math.abs(cp) >= 9000) { const n = Math.round((10000 - Math.abs(cp)) / 10); return n === 0 ? (cp > 0 ? '1-0' : '0-1') : (cp > 0 ? 'M' : '−M') + n; }
  return (cp > 0 ? '+' : cp < 0 ? '−' : '') + Math.abs(cp / 100).toFixed(2);
};

// The Analysis panel while the viewer plays their own line: their move, its eval, what it costs, Stockfish's reply
function OwnMoveAnalysis({ M, vline, own, status, onReply }) {
  const step = vline.moves[vline.upto], ply = vline.at + vline.upto, isWhite = (M.ply0 + ply) % 2 === 0;
  const { before, after } = own;
  const done = before && after && !before.partial && !after.partial;
  const rated = done ? window.AnalysisCore.rateMove({ bestEval: before.cp, currentEval: after.cp, isWhite, playedIsBest: step.uci === before.best, isCheckmate: step.san.endsWith('#') }) : null;
  const bad = rated && ['inaccuracy', 'mistake', 'blunder'].includes(rated.classification);
  const col = bad ? clsColor(rated.classification) : lineAccent('you');
  const who = step.byEngine ? 'STOCKFISH’S REPLY' : 'YOUR MOVE';
  const verdict = !rated ? (status === 'unavailable' ? 'Stockfish can’t run here' : status === 'stopped' ? 'Stockfish stopped · play a move to restart it' : 'Stockfish is thinking…')
    : step.uci === before.best ? 'Stockfish’s choice'
    : rated.evalLoss > 0 ? `−${Math.round(rated.evalLoss)} cp vs ${own.bestSan || before.best}` : `as good as ${own.bestSan || before.best}`;
  const replies = [];
  if (after && after.pv) { let pos = step.pos; for (const u of after.pv.slice(0, 8)) { const s = window.ChessCore.stepFromUci(pos, u); if (!s) break; replies.push({ ...s, byEngine: true }); pos = s.pos; } }
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 38px ${MONO}`, color: col }}>{lineLabel(M, vline.at, vline.upto, step.san)}</span>
          <span style={{ font: `600 16px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{who} · {bad ? CLASS_LABEL[rated.classification] + ' · ' : ''}{verdict}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ font: `600 13px ${MONO}`, color: C.dim, letterSpacing: '0.12em' }}>EVAL{after && after.partial ? ` · DEPTH ${after.depth}` : ''}</span>
          <span style={{ font: `700 38px ${MONO}`, color: C.ink }}>{(status === 'unavailable' || status === 'stopped') && !(after && !after.partial) ? '—' : fmtSf(after && after.cp)}</span>
        </div>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, font: `500 18px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {replies.length > 0
          ? <LineChips name="Stockfish replies" nameColor={C.ink} accent={C.best} moves={replies.map((r) => r.san)} ply0={M.ply0} c={ply + 1} legal={replies.length} sel={null} onPick={(j) => onReply(replies.slice(0, j + 1))} />
          : <span>{step.san.endsWith('#') ? 'Checkmate.' : ' '}</span>}
      </div>
    </React.Fragment>
  );
}
