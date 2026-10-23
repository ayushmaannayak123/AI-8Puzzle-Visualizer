/* ===================================================================
   puzzle.js: 8-Puzzle state model
   -------------------------------------------------------------------
   A state is a length-9 array, index = row * 3 + col, 0 = blank.
   The blank is written "_" in the user interface (as in the
   guidelines) and stored as 0 internally.

   An action is a movement of the BLANK: Up, Down, Left or Right.
   (Sliding a tile into the blank is the same thing seen from the
   other side.) Every action costs 1, so path cost g(n) = depth.
   =================================================================== */

const Puzzle = (() => {
  'use strict';

  const SIZE = 3;
  const CELLS = SIZE * SIZE;

  /* Operator order used by DLS when generating successors.
     Fixed order => the search is fully deterministic and reproducible. */
  const MOVES = [
    { id: 0, name: 'Up',    arrow: '\u2191', dr: -1, dc: 0 },
    { id: 1, name: 'Down',  arrow: '\u2193', dr:  1, dc: 0 },
    { id: 2, name: 'Left',  arrow: '\u2190', dr:  0, dc: -1 },
    { id: 3, name: 'Right', arrow: '\u2192', dr:  0, dc: 1 }
  ];

  const DEFAULT_INITIAL = [2, 8, 3, 1, 6, 4, 7, 0, 5];  // 283 / 164 / 7_5
  const DEFAULT_GOAL    = [1, 2, 3, 8, 0, 4, 7, 6, 5];  // 123 / 8_4 / 765

  /* ---------- encoding ----------
     A state is packed into one integer (base-9 digits). 9^9 < 2^31, so it
     fits a 32-bit int: cheap to hash, compare and store in typed arrays. */
  function encode(state) {
    let k = 0;
    for (let i = 0; i < CELLS; i++) k = k * 9 + state[i];
    return k;
  }

  function decode(key) {
    const s = new Array(CELLS);
    for (let i = CELLS - 1; i >= 0; i--) { s[i] = key % 9; key = (key - s[i]) / 9; }
    return s;
  }

  /* "283/164/7_5" */
  function format(state) {
    const ch = state.map(v => (v === 0 ? '_' : String(v)));
    return ch.slice(0, 3).join('') + '/' + ch.slice(3, 6).join('') + '/' + ch.slice(6, 9).join('');
  }

  /* ---------- parsing & validation ----------
     Accepts three row strings such as ["283","164","7_5"]. The blank may be
     typed as "_" or "0" (also "-" or "."). Returns { state } or { error }. */
  function parseRows(rows) {
    if (!Array.isArray(rows) || rows.length !== 3) return { error: 'Enter exactly three rows.' };
    const state = [];
    for (let r = 0; r < 3; r++) {
      const row = String(rows[r]).replace(/\s+/g, '');
      if (row.length !== 3) return { error: `Row ${r + 1} must contain exactly 3 characters (you typed "${rows[r]}").` };
      for (const ch of row) {
        if (ch === '_' || ch === '0' || ch === '-' || ch === '.') state.push(0);
        else if (ch >= '1' && ch <= '8') state.push(Number(ch));
        else return { error: `Row ${r + 1} contains the invalid character "${ch}". Use digits 1\u20138 and _ for the blank.` };
      }
    }
    const seen = new Set(state);
    if (seen.size !== CELLS) {
      const missing = [];
      for (let v = 0; v < CELLS; v++) if (!seen.has(v)) missing.push(v === 0 ? '_' : v);
      return { error: `Each of the tiles 1\u20138 and the blank _ must appear exactly once (missing: ${missing.join(', ')}).` };
    }
    return { state };
  }

  /* ---------- successor function ---------- */
  function successors(state) {
    const blank = state.indexOf(0);
    const r = Math.floor(blank / SIZE), c = blank % SIZE;
    const out = [];
    for (const m of MOVES) {
      const nr = r + m.dr, nc = c + m.dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const to = nr * SIZE + nc;
      const next = state.slice();
      next[blank] = next[to];
      next[to] = 0;
      out.push({ state: next, move: m.id, blankFrom: blank, blankTo: to, tile: state[to] });
    }
    return out;
  }

  /* ---------- solvability ----------
     For an odd-width board (3x3) a goal is reachable iff the permutation
     taking the initial tile order to the goal tile order (blank ignored) is
     EVEN, i.e. has an even number of inversions. This holds for ANY goal,
     not just the one with the blank in the top-left corner. */
  function isSolvable(initial, goal) {
    const goalOrder = goal.filter(v => v !== 0);
    const rank = {};
    goalOrder.forEach((v, i) => { rank[v] = i; });
    const seq = initial.filter(v => v !== 0).map(v => rank[v]);
    let inversions = 0;
    for (let i = 0; i < seq.length; i++)
      for (let j = i + 1; j < seq.length; j++)
        if (seq[i] > seq[j]) inversions++;
    return inversions % 2 === 0;
  }

  /* ---------- random solvable puzzle ----------
     Every puzzle is built by scrambling the GOAL with legal moves, so it is
     solvable by construction. The scramble never immediately undoes its own
     previous move, which keeps the walk from collapsing back onto the goal. */
  const SCRAMBLE_MIN = 8, SCRAMBLE_MAX = 20;

  function randomInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function scramble(goal, moves) {
    let cur = goal.slice();
    let prevKey = -1;
    for (let i = 0; i < moves; i++) {
      let options = successors(cur).filter(s => encode(s.state) !== prevKey);
      const pick = options[Math.floor(Math.random() * options.length)];
      prevKey = encode(cur);
      cur = pick.state;
    }
    return cur;
  }

  function generateRandomSolvable(goal) {
    const goalKey = encode(goal);
    for (let attempt = 0; attempt < 50; attempt++) {
      const n = randomInt(SCRAMBLE_MIN, SCRAMBLE_MAX);
      const s = scramble(goal, n);
      if (encode(s) !== goalKey) return { state: s, scrambleMoves: n };
    }
    // astronomically unlikely fallback: one legal move away from the goal
    return { state: successors(goal)[0].state, scrambleMoves: 1 };
  }

  return {
    MOVES, DEFAULT_INITIAL, DEFAULT_GOAL,
    encode, decode, format, parseRows, successors, isSolvable, generateRandomSolvable
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Puzzle;
