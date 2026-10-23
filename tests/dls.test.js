/* ===================================================================
   tests/dls.test.js: automated checks for the 8-Puzzle DLS engine
   Run with:  node tests/dls.test.js      (Node 16+, no dependencies)
   =================================================================== */
'use strict';

global.Puzzle = require('../js/puzzle.js');
const DLS = require('../js/dls.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (e) { failed++; console.log('  \u2717 ' + name + '\n      ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), (msg || 'not equal') + `: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }

const INIT = Puzzle.DEFAULT_INITIAL;   // 283/164/7_5
const GOAL = Puzzle.DEFAULT_GOAL;      // 123/8_4/765

/* checks that a returned solution is a legal sequence of moves from start to goal */
function validatePath(result, initial, goal) {
  const p = result.solution;
  eq(p[0].state, initial, 'path must start at the initial state');
  eq(p[p.length - 1].state, goal, 'path must end at the goal state');
  for (let i = 1; i < p.length; i++) {
    const legal = Puzzle.successors(p[i - 1].state).some(s => Puzzle.encode(s.state) === Puzzle.encode(p[i].state));
    assert(legal, `step ${i} is not a legal move`);
  }
}

console.log('\nPuzzle utilities');
test('encode/decode round-trips', () => {
  for (let i = 0; i < 200; i++) {
    const s = Puzzle.generateRandomSolvable(GOAL).state;
    eq(Puzzle.decode(Puzzle.encode(s)), s);
  }
});
test('example from the guidelines parses (rows 283 / 164 / 7_5)', () => {
  eq(Puzzle.parseRows(['283', '164', '7_5']).state, INIT);
  eq(Puzzle.parseRows(['123', '8_4', '765']).state, GOAL);
  eq(Puzzle.format(INIT), '283/164/7_5');
});
test('invalid input is rejected with a message', () => {
  assert(Puzzle.parseRows(['283', '164', '7_']).error, 'short row');
  assert(Puzzle.parseRows(['283', '164', '7_9']).error, 'digit 9');
  assert(Puzzle.parseRows(['223', '164', '7_5']).error, 'duplicate tile');
  assert(Puzzle.parseRows(['123', '456', '78x']).error, 'bad character');
});
test('successor counts: corner 2, edge 3, centre 4', () => {
  eq(Puzzle.successors([0, 1, 2, 3, 4, 5, 6, 7, 8]).length, 2);
  eq(Puzzle.successors([1, 0, 2, 3, 4, 5, 6, 7, 8]).length, 3);
  eq(Puzzle.successors([1, 2, 3, 4, 0, 5, 6, 7, 8]).length, 4);
});
test('solvability: example solvable, swapping two tiles breaks it', () => {
  assert(Puzzle.isSolvable(INIT, GOAL), 'example must be solvable');
  const bad = INIT.slice(); [bad[0], bad[1]] = [bad[1], bad[0]];
  assert(!Puzzle.isSolvable(bad, GOAL), 'one swap flips parity');
  assert(Puzzle.isSolvable(GOAL, GOAL), 'goal is solvable from itself');
});
test('solvability agrees with real move sequences for 5 different goals', () => {
  const goals = [GOAL, [1,2,3,4,5,6,7,8,0], [0,1,2,3,4,5,6,7,8], [8,7,6,5,4,3,2,1,0], [3,1,2,0,4,5,6,7,8]];
  for (const g of goals) {
    for (let i = 0; i < 150; i++) {
      const s = Puzzle.generateRandomSolvable(g).state;     // built by legal moves from g
      assert(Puzzle.isSolvable(s, g), 'scrambled state must be solvable');
      const t = s.slice(); const a = t.findIndex(v => v > 0), b = t.findIndex((v, k) => v > 0 && k !== a);
      [t[a], t[b]] = [t[b], t[a]];                                    // one transposition
      assert(!Puzzle.isSolvable(t, g), 'transposed state must be unsolvable');
    }
  }
});
test('random generator: solvable and never equal to goal', () => {
  for (let i = 0; i < 100; i++) {
    const { state } = Puzzle.generateRandomSolvable(GOAL);
    assert(Puzzle.isSolvable(state, GOAL));
    assert(Puzzle.encode(state) !== Puzzle.encode(GOAL));
  }
});

console.log('\nDLS engine');
test('guidelines example: limit 5 finds the 5-move solution, limit 4 is a cutoff', () => {
  const ok = DLS.solve(INIT, GOAL, { limit: 5 });
  assert(ok.found && ok.status === 'solution', 'limit 5 must succeed');
  eq(ok.stats.moves, 5);
  validatePath(ok, INIT, GOAL);
  const no = DLS.solve(INIT, GOAL, { limit: 4 });
  assert(!no.found && no.status === 'cutoff', 'limit 4 must be a cutoff, got ' + no.status);
  eq(no.stats.maxDepth, 4);
});
test('limit 0: cutoff unless start == goal', () => {
  eq(DLS.solve(INIT, GOAL, { limit: 0 }).status, 'cutoff');
  const same = DLS.solve(GOAL, GOAL, { limit: 0 });
  eq(same.status, 'solution'); eq(same.stats.moves, 0); eq(same.solution.length, 1);
});
test('search never goes deeper than the limit', () => {
  for (const limit of [1, 3, 6, 9, 12]) {
    const r = DLS.solve(INIT, GOAL, { limit });
    assert(r.stats.maxDepth <= limit, `maxDepth ${r.stats.maxDepth} > limit ${limit}`);
    if (r.found) assert(r.stats.moves <= limit, 'solution longer than limit');
  }
});
test('solutions found at generous limits are valid (and may be longer than optimal)', () => {
  for (const limit of [5, 8, 12, 20, 31]) {
    const r = DLS.solve(INIT, GOAL, { limit });
    assert(r.found, 'limit ' + limit + ' should find the goal');
    validatePath(r, INIT, GOAL);
  }
});
test('bookkeeping: generated, expanded and cut-off counts are consistent', () => {
  const r = DLS.solve(INIT, GOAL, { limit: 6 });
  const s = r.stats;
  eq(s.nodesVisited, s.nodesExpanded + s.nodesCutOff + (r.found ? 1 : 0), 'visited = expanded + cutoff + goal');
  assert(s.nodesGenerated >= s.nodesExpanded, 'cannot expand more than was generated');
  assert(s.peakFrontier >= 1);
});
test('recording does not change the search (same counts, same answer)', () => {
  for (const limit of [4, 5, 7, 10]) {
    const lean = DLS.solve(INIT, GOAL, { limit });
    const rec = DLS.solve(INIT, GOAL, { limit, record: true });
    eq(lean.status, rec.status);
    for (const k of ['nodesGenerated', 'nodesExpanded', 'nodesCutOff', 'nodesVisited', 'duplicatesPruned', 'maxDepth', 'peakFrontier'])
      eq(lean.stats[k], rec.stats[k], k);
    eq(rec.trace.length, rec.stats.nodesVisited);
  }
});
test('trace replay: first step is the root, last step is the goal, children are legal', () => {
  const r = DLS.solve(INIT, GOAL, { limit: 7, record: true });
  const t = r.trace;
  const first = t.step(0), last = t.step(t.length - 1);
  eq(first.state, INIT); eq(first.depth, 0); eq(first.parentId, -1);
  eq(last.state, GOAL); eq(last.kind, DLS.KIND.GOAL);
  for (let i = 0; i < t.length; i += Math.max(1, Math.floor(t.length / 60))) {
    const st = t.step(i);
    assert(st.depth <= 7, 'depth over the limit in trace');
    if (st.kind === DLS.KIND.EXPAND) {
      eq(st.children.length, Puzzle.successors(st.state).length, 'children list incomplete');
      assert(st.depth < 7, 'a node at the limit must not be expanded');
    }
    if (st.kind === DLS.KIND.CUTOFF) eq(st.depth, 7, 'cutoff nodes sit exactly at the limit');
  }
});
test('LIFO order: after an expansion the next node visited is its first pushed child', () => {
  const t = DLS.solve(INIT, GOAL, { limit: 8, record: true }).trace;
  let checked = 0;
  for (let i = 0; i + 1 < t.length; i++) {
    if (t.sKind[i] === DLS.KIND.EXPAND && t.sCount[i] > 0) {
      eq(t.sNode[i + 1], t.sFirst[i], 'stack order broken at step ' + i);
      checked++;
    }
  }
  assert(checked > 0, 'no expansions checked');
});
test('depth-first order: first successor visited is the "Up" move whenever the blank can move up', () => {
  const r = DLS.solve(INIT, GOAL, { limit: 6, record: true });
  const s0 = r.trace.step(0), s1 = r.trace.step(1);
  eq(s1.move, 0, 'blank at row 3 can move Up, so Up is explored first');
  eq(s1.parentState, s0.state);
});
test('node-budget safety cap aborts instead of hanging', () => {
  const far = [8, 6, 7, 2, 5, 4, 3, 0, 1];     // not reachable from the goal: the search can never succeed
  const r = DLS.solve(far, GOAL, { limit: 40 });
  eq(r.status, 'aborted');
  assert(r.stats.nodesVisited <= DLS.MAX_VISITS, 'visited more than the budget');
});
test('deterministic: two runs give identical statistics', () => {
  const a = DLS.solve(INIT, GOAL, { limit: 12 }), b = DLS.solve(INIT, GOAL, { limit: 12 });
  for (const k of ['nodesGenerated', 'nodesExpanded', 'moves', 'maxDepth']) eq(a.stats[k], b.stats[k], k);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
