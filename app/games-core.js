// My games: the games played at the board (PlayCore), kept in the browser as they go. The list is
// [{ id, updated, board }], newest first: id the game's (board.game.id), updated a time in ms, board in BoardCore.save's
// form, so a game in progress resumes with its clocks and result. Lists are never mutated.
(function () {
  const KEEP = 50;
  const B = () => window.BoardCore;

  // The stored list back (a JSON string, or null): entries whose board restores as a game with moves, the first of each
  // id, the newest KEEP. Never throws, whatever localStorage held.
  function read(raw) {
    let list;
    try { list = JSON.parse(raw || '[]'); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    const seen = new Set(), out = [];
    for (const e of list) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id) || !Number.isFinite(e.updated)) continue;
      const b = B().restore(e.board);
      if (!b || !b.game || !b.steps.length || b.game.id !== e.id) continue;
      seen.add(e.id);
      out.push({ id: e.id, updated: e.updated, board: e.board });
    }
    return out.sort((a, b) => b.updated - a.updated).slice(0, KEEP);
  }

  // The list with this game kept, first: from its first move; a game with no moves (all taken back) leaves the list
  function keep(list, board, now) {
    const g = board && board.game;
    if (!g || !g.id) return list;
    const rest = list.filter((e) => e.id !== g.id);
    if (!board.steps.length) return rest;
    return [{ id: g.id, updated: now, board: B().save(board) }].concat(rest).slice(0, KEEP);
  }

  const remove = (list, id) => list.filter((e) => e.id !== id);

  window.GamesCore = { KEEP, read, keep, remove };
})();
