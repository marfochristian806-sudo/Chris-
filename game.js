'use strict';

/* ============================================================================
   STACK TOWER
   ---------------------------------------------------------------------------
   A Tetris-lite puzzle whose entire game state is built on the Stack ADT.

     · each board column  -> one Stack (LIFO)
     · placing a block    -> stack.push()
     · clearing a match   -> repeated stack.pop() from the top
     · reading the colour -> stack.peek()
     · undo               -> a second "history" stack of state snapshots
     · losing             -> stack overflow (size + piece > capacity)
   ========================================================================== */

/* ------------------------------------------------------------------ Stack ADT */
class Stack {
  constructor(){ this.items = []; }
  push(value){ this.items.push(value); return value; }
  pop(){ return this.items.length ? this.items.pop() : undefined; }
  peek(){ return this.items.length ? this.items[this.items.length - 1] : undefined; }
  isEmpty(){ return this.items.length === 0; }
  size(){ return this.items.length; }
  toArray(){ return this.items.slice(); }
  static fromArray(arr){ const s = new Stack(); s.items = arr.slice(); return s; }
}

/* ------------------------------------------------------------------ constants */
const COLS = 6;              // number of stacks on the board
const ROWS = 9;              // capacity of each stack
const HEAD = 1;              // visual headroom row above the capacity line
const TOTAL = ROWS + HEAD;
const CELL  = 58;
const PAD   = 14;
const W = COLS * CELL + PAD * 2;   // 376
const H = TOTAL * CELL + PAD * 2;  // 608
const LINE_Y = PAD + CELL;         // y of the capacity line (top of playable area)

const DROP_MS = 230;
const POP_MS  = 300;
const DIE_MS  = 700;

const COLORS = [
  { name:'CORAL',  base:'#ff5d73', light:'#ff93a3' },
  { name:'SKY',    base:'#4cc9f0', light:'#96e3ff' },
  { name:'GOLD',   base:'#ffd166', light:'#ffe8a8' },
  { name:'MINT',   base:'#06d6a0', light:'#59f2cd' },
  { name:'VIOLET', base:'#b388ff', light:'#d3bcff' },
  { name:'AMBER',  base:'#ff9f1c', light:'#ffc470' }
];

/* ------------------------------------------------------------------ game state */
const state = {
  phase: 'ready',            // ready | idle | dropping | popping | dying | paused | over
  stacks: [],
  cursor: Math.floor(COLS / 2),
  current: null,
  next: null,
  history: [],               // <-- the undo stack
  log: [],
  score: 0,
  best: Number(localStorage.getItem('stacktower.best') || 0),
  combo: 1,
  level: 1,
  activeColors: 4,
  colorCounts: [0,0,0,0,0,0],
  anim: null,                // active drop animation
  popCol: -1, popCount: 0, popColor: 0, popStart: 0,
  dieAt: 0, flashCol: -1, reason: '',
  floaters: []
};

/* ------------------------------------------------------------------ DOM */
const $ = (sel) => document.querySelector(sel);
const canvas   = $('#board');
const ctx      = canvas.getContext('2d');
const overlay  = $('#overlay');
const elScore  = $('#score'), elBest = $('#best'), elLevel = $('#level'), elCombo = $('#combo');
const elStacks = $('#stacks'), elLog = $('#log'), elNext = $('#nextPiece');
const btnUndo  = $('#btnUndo');

const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width  = W * dpr;
canvas.height = H * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

/* ------------------------------------------------------------------ helpers */
const cellX = (col) => PAD + col * CELL;
const cellY = (row) => PAD + (TOTAL - 1 - row) * CELL;
const nm    = (id) => COLORS[id].name;

function roundRect(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function addLog(kind, text){
  state.log.unshift({ kind, text });
  if (state.log.length > 7) state.log.pop();
}

function recountColors(){
  const counts = [0,0,0,0,0,0];
  for (const st of state.stacks) for (const id of st.items) counts[id]++;
  state.colorCounts = counts;
  state.level = Math.min(3, 1 + Math.floor(state.score / 500));
  state.activeColors = state.level + 3;   // 4 → 5 → 6 colours as you climb
}

function pickColor(){
  let total = 0;
  for (let i = 0; i < state.activeColors; i++) total += state.colorCounts[i];
  if (total > 0 && Math.random() < 0.75){          // bias toward blocks already in play
    let r = Math.random() * total;
    for (let i = 0; i < state.activeColors; i++){
      r -= state.colorCounts[i];
      if (r <= 0) return i;
    }
  }
  return Math.floor(Math.random() * state.activeColors);
}

function makePiece(){
  const len = Math.random() < 0.5 ? 1 : 2;
  const blocks = [];
  for (let i = 0; i < len; i++) blocks.push(pickColor());
  return { blocks };
}

/* counts identical blocks stacked consecutively on top of a column */
function topRun(col){
  const st = state.stacks[col];
  const top = st.peek();
  if (top === undefined) return { color: -1, count: 0 };
  let count = 0;
  for (let i = st.size() - 1; i >= 0 && st.items[i] === top; i--) count++;
  return { color: top, count };
}

/* ------------------------------------------------------------------ game flow */
function initGame(){
  state.stacks = [];
  for (let i = 0; i < COLS; i++) state.stacks.push(new Stack());
  state.score = 0;
  state.combo = 1;
  state.cursor = Math.floor(COLS / 2);
  state.history = [];
  state.log = [];
  state.anim = null;
  state.popCol = -1;
  state.flashCol = -1;
  state.floaters = [];
  state.reason = '';
  recountColors();
  state.current = makePiece();
  state.next = makePiece();
  addLog('sys', `new game — ${COLS} empty stacks, capacity ${ROWS}`);
}

function startGame(){ initGame(); state.phase = 'idle'; updatePanel(); showOverlay(); }
function resetGame(){ initGame(); state.phase = 'idle'; updatePanel(); showOverlay(); }

function snapshot(){
  state.history.push({
    stacks: state.stacks.map(s => s.toArray()),
    current: state.current,
    next: state.next,
    score: state.score
  });
  if (state.history.length > 60) state.history.shift();
}

function undo(){
  if (state.phase !== 'idle' && state.phase !== 'over') return;
  if (!state.history.length){ addLog('sys', 'undo() — history stack is empty'); renderLog(); return; }
  const h = state.history.pop();
  state.stacks = h.stacks.map(Stack.fromArray);
  state.current = h.current;
  state.next = h.next;
  state.score = h.score;
  state.combo = 1;
  state.floaters = [];
  state.anim = null;
  state.popCol = -1;
  recountColors();
  state.phase = 'idle';
  addLog('undo', `undo() — popped snapshot, ${state.history.length} left`);
  updatePanel();
  showOverlay();
}

function drop(){
  if (state.phase !== 'idle') return;
  const col = state.cursor;
  const piece = state.current;
  const st = state.stacks[col];
  const n = piece.blocks.length;

  // ---- stack overflow: the push would exceed the column's capacity -------
  if (st.size() + n > ROWS){
    snapshot();
    state.flashCol = col;
    state.phase = 'dying';
    state.dieAt = performance.now();
    state.reason = `Column ${col + 1} is full: size() = ${st.size()}, ` +
                   `push needs ${n} more slot(s) than the capacity of ${ROWS}.`;
    addLog('err', `push() → STACK OVERFLOW on S${col + 1}`);
    updatePanel();
    showOverlay();
    return;
  }

  // ---- normal push -------------------------------------------------------
  snapshot();
  const depth = st.size();
  for (const c of piece.blocks) st.push(c);
  state.anim = { col, depth, count: n, start: performance.now(), dur: DROP_MS };
  state.phase = 'dropping';
  addLog('push', `push(${piece.blocks.map(nm).join('+')}) → S${col + 1}  size=${st.size()}`);
  renderLog();
}

function finishDrop(){
  const col = state.anim.col;
  state.anim = null;
  const run = topRun(col);
  addLog('sys', `peek(S${col + 1}) = ${run.count >= 3 ? nm(run.color) + ' ×' + run.count : nm(run.color)}`);
  tryClear(col);
}

/* decide whether the top of a column should pop */
function tryClear(col){
  const run = topRun(col);
  if (run.count >= 3){
    state.popCol = col;
    state.popCount = run.count;
    state.popColor = run.color;
    state.popStart = performance.now();
    state.phase = 'popping';
  } else {
    endMove();
  }
}

function finishPop(){
  const col = state.popCol, n = state.popCount, color = state.popColor;
  const st = state.stacks[col];
  const bottomRow = st.size() - n;
  const pts = n * 10 * state.combo;

  for (let i = 0; i < n; i++) st.pop();

  state.score += pts;
  if (state.score > state.best){
    state.best = state.score;
    localStorage.setItem('stacktower.best', String(state.best));
  }
  addLog('pop', `pop() ×${n} ${nm(color)}  +${pts}${state.combo > 1 ? `  (combo ×${state.combo})` : ''}`);
  state.floaters.push({
    text: `+${pts}`,
    x: cellX(col) + CELL / 2,
    y: cellY(bottomRow) + CELL / 2,
    t0: performance.now(),
    dur: 900
  });
  state.combo++;                                  // cascade multiplier for the next pop
  recountColors();
  updatePanel();
  tryClear(col);                                  // cascading pops on the same stack
}

function endMove(){
  state.combo = 1;
  state.current = state.next;
  state.next = makePiece();
  state.phase = 'idle';
  recountColors();

  const n = state.current.blocks.length;
  if (state.stacks.every(s => s.size() + n > ROWS)){
    state.flashCol = -1;
    state.phase = 'dying';
    state.dieAt = performance.now();
    state.reason = 'No stack has room left for the next block — every column would overflow.';
    addLog('err', 'no stack can accept the next block → game over');
  }
  updatePanel();
  showOverlay();
}

function togglePause(){
  if (state.phase === 'idle'){ state.phase = 'paused'; }
  else if (state.phase === 'paused'){ state.phase = 'idle'; }
  else return;
  showOverlay();
}

function moveCursor(delta){
  state.cursor = (state.cursor + delta + COLS) % COLS;
}

/* ------------------------------------------------------------------ overlay */
function showOverlay(){
  const visible = state.phase === 'ready' || state.phase === 'paused' || state.phase === 'over';
  overlay.classList.toggle('is-hidden', !visible);
  document.querySelectorAll('.ov-card').forEach(c => c.classList.add('is-hidden'));
  if (!visible) return;
  const key = state.phase === 'ready' ? 'start' : state.phase === 'paused' ? 'pause' : 'over';
  const card = document.querySelector(`.ov-card[data-ov="${key}"]`);
  if (card) card.classList.remove('is-hidden');
  if (state.phase === 'over'){
    $('#overScore').textContent = state.score;
    $('#overBest').textContent = state.best;
    $('#overReason').textContent = state.reason || 'The stack grew past its capacity.';
    $('#btnUndoOv').disabled = state.history.length === 0;
  }
}

/* ------------------------------------------------------------------ panel UI */
function renderNext(){
  if (!state.next){ elNext.innerHTML = '<span class="empty">—</span>'; return; }
  elNext.innerHTML = state.next.blocks
    .map(b => `<div class="chip" style="--c:${COLORS[b].base}"></div>`).join('');
}

function renderStacks(){
  let html = '';
  for (let c = 0; c < COLS; c++){
    const items = state.stacks[c].toArray();
    html += `<div class="stx"><div class="stx-h"><span>S${c + 1}</span><b>${items.length}</b></div><div class="stx-body">`;
    if (!items.length){
      html += `<div class="empty">empty</div>`;
    } else {
      html += `<div class="stx-top">▲ TOP</div>`;
      for (let i = items.length - 1; i >= 0; i--){
        html += `<div class="chip" style="--c:${COLORS[items[i]].base}"></div>`;
      }
      html += `<div class="stx-base">bottom</div>`;
    }
    html += `</div></div>`;
  }
  elStacks.innerHTML = html;
}

function renderLog(){
  elLog.innerHTML = state.log
    .map(e => `<li class="k-${e.kind}">${e.text}</li>`).join('');
}

function updatePanel(){
  elScore.textContent = state.score;
  elBest.textContent = state.best;
  elLevel.textContent = state.level;
  elCombo.textContent = '×' + state.combo;
  renderNext();
  renderStacks();
  renderLog();
  btnUndo.disabled = !(state.phase === 'idle' || state.phase === 'over') || !state.history.length;
}

/* ------------------------------------------------------------------ drawing */
function drawBlock(x, y, colorId, alpha, scale){
  const c = COLORS[colorId];
  const s = CELL - 8;
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  if (scale && scale !== 1){
    const cx = x + CELL / 2, cy = y + CELL / 2;
    ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
  }
  const g = ctx.createLinearGradient(x, y, x, y + CELL);
  g.addColorStop(0, c.light);
  g.addColorStop(1, c.base);
  roundRect(x + 4, y + 4, s, s, 10);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.30)';
  roundRect(x + 11, y + 9, s - 22, 6, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.22)';
  ctx.lineWidth = 1;
  roundRect(x + 4.5, y + 4.5, s - 1, s - 1, 10);
  ctx.stroke();
  ctx.restore();
}

function drawBoard(now){
  // playfield background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1428');
  bg.addColorStop(1, '#080d1c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // cursor column highlight
  const st = state.stacks[state.cursor];
  const piece = state.current;
  const fits = st && piece ? st.size() + piece.blocks.length <= ROWS : true;
  ctx.fillStyle = fits ? 'rgba(255,255,255,.055)' : 'rgba(255,93,115,.13)';
  ctx.fillRect(cellX(state.cursor), LINE_Y, CELL, ROWS * CELL);

  // faint cell grid
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++){
    const y = LINE_Y + r * CELL + 0.5;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++){
    const x = PAD + c * CELL + 0.5;
    ctx.beginPath(); ctx.moveTo(x, LINE_Y); ctx.lineTo(x, LINE_Y + ROWS * CELL); ctx.stroke();
  }

  // capacity limit line
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = 'rgba(255,93,115,.8)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, LINE_Y - 1); ctx.lineTo(W - PAD, LINE_Y - 1); ctx.stroke();
  ctx.restore();

  // cursor marker (triangle in the headroom)
  const cx = cellX(state.cursor) + CELL / 2;
  ctx.fillStyle = fits ? '#5eead4' : '#ff5d73';
  ctx.beginPath();
  ctx.moveTo(cx - 8, LINE_Y - 17);
  ctx.lineTo(cx + 8, LINE_Y - 17);
  ctx.lineTo(cx, LINE_Y - 5);
  ctx.closePath();
  ctx.fill();

  // blocks
  const anim = state.anim;
  for (let c = 0; c < COLS; c++){
    const col = state.stacks[c];
    for (let r = 0; r < col.size(); r++){
      let y = cellY(r);
      let alpha = 1, scale = 1;

      if (anim && anim.col === c && r >= anim.depth && r < anim.depth + anim.count){
        const p = Math.min(1, (now - anim.start) / anim.dur);
        const eased = p * p;                                   // gravity-style acceleration
        const targetY = cellY(anim.depth);
        const startY = -CELL;
        y = startY + (targetY - startY) * eased;
      }
      if (state.phase === 'popping' && c === state.popCol &&
          r >= col.size() - state.popCount){
        const p = Math.min(1, (now - state.popStart) / POP_MS);
        alpha = 1 - p * p;
        scale = 1 + p * 0.45;
      }
      drawBlock(cellX(c), y, col.items[r], alpha, scale);
    }
  }

  // ghost preview of where the piece would land
  if (state.phase === 'idle' && piece){
    const depth = st.size();
    for (let i = 0; i < piece.blocks.length; i++){
      drawBlock(cellX(state.cursor), cellY(depth + i), piece.blocks[i], 0.3, 1);
    }
  }

  // overflow flash
  if (state.phase === 'dying' && state.flashCol >= 0){
    const pulse = 0.22 + 0.16 * Math.sin(now / 60);
    ctx.fillStyle = `rgba(255,93,115,${pulse})`;
    ctx.fillRect(cellX(state.flashCol), LINE_Y, CELL, ROWS * CELL);
    ctx.strokeStyle = '#ff5d73';
    ctx.lineWidth = 3;
    ctx.strokeRect(cellX(state.flashCol) + 1.5, LINE_Y + 1.5, CELL - 3, ROWS * CELL - 3);
  }

  // floating score popups
  for (const f of state.floaters){
    const p = (now - f.t0) / f.dur;
    if (p >= 1) continue;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.font = '700 17px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 6;
    ctx.fillText(f.text, f.x, f.y - p * 46);
    ctx.restore();
  }
  state.floaters = state.floaters.filter(f => now - f.t0 < f.dur);

  // frame border
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD - 1, LINE_Y - 1, COLS * CELL + 2, ROWS * CELL + 2);
}

/* ------------------------------------------------------------------ main loop */
function update(now){
  if (state.phase === 'dropping' && state.anim && now - state.anim.start >= state.anim.dur){
    finishDrop();
  } else if (state.phase === 'popping' && now - state.popStart >= POP_MS){
    finishPop();
  } else if (state.phase === 'dying' && now - state.dieAt >= DIE_MS){
    state.phase = 'over';
    showOverlay();
    updatePanel();
  }
}

function frame(now){
  update(now);
  drawBoard(now);
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ input */
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft','ArrowRight','ArrowDown','ArrowUp',' '].includes(k)) e.preventDefault();

  if (state.phase === 'ready'){
    if (k === 'Enter' || k === ' ') startGame();
    return;
  }
  if (state.phase === 'over'){
    if (k === 'u' || k === 'U') undo();
    else if (k === 'Enter' || k === 'r' || k === 'R') resetGame();
    return;
  }
  if (k >= '1' && k <= '6'){ state.cursor = Number(k) - 1; return; }

  switch (k){
    case 'ArrowLeft':  moveCursor(-1); break;
    case 'ArrowRight': moveCursor(1);  break;
    case 'ArrowDown': case ' ': case 'Enter': drop(); break;
    case 'p': case 'P': togglePause(); break;
    case 'u': case 'U': case 'z': case 'Z': undo(); break;
    case 'r': case 'R': resetGame(); break;
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.phase === 'ready'){ startGame(); return; }
  if (state.phase === 'over'){ resetGame(); return; }
  if (state.phase !== 'idle') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (W / rect.width);
  const col = Math.floor((x - PAD) / CELL);
  if (col < 0 || col >= COLS) return;
  state.cursor = col;
  drop();
});

/* ------------------------------------------------------------------ buttons */
$('#btnStart').addEventListener('click', startGame);
$('#btnResume').addEventListener('click', togglePause);
$('#btnPause').addEventListener('click', togglePause);
$('#btnRestart').addEventListener('click', resetGame);
$('#btnRestartP').addEventListener('click', resetGame);
$('#btnRestart2').addEventListener('click', resetGame);
$('#btnUndo').addEventListener('click', undo);
$('#btnUndoOv').addEventListener('click', undo);

/* ------------------------------------------------------------------ boot */
initGame();
state.phase = 'ready';
updatePanel();
showOverlay();
requestAnimationFrame(frame);
