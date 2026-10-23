/* ===================================================================
   main.js: wiring (routing, puzzle input, running DLS, controls)
   =================================================================== */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PAGES = ['home', 'puzzle', 'algorithm'];
  const TITLES = {
    home: '8-Puzzle Solver \u00B7 Depth Limited Search',
    puzzle: 'Puzzle \u00B7 DLS Solver',
    algorithm: 'Algorithm Info \u00B7 DLS Solver'
  };
  const RUN_LABEL = '\u25B6\u00A0 Run';

  let current = { initial: Puzzle.DEFAULT_INITIAL.slice(), goal: Puzzle.DEFAULT_GOAL.slice() };

  /* ---------------------------------------------------------------
     Home page
     --------------------------------------------------------------- */
  function fillConfig() {
    const text = {
      cfgCourse: CONFIG.course, cfgCode: CONFIG.courseCode, cfgSlot: CONFIG.slot,
      cfgSemester: CONFIG.semester, cfgFaculty: CONFIG.faculty, cfgTitle: CONFIG.assignmentTitle,
      cfgName: CONFIG.studentName, cfgReg: CONFIG.registrationNumber, cfgAlgo: CONFIG.algorithm
    };
    Object.keys(text).forEach(id => { $(id).textContent = text[id]; });
  }

  /* faint grid behind the hero where random cells light up */
  function initHeroGrid() {
    const bg = $('heroBg');
    const cells = [];
    for (let i = 0; i < 12 * 8; i++) { const c = document.createElement('i'); bg.appendChild(c); cells.push(c); }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setInterval(() => {
      for (let k = 0; k < 4; k++) cells[Math.floor(Math.random() * cells.length)].classList.toggle('lit');
    }, 600);
  }

  /* ---------------------------------------------------------------
     routing (URL hash, so it works on GitHub Pages with no server)
     --------------------------------------------------------------- */
  function route() {
    let page = (location.hash || '#home').slice(1);
    if (!PAGES.includes(page)) page = 'home';

    PAGES.forEach(p => { $('page-' + p).hidden = p !== page; });
    document.querySelectorAll('[data-route]').forEach(a => {
      const on = a.dataset.route === page;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    const menu = $('navMenu');
    if (menu.classList.contains('show')) bootstrap.Collapse.getOrCreateInstance(menu).hide();
    if (page !== 'puzzle') Viz.pause();
    window.scrollTo({ top: 0 });
    document.title = TITLES[page];
  }

  /* ---------------------------------------------------------------
     puzzle input
     --------------------------------------------------------------- */
  const rowInputs = which => document.querySelectorAll(`[data-state-input="${which}"] .row-input`);
  const rowsOf = which => Array.from(rowInputs(which)).map(i => i.value);

  function writeRows(which, state) {
    const rows = Puzzle.format(state).split('/');
    rowInputs(which).forEach((input, i) => { input.value = rows[i]; });
    refreshPreview(which);
  }

  function refreshPreview(which) {
    const preview = $(which === 'initial' ? 'previewInitial' : 'previewGoal');
    const parsed = Puzzle.parseRows(rowsOf(which));
    preview.style.opacity = parsed.error ? '.35' : '1';
    if (!parsed.error) Viz.fillMini(preview, parsed.state);
    rowInputs(which).forEach(input => {
      const row = input.value.replace(/\s+/g, '');
      input.classList.toggle('invalid', row.length > 0 && !/^[1-8_0.\-]{3}$/.test(row));
    });
    return parsed;
  }

  function note(kind, html) { $('inputMessage').innerHTML = `<div class="note ${kind}">${html}</div>`; }

  function showSolvability() {
    const ok = Puzzle.isSolvable(current.initial, current.goal);
    if (ok) note('ok', '\u2714 This puzzle is <strong>solvable</strong>: the goal is reachable from the initial state.');
    else note('bad', '\u2716 This puzzle is <strong>not solvable</strong>: the tile order has the wrong inversion parity, so no sequence of moves reaches the goal. Change a state or generate a random puzzle.');
    return ok;
  }

  function applyPuzzle(initial, goal) {
    current = { initial: initial.slice(), goal: goal.slice() };
    Viz.setPuzzle(current.initial, current.goal);
    Viz.clear();
    showSolvability();
  }

  function applyManual() {
    const a = Puzzle.parseRows(rowsOf('initial')), b = Puzzle.parseRows(rowsOf('goal'));
    const errors = [];
    if (a.error) errors.push('<strong>Initial state:</strong> ' + esc(a.error));
    if (b.error) errors.push('<strong>Goal state:</strong> ' + esc(b.error));
    if (errors.length) { note('bad', errors.join('<br>')); return; }
    $('randomNote').textContent = '';
    applyPuzzle(a.state, b.state);
  }

  function generateRandom() {
    const g = Puzzle.parseRows(rowsOf('goal'));
    const goal = g.error ? current.goal : g.state;
    const { state, scrambleMoves } = Puzzle.generateRandomSolvable(goal);
    writeRows('initial', state);
    writeRows('goal', goal);
    applyPuzzle(state, goal);
    $('randomNote').textContent = `Scrambled with ${scrambleMoves} legal moves, so a solution exists at depth ${scrambleMoves} or less. Try a depth limit of at least that much, or a smaller one to see a cutoff.`;
  }

  function loadExample() {
    writeRows('initial', Puzzle.DEFAULT_INITIAL);
    writeRows('goal', Puzzle.DEFAULT_GOAL);
    $('randomNote').textContent = '';
    setLimit(5);
    applyPuzzle(Puzzle.DEFAULT_INITIAL, Puzzle.DEFAULT_GOAL);
  }

  /* ---------------------------------------------------------------
     depth limit
     --------------------------------------------------------------- */
  function readLimit() {
    const v = Number($('limitInput').value);
    return Number.isInteger(v) && v >= 0 && v <= DLS.MAX_LIMIT ? v : null;
  }

  /* keeps the slider, the number box, the badge and the gauge in step */
  function syncLimit(v) {
    $('limitRange').value = Math.min(v, Number($('limitRange').max));
    $('limitBadge').textContent = 'l = ' + v;
    Viz.setLimit(v);
  }

  function setLimit(v) {
    $('limitInput').value = v;
    syncLimit(v);
  }

  /* ---------------------------------------------------------------
     run
     --------------------------------------------------------------- */
  function run() {
    const limit = readLimit();
    if (limit === null) { note('bad', `The depth limit must be a whole number between 0 and ${DLS.MAX_LIMIT}.`); return; }
    if (!showSolvability()) return;

    const btn = $('runBtn');
    btn.disabled = true;
    btn.textContent = 'Searching\u2026';
    Viz.pause();

    setTimeout(() => {
      try {
        // 1) a run that records nothing, so the reported time is the search alone
        const lean = DLS.solve(current.initial, current.goal, { limit });
        // 2) the identical (deterministic) run, recorded for the animation
        const recorded = DLS.solve(current.initial, current.goal, { limit, record: true });
        recorded.stats.timeMs = lean.stats.timeMs;
        Viz.setResult(recorded);
      } catch (err) {
        note('bad', 'The search ran out of memory. Try a smaller depth limit.');
        console.error(err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = RUN_LABEL;
      }
    }, 30);
  }

  /* ---------------------------------------------------------------
     Algorithm Info page
     --------------------------------------------------------------- */
  function renderAlgoInfo() {
    const d = ALGO_INFO;
    const items = arr => arr.map(t => `<li>${esc(t)}</li>`).join('');
    $('algoInfo').innerHTML = `
      <div class="info-hero">
        <span class="tag">${esc(d.category)}</span>
        <h2>${esc(d.name)}</h2>
        <p class="mb-0">${esc(d.description)}</p>
      </div>

      <div class="row g-3 mb-4">
        ${d.properties.map(p => `
          <div class="col-sm-6 col-xl-3"><div class="prop-card">
            <div class="k">${esc(p.label)}</div><div class="v">${esc(p.value)}</div><p class="d">${esc(p.detail)}</p>
          </div></div>`).join('')}
      </div>

      <div class="row g-4">
        <div class="col-lg-6"><div class="panel h-100 mb-0">
          <h2 class="panel-title">Working principle</h2>
          <ol class="info-steps">${items(d.principle)}</ol>
        </div></div>
        <div class="col-lg-6"><div class="panel h-100 mb-0">
          <h2 class="panel-title">Pseudocode </h2>
          <pre class="pseudo">${esc(d.pseudocode)}</pre>
        </div></div>
        <div class="col-lg-6"><div class="panel h-100 mb-0">
          <h2 class="panel-title">Advantages</h2>
          <ul class="info-list">${items(d.advantages)}</ul>
        </div></div>
        <div class="col-lg-6"><div class="panel h-100 mb-0">
          <h2 class="panel-title">Limitations</h2>
          <ul class="info-list">${items(d.limitations)}</ul>
        </div></div>
        <div class="col-12"><div class="panel mb-0">
          <h2 class="panel-title">Implementation</h2>
          <ul class="info-list mb-0">${items(d.implementation)}</ul>
        </div></div>
        <div class="col-12"><div class="panel mb-0">
          <h2 class="panel-title">References</h2>
          <ol class="refs mb-0">${d.references.map(r => `<li>${r}</li>`).join('')}</ol>
        </div></div>
      </div>`;
  }

  /* ---------------------------------------------------------------
     wiring
     --------------------------------------------------------------- */
  function wire() {
    // puzzle input
    ['initial', 'goal'].forEach(which => rowInputs(which).forEach(input => {
      input.addEventListener('input', () => refreshPreview(which));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') applyManual(); });
    }));
    $('applyBtn').addEventListener('click', applyManual);
    $('exampleBtn').addEventListener('click', loadExample);
    $('randomBtn').addEventListener('click', generateRandom);

    // depth limit
    $('limitRange').addEventListener('input', () => setLimit(Number($('limitRange').value)));
    $('limitInput').addEventListener('input', () => { const v = readLimit(); if (v !== null) syncLimit(v); });

    // run and playback controls
    $('runBtn').addEventListener('click', run);
    $('pauseBtn').addEventListener('click', () => Viz.pause());
    $('resumeBtn').addEventListener('click', () => Viz.resume());
    $('prevBtn').addEventListener('click', () => Viz.prev());
    $('nextBtn').addEventListener('click', () => Viz.next());
    $('endBtn').addEventListener('click', () => Viz.end());
    $('resetBtn').addEventListener('click', () => { Viz.clear(); showSolvability(); });
    $('speedRange').addEventListener('input', () => Viz.setSpeed(Number($('speedRange').value)));
    $('scrub').addEventListener('input', () => Viz.scrubTo(Number($('scrub').value)));
    document.querySelectorAll('input[name="viewMode"]').forEach(radio =>
      radio.addEventListener('change', () => { Viz.pause(); Viz.setMode(radio.value); }));

    // "Retry with a larger limit" button in the result banner
    Viz.onRetry = limit => { setLimit(limit); run(); };

    // keyboard shortcuts on the puzzle page
    document.addEventListener('keydown', e => {
      if ($('page-puzzle').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.matches('input[type="text"], input[type="number"], select, textarea, summary')) return;
      if (e.key === ' ' && !t.matches('button, [role="button"]')) {
        e.preventDefault();
        if (Viz.hasResult) { if (Viz.playing) Viz.pause(); else Viz.resume(); }
      } else if (!t.matches('input[type="range"]')) {
        if (e.key === 'ArrowRight') Viz.next();
        else if (e.key === 'ArrowLeft') Viz.prev();
      }
    });

    window.addEventListener('hashchange', route);
  }

  /* ---------------------------------------------------------------
     start
     --------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', () => {
    fillConfig();
    initHeroGrid();
    Viz.init();
    refreshPreview('initial');
    refreshPreview('goal');
    setLimit(5);
    applyPuzzle(current.initial, current.goal);
    renderAlgoInfo();
    wire();
    route();
  });
})();
