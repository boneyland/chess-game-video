const MOTION = { enter: Easing.easeOutCubic, move: Easing.easeInOutCubic, pop: Easing.easeOutBack };
const lerp = (a, b, k) => a + (b - a) * k;
const cl01 = (v) => clamp(v, 0, 1);
const { winChance, plyCp } = window.ChessCore;

const C = {
  bg: '#13100f', panel: '#1b1715', line: 'rgba(255,236,214,0.09)', ink: '#efe8de', dim: '#8e8276',
  light: '#f0d9b5', dark: '#b58863', last: '#e3b55b',
  best: '#62c483', inaccuracy: '#e6c14d', mistake: '#ec9442', blunder: '#e4553f', none: '#efe8de',
  good: '#5aa9e6', brilliant: '#3cc7bd', interesting: '#c98be0',
};
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", monospace';
const SERIF = '"Instrument Serif", serif';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CLASS_LABEL = { best: 'Best move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', none: 'Playable', good: 'Good move', brilliant: 'Brilliant', interesting: 'Interesting' };
const clsColor = (cls) => C[cls] || C.ink;

const SQ = 96, BW = SQ * 8, BX = 100, BY = 88;
const RX = 916, RW = 964;
const PLOT = { x: 44, y: 930, w: 1836, h: 120 };

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
    const keys = M.plies.map((p, i) => i).filter((i) => ['blunder', 'mistake', 'brilliant'].includes(M.plies[i].cls) || i === N - 1);
    return { tp, md, N, keys };
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
function Panel({ x, y, w, h, title, right, a, children }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '16px 22px', opacity: a, transform: `translateY(${(1 - a) * 18}px)`, overflow: 'hidden' }}>
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, font: `600 13px ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.dim, marginBottom: 12 }}>
          <span>{title}</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{right}</span>
        </div>
      )}
      {children}
    </div>
  );
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

function Board({ M, T, S, a, arrows, pieces }) {
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
  const over = [];
  let badge = null, best = null;
  if (c >= 0) {
    const P = M.plies[c], marked = !!P.mark;
    const k = cl01((T - S.tp[c]) / 0.2);
    [P.uci.slice(0, 2), P.uci.slice(2, 4)].forEach((s, j) => {
      const [x, y] = sqXY(s);
      over.push(<div key={'h' + j} style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, background: marked ? clsColor(P.cls) : C.last, opacity: (marked ? 0.55 : 0.42) * k, mixBlendMode: 'multiply' }} />);
    });
    if (P.checkSq) {
      const [x, y] = sqXY(P.checkSq);
      over.push(<div key="chk" style={{ position: 'absolute', left: x * SQ, top: y * SQ, width: SQ, height: SQ, opacity: cl01((T - S.tp[c] - S.md[c]) / 0.2), background: `radial-gradient(circle, ${C.blunder} 0%, rgba(228,85,63,0.55) 40%, rgba(228,85,63,0) 72%)` }} />);
    }
    if (marked || P.checkmate) {
      const kb = cl01((T - S.tp[c] - S.md[c]) / 0.35);
      const [x, y] = sqXY(P.checkmate ? P.checkSq : P.uci.slice(2, 4));
      badge = (
        <div style={{ position: 'absolute', left: x * SQ + SQ - 30, top: y * SQ - 12, minWidth: 42, height: 42, padding: '0 7px', boxSizing: 'border-box', borderRadius: 21, background: P.checkmate ? C.blunder : clsColor(P.cls), color: '#15100d', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 20px ${MONO}`, zIndex: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.45)', transform: `scale(${MOTION.pop(kb)})`, opacity: kb > 0 ? 1 : 0 }}>{P.checkmate ? '#' : P.mark}</div>
      );
    }
    if (arrows && P.best && ['inaccuracy', 'mistake', 'blunder'].includes(P.cls)) {
      const tA = S.tp[c] + S.md[c] + 0.45, tE = c + 1 < S.N ? S.tp[c + 1] - 0.1 : Infinity;
      const al = cl01((T - tA) / 0.25) * (1 - cl01((T - tE) / 0.2));
      if (al > 0) best = <Arrow from={P.best.uci.slice(0, 2)} to={P.best.uci.slice(2, 4)} color={C.best} a={al} grow={MOTION.enter(cl01((T - tA) / 0.45))} />;
    }
  }
  return (
    <div style={{ position: 'absolute', left: BX, top: BY, width: BW, height: BW, borderRadius: 4, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', opacity: a, transform: `scale(${lerp(0.96, 1, a)})` }}>
      {sq}{over}
      {pieces.map((p) => <Piece key={p.id} p={p} T={T} S={S} />)}
      <svg width={BW} height={BW} style={{ position: 'absolute', left: 0, top: 0, zIndex: 6, pointerEvents: 'none' }}>{best}</svg>
      {badge}
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
    <div style={{ position: 'absolute', left: 44, top: BY, width: 36, height: BW, borderRadius: 4, overflow: 'hidden', background: '#2a2320', opacity: a }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: f * BW, background: '#f1ebe1' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: BW / 2 - 1, height: 2, background: C.last, opacity: 0.5 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 8, height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 12px ${MONO}`, color: top ? '#f1ebe1' : '#2a2320', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{txt}</div>
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
    for (let i = 0; i < n; i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: 30, height: 30, marginRight: -8 }} />);
  });
  const clk = M.hasClock ? clockOf(M, side, T, S) : null;
  const low = clk && clk.s < 60;
  return (
    <div style={{ position: 'absolute', left: BX, width: BW, top: side === 'w' ? BY + BW + 10 : BY - 50, height: 40, display: 'flex', alignItems: 'center', gap: 14, opacity: a }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ font: `600 20px ${SANS}`, color: C.ink, whiteSpace: 'nowrap' }}>{P.name}</span>
      <span style={{ font: `500 16px ${MONO}`, color: C.dim, whiteSpace: 'nowrap' }}>{[P.title, P.elo].filter(Boolean).join(' ')}</span>
      <span style={{ display: 'flex', alignItems: 'center', marginLeft: 6 }}>{shown}</span>
      {pts > 0 && <span style={{ font: `600 16px ${MONO}`, color: C.dim, marginLeft: 8 }}>+{pts}</span>}
      {clk && <span style={{ marginLeft: 'auto', minWidth: 110, textAlign: 'center', padding: '6px 14px', borderRadius: 5, font: `600 22px ${MONO}`, background: clk.active ? (low ? C.blunder : '#f1ebe1') : '#2a2320', color: clk.active ? '#15100d' : C.dim }}>{fmtClock(clk.s)}</span>}
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
    <Panel x={RX} y={40} w={RW} h={170} a={a}>
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

function MoveList({ M, T, S, a }) {
  const c = lastPly(T, S);
  const ROW = 38, VIS = 8;
  const scrollFor = (i) => Math.max(0, Math.floor(Math.max(i, 0) / 2) - (VIS - 3)) * ROW;
  const k = c >= 0 ? MOTION.move(cl01((T - S.tp[c]) / 0.35)) : 1;
  const scroll = lerp(scrollFor(c - 1), scrollFor(c), k);
  const rows = [];
  for (let r = 0; r < Math.ceil(S.N / 2); r++) {
    const cell = (i) => {
      if (i >= S.N) return <span />;
      const P = M.plies[i], cur = i === c;
      return <span style={{ opacity: cl01((T - S.tp[i]) / 0.15), padding: '3px 8px', borderRadius: 4, justifySelf: 'start', background: cur ? 'rgba(227,181,91,0.18)' : 'transparent', color: P.cls === 'none' ? C.ink : clsColor(P.cls), fontWeight: cur ? 700 : 500 }}>{P.san}{P.mark || ''}</span>;
    };
    rows.push(
      <div key={r} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr', height: ROW, alignItems: 'center', opacity: T >= S.tp[2 * r] ? 1 : 0 }}>
        <span style={{ color: C.dim }}>{r + 1}.</span>{cell(2 * r)}{cell(2 * r + 1)}
      </div>
    );
  }
  return (
    <Panel x={RX} y={228} w={330} h={380} a={a} title="Moves">
      <div style={{ position: 'relative', height: VIS * ROW, overflow: 'hidden', font: `500 19px ${MONO}` }}>
        <div style={{ transform: `translateY(${-scroll}px)` }}>{rows}</div>
      </div>
    </Panel>
  );
}

function Commentary({ M, T, S, a }) {
  const c = lastPly(T, S);
  const txt = c >= 0 ? M.plies[c].comment : M.intro;
  const t0 = c >= 0 ? S.tp[c] + S.md[c] + 0.1 : S.tp[0] - 1.5;
  const n = txt ? Math.floor(cl01((T - t0) / Math.max(0.4, txt.length / 45)) * txt.length) : 0;
  const size = txt && txt.length > 140 ? 34 : 44;
  return (
    <Panel x={RX + 350} y={228} w={RW - 350} h={380} a={a} title="Commentary">
      {txt ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {c >= 0 && <span style={{ font: `600 18px ${MONO}`, color: M.plies[c].mark ? clsColor(M.plies[c].cls) : C.last }}>{label(M, c)}</span>}
          <span style={{ font: `400 ${size}px/1.14 ${SERIF}`, color: C.ink, textWrap: 'pretty' }}>{txt.slice(0, n)}<span style={{ opacity: 0 }}>{txt.slice(n)}</span></span>
        </div>
      ) : null}
    </Panel>
  );
}

function Analysis({ M, T, S, a }) {
  const c = lastPly(T, S);
  const right = M.engine;
  if (!M.hasEval && !M.plies.some((p) => p.best)) {
    return <Panel x={RX} y={626} w={RW} h={278} a={a} title="Analysis" right={right}><span style={{ font: `400 26px ${SERIF}`, color: C.dim, fontStyle: 'italic' }}>No engine analysis loaded. Add a chess-animator analysis file, or a Lichess PGN with evals.</span></Panel>;
  }
  if (c < 0) return <Panel x={RX} y={626} w={RW} h={278} a={a} title="Analysis" right={right} />;
  const P = M.plies[c], cls = P.cls;
  const k = cl01((T - S.tp[c] - S.md[c]) / 0.25);
  const { cp } = evalNow(M, T, S);
  const col = cls === 'none' ? C.ink : clsColor(cls);
  return (
    <Panel x={RX} y={626} w={RW} h={278} a={a} title="Analysis" right={right}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, opacity: k, transform: `translateY(${(1 - k) * 8}px)` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 38px ${MONO}`, color: col }}>{label(M, c)}</span>
          <span style={{ font: `600 16px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: col }}>{P.checkmate ? 'Checkmate' : CLASS_LABEL[cls]}{P.loss > 0 ? ` · −${P.loss} cp` : ''}</span>
        </div>
        {M.hasEval && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ font: `600 13px ${MONO}`, color: C.dim, letterSpacing: '0.12em' }}>EVAL</span>
            <span style={{ font: `700 38px ${MONO}`, color: C.ink }}>{P.mate != null && k >= 1 ? fmtEval(P) : fmtEval({ cp })}</span>
          </div>
        )}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, font: `500 18px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: 8, opacity: k }}>
        {P.best && cls !== 'best' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6 }}>
            <span style={{ color: C.ink, marginRight: 8 }}>Best line</span>
            {P.best.line.map((m, j) => {
              const ply = c + j, white = ply % 2 === 0, num = Math.floor(ply / 2) + 1;
              return (
                <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {(white || j === 0) && <span style={{ color: C.dim, marginLeft: j ? 6 : 0, font: `500 15px ${MONO}` }}>{num}{white ? '.' : '…'}</span>}
                  <span style={{ padding: '2px 8px', borderRadius: 4, font: `${j === 0 ? 700 : 600} 16px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : C.ink, border: j === 0 ? `2px solid ${C.best}` : `1px solid ${white ? '#f1ebe1' : 'rgba(255,236,214,0.22)'}` }}>{m}</span>
                </span>
              );
            })}
          </div>
        ) : c < 12 && M.opening ? (
          <span><span style={{ color: C.ink, marginRight: 14 }}>Opening</span>{M.eco} {M.opening}</span>
        ) : cls === 'best' ? <span>Engine agrees with the move played.</span> : <span />}
        {P.advice && <span style={{ color: C.inaccuracy }}>{P.advice}</span>}
      </div>
    </Panel>
  );
}

function EvalPlot({ M, T, S, a }) {
  const { c, k } = evalNow(M, T, S);
  const W = PLOT.w - 40, H = PLOT.h - 30, mid = H / 2, N = S.N;
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
    <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, width: PLOT.w, height: PLOT.h, boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '10px 20px', opacity: a }}>
      <svg width={W} height={H + 14} style={{ display: 'block', overflow: 'visible' }}>
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
  const size = Math.min(130, Math.floor(1560 / (len * 0.5 + 3)));
  const sub = (P) => [[P.title, P.elo].filter(Boolean).join(' '), P.team].filter(Boolean).join(' · ');
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, opacity: out, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, transform: `scale(${1 + T * 0.006})`, maxWidth: 1700, textAlign: 'center' }}>
        <span style={{ ...st(0.3), font: `600 20px ${MONO}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.last }}>{[M.event, M.round && 'Round ' + M.round].filter(Boolean).join(' · ')}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 40 }}>
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
      <div style={{ ...st(d), display: 'grid', gridTemplateColumns: '320px 520px 110px', alignItems: 'center', gap: 24 }}>
        <span style={{ font: `500 24px ${SANS}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{P.name}</span>
        <div style={{ height: 12, borderRadius: 6, background: '#2a2320', overflow: 'hidden' }}><div style={{ width: `${P.acc * g}%`, height: '100%', background: C.best }} /></div>
        <span style={{ font: `700 24px ${MONO}`, color: C.ink, textAlign: 'right' }}>{(P.acc * g).toFixed(1)}%</span>
      </div>
    );
  };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: `rgba(19,16,15,${0.86 * k})`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30 }}>
      <span style={{ ...st(0.3), font: `400 170px ${SERIF}`, color: C.ink, lineHeight: 1 }}>{res}</span>
      {verdict && <span style={{ ...st(0.6), font: `400 44px ${SERIF}`, color: C.ink }}>{verdict}</span>}
      {M.conclusion && <span style={{ ...st(0.8), font: `400 30px ${SERIF}`, color: C.dim, fontStyle: 'italic', maxWidth: 1100, textAlign: 'center' }}>{M.conclusion}</span>}
      {hasAcc && <span style={{ ...st(0.9), font: `600 15px ${MONO}`, letterSpacing: '0.14em', color: C.dim, marginTop: 16 }}>ACCURACY</span>}
      {hasAcc && bar(M.white, 1.0)}
      {hasAcc && bar(M.black, 1.2)}
      {M.engine && <span style={{ ...st(1.8), font: `500 17px ${MONO}`, color: C.dim, marginTop: 20 }}>{M.engine}</span>}
    </div>
  );
}

// ---------- composition ----------
function GameVideo({ M, tw, d }) {
  const { T, CUES, authoredTotal } = useComposition();
  const S = useSchedule(M, CUES, d);
  const pieces = React.useMemo(() => simulate(M), [M]);
  const enter = (i) => MOTION.enter(cl01((T - (CUES.Opening - 0.5 + i * 0.12)) / 0.7));
  let f = 0;
  if (tw.cameraPush) S.keys.forEach((i) => {
    const t0 = S.tp[i] - 0.3, t1 = i + 1 < S.N ? S.tp[i + 1] - 0.5 : CUES.Outro;
    f = Math.max(f, MOTION.move(cl01((T - t0) / 0.7)) * (1 - MOTION.move(cl01((T - t1) / 0.7))));
  });
  const c = lastPly(T, S);
  const flash = c >= 0 && (M.plies[c].cls === 'blunder' || M.plies[c].checkmate) ? Math.max(0, 1 - Math.abs(T - S.tp[c] - S.md[c] - 0.25) / 0.6) : 0;
  const cx = BX + BW / 2, cy = BY + BW / 2, sc = 1 + 0.1 * f;
  const fade = 1 - cl01((T - (authoredTotal - 0.9)) / 0.8);
  return (
    <div data-screen-label={'t=' + Math.floor(T) + 's'} style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: fade }}>
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0', transform: `translate(${cx}px,${cy}px) scale(${sc}) translate(${-cx}px,${-cy}px)` }}>
          <EvalBar M={M} T={T} S={S} a={enter(1)} />
          <PlayerBar M={M} T={T} S={S} side="b" a={enter(1)} pieces={pieces} />
          <Board M={M} T={T} S={S} a={enter(0)} arrows={tw.bestArrows} pieces={pieces} />
          <PlayerBar M={M} T={T} S={S} side="w" a={enter(1)} pieces={pieces} />
          <Header M={M} a={enter(2)} />
          <MoveList M={M} T={T} S={S} a={enter(3)} />
          <Commentary M={M} T={T} S={S} a={enter(4)} />
          <Analysis M={M} T={T} S={S} a={enter(5)} />
          <EvalPlot M={M} T={T} S={S} a={enter(6)} />
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: `inset 0 0 220px rgba(228,85,63,${0.55 * flash})` }} />
        <TitleCard M={M} T={T} CUES={CUES} />
        <EndCard M={M} T={T} CUES={CUES} />
      </div>
    </div>
  );
}

// ---------- loader ----------
const STORE = 'chess-video.files.v1';
const SAMPLE = { pgn: window.SAMPLE_PGN, analysis: window.SAMPLE_ANALYSIS, sampleNotes: window.SAMPLE_NOTES, sample: true };
function readStored() { try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && (s.pgn || s.analysis)) return s; } catch (e) {} return SAMPLE; }

function GameApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const [files, setFiles] = React.useState(readStored);
  const [err, setErr] = React.useState('');
  const [drag, setDrag] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [ai, setAi] = React.useState({ busy: false, err: '' });
  const inputRef = React.useRef(null);
  const built = React.useMemo(() => { try { return { M: window.ChessCore.buildGame(files) }; } catch (e) { return { error: e.message }; } }, [files]);
  const lastGood = React.useRef(null);
  if (built.M) lastGood.current = built.M;
  const M = built.M || lastGood.current || window.ChessCore.buildGame(SAMPLE);
  const TM = React.useMemo(() => window.ChessCore.timing(M, { secondsPerMove: t.secondsPerMove, keyHold: t.keyHold, fastOpening: t.fastOpening }), [M, t.secondsPerMove, t.keyHold, t.fastOpening]);
  const computed = JSON.stringify(TM.scenes);
  // keep the file's literal when it already matches, so timeline edits still write back for the default game
  const literalMatches = (() => { try { return JSON.stringify(JSON.parse(window.OM_SCENES).map(({ name, dur, desc }) => ({ name, dur, desc }))) === computed; } catch (e) { return false; } })();
  const scenes = literalMatches ? window.OM_SCENES : computed;
  const fmtLen = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;

  const commit = (next) => {
    try { window.ChessCore.buildGame(next); } catch (e) { setErr(e.message); return; }
    setErr(''); setFiles(next);
    try { if (next.sample && !next.evalSource && !next.aiNotes) localStorage.removeItem(STORE); else localStorage.setItem(STORE, JSON.stringify(next)); } catch (e) { setErr('Loaded, but the files are too large to remember after reload.'); }
  };
  const loadFiles = async (list) => {
    const batch = {};
    for (const f of Array.from(list)) { const text = await f.text(); const kind = window.ChessCore.classifyFile(f.name, text); batch[kind] = text; batch[kind + 'Name'] = f.name; }
    if (!batch.pgn && !batch.analysis && !batch.notes) return;
    let next;
    if (batch.pgn) {
      next = { ...batch, gameIndex: 0 };
      if (!batch.analysis && files.analysis && !files.sample) { try { window.ChessCore.buildGame({ ...next, analysis: files.analysis }); next.analysis = files.analysis; next.analysisName = files.analysisName; } catch (e) {} }
    } else next = { ...files, ...batch, sample: false };
    commit(next);
  };
  React.useEffect(() => {
    const over = (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); setDrag(true); } };
    const leave = (e) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e) => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); loadFiles(e.dataTransfer.files); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });
  const writeCommentary = async () => {
    if (!window.claude || !window.claude.complete) { setAi({ busy: false, err: 'Claude is not available here' }); return; }
    setAi({ busy: true, err: '' });
    try {
      const base = window.ChessCore.buildGame({ ...files, aiNotes: null, sampleNotes: null });
      const p = window.ChessCore.commentaryPrompt(base, { tone: t.aiTone || 'Broadcast', density: t.aiDensity || 'Key moments', audience: t.aiAudience || 'Beginners' });
      const req = { max_tokens: 6000, system: p.system, messages: [{ role: 'user', content: p.user }] };
      let text;
      try { text = await window.claude.complete({ ...req, model: 'claude-sonnet-4-5' }); } catch (e) { text = await window.claude.complete(req); }
      const aiNotes = window.ChessCore.parseCommentary(text, base.plies.length);
      commit({ ...files, aiNotes, sampleNotes: null });
      setAi({ busy: false, err: '' });
    } catch (e) { setAi({ busy: false, err: 'Commentary failed: ' + e.message }); }
  };
  const downloadNotes = () => {
    const txt = files.aiNotes || files.notes || files.sampleNotes || '';
    const name = (M.white.short + '_' + M.black.short).replace(/[^\w-]+/g, '_') + '_notes.txt';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const status = `${M.white.short} – ${M.black.short} · ${M.plies.length} plies` + (M.evalSource === 'analysis' ? ' · analysis evals' : M.evalSource === 'pgn' ? ' · PGN evals' : '') + (M.hasNotes ? ' · notes' : '') + (M.hasAiNotes ? ' · AI commentary' : '') + (files.sample ? ' (sample)' : '') + ' · ' + fmtLen(TM.total);
  const shownErr = err || built.error;

  return (
    <React.Fragment>
      <CompositionStage key={scenes} width={1920} height={1080} scenes={scenes} playback={window.OM_PLAYBACK} bg={C.bg}>
        <GameVideo M={M} tw={t} d={TM.d} />
      </CompositionStage>
      <input ref={inputRef} type="file" multiple accept=".pgn,.txt,.json,application/json,text/plain" style={{ display: 'none' }} onChange={(e) => { loadFiles(e.target.files); e.target.value = ''; }} />
      {t.showLoader && (
        <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'fixed', top: 8, right: 8, zIndex: 50, display: 'flex', alignItems: 'center', gap: 10, padding: 4, borderRadius: 8, background: hover || shownErr ? 'rgba(27,23,21,0.92)' : 'transparent', font: `500 12px ${MONO}`, color: C.dim, maxWidth: 520, opacity: hover || shownErr ? 1 : 0.45, transition: 'opacity .2s' }}>
          {(hover || shownErr) && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 8, color: shownErr ? C.blunder : C.dim }}>{shownErr || status}</span>}
          <button onClick={() => inputRef.current.click()} style={{ font: `600 12px ${MONO}`, padding: '6px 10px', borderRadius: 6, border: 'none', background: C.last, color: '#15100d', cursor: 'pointer', whiteSpace: 'nowrap' }}>Load game…</button>
        </div>
      )}
      {drag && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(19,16,15,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ padding: '40px 60px', border: `2px dashed ${C.last}`, borderRadius: 12, font: `500 20px ${MONO}`, color: C.ink, textAlign: 'center', lineHeight: 1.6 }}>Drop PGN, analysis JSON and notes<br /><span style={{ color: C.dim, fontSize: 15 }}>one file or all three at once</span></div>
        </div>
      )}
      <TweaksPanel>
        <TweakSection label="Game" />
        <div style={{ font: '12px/1.4 system-ui', color: shownErr ? '#c0392b' : 'inherit', opacity: 0.8 }}>{shownErr || status}</div>
        <TweakButton label="Load PGN / analysis / notes…" onClick={() => inputRef.current.click()} />
        {!files.sample && <TweakButton label="Back to sample game" onClick={() => commit(SAMPLE)} />}
        {M.canChooseSource && (
          <TweakRadio label="Evaluations from" value={M.evalSource === 'pgn' ? 'PGN' : 'Analysis'} options={['Analysis', 'PGN']} onChange={(v) => commit({ ...files, evalSource: v === 'PGN' ? 'pgn' : 'analysis' })} />
        )}
        {M.gameCount > 1 && (
          <TweakSelect label="Game in PGN" value={String((files.gameIndex || 0) + 1)} options={Array.from({ length: M.gameCount }, (_, i) => String(i + 1))} onChange={(v) => commit({ ...files, gameIndex: +v - 1, analysis: null, analysisName: null })} />
        )}
        <TweakToggle label="Show load button" value={t.showLoader} onChange={(v) => setTweak('showLoader', v)} />
        <TweakSection label="Commentary" />
        <TweakRadio label="Style" value={t.aiTone || 'Broadcast'} options={['Broadcast', 'Lesson', 'Concise']} onChange={(v) => setTweak('aiTone', v)} />
        <TweakRadio label="Audience" value={t.aiAudience || 'Beginners'} options={['Beginners', 'Club players', 'Experts']} onChange={(v) => setTweak('aiAudience', v)} />
        <TweakRadio label="Amount" value={t.aiDensity || 'Key moments'} options={['Key moments', 'Detailed']} onChange={(v) => setTweak('aiDensity', v)} />
        <TweakButton label={ai.busy ? 'Writing commentary…' : M.hasAiNotes ? 'Rewrite commentary with Claude' : 'Write commentary with Claude'} onClick={() => { if (!ai.busy) writeCommentary(); }} />
        {ai.err && <div style={{ font: '12px/1.4 system-ui', color: '#c0392b' }}>{ai.err}</div>}
        {M.hasNotes && <div style={{ font: '12px/1.4 system-ui', opacity: 0.7 }}>Your notes file takes priority over Claude's comments on the same move.</div>}
        {M.hasAiNotes && <TweakButton label="Remove Claude's commentary" onClick={() => commit({ ...files, aiNotes: null, sampleNotes: files.sample ? window.SAMPLE_NOTES : null })} />}
        <TweakButton label="Download commentary as notes file" onClick={downloadNotes} />
        <TweakSection label="Pace" />
        <div style={{ font: '12px/1.4 system-ui', opacity: 0.8 }}>Video length {fmtLen(TM.total)}{TM.capped ? ' — capped at 5:00 for export' : ''}</div>
        <TweakSlider label="Seconds per move" value={t.secondsPerMove} min={0.5} max={4} step={0.1} unit="s" onChange={(v) => setTweak('secondsPerMove', v)} />
        <TweakSlider label="Extra hold on marked moves" value={t.keyHold} min={0} max={6} step={0.5} unit="s" onChange={(v) => setTweak('keyHold', v)} />
        <TweakToggle label="Faster opening" value={t.fastOpening} onChange={(v) => setTweak('fastOpening', v)} />
        <TweakSection label="Video" />
        <TweakToggle label="Best-move arrows" value={t.bestArrows} onChange={(v) => setTweak('bestArrows', v)} />
        <TweakToggle label="Camera push on blunders" value={t.cameraPush} onChange={(v) => setTweak('cameraPush', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}
window.GameApp = GameApp;
