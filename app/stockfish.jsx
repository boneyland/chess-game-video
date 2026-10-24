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

// kind: 'lite' (next to the page) or 'full' (the viewer's download, sf-full.js); a change quits the engine running, and
// the next use starts the other. onBroken: the full engine's kept copy turned out missing or damaged (it is dropped)
function useEngine(hashMB, kind = 'lite', onBroken) {
  const ref = React.useRef(null), hash = React.useRef(hashMB), kindRef = React.useRef(kind), broken = React.useRef(onBroken);
  hash.current = hashMB;
  broken.current = onBroken;
  React.useEffect(() => { if (ref.current) ref.current.then((eng) => eng.setHash(hashMB), () => {}); }, [hashMB]);
  const [status, setStatus] = React.useState('idle');
  React.useEffect(() => {
    if (kindRef.current === kind) return;
    kindRef.current = kind;
    const old = ref.current;
    ref.current = null;
    setStatus('idle');
    if (old) old.then((eng) => eng.quit(), () => {});
  }, [kind]);
  const get = React.useCallback(() => {
    if (!ref.current) {
      setStatus('loading');
      // an engine that dies later is dropped too: the panels say so, and the next use starts a new one
      let mine = null;
      const start = async () => {
        let make = sfMakeWorker;
        if (kindRef.current === 'full') {
          try { make = await window.SFFull.start(); } catch (e) { if (broken.current) broken.current(); throw e; }
        } else if (!(await sfFilesPresent())) throw new Error('The Stockfish files are missing next to this page');
        const eng = window.SFEngine.create(make, { hashMB: hash.current, onFail: () => { if (ref.current === mine) { ref.current = null; setStatus('stopped'); } } });
        await eng.ready();
        return eng;
      };
      mine = ref.current = start().then((eng) => { if (ref.current === mine) setStatus('ready'); return eng; }, (e) => { if (ref.current === mine) { setStatus('unavailable'); ref.current = null; } throw e; });
      mine.catch(() => {});
    }
    return ref.current;
  }, []);
  return { get, status };
}

// The full engine's download (Settings › Engine): the site only, as the artifact carries the lite engine inline.
// state: 'checking', 'absent', 'downloading' (got: bytes so far) or 'ready'; err: why the last download or start failed
const SF_FULL_OFFERED = !window.SF_MAKE_WORKER && !!(window.SFFull && window.SFFull.supported());
const sfMB = (bytes) => Math.round(bytes / 1e6);
function useFullEngine() {
  const [st, setSt] = React.useState({ state: SF_FULL_OFFERED ? 'checking' : 'absent', got: 0, err: '' });
  const ctl = React.useRef(null);
  React.useEffect(() => {
    if (SF_FULL_OFFERED) window.SFFull.present().then((ok) => setSt((s) => (s.state === 'checking' ? { ...s, state: ok ? 'ready' : 'absent' } : s)));
  }, []);
  const download = async () => {
    if (ctl.current) return;
    const c = ctl.current = new AbortController();
    setSt({ state: 'downloading', got: 0, err: '' });
    try {
      // a render per megabyte, not per chunk
      await window.SFFull.download({ signal: c.signal, onProgress: (got) => setSt((s) => (sfMB(got) === sfMB(s.got) ? s : { ...s, got })) });
      setSt({ state: 'ready', got: 0, err: '' });
    } catch (e) {
      setSt({ state: 'absent', got: 0, err: c.signal.aborted ? '' : 'Download failed: ' + ((e && e.message) || e) });
    } finally { ctl.current = null; }
  };
  const cancel = () => { if (ctl.current) ctl.current.abort(); };
  const remove = async () => { cancel(); await window.SFFull.remove().catch(() => {}); setSt({ state: 'absent', got: 0, err: '' }); };
  const broken = React.useCallback(() => setSt({ state: 'absent', got: 0, err: 'The downloaded engine was missing or damaged, so Lite is running. Download it again to use Full.' }), []);
  return { offered: SF_FULL_OFFERED, ...st, download, cancel, remove, broken };
}

const sfIsBrowserAnalysis = (analysis) => {
  try { const a = typeof analysis === 'string' ? JSON.parse(analysis) : analysis; return !!(a && a.engine && Object.values(window.AnalysisCore.ENGINE_NAMES).includes(a.engine.name)); } catch (e) { return false; }
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

// This device's pace against the model's (AnalysisCore.paceFactor), from the last run that timed enough positions, for
// each engine (name: the settings' engine name; the full engine searches fewer nodes a second)
const SF_PACE_STORE = 'chess-video.sf-pace.v1', SF_PACE_MIN_POSITIONS = 10;
const sfPaceKey = (name) => (name === window.AnalysisCore.ENGINE_NAMES.full ? SF_PACE_STORE + '.full' : SF_PACE_STORE);
function readSfPace(name) { try { const f = +localStorage.getItem(sfPaceKey(name)); return f > 0 ? f : 1; } catch (e) { return 1; } }
function writeSfPace(name, f) { try { localStorage.setItem(sfPaceKey(name), String(f)); } catch (e) {} }

// The full-game analysis. Loading other files (another game, the sample) abandons a run in progress; its searches
// so far are kept, and starting it again resumes from them.
// getFiles: the loaded files as they are now (notes or commentary may have changed during the run)
// settings: the engine settings for a game (AnalysisCore.engineSettings().game); a run keeps those it started with
function useGameAnalysis(M, files, getFiles, commit, engine, settings) {
  const A = window.AnalysisCore, setKey = JSON.stringify(settings);
  const [pace, setPace] = React.useState(() => readSfPace(settings.name));
  React.useEffect(() => { setPace(readSfPace(settings.name)); }, [settings.name]);
  const perPos = A.secondsPerPosition(settings, pace);
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
    const ucis = M.plies.map((p) => p.uci), sans = M.plies.map((p) => p.san), N = ucis.length;
    const S = settings, earlier = readSfPartial(ucis, S, M.start.fen), d0 = Math.max(0, earlier.length - 1), prior = perPos;
    // the run's own pace: positions timed from when the engine is ready (its start-up isn't a position's cost)
    const timed = { n: 0, sec: 0, last: 0, searched: earlier.length };
    // { sec, at }: the latest estimate and when it was made; a timer counts it down in between
    me.eta = { sec: (N + 1 - earlier.length) * prior, at: Date.now() };
    setSt({ state: 'running', done: d0, total: N, etaSec: Math.round(me.eta.sec), err: '' });
    try {
      const eng = await engine.get();
      timed.last = Date.now();
      const json = await window.AnalysisCore.runAnalysis({
        engine: eng, ucis, sans, headers: M.headers, signal: me.signal, earlier, settings: S, startFen: M.start.fen,
        onSearched: (R) => {
          writeSfPartial(ucis, S, R, M.start.fen);
          if (JSON.stringify(S) === setKeyRef.current) setResumeAt(Math.max(0, R.length - 1));
          const now = Date.now();
          timed.sec += (now - timed.last) / 1000; timed.n += R.length - timed.searched; timed.searched = R.length; timed.last = now;
          me.eta = { sec: A.blendPace(prior, timed.sec, timed.n) * (N + 1 - R.length), at: now };
        },
        onProgress: (d, n) => { if (run.current === me && d > d0 && me.eta) setSt((s) => ({ ...s, done: d, total: n, etaSec: Math.round(me.eta.sec) })); },
      });
      if (run.current !== me) return;
      run.current = null;
      if (!json) { setSt(idle); return; }
      writeSfPartial(ucis, S, null, M.start.fen);
      setResumeAt(0);
      if (timed.n >= SF_PACE_MIN_POSITIONS) { const f = A.paceFactor(S, timed.sec / timed.n); writeSfPace(S.name, f); setPace(f); }
      const name = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_') + '_analysis.json';
      setSt(idle);
      commit({ ...getFiles(), analysis: json, analysisName: name, evalSource: null }); // shown, even over PGN evals
    } catch (e) {
      if (run.current !== me) return;
      run.current = null;
      setSt({ ...idle, err: engine.status === 'unavailable' ? '' : 'Analysis stopped: ' + ((e && e.message) || e) });
    }
  };
  // between positions the estimate counts down by the second
  React.useEffect(() => {
    if (st.state !== 'running') return;
    const id = setInterval(() => {
      const r = run.current;
      if (r && r.eta) setSt((s) => ({ ...s, etaSec: Math.max(1, Math.round(r.eta.sec - (Date.now() - r.eta.at) / 1000)) }));
    }, 1000);
    return () => clearInterval(id);
  }, [st.state]);
  const stop = () => { if (run.current) { run.current.signal.aborted = true; run.current = null; } setSt(idle); };
  const left = M.plies.length + 1 - (resumeAt ? resumeAt + 1 : 0);
  return { ...st, start, stop, resumeAt, plies: M.plies.length, estimateMin: Math.max(1, Math.ceil(left * perPos / 60)) };
}

// A button inside the video frame (frame pixels, theme colours)
function FrameButton({ primary, color, onClick, children, label }) {
  const c = color || C.best;
  return (
    <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ whiteSpace: 'nowrap', font: `600 ${primary ? 20 : 15}px ${MONO}`, letterSpacing: primary ? '0.02em' : '0.1em', textTransform: primary ? 'none' : 'uppercase', padding: primary ? '12px 22px' : '5px 12px', borderRadius: 8, cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', border: `1.5px solid ${c}`, background: primary ? c : 'transparent', color: primary ? C.bg : c }}>
      {children}
    </button>
  );
}

// time left: to 5 s under a minute, to 10 s under 5 min (so it visibly counts down), then to the minute
const fmtEta = (s) => {
  if (s == null) return '';
  if (Math.round(s / 5) * 5 < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)} s left`;
  if (s >= 300) return `about ${Math.round(s / 60)} min left`;
  const t = Math.round(s / 10) * 10, m = Math.floor(t / 60), x = t % 60;
  return `about ${m} min${x ? ` ${x} s` : ''} left`;
};

// The Analysis panel's body for a game without evals
// compact: a row under a panel that already shows PGN variations (no heading text)
function EngineEmptyState({ M, sf, paused, compact }) {
  const run = sf.run;
  if (run.state === 'running') {
    const k = run.total ? run.done / run.total : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ ...NO_SELECT, font: `500 22px ${MONO}`, color: C.ink }}>{sf.status !== 'ready' ? 'Starting Stockfish…' : `Analysing ${run.done} / ${run.total}${run.done > 0 ? ' · ' + fmtEta(run.etaSec) : ''}`}</span>
        <div style={{ height: 8, borderRadius: 4, background: C.off, overflow: 'hidden' }}><div style={{ width: `${(k * 100).toFixed(1)}%`, height: '100%', background: C.best }} /></div>
        {paused && <div><FrameButton onClick={sf.stop} label="Stop the analysis">Stop</FrameButton></div>}
      </div>
    );
  }
  const narrow = !L.header, est = `about ${sf.estimateMin} min`;
  const text = compact ? null : <span style={{ ...NO_SELECT, font: `400 26px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis for this game.</span>;
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
      {/* the phone's panel is too narrow for the estimate on the button: it goes beside it */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <FrameButton primary onClick={sf.start}>{(run.resumeAt ? `${narrow ? 'Resume' : 'Resume analysis'} from move ${Math.floor((M.ply0 + run.resumeAt) / 2) + 1}` : 'Analyse with Stockfish') + (narrow ? '' : ` · ${est}`)}</FrameButton>
        {narrow && <span style={{ ...NO_SELECT, font: `500 15px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{est}</span>}
      </div>
      {run.resumeAt > 0 && <span style={{ ...NO_SELECT, font: `500 15px ${MONO}`, color: C.dim }}>{run.resumeAt} of {run.plies} moves analysed so far.</span>}
      {!compact && <span style={{ ...NO_SELECT, font: `500 15px ${MONO}`, color: C.dim }}>{engineLabel(sf.game.name)} runs in your browser.</span>}
      {run.err && <span style={{ font: `500 15px ${MONO}`, color: C.blunder }}>{run.err}</span>}
    </div>
  );
}

// ---------- the viewer's own moves ----------
const SF_EVAL_CACHE = new Map(); // finished searches by settings and move list, for the session
const SF_DEEPER = new Map(); // presses of Go deeper by position (its key at the base settings), for the session

// Evaluates the positions before and after the viewer's move (move lists from the start, or from fen); the score streams in.
// own: the search settings (AnalysisCore.engineSettings().own); fen: the game's start FEN, omitted for the standard start.
// deeper(): searches both positions again, deeper (null when the search can't go further or hasn't finished); it counts
// for that position only, and a deeper search shows the last result until it passes that result's depth.
// stored: a loaded analysis's result for after (with before the same moves), standing in for the first search, which
// then never runs: only a press of Go deeper searches. Results from it carry stored: true; its src names the evals it
// comes from, so presses on one analysis's move don't carry over to another's (or the PGN's) once it is removed
function useMoveEval(engine, before, after, own, fen, stored) {
  const A = window.AnalysisCore;
  const keyOf = (s, moves) => (own.name ? own.name + '|' : '') + (sfStartFen(fen) ? fen + '|' : '') + `${s.depth}/${s.movetimeMs}:` + moves.join(' ');
  const toSearch = (o) => ({ depth: o.depth, movetimeMs: o.time_limit * 1000 });
  const baseKey = after ? keyOf(toSearch(own), after) + (stored ? '|' + stored.src : '') : '';
  const [, bump] = React.useState(0);
  const level = SF_DEEPER.get(baseKey) || 0;
  const search = toSearch(A.deeperSearch(own, level));
  const sfKey = (moves) => keyOf(search, moves);
  const key = after ? sfKey(after) : '';
  const empty = { key: '', before: null, after: null, pending: false };
  const [st, setSt] = React.useState(empty);
  React.useEffect(() => {
    if (!after) { setSt(empty); return; }
    let live = true;
    const at = (lv, m) => (lv === 0 && stored ? stored : SF_EVAL_CACHE.get(keyOf(toSearch(A.deeperSearch(own, lv)), m)) || null);
    const handles = [], cached = (m) => at(level, m);
    // the result a press of Go deeper started from, shown until the deeper search passes its depth
    const prev = (m) => (level > 0 ? at(level - 1, m) : null);
    const shown = (m) => cached(m) || (prev(m) && { ...prev(m), partial: true });
    setSt({ key, before: shown(before), after: shown(after), pending: !cached(after) || !cached(before) });
    (async () => {
      let eng;
      try { eng = await engine.get(); } catch (e) { if (live) setSt((s) => ({ ...s, pending: false })); return; }
      for (const [which, moves] of [['after', after], ['before', before]]) {
        if (!live) return;
        // the start position is both before and after: its second search is the first one's, cached
        if (cached(moves)) { const c = cached(moves); setSt((s) => ({ ...s, [which]: c })); continue; }
        const floor = prev(moves) ? prev(moves).depth : 0;
        const h = eng.search({ moves, fen, ...search, priority: 'own', onInfo: (sc) => { if (live && sc.depth > floor) setSt((s) => ({ ...s, [which]: { ...sc, best: sc.pv[0] || null, partial: true } })); } });
        handles.push(h);
        const r = await h.promise;
        if (!live) return;
        if (r && r.cp != null) { const fin = { ...r, best: A.bestOf(r) }; SF_EVAL_CACHE.set(sfKey(moves), fin); setSt((s) => ({ ...s, [which]: fin })); }
      }
      if (live) setSt((s) => ({ ...s, pending: false }));
    })();
    return () => { live = false; handles.forEach((h) => h.cancel()); };
  }, [key]);
  const out = st.key === key ? st : { ...empty, pending: !!after };
  const done = out.after && !out.after.partial && out.before && !out.before.partial && !out.pending;
  const next = A.deeperSearch(own, level + 1);
  const deeper = done && A.canGoDeeper(own, level) ? () => { SF_DEEPER.set(baseKey, level + 1); bump((n) => n + 1); } : null;
  return { ...out, deeper, deeperTo: deeper ? next : null };
}

// Go deeper: the small + by an eval that has finished; the EVAL line above an eval keeps its height (minHeight: 30)
// whether or not it shows, so the panel doesn't jump as moves change
function DeeperButton({ ev }) {
  if (!ev || !ev.deeper) return null;
  const t = ev.deeperTo, tip = `Go deeper: depth ${t.depth}, up to ${t.time_limit} s`;
  return (
    <button type="button" aria-label={tip} title={tip} onClick={(e) => { e.stopPropagation(); ev.deeper(); }} onPointerDown={(e) => e.stopPropagation()}
      style={{ ...NO_SELECT, width: 30, height: 30, padding: 0, marginLeft: 10, verticalAlign: 'middle', borderRadius: 5, cursor: 'pointer', border: `1.5px solid ${C.best}`, background: 'transparent', color: C.best, font: `700 24px/1 ${MONO}` }}>+</button>
  );
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
          <span style={{ font: `600 13px ${MONO}`, color: C.dim, letterSpacing: '0.12em', display: 'flex', alignItems: 'center', minHeight: 30 }}>EVAL{after && after.partial ? ` · DEPTH ${after.depth}` : ''}<DeeperButton ev={own} /></span>
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
