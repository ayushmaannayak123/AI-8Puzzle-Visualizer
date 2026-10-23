/* ===================================================================
   visualization.js: everything that draws the search
   -------------------------------------------------------------------
   Two playback views over one finished DLS run:
     "trace"    : one step per node popped from the stack
     "solution" : one step per move along the final solution path
   The tiles are absolutely positioned and animated with CSS transforms,
   so the blank visibly slides across the board.
   =================================================================== */

const Viz = (() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fmt = Puzzle.format;
  const ARROW = Puzzle.MOVES.map(m => m.arrow);
  const NAME = Puzzle.MOVES.map(m => m.name);
  const TILE_DIR = ['down', 'up', 'right', 'left'];      // blank Up => tile slides down, etc.
  const KIND = DLS.KIND;

  // [delay in ms between ticks, steps advanced per tick] and a label for each speed
  const SPEEDS = [[1400, 1], [1000, 1], [700, 1], [480, 1], [320, 1], [220, 1], [140, 1], [80, 1], [45, 3], [30, 12]];
  const SPEED_NAMES = ['Very slow', 'Slow', 'Slow', 'Medium', 'Medium', 'Medium', 'Fast', 'Fast', 'Very fast', 'Turbo'];

  const IDS = ['boardInitial', 'boardGoal', 'boardCurrent', 'viewBadge', 'stepTitle', 'stepDesc', 'gaugeText',
    'gaugeFill', 'scrub', 'stGen', 'stExp', 'stDepth', 'stCost', 'stCut', 'stPruned', 'stFront', 'stExplored',
    'successors', 'resultBanner', 'summary', 'solutionPathWrap', 'solutionStrip', 'liveDot', 'pauseBtn',
    'resumeBtn', 'prevBtn', 'nextBtn', 'endBtn', 'viewSolution', 'viewTrace', 'speedReadout', 'speedRange'];

  const el = {};
  let board = null;
  let initial = Puzzle.DEFAULT_INITIAL, goal = Puzzle.DEFAULT_GOAL, limit = 5;
  let result = null, trace = null;
  let mode = 'trace', index = 0;
  let playing = false, timer = null;
  let speed = 6;
  let retryCb = null;
  let bannerKey = '';

  /* ---------------------------------------------------------------
     formatting and small DOM helpers
     --------------------------------------------------------------- */
  const n = v => Number(v).toLocaleString('en-US');

  function fmtMs(ms) {
    if (ms < 0.01) return '<0.01 ms';
    if (ms < 1000) return ms.toFixed(ms < 10 ? 2 : 1) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function fmtKB(kb) {
    if (kb < 10) return kb.toFixed(1) + ' KB';
    return kb < 1024 ? Math.round(kb) + ' KB' : (kb / 1024).toFixed(1) + ' MB';
  }

  /* draws a 3x3 grid of small cells into an existing container */
  function fillMini(container, state, opts) {
    opts = opts || {};
    container.innerHTML = '';
    state.forEach((v, i) => {
      const c = document.createElement('div');
      c.className = 'mb' + (v === 0 ? ' blank' : '');
      if (opts.goal && v !== 0 && v === opts.goal[i]) c.classList.add('match');
      if (opts.moved === i) c.classList.add('moved');
      c.textContent = v === 0 ? '' : v;
      container.appendChild(c);
    });
    return container;
  }

  function miniBoard(state, opts) {
    const d = document.createElement('div');
    d.className = 'mini-board' + (opts && opts.size ? ' ' + opts.size : '');
    return fillMini(d, state, opts);
  }

  /* AnimatedBoard: 9 static slots + 8 tiles that slide between cells */
  class AnimatedBoard {
    constructor(container) {
      this.root = container;
      this.root.innerHTML = '';
      for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.style.setProperty('--r', Math.floor(i / 3));
        slot.style.setProperty('--c', i % 3);
        this.root.appendChild(slot);
      }
      this.tiles = {};
      for (let v = 1; v <= 8; v++) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.textContent = v;
        this.root.appendChild(t);
        this.tiles[v] = t;
      }
    }

    /* opts: animate, goal, movedTile, flag ('solved' | 'cut' | 'bad' | '') */
    set(state, opts) {
      if (!opts.animate) this.root.classList.add('instant');
      state.forEach((v, i) => {
        if (v === 0) return;
        const t = this.tiles[v];
        t.style.setProperty('--r', Math.floor(i / 3));
        t.style.setProperty('--c', i % 3);
        t.classList.toggle('match', opts.goal[i] === v);
        t.classList.toggle('moved', opts.movedTile === v);
      });
      if (!opts.animate) { void this.root.offsetWidth; this.root.classList.remove('instant'); }
      ['solved', 'cut', 'bad'].forEach(f => this.root.classList.toggle(f, opts.flag === f));
      this.root.setAttribute('aria-label', 'Current state ' + fmt(state));
    }
  }

  /* ---------------------------------------------------------------
     setup
     --------------------------------------------------------------- */
  function init() {
    IDS.forEach(id => { el[id] = $(id); });
    board = new AnimatedBoard(el.boardCurrent);

    el.resultBanner.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'skip') end();
      else if (btn.dataset.act === 'retry' && retryCb) retryCb(Number(btn.dataset.limit));
    });

    setSpeed(Number(el.speedRange.value));
    clear();
  }

  function setPuzzle(init, gl) {
    initial = init.slice();
    goal = gl.slice();
    fillMini(el.boardInitial, initial, { goal });
    fillMini(el.boardGoal, goal);
    if (!result) clear();
  }

  function setLimit(l) {
    limit = l;
    if (!result) { el.gaugeText.textContent = '0 / ' + limit; el.gaugeFill.style.width = '0%'; }
  }

  /* back to the "nothing run yet" state */
  function clear() {
    pause(true);
    result = null; trace = null; index = 0; mode = 'trace';
    board.set(initial, { animate: false, goal });
    el.viewBadge.textContent = 'Ready';
    el.viewBadge.className = 'badge-soft';
    el.stepTitle.textContent = 'Step 0 / 0';
    el.stepDesc.innerHTML = 'Choose a puzzle and a depth limit, then press <strong>Run</strong>.';
    el.gaugeText.textContent = '0 / ' + limit;
    el.gaugeFill.style.width = '0%';
    el.gaugeFill.classList.remove('at-limit');
    el.stCost.textContent = '-';
    ['stGen', 'stExp', 'stDepth', 'stCut', 'stPruned', 'stFront', 'stExplored'].forEach(id => { el[id].textContent = '0'; });
    el.successors.innerHTML = '<span class="muted">Run a search to see the successors generated at each step.</span>';
    el.summary.innerHTML = '<p class="muted mb-0">Run a search to see the solution summary.</p>';
    el.solutionPathWrap.hidden = true;
    el.solutionStrip.innerHTML = '';
    el.scrub.max = 0; el.scrub.value = 0; el.scrub.disabled = true;
    el.viewTrace.checked = true;
    el.viewSolution.checked = false;
    el.viewSolution.disabled = true;
    updateButtons();
  }

  /* load a finished run and start playing it */
  function setResult(res) {
    pause(true);
    result = res;
    trace = res.trace;
    limit = res.limit;
    mode = 'trace';
    index = 0;
    el.viewTrace.checked = true;
    el.viewSolution.disabled = !res.found;
    renderSummary(res);
    buildSolutionStrip(res);
    el.scrub.disabled = false;
    show(0, false);
    play();
  }

  /* ---------------------------------------------------------------
     playback
     --------------------------------------------------------------- */
  function lastIndex() {
    if (!result) return 0;
    return mode === 'trace' ? trace.length - 1 : result.solution.length - 1;
  }

  function show(i, animate) {
    index = Math.max(0, Math.min(lastIndex(), i));
    if (mode === 'trace') renderTraceStep(index, animate); else renderSolutionStep(index, animate);
    el.scrub.max = lastIndex();
    el.scrub.value = index;
    updateButtons();
  }

  function tick() {
    if (!playing) return;
    if (index >= lastIndex()) {
      if (mode === 'trace' && result.found) {           // search finished: replay the final path
        setMode('solution');
        timer = setTimeout(tick, 700);
      } else {
        pause();
      }
      return;
    }
    const [delay, stepsPerTick] = SPEEDS[speed - 1];
    show(index + stepsPerTick, stepsPerTick === 1);
    timer = setTimeout(tick, delay);
  }

  function play() {
    if (!result) return;
    if (index >= lastIndex() && !(mode === 'trace' && result.found)) show(0, false);
    playing = true;
    el.liveDot.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(tick, 250);
    updateButtons();
  }

  function pause(silent) {
    playing = false;
    clearTimeout(timer);
    el.liveDot.classList.remove('on');
    if (!silent) updateButtons();
  }

  function next() {
    pause();
    if (!result) return;
    if (index >= lastIndex() && mode === 'trace' && result.found) setMode('solution');
    else show(index + 1, true);
  }

  function prev() { pause(); if (result) show(index - 1, false); }
  function end() { pause(); if (result) show(lastIndex(), false); }
  function scrubTo(i) { pause(); if (result) show(i, false); }

  function setMode(m) {
    if (!result || (m === 'solution' && !result.found)) return;
    mode = m;
    el.viewTrace.checked = m === 'trace';
    el.viewSolution.checked = m === 'solution';
    index = 0;
    if (m === 'solution') renderTraceStep(trace.length - 1, false, true);   // keep the search stats at their final values
    show(0, false);
  }

  function setSpeed(s) {
    speed = Math.max(1, Math.min(10, s));
    el.speedRange.value = speed;
    el.speedReadout.textContent = SPEED_NAMES[speed - 1];
    const ms = Math.max(40, Math.min(350, SPEEDS[speed - 1][0] * 0.75));
    document.documentElement.style.setProperty('--move-ms', ms + 'ms');
  }

  function updateButtons() {
    const has = !!result;
    const atEnd = has && index >= lastIndex();
    const finished = has && atEnd && (mode === 'solution' || !result.found);
    el.pauseBtn.disabled = !playing;
    el.resumeBtn.disabled = !has || playing || finished;
    el.prevBtn.disabled = !has || index <= 0;
    el.nextBtn.disabled = !has || (atEnd && !(mode === 'trace' && result.found));
    el.endBtn.disabled = !has || atEnd;
    updateBanner();
  }

  /* ---------------------------------------------------------------
     render: one step of the search trace
     --------------------------------------------------------------- */
  function renderTraceStep(i, animate, statsOnly) {
    const s = trace.step(i);
    const prevNode = i > 0 ? trace.sNode[i - 1] : -1;
    const forward = animate && i > 0 && s.parentId === prevNode;     // descended one level from the previous node
    const finalMiss = i === trace.length - 1 && !result.found;

    if (!statsOnly) {
      const movedTile = forward ? s.state[s.parentState.indexOf(0)] : null;
      let flag = '';
      if (s.kind === KIND.GOAL) flag = 'solved';
      else if (finalMiss) flag = result.status === 'cutoff' ? 'cut' : 'bad';
      else if (s.kind === KIND.CUTOFF) flag = 'cut';
      board.set(s.state, { animate: forward, goal, movedTile, flag });

      let badge = ['Expanding', 'expand'];
      if (finalMiss) badge = ['Search ended: no solution', 'bad'];
      else if (s.kind === KIND.GOAL) badge = ['Goal reached', 'goal'];
      else if (s.kind === KIND.CUTOFF) badge = ['Cut off at limit', 'cutoff'];
      el.viewBadge.textContent = badge[0];
      el.viewBadge.className = 'badge-soft ' + badge[1];

      el.stepTitle.textContent = `Step ${n(i + 1)} / ${n(trace.length)}  \u00B7  search`;

      let how;
      if (i === 0) how = 'Start at the <strong>initial state</strong> (root, depth 0).';
      else if (s.parentId === prevNode) how = `Moved the blank <strong>${ARROW[s.move]} ${NAME[s.move]}</strong>, one level deeper.`;
      else how = `<strong>Backtracked</strong>: the last branch is finished, so the next node was popped from the stack (blank ${ARROW[s.move]} ${NAME[s.move]}).`;

      let what;
      if (s.kind === KIND.GOAL) {
        what = `This is the <strong>goal state</strong>, so the search stops. Solution depth: ${s.depth}.`;
      } else if (s.kind === KIND.CUTOFF) {
        what = `Depth ${s.depth} equals the limit l = ${limit}, so this node is <strong>not expanded</strong> (cutoff).`;
      } else {
        const pushed = s.children.filter(c => c.status === 'pushed').length;
        const dropped = s.children.length - pushed;
        what = `<strong>Expanded</strong>: ${s.children.length} successor${s.children.length === 1 ? '' : 's'} generated, ${pushed} pushed on the stack` +
               (dropped ? `, ${dropped} discarded as repeats.` : '.');
      }
      el.stepDesc.innerHTML = `${how} ${what}` + (finalMiss ? ' <strong>The search has ended and the goal was not found.</strong>' : '');
    }

    setGauge(s.depth);

    // numeric stats (a number briefly highlights when it changes)
    const set = (id, v) => {
      const node = el[id];
      if (node.textContent === String(v)) return;
      node.textContent = v;
      node.classList.add('bump');
      setTimeout(() => node.classList.remove('bump'), 160);
    };
    set('stGen', n(s.generated));
    set('stExp', n(s.expanded));
    set('stDepth', s.depth);
    set('stCost', s.depth);
    set('stCut', n(s.cutoffs));
    set('stPruned', n(s.pruned));
    set('stFront', n(s.frontierSize));
    set('stExplored', n(i + 1));

    renderSuccessors(s);
  }

  function setGauge(depth) {
    el.gaugeText.textContent = `${depth} / ${limit}`;
    el.gaugeFill.style.width = (limit === 0 ? 100 : Math.min(100, (depth / limit) * 100)) + '%';
    el.gaugeFill.classList.toggle('at-limit', depth >= limit);
  }

  function renderSuccessors(s) {
    el.successors.innerHTML = '';
    if (s.kind !== KIND.EXPAND) {
      el.successors.innerHTML = s.kind === KIND.GOAL
        ? '<span class="muted">Goal node: nothing to expand.</span>'
        : `<span class="muted">This node is at the depth limit (l = ${limit}), so no successors are generated.</span>`;
      return;
    }
    s.children.forEach(c => {
      const card = document.createElement('div');
      card.className = 'succ ' + c.status;
      card.title = c.status === 'pushed' ? 'Pushed onto the stack' : 'Discarded: already expanded at an equal or shallower depth';
      card.appendChild(miniBoard(c.state, { size: 'sm', goal, moved: s.state.indexOf(0) }));
      const mv = document.createElement('div');
      mv.className = 'succ-move';
      mv.textContent = `${ARROW[c.move]} ${NAME[c.move]}`;
      card.appendChild(mv);
      const chip = document.createElement('span');
      chip.className = 'chip-status ' + c.status;
      chip.textContent = c.status === 'pushed' ? 'pushed' : 'repeat, discarded';
      card.appendChild(chip);
      el.successors.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------
     render: one step of the solution playback
     --------------------------------------------------------------- */
  function renderSolutionStep(k, animate) {
    const sol = result.solution;
    const last = sol.length - 1;
    const cur = sol[k];
    const movedTile = k > 0 ? cur.state[sol[k - 1].state.indexOf(0)] : null;

    board.set(cur.state, { animate, goal, movedTile: animate ? movedTile : null, flag: k === last ? 'solved' : '' });
    el.viewBadge.textContent = k === last ? 'Goal reached' : 'Solution path';
    el.viewBadge.className = 'badge-soft ' + (k === last ? 'goal' : 'expand');
    el.stepTitle.textContent = `Step ${k} / ${last}  \u00B7  solution`;

    if (k === 0) {
      el.stepDesc.innerHTML = 'The <strong>initial state</strong>. Press Resume or Next to follow the solution found by DLS.';
    } else {
      el.stepDesc.innerHTML = `Blank moves <strong>${ARROW[cur.move]} ${NAME[cur.move]}</strong>, so tile <strong>${movedTile}</strong> slides ${TILE_DIR[cur.move]} into the gap.` +
        (k === last ? ' <strong>Goal state reached.</strong>' : '');
    }

    setGauge(k);
    el.stDepth.textContent = k;
    el.stCost.textContent = k;
    el.solutionStrip.querySelectorAll('.sol-step').forEach(card => {
      const active = Number(card.dataset.k) === k;
      card.classList.toggle('active', active);
      if (active && playing) card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  /* ---------------------------------------------------------------
     result banner: an always-visible "did the search work?" indicator
     --------------------------------------------------------------- */
  function updateBanner() {
    const b = el.resultBanner;
    if (!result) { b.hidden = true; b.innerHTML = ''; bannerKey = ''; return; }
    b.hidden = false;

    const finished = mode === 'solution' || index >= trace.length - 1;
    const key = finished ? 'done:' + result.status : (playing ? 'run' : 'paused');

    if (key !== bannerKey) {
      const wasRunning = bannerKey === 'run' || bannerKey === 'paused';
      bannerKey = key;
      if (!finished) {
        b.className = 'result-banner run';
        b.innerHTML =
          `<span class="rb-icon">${playing ? '<span class="spinner"></span>' : '\u23F8'}</span>` +
          `<div class="rb-text"><h3>${playing ? 'Searching\u2026' : 'Search paused'}</h3>` +
          '<p>Replaying the search, step <span class="rb-progress"></span>. The verdict appears here when the search ends.</p></div>' +
          '<button type="button" class="btn btn-sm btn-outline-light" data-act="skip">Skip to result</button>';
      } else {
        const [cls, icon, title, text] = verdictOf(result);
        const nextLimit = Math.min(DLS.MAX_LIMIT, result.limit + 5);
        const retry = result.status === 'cutoff' && result.limit < DLS.MAX_LIMIT
          ? `<button type="button" class="btn btn-sm btn-accent" data-act="retry" data-limit="${nextLimit}">Retry with l = ${nextLimit}</button>` : '';
        b.className = 'result-banner ' + cls;
        b.innerHTML = `<span class="rb-icon">${icon}</span><div class="rb-text"><h3>${title}</h3><p>${text}</p></div>${retry}`;
        if (wasRunning) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    const progress = b.querySelector('.rb-progress');
    if (progress) progress.textContent = `${n(index + 1)} of ${n(trace.length)}`;
  }

  /* [css class, icon, title, message] for a finished run */
  function verdictOf(res) {
    const s = res.stats;
    return {
      solution: ['ok', '\u2714', 'Solution Found',
        `The goal was reached in ${s.moves} move${s.moves === 1 ? '' : 's'} within the depth limit l = ${res.limit}. DLS returns the first goal it meets, so this is not guaranteed to be the shortest path.`],
      cutoff: ['cutoff', '\u26A0', 'Solution Not Found: cutoff',
        `No goal lies within depth ${res.limit}. ${n(s.nodesCutOff)} branch${s.nodesCutOff === 1 ? ' was' : 'es were'} cut off at the limit, so a deeper solution may exist. Increase the depth limit and run again.`],
      failure: ['bad', '\u2716', 'Solution Not Found: failure',
        `Everything reachable within l = ${res.limit} was searched and nothing was cut off, so no solution exists from this state.`],
      aborted: ['bad', '\u23F9', 'Search aborted: node budget reached',
        `Stopped after ${n(s.nodesVisited)} node visits so the browser stays responsive. Try a smaller depth limit.`]
    }[res.status];
  }

  /* ---------------------------------------------------------------
     solution summary and path strip
     --------------------------------------------------------------- */
  function renderSummary(res) {
    const s = res.stats;
    const [cls, icon, title, text] = verdictOf(res);
    const metric = (label, value, small) =>
      `<div class="metric"><div class="k">${label}</div><div class="v">${value}${small ? ` <small>${small}</small>` : ''}</div></div>`;

    el.summary.innerHTML =
      `<div class="verdict ${cls}"><span class="icon">${icon}</span><div><h3>${title}</h3><p>${text}</p></div></div>` +
      '<div class="metric-grid">' +
        metric('Solution', res.found ? 'Found' : 'Not found') +
        metric('Total moves', res.found ? s.moves : '-') +
        metric('Nodes generated', n(s.nodesGenerated)) +
        metric('Nodes expanded', n(s.nodesExpanded)) +
        metric('Max search depth', s.maxDepth, `of l = ${res.limit}`) +
        metric('Execution time', fmtMs(s.timeMs)) +
        metric('Path cost', res.found ? s.pathCost : '-', res.found ? '(unit steps)' : '') +
        metric('Memory (approx.)', s.memoryLabel, fmtKB(s.memoryKB)) +
        metric('Cut off at limit', n(s.nodesCutOff)) +
        metric('Duplicates pruned', n(s.duplicatesPruned)) +
        metric('Peak frontier', n(s.peakFrontier)) +
      '</div>';
  }

  function buildSolutionStrip(res) {
    el.solutionStrip.innerHTML = '';
    el.solutionPathWrap.hidden = !res.found;
    if (!res.found) return;

    res.solution.forEach((step, k) => {
      if (k > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'sol-arrow';
        arrow.textContent = '\u2192';
        el.solutionStrip.appendChild(arrow);
      }
      const card = document.createElement('div');
      card.className = 'sol-step';
      card.dataset.k = k;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Show solution step ${k}`);

      const label = document.createElement('div');
      label.className = 'lbl';
      label.textContent = 'Step ' + k;
      card.appendChild(label);
      card.appendChild(miniBoard(step.state, { size: 'sm', goal }));
      if (step.move !== null) {
        const mv = document.createElement('div');
        mv.className = 'mv';
        mv.textContent = ARROW[step.move] + ' ' + NAME[step.move];
        card.appendChild(mv);
      }

      const go = () => { pause(); if (mode !== 'solution') setMode('solution'); show(k, false); };
      card.addEventListener('click', go);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      el.solutionStrip.appendChild(card);
    });
  }

  return {
    init, setPuzzle, setLimit, setResult, clear: () => clear(),
    play, pause: () => pause(), resume: play, next, prev, end, scrubTo, setMode, setSpeed,
    set onRetry(fn) { retryCb = fn; },
    get playing() { return playing; }, get hasResult() { return !!result; },
    fillMini
  };
})();
