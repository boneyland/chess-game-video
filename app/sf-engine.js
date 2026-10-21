// Stockfish over UCI in a Web Worker: one search at a time, picked by priority: 'play' (Stockfish's own move in a game against
// the viewer, which must never wait behind analysis), then 'own' (the viewer's own moves), then 'game' (queued game positions);
// in queue order within a priority. A running search is never interrupted for a higher one.
// Positions go to the engine as move lists from the start: the standard one, or a game's start FEN (the page's FENs carry no castling or en passant).
(function () {
  const positionCommand = (moves, fen) => {
    const base = fen && fen !== window.ChessCore.START_FEN ? 'position fen ' + fen : 'position startpos';
    return moves.length ? base + ' moves ' + moves.join(' ') : base;
  };

  // makeWorker: () => a Worker (or anything with postMessage, onmessage, onerror, terminate)
  // the 1.8 MB wasm downloads and compiles inside this window, so it allows a slow phone connection
  const READY_TIMEOUT_MS = 30000;

  // onFail(err): called once when the engine dies, before or after it started
  function create(makeWorker, { hashMB = 64, readyTimeoutMs = READY_TIMEOUT_MS, onFail } = {}) {
    const worker = makeWorker();
    const waiting = []; // [regex, resolve] for ready()
    const queue = [];
    let cur = null, readyP = null, rejectReady = null, isReady = false, failed = null;
    let hashWant = hashMB, hashSet = null; // a new hash size waits for the engine to be between searches

    const pump = () => {
      if (cur || !isReady || failed) return;
      if (hashWant !== hashSet) { worker.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant; }
      let i = queue.findIndex((q) => q.priority === 'play');
      if (i < 0) i = queue.findIndex((q) => q.priority === 'own');
      if (i < 0) i = 0;
      const q = queue.splice(i, 1)[0];
      if (!q) return;
      cur = q;
      worker.postMessage(positionCommand(q.moves, q.fen));
      worker.postMessage(`go depth ${q.depth} movetime ${q.movetimeMs}`);
    };
    worker.onmessage = (e) => {
      const line = String(e.data);
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i][0].test(line)) waiting.splice(i, 1)[0][1]();
      if (!cur) return;
      if (line.startsWith('info')) {
        // the eval and line come from the last complete depth; time, nodes and depth reached from the whole search
        const st = window.AnalysisCore.infoStats(line);
        if (st) {
          cur.maxDepth = Math.max(cur.maxDepth || 0, st.depth);
          if (st.nodes != null) cur.nodes = st.nodes;
          if (st.timeMs != null) cur.timeMs = st.timeMs;
        }
        const s = window.AnalysisCore.infoToScore(line, (cur.moves.length % 2 === 0) === (cur.fen ? cur.fen.split(' ')[1] !== 'b' : true) ? 'w' : 'b');
        if (s) cur.last = s;
        if (cur.onInfo && cur.last && (s || st)) cur.onInfo({ ...cur.last, nodes: cur.nodes, timeMs: cur.timeMs, maxDepth: cur.maxDepth });
      } else if (line.startsWith('bestmove')) {
        const best = line.split(/\s+/)[1], q = cur, l = q.last;
        cur = null;
        q.resolve({ cp: l ? l.cp : null, depth: l ? l.depth : 0, maxDepth: q.maxDepth == null ? (l ? l.depth : 0) : q.maxDepth, pv: l ? l.pv : [], nodes: q.nodes == null ? null : q.nodes, timeMs: q.timeMs == null ? null : q.timeMs, best: !best || best === '(none)' ? null : best });
        pump();
      }
    };
    // a dead engine answers every pending and later search with null, so nothing waits forever
    const fail = (e) => {
      const first = !failed;
      failed = failed || e || new Error('engine error');
      const pending = (cur ? [cur] : []).concat(queue.splice(0));
      cur = null;
      pending.forEach((q) => q.resolve(null));
      if (rejectReady) { rejectReady(failed); rejectReady = null; }
      try { worker.terminate(); } catch (err) {} // a late-loading worker would otherwise hold its memory
      if (first && onFail) onFail(failed);
    };
    worker.onerror = (e) => fail(e);

    const expect = (re) => new Promise((res) => waiting.push([re, res]));
    function ready() {
      if (readyP) return readyP;
      readyP = new Promise((resolve, reject) => {
        rejectReady = reject;
        const timer = setTimeout(() => fail(new Error('Stockfish did not start')), readyTimeoutMs);
        (async () => {
          const ok = expect(/^uciok/); worker.postMessage('uci'); await ok;
          worker.postMessage(`setoption name Hash value ${hashWant}`); hashSet = hashWant;
          const rd = expect(/^readyok/); worker.postMessage('isready'); await rd;
          clearTimeout(timer);
          if (!failed) { isReady = true; rejectReady = null; resolve(); pump(); }
        })();
      });
      return readyP;
    }

    function search({ moves, fen, depth, movetimeMs, priority = 'game', onInfo }) {
      let q;
      const promise = new Promise((resolve) => { q = { moves, fen, depth, movetimeMs, priority, onInfo, resolve, last: null }; });
      if (failed) q.resolve(null); else { queue.push(q); pump(); }
      return {
        promise,
        cancel() {
          const i = queue.indexOf(q);
          if (i >= 0) { queue.splice(i, 1); q.resolve(null); } else if (cur === q) { q.onInfo = null; worker.postMessage('stop'); }
        },
      };
    }

    // takes effect before the next search (the one running keeps its table)
    function setHash(mb) { hashWant = mb; pump(); }

    function quit() {
      queue.splice(0).forEach((q) => q.resolve(null));
      try { worker.postMessage('quit'); } catch (e) {}
      try { worker.terminate(); } catch (e) {}
    }

    return { ready, search, setHash, quit, failed: () => failed };
  }

  window.SFEngine = { create, positionCommand, READY_TIMEOUT_MS };
})();
