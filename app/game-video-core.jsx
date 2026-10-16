const MOTION = { enter: Easing.easeOutCubic, move: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const lerp = (a, b, k) => a + (b - a) * k;
const cl01 = (v) => clamp(v, 0, 1);
const { winChance, plyCp } = window.ChessCore;

// Frame palettes. Board squares and the eval bar's white/black halves are the sides' colours and stay put.
const PALETTES = {
  dark: {
    bg: '#13100f', panel: '#1b1715', line: 'rgba(255,236,214,0.09)', ink: '#efe8de', dim: '#8e8276',
    light: '#f0d9b5', dark: '#b58863', last: '#e3b55b',
    best: '#62c483', inaccuracy: '#e6c14d', mistake: '#ec9442', blunder: '#e4553f', none: '#efe8de',
    good: '#5aa9e6', brilliant: '#3cc7bd', interesting: '#c98be0', queen: '#e0609f',
    off: '#2a2320', scrim: '19,16,15', rim: 'drop-shadow(0 0 1px rgba(239,232,222,0.95)) drop-shadow(0 0 1px rgba(239,232,222,0.6))',
  },
  light: {
    bg: '#f2ece3', panel: '#fbf7f1', line: 'rgba(60,40,20,0.13)', ink: '#2a211b', dim: '#76695c',
    light: '#f0d9b5', dark: '#b58863', last: '#a8741f',
    best: '#2b8f53', inaccuracy: '#a07c0c', mistake: '#c0601a', blunder: '#c63b29', none: '#2a211b',
    good: '#2a78b8', brilliant: '#16877f', interesting: '#8f4fab', queen: '#c03f7c',
    off: '#e4dbcd', scrim: '242,236,227', rim: 'none',
  },
};
const C = { ...PALETTES.dark };
const setPalette = (mode) => Object.assign(C, PALETTES[mode] || PALETTES.dark);
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", monospace';
const SERIF = '"Instrument Serif", serif';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CLASS_LABEL = { best: 'Best move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', none: 'Playable', good: 'Good move', brilliant: 'Brilliant', interesting: 'Interesting' };
const clsColor = (cls) => C[cls] || C.ink;
// The board looks the same in both themes: what's drawn on it (highlights, badges, arrows, check glow) uses these
const BOARD = PALETTES.dark;
const boardCls = (cls) => BOARD[cls] || BOARD.last;
const LAST_MOVE = 'rgba(155,199,0,0.41)'; // Lichess's last-move tint, clear on both square colours

const SQ = 96, BW = SQ * 8;
// Frame layouts. Landscape is the 1920×1080 video; portrait (phones) stacks the panels under the board.
// k magnifies a box's contents, so text designed for the wide frame stays readable on a small screen.
const LAYOUTS = {
  wide: {
    eval: 44, bx: 100, by: 88, bar: { k: 1, gap: 10 }, title: 13,
    header: { x: 916, y: 40, w: 964, h: 170, k: 1 },
    moves: { x: 916, y: 228, w: 330, h: 380, k: 1, rows: 8 },
    comment: { x: 1266, y: 228, w: 614, h: 380, k: 1, text: 1, gap: 18 },
    analysis: { x: 916, y: 626, w: 964, h: 278, k: 1 },
    plot: { x: 44, y: 930, w: 1836, h: 120, k: 1 },
    card: { k: 1, w: 1700, stack: false },
  },
};
// Portrait: 840 wide, and as tall as the screen allows. Commentary and the moves/plot row take the extra height.
const PORTRAIT = { width: 840, minHeight: 1810, maxHeight: 2100 };
function tallLayout(H) {
  // the moves/plot row gets half the extra height (each move row is 42 px), commentary the rest
  const extra = Math.max(0, H - PORTRAIT.minHeight), rowH = 244 + Math.floor(extra * 0.5), commentH = 300 + extra - Math.floor(extra * 0.5);
  // player bars (40 px × 1.4) sit 5 px from the board, 2 px from the frame's top edge
  const by = 2 + 56 + 5, cy = by + BW + 5 + 56 + 8;
  const ay = cy + commentH + 12, ry = ay + 330 + 12;
  return {
    eval: 12, bx: 60, by, bar: { k: 1.4, gap: 5 }, title: 19,
    header: null,
    comment: { x: 4, y: cy, w: 832, h: commentH, k: 1, text: 42 / 44, gap: 10 },
    analysis: { x: 4, y: ay, w: 832, h: 330, k: 1.2 },
    moves: { x: 4, y: ry, w: 338, h: rowH, k: 1.1, rows: Math.max(4, Math.floor((rowH / 1.1 - 61) / 38)) },
    plot: { x: 354, y: ry, w: 482, h: rowH, k: 1.1 },
    card: { k: 1.3, w: 600, stack: true },
  };
}
let L = LAYOUTS.wide, BX = L.bx, BY = L.by, tallH = 0;
const setLayout = (frame) => {
  if (frame.tall && frame.height !== tallH) { tallH = frame.height; LAYOUTS.tall = tallLayout(tallH); }
  L = frame.tall ? LAYOUTS.tall : LAYOUTS.wide; BX = L.bx; BY = L.by;
};

const sqXY = (sq) => [sq.charCodeAt(0) - 97, 8 - +sq[1]];
const sqC = (sq) => { const [x, y] = sqXY(sq); return [x * SQ + SQ / 2, y * SQ + SQ / 2]; };
const label = (M, i) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'} ${M.plies[i].san}${M.plies[i].mark || ''}`;
const fmtEval = (p) => {
  if (!p) return '0.00';
  if (p.checkmate) return p.side === 'w' ? '1-0' : '0-1';
  if (p.mate != null) return (p.mate > 0 ? 'M' : '−M') + Math.abs(Math.round(p.mate));
  const v = plyCp(p) / 100; return (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + Math.abs(v).toFixed(2);
};
const fmtClock = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), x = Math.floor(s % 60); return s < 20 ? `0:${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}` : `${m}:${String(x).padStart(2, '0')}`; };
const img = (color, type) => window.PIECE_IMG[color + type.toUpperCase()];

function simulate(M) {
  const rows = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'.split('/');
  const board = {}, pieces = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const sq = String.fromCharCode(97 + f) + (8 - r);
      const p = { id: sq, color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase(), home: sq, track: [], captured: -1, promo: null };
      pieces.push(p); board[sq] = p; f++;
    }
  });
  const step = (from, to, i) => {
    const p = board[from];
    if (board[to]) board[to].captured = i;
    board[to] = p; delete board[from];
    p.track.push({ ply: i, from, to });
    return p;
  };
  M.plies.forEach((pl, i) => {
    const f = pl.uci.slice(0, 2), t = pl.uci.slice(2, 4), p = board[f];
    if (p.type === 'p' && f[0] !== t[0] && !board[t]) { const epSq = t[0] + f[1]; if (board[epSq]) { board[epSq].captured = i; delete board[epSq]; } }
    step(f, t, i);
    if (p.type === 'k' && Math.abs(f.charCodeAt(0) - t.charCodeAt(0)) === 2) { const r = t[1]; if (t[0] === 'g') step('h' + r, 'f' + r, i); else step('a' + r, 'd' + r, i); }
    if (pl.uci.length === 5) p.promo = { ply: i, type: pl.uci[4] };
  });
  return pieces;
}

// ---------- schedule ----------
const AFTER = { Opening: 'Middlegame', Middlegame: 'Critical', Critical: 'Endgame', Endgame: 'Outro' };
function useSchedule(M, CUES, d) {
  const weightOf = (p, i) => d[i];
  return React.useMemo(() => {
    const N = M.plies.length, tp = new Array(N), groups = [];
    let pendingStart = null;
    window.ChessCore.plan(M).forEach(([name, a, b]) => {
      if (b >= a) { groups.push({ a, b, start: pendingStart != null ? pendingStart : CUES[name], end: CUES[AFTER[name]] }); pendingStart = null; }
      else if (groups.length) groups[groups.length - 1].end = CUES[AFTER[name]];
      else if (pendingStart == null) pendingStart = CUES[name];
    });
    groups.forEach((g, gi) => {
      const lead = gi === 0 ? 1.2 : 0.6, tail = gi === groups.length - 1 ? 2.6 : 0.5;
      let tot = 0; for (let i = g.a; i <= g.b; i++) tot += weightOf(M.plies[i], i);
      const span = g.end - g.start - lead - tail; let acc = 0;
      for (let i = g.a; i <= g.b; i++) { tp[i] = g.start + lead + (acc / tot) * span; acc += weightOf(M.plies[i], i); }
    });
    const md = tp.map((t, i) => Math.min(0.5, 0.6 * ((i + 1 < N ? tp[i + 1] : t + 1) - t)));
    const blunders = M.plies.map((p, i) => i).filter((i) => M.plies[i].cls === 'blunder');
    return { tp, md, N, blunders };
  }, [M, CUES, d]);
}
const lastPly = (T, S) => { let k = -1; for (let i = 0; i < S.N; i++) { if (T >= S.tp[i]) k = i; else break; } return k; };
const cpOf = (M, i) => (i < 0 ? M.evalStart : plyCp(M.plies[i]));
function evalNow(M, T, S) {
  const c = lastPly(T, S);
  if (c < 0) return { c, cp: M.evalStart, k: 1 };
  const k = MOTION.move(cl01((T - S.tp[c] - S.md[c] * 0.6) / 0.55));
  return { c, k, cp: lerp(cpOf(M, c - 1), cpOf(M, c), k) };
}

// ---------- shared ----------
function Panel({ box, title, right, a, children }) {
  const { x, y, w, h, k } = box;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w / k, height: h / k, boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '16px 22px', opacity: a, transform: `translateY(${(1 - a) * 18}px) scale(${k})`, transformOrigin: '0 0', overflow: 'hidden' }}>
      {title && (
        // the same heading size in every panel, whatever its magnification k
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, font: `600 ${L.title / k}px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.dim, marginBottom: 12 / k }}>
          <span style={{ flex: 'none' }}>{title}</span><span style={{ minWidth: 0, flex: 1, textAlign: 'right', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{right}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// Optional text at the bottom of a Panel: hidden unless it fits whole above the panel's bottom padding
function FitOrHide({ style, children }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current, panel = el && el.offsetParent;
    if (!panel) return;
    const fits = el.offsetTop + el.offsetHeight <= panel.clientHeight - parseFloat(getComputedStyle(panel).paddingBottom);
    el.style.visibility = fits ? '' : 'hidden';
  });
  return <span ref={ref} style={style}>{children}</span>;
}

// ---------- board ----------
function Piece({ p, T, S }) {
  let [x, y] = sqXY(p.home), lift = 0;
  for (const mv of p.track) {
    const t0 = S.tp[mv.ply];
    if (T < t0) break;
    const k = cl01((T - t0) / S.md[mv.ply]);
    const a = sqXY(mv.from), b = sqXY(mv.to), e = MOTION.move(k);
    x = lerp(a[0], b[0], e); y = lerp(a[1], b[1], e); lift = Math.sin(Math.PI * k);
  }
  let o = 1, sc = 1;
  if (p.captured >= 0) {
    const k = cl01((T - S.tp[p.captured] - S.md[p.captured] * 0.6) / 0.2);
    o = 1 - k; sc = 1 - 0.35 * MOTION.enter(k);
  }
  if (o <= 0) return null;
  const type = p.promo && T >= S.tp[p.promo.ply] + S.md[p.promo.ply] ? p.promo.type : p.type;
  return (
    <div style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, opacity: o, zIndex: lift > 0 ? 5 : 2, transform: `translateY(${-lift * 10}px) scale(${sc * (1 + lift * 0.08)})`, filter: `drop-shadow(0 ${2 + lift * 10}px ${2 + lift * 8}px rgba(0,0,0,${0.25 + lift * 0.2}))` }}>
      <img src={img(p.color, type)} alt="" style={{ width: SQ, height: SQ, display: 'block' }} />
    </div>
  );
}

function Arrow({ from, to, color, a, grow }) {
  const [x1, y1] = sqC(from), [x2, y2] = sqC(to);
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
  const L = (d - 16) * grow, head = 34, sw = 8, hw = 22;
  const bx = x1 + ux * (L - head), by = y1 + uy * (L - head), tx = x1 + ux * L, ty = y1 + uy * L;
  const pts = [[x1 + nx * sw, y1 + ny * sw], [bx + nx * sw, by + ny * sw], [bx + nx * hw, by + ny * hw], [tx, ty], [bx - nx * hw, by - ny * hw], [bx - nx * sw, by - ny * sw], [x1 - nx * sw, y1 - ny * sw]].map((p) => p.join(',')).join(' ');
  return <polygon points={pts} fill={color} opacity={0.85 * a} />;
}

function Board({ M, T, S, a, arrows, pieces, queen, vline, hide }) {
  const c = lastPly(T, S);
  const sq = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 0;
    sq.push(
      <div key={r * 8 + f} style={{ position: 'absolute', left: f * SQ, top: r * SQ, width: SQ, height: SQ, background: light ? C.light : C.dark }}>
        {f === 0 && <span style={{ position: 'absolute', left: 6, top: 4, font: `600 14px ${MONO}`, color: light ? C.dark : C.light }}>{8 - r}</span>}
        {r === 7 && <span style={{ position: 'absolute', right: 6, bottom: 3, font: `600 14px ${MONO}`, color: light ? C.dark : C.light }}>{String.fromCharCode(97 + f)}</span>}
      </div>
    );
  }
  if (vline) return <LineBoard a={a} sq={sq} v={vline} hide={hide} />;
  const over = [];
  let badge = null, best = null;
  if (c >= 0) {
    const P = M.plies[c], marked = !!P.mark;
    const k = cl01((T - S.tp[c]) / 0.2);
    [P.uci.slice(0, 2), P.uci.slice(2, 4)].forEach((s, j) => {
      const [x, y] = sqXY(s);
      over.push(<div key={'h' + j} style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: marked ? boardCls(P.cls) : LAST_MOVE, opacity: (marked ? 0.6 : 1) * k }} />);
    });
    if (P.checkSq) {
      const [x, y] = sqXY(P.checkSq);
      over.push(<div key="chk" style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, opacity: cl01((T - S.tp[c] - S.md[c]) / 0.2), background: `radial-gradient(circle, ${BOARD.blunder} 0%, rgba(228,85,63,0.55) 40%, rgba(228,85,63,0) 72%)` }} />);
    }
    if (marked || P.checkmate) {
      const kb = cl01((T - S.tp[c] - S.md[c]) / 0.35);
      const [x, y] = sqXY(P.checkmate ? P.checkSq : P.uci.slice(2, 4));
      badge = (
        <div style={{ position: 'absolute', left: x * SQ + SQ - 30, top: y * SQ - 12, minWidth: 42, height: 42, padding: '0 7px', boxSizing: 'border-box', borderRadius: 21, background: P.checkmate ? BOARD.blunder : boardCls(P.cls), color: '#15100d', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 20px ${MONO}`, zIndex: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.45)', transform: `scale(${MOTION.pop(kb)})`, opacity: kb > 0 ? 1 : 0 }}>{P.checkmate ? '#' : P.mark}</div>
      );
    }
    if (arrows && P.best && ['inaccuracy', 'mistake', 'blunder'].includes(P.cls)) {
      const tA = S.tp[c] + S.md[c] + 0.45, tE = c + 1 < S.N ? S.tp[c + 1] - 0.1 : Infinity;
      const al = cl01((T - tA) / 0.25) * (1 - cl01((T - tE) / 0.2));
      if (al > 0) best = <Arrow from={P.best.uci.slice(0, 2)} to={P.best.uci.slice(2, 4)} color={BOARD.best} a={al} grow={MOTION.enter(cl01((T - tA) / 0.45))} />;
    }
  }
  return (
    <div style={{ position: 'absolute', left: BX, top: BY, width: BW, height: BW, borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.28)', opacity: a, transform: `scale(${lerp(0.96, 1, a)})` }}>
      {sq}{over}
      {pieces.map((p) => <Piece key={p.id} p={p} T={T} S={S} />)}
      <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>
        {best}
        {queen && (queen.at === c + 1 || queen.at === c) && queen.best && <Arrow from={queen.best.slice(0, 2)} to={queen.best.slice(2, 4)} color={BOARD.queen} a={1} grow={1} />}
      </svg>
      {badge}
    </div>
  );
}

// ---------- exploring a best line on the board ----------
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w';
const LINE_CACHE = new Map();
function playLineCached(M, c, moves) {
  const fen = c === 0 ? START_FEN : M.plies[c - 1].fen, castle = c === 0 ? 'KQkq' : M.plies[c - 1].castle, key = fen + ' ' + castle + '|' + moves.join(' ');
  if (!LINE_CACHE.has(key)) LINE_CACHE.set(key, window.ChessCore.playLine(fen, moves, castle));
  return LINE_CACHE.get(key);
}
const lineLabel = (c, j, san) => { const ply = c + j; return `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'} ${san}`; };

// What a search actually did: "Stockfish 19 lite · depth 22 (23 unfinished) · 3.0 s · 1.5M nodes" (the eval is from depth 22)
const engineLabel = (name) => (name || 'Stockfish').replace(/\s*\(browser\)$/, '');
const fmtNodes = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)) + ' nodes';
// the portrait frame (no header panel) has room for the numbers only
function searchStats(name, s) {
  if (!s || !s.depth) return engineLabel(name);
  return [L.header ? engineLabel(name) : '', 'depth ' + s.depth + (s.maxDepth > s.depth ? ` (${s.maxDepth} unfinished)` : ''), s.timeMs != null ? (s.timeMs / 1000).toFixed(1) + ' s' : '', s.nodes != null ? fmtNodes(s.nodes) : ''].filter(Boolean).join(' · ');
}
const lineAccent = (src) => (src === 'queen' ? C.queen : src === 'you' ? C.last : C.best);
function LineBoard({ a, sq, v, hide }) {
  // the ring around the board says whose line it is; its last move gets the same tint as the game's
  const step = v.upto >= 0 ? v.moves[v.upto] : null, accent = v.src === 'queen' ? BOARD.queen : v.src === 'you' ? BOARD.last : BOARD.best;
  const board = step ? step.board : v.base.b;
  const over = !step ? [] : [step.uci.slice(0, 2), step.uci.slice(2, 4)].map((s, j) => {
    const [x, y] = sqXY(s);
    return <div key={'h' + j} style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: LAST_MOVE }} />;
  });
  if (step && step.checkSq) {
    const [x, y] = sqXY(step.checkSq);
    over.push(<div key="chk" style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: `radial-gradient(circle, ${BOARD.blunder} 0%, rgba(228,85,63,0.55) 40%, rgba(228,85,63,0) 72%)` }} />);
  }
  const pieces = board.map((p, i) => (p && i !== hide ? (
    <div key={i} style={{ position: 'absolute', left: (i % 8) * SQ, top: Math.floor(i / 8) * SQ, width: SQ, height: SQ, zIndex: 2, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.25))' }}>
      <img src={img(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())} alt="" style={{ width: SQ, height: SQ, display: 'block' }} />
    </div>
  ) : null));
  return (
    // drawing only: taps and drags go to BoardTouch (without this its pieces sit above it and swallow them)
    <div style={{ position: 'absolute', left: BX, top: BY, width: BW, height: BW, borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 0 4px ${accent}, 0 4px 12px rgba(0,0,0,0.28)`, opacity: a, pointerEvents: 'none' }}>
      {sq}{over}{pieces}
    </div>
  );
}

function BoardTouch({ pos, sel, targets, drag, onDown, onMove, onUp, onCancel }) {
  const dragged = drag && drag.moved ? pos.b[drag.from] : null;
  return (
    <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      title="Drag a piece to try your own move"
      style={{ position: 'absolute', left: BX, top: BY, width: BW, height: BW, cursor: drag && drag.moved ? 'grabbing' : 'grab', touchAction: 'none' }}>
      {sel != null && <div style={{ position: 'absolute', left: (sel % 8) * SQ, top: Math.floor(sel / 8) * SQ, width: SQ, height: SQ, boxSizing: 'border-box', border: `5px solid ${BOARD.last}`, background: 'rgba(255,255,255,0.12)', pointerEvents: 'none' }} />}
      {targets.map((t) => (
        <div key={t} style={{ position: 'absolute', left: (t % 8) * SQ, top: Math.floor(t / 8) * SQ, width: SQ, height: SQ, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {pos.b[t]
            ? <div style={{ width: SQ - 8, height: SQ - 8, borderRadius: '50%', border: '6px solid rgba(21,16,13,0.35)', boxSizing: 'border-box' }} />
            : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(21,16,13,0.32)' }} />}
        </div>
      ))}
      {dragged && (
        <img src={img(dragged === dragged.toUpperCase() ? 'w' : 'b', dragged.toLowerCase())} alt=""
          style={{ position: 'absolute', left: drag.x - SQ * 0.55, top: drag.y - SQ * 0.55, width: SQ * 1.1, height: SQ * 1.1, pointerEvents: 'none', filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.45))', zIndex: 3 }} />
      )}
    </div>
  );
}

// Move chips for a line; legal moves can be clicked to show the line on the board up to that move
function LineChips({ name, nameColor, accent, moves, c, legal, sel, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6 }}>
      <span style={{ color: nameColor, marginRight: 8 }}>{name}</span>
      {moves.map((m, j) => {
        const ply = c + j, white = ply % 2 === 0, num = Math.floor(ply / 2) + 1, ok = j < legal, on = sel === j;
        return (
          <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {(white || j === 0) && <span style={{ color: C.dim, marginLeft: j ? 6 : 0, font: `500 15px ${MONO}` }}>{num}{white ? '.' : '…'}</span>}
            <span className={ok ? 'mv' : undefined} role={ok ? 'button' : undefined} title={ok ? `Show ${name.toLowerCase()} on the board up to ${m}` : 'Not a legal move in this line'}
              onClick={ok ? (e) => { e.stopPropagation(); onPick(j); } : undefined}
              style={{ cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.4, padding: '2px 8px', borderRadius: 4, font: `${j === 0 || on ? 700 : 600} 16px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', boxShadow: on ? `0 0 0 3px ${C.last}` : 'none', border: j === 0 ? `2px solid ${accent}` : `1px solid ${white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m}</span>
          </span>
        );
      })}
    </div>
  );
}

function EvalBar({ M, T, S, a }) {
  const { c, cp } = evalNow(M, T, S);
  const f = M.hasEval ? (winChance(cp) + 1) / 2 : 0.5;
  const shown = c >= 0 ? M.plies[c] : null;
  const txt = !M.hasEval ? '' : shown && shown.checkmate && T > S.tp[c] + 1 ? fmtEval(shown) : shown && shown.mate != null ? fmtEval(shown) : fmtEval({ cp });
  const top = cp < 0;
  return (
    <div style={{ position: 'absolute', left: L.eval, top: BY, width: 36, height: BW, borderRadius: 4, overflow: 'hidden', background: '#2a2320', boxShadow: `0 0 0 1px ${C.line}`, opacity: a }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: f * BW, background: '#f1ebe1' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: BW / 2 - 1, height: 2, background: C.last, opacity: 0.5 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 8, height: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 18px ${MONO}`, color: top ? '#f1ebe1' : '#2a2320', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{txt}</div>
    </div>
  );
}

function clockOf(M, color, T, S) {
  const c = lastPly(T, S);
  let own = M.clockStart;
  for (let i = 0; i <= c; i++) if (M.plies[i].side === color && M.plies[i].clk != null) own = M.plies[i].clk;
  const n = c + 1;
  if (n < S.N && M.plies[n].side === color) {
    const t0 = c >= 0 ? S.tp[c] + S.md[c] : S.tp[0] - 0.8, t1 = S.tp[n];
    const target = M.plies[n].clk;
    return { s: target != null && target < own ? lerp(own, target, cl01((T - t0) / (t1 - t0))) : own, active: T > t0 - 0.01 };
  }
  return { s: own, active: false };
}

function PlayerBar({ M, T, S, side, a, pieces }) {
  const P = side === 'w' ? M.white : M.black;
  const cap = { w: {}, b: {} };
  pieces.forEach((p) => { if (p.captured >= 0 && T >= S.tp[p.captured] + S.md[p.captured] * 0.6) cap[p.color][p.type] = (cap[p.color][p.type] || 0) + 1; });
  const opp = side === 'w' ? 'b' : 'w';
  const shown = []; let pts = 0;
  ['q', 'r', 'b', 'n', 'p'].forEach((t) => {
    const n = (cap[opp][t] || 0) - (cap[side][t] || 0);
    pts += n * VALUE[t];
    // black pieces get a light rim so they read on the dark frame
    for (let i = 0; i < n; i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: 30, height: 30, marginRight: -8, filter: opp === 'b' ? C.rim : 'none' }} />);
  });
  const clk = M.hasClock ? clockOf(M, side, T, S) : null;
  const low = clk && clk.s < 60;
  return (
    <div style={{ position: 'absolute', left: BX, width: BW / L.bar.k, top: side === 'w' ? BY + BW + L.bar.gap : BY - L.bar.gap - 40 * L.bar.k, height: 40, transform: `scale(${L.bar.k})`, transformOrigin: '0 0', display: 'flex', alignItems: 'center', gap: 14, opacity: a }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ font: `600 20px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{P.name}</span>
      <span style={{ font: `500 16px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{[P.title, P.elo].filter(Boolean).join(' ')}</span>
      <span style={{ display: 'flex', alignItems: 'center', marginLeft: 6 }}>{shown}</span>
      {pts > 0 && <span style={{ font: `600 16px ${MONO}`, color: C.dim, marginLeft: 8 }}>+{pts}</span>}
      {clk && <span style={{ marginLeft: 'auto', minWidth: 96, textAlign: 'center', padding: '2px 10px', borderRadius: 5, font: `600 22px ${MONO}`, background: clk.active ? (low ? C.blunder : '#f1ebe1') : C.off, color: clk.active ? '#15100d' : C.dim, boxShadow: clk.active ? `0 0 0 1px ${C.line}` : 'none' }}>{fmtClock(clk.s)}</span>}
    </div>
  );
}

// ---------- right column ----------
function Header({ M, a }) {
  const person = (P, side, align) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, alignItems: align }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, maxWidth: '100%' }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
        <span style={{ font: `400 40px ${SERIF}`, color: C.ink, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
      </div>
      <span style={{ font: `500 15px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{[[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ')}</span>
    </div>
  );
  return (
    <Panel box={L.header} a={a}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        {person(M.white, 'w', 'flex-start')}
        <span style={{ font: `500 16px ${MONO}`, color: C.dim, paddingTop: 12 }}>vs</span>
        {person(M.black, 'b', 'flex-end')}
      </div>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: 'flex', gap: 18, font: `500 15px ${MONO}`, color: C.dim, alignItems: 'center', whiteSpace: 'nowrap', minWidth: 0 }}>
        <span style={{ color: C.ink }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <span>{[M.site, M.date].filter(Boolean).join(' · ')}</span>
        {M.eco && <span style={{ marginLeft: 'auto', padding: '2px 8px', border: `1px solid ${C.line}`, borderRadius: 4, color: C.ink }}>{M.eco}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{M.opening}</span>
      </div>
    </Panel>
  );
}

function MoveList({ M, T, S, a, paused, onPick }) {
  const c = lastPly(T, S);
  const ROW = 38, VIS = L.moves.rows;
  const scrollFor = (i) => Math.max(0, Math.floor(Math.max(i, 0) / 2) - (VIS - 3)) * ROW;
  const k = c >= 0 ? MOTION.move(cl01((T - S.tp[c]) / 0.35)) : 1;
  const scroll = lerp(scrollFor(c - 1), scrollFor(c), k);
  const rows = [];
  for (let r = 0; r < Math.ceil(S.N / 2); r++) {
    const cell = (i) => {
      if (i >= S.N) return <span />;
      const P = M.plies[i], cur = i === c;
      const shown = cl01((T - S.tp[i]) / 0.15);
      return (
        <span className="mv" role="button" title={`Go to ${label(M, i)}`} onClick={(e) => { e.stopPropagation(); onPick(i); }}
          style={{ opacity: paused ? Math.max(shown, 0.35) : shown, padding: '3px 8px', borderRadius: 4, justifySelf: 'start', cursor: 'pointer', background: cur ? 'rgba(227,181,91,0.18)' : 'transparent', color: P.cls === 'none' ? C.ink : clsColor(P.cls), fontWeight: cur ? 700 : 500 }}>{P.san}{P.mark || ''}</span>
      );
    };
    rows.push(
      <div key={r} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr', height: ROW, alignItems: 'center', opacity: T >= S.tp[2 * r] || paused ? 1 : 0 }}>
        <span style={{ color: C.dim }}>{r + 1}.</span>{cell(2 * r)}{cell(2 * r + 1)}
      </div>
    );
  }
  return (
    <Panel box={L.moves} a={a} title="Moves">
      <div style={{ position: 'relative', height: VIS * ROW, overflow: 'hidden', font: `500 19px ${MONO}` }}>
        <div style={{ transform: `translateY(${-scroll}px)` }}>{rows}</div>
      </div>
    </Panel>
  );
}

function Commentary({ M, T, S, a, book, line }) {
  const c = lastPly(T, S);
  // the book name of this position while the game is in book (before the book loads: the game's opening, early on)
  const bookAt = line ? line.book : c < 0 ? null : book ? book[c] : c < 12 && M.opening ? { eco: M.eco, name: M.opening } : null;
  const txt = (c >= 0 ? M.plies[c].comment : M.intro) || '';
  const qtxt = (c >= 0 && M.plies[c].queenText) || '';
  const t0 = c >= 0 ? S.tp[c] + S.md[c] + 0.1 : S.tp[0] - 1.5;
  // one typewriter across the comment, then Queen's sentence
  const total = txt.length + qtxt.length;
  const avail = (c + 1 < S.N ? S.tp[c + 1] : t0 + 8) - t0;
  const n = total ? Math.floor(cl01((T - t0) / Math.max(0.4, Math.min(total / 60, avail * 0.45))) * total) : 0;
  const nh = Math.min(n, txt.length), nq = Math.max(0, n - txt.length);
  const size = Math.round((qtxt ? (txt.length > 90 ? 30 : 36) : txt.length > 140 ? 34 : 44) * L.comment.text);
  const qsize = qtxt.length > 200 ? 22 : 26;
  return (
    <Panel box={L.comment} a={a} title="Commentary" right={bookAt ? `${bookAt.eco} ${bookAt.name}` : null}>
      {total ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: L.comment.gap }}>
          {/* the Analysis panel names the move, unless the game has no analysis */}
          {c >= 0 && !M.hasEval && !M.plies.some((p) => p.best) && <span style={{ font: `600 18px ${MONO}`, color: M.plies[c].mark ? clsColor(M.plies[c].cls) : C.last }}>{label(M, c)}</span>}
          {txt && <span style={{ font: `400 ${size}px/1.14 ${SERIF}`, color: C.ink, textWrap: 'pretty' }}>{txt.slice(0, nh)}<span style={{ opacity: 0 }}>{txt.slice(nh)}</span></span>}
          {qtxt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: nq > 0 || !txt ? 1 : 0 }}>
              <span style={{ font: `600 13px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.queen }}>Queen · after {M.plies[c].san}{M.plies[c].mark || ''}</span>
              <span style={{ font: `italic 400 ${qsize}px/1.2 ${SERIF}`, color: C.ink, textWrap: 'pretty', paddingLeft: 12, borderLeft: `2px solid ${C.queen}` }}>{qtxt.slice(0, nq)}<span style={{ opacity: 0 }}>{qtxt.slice(nq)}</span></span>
            </div>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function Analysis({ M, T, S, a, vline, onLine, paused, sf, own, onReply }) {
  const c = lastPly(T, S);
  // this move's own search when the analysis recorded it, else the engine settings
  const right = c >= 0 && M.plies[c].search ? searchStats(M.engineName, M.plies[c].search) : M.engine;
  if (own && vline && vline.src === 'you' && vline.upto >= 0) {
    return (
      <Panel box={L.analysis} a={a} title="Analysis" right={sf && (sf.status === 'unavailable' || sf.status === 'stopped') ? null : searchStats(window.AnalysisCore.ENGINE.name, own.after)}>
        <OwnMoveAnalysis vline={vline} own={own} status={sf ? sf.status : 'idle'} onReply={onReply} />
        <span style={{ display: 'block', marginTop: 8, font: `500 15px ${MONO}`, color: C.dim }}>
          <span style={{ color: lineAccent('you') }}>Your moves: {vline.moves.slice(0, vline.upto + 1).map((m, j) => (j === 0 || (vline.at + j) % 2 === 0 ? lineLabel(vline.at, j, m.san) : m.san)).join(' ')}</span> · ← → step · Esc returns to the game
        </span>
      </Panel>
    );
  }
  if (!M.hasEval && !M.plies.some((p) => p.best)) {
    return <Panel box={L.analysis} a={a} title="Analysis" right={right}>{sf ? <EngineEmptyState sf={sf} paused={paused} /> : <span style={{ font: `400 26px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis loaded.</span>}</Panel>;
  }
  if (c < 0) return (
    <Panel box={L.analysis} a={a} title="Analysis" right={right}>
      {paused && <span style={{ font: `500 17px ${MONO}`, color: C.dim }}>Press play to watch the game, or drag a piece to try your own move.</span>}
      {sf && !M.hasEval && (sf.run.state === 'running' || paused) && <div style={{ marginTop: 16 }}><EngineEmptyState sf={sf} paused={paused} compact /></div>}
    </Panel>
  );
  const P = M.plies[c], cls = P.cls;
  const k = cl01((T - S.tp[c] - S.md[c]) / 0.25);
  const { cp } = evalNow(M, T, S);
  const col = cls === 'none' ? C.ink : clsColor(cls);
  // Queen: its score after this move, the change from its score before it (mover's side), and its line from before it
  const Qp = P.queen || {};
  const qa = Qp.after ? { v: queenEval(Qp.after.evalText) } : null;
  const qb = Qp.before ? queenEval(Qp.before.evalText) : null;
  const qd = qa && qa.v != null && qb != null ? (qa.v - qb) * (P.side === 'w' ? 1 : -1) : null;
  // P.best: the engine preferred another move (a mistake, or an equally good move rated best with 0 cp lost)
  const sfLegal = P.best ? playLineCached(M, c, P.best.line.slice(0, 8)) : [];
  const agreeLegal = cls === 'best' && P.line && P.line.length ? playLineCached(M, c, P.line.slice(0, 8)) : [];
  // name the engine (the analysis may come from another one), and say where Queen stands once it has looked
  const engName = (M.engine || '').split(' · ')[0] || 'The engine';
  const qPick = Qp.before && Qp.before.best ? Qp.before : null;
  const agreeText = `${engName} agrees with the move played.` + (qPick ? (qPick.best === P.uci ? ' So does Queen.' : ` Queen preferred ${qPick.bestSan || qPick.best}.`) : '');
  const qLine = Qp.before && Qp.before.line ? Qp.before.line.split(/\s+/).filter((x) => x && !/^\d+\.+$/.test(x) && !/^\d+\.\.\.$/.test(x)).map((x) => x.replace(/^\d+\.+/, '')).filter(Boolean).slice(0, 6) : [];
  const qLegal = qLine.length ? playLineCached(M, c, qLine) : [];
  return (
    <Panel box={L.analysis} a={a} title="Analysis" right={right}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, opacity: k, transform: `translateY(${(1 - k) * 8}px)` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 38px ${MONO}`, color: col }}>{label(M, c)}</span>
          <span style={{ font: `600 16px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{P.checkmate ? 'Checkmate' : CLASS_LABEL[cls]}{P.loss > 0 ? ` · −${P.loss} cp` : ''}{cls === 'best' && P.best && P.best.line[0] ? ` · as good as ${P.best.line[0]}` : ''}</span>
        </div>
        {qa && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ font: `600 13px ${MONO}`, color: C.queen, letterSpacing: '0.12em' }}>QUEEN{qd != null ? ` · ${qd > 0.004 ? '+' : qd < -0.004 ? '−' : ''}${Math.abs(qd).toFixed(2)} FOR ${P.side === 'w' ? 'WHITE' : 'BLACK'}` : ''}</span>
            <span style={{ font: `700 38px ${MONO}`, color: C.queen }}>{qa.v == null ? 'n/a' : fmtQ(qa.v)}</span>
          </div>
        )}
        {M.hasEval && (
          <div style={{ marginLeft: qa ? 36 : 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ font: `600 13px ${MONO}`, color: C.dim, letterSpacing: '0.12em' }}>{qa ? 'STOCKFISH' : 'EVAL'}</span>
            <span style={{ font: `700 38px ${MONO}`, color: C.ink }}>{P.mate != null && k >= 1 ? fmtEval(P) : fmtEval({ cp })}</span>
          </div>
        )}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, font: `500 18px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: 8, opacity: k }}>
        {P.best && P.best.line.length ? (
          <LineChips name="Best line" nameColor={C.ink} accent={C.best} moves={P.best.line.slice(0, 8)} c={c} legal={sfLegal.length}
            sel={vline && vline.src === 'sf' ? vline.upto : null} onPick={(j) => onLine('sf', sfLegal, j)} />
        ) : cls === 'best' && agreeLegal.length ? (
          <LineChips name="Best line" nameColor={C.ink} accent={C.best} moves={P.line.slice(0, 8)} c={c} legal={agreeLegal.length}
            sel={vline && vline.src === 'sf' ? vline.upto : null} onPick={(j) => onLine('sf', agreeLegal, j)} />
        ) : cls === 'best' ? <span>{agreeText}</span> : <span />}
        {qLine.length > 0 && (
          <LineChips name="Queen line" nameColor={C.queen} accent={C.queen} moves={qLine} c={c} legal={qLegal.length}
            sel={vline && vline.src === 'queen' ? vline.upto : null} onPick={(j) => onLine('queen', qLegal, j)} />
        )}
        {P.advice && <span style={{ color: C.inaccuracy }}>{P.advice}</span>}
        {vline && (
          <span style={{ font: `500 15px ${MONO}`, color: C.dim }}>
            <span style={{ color: lineAccent(vline.src) }}>
              {vline.src === 'you'
                ? (vline.upto < 0 ? 'Your moves: drag a piece to play' : `Your moves: ${vline.moves.slice(0, vline.upto + 1).map((m, j) => (j === 0 || (vline.at + j) % 2 === 0 ? lineLabel(vline.at, j, m.san) : m.san)).join(' ')}`)
                : `On the board: ${vline.src === 'queen' ? 'Queen line' : 'best line'} to ${lineLabel(vline.at, vline.upto, vline.moves[vline.upto].san)} · drag a piece to branch off`}
            </span> · ← → step · Esc returns to the game
          </span>
        )}
        {sf && !M.hasEval && (sf.run.state === 'running' || paused) && <EngineEmptyState sf={sf} paused={paused} compact />}
        {!vline && paused && M.hasEval && <FitOrHide style={{ font: `500 15px ${MONO}`, color: C.dim }}>Tip: drag a piece on the board to try your own move.</FitOrHide>}
      </div>
    </Panel>
  );
}

function EvalPlot({ M, T, S, a, paused, onPick }) {
  const { c, k } = evalNow(M, T, S);
  const PLOT = L.plot, W = PLOT.w / PLOT.k - 40, H = PLOT.h / PLOT.k - 30, mid = H / 2, N = S.N;
  const [hover, setHover] = React.useState(null);
  const down = React.useRef(false), fade = React.useRef(null);
  React.useEffect(() => () => clearTimeout(fade.current), []);
  // nearest move to the pointer: ply j sits at x = px(j + 1); -1 is the starting position
  const plyAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(-1, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * N) - 1)); };
  const full = M.hasEval && paused ? 'M' + [[0, py0()], ...M.plies.map((p, j) => [(j + 1) / N * W, py0(cpOf(M, j))])].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L') : null;
  function py0(cp = M.evalStart) { return mid - winChance(cp) * mid * 0.92; }
  const px = (j) => (j / N) * W, py = (cp) => mid - winChance(cp) * mid * 0.92;
  const pts = [[px(0), py(M.evalStart)]];
  for (let j = 0; j <= c; j++) {
    const x = px(j + 1), y = py(cpOf(M, j));
    if (j === c) { const [lx, ly] = pts[pts.length - 1]; pts.push([lerp(lx, x, k), lerp(ly, y, k)]); } else pts.push([x, y]);
  }
  const line = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L');
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)},${mid} L0,${mid} Z`;
  const step = N > 120 ? 20 : 10, ticks = [];
  for (let m = step; m * 2 <= N; m += step) ticks.push(m);
  return (
    <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, width: PLOT.w / PLOT.k, height: PLOT.h / PLOT.k, transform: `scale(${PLOT.k})`, transformOrigin: '0 0', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 20px', opacity: a }}>
      <svg width={W} height={H + 14} style={{ display: 'block', overflow: 'visible', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {} down.current = true; clearTimeout(fade.current); setHover(plyAt(e)); }}
        onPointerMove={(e) => { if (down.current || e.pointerType === 'mouse') setHover(plyAt(e)); }}
        onPointerUp={(e) => {
          if (!down.current) return;
          down.current = false; onPick(plyAt(e));
          if (e.pointerType !== 'mouse') fade.current = setTimeout(() => setHover(null), 1200); // let a finger see where it landed
        }}
        onPointerCancel={() => { down.current = false; setHover(null); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !down.current) setHover(null); }}>
        <title>Click to jump to a move</title>
        <rect x="0" y="0" width={W} height={H} fill="transparent" />
        <defs>
          <clipPath id="cp-up"><rect x="0" y="-10" width={W} height={mid + 10} /></clipPath>
          <clipPath id="cp-dn"><rect x="0" y={mid} width={W} height={mid + 10} /></clipPath>
        </defs>
        <line x1="0" x2={W} y1={mid} y2={mid} stroke={C.line} strokeWidth="2" />
        {ticks.map((m) => (
          <g key={m}>
            <line x1={px(m * 2 - 2)} x2={px(m * 2 - 2)} y1="0" y2={H} stroke={C.line} strokeWidth="1" />
            <text x={px(m * 2 - 2) + 6} y={H + 12} fill={C.dim} style={{ font: `500 12px ${MONO}` }}>{m}</text>
          </g>
        ))}
        {M.hasEval ? (
          <g>
            {full && <path d={full} fill="none" stroke={C.dim} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.6" />}
            <path d={area} fill={C.best} opacity="0.16" clipPath="url(#cp-up)" />
            <path d={area} fill={C.blunder} opacity="0.16" clipPath="url(#cp-dn)" />
            <path d={line} fill="none" stroke={C.best} strokeWidth="2.5" clipPath="url(#cp-up)" />
            <path d={line} fill="none" stroke={C.blunder} strokeWidth="2.5" clipPath="url(#cp-dn)" />
            {M.plies.map((p, j) => (p.mark && (j < c || (j === c && k > 0.95)) ? <circle key={j} cx={px(j + 1)} cy={py(cpOf(M, j))} r="5" fill={clsColor(p.cls)} /> : null))}
            <circle cx={last[0]} cy={last[1]} r="6" fill={C.ink} />
          </g>
        ) : (
          <text x={W / 2} y={mid + 5} textAnchor="middle" fill={C.dim} style={{ font: `500 14px ${MONO}` }}>No evaluation data</text>
        )}
        {hover != null && (() => {
          const x = px(hover + 1), name = hover < 0 ? 'Start' : label(M, hover), w = name.length * 9 + 16;
          const bx = Math.min(Math.max(x - w / 2, 0), W - w);
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={x} x2={x} y1="0" y2={H} stroke={C.last} strokeWidth="2" opacity="0.8" />
              <rect x={bx} y={-6} width={w} height={22} rx="4" fill={C.bg} stroke={C.last} strokeWidth="1" />
              <text x={bx + w / 2} y={10} textAnchor="middle" fill={C.ink} style={{ font: `600 14px ${MONO}` }}>{name}</text>
            </g>
          );
        })()}
        <text x="4" y="12" fill={C.dim} style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em' }}>WHITE</text>
        <text x="4" y={H - 4} fill={C.dim} style={{ font: `600 11px ${MONO}`, letterSpacing: '0.1em' }}>BLACK</text>
      </svg>
    </div>
  );
}

// ---------- title & end cards ----------
function TitleCard({ M, T, CUES }) {
  const out = 1 - cl01((T - (CUES.Opening - 0.7)) / 0.6);
  if (out <= 0) return null;
  const st = (d) => { const k = MOTION.enter(cl01((T - d) / 0.8)); return { opacity: k, transform: `translateY(${(1 - k) * 22}px)` }; };
  const len = M.white.short.length + M.black.short.length;
  // side by side in the wide frame; one name per line in the portrait one
  const size = L.card.stack ? Math.min(120, Math.floor(1300 / Math.max(M.white.short.length, M.black.short.length, 6))) : Math.min(130, Math.floor(1560 / (len * 0.5 + 3)));
  const sub = (P) => [[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ');
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, opacity: out, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, transform: `scale(${(1 + T * 0.006) * L.card.k})`, maxWidth: L.card.w, textAlign: 'center' }}>
        <span style={{ ...st(0.3), font: `600 20px ${MONO}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.last }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <div style={{ display: 'flex', flexDirection: L.card.stack ? 'column' : 'row', alignItems: L.card.stack ? 'center' : 'baseline', gap: L.card.stack ? 12 : 40 }}>
          <span style={{ ...st(0.6), font: `400 ${size}px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{M.white.short}</span>
          <span style={{ ...st(0.9), font: `400 ${Math.round(size * 0.42)}px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>vs</span>
          <span style={{ ...st(1.1), font: `400 ${size}px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{M.black.short}</span>
        </div>
        {(sub(M.white) || sub(M.black)) && <span style={{ ...st(1.6), font: `500 22px ${MONO}`, color: C.dim }}>{sub(M.white)}   —   {sub(M.black)}</span>}
        {M.opening && <span style={{ ...st(2.1), font: `500 22px ${MONO}`, color: C.ink }}>{[M.eco, M.opening].filter(Boolean).join(' · ')}</span>}
        <span style={{ ...st(2.4), font: `500 18px ${MONO}`, color: C.dim }}>{[M.site, M.date].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  );
}

function EndCard({ M, T, CUES }) {
  const k = MOTION.enter(cl01((T - (CUES.Outro + 0.2)) / 0.7));
  if (k <= 0) return null;
  const st = (d) => { const e = MOTION.enter(cl01((T - CUES.Outro - d) / 0.7)); return { opacity: e, transform: `translateY(${(1 - e) * 20}px)` }; };
  const res = M.result.replace('1/2-1/2', '½–½').replace('-', '–');
  const verdict = M.result === '1-0' ? `${M.white.short} wins` : M.result === '0-1' ? `${M.black.short} wins` : M.result === '1/2-1/2' ? 'Draw' : '';
  const hasAcc = typeof M.white.acc === 'number' && typeof M.black.acc === 'number';
  const bar = (P, d) => {
    const g = MOTION.move(cl01((T - CUES.Outro - d) / 1.2));
    return (
      <div style={{ ...st(d), display: 'grid', gridTemplateColumns: L.card.stack ? '190px 300px 100px' : '320px 520px 110px', alignItems: 'center', gap: 24 }}>
        <span style={{ font: `500 24px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
        <div style={{ height: 12, borderRadius: 6, background: C.off, overflow: 'hidden' }}><div style={{ width: `${P.acc * g}%`, height: '100%', background: C.best }} /></div>
        <span style={{ font: `700 24px ${MONO}`, color: C.ink, textAlign: 'right' }}>{(P.acc * g).toFixed(1)}%</span>
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: `rgba(${C.scrim},${0.86 * k})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
     <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, flex: 'none', transform: `scale(${L.card.k})` }}>
      <span style={{ ...st(0.3), font: `400 170px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{res}</span>
      {verdict && <span style={{ ...st(0.6), font: `400 44px ${SERIF}`, color: C.ink }}>{verdict}</span>}
      {M.conclusion && <span style={{ ...st(0.8), font: `400 30px ${SERIF}`, color: C.dim, fontStyle: 'italic', maxWidth: Math.min(1100, L.card.w), textAlign: 'center' }}>{M.conclusion}</span>}
      {hasAcc && <span style={{ ...st(0.9), font: `600 15px ${MONO}`, letterSpacing: '0.14em', color: C.dim, marginTop: 16 }}>ACCURACY</span>}
      {hasAcc && bar(M.white, 1.0)}
      {hasAcc && bar(M.black, 1.2)}
      {M.engine && <span style={{ ...st(1.8), font: `500 17px ${MONO}`, color: C.dim, marginTop: 20 }}>{M.engine}</span>}
     </div>
    </div>
  );
}

// ---------- composition ----------
function GameVideo({ M, tw, d, probe, queen, nav, scheme, sf }) {
  const { T, CUES, authoredTotal, playing } = useComposition();
  setLayout(useFrame()); // before the children render, which read the layout
  const S = useSchedule(M, CUES, d);
  // When the schedule changes (a Queen answer lengthens a move's hold), keep the board on the same move
  const tl = useTimeline();
  const prevS = React.useRef(S);
  React.useEffect(() => {
    const p = prevS.current; prevS.current = S;
    if (p === S || !tl.setTime) return;
    const c = lastPly(T, p);
    if (c < 0 || c >= S.N) return;
    const next = c + 1 < S.N ? S.tp[c + 1] - 0.05 : Infinity;
    const t = Math.min(S.tp[c] + (T - p.tp[c]), next);
    if (Math.abs(t - T) > 0.01) tl.setTime(t);
  }, [S]);
  const [vline, setVline] = React.useState(null); // { c, src, moves, upto } while a line is shown on the board
  const cNow = lastPly(T, S);
  React.useEffect(() => { if (vline && (playing || cNow !== vline.c)) setVline(null); }, [playing, cNow]);
  const onLine = (src, moves, j) => { if (j < moves.length) { tl.setPlaying(false); setSel(null); setVline({ c: cNow, at: cNow, src, moves, upto: j }); } };
  // a line steps back to its first move (the viewer's own line back to its starting position), then closes
  const stepLine = (d) => setVline((v) => {
    if (!v) return v;
    const u = v.upto + d, min = v.src === 'you' ? -1 : 0;
    return u < min ? null : { ...v, upto: Math.min(v.moves.length - 1, u) };
  });
  // ---- moves the viewer plays on the board ----
  const [sel, setSel] = React.useState(null); // selected square (0 = a8)
  const [drag, setDrag] = React.useState(null); // { from, x, y, x0, y0, moved } in board pixels
  React.useEffect(() => { if (!vline) { setSel(null); setDrag(null); } }, [vline]);
  const gamePos = (cc) => (cc < 0 ? window.ChessCore.posFromFen(START_FEN) : { ...window.ChessCore.posFromFen(M.plies[cc].fen), castle: M.plies[cc].castle });
  const curPos = () => (vline ? (vline.upto >= 0 ? vline.moves[vline.upto].pos : vline.base) : gamePos(cNow));
  const newLine = () => ({ c: cNow, at: cNow + 1, src: 'you', moves: [], upto: -1, base: gamePos(cNow) });
  const explore = () => { tl.setPlaying(false); if (!vline) setVline(newLine()); };
  const leaveIfEmpty = () => setVline((v) => (v && v.src === 'you' && v.upto < 0 ? null : v));
  const playMove = (from, to) => {
    const step = window.ChessCore.userMove(curPos(), from, to);
    if (!step) return false;
    setVline((v) => { const b = v || newLine(); const prefix = b.moves.slice(0, b.upto + 1); return { ...b, src: 'you', moves: [...prefix, step], upto: prefix.length }; });
    return true;
  };
  const touchPos = curPos();
  // Stockfish on the viewer's line: the positions before and after the move on the board, as move lists from the start
  const ownOn = !!(sf && vline && vline.src === 'you' && vline.upto >= 0);
  const ownBefore = ownOn ? M.plies.slice(0, vline.at).map((p) => p.uci).concat(vline.moves.slice(0, vline.upto).map((m) => m.uci)) : null;
  const ownAfter = ownOn ? ownBefore.concat([vline.moves[vline.upto].uci]) : null;
  const ownEval = useMoveEval(sf ? sf.engine : null, ownBefore, ownAfter);
  let own = null;
  if (ownOn) {
    const posBefore = vline.upto > 0 ? vline.moves[vline.upto - 1].pos : vline.base || gamePos(vline.at - 1);
    const bm = ownEval.before && ownEval.before.best ? window.ChessCore.applyUci(posBefore, ownEval.before.best) : null;
    own = { ...ownEval, bestSan: bm ? bm.san : null };
  }
  const onReply = (steps) => setVline((v) => v && { ...v, moves: [...v.moves.slice(0, v.upto + 1), ...steps], upto: v.upto + steps.length });
  // the book name of the position on the board while a line is shown (it can reach openings the game never played)
  const lineKey = vline && vline.upto >= 0 ? M.plies.slice(0, vline.at).map((p) => p.uci).concat(vline.moves.slice(0, vline.upto + 1).map((m) => m.uci)).join(' ') : null;
  const lineBook = React.useMemo(() => {
    if (!lineKey || !window.Openings) return null;
    try { return window.Openings.book().byPly(lineKey.split(' ')).pop() || null; } catch (e) { return null; }
  }, [lineKey]);
  const targets = sel != null ? window.ChessCore.legalTargets(touchPos, sel) : [];
  const boardXY = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * BW, y = ((e.clientY - r.top) / r.height) * BW;
    return { x, y, sq: Math.max(0, Math.min(7, Math.floor(y / SQ))) * 8 + Math.max(0, Math.min(7, Math.floor(x / SQ))) };
  };
  const touch = {
    onDown: (e) => {
      const p = boardXY(e), pos = curPos();
      if (sel != null && sel !== p.sq && targets.includes(p.sq)) { playMove(sel, p.sq); setSel(null); return; }
      const pc = pos.b[p.sq];
      if (pc && (pc === pc.toUpperCase() ? 'w' : 'b') === pos.turn) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
        explore(); setSel(p.sq); setDrag({ from: p.sq, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false });
      } else { setSel(null); leaveIfEmpty(); }
    },
    onMove: (e) => { if (!drag) return; const p = boardXY(e); setDrag((d) => d && { ...d, x: p.x, y: p.y, moved: d.moved || Math.hypot(p.x - d.x0, p.y - d.y0) > 14 }); },
    onUp: (e) => {
      if (!drag) return;
      const p = boardXY(e), d = drag;
      setDrag(null);
      if (!d.moved) return; // a tap keeps the piece selected; the next tap picks its square
      if (p.sq !== d.from && playMove(d.from, p.sq)) setSel(null); else { setSel(null); leaveIfEmpty(); }
    },
    onCancel: () => setDrag(null),
  };
  const settled = (i) => (i < 0 ? S.tp[0] - 0.3 : i + 1 < S.N ? S.tp[i + 1] - 0.12 : Math.min(S.tp[i] + S.md[i] + 3, CUES.Outro - 0.1));
  const goTo = (i) => { setVline(null); tl.setPlaying(false); tl.setTime(settled(Math.max(-1, Math.min(S.N - 1, i)))); };
  // open on the starting position, paused, with every panel in place
  // (before the first paint, so the title card never flashes)
  React.useLayoutEffect(() => { if (tl.setStart) tl.setStart(settled(-1)); }, []);
  const navRef = React.useRef(null);
  navRef.current = { c: lastPly(T, S), goTo, vline, stepLine, setVline };
  if (nav) {
    const cc = navRef.current.c;
    nav.current = vline ? {
      label: vline.upto < 0 ? 'Your move' : (vline.src === 'you' ? 'You ' : 'Line ') + lineLabel(vline.at, vline.upto, vline.moves[vline.upto].san), color: lineAccent(vline.src),
      hasPrev: true, hasNext: vline.upto < vline.moves.length - 1, prev: () => stepLine(-1), next: () => stepLine(1),
    } : {
      label: cc < 0 ? 'Start' : label(M, cc), color: cc >= 0 && M.plies[cc].mark ? clsColor(M.plies[cc].cls) : C.last,
      hasPrev: cc >= 0, hasNext: cc < S.N - 1, prev: () => goTo(cc - 1), next: () => goTo(cc + 1),
    };
  }
  const navSig = nav && nav.current ? `${nav.current.label}|${nav.current.hasPrev}|${nav.current.hasNext}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const n = navRef.current;
      if (e.code === 'Escape' && n.vline) { e.preventDefault(); n.setVline(null); return; }
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'End') return;
      e.preventDefault(); // claims the key before the stage's own scrub handler
      if (n.vline && e.code !== 'End') { n.stepLine(e.code === 'ArrowRight' ? 1 : -1); return; }
      const { c, goTo: go } = n;
      go(e.code === 'End' ? Infinity : e.code === 'ArrowRight' ? c + 1 : c - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pieces = React.useMemo(() => simulate(M), [M]);
  const enter = (i) => MOTION.enter(cl01((T - (CUES.Opening - 0.5 + i * 0.12)) / 0.7));
  let f = 0;
  if (tw.cameraPush) S.blunders.forEach((i) => {
    const t0 = S.tp[i] - 0.3, t1 = i + 1 < S.N ? S.tp[i + 1] - 0.5 : CUES.Outro;
    f = Math.max(f, MOTION.move(cl01((T - t0) / 0.7)) * (1 - MOTION.move(cl01((T - t1) / 0.7))));
  });
  const c = lastPly(T, S);
  if (probe) probe.current = { S, c };
  const flash = c >= 0 && (M.plies[c].cls === 'blunder' || M.plies[c].checkmate) ? Math.max(0, 1 - Math.abs(T - S.tp[c] - S.md[c] - 0.25) / 0.6) : 0;
  const cx = BX + BW / 2, cy = BY + BW / 2, sc = 1 + 0.1 * f;
  const fade = 1 - cl01((T - (authoredTotal - 0.9)) / 0.8);
  return (
    <div data-screen-label={'t=' + Math.floor(T) + 's'} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${cx}px,${cy}px) scale(${sc}) translate(${-cx}px,${-cy}px)` }}>
          <EvalBar M={M} T={T} S={S} a={enter(1)} />
          <PlayerBar M={M} T={T} S={S} side="b" a={enter(1)} pieces={pieces} />
          <Board M={M} T={T} S={S} a={enter(0)} arrows={tw.bestArrows} pieces={pieces} queen={queen} vline={vline} hide={drag && drag.moved ? drag.from : null} />
          <BoardTouch pos={touchPos} sel={sel} targets={targets} drag={drag} onDown={touch.onDown} onMove={touch.onMove} onUp={touch.onUp} onCancel={touch.onCancel} />
          <PlayerBar M={M} T={T} S={S} side="w" a={enter(1)} pieces={pieces} />
          {L.header && <Header M={M} a={enter(2)} />}
          <MoveList M={M} T={T} S={S} a={enter(3)} paused={!playing} onPick={goTo} />
          <Commentary M={M} T={T} S={S} a={enter(4)} book={sf ? sf.book : null} line={lineKey ? { book: lineBook } : null} />
          <Analysis M={M} T={T} S={S} a={enter(5)} vline={vline} onLine={onLine} paused={!playing} sf={sf} own={own} onReply={onReply} />
          <EvalPlot M={M} T={T} S={S} a={enter(6)} paused={!playing} onPick={goTo} />
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: `inset 0 0 220px rgba(228,85,63,${0.55 * flash})` }} />
        <TitleCard M={M} T={T} CUES={CUES} />
        <EndCard M={M} T={T} CUES={CUES} />
      </div>
    </div>
  );
}
