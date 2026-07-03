/* ==========================================================================
   SUDOKU — SCRIPT
   --------------------------------------------------------------------------
   1.  State
   2.  Core Grid Helpers
   3.  Solver (backtracking)
   4.  Generator (full grid + dig holes with uniqueness check)
   5.  Rendering
   6.  Interaction — Cell Select, Numpad, Keyboard
   7.  Actions — Generate / Solve / Check / Hint / Clear
   8.  Init
   ========================================================================== */


/* 1. State
   ========================================================================== */
const state = {
  given: Array(81).fill(0),      // the puzzle as generated/given (0 = blank)
  current: Array(81).fill(0),    // current values on the board (given + user entries)
  selected: null,                // index 0-80 of selected cell
  solution: null,                // cached solution for the current puzzle
  difficulty: null,
  entryMode: false,              // true while the player is typing in their own puzzle
};

const DIFFICULTY_CLUES = {
  easy: 40,    // ~40 given clues
  medium: 32,
  hard: 27,
  expert: 23,
};


/* 2. Core Grid Helpers
   ========================================================================== */
function rowOf(i) { return Math.floor(i / 9); }
function colOf(i) { return i % 9; }
function boxOf(i) {
  const r = rowOf(i), c = colOf(i);
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

function peersOf(i) {
  const r = rowOf(i), c = colOf(i);
  const peers = new Set();
  for (let k = 0; k < 9; k++) {
    peers.add(r * 9 + k);            // row
    peers.add(k * 9 + c);            // column
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      peers.add((br + dr) * 9 + (bc + dc));   // box
    }
  }
  peers.delete(i);
  return peers;
}

function isValidPlacement(grid, i, val) {
  if (val === 0) return true;
  const r = rowOf(i), c = colOf(i);
  for (let k = 0; k < 9; k++) {
    if (k !== c && grid[r * 9 + k] === val) return false;       // row
    if (k !== r && grid[k * 9 + c] === val) return false;       // column
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const idx = (br + dr) * 9 + (bc + dc);
      if (idx !== i && grid[idx] === val) return false;          // box
    }
  }
  return true;
}

function cloneGrid(grid) { return grid.slice(); }


/* 3. Solver (backtracking with MRV heuristic)
   ========================================================================== */
function findEmptyCellMRV(grid) {
  // Minimum Remaining Values heuristic: pick the empty cell with fewest
  // legal candidates first — dramatically prunes the search tree.
  let best = -1, bestCount = 10, bestCandidates = null;

  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue;
    const candidates = [];
    for (let v = 1; v <= 9; v++) {
      if (isValidPlacement(grid, i, v)) candidates.push(v);
    }
    if (candidates.length < bestCount) {
      bestCount = candidates.length;
      best = i;
      bestCandidates = candidates;
      if (bestCount === 0) return { index: i, candidates: [] }; // dead end, bail fast
      if (bestCount === 1) break; // can't do better than 1
    }
  }
  return best === -1 ? null : { index: best, candidates: bestCandidates };
}

function hasExistingConflict(grid) {
  // Checks whether any two FILLED cells already violate row/col/box rules.
  // Must run before solving — the MRV search only scans empty cells, so a
  // grid with two pre-filled conflicting digits would otherwise force the
  // solver through a near-exhaustive (and practically endless) search
  // before concluding there's no solution.
  for (let i = 0; i < 81; i++) {
    const val = grid[i];
    if (val === 0) continue;
    const without = grid.slice();
    without[i] = 0;
    if (!isValidPlacement(without, i, val)) return true;
  }
  return false;
}

function solveGrid(grid, { countLimit = 1 } = {}) {
  // Returns { solutions: [...grids found, up to countLimit], count }
  if (hasExistingConflict(grid)) {
    return { solutions: [], count: 0 };
  }

  const results = [];
  const working = cloneGrid(grid);

  function backtrack() {
    if (results.length >= countLimit) return true;

    const next = findEmptyCellMRV(working);
    if (!next) {
      results.push(cloneGrid(working));
      return results.length >= countLimit;
    }
    if (next.candidates.length === 0) return false;

    for (const val of next.candidates) {
      working[next.index] = val;
      if (backtrack()) return true;
      working[next.index] = 0;
    }
    return false;
  }

  backtrack();
  return { solutions: results, count: results.length };
}

function solveSingle(grid) {
  const { solutions } = solveGrid(grid, { countLimit: 1 });
  return solutions[0] || null;
}

function countSolutions(grid, limit = 2) {
  return solveGrid(grid, { countLimit: limit }).count;
}


/* 4. Generator
   ========================================================================== */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateFullSolution() {
  // Fill an empty grid completely using randomized backtracking.
  const grid = Array(81).fill(0);

  function fill(pos) {
    if (pos === 81) return true;
    if (grid[pos] !== 0) return fill(pos + 1);

    for (const val of shuffled([1,2,3,4,5,6,7,8,9])) {
      if (isValidPlacement(grid, pos, val)) {
        grid[pos] = val;
        if (fill(pos + 1)) return true;
        grid[pos] = 0;
      }
    }
    return false;
  }

  fill(0);
  return grid;
}

function generatePuzzle(difficulty) {
  const solution = generateFullSolution();
  const puzzle = cloneGrid(solution);
  const targetClues = DIFFICULTY_CLUES[difficulty] ?? 32;
  const cellsToTry = shuffled([...Array(81).keys()]);

  let clueCount = 81;

  for (const idx of cellsToTry) {
    if (clueCount <= targetClues) break;
    if (puzzle[idx] === 0) continue;

    const backup = puzzle[idx];
    puzzle[idx] = 0;

    // Only keep the removal if the puzzle still has a UNIQUE solution.
    const solCount = countSolutions(puzzle, 2);
    if (solCount !== 1) {
      puzzle[idx] = backup; // revert — removing this cell breaks uniqueness
    } else {
      clueCount--;
    }
  }

  return { puzzle, solution };
}


/* 5. Rendering
   ========================================================================== */
const boardEl = document.getElementById('board');
const statusValueEl = document.getElementById('statusValue');
const difficultyValueEl = document.getElementById('difficultyValue');
const helperTextEl = document.getElementById('helperText');

function buildBoardDOM() {
  boardEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = i;
    cell.dataset.row = rowOf(i);
    cell.dataset.col = colOf(i);
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('tabindex', '0');
    boardEl.appendChild(cell);
  }
}

function renderBoard({ highlightErrors = false } = {}) {
  const cells = boardEl.children;
  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const val = state.current[i];
    const isGiven = state.given[i] !== 0;

    cell.textContent = val === 0 ? '' : val;
    cell.classList.toggle('cell--given', isGiven);
    cell.classList.toggle('cell--user', !isGiven && val !== 0);
    cell.classList.toggle('cell--selected', state.selected === i);
    cell.classList.remove('cell--solved', 'cell--hint'); // cleared on every render; re-applied only by animateSolve/handleHint for the cells they just touched

    const isPeer = state.selected !== null &&
      state.selected !== i &&
      peersOf(state.selected).has(i);
    cell.classList.toggle('cell--peer', isPeer);

    if (highlightErrors) {
      const hasError = val !== 0 && !isValidPlacement(
        state.current.map((v, idx) => idx === i ? 0 : v), i, val
      );
      cell.classList.toggle('cell--error', hasError);
    } else {
      cell.classList.remove('cell--error');
    }
  }
}

function setStatus(text, variant) {
  statusValueEl.textContent = text;
  statusValueEl.classList.remove('status-value--success', 'status-value--error');
  if (variant) statusValueEl.classList.add(`status-value--${variant}`);
}

function setHelper(text) {
  helperTextEl.textContent = text;
}


/* 6. Interaction
   ========================================================================== */
function selectCell(i) {
  if (state.given[i] !== 0) {
    state.selected = i;
    renderBoard();
    return;
  }
  state.selected = i;
  renderBoard();
}

boardEl.addEventListener('click', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  selectCell(Number(cellEl.dataset.index));
});

boardEl.addEventListener('keydown', (e) => {
  const cellEl = e.target.closest('.cell');
  if (!cellEl) return;
  const i = Number(cellEl.dataset.index);

  if (e.key >= '1' && e.key <= '9') {
    enterValue(i, Number(e.key));
  } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    enterValue(i, 0);
  } else if (e.key === 'ArrowRight') moveSelection(i, 0, 1);
  else if (e.key === 'ArrowLeft') moveSelection(i, 0, -1);
  else if (e.key === 'ArrowDown') moveSelection(i, 1, 0);
  else if (e.key === 'ArrowUp') moveSelection(i, -1, 0);
});

function moveSelection(i, dr, dc) {
  const r = Math.min(8, Math.max(0, rowOf(i) + dr));
  const c = Math.min(8, Math.max(0, colOf(i) + dc));
  const next = r * 9 + c;
  selectCell(next);
  boardEl.children[next].focus();
}

const numpadEl = document.getElementById('numpad');
numpadEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.num-btn');
  if (!btn || state.selected === null) return;
  enterValue(state.selected, Number(btn.dataset.num));
});

function enterValue(i, val) {
  if (state.given[i] !== 0) return; // can't overwrite given clues
  state.current[i] = val;

  if (state.entryMode) {
    renderBoard({ highlightErrors: true });
    const conflictCount = Array.from(boardEl.children).filter(c => c.classList.contains('cell--error')).length;
    if (conflictCount > 0) {
      setStatus('Conflict', 'error');
      setHelper('That number repeats in the same row, column, or box \u2014 cells in red won\u2019t be accepted.');
    } else {
      const filled = state.current.filter(v => v !== 0).length;
      setStatus(`Entering \u00b7 ${filled} filled`);
      setHelper('Keep entering your puzzle\u2019s clues, then click \u201cUse this puzzle\u201d when you\u2019re done.');
    }
    return;
  }

  renderBoard();
  setStatus('In progress');
  setHelper('Keep going — use Check any time to see if something\u2019s off.');
}


/* 7. Actions
   ========================================================================== */
const generateBtn = document.getElementById('generateBtn');
const solveBtn = document.getElementById('solveBtn');
const checkBtn = document.getElementById('checkBtn');
const hintBtn = document.getElementById('hintBtn');
const clearBtn = document.getElementById('clearBtn');
const difficultySelect = document.getElementById('difficultySelect');
const myPuzzleBtn = document.getElementById('myPuzzleBtn');
const useThisPuzzleBtn = document.getElementById('useThisPuzzleBtn');
const cancelEntryBtn = document.getElementById('cancelEntryBtn');
const entryModeGroup = document.getElementById('entryModeGroup');
const playModeGroup = document.getElementById('playModeGroup');

function handleGenerate() {
  const difficulty = difficultySelect.value;
  setStatus('Generating\u2026');
  setHelper('Building a puzzle with a single unique solution. This can take a moment on Expert.');

  // Defer so the status text actually paints before the (synchronous) generation work.
  setTimeout(() => {
    const { puzzle, solution } = generatePuzzle(difficulty);
    state.given = cloneGrid(puzzle);
    state.current = cloneGrid(puzzle);
    state.solution = solution;
    state.difficulty = difficulty;
    state.selected = null;

    const clueCount = puzzle.filter(v => v !== 0).length;
    renderBoard();
    setStatus('Ready');
    difficultyValueEl.textContent = `${difficulty[0].toUpperCase()}${difficulty.slice(1)} \u00b7 ${clueCount} clues`;
    setHelper('Click a cell and type a number, or use the keypad below. Givens are shown in orange.');
  }, 30);
}

function handleSolve() {
  const hasGivens = state.given.some(v => v !== 0);

  if (!hasGivens && state.current.every(v => v === 0)) {
    setStatus('Nothing to solve', 'error');
    setHelper('Generate a puzzle first, or enter some numbers of your own.');
    return;
  }

  setStatus('Solving\u2026');
  setTimeout(() => {
    // Always solve from state.current — this respects the player's own
    // entries (including any mistakes) rather than silently discarding them
    // in favor of the cached generator solution.
    const solved = solveSingle(state.current);

    if (!solved) {
      setStatus('No solution', 'error');
      setHelper('That doesn\u2019t lead to a valid solution \u2014 use Check to find the conflicting cell.');
      boardEl.classList.add('board--shake');
      setTimeout(() => boardEl.classList.remove('board--shake'), 400);
      return;
    }

    animateSolve(solved);
  }, 30);
}

function animateSolve(solution) {
  const cellsToFill = [];
  for (let i = 0; i < 81; i++) {
    if (state.current[i] === 0) cellsToFill.push(i);
  }

  let delay = 0;
  cellsToFill.forEach((i, order) => {
    setTimeout(() => {
      state.current[i] = solution[i];
      const cellEl = boardEl.children[i];
      cellEl.textContent = solution[i];
      cellEl.classList.add('cell--solved', 'cell--fill-anim');
      cellEl.addEventListener('animationend', () => {
        cellEl.classList.remove('cell--fill-anim');
      }, { once: true });

      if (order === cellsToFill.length - 1) {
        setStatus('Solved', 'success');
        setHelper('Solved it. Generate a new puzzle whenever you\u2019re ready for another.');
      }
    }, order * 14);
  });

  if (cellsToFill.length === 0) {
    setStatus('Already complete');
  }
}

function handleCheck() {
  const filled = state.current.filter(v => v !== 0).length;
  if (filled === 0) {
    setStatus('Board is empty');
    setHelper('Enter some numbers first, then use Check to validate them.');
    return;
  }

  renderBoard({ highlightErrors: true });
  const hasErrors = Array.from(boardEl.children).some(c => c.classList.contains('cell--error'));
  const isComplete = !state.current.includes(0);

  if (hasErrors) {
    setStatus('Conflicts found', 'error');
    setHelper('Cells in red conflict with another number in the same row, column, or box.');
    boardEl.classList.add('board--shake');
    setTimeout(() => boardEl.classList.remove('board--shake'), 400);
  } else if (isComplete) {
    setStatus('Solved', 'success');
    setHelper('Every cell is filled with no conflicts. Nicely done.');
  } else {
    setStatus('Looking good', 'success');
    setHelper('No conflicts so far. Keep filling in the rest.');
  }
}

function handleHint() {
  const hasGivens = state.given.some(v => v !== 0);
  if (!hasGivens) {
    setStatus('No puzzle loaded', 'error');
    setHelper('Generate a puzzle first \u2014 hints fill in one correct cell at a time.');
    return;
  }

  // Re-solve from the current board (not the cached solution) so a hint
  // never gets offered while the player has an undetected wrong entry —
  // solveSingle will fail fast on any conflict, which we surface honestly.
  const solution = solveSingle(state.current);
  if (!solution) {
    setStatus('No solution', 'error');
    setHelper('One of your entries conflicts with another \u2014 use Check to find it, then try again.');
    return;
  }

  const emptyIdx = [];
  for (let i = 0; i < 81; i++) if (state.current[i] === 0) emptyIdx.push(i);

  if (emptyIdx.length === 0) {
    setStatus('Board is full');
    setHelper('There are no empty cells left to hint.');
    return;
  }

  const target = emptyIdx[Math.floor(Math.random() * emptyIdx.length)];
  state.current[target] = solution[target];
  renderBoard();
  const cellEl = boardEl.children[target];
  cellEl.classList.add('cell--hint', 'cell--fill-anim');
  cellEl.addEventListener('animationend', () => cellEl.classList.remove('cell--fill-anim'), { once: true });

  setStatus('Hint placed');
  setHelper(`Filled in row ${rowOf(target) + 1}, column ${colOf(target) + 1}.`);
}

function handleClear() {
  state.current = cloneGrid(state.given);
  state.selected = null;
  renderBoard();
  setStatus('Cleared');
  setHelper('Your entries were cleared. The original puzzle is back where you started.');
}

function setMode(mode) {
  // mode: 'play' | 'entry'
  state.entryMode = mode === 'entry';
  entryModeGroup.hidden = mode !== 'entry';
  playModeGroup.hidden = mode === 'entry';
  myPuzzleBtn.hidden = mode === 'entry';
  generateBtn.hidden = mode === 'entry';
  difficultySelect.hidden = mode === 'entry';
  document.querySelector('label[for="difficultySelect"]').hidden = mode === 'entry';
}

function handleMyPuzzle() {
  state.given = Array(81).fill(0);
  state.current = Array(81).fill(0);
  state.solution = null;
  state.difficulty = null;
  state.selected = null;

  setMode('entry');
  renderBoard();
  setStatus('Entering puzzle');
  difficultyValueEl.textContent = 'Custom';
  setHelper('Click a cell and type its clue. Leave the rest blank, then click \u201cUse this puzzle.\u201d');
}

function handleUseThisPuzzle() {
  const filled = state.current.filter(v => v !== 0).length;

  if (filled === 0) {
    setStatus('No clues entered', 'error');
    setHelper('Type at least a few numbers in before using this puzzle.');
    return;
  }

  if (hasExistingConflict(state.current)) {
    setStatus('Conflict', 'error');
    renderBoard({ highlightErrors: true });
    setHelper('Fix the cells in red before continuing \u2014 they repeat in a row, column, or box.');
    boardEl.classList.add('board--shake');
    setTimeout(() => boardEl.classList.remove('board--shake'), 400);
    return;
  }

  setStatus('Checking\u2026');
  setTimeout(() => {
    const solutions = solveGrid(state.current, { countLimit: 2 });

    if (solutions.count === 0) {
      setStatus('No solution', 'error');
      setHelper('This puzzle can\u2019t be solved as entered. Double check your clues against the original.');
      boardEl.classList.add('board--shake');
      setTimeout(() => boardEl.classList.remove('board--shake'), 400);
      return;
    }

    // Lock current entries in as givens and switch to play mode.
    state.given = cloneGrid(state.current);
    state.solution = solutions.solutions[0];
    state.selected = null;
    setMode('play');
    renderBoard();

    if (solutions.count > 1) {
      setStatus('Multiple solutions', 'success');
      setHelper('This puzzle has more than one valid solution \u2014 Solve will show one of them, but double-check your clues if you want a unique answer.');
    } else {
      setStatus('Ready');
      setHelper('Your puzzle is locked in. Use Solve, Check, or Hint, or just play it out by hand.');
    }
  }, 30);
}

function handleCancelEntry() {
  setMode('play');
  handleGenerate();
}

generateBtn.addEventListener('click', handleGenerate);
solveBtn.addEventListener('click', handleSolve);
checkBtn.addEventListener('click', handleCheck);
hintBtn.addEventListener('click', handleHint);
clearBtn.addEventListener('click', handleClear);
myPuzzleBtn.addEventListener('click', handleMyPuzzle);
useThisPuzzleBtn.addEventListener('click', handleUseThisPuzzle);
cancelEntryBtn.addEventListener('click', handleCancelEntry);


/* 8. Init
   ========================================================================== */
buildBoardDOM();
renderBoard();
handleGenerate();
