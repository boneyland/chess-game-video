// ---------- the endgame tablebase (Settings › Online data) ----------
// Lichess's Syzygy tables for positions of 7 pieces or fewer: the result with best play, its distances and every move
// ranked by result. Shown in the Analysis panel and the eval bar while the replay is paused and on the free board,
// never during a game; the stored analysis is left alone.
const TB = window.LichessCore ? window.LichessCore.create() : null;
const TB_DEBOUNCE_MS = 300; // after the last position change (stepping through moves sends nothing for the ones passed)

// The tablebase's answer for pos (a ChessCore position), or null when it isn't asked (off, more than 7 pieces):
// { state: 'loading' | 'none' (offline, an error, a back-off) | 'ready', tb, turn }
function useTablebase(pos, on) {
  const LC = window.LichessCore;
  const fen = on && TB && pos && LC.pieceCount(window.ChessCore.toFen(pos)) <= LC.TB_MAX_PIECES ? LC.fenOf(pos) : null;
  const [st, setSt] = React.useState({ fen: null, tb: null });
  const hit = fen ? TB.tablebaseCached(fen) : undefined;
  React.useEffect(() => {
    if (!fen || hit) return;
    const ctl = new AbortController();
    const id = setTimeout(() => TB.tablebase(fen, { signal: ctl.signal }).then((tb) => { if (!ctl.signal.aborted) setSt({ fen, tb }); }), TB_DEBOUNCE_MS);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [fen]);
  if (!fen) return null;
  const tb = hit || (st.fen === fen ? st.tb : undefined);
  return tb ? { state: 'ready', tb, turn: pos.turn } : { state: tb === null ? 'none' : 'loading', tb: null, turn: pos.turn };
}

// what the eval bar shows for the answer ({ cp, txt } from White's side, txt tagged "TB"), or null to keep the engine's
const tbBar = (t) => (t && t.state === 'ready' ? window.LichessCore.bar(t.tb, t.turn) : null);

const TB_GROUP = { win: 'Win', draw: 'Draw', loss: 'Loss', unknown: '?' };
const tbColor = (o) => (o === 'win' ? C.best : o === 'loss' ? C.blunder : C.dim);
// a move's distances for its tooltip, from the mover's side (the API gives them from the opponent's)
const tbDist = (m) => [m.dtz != null && m.dtz !== 0 && `DTZ ${-m.dtz}`, m.dtm != null && m.dtm !== 0 && `DTM ${-m.dtm}`].filter(Boolean).join(' · ');

// The Analysis panel's Tablebase block: the verdict and distances, then the moves by result (each group one line that
// scrolls sideways), best first; a move plays it on the board. t: useTablebase's answer
function TablebaseBlock({ t, onPlay }) {
  if (!t) return null;
  const LC = window.LichessCore;
  const head = (txt, color) => (
    <div style={{ ...NO_SELECT, display: 'flex', alignItems: 'baseline', gap: 10, font: `600 15px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      <span style={{ flex: 'none', color: C.dim }}>Tablebase</span><span style={{ minWidth: 0, color }}>{txt}</span>
    </div>
  );
  if (t.state !== 'ready') return <div className="tb-block">{head(t.state === 'loading' ? 'Looking up…' : 'Not available', C.dim)}</div>;
  const tb = t.tb, white = t.turn === 'w';
  // distances where a side is winning (a cursed win too: its DTZ says how far past the fifty moves the win lies)
  const decided = !tb.checkmate && (['win', 'loss'].includes(LC.outcome(tb.category)) || tb.category === 'cursed-win' || tb.category === 'blessed-loss');
  const dist = decided ? [tb.dtz != null && `DTZ ${Math.abs(tb.dtz)}`, tb.dtm ? `DTM ${Math.abs(tb.dtm)}` : null].filter(Boolean) : [];
  return (
    <div className="tb-block" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {head([LC.verdict(tb, t.turn), ...dist].join(' · '), C.ink)}
      {LC.groups(tb).map((g) => (
        <div key={g.outcome} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ ...NO_SELECT, flex: 'none', width: 52, font: `600 14px ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tbColor(g.outcome) }}>{TB_GROUP[g.outcome]}</span>
          <SideScroll style={{ display: 'flex', gap: 6, minWidth: 0, flex: 1 }}>
            {g.moves.map((m) => {
              const tip = `Play ${m.san}: ${LC.verdict({ category: m.mine, moves: [] }, t.turn)}${tbDist(m) ? ' · ' + tbDist(m) : ''}`;
              return (
                <span key={m.uci} className="mv tb-move" role="button" tabIndex={0} title={tip} aria-label={tip}
                  onClick={(e) => { e.stopPropagation(); onPlay(m.uci); }} onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlay(m.uci); } }}
                  style={{ flex: 'none', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, font: `600 16px ${MONO}`, background: white ? '#f1ebe1' : '#2a2320', color: white ? '#15100d' : '#efe8de', border: `1px solid ${g.outcome === 'win' || g.outcome === 'loss' ? tbColor(g.outcome) : white ? 'rgba(60,40,20,0.22)' : 'rgba(255,236,214,0.22)'}` }}>{m.san}</span>
              );
            })}
          </SideScroll>
        </div>
      ))}
    </div>
  );
}
