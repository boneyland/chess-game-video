// ---------- the free board ----------
// A board without a game (New board): the viewer plays both sides and Stockfish rates every move. A view of its own
// rather than a zero-ply GameVideo, so the replay's timeline never has to handle it; it shares the frame's layout,
// panels, board drawing and input. The board (BoardCore) lives in GameApp's files, so it is stored like a loaded game.
const FULL_SET = { q: 1, r: 2, b: 2, n: 2, p: 8 };

// A player bar for "White" or "Black": the pieces taken and the material edge, counted from the pieces on the board
// against a full set (so a position set up with an edge shows it)
function FreeBar({ pos, side, a }) {
  const left = (col, t) => pos.b.filter((p) => p === (col === 'w' ? t.toUpperCase() : t)).length;
  const lost = (col, t) => Math.max(0, FULL_SET[t] - left(col, t));
  const worth = (col) => Object.keys(FULL_SET).reduce((s, t) => s + left(col, t) * VALUE[t], 0);
  const opp = side === 'w' ? 'b' : 'w', pts = worth(side) - worth(opp), shown = [];
  Object.keys(FULL_SET).forEach((t) => {
    for (let i = 0; i < lost(opp, t) - lost(side, t); i++) shown.push(<img key={t + i} src={img(opp, t)} alt="" style={{ width: 30, height: 30, flex: 'none', marginLeft: shown.length ? -8 : 0, filter: opp === 'b' ? C.rim : 'none' }} />);
  });
  return (
    <div style={{ position: 'absolute', left: BX, width: BW / L.bar.k, top: side === ORIENT ? BY + BW + L.bar.gap : BY - L.bar.gap - 40 * L.bar.k, height: 40, transform: `scale(${L.bar.k})`, transformOrigin: '0 0', display: 'flex', alignItems: 'center', gap: 14, opacity: a }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: side === 'w' ? '#f1ebe1' : '#1c1613', border: `1.5px solid ${C.dim}`, flex: 'none' }} />
      <span style={{ font: `600 20px ${SANS}`, color: C.ink, whiteSpace: 'nowrap' }}>{side === 'w' ? 'White' : 'Black'}</span>
      <span style={{ display: 'flex', alignItems: 'center', marginLeft: 6 }}>{shown}</span>
      {pts > 0 && <span style={{ font: `600 16px ${MONO}`, color: C.dim, marginLeft: 8 }}>+{pts}</span>}
    </div>
  );
}

// a key's name drawn as a key: filled and bordered like a button, but only a label (no pointer, no clicks)
const KeyCap = ({ children }) => <span style={{ display: 'inline-block', padding: '0 7px', margin: '0 1px', borderRadius: 4, background: C.off, border: `1px solid ${C.line}`, boxShadow: `0 1px 0 ${C.line}`, color: C.ink, lineHeight: 1.45, pointerEvents: 'none', userSelect: 'none' }}>{children}</span>;

// the book's name for the position on the board (the last named one on the way there, the start included), or null
function boardOpening(board, book) {
  if (!book) return null;
  try { return book.name(window.BoardCore.ucis(board), board.fen); } catch (e) { return null; }
}
// the book moves from the position on the board, most book lines first
function bookMoves(board, book) {
  if (!book) return [];
  try { return book.continuations(window.BoardCore.ucis(board), board.fen); } catch (e) { return []; }
}

// The Commentary box on the free board: the position's name and the book moves from it, each a button that plays the
// move as a drag would (so Stockfish rates it). Out of the book it says so, with the last book position on the way.
function OpeningExplorer({ board, book, onPlay }) {
  const B = window.BoardCore, ucis = B.ucis(board), white = B.pos(board).turn === 'w', z = L.comment.label || 1;
  const named = boardOpening(board, book), next = bookMoves(board, book);
  let inBook = false;
  try { inBook = !!book && book.inBook(ucis, board.fen); } catch (e) {}
  const fromStart = board.fen === window.ChessCore.START_FEN;
  const heading = (txt, dim) => <span className="book-head" style={{ display: 'block', font: `400 ${Math.round(40 * Math.max(1, L.comment.text))}px/1.14 ${SERIF}`, color: dim ? C.dim : C.ink, textWrap: 'pretty' }}>{txt}</span>;
  const note = (txt) => <span style={{ display: 'block', marginTop: 8, font: `500 ${Math.round(15 * z)}px ${MONO}`, color: C.dim }}>{txt}</span>;
  const play = (e, uci) => { e.preventDefault(); e.stopPropagation(); onPlay(uci); };
  // each position's list starts at its top, not where the last one was scrolled to (the panel's box stays the same node)
  const top = React.useRef(null), posKey = board.fen + '|' + ucis.join(' ');
  React.useLayoutEffect(() => { const box = top.current && top.current.parentElement; if (box) box.scrollTop = 0; }, [posKey]);
  let body;
  if (!book) body = <span style={{ font: `italic 400 30px/1.25 ${SERIF}`, color: C.dim }}>Loading the opening book…</span>;
  else if (inBook) {
    body = (
      <React.Fragment>
        {heading(named ? named.name : ucis.length === 0 && fromStart ? 'Starting position' : 'In the book')}
        {next.length ? (
          <div className="book-moves" style={{ display: 'flex', flexDirection: 'column', gap: 2 * z, marginTop: 12 * z }}>
            {next.map((m) => (
              <div key={m.uci} className="mv" role="button" tabIndex={0} title={`Play ${m.san}`} onClick={(e) => play(e, m.uci)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(e, m.uci); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14 * z, minWidth: 0, padding: `${3 * z}px 6px`, borderRadius: 4, cursor: 'pointer' }}>
                <span style={{ flex: 'none', minWidth: 58 * z, boxSizing: 'border-box', textAlign: 'center', padding: `${2 * z}px ${8 * z}px`, borderRadius: 4, font: `600 ${Math.round(17 * z)}px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: `1px solid ${white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m.san}</span>
                <span style={{ minWidth: 0, font: `400 ${Math.round(17 * z)}px ${SANS}`, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name || ''}</span>
              </div>
            ))}
          </div>
        ) : note('No book moves from here.')}
      </React.Fragment>
    );
  } else if (named || (fromStart && ucis.length)) {
    body = <React.Fragment>{heading('Out of book', true)}{named && note(`last book position: ${named.eco} ${named.name}`)}</React.Fragment>;
  } else body = <span style={{ font: `italic 400 30px/1.25 ${SERIF}`, color: C.dim }}>This position isn’t in the opening book.</span>;
  return (
    <Panel box={{ ...L.comment, scroll: true }} a={1} title="Opening explorer" right={named ? `${named.eco} ${named.name}` : null}>
      <div ref={top}>{body}</div>
    </Panel>
  );
}

// The Analysis panel before the first move: the start position's eval and Stockfish's best line, whose moves play
// on the board when picked (as its replies do after a move)
function StartAnalysis({ board, ev, status, onLine }) {
  const after = ev.after, down = status === 'unavailable' || status === 'stopped';
  const line = [];
  if (after && after.pv) { let p = board.start.pos; for (const u of after.pv.slice(0, 8)) { const st = window.ChessCore.stepFromUci(p, u); if (!st) break; line.push({ ...st, byEngine: true }); p = st.pos; } }
  const turn = board.start.pos.turn === 'w' ? 'White' : 'Black';
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `700 38px ${MONO}`, color: C.last }}>Start</span>
          <span style={{ font: `600 16px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.last }}>
            {turn} to move · {down ? (status === 'unavailable' ? 'Stockfish can’t run here' : 'Stockfish stopped · play a move to restart it') : !after || after.partial ? 'Stockfish is thinking…' : 'Stockfish’s eval'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span style={{ font: `600 13px ${MONO}`, color: C.dim, letterSpacing: '0.12em' }}>EVAL{after && after.partial ? ` · DEPTH ${after.depth}` : ''}</span>
          <span style={{ font: `700 38px ${MONO}`, color: C.ink }}>{down && !(after && !after.partial) ? '—' : fmtSf(after && after.cp)}</span>
        </div>
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, font: `500 18px ${MONO}`, color: C.dim, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {line.length > 0
          ? <LineChips name="Stockfish’s best line" nameColor={C.ink} accent={C.best} moves={line.map((m) => m.san)} ply0={board.start.ply0} c={0} legal={line.length} sel={null} onPick={(j) => onLine(line.slice(0, j + 1))} />
          : <span> </span>}
        <span style={{ font: `500 15px ${MONO}` }}>Drag a piece to play a move, for either side; Stockfish rates every move.</span>
      </div>
    </React.Fragment>
  );
}

// The frame's layout without the eval graph, whose room goes to the panels: on the wide frame Moves and the explorer grow
// down into it (more moves, and room for book moves) and Analysis moves down; on the phone the explorer grows up into it.
// GameVideo sets the plain layout again on its next render.
const BOARD_LAYOUTS = new WeakMap();
function boardLayout(base) {
  if (!base.plot) return base;
  if (!BOARD_LAYOUTS.has(base)) {
    const p = base.plot, an = base.analysis, grow = p.y + p.h - (an.y + an.h);
    BOARD_LAYOUTS.set(base, base.header
      ? { ...base, plot: null, moves: { ...base.moves, h: base.moves.h + grow, rows: base.moves.rows + Math.floor(grow / base.moves.k / 38) }, comment: { ...base.comment, h: base.comment.h + grow }, analysis: { ...an, y: an.y + grow } }
      : { ...base, plot: null, comment: { ...base.comment, y: p.y, h: base.comment.h + base.comment.y - p.y } });
  }
  return BOARD_LAYOUTS.get(base);
}

function FreeBoard({ board, onChange, tw, sf, nav, orient, book }) {
  setLayout(useFrame()); // before the children render, which read the layout
  L = boardLayout(L);
  setOrient(orient);
  const B = window.BoardCore, pos = B.pos(board), { steps, upto } = board, last = steps.length - 1;
  const go = (u) => onChange(B.go(board, u));
  const input = useBoardInput({ pos, onPick: () => {}, onMiss: () => {}, onMove: (step) => onChange(B.play(board, step)) });
  const boardKey = board.fen + '|' + B.ucis(board).join(' ');
  // another position (a step, a takeback) drops a half-made move: a selected piece, the promotion picker
  React.useEffect(() => { input.clear(); }, [boardKey]);
  // Stockfish rates the move on the board: the positions before and after it (before the first move, both the start)
  const ev = useMoveEval(sf.engine, B.ucis(board, upto), B.ucis(board), sf.own, board.fen);
  const posBefore = upto > 0 ? steps[upto - 1].pos : board.start.pos;
  const bm = upto >= 0 && ev.before && ev.before.best ? window.ChessCore.applyUci(posBefore, ev.before.best) : null;
  const own = { ...ev, bestSan: bm ? bm.san : null };
  // a book move from the explorer goes the way of a drag
  const onBook = (uci) => { const step = window.ChessCore.stepFromUci(pos, uci); if (step) onChange(B.play(board, step)); };
  const onReply = (replies) => { let b = board; for (const s of replies) b = B.play(b, s); onChange(b); };
  const down = sf.status === 'unavailable' || sf.status === 'stopped';
  const cp = ev.after && ev.after.cp != null ? ev.after.cp : null;
  // a move lands with its sound, as a line's moves do in the replay
  const stepKey = upto >= 0 ? upto + ':' + steps[upto].uci : '';
  const prevStep = React.useRef(stepKey);
  React.useEffect(() => { sfxPlayer.prepare(tw.soundSet); }, [tw.soundSet]);
  React.useEffect(() => {
    const p = prevStep.current;
    prevStep.current = stepKey;
    if (stepKey && stepKey !== p && tw.sound !== false) sfxPlayer.play(tw.soundSet, window.Sfx.kinds(steps[upto].san), tw.soundVolume);
  }, [stepKey]);
  // the transport bar's buttons and label, and the keys: ← → step, Home the start, End the last move
  if (nav) nav.current = {
    label: upto < 0 ? 'Start' : B.label(board, upto), color: C.last,
    hasPrev: upto >= 0, hasNext: upto < last, hasLast: upto < last,
    prev: () => go(upto - 1), next: () => go(upto + 1), last: () => go(last), first: () => go(-1),
  };
  const navSig = nav && nav.current ? `${nav.current.label}|${upto}|${last}` : '';
  React.useEffect(() => { if (nav && nav.listen) nav.listen(); }, [navSig]);
  const keyRef = React.useRef(null);
  keyRef.current = { go, upto, last, promo: input.promo, cancelPromo: input.cancelPromo };
  React.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (e.defaultPrevented || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = keyRef.current;
      if (e.code === 'Escape' && k.promo) { e.preventDefault(); k.cancelPromo(); return; }
      const to = { ArrowLeft: k.upto - 1, ArrowRight: k.upto + 1, Home: -1, End: k.last }[e.code];
      if (to == null) return;
      e.preventDefault();
      if (to >= -1 && to <= k.last && to !== k.upto) k.go(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // MoveList draws a game at time T: one second a move, with T just short of the next, so the move shown is current and later ones dim
  const MV = React.useMemo(() => ({ ply0: board.start.ply0, plies: steps.map((s) => ({ san: s.san, cls: 'none' })) }), [steps, board.start.ply0]);
  const S = React.useMemo(() => ({ N: steps.length, tp: steps.map((_, i) => i) }), [steps.length]);
  const named = boardOpening(board, book);
  const HM = { white: { name: 'White' }, black: { name: 'Black' }, event: 'Free board', site: board.fen === window.ChessCore.START_FEN ? 'from the starting position' : 'from a FEN', eco: named && named.eco, opening: named && named.name };
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <EvalBarView cp={cp == null ? 0 : cp} txt={cp == null ? (down ? '' : '…') : fmtSf(cp)} a={1} />
      <FreeBar pos={pos} side="b" a={1} />
      <LineBoard a={1} sq={boardSquares()} v={{ upto, moves: steps, base: board.start.pos, src: 'you' }} hide={input.drag && input.drag.moved ? input.drag.from : null} />
      <BoardTouch pos={pos} sel={input.sel} targets={input.targets} drag={input.drag} promo={input.promo} {...input.handlers} />
      <FreeBar pos={pos} side="w" a={1} />
      {L.header && <Header M={HM} a={1} />}
      <MoveList M={MV} T={upto + 0.999} S={S} a={1} paused onPick={go} />
      <OpeningExplorer board={board} book={book} onPlay={onBook} />
      <Panel box={L.analysis} a={1} title="Analysis" right={down ? null : searchStats(window.AnalysisCore.ENGINE.name, ev.after)}>
        {upto < 0
          ? <StartAnalysis board={board} ev={ev} status={sf.status} onLine={onReply} />
          : <React.Fragment>
            <OwnMoveAnalysis M={MV} vline={{ at: 0, moves: steps, upto, src: 'you' }} own={own} status={sf.status} onReply={onReply} />
            <FitOrHide style={{ display: 'block', marginTop: 8, font: `500 15px ${MONO}`, color: C.dim }}>← → step · <KeyCap>Home</KeyCap> the start · <KeyCap>End</KeyCap> the last move</FitOrHide>
          </React.Fragment>}
      </Panel>
    </div>
  );
}

// Paste FEN: one field, Enter sets up, Esc cancels. A FEN that doesn't parse gets BoardCore's plain message and leaves
// the board and the field as they were. Keys pressed in the dialog stop here, so the board's keys (F, the arrows, Home,
// End) and the panels' Esc never see them; its scrim covers the board's touch layer.
function FenDialog({ onSet, onClose }) {
  const [text, setText] = React.useState(''), [msg, setMsg] = React.useState('');
  const field = React.useRef(null);
  React.useEffect(() => { if (field.current) field.current.focus(); }, []);
  const setUp = () => {
    let fen;
    try { fen = window.BoardCore.fenFromInput(text); } catch (e) { setMsg((e && e.message) || 'That isn’t a FEN this board can set up.'); return; }
    onSet(fen);
  };
  // Tab and Shift+Tab go round the field and the two buttons, so focus never reaches the page behind the scrim
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); } else if (e.key === 'Enter' && e.target === field.current) { e.preventDefault(); setUp(); }
    else if (e.key === 'Tab') {
      const stops = [...e.currentTarget.querySelectorAll('input, button')], i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  };
  return (
    <div className="fen-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* a press on the box's text keeps focus on its control: focus left on the page would escape the Tab loop */}
      <div className="fen-box" role="dialog" aria-modal="true" aria-label="Paste FEN" onKeyDown={onKey} onMouseDown={(e) => { if (!e.target.closest('input, button')) e.preventDefault(); }}>
        <div className="fen-title">Paste FEN</div>
        <input ref={field} className="twk-field fen-field" type="text" aria-label="FEN" aria-describedby="fen-msg" spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" value={text} onChange={(e) => { setText(e.target.value); setMsg(''); }} />
        <div className="fen-info">
          <div id="fen-msg" className="fen-msg" role="alert">{msg}</div>
          {!msg && <div className="fen-note">The pieces and the side to move are needed; castling, en passant and the move number are used when given. A PGN’s [FEN "…"] tag works too.</div>}
        </div>
        <div className="fen-btns">
          <button type="button" className="twk-btn secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="twk-btn" onClick={setUp}>Set up</button>
        </div>
      </div>
    </div>
  );
}
