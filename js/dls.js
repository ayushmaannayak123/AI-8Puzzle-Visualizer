/* ===================================================================
   dls.js: Depth Limited Search (DLS) for the 8-Puzzle
   -------------------------------------------------------------------
   Written from scratch (no search libraries).

   DLS is Depth-First Search that refuses to go deeper than a fixed
   depth limit l: a node at depth l is treated as if it had no
   successors. Following Russell & Norvig [1], a search ends with:

     solution : a goal node was reached within the limit
     cutoff   : no goal found, but some branch was cut off at depth l,
                so a deeper solution may exist
     failure  : no goal found and nothing was cut off, so no solution
                exists

   A fourth status, "aborted", is a safety net: the search stops after
   MAX_VISITS node visits so the browser tab can never hang.

   Data structures
     frontier : explicit LIFO stack of node ids (no recursion)
     nodes    : parallel typed arrays (state, parent, depth, move)
     closed   : Map(state -> shallowest depth at which it was expanded)

   Repeated states: the 8-puzzle graph is full of loops, so a node is
   skipped when its state was already expanded at the same or a SHALLOWER
   depth (everything below it within the limit was already explored). A
   state reached at a strictly shallower depth is expanded again, so DLS
   still finds a solution whenever one exists within the limit.

   Successors are generated in the order Up, Down, Left, Right (movement
   of the blank). They are pushed in reverse so that Up is explored first.
   =================================================================== */

const DLS = (() => {
  'use strict';

  const MAX_VISITS = 300000;   // safety cap on node visits
  const MAX_LIMIT = 200;       // depths live in a Uint8Array

  // rough record sizes for the "approximate memory" statistic
  const NODE_BYTES = 32;
  const TABLE_ENTRY_BYTES = 24;

  const KIND = { EXPAND: 0, CUTOFF: 1, GOAL: 2 };

  /* growable typed array */
  class Vec {
    constructor(Type, capacity) {
      this.Type = Type;
      this.a = new Type(capacity || 1024);
      this.n = 0;
    }
    push(v) {
      if (this.n === this.a.length) {
        const bigger = new this.Type(this.a.length * 2);
        bigger.set(this.a);
        this.a = bigger;
      }
      this.a[this.n++] = v;
    }
    view() { return this.a.subarray(0, this.n); }
  }

  function memoryLabel(bytes) {
    if (bytes < 64 * 1024) return 'Low';
    if (bytes < 1024 * 1024) return 'Medium';
    return 'High';
  }

  /* -------------------------------------------------------------------
     Trace: read-only view of everything recorded during a run
     ------------------------------------------------------------------- */
  class Trace {
    constructor(d) { Object.assign(this, d); }

    get length() { return this.sNode.length; }

    stateOf(id) { return Puzzle.decode(this.nState[id]); }

    /* full detail for step i, rebuilt on demand from the compact records */
    step(i) {
      const id = this.sNode[i];
      const parentId = this.nParent[id];
      const state = this.stateOf(id);
      const kind = this.sKind[i];
      const move = this.nMove[id];

      // every legal successor of an expanded node, tagged pushed / discarded
      let children = [];
      if (kind === KIND.EXPAND) {
        const first = this.sFirst[i], count = this.sCount[i];
        const pushed = new Set();
        for (let c = first; c < first + count; c++) pushed.add(this.nState[c]);
        children = Puzzle.successors(state).map(s => ({
          state: s.state,
          move: s.move,
          status: pushed.has(Puzzle.encode(s.state)) ? 'pushed' : 'discarded'
        }));
      }

      return {
        kind, state, children, parentId,
        depth: this.nDepth[id],
        move: move === 255 ? null : move,
        parentState: parentId >= 0 ? this.stateOf(parentId) : null,
        generated: this.sGen[i], expanded: this.sExp[i],
        cutoffs: this.sCut[i], pruned: this.sPrune[i],
        frontierSize: this.sFront[i]
      };
    }
  }

  /* -------------------------------------------------------------------
     solve(initial, goal, { limit, record })
       record: true also returns a step-by-step Trace for the animation
     ------------------------------------------------------------------- */
  function solve(initial, goal, opts) {
    opts = opts || {};
    const limit = Math.min(MAX_LIMIT, Math.max(0, Math.floor(Number(opts.limit) || 0)));
    const record = !!opts.record;

    const startKey = Puzzle.encode(initial);
    const goalKey = Puzzle.encode(goal);
    const t0 = performance.now();

    // ----- node pool -----
    const nState = new Vec(Int32Array, 4096);
    const nParent = new Vec(Int32Array, 4096);
    const nDepth = new Vec(Uint8Array, 4096);
    const nMove = new Vec(Uint8Array, 4096);
    function addNode(key, parent, depth, move) {
      nState.push(key); nParent.push(parent); nDepth.push(depth); nMove.push(move);
      return nState.n - 1;
    }

    // ----- optional recording (one compact record per visited node) -----
    let sNode, sKind, sGen, sExp, sCut, sPrune, sFront, sFirst, sCount;
    if (record) {
      sNode = new Vec(Int32Array, 4096);  sKind = new Vec(Uint8Array, 4096);
      sGen = new Vec(Int32Array, 4096);   sExp = new Vec(Int32Array, 4096);
      sCut = new Vec(Int32Array, 4096);   sPrune = new Vec(Int32Array, 4096);
      sFront = new Vec(Int32Array, 4096);
      sFirst = new Vec(Int32Array, 4096); sCount = new Vec(Uint8Array, 4096);
    }

    // ----- search -----
    const stack = [addNode(startKey, -1, 0, 255)];
    const closed = new Map();
    let generated = 1, expanded = 0, cutoffs = 0, pruned = 0;
    let visits = 0, maxDepth = 0, peakFrontier = 1;
    let cutoffOccurred = false, goalId = -1, aborted = false;

    while (stack.length > 0) {
      const id = stack.pop();
      const key = nState.a[id];
      const depth = nDepth.a[id];

      // stale entry: this state was expanded meanwhile at an equal or shallower depth
      const seen = closed.get(key);
      if (seen !== undefined && seen <= depth) { pruned++; continue; }

      visits++;
      if (depth > maxDepth) maxDepth = depth;

      let kind, first = -1, count = 0;

      if (key === goalKey) {
        kind = KIND.GOAL;
        goalId = id;
      } else if (depth >= limit) {
        // depth limit reached: treat as a leaf and remember that we cut something off
        kind = KIND.CUTOFF;
        cutoffs++;
        cutoffOccurred = true;
        closed.set(key, depth);
      } else {
        kind = KIND.EXPAND;
        expanded++;
        closed.set(key, depth);

        first = nState.n;
        const pushed = [];
        for (const s of Puzzle.successors(Puzzle.decode(key))) {
          generated++;
          const childKey = Puzzle.encode(s.state);
          const childSeen = closed.get(childKey);
          if (childSeen !== undefined && childSeen <= depth + 1) { pruned++; continue; }
          pushed.push(addNode(childKey, id, depth + 1, s.move));
        }
        count = pushed.length;
        for (let k = pushed.length - 1; k >= 0; k--) stack.push(pushed[k]);  // Up ends on top
        if (stack.length > peakFrontier) peakFrontier = stack.length;
      }

      if (record) {
        sNode.push(id); sKind.push(kind);
        sGen.push(generated); sExp.push(expanded); sCut.push(cutoffs); sPrune.push(pruned);
        sFront.push(stack.length);
        sFirst.push(first); sCount.push(count);
      }

      if (kind === KIND.GOAL) break;
      if (visits >= MAX_VISITS && stack.length > 0) { aborted = true; break; }
    }

    const timeMs = performance.now() - t0;

    // ----- outcome -----
    let status;
    if (goalId >= 0) status = 'solution';
    else if (aborted) status = 'aborted';
    else status = cutoffOccurred ? 'cutoff' : 'failure';

    // ----- solution path -----
    const solution = [];
    if (goalId >= 0) {
      const ids = [];
      for (let a = goalId; a !== -1; a = nParent.a[a]) ids.push(a);
      ids.reverse().forEach(nid => {
        solution.push({
          state: Puzzle.decode(nState.a[nid]),
          move: nMove.a[nid] === 255 ? null : nMove.a[nid]
        });
      });
    }

    const memoryBytes = peakFrontier * NODE_BYTES + closed.size * TABLE_ENTRY_BYTES + (maxDepth + 1) * NODE_BYTES;
    const moves = goalId >= 0 ? solution.length - 1 : null;

    const result = {
      status, limit, solution,
      found: goalId >= 0,
      stats: {
        nodesGenerated: generated,
        nodesExpanded: expanded,
        nodesCutOff: cutoffs,
        nodesVisited: visits,
        duplicatesPruned: pruned,
        maxDepth, peakFrontier, timeMs, moves,
        pathCost: moves,                       // unit step cost: g(n) = depth
        memoryBytes,
        memoryKB: memoryBytes / 1024,
        memoryLabel: memoryLabel(memoryBytes)
      },
      trace: null
    };

    if (record) {
      result.trace = new Trace({
        nState: nState.view(), nParent: nParent.view(), nDepth: nDepth.view(), nMove: nMove.view(),
        sNode: sNode.view(), sKind: sKind.view(), sGen: sGen.view(), sExp: sExp.view(),
        sCut: sCut.view(), sPrune: sPrune.view(), sFront: sFront.view(),
        sFirst: sFirst.view(), sCount: sCount.view()
      });
    }
    return result;
  }

  return { solve, KIND, MAX_LIMIT, MAX_VISITS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DLS;
