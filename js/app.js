// ─────────────────────────────────────────────
// CONSTANTS & STATE
// ─────────────────────────────────────────────
const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const LOS = H * .62;

let mode = 'select';
let selected = { side: 'offense', id: null };
let players = [], defenders = [], routes = [], blocks = [], motions = [], defRoutes = [];
let ballPath = null, drag = null, drawing = false, drawPts = [];
let anim = false, raf = null;
let currentFormation = 'Shotgun';
let flipped = false;
let historyStack = [], redoStack = [];
let suspendHistory = false;
let coordinatorSide = 'offense';

// ── 2D playback controls ──────────────────────
let animPaused   = false;
let animProgress = 0;      // 0→1
let animSpeed    = 1.0;
let animT0       = 0;      // performance.now() offset for pause/resume
let animTotalMs  = 3400;
let animRenderFn = null;   // shared render-at-progress function for scrub

// ── Path visibility ───────────────────────────
let showPaths = true;

// ── Ball script state ──────────────────────────
let ballScript    = [];
let ballDrawPts   = [];    // points being drawn in ball mode
let ballDrawing   = false; // currently drawing a ball path
let ballPending   = null;  // { pts, fromPos, snapExists } waiting for popup choice

const PLAYER_RADIUS = 15;
const DEF_RADIUS = 12;
const MIN_PLAYER_DIST = 32; // minimum px between player centers

// ── TEAM COLORS — persist across all resets ───────────
let teamColorOff = '#3498db'; // offense default: blue
let teamColorDef = '#8b0000'; // defense default: dark red

function setTeamColor(side, val) {
  if (side === 'off') {
    teamColorOff = val;
    players.forEach(p => { p.color = val; });
  } else {
    teamColorDef = val;
    defenders.forEach(d => { d.color = val; });
  }
  buildList(); draw();
  // If POV is open, rebuild player meshes with new color
  if (document.getElementById('povOverlay').classList.contains('open') && povScene) {
    populatePOVScene();
    updateSelfVisibility();
    applyStaticCamera();
  }
}

const colors = {
  QB:'#c8a84b', RB:'#e74c3c', WR:'#3498db', TE:'#9b59b6',
  OL:'#95a5a6', FB:'#e67e22', DEF:'#8b0000', S:'#b71c1c',
  CB:'#c0392b', LB:'#a93226', DL:'#7b241c',
};

// ─────────────────────────────────────────────
// FORMATION DATA — carefully spaced, no overlaps
// Each entry: [label, posType, xFraction, yFraction]
// OL spacing: centers at .50, guards at .41/.59, tackles at .32/.68
// Receivers: separated by meaningful gaps
// ─────────────────────────────────────────────
const formations = {
'Shotgun': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.76],['RB','RB',.63,.79],
  ['X','WR',.08,.62],['SL','WR',.19,.64],['SR','WR',.81,.64],['Z','WR',.92,.62]
],
'I-Form': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.68],['FB','FB',.50,.75],['TB','RB',.50,.84],
  ['X','WR',.08,.62],['Z','WR',.92,.62],['Y','TE',.82,.63]
],
'Spread 4-Wide': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.74],
  ['X','WR',.06,.62],['H','WR',.18,.64],['Y','WR',.82,.64],['Z','WR',.94,.62],
  ['RB','RB',.62,.79]
],
'Pistol': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.70],['RB','RB',.50,.81],
  ['X','WR',.08,.62],['SL','WR',.19,.64],['SR','WR',.81,.64],['Z','WR',.92,.62]
],
'Empty 5-Wide': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.75],
  ['X','WR',.05,.62],['H','WR',.17,.64],['Y','WR',.38,.64],['F','WR',.63,.64],['Z','WR',.83,.62]
],
'Trips Right': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.74],['RB','RB',.42,.79],
  ['X','WR',.07,.62],
  ['Y','TE',.77,.63],['H','WR',.86,.65],['Z','WR',.94,.62]
],
'Bunch Right': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.74],['RB','RB',.42,.79],
  ['X','WR',.07,.62],
  ['Y','TE',.78,.63],['H','WR',.86,.70],['Z','WR',.92,.56]
],
'Ace 12': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.68],['RB','RB',.50,.78],
  ['X','WR',.08,.62],['Z','WR',.92,.62],
  ['Y','TE',.80,.63],['U','TE',.20,.63]
],
'Wing-T': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.68],['FB','FB',.50,.76],
  ['HB','RB',.42,.82],['WB','RB',.79,.65],
  ['X','WR',.08,.62],['Y','TE',.80,.63]
],
'Flexbone': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.68],['FB','FB',.50,.77],
  ['AB','RB',.33,.70],['AB2','RB',.67,.70],
  ['X','WR',.08,.62],['Z','WR',.92,.62]
],
'Power I': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.67],['FB','FB',.50,.76],
  ['HB','RB',.50,.85],['TB','RB',.50,.93],
  ['X','WR',.08,.62],['Y','TE',.82,.63]
],
'Wildcat': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['WC','RB',.50,.72],['RB','RB',.36,.78],
  ['X','WR',.07,.62],['H','WR',.18,.64],
  ['Y','TE',.82,.63],['Z','WR',.93,.62]
],
'Beast Heavy': [
  ['LT','OL',.22,.62],['LG','OL',.33,.62],['C','OL',.44,.62],['RG','OL',.55,.62],['RT','OL',.66,.62],
  ['TE','TE',.77,.63],['WB','RB',.86,.66],
  ['QB','QB',.44,.69],['FB','FB',.50,.77],['RB','RB',.58,.84],
  ['X','WR',.07,.62]
],
'Singleback 2TE': [
  ['LT','OL',.30,.62],['LG','OL',.40,.62],['C','OL',.50,.62],['RG','OL',.60,.62],['RT','OL',.70,.62],
  ['QB','QB',.50,.69],['RB','RB',.50,.79],
  ['X','WR',.08,.62],['Z','WR',.92,.62],
  ['Y','TE',.82,.63],['H','TE',.18,.63]
]
};

// ─────────────────────────────────────────────
// DEFENSIVE TEMPLATES
// ─────────────────────────────────────────────
const defTemplates = {
'4-3 Over': [
  ['DE','DL',.27,.53],['DT','DL',.40,.52],['NT','DL',.55,.52],['DE','DL',.73,.53],
  ['WILL','LB',.29,.43],['MIKE','LB',.50,.42],['SAM','LB',.71,.43],
  ['CB','CB',.07,.35],['CB','CB',.93,.35],['FS','S',.50,.22],['SS','S',.72,.30]
],
'4-3 Under': [
  ['DE','DL',.27,.53],['DT','DL',.38,.52],['NT','DL',.52,.52],['DE','DL',.68,.53],
  ['WILL','LB',.35,.43],['MIKE','LB',.52,.42],['SAM','LB',.72,.43],
  ['CB','CB',.07,.35],['CB','CB',.93,.35],['FS','S',.50,.22],['SS','S',.30,.30]
],
'3-4 Odd': [
  ['DE','DL',.36,.52],['NT','DL',.50,.51],['DE','DL',.64,.52],
  ['OLB','LB',.21,.46],['ILB','LB',.42,.42],['ILB','LB',.58,.42],['OLB','LB',.79,.46],
  ['CB','CB',.07,.34],['CB','CB',.93,.34],['FS','S',.50,.22],['SS','S',.69,.30]
],
'Nickel 2-4-5': [
  ['DE','DL',.31,.52],['DT','DL',.44,.52],['DT','DL',.56,.52],['DE','DL',.69,.52],
  ['LB','LB',.41,.42],['LB','LB',.59,.42],
  ['CB','CB',.07,.34],['CB','CB',.93,.34],['NB','CB',.24,.36],
  ['FS','S',.44,.22],['SS','S',.63,.25]
],
'Bear Front': [
  ['DE','DL',.27,.52],['DT','DL',.37,.52],['NT','DL',.50,.51],['DT','DL',.62,.52],['DE','DL',.73,.52],
  ['MIKE','LB',.50,.43],['SAM','LB',.76,.43],
  ['CB','CB',.07,.35],['CB','CB',.93,.35],
  ['FS','S',.44,.22],['SS','S',.63,.27]
],
'Goal Line': [
  ['DE','DL',.24,.52],['DT','DL',.36,.52],['NT','DL',.50,.51],['DT','DL',.64,.52],['DE','DL',.76,.52],
  ['LB','LB',.35,.43],['LB','LB',.50,.42],['LB','LB',.65,.43],
  ['CB','CB',.13,.36],['CB','CB',.87,.36],['S','S',.50,.28]
],
'Dime': [
  ['DE','DL',.33,.52],['DT','DL',.45,.52],['DT','DL',.55,.52],['DE','DL',.67,.52],
  ['LB','LB',.50,.43],
  ['CB','CB',.06,.34],['CB','CB',.94,.34],['NB','CB',.22,.36],['DB','CB',.78,.36],
  ['FS','S',.41,.22],['SS','S',.61,.24]
],
'5-2': [
  ['LE','DL',.24,.53],['LT','DL',.35,.52],['NT','DL',.50,.51],['RT','DL',.65,.52],['RE','DL',.76,.53],
  ['WILL','LB',.38,.43],['MIKE','LB',.62,.43],
  ['CB','CB',.07,.35],['CB','CB',.93,.35],
  ['FS','S',.50,.22],['SS','S',.65,.30]
],
'Quarter': [
  ['DT','DL',.44,.52],['DT','DL',.56,.52],
  ['CB','CB',.06,.34],['CB','CB',.94,.34],
  ['NB','CB',.20,.37],['DB','CB',.50,.40],['NB','CB',.80,.37],
  ['FS','S',.35,.22],['SS','S',.65,.22],['FS','S',.50,.16],['LB','LB',.50,.43]
]
};

// ─────────────────────────────────────────────
// SPACING ENGINE — trust formation positions, only fix collisions
// ─────────────────────────────────────────────
function normalizeSpacing(list) {
  const MIN = MIN_PLAYER_DIST;
  const MARGIN = 20;

  // Iterative repulsion to fix any collisions.
  // OL players only push horizontally so they stay on the LOS y.
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < MIN) {
          const push = (MIN - d) / 2 + 0.5;
          let nx = dx / d, ny = dy / d;
          if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { nx = (i % 2 === 0) ? -1 : 1; ny = 0; }
          const aIsOL = a.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(a.label);
          const bIsOL = b.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(b.label);
          if (!aIsOL) { a.x -= nx * push; a.y -= ny * push * 0.4; }
          else         { a.x -= nx * push; } // OL: horizontal push only
          if (!bIsOL) { b.x += nx * push; b.y += ny * push * 0.4; }
          else         { b.x += nx * push; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  list.forEach(p => {
    p.x = Math.max(MARGIN, Math.min(W - MARGIN, p.x));
    p.y = Math.max(MARGIN, Math.min(H - MARGIN, p.y));
    p.ox = p.x; p.oy = p.y;
    p.animX = p.x; p.animY = p.y;
  });

  return list;
}

// ─────────────────────────────────────────────
// PLAYER FACTORY
// ─────────────────────────────────────────────
function mkPlayer(arr, i) {
  return {
    id: i, label: arr[0], pos: arr[1], role: arr[1],
    x: arr[2] * W, y: arr[3] * H,
    ox: arr[2] * W, oy: arr[3] * H,
    assignment: '',
    color: teamColorOff,
    animX: arr[2] * W, animY: arr[3] * H
  };
}

// ─────────────────────────────────────────────
// FORMATION LOADING
// ─────────────────────────────────────────────
function loadFormation(f) {
  if (players.length && !suspendHistory) pushHistory('Load formation');
  currentFormation = f;
  flipped = false;
  players = normalizeSpacing(formations[f].map(mkPlayer));
  routes = []; blocks = []; motions = []; ballPath = null; defRoutes = []; ballScript = [];
  selected = { side: 'offense', id: null };
  document.querySelectorAll('#formationBtns .btn').forEach(b =>
    b.classList.toggle('active', b.textContent.trim() === f));
  updateFlipButton();
  buildList(); renderEditor(); renderBallScript(); draw();
  status('Loaded ' + f + '.', 'success');
}

// Mirror an x-coordinate around the field center
function mirrorX(x) { return W - x; }

// Flip all x-coordinates in a points array
function flipPts(pts) {
  if (!pts) return pts;
  const result = pts.map(p => ({ ...p, x: mirrorX(p.x) }));
  // Preserve throw-arc metadata
  if (pts._isThrow)    result._isThrow    = pts._isThrow;
  if (pts._throwDelay) result._throwDelay = pts._throwDelay;
  if (pts._targetId)   result._targetId   = pts._targetId;
  return result;
}

function flipFormation() {
  if (anim) return;
  pushHistory('Flip formation');
  flipped = !flipped;

  const isOL = p => p.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(p.label);

  // Flip skill players only — OL never moves
  players.forEach(p => {
    if (isOL(p)) return;
    p.x = mirrorX(p.x); p.ox = p.x; p.animX = p.x;
  });

  // Defense always mirrors offense on flip — alignment is relative to the formation
  defenders.forEach(d => {
    d.x = mirrorX(d.x); d.ox = d.x; d.animX = d.x;
  });
  defRoutes.forEach(r => { r.pts = flipPts(r.pts); });

  // Flip all offensive path data (routes, blocks, motions, ball)
  // but only for non-OL players
  routes.forEach(r => {
    const owner = players.find(p => p.id === r.pid);
    if (owner && !isOL(owner)) r.pts = flipPts(r.pts);
  });
  blocks.forEach(b => {
    const owner = players.find(p => p.id === b.pid);
    if (owner && !isOL(owner)) b.pts = flipPts(b.pts);
  });
  motions.forEach(m => { m.pts = flipPts(m.pts); });
  if (ballPath) ballPath = flipPts(ballPath);

  updateFlipButton();
  buildList(); draw();
  status('Formation flipped ' + (flipped ? '← left' : '→ right') + '.', 'success');
}

function updateFlipButton() {
  const btn = document.getElementById('btn-flip');
  if (!btn) return;
  btn.textContent = flipped ? '⇄ Flip ←' : '⇄ Flip →';
  btn.classList.toggle('active', flipped);
}

function refreshFormations() {
  document.getElementById('formationBtns').innerHTML =
    Object.keys(formations).map(f =>
      `<button class="btn${f === currentFormation ? ' active' : ''}" onclick="loadFormation('${f}')">${f}</button>`
    ).join('');
  refreshCustomFormations();
}

function formationSnapshot() {
  return players.map(p => [p.label, p.pos, p.x / W, p.y / H]);
}

function saveFormation() {
  const name = prompt('Name this custom formation:', currentFormation + ' Custom');
  if (!name) return;
  let bank = JSON.parse(localStorage.getItem('pdpro.customFormations.v7') || '{}');
  bank[name] = formationSnapshot();
  localStorage.setItem('pdpro.customFormations.v7', JSON.stringify(bank));
  formations[name] = bank[name];
  refreshFormations();
  status('Saved custom formation: ' + name, 'success');
}

function refreshCustomFormations() {
  const el = document.getElementById('customFormations');
  if (!el) return;
  let bank = JSON.parse(localStorage.getItem('pdpro.customFormations.v7') || '{}');
  Object.assign(formations, bank);
  el.innerHTML = '<option value="">Load custom formation...</option>' +
    Object.keys(bank).map(k => `<option value="${k}">${k}</option>`).join('');
}

function loadCustomFormation(name) {
  if (!name) return;
  refreshCustomFormations();
  loadFormation(name);
  document.getElementById('customFormations').value = '';
}

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────
function cloneState() {
  return JSON.parse(JSON.stringify({
    currentFormation, flipped, players, defenders, routes, blocks, motions, defRoutes,
    ballPath, ballScript, selected, playName: document.getElementById('playName')?.value || ''
  }));
}

function applyState(st) {
  suspendHistory = true;
  currentFormation = st.currentFormation || currentFormation;
  flipped = st.flipped || false;
  players = st.players || []; defenders = st.defenders || [];
  routes = st.routes || []; blocks = st.blocks || [];
  motions = st.motions || []; ballPath = st.ballPath || null;
  defRoutes = st.defRoutes || [];
  ballScript   = st.ballScript   || [];
  selected = st.selected || { side: 'offense', id: null };
  if (document.getElementById('playName')) document.getElementById('playName').value = st.playName || '';
  updateFlipButton();
  buildList(); renderEditor(); renderBallScript(); draw();
  suspendHistory = false;
}

function pushHistory(label = 'Change') {
  if (suspendHistory) return;
  historyStack.push(cloneState());
  if (historyStack.length > 80) historyStack.shift();
  redoStack = [];
}

function undoStep() {
  if (!historyStack.length) { status('Nothing to undo.', 'error'); return; }
  redoStack.push(cloneState());
  applyState(historyStack.pop());
  status('Undid last step.', 'success');
}

function redoStep() {
  if (!redoStack.length) { status('Nothing to redo.', 'error'); return; }
  historyStack.push(cloneState());
  applyState(redoStack.pop());
  status('Redid step.', 'success');
}

// ─────────────────────────────────────────────
// COORDINATOR MODE
// ─────────────────────────────────────────────
function setCoordinator(side) {
  coordinatorSide = side;
  document.getElementById('tab-offense')?.classList.toggle('active', side === 'offense');
  document.getElementById('tab-defense')?.classList.toggle('active', side === 'defense');
  document.querySelectorAll('[data-coach]').forEach(el => {
    const v = el.getAttribute('data-coach');
    el.classList.toggle('hidden-by-coach', !(v === 'both' || v === side));
  });
  status((side === 'offense' ? 'Offensive' : 'Defensive') + ' coordinator workspace active.', 'success');
}

// ─────────────────────────────────────────────
// DEFENSE TEMPLATE LOADER
// ─────────────────────────────────────────────
function autoDefense() {
  pushHistory('Set defense');
  const front = document.getElementById('defFront').value;
  const cov = document.getElementById('coverage').value;
  defenders = normalizeSpacing(
    (defTemplates[front] || defTemplates['4-3 Over']).map((d, i) => ({
      id: i, label: d[0], pos: d[1], role: d[1],
      x: d[2] * W, y: d[3] * H,
      ox: d[2] * W, oy: d[3] * H,
      assignment: cov,
      color: teamColorDef,
      animX: d[2] * W, animY: d[3] * H
    }))
  );
  draw();
  status('Defense set: ' + front + ' / ' + cov, 'success');
}

// ─────────────────────────────────────────────
// RUN GAME ENGINE
// ─────────────────────────────────────────────
function autoRun(reset = true) {
  pushHistory('Auto run');
  if (reset) blocks = blocks.filter(b => b.manual);

  const scheme = document.getElementById('runScheme').value;
  const dirSel = document.getElementById('runDir').value;

  let rb = players.find(p => p.pos === 'RB' || p.label === 'TB' || p.label === 'HB')
        || players.find(p => p.pos === 'QB');
  if (!rb) { status('No RB found.', 'error'); return; }

  const center = players.find(p => p.label === 'C') || { x: W * .5 };

  // Determine direction
  let dir;
  if (dirSel === 'left') dir = -1;
  else if (dirSel === 'right') dir = 1;
  else if (dirSel === 'middle') dir = 0;
  else {
    // Auto: pick based on scheme and formation
    if (scheme === 'QB Keeper') {
      const qb = players.find(p => p.pos === 'QB');
      dir = qb ? (qb.x > center.x ? 1 : -1) : 1;
    } else {
      // Pick the side with fewer defenders
      const defL = defenders.filter(d => d.x < W * .5).length;
      const defR = defenders.filter(d => d.x >= W * .5).length;
      dir = defL <= defR ? -1 : 1;
    }
  }

  // Compute aiming point
  let targetX, targetY;
  if (ballPath && ballPath.length >= 2 && dirSel === 'auto') {
    targetX = ballPath[ballPath.length - 1].x;
    targetY = ballPath[ballPath.length - 1].y;
    dir = targetX > center.x ? 1 : -1;
  } else {
    switch (scheme) {
      case 'Inside Zone':
      case 'Duo':
        targetX = center.x + dir * 28; targetY = LOS - 85; break;
      case 'Outside Zone':
      case 'Stretch':
      case 'Toss Sweep':
        targetX = center.x + dir * 160; targetY = LOS - 60; break;
      case 'Power':
      case 'Counter':
      case 'Pin-Pull':
        targetX = center.x + dir * 55; targetY = LOS - 75; break;
      case 'Trap':
        targetX = center.x + dir * 22; targetY = LOS - 90; break;
      case 'Draw':
        targetX = center.x; targetY = LOS - 95; break;
      case 'QB Keeper':
        const qb2 = players.find(p => p.pos === 'QB');
        targetX = (qb2 ? qb2.x : center.x) + dir * 90; targetY = LOS - 55; break;
      case 'Option':
        targetX = center.x + dir * 130; targetY = LOS - 50; break;
      default:
        targetX = center.x + dir * 60; targetY = LOS - 80;
    }
  }

  ballPath = [{ x: rb.x, y: rb.y }, { x: targetX, y: targetY }];
  routes = routes.filter(r => !(r.pid === rb.id && r.kind === 'carry'));
  routes.push({ pid: rb.id, type: 'run', kind: 'carry', pts: ballPath, auto: true });

  // Assign OL
  const ol = players.filter(p => p.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(p.label));
  ol.sort((a, b) => a.x - b.x);

  ol.forEach((p, i) => {
    let tx, ty;
    const isRight = p.x > center.x;
    const isPlayside = (dir > 0 && isRight) || (dir < 0 && !isRight) || dir === 0;

    if (scheme === 'Inside Zone' || scheme === 'Duo') {
      tx = p.x + dir * (isPlayside ? 30 : 12); ty = p.y - 52;
    } else if (scheme === 'Outside Zone' || scheme === 'Stretch') {
      tx = p.x + dir * (isPlayside ? 42 : 18); ty = p.y - 45;
    } else if (scheme === 'Power') {
      if (p.label === (dir > 0 ? 'LG' : 'RG')) {
        // Pulling guard → leads through hole
        tx = targetX - dir * 18; ty = targetY + 15;
      } else {
        tx = p.x + dir * (isPlayside ? 20 : 8); ty = p.y - 50;
      }
    } else if (scheme === 'Counter') {
      if (p.label === (dir > 0 ? 'RG' : 'LG') || p.label === (dir > 0 ? 'RT' : 'LT')) {
        tx = targetX; ty = targetY + 12; // pulling
      } else {
        tx = p.x - dir * 8; ty = p.y - 48; // down blocks
      }
    } else if (scheme === 'Trap') {
      if (p.label === (dir > 0 ? 'LG' : 'RG')) {
        tx = center.x + dir * 38; ty = p.y - 38; // trapping guard
      } else {
        tx = p.x; ty = p.y - 46;
      }
    } else if (scheme === 'Draw') {
      tx = p.x; ty = p.y - 44;
    } else {
      tx = p.x + dir * 20; ty = p.y - 50;
    }

    blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
    p.assignment = `${scheme}: ${isPlayside ? 'playside' : 'backside'} ${getOLTech(scheme, p.label, dir, isPlayside)}`;
  });

  // TE blocking assignments
  players.filter(p => p.pos === 'TE').forEach(p => {
    const isPlayside = (dir > 0 && p.x > center.x) || (dir < 0 && p.x < center.x);
    const tx = p.x + dir * (isPlayside ? 32 : 14);
    const ty = p.y - 48;
    blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
    p.assignment = isPlayside ? `${scheme}: lead block / kick-out` : `${scheme}: down block / seal`;
  });

  // FB lead block
  const fb = players.find(p => p.pos === 'FB' || p.label === 'FB');
  if (fb && scheme !== 'Draw' && scheme !== 'QB Keeper') {
    const tx = targetX - dir * 22;
    const ty = targetY + 10;
    blocks.push({ pid: fb.id, type: 'block', pts: [{ x: fb.x, y: fb.y }, { x: tx, y: ty }], auto: true });
    fb.assignment = `${scheme}: lead through the hole, kick-out force`;
  }

  // WR stalk / crack
  players.filter(p => p.pos === 'WR').forEach(p => {
    const isPlayside = (dir > 0 && p.x > center.x) || (dir < 0 && p.x < center.x);
    const tx = p.x + (isPlayside ? dir * 28 : dir * 8);
    const ty = p.y - 45;
    blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
    p.assignment = isPlayside ? `${scheme}: stalk/crack the OB support` : `${scheme}: cut-off backside pursuit`;
  });

  // QB handoff mesh
  const qb = players.find(p => p.pos === 'QB');
  if (qb && scheme !== 'QB Keeper') {
    routes.push({
      pid: qb.id, type: 'route', kind: 'handoff', auto: true,
      pts: [{ x: qb.x, y: qb.y }, { x: rb.x, y: rb.y }, { x: qb.x - dir * 28, y: qb.y - 15 }]
    });
    qb.assignment = `${scheme}: mesh handoff to ${rb.label}, boot fake`;
  } else if (qb && scheme === 'QB Keeper') {
    routes.push({
      pid: qb.id, type: 'run', kind: 'carry', auto: true,
      pts: [{ x: qb.x, y: qb.y }, { x: targetX, y: targetY }]
    });
    qb.assignment = `QB Keeper: keep and run edge ${dir > 0 ? 'right' : 'left'}`;
  }

  rb.assignment = `${scheme}: ${dir === 0 ? 'up the middle' : dir > 0 ? 'hit right' : 'hit left'}, aim ${Math.round(targetX)},${Math.round(targetY)}`;

  buildList(); draw();
  status('Run generated: ' + scheme + ' ' + (dir === 0 ? 'middle' : dir > 0 ? 'right' : 'left') + ' — hit ▶ Run to animate.', 'success');
}

function getOLTech(scheme, label, dir, isPlayside) {
  if (scheme === 'Inside Zone' || scheme === 'Outside Zone') return 'zone/combo step';
  if (scheme === 'Power' && label === (dir > 0 ? 'LG' : 'RG')) return 'PULL → lead through hole';
  if (scheme === 'Counter' && ['LG','RG','LT','RT'].includes(label)) return 'PULL → kick-out';
  if (scheme === 'Trap' && label === (dir > 0 ? 'LG' : 'RG')) return 'TRAP the backside DT';
  return isPlayside ? 'down block / drive' : 'cut-off / backside seal';
}

// ─────────────────────────────────────────────
// PASS PROTECTION ENGINE
// ─────────────────────────────────────────────
function autoPassPro() {
  pushHistory('Auto pass pro');
  blocks = blocks.filter(b => b.manual);
  const scheme = document.getElementById('passScheme').value;
  const center = players.find(p => p.label === 'C') || { x: W * .5 };
  const slide = scheme.includes('Left') ? -1 : scheme.includes('Right') ? 1 : 0;

  const qb = players.find(p => p.pos === 'QB') || { x: center.x, y: LOS + 60 };
  const ol = players.filter(p => p.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(p.label));
  ol.sort((a, b) => a.x - b.x); // left to right: LT LG C RG RT

  ol.forEach((p, i) => {
    const isRight  = p.x >= center.x;
    const distFromCenter = Math.abs(p.x - center.x);
    // Angle increases the further from center — tackles kick out most
    const outAngle = distFromCenter / (W * 0.5); // 0 at center, ~0.4 at tackle

    let tx, ty;

    if (scheme.includes('BOB') || scheme === 'Man Protection') {
      // Each OL sets back and slightly out — slight horseshoe
      tx = p.x + (isRight ? outAngle * 28 : -outAngle * 28);
      ty = p.y + 36 + outAngle * 18; // drop back, tackles deeper
    } else if (scheme.includes('Turnback')) {
      // All set back toward center (QB rolling away)
      tx = p.x + (isRight ? -18 : 18);
      ty = p.y + 32;
    } else if (scheme.includes('Full Slide')) {
      // Whole line slides direction but still drops back into pocket
      tx = p.x + slide * 22;
      ty = p.y + 34 + outAngle * 12;
    } else if (scheme.includes('Half-Slide')) {
      const playside = (slide > 0 && isRight) || (slide < 0 && !isRight);
      tx = p.x + (playside ? slide * 18 : 0);
      ty = p.y + 34 + outAngle * 14;
    } else {
      // Max Protect — tightest pocket, drop straight back
      tx = p.x + (isRight ? outAngle * 14 : -outAngle * 14);
      ty = p.y + 38 + outAngle * 10;
    }

    blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
    p.assignment = scheme + ': ' + (i === 0 ? 'LT — kick set outside' : i === 1 ? 'LG — angle set inside-out' : i === 2 ? 'C — anchor, no movement' : i === 3 ? 'RG — angle set inside-out' : 'RT — kick set outside');
  });

  // Backs and TEs
  players.filter(p => ['RB','FB','TE'].includes(p.pos)).forEach(p => {
    if (scheme === 'Max Protect') {
      const tx = p.x + (p.x < center.x ? -38 : 38); const ty = p.y - 52;
      blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
      p.assignment = 'Max Protect: scan for blitzers, check release';
    } else if (p.pos === 'RB' || p.pos === 'FB') {
      const tx = p.x + (slide !== 0 ? -slide * 40 : p.x < center.x ? -38 : 38); const ty = p.y - 50;
      blocks.push({ pid: p.id, type: 'block', pts: [{ x: p.x, y: p.y }, { x: tx, y: ty }], auto: true });
      p.assignment = scheme + ': scan the hot side, pick up edge rusher';
    }
    // TE: release to flat by default unless Max Protect
  });

  buildList(); draw();
  status('Pass protection set: ' + scheme + '.', 'success');
}

// ─────────────────────────────────────────────
// PASS CONCEPT QUICK INSTALL
// ─────────────────────────────────────────────
function addQuickPassConcept() {
  pushHistory('Add pass concept');
  routes = routes.filter(r => !r.autoConcept);
  const concept = document.getElementById('passConcept').value;
  const center = players.find(p => p.label === 'C') || { x: W * .5 };
  const receivers = players.filter(p => ['WR','TE','RB'].includes(p.pos));

  const conceptRoutes = {
    'Flood': ['Go','Comeback/Out','Flat'],
    'Levels': ['In/Dig','Curl','Flat'],
    'Y-Cross': ['Cross','Seam','Flat'],
    'Boot Sail': ['Sail/Wheel','Cross','Flat'],
    'Mesh': ['Under','Under','Wheel'],
    'Smash': ['Hitch','Corner','Flat'],
    'Four Verts': ['Go','Go','Go'],
    'Yankee': ['Post','Deep Cross','Flat'],
    'Drive': ['In','Underneath','Swing'],
    'Spacing': ['Hitch','Flat','Seam'],
  };
  const names = conceptRoutes[concept] || ['Go','Out','Flat'];

  receivers.forEach((p, i) => {
    const side = p.x < center.x ? -1 : 1;
    const routeName = names[i % names.length];
    let pts;
    if (routeName === 'Go') {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 12, y: p.y - 80 }, { x: p.x + side * 18, y: p.y - 160 }];
    } else if (routeName === 'Corner') {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 20, y: p.y - 70 }, { x: p.x + side * 60, y: p.y - 110 }];
    } else if (routeName === 'Post') {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 15, y: p.y - 70 }, { x: W * .5 + side * 20, y: p.y - 120 }];
    } else if (routeName.includes('Cross') || routeName === 'In' || routeName.includes('Dig')) {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 10, y: p.y - 50 }, { x: p.x + side * 80, y: p.y - 55 }];
    } else if (routeName === 'Out' || routeName.includes('Comeback')) {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 8, y: p.y - 65 }, { x: p.x + side * 45, y: p.y - 68 }];
    } else if (routeName === 'Flat' || routeName === 'Swing') {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 55, y: p.y - 18 }, { x: p.x + side * 75, y: p.y - 8 }];
    } else if (routeName === 'Seam') {
      pts = [{ x: p.x, y: p.y }, { x: center.x + side * 55, y: p.y - 60 }, { x: center.x + side * 50, y: p.y - 130 }];
    } else if (routeName === 'Curl' || routeName === 'Hitch') {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 15, y: p.y - 60 }, { x: p.x, y: p.y - 55 }];
    } else if (routeName.includes('Sail') || routeName.includes('Wheel')) {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 40, y: p.y - 30 }, { x: p.x + side * 60, y: p.y - 110 }];
    } else {
      pts = [{ x: p.x, y: p.y }, { x: p.x + side * 30, y: p.y - 60 }, { x: p.x + side * 50, y: p.y - 90 }];
    }
    routes.push({ pid: p.id, type: 'route', autoConcept: true, pts });
    p.assignment = routeName + ' — ' + concept;
  });

  buildList(); draw();
  status('Pass concept installed: ' + concept + '.', 'success');
}

// ─────────────────────────────────────────────
// PLAY ACTION ENGINE — rebuilt
// ─────────────────────────────────────────────
function autoPlayAction() {
  pushHistory('Play action');
  const runScheme = document.getElementById('runScheme').value;
  const qb = players.find(p => p.pos === 'QB');
  const rb = players.find(p => p.pos === 'RB' || p.label === 'TB' || p.label === 'HB')
          || players.find(p => p.pos === 'FB');
  if (!qb || !rb) { status('Need a QB and RB for play action.', 'error'); return; }

  // Clear previous auto content, keep manual drawings
  blocks  = blocks.filter(b => b.manual);
  routes  = routes.filter(r => !r.autoConcept && !r.playAction && r.kind !== 'carry');
  motions = motions.filter(m => !m.playAction);
  ballPath = null;

  const center = players.find(p => p.label === 'C') || { x: W * .5 };

  // ── Determine fake direction (toward heaviest OL side = stronger run side)
  const olLeft  = players.filter(p => ['LT','LG'].includes(p.label)).length;
  const olRight = players.filter(p => ['RT','RG'].includes(p.label)).length;
  const fakeDir = rb.x < center.x ? -1 : 1; // fake toward where the RB is

  // ── 1. RB sells fake into line
  const fakeMesh  = { x: center.x + fakeDir * 22, y: LOS + 18 };  // mesh point just past LOS
  const fakePush  = { x: center.x + fakeDir * 42, y: LOS + 32 };  // sells into the hole
  const fakeAbort = { x: center.x + fakeDir * 30, y: LOS + 22 };  // stops, play fake
  motions.push({
    pid: rb.id, type: 'motion', playAction: true, auto: true,
    pts: [{ x: rb.x, y: rb.y }, fakeMesh, fakePush, fakeAbort]
  });
  rb.assignment = `PA fake: sell ${runScheme} into the ${fakeDir > 0 ? 'right' : 'left'} side`;

  // ── 2. QB: under-center drop → 5-step drop behind OL → throw
  // Pick the best receiver (furthest downfield route, or first WR/TE available)
  const eligibleReceivers = players.filter(p => ['WR','TE'].includes(p.pos));
  if (!eligibleReceivers.length) { status('No WR or TE found for play action target.', 'error'); return; }

  // Score receivers: prefer ones on the opposite side from the fake (boot/nakeds open backside)
  const scored = eligibleReceivers.map(p => {
    const isBackside = (fakeDir > 0 && p.x < center.x) || (fakeDir < 0 && p.x > center.x);
    const depth = center.y - p.y; // positive = upfield
    return { p, score: depth * 1.0 + (isBackside ? 80 : 0) };
  }).sort((a, b) => b.score - a.score);

  const primaryTarget = scored[0].p;
  const secondaryTarget = scored[1]?.p || null;

  // QB 5-step drop: behind the center, straight back
  const dropX = qb.x;
  const dropY = qb.y + 55; // 5-step drop depth behind LOS
  const throwRelease = { x: qb.x + (primaryTarget.x > center.x ? 14 : -14), y: qb.y + 40 }; // step-up in pocket

  routes.push({
    pid: qb.id, type: 'route', playAction: true, auto: true,
    // snap → fake toward mesh → 5-step drop → set feet → [throw shown separately]
    pts: [
      { x: qb.x, y: qb.y },
      { x: qb.x + fakeDir * 12, y: qb.y + 8 },   // jab toward fake
      { x: qb.x,               y: qb.y + 22 },    // first step back
      { x: dropX,              y: dropY },          // 5-step depth
      { x: throwRelease.x,     y: throwRelease.y } // step up to throw
    ]
  });
  qb.assignment = `PA ${runScheme}: fake mesh, 5-step drop, throw to ${primaryTarget.label}`;

  // ── 3. Primary receiver: short stem then break open
  const recSide = primaryTarget.x < center.x ? -1 : 1;
  const recDepth = Math.max(50, center.y - primaryTarget.y + 30); // at least 50px upfield from start
  const stemY = primaryTarget.y - recDepth * 0.45;
  const breakX = primaryTarget.x + recSide * 55;
  const catchX = primaryTarget.x + recSide * 75;
  const catchY = primaryTarget.y - recDepth;

  routes.push({
    pid: primaryTarget.id, type: 'route', playAction: true, auto: true,
    pts: [
      { x: primaryTarget.x, y: primaryTarget.y },
      { x: primaryTarget.x + recSide * 8,  y: stemY },          // vertical stem
      { x: breakX,                          y: stemY + 12 },     // break point
      { x: catchX,                          y: catchY }           // catch point
    ]
  });
  primaryTarget.assignment = `PA primary: stem → break open at ~${Math.round(recDepth / 5)}yds`;

  // ── 4. Secondary receiver: clear-out or checkdown on same/opposite side
  if (secondaryTarget) {
    const secSide = secondaryTarget.x < center.x ? -1 : 1;
    routes.push({
      pid: secondaryTarget.id, type: 'route', playAction: true, auto: true,
      pts: [
        { x: secondaryTarget.x, y: secondaryTarget.y },
        { x: secondaryTarget.x + secSide * 15, y: secondaryTarget.y - 55 },
        { x: secondaryTarget.x + secSide * 40, y: secondaryTarget.y - 95 }
      ]
    });
    secondaryTarget.assignment = `PA secondary: clear-out / vert to hold safety`;
  }

  // ── 5. Other receivers: leak routes / checkdowns
  eligibleReceivers.filter(p => p.id !== primaryTarget.id && p.id !== (secondaryTarget?.id)).forEach((p, i) => {
    const side = p.x < center.x ? -1 : 1;
    const leaked = [
      [{ x: p.x, y: p.y }, { x: p.x + side * 40, y: p.y - 20 }, { x: p.x + side * 65, y: p.y - 12 }], // flat leak
      [{ x: p.x, y: p.y }, { x: p.x, y: p.y - 35 }, { x: p.x + side * 30, y: p.y - 35 }],              // out
    ];
    routes.push({ pid: p.id, type: 'route', playAction: true, auto: true, pts: leaked[i % 2] });
    p.assignment = i % 2 === 0 ? 'PA: flat leak / checkdown' : 'PA: out route / hot';
  });

  // ── 6. OL: down-blocks then set pass pro
  players.filter(p => p.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(p.label)).forEach((p, i) => {
    const isPlayside = (fakeDir > 0 && p.x >= center.x) || (fakeDir < 0 && p.x <= center.x);
    // drive step toward fake then kick back to set
    blocks.push({
      pid: p.id, type: 'block', playAction: true, auto: true,
      pts: [
        { x: p.x, y: p.y },
        { x: p.x + fakeDir * (isPlayside ? 16 : 8), y: p.y - 14 }, // sell run
        { x: p.x + fakeDir * (isPlayside ? 10 : 4), y: p.y - 36 }  // set in pocket
      ]
    });
    p.assignment = `PA ${runScheme}: ${isPlayside ? 'down-block sell, hold' : 'protect backside, BOB'}`;
  });

  // ── 7. Store throw arc as a special ballPath (QB release → parabolic → receiver catch)
  // This is the football-in-the-air path
  const throwMidX = (throwRelease.x + catchX) / 2;
  const throwMidY = Math.min(throwRelease.y, catchY) - 55; // arc peak above both points
  ballPath = [
    { x: throwRelease.x, y: throwRelease.y },
    { x: throwMidX, y: throwMidY },
    { x: catchX, y: catchY }
  ];
  // Tag it so the animation knows it's a throw arc (delayed — starts at ~60% through animation)
  ballPath._isThrow = true;
  ballPath._throwDelay = 0.58; // fraction into animation when throw starts
  ballPath._targetId = primaryTarget.id;

  buildList(); draw();
  status('Play action built: ' + runScheme + ' fake → throw to ' + primaryTarget.label + '.', 'success');
}

// Helper: interpolate a parabolic arc given t (0→1)
function arcPt(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u*u*p0.x + 2*u*t*p1.x + t*t*p2.x,
    y: u*u*p0.y + 2*u*t*p1.y + t*t*p2.y
  };
}

// ─────────────────────────────────────────────
// PLAYER LIST & EDITOR
// ─────────────────────────────────────────────
function buildList() {
  const el = document.getElementById('playerList');
  el.innerHTML = players.map(p =>
    `<div class="player-row ${selected.side === 'offense' && selected.id === p.id ? 'selected' : ''}" onclick="selectObj('offense',${p.id})">
      <div class="dot" style="background:${p.color}">${p.label.slice(0,3)}</div>
      <div><b>${p.label}</b> <span class="small">${p.pos}</span>
      <div class="small">${p.assignment || '<span style="color:#555">No assignment</span>'}</div></div>
      <span class="small">${routeCount(p.id)}</span>
    </div>`
  ).join('');
}

function routeCount(id) {
  const n = routes.filter(r => r.pid === id).length +
            blocks.filter(b => b.pid === id).length +
            motions.filter(m => m.pid === id).length;
  return n ? `<span style="color:var(--gold)">${n}×</span>` : '';
}

function selectObj(side, id) {
  selected = { side, id };
  buildList();
  renderEditor();
  draw();
}

function obj() {
  return selected.side === 'defense'
    ? defenders.find(d => d.id === selected.id)
    : players.find(p => p.id === selected.id);
}

function renderEditor() {
  const p = obj();
  const el = document.getElementById('editor');
  if (!p) {
    el.className = 'hint';
    el.innerHTML = 'Select any offensive or defensive player to customize name, position, role, assignment, color, and exact field location.';
    return;
  }
  const isDef = selected.side === 'defense';
  const hasCustomPath = isDef && defRoutes.some(r => r.did === p.id);
  el.className = '';
  el.innerHTML = `
    <div class="editor-grid">
      <label>Label</label><input class="input" value="${p.label}" oninput="editSel('label',this.value)">
      <label>Position</label><input class="input" value="${p.pos}" oninput="editSel('pos',this.value)">
      <label>Role</label><input class="input" value="${p.role||''}" oninput="editSel('role',this.value)">
      <label>Assign</label><input class="input" value="${p.assignment||''}" oninput="editSel('assignment',this.value)">
      <label>Color</label><input class="input" type="color" value="${p.color}" oninput="editSel('color',this.value)">
      <label>X / Y</label><input class="input" value="${Math.round(p.x)}, ${Math.round(p.y)}" onchange="setXY(this.value)">
    </div>
    ${isDef ? `<div class="hint" style="margin-top:8px;padding:7px;background:#1a0a0a;border:1px solid #3a1818;border-radius:5px">
      <span style="color:#ff9090;font-weight:700">Defender selected.</span> Switch to any draw mode (R/B/M) then draw on the field to set a custom movement path for this defender during animation.
      ${hasCustomPath ? `<br><button class="btn red full" style="margin-top:6px;font-size:11px;padding:5px" onclick="clearOneDefPath(${p.id})">✕ Remove Custom Path</button>` : '<br><span style="color:var(--muted)">No custom path yet — auto reactions can apply.</span>'}
    </div>` : ''}
    <button class="btn red full" style="margin-top:9px" onclick="deleteSelected()">Delete ${isDef ? 'Defender' : 'Player'}</button>`;
}

function editSel(k, v) {
  const p = obj();
  if (!p) return;
  pushHistory('Edit player');
  p[k] = v;
  if (k === 'color') p.color = v;
  buildList(); draw();
}

function setXY(v) {
  const p = obj();
  if (!p) return;
  const [x, y] = v.split(',').map(n => Number(n.trim()));
  if (!isNaN(x) && !isNaN(y)) {
    pushHistory('Move player');
    p.x = x; p.y = y; p.ox = x; p.oy = y;
    draw();
  }
}

function deleteSelected() {
  if (!obj()) return;
  pushHistory('Delete player');
  if (selected.side === 'defense') defenders = defenders.filter(d => d.id !== selected.id);
  else players = players.filter(p => p.id !== selected.id);
  selected = { side: 'offense', id: null };
  buildList(); renderEditor(); draw();
}

function addPlayer() {
  pushHistory('Add player');
  const id = Math.max(-1, ...players.map(p => p.id)) + 1;
  players.push({ id, label: 'NEW', pos: 'WR', role: 'Custom',
    x: W * .5, y: H * .78, ox: W * .5, oy: H * .78,
    assignment: '', color: colors.WR, animX: W * .5, animY: H * .78 });
  selectObj('offense', id);
}

function clearBlocking() {
  pushHistory('Clear blocks');
  blocks = [];
  players.forEach(p => {
    if (p.assignment && (p.assignment.includes('Protect') || p.assignment.includes('support') ||
        p.assignment.includes('block') || p.assignment.includes('Block') || p.assignment.includes('responsibility')))
      p.assignment = '';
  });
  buildList(); draw();
  status('Blocking cleared.', 'success');
}

function clearSelectedAssignment() {
  const p = obj();
  if (!p) { status('Select a player first.', 'error'); return; }
  pushHistory('Clear selected assignment');

  if (selected.side === 'defense') {
    // Clear defender custom path and reset assignment
    defRoutes = defRoutes.filter(r => r.did !== p.id);
    p.assignment = document.getElementById('coverage')?.value || '';
    renderEditor();
    status('Cleared defender path and assignment.', 'success');
  } else {
    // Clear offensive player routes, blocks, motions
    routes  = routes.filter(r => r.pid !== p.id);
    blocks  = blocks.filter(b => b.pid !== p.id);
    motions = motions.filter(m => m.pid !== p.id);
    if (ballPath && ballPath[0] && Math.hypot(ballPath[0].x - p.x, ballPath[0].y - p.y) < 25) ballPath = null;
    p.assignment = '';
    status('Cleared selected player assignments.', 'success');
  }

  buildList(); draw();
}

// ═══════════════════════════════════════════════════════
// BALL SCRIPT ENGINE v2 — Draw-the-ball system
// ═══════════════════════════════════════════════════════

// Get the current end position of the ball (where the next draw starts from)
function getBallEndpoint() {
  if (!ballScript.length) return null;
  const last = ballScript[ballScript.length - 1];
  if (last.phase === 'snap') {
    const qb = players.find(p => p.id === last.toId);
    return qb ? { x: qb.x, y: qb.y } : null;
  }
  if (last.phase === 'qbmove' || last.phase === 'carry') {
    const pts = last.pts;
    return pts ? pts[pts.length - 1] : null;
  }
  if (last.phase === 'pass' || last.phase === 'lateral' || last.phase === 'handoff') {
    return last.catchPt || last.endPt || null;
  }
  if (last.phase === 'fake') {
    // After fake, ball returns to QB — use fake start point
    const pts = last.pts;
    return pts ? pts[0] : null;
  }
  return null;
}

function showBallPopup(canvasX, canvasY) {
  const popup  = document.getElementById('ballPopup');
  const holder = document.querySelector('.field-holder');
  if (!popup || !holder) return;
  const rect = holder.getBoundingClientRect();
  const canv = canvas.getBoundingClientRect();
  const scaleX = canv.width  / W;
  const scaleY = canv.height / H;
  const px = (canv.left - rect.left) + canvasX * scaleX;
  const py = (canv.top  - rect.top)  + canvasY * scaleY;
  popup.style.left = Math.min(px + 10, rect.width  - 185) + 'px';
  popup.style.top  = Math.min(py + 10, rect.height - 210) + 'px';
  popup.classList.add('open');
}

function closeBallPopup() {
  const popup = document.getElementById('ballPopup');
  if (popup) popup.classList.remove('open');
  ballPending = null;
}

// Called when user picks an option from the popup
function commitBallDraw(type) {
  // Capture the pending draw BEFORE closing the popup — closeBallPopup()
  // clears ballPending, which used to kill every ball action right here.
  const pending = ballPending;
  closeBallPopup();
  if (!pending) return;
  pushHistory('Ball script draw');

  const pts     = pending.pts;
  const startPt = pts[0];
  const endPt   = pts[pts.length - 1];

  // Find nearest player at the end point
  const targetPlayer = hit(players, endPt.x, endPt.y, 32);

  // Passes are usually drawn to where the receiver WILL be, not where they
  // stand pre-snap — also match a player whose route ends near the endpoint.
  let routeTarget = null, routeTargetD = 50;
  routes.forEach(r => {
    if (!r.pts || r.pts.length < 2 || r.kind === 'carry') return;
    const last = r.pts[r.pts.length - 1];
    const d = Math.hypot(last.x - endPt.x, last.y - endPt.y);
    const pl = players.find(p => p.id === r.pid);
    if (pl && d < routeTargetD) { routeTarget = pl; routeTargetD = d; }
  });

  // Find current carrier
  const carrierStep = [...ballScript].reverse().find(s =>
    s.phase === 'snap' || s.phase === 'carry' || s.phase === 'qbmove' ||
    s.phase === 'handoff' || s.phase === 'pass' || s.phase === 'lateral');
  const carrierId = carrierStep
    ? (carrierStep.phase === 'snap' ? carrierStep.toId :
       carrierStep.phase === 'carry' || carrierStep.phase === 'qbmove' ? carrierStep.carrierId :
       carrierStep.toId)
    : (players.find(p => p.pos === 'QB')?.id);
  const carrierPlayer = players.find(p => p.id === carrierId);

  if (type === 'qbmove') {
    // QB moves with ball — draw path QB follows before throwing/handing off
    // Remove last carry step if it exists and replace with QB move path
    if (ballScript[ballScript.length-1]?.phase === 'carry' ||
        ballScript[ballScript.length-1]?.phase === 'qbmove') ballScript.pop();
    ballScript.push({ phase: 'qbmove', carrierId, pts });
    // Auto-add carry placeholder at end of QB movement
    ballScript.push({ phase: 'carry', carrierId, pts: [endPt, endPt] });
    if (carrierPlayer) carrierPlayer.assignment = 'QB: drop back / rollout with ball';
    status('QB movement drawn. Draw again from new position to hand off, pass, or fake.', 'success');

  } else if (type === 'fake') {
    // Play action fake — ball stays with QB, dashed fake path drawn
    if (ballScript[ballScript.length-1]?.phase === 'carry' ||
        ballScript[ballScript.length-1]?.phase === 'qbmove') ballScript.pop();
    ballScript.push({ phase: 'fake', carrierId, pts, fakeTarget: endPt });
    // Ball returns to QB after fake — re-add carry from QB position
    const qb = players.find(p => p.pos === 'QB');
    if (qb) ballScript.push({ phase: 'carry', carrierId: qb.id, pts: [{ x: qb.x, y: qb.y }, { x: qb.x, y: qb.y }] });
    if (carrierPlayer) carrierPlayer.assignment = 'PA fake — sell the run';
    status('Fake drawn. Now draw the QB boot/pass from the new position.', 'success');

  } else if (type === 'run') {
    // Handoff / carry — transfers to target player if one is near, else is a QB carry
    if (ballScript[ballScript.length-1]?.phase === 'carry' ||
        ballScript[ballScript.length-1]?.phase === 'qbmove') ballScript.pop();
    if (targetPlayer && targetPlayer.id !== carrierId) {
      // Handoff to another player
      const meshPt = { x: (startPt.x + endPt.x) / 2, y: (startPt.y + endPt.y) / 2 };
      ballScript.push({ phase: 'handoff', fromId: carrierId, toId: targetPlayer.id, pts, meshPt, catchPt: endPt });
      // Carry follows target player's existing route if available, else use drawn path
      const existingRoute = routes.find(r => r.pid === targetPlayer.id && r.kind !== 'carry');
      ballScript.push({ phase: 'carry', carrierId: targetPlayer.id,
        pts: existingRoute ? existingRoute.pts : [endPt, { x: endPt.x, y: endPt.y - 80 }] });
      targetPlayer.assignment = 'Ball carrier — handoff from ' + (carrierPlayer?.label || 'QB');
    } else {
      // QB/carrier run
      ballScript.push({ phase: 'carry', carrierId, pts });
      if (carrierPlayer) carrierPlayer.assignment = 'Ball carrier — run';
    }
    status('Run path drawn.', 'success');

  } else if (type === 'pass') {
    // Pass — arc from current position to target
    if (ballScript[ballScript.length-1]?.phase === 'carry' ||
        ballScript[ballScript.length-1]?.phase === 'qbmove') ballScript.pop();
    const dist  = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
    const arcH  = Math.max(18, dist * 0.20);
    const midX  = (startPt.x + endPt.x) / 2;
    const midY  = Math.min(startPt.y, endPt.y) - arcH;
    const receiver = targetPlayer || routeTarget;
    const recvId = receiver?.id ?? null;
    ballScript.push({ phase: 'pass', fromId: carrierId,
      toId: recvId, releasePt: startPt, arcPeak: { x: midX, y: midY }, catchPt: endPt });
    // YAC — follow receiver's route if exists, else short forward carry
    if (recvId !== null) {
      const existingRoute = routes.find(r => r.pid === recvId);
      ballScript.push({ phase: 'carry', carrierId: recvId,
        pts: existingRoute ? existingRoute.pts.slice(-2) : [endPt, { x: endPt.x, y: endPt.y - 45 }] });
      receiver.assignment = 'Pass target — ' + (dist > 150 ? 'deep' : dist > 80 ? 'intermediate' : 'quick') + ' route';
    }
    status('Pass drawn — ' + (dist > 150 ? 'deep ball' : dist > 80 ? 'intermediate' : 'quick throw') + '.', 'success');

  } else if (type === 'lateral') {
    // Lateral / pitch — flat arc
    if (ballScript[ballScript.length-1]?.phase === 'carry' ||
        ballScript[ballScript.length-1]?.phase === 'qbmove') ballScript.pop();
    const midX = (startPt.x + endPt.x) / 2;
    const midY = (startPt.y + endPt.y) / 2 + 12;
    const receiver = targetPlayer || routeTarget;
    const recvId = receiver?.id ?? null;
    ballScript.push({ phase: 'lateral', fromId: carrierId, toId: recvId,
      releasePt: startPt, arcPeak: { x: midX, y: midY }, catchPt: endPt });
    if (recvId !== null) {
      ballScript.push({ phase: 'carry', carrierId: recvId,
        pts: [endPt, { x: endPt.x + (endPt.x > W/2 ? 60 : -60), y: endPt.y - 60 }] });
      receiver.assignment = 'Lateral — pitch and run';
    }
    status('Lateral drawn.', 'success');
  }

  ballPending = null;
  buildList(); renderBallScript(); draw();
}

function renderBallScript() {
  const el    = document.getElementById('ballScriptList');
  const badge = document.getElementById('ballScriptBadge');
  if (!el) return;
  if (!ballScript.length) {
    el.innerHTML = '<p class="hint">Click 🏈 then draw a line from the ball position to build the sequence.</p>';
    if (badge) badge.textContent = '0 steps';
    return;
  }
  if (badge) badge.textContent = ballScript.length + ' step' + (ballScript.length !== 1 ? 's' : '');

  const icons = { snap:'🏈', carry:'🏃', qbmove:'👟', handoff:'🤝', pass:'🎯', lateral:'🔄', fake:'🎭' };
  const labels = {
    snap:    s => `Snap → ${players.find(p=>p.id===s.toId)?.label||'QB'}`,
    carry:   s => `Carry: ${players.find(p=>p.id===s.carrierId)?.label||'?'}`,
    qbmove:  s => `QB Move: ${players.find(p=>p.id===s.carrierId)?.label||'QB'}`,
    handoff: s => `Handoff → ${players.find(p=>p.id===s.toId)?.label||'?'}`,
    pass:    s => `Pass → ${s.toId ? players.find(p=>p.id===s.toId)?.label||'?' : 'open field'}`,
    lateral: s => `Lateral → ${s.toId ? players.find(p=>p.id===s.toId)?.label||'?' : 'open field'}`,
    fake:    s => `PA Fake by ${players.find(p=>p.id===s.carrierId)?.label||'QB'}`,
  };

  el.innerHTML = ballScript.map((step, i) =>
    `<div class="ball-step">
      <span class="ball-step-icon">${icons[step.phase]||'🏈'}</span>
      <span>${(labels[step.phase]||((s)=>s.phase))(step)}</span>
      <span class="ball-step-del" onclick="removeBallStep(${i})">✕</span>
    </div>`
  ).join('');
}

function removeBallStep(i) {
  pushHistory('Remove ball step');
  ballScript.splice(i, 1);
  renderBallScript(); draw();
}

function clearBallScript() {
  pushHistory('Clear ball script');
  ballScript = [];
  renderBallScript(); draw();
  status('Ball script cleared.', 'success');
}

// Auto snap — called automatically when 🏈 mode is first activated
// silent=true suppresses the status message
function autoSnapScript(silent) {
  const center = players.find(p => p.label === 'C') || players.find(p => p.pos === 'OL' && ['LG','RG','LT','RT'].every(l=>l!==p.label));
  const qb     = players.find(p => p.pos === 'QB');
  if (!center || !qb) { if (!silent) status('Need a Center (C) and QB on the field.', 'error'); return; }
  if (ballScript.find(s => s.phase === 'snap')) return; // already has snap
  pushHistory('Auto snap');
  const dist = Math.hypot(qb.x - center.x, qb.y - center.y);
  ballScript.unshift({ phase: 'snap', fromId: center.id, toId: qb.id, isGun: dist > 50 });
  // Add default QB carry (will be replaced when user draws first ball path)
  if (!ballScript.find(s => s.carrierId === qb.id)) {
    ballScript.push({ phase: 'carry', carrierId: qb.id,
      pts: [{ x: qb.x, y: qb.y }, { x: qb.x, y: qb.y + 55 }] });
  }
  renderBallScript(); draw();
  if (!silent) status('Snap auto-built: C → QB. Draw from the ball to continue.', 'success');
}

// ── Compute ball position at progress t ──────────────
// Returns { x, y, h, phase } — h is a height hint for the 3D view (yards).
// `live` forces use of animX/animY even when the 2D anim flag is off (3D POV).
function getBallPos(t, hasMotion, MEND, live) {
  if (!ballScript.length) return null;
  const playT = hasMotion ? Math.max(0, (t - MEND) / (1 - MEND)) : t;
  if (playT < 0) return null;

  // Assign timing windows
  const snapTime     = 0.08;
  const transferTime = 0.10;
  const fakeTime     = 0.12;
  const qbMoveBase   = 0.18;

  // Calculate total variable time
  let totalFixed = 0;
  ballScript.forEach(s => {
    if (s.phase === 'snap')    totalFixed += snapTime;
    else if (['handoff','pass','lateral'].includes(s.phase)) totalFixed += transferTime;
    else if (s.phase === 'fake')   totalFixed += fakeTime;
    else if (s.phase === 'qbmove') totalFixed += qbMoveBase;
  });
  const nCarries = ballScript.filter(s => s.phase === 'carry').length;
  // No carries to absorb the slack (e.g. snap → drop → throw): stretch the
  // fixed windows across the whole play so the throw lands as routes finish.
  // With carries, cap the fixed windows so the run still gets most of the play.
  const fixedScale = nCarries === 0
    ? 1 / Math.max(0.2, totalFixed)
    : Math.min(1, 0.6 / Math.max(0.2, totalFixed));
  const carryPool = Math.max(0.01, 1 - totalFixed * fixedScale);
  const carryTime  = nCarries > 0 ? carryPool / nCarries : 0.1;

  let cursor = 0;
  for (let i = 0; i < ballScript.length; i++) {
    const step = ballScript[i];
    const dur  = (step.phase === 'snap'    ? snapTime     :
                  step.phase === 'carry'   ? carryTime    :
                  step.phase === 'qbmove'  ? qbMoveBase   :
                  step.phase === 'fake'    ? fakeTime     :
                  transferTime) * (step.phase === 'carry' ? 1 : fixedScale);
    const end = cursor + dur;
    const isLast = i === ballScript.length - 1;
    if (playT <= end || isLast) {
      const localT = dur > 0 ? Math.max(0, Math.min(1, (playT - cursor) / dur)) : 1;
      const eT = localT < .5 ? 2*localT*localT : -1+(4-2*localT)*localT;
      return getBallPosForStep(step, eT, live);
    }
    cursor = end;
  }
  return null;
}

function getBallPosForStep(step, e, live) {
  // Live position of a player: animated during playback (2D or 3D), static otherwise
  const at = p => (anim || live)
    ? { x: p.animX ?? p.x, y: p.animY ?? p.y }
    : { x: p.x, y: p.y };
  const pAt = (pts, t) => {
    if (!pts || pts.length < 2) return pts?.[0] || null;
    const ci  = Math.max(0, Math.min(1, t));
    const idx = Math.min(pts.length-2, Math.floor(ci*(pts.length-1)));
    const loc = ci*(pts.length-1)-idx;
    const a = pts[idx], b = pts[idx+1]||a;
    return { x: a.x+(b.x-a.x)*loc, y: a.y+(b.y-a.y)*loc };
  };

  if (step.phase === 'snap') {
    const from = players.find(p => p.id === step.fromId);
    const to   = players.find(p => p.id === step.toId);
    if (!from || !to) return null;
    const fp = at(from), tp = at(to);
    const dist = Math.hypot(tp.x-fp.x, tp.y-fp.y);
    const arcH = step.isGun ? -dist*0.10 : -10;
    const pos = quadBezier(fp, { x:(fp.x+tp.x)/2, y:Math.min(fp.y,tp.y)+arcH }, tp, e);
    pos.h = step.isGun ? 1.2 + Math.sin(e*Math.PI)*0.5 : 0.7;
    pos.phase = 'snap';
    return pos;
  }

  if (step.phase === 'carry' || step.phase === 'qbmove' || step.phase === 'fake') {
    // Ball glued to the carrier — carriers are moved along their drawn paths
    // by the animation engine, so following the player follows the path.
    const carrier = players.find(p => p.id === step.carrierId);
    const pos = carrier ? at(carrier) : pAt(step.pts, e);
    if (!pos) return null;
    pos.h = 0.9;            // held at the belly
    pos.phase = step.phase;
    return pos;
  }

  if (step.phase === 'handoff') {
    const from = players.find(p => p.id === step.fromId);
    const to   = players.find(p => p.id === step.toId);
    if (!from || !to) return null;
    const fp = at(from), tp = at(to);
    const mesh = { x:(fp.x+tp.x)/2, y:(fp.y+tp.y)/2 };
    const pos = quadBezier(fp, mesh, tp, e);
    pos.h = 0.9;
    pos.phase = 'handoff';
    return pos;
  }

  if (step.phase === 'pass' || step.phase === 'lateral') {
    // Throw from where the passer actually is to where the receiver actually is.
    // Falls back to the drawn release/catch points for throws to open field.
    const from = players.find(p => p.id === step.fromId);
    const to   = step.toId != null ? players.find(p => p.id === step.toId) : null;
    const release = from ? at(from) : step.releasePt;
    const catchPt = to ? at(to) : step.catchPt;
    if (!release || !catchPt) return null;
    const dist = Math.hypot(catchPt.x-release.x, catchPt.y-release.y);
    const peak = step.phase === 'pass'
      ? { x:(release.x+catchPt.x)/2, y: Math.min(release.y,catchPt.y) - Math.max(18, dist*0.20) }
      : { x:(release.x+catchPt.x)/2, y: (release.y+catchPt.y)/2 + 12 };
    const pos = quadBezier(release, peak, catchPt, e);
    pos.h = step.phase === 'pass'
      ? 1.8 + Math.sin(e*Math.PI) * Math.max(2.0, dist/45)
      : 1.0 + Math.sin(e*Math.PI) * 0.5;
    pos.phase = step.phase;
    return pos;
  }

  return null;
}

function quadBezier(p0, p1, p2, t) {
  const u = 1-t;
  return { x: u*u*p0.x+2*u*t*p1.x+t*t*p2.x, y: u*u*p0.y+2*u*t*p1.y+t*t*p2.y };
}

// Ball-script carriers must actually run their drawn carry/qbmove paths.
// A carrier with no route/block otherwise stands still while the ball
// (glued to them) appears frozen — the old "handoff/run does nothing" bug.
// Used by both the 2D engine (runPlay) and the 3D POV engine.
function mergeCarrierTracks(tracks) {
  const carrierPts = {};
  ballScript.forEach(s => {
    if ((s.phase === 'carry' || s.phase === 'qbmove') && s.pts && s.pts.length > 1) {
      (carrierPts[s.carrierId] = carrierPts[s.carrierId] || []).push(...s.pts);
    }
  });
  Object.entries(carrierPts).forEach(([pid, pts]) => {
    const id = Number(pid);
    const hasPlay = routes.some(a => a.pid === id) || blocks.some(a => a.pid === id);
    if (hasPlay || !tracks[id]) return;
    // tracks[id][0] is the player's post-motion start position
    tracks[id] = [tracks[id][0], ...pts];
  });
}

// ═══════════════════════════════════════════════════════
function setMode(m) {
  mode = m;
  document.querySelectorAll('[id^=mode-]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('mode-' + m);
  if (btn) btn.classList.add('active');
  canvas.style.cursor = m === 'select' ? 'default' : 'crosshair';
}

function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

function hit(list, x, y, rad = 20) {
  return list.find(p => Math.hypot(p.x - x, p.y - y) < rad);
}

canvas.onmousedown = e => {
  if (anim) return;
  const m = pos(e);
  const off = hit(players, m.x, m.y);
  const def = hit(defenders, m.x, m.y);

  if (mode === 'select') {
    if (def) { selectObj('defense', def.id); pushHistory('Move defender'); drag = def; }
    else if (off) { selectObj('offense', off.id); pushHistory('Move player'); drag = off; }
    else { selected = { side: 'offense', id: null }; renderEditor(); buildList(); draw(); }
    return;
  }

  if (mode === 'ball') {
    // Draw-the-ball mode: draw a path FROM the current ball position
    // Auto-build snap if none exists yet
    if (!ballScript.find(s => s.phase === 'snap')) autoSnapScript(true);

    // Start drawing from the current ball endpoint
    const ballEnd = getBallEndpoint();
    ballDrawing = true;
    ballDrawPts = ballEnd ? [{ ...ballEnd }] : [{ x: m.x, y: m.y }];
    return;
  }

  // If a defender is selected, allow drawing their path in route/block/motion modes
  if (selected.side === 'defense' && selected.id !== null) {
    const d = defenders.find(x => x.id === selected.id);
    if (d) {
      drawing = true;
      drawPts = [{ x: d.x, y: d.y }];
      return;
    }
  }

  const p = obj();
  if (!p || selected.side !== 'offense') { status('Select an offensive or defensive player first.', 'error'); return; }
  drawing = true;
  drawPts = [{ x: p.x, y: p.y }];
};

canvas.onmousemove = e => {
  const m = pos(e);
  if (drag) { drag.x = m.x; drag.y = m.y; drag.ox = m.x; drag.oy = m.y; draw(); return; }
  if (ballDrawing) { ballDrawPts.push(m); if (ballDrawPts.length > 3) ballDrawPts = simplify(ballDrawPts, 7); draw(); return; }
  if (drawing) { drawPts.push(m); if (drawPts.length > 3) drawPts = simplify(drawPts, 7); draw(); }
};

canvas.onmouseup = e => {
  if (drag) { drag = null; renderEditor(); return; }

  // Ball draw finished — show popup
  if (ballDrawing) {
    ballDrawing = false;
    if (ballDrawPts.length > 2) {
      const simplified = simplify(ballDrawPts, 6);
      ballPending = { pts: simplified };
      const endPt = simplified[simplified.length - 1];
      // Pre-select popup title based on context
      const nearPlayer = hit(players, endPt.x, endPt.y, 28);
      const title = document.getElementById('ballPopupTitle');
      if (nearPlayer) {
        if (title) title.textContent = nearPlayer.pos === 'QB' ? 'QB Action' :
          ['WR','TE'].includes(nearPlayer.pos) ? 'Pass to ' + nearPlayer.label :
          ['RB','FB'].includes(nearPlayer.pos) ? 'Handoff to ' + nearPlayer.label :
          'Ball Action';
      } else {
        if (title) title.textContent = 'Ball Action';
      }
      showBallPopup(endPt.x, endPt.y);
    }
    ballDrawPts = [];
    draw();
    return;
  }

  if (!drawing) return;
  drawing = false;
  if (drawPts.length > 2) {
    pushHistory('Add assignment');
    if (selected.side === 'defense' && selected.id !== null) {
      defRoutes = defRoutes.filter(r => r.did !== selected.id);
      defRoutes.push({ did: selected.id, pts: simplify(drawPts, 9), manual: true });
      const d = defenders.find(x => x.id === selected.id);
      if (d) d.assignment = 'Custom path drawn';
      status('Defender path drawn. Will animate on Run.', 'success');
    } else {
      const type = mode === 'motion' ? 'motion' : mode === 'block' ? 'block' : 'route';
      const arr = type === 'motion' ? motions : type === 'block' ? blocks : routes;
      arr.push({ pid: selected.id, type, pts: simplify(drawPts, 9), manual: true });
      const p = obj();
      if (p) p.assignment = type === 'route' ? 'Manual route' : type === 'block' ? 'Manual block' : 'Pre-snap motion';
      status('Assignment added.', 'success');
    }
    buildList();
  }
  drawPts = []; draw();
};

canvas.onmouseleave = () => {
  drag = null;
  if (ballDrawing) { ballDrawing = false; ballDrawPts = []; draw(); }
  if (drawing) { drawing = false; drawPts = []; draw(); }
};

function simplify(pts, d) {
  let out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (Math.hypot(a.x - b.x, a.y - b.y) >= d) out.push(b);
  }
  return out;
}

// ─────────────────────────────────────────────
// DEFENSIVE REACTION AI
// ─────────────────────────────────────────────
function computeDefenderTracks() {
  const reactionMode = document.getElementById('defReactionMode')?.value || 'ai';
  const coverage = document.getElementById('coverage').value;
  const front = document.getElementById('defFront').value;
  const center = players.find(p => p.label === 'C') || { x: W * .5 };

  const hasRun = !!ballPath || routes.some(r => r.kind === 'carry');
  const hasPass = routes.some(r => r.kind !== 'carry' && r.type === 'route');
  const isPlayAction = routes.some(r => r.playAction) || motions.some(m => m.playAction);

  let runDir = 0;
  if (hasRun && ballPath && ballPath.length >= 2) {
    runDir = ballPath[ballPath.length - 1].x > center.x ? 1 : -1;
  }

  const defTracks = {};

  defenders.forEach(d => {
    // Check for a manually drawn custom path
    const customPath = defRoutes.find(r => r.did === d.id);

    if (customPath) {
      // Always use custom path if one exists
      defTracks[d.id] = customPath.pts;
      return;
    }

    // No custom path — check if AI mode is on
    if (reactionMode === 'ai' || reactionMode === 'both') {
      // Build AI reaction path
      let pts = [{ x: d.x, y: d.y }];
      const pos = d.pos;

      if (pos === 'DL') {
        if (hasRun) {
          const flowX = d.x + runDir * 45 + (d.x > center.x ? 12 : -12);
          const flowY = d.y + 28;
          pts.push({ x: d.x + runDir * 18, y: d.y + 10 });
          pts.push({ x: flowX, y: flowY });
        } else {
          const qb = players.find(p => p.pos === 'QB');
          const targetX = qb ? qb.x + (d.x - qb.x) * 0.15 : d.x;
          const targetY = qb ? qb.y - 8 : LOS + 50;
          pts.push({ x: d.x + (d.x > center.x ? 18 : -18), y: d.y + 16 });
          pts.push({ x: targetX, y: targetY });
        }
      } else if (pos === 'LB') {
        if (hasRun) {
          const fillX = center.x + runDir * 38 + (d.x - center.x) * 0.3;
          const fillY = LOS + 15;
          pts.push({ x: d.x + runDir * 20, y: d.y + 12 });
          pts.push({ x: fillX, y: fillY });
        } else if (isPlayAction) {
          pts.push({ x: d.x + runDir * 28, y: d.y + 14 });
          pts.push({ x: d.x + runDir * 10, y: d.y + 5 });
          const drop = getDropTarget(d, coverage, center);
          pts.push({ x: drop.x, y: drop.y });
        } else {
          const drop = getDropTarget(d, coverage, center);
          pts.push({ x: d.x, y: d.y - 8 });
          pts.push({ x: drop.x, y: drop.y });
        }
      } else if (pos === 'CB') {
        const nearestWR = findNearestReceiver(d, players);
        if (nearestWR) {
          const wrRoute = routes.find(r => r.pid === nearestWR.id && r.type === 'route');
          if (wrRoute && wrRoute.pts && wrRoute.pts.length > 1) {
            const routeMid = wrRoute.pts[Math.floor(wrRoute.pts.length / 2)];
            const routeEnd = wrRoute.pts[wrRoute.pts.length - 1];
            if (coverage.includes('Man') || coverage.includes('Zero')) {
              pts.push({ x: nearestWR.x + (d.x - nearestWR.x) * 0.4, y: nearestWR.y - 10 });
              pts.push({ x: routeMid.x + (d.x - nearestWR.x) * 0.2, y: routeMid.y });
              pts.push({ x: routeEnd.x, y: routeEnd.y + 12 });
            } else {
              const drop = getCBZoneDrop(d, coverage, center);
              pts.push({ x: d.x, y: d.y - 12 });
              pts.push({ x: drop.x, y: drop.y });
            }
          } else {
            const drop = getCBZoneDrop(d, coverage, center);
            pts.push({ x: d.x, y: d.y - 12 });
            pts.push({ x: drop.x, y: drop.y });
          }
        } else {
          pts.push({ x: d.x, y: d.y - 20 });
        }
      } else if (pos === 'S') {
        const rotDrop = getSafetyDrop(d, coverage, center, hasRun, runDir);
        pts.push({ x: d.x, y: d.y - 6 });
        pts.push({ x: rotDrop.x, y: rotDrop.y });
      }

      defTracks[d.id] = pts.length > 1 ? pts : [{ x: d.x, y: d.y }, { x: d.x, y: d.y }];
    } else {
      // Custom-only mode, no custom path drawn → defender stays put
      defTracks[d.id] = [{ x: d.x, y: d.y }, { x: d.x, y: d.y }];
    }
  });

  return defTracks;
}

function findNearestReceiver(def, players) {
  const receivers = players.filter(p => ['WR','TE','RB','FB'].includes(p.pos));
  if (!receivers.length) return null;
  return receivers.reduce((best, r) =>
    Math.hypot(r.x - def.x, r.y - def.y) < Math.hypot(best.x - def.x, best.y - def.y) ? r : best
  );
}

function getDropTarget(lb, coverage, center) {
  const isLeft = lb.x < center.x;
  if (coverage.includes('Cover 3') || coverage.includes('Tampa')) {
    return { x: lb.x + (isLeft ? -20 : 20), y: lb.y - 55 };
  } else if (coverage.includes('Cover 2')) {
    return { x: lb.x + (isLeft ? -15 : 15), y: lb.y - 45 };
  } else if (coverage.includes('Cover 4') || coverage.includes('Quarters')) {
    return { x: lb.x, y: lb.y - 50 };
  } else if (coverage.includes('Man') || coverage.includes('Zero')) {
    // Man — LB finds his man (nearest back/TE)
    return { x: lb.x + (isLeft ? -25 : 25), y: lb.y - 40 };
  }
  return { x: lb.x, y: lb.y - 45 };
}

function getCBZoneDrop(cb, coverage, center) {
  const isLeft = cb.x < center.x;
  const side = isLeft ? -1 : 1;
  if (coverage.includes('Cover 3')) {
    return { x: cb.x + side * 15, y: cb.y - 60 }; // third of field deep
  } else if (coverage.includes('Cover 2') || coverage.includes('Tampa')) {
    return { x: cb.x + side * 30, y: cb.y - 30 }; // flat/curl
  } else if (coverage.includes('Cover 4') || coverage.includes('Quarters')) {
    return { x: cb.x + side * 10, y: cb.y - 55 }; // quarter
  } else if (coverage.includes('Cover 6')) {
    return isLeft
      ? { x: cb.x + side * 30, y: cb.y - 32 } // field side = cover 2 half
      : { x: cb.x + side * 10, y: cb.y - 60 }; // boundary = cover 4 quarter
  }
  return { x: cb.x, y: cb.y - 50 };
}

function getSafetyDrop(s, coverage, center, hasRun, runDir) {
  const isLeft = s.x < center.x;
  if (hasRun) {
    // Safety rotates down to support the run side
    return { x: s.x + runDir * 60, y: s.y + 25 };
  }
  if (coverage.includes('Cover 3') || coverage.includes('Tampa')) {
    // One deep middle safety
    return { x: center.x + (isLeft ? -35 : 35), y: s.y - 30 };
  } else if (coverage.includes('Cover 2')) {
    // Two deep halves
    return { x: s.x + (isLeft ? -20 : 20), y: s.y - 35 };
  } else if (coverage.includes('Cover 4') || coverage.includes('Quarters')) {
    return { x: s.x + (isLeft ? -15 : 15), y: s.y - 40 };
  } else if (coverage.includes('Man Free')) {
    // Single high free safety stays deep center
    const isFree = s.label.includes('F') || s.label.includes('FS');
    return isFree
      ? { x: center.x, y: s.y - 25 }
      : { x: s.x + runDir * 25, y: s.y + 10 }; // SS comes down
  } else if (coverage.includes('Zero')) {
    // Zero blitz — safety blitzes or covers down
    return { x: s.x + (isLeft ? -30 : 30), y: s.y + 30 };
  }
  return { x: s.x, y: s.y - 25 };
}

// ─────────────────────────────────────────────
// PREVIEW DEFENSIVE REACTIONS (without running play)
// ─────────────────────────────────────────────
function previewDefReactions() {
  const all = [...motions, ...routes, ...blocks];
  if (!all.length && !ballPath) { status('Generate an offensive play first to preview reactions.', 'error'); return; }
  const tracks = computeDefenderTracks();
  // Draw preview arrows on the field showing where each defender will go
  defenders.forEach(d => {
    const pts = tracks[d.id];
    if (pts && pts.length > 1) {
      d._previewPts = pts;
    }
  });
  drawWithPreview(tracks);
  status('Preview: auto reaction paths shown in red. Draw custom paths to override.', 'success');
}

function drawWithPreview(tracks) {
  drawFrame(null); // normal draw first
  if (!tracks) return;
  defenders.forEach(d => {
    const pts = tracks[d.id];
    if (pts && pts.length > 1) drawPath(pts, '#ff5555', true, 1.8);
  });
}

// ─────────────────────────────────────────────
// 2D PLAYBACK CONTROLS
// ─────────────────────────────────────────────
function togglePaths() {
  showPaths = !showPaths;
  const btn = document.getElementById('btnPaths');
  if (btn) btn.classList.toggle('active', showPaths);
  draw();
  status(showPaths ? 'Paths visible.' : 'Paths hidden — players only.', 'success');
}

function setAnimSpeed(s) {
  animSpeed = s;
  document.querySelectorAll('.bar-row3 .btn').forEach(b => {
    const lbl = b.textContent.trim();
    if (['¼×','½×','1×','2×'].includes(lbl)) b.classList.remove('active');
  });
  const map = { 0.25:'¼×', 0.5:'½×', 1:'1×', 2:'2×' };
  document.querySelectorAll('.bar-row3 .btn').forEach(b => {
    if (b.textContent.trim() === map[s]) b.classList.add('active');
  });
  // Recalculate T0 so speed change doesn't jump position
  if (anim && !animPaused) {
    animT0 = performance.now() - (animProgress * animTotalMs / Math.max(animSpeed, 0.01));
  }
}

function toggleAnimPause() {
  if (!anim && animProgress === 0) { runPlay(); return; }
  animPaused = !animPaused;
  const btn = document.getElementById('animPauseBtn');
  if (btn) btn.textContent = animPaused ? '▶' : '⏸';
  if (!animPaused && anim) {
    // Resume — recalc T0 from current progress
    animT0 = performance.now() - (animProgress * animTotalMs / Math.max(animSpeed, 0.01));
    raf = requestAnimationFrame(animStepRef);
  }
}

function stepAnim(dir) {
  animPaused = true;
  const btn = document.getElementById('animPauseBtn');
  if (btn) btn.textContent = '▶';
  animProgress = Math.max(0, Math.min(1, animProgress + dir * 0.02));
  updateAnimScrubUI();
  if (animRenderFn) animRenderFn(animProgress);
}

function scrubAnim(val) {
  animPaused = true;
  const btn = document.getElementById('animPauseBtn');
  if (btn) btn.textContent = '▶';
  animProgress = Number(val) / 100;
  updateAnimScrubUI();
  if (animRenderFn) animRenderFn(animProgress);
}

function updateAnimScrubUI() {
  const scrub = document.getElementById('animScrub');
  const lbl   = document.getElementById('animProgressLbl');
  if (scrub) scrub.value = Math.round(animProgress * 100);
  if (lbl)   lbl.textContent = Math.round(animProgress * 100) + '%';
}

let animStepRef = null; // reference to rAF step for resume

// ─────────────────────────────────────────────
// ANIMATION ENGINE — two-phase: motion → snap → play
// ─────────────────────────────────────────────
function runPlay() {
  if (anim && !animPaused) return;
  const allActions = [...motions, ...routes, ...blocks];
  if (!allActions.length && !ballScript.length) {
    status('Add routes, blocking, or a ball script first.', 'error'); return;
  }

  anim = true;
  animPaused = false;
  if (animProgress >= 1) animProgress = 0; // restart if finished

  // Show playback row
  const row3 = document.getElementById('playbackRow');
  if (row3) row3.classList.remove('hidden');

  const progEl = document.getElementById('animProgress');
  if (progEl) progEl.classList.add('active');
  const pauseBtn = document.getElementById('animPauseBtn');
  if (pauseBtn) pauseBtn.textContent = '⏸';

  const hasMotion = motions.length > 0;
  const MOTION_END = hasMotion ? 0.28 : 0;
  const PLAY_START = MOTION_END;
  animTotalMs = hasMotion ? 4200 : 3400;

  players.forEach(p  => { p.animX = p.x; p.animY = p.y; });
  defenders.forEach(d => { d.animX = d.x; d.animY = d.y; });

  // ── Build tracks ─────────────────────────────
  const motionTracks = {};
  const playTracks   = {};

  players.forEach(p => {
    const pMotions = motions.filter(a => a.pid === p.id);
    const pPlay    = [...routes, ...blocks].filter(a => a.pid === p.id);
    if (pMotions.length) {
      let pts = [];
      pMotions.forEach(a => {
        const seg = a.pts?.length ? a.pts : [{ x: p.x, y: p.y }, { x: p.x, y: p.y }];
        pts = pts.concat(pts.length ? seg.slice(1) : seg);
      });
      motionTracks[p.id] = pts;
    }
    const startPos = motionTracks[p.id]
      ? motionTracks[p.id][motionTracks[p.id].length - 1]
      : { x: p.x, y: p.y };
    if (pPlay.length) {
      let pts = [startPos];
      pPlay.forEach(a => {
        let seg = a.pts?.length ? a.pts : [startPos, startPos];
        if (a.type === 'block') {
          const last = seg[seg.length - 1];
          const prev = seg.length >= 2 ? seg[seg.length - 2] : seg[0];
          seg = [...seg, { x: last.x+(last.x-prev.x)*.15, y: last.y+(last.y-prev.y)*.15 }];
        }
        pts = pts.concat(seg.slice(1));
      });
      playTracks[p.id] = pts;
    } else {
      playTracks[p.id] = [startPos, startPos];
    }
  });

  mergeCarrierTracks(playTracks);

  const defTracks        = computeDefenderTracks();
  const isThrowPlay      = ballPath && ballPath._isThrow;
  const throwDelay       = isThrowPlay ? (ballPath._throwDelay || 0.58) : 0;
  const QB_COMPLETE_AT   = 0.62;
  const OL_COMPLETE_AT   = 0.75;

  function playerProgress(p, playRaw) {
    const isQB = p.pos === 'QB' || p.label === 'QB';
    const isOL = p.pos === 'OL' || ['LT','LG','C','RG','RT'].includes(p.label);
    if (isQB) return Math.min(playRaw / QB_COMPLETE_AT, 1.0);
    if (isOL) return Math.min(playRaw / OL_COMPLETE_AT, 1.0);
    return playRaw;
  }

  function ptAt(pts, e) {
    if (!pts || pts.length < 2) return pts ? pts[0] : { x: 0, y: 0 };
    const cl = Math.max(0, Math.min(1, e));
    const idx = Math.min(pts.length - 2, Math.floor(cl * (pts.length - 1)));
    const loc = cl * (pts.length - 1) - idx;
    const a = pts[idx], b = pts[idx+1] || a;
    return { x: a.x+(b.x-a.x)*loc, y: a.y+(b.y-a.y)*loc };
  }

  function eIO(t) { return t < .5 ? 2*t*t : -1+(4-2*t)*t; }

  // ── Shared render-at-progress (used by rAF AND scrub/step) ──
  function renderAt2D(raw) {
    let footballPos = null;

    players.forEach(p => {
      if (hasMotion && raw < MOTION_END) {
        const motE = eIO(raw / MOTION_END);
        if (motionTracks[p.id]) { const pt = ptAt(motionTracks[p.id], motE); p.animX = pt.x; p.animY = pt.y; }
      } else {
        const playRaw = hasMotion ? (raw - PLAY_START) / (1 - PLAY_START) : raw;
        const pt = ptAt(playTracks[p.id], eIO(playerProgress(p, playRaw)));
        p.animX = pt.x; p.animY = pt.y;
      }
    });

    defenders.forEach(d => {
      if (hasMotion && raw < MOTION_END) return;
      const playRaw = hasMotion ? (raw - PLAY_START) / (1 - PLAY_START) : raw;
      const pts = defTracks[d.id] || [{ x: d.x, y: d.y }];
      const pt = ptAt(pts.length > 1 ? pts : [pts[0], pts[0]], eIO(playRaw));
      d.animX = pt.x; d.animY = pt.y;
    });

    if (isThrowPlay && !ballScript.length) {
      const playRaw = hasMotion ? (raw - PLAY_START) / (1 - PLAY_START) : raw;
      if (playRaw >= throwDelay) {
        const throwT = Math.min((playRaw - throwDelay) / (1 - throwDelay), 1);
        footballPos = arcPt(ballPath[0], ballPath[1], ballPath[2], throwT);
      }
    }
    if (ballScript.length) footballPos = getBallPos(raw, hasMotion, MOTION_END) || footballPos;

    drawFrame(footballPos);

    if (hasMotion && raw >= MOTION_END - 0.02 && raw <= MOTION_END + 0.02) {
      ctx.fillStyle = 'rgba(255,220,0,0.85)';
      ctx.font = '900 18px Barlow Condensed';
      ctx.textAlign = 'center';
      ctx.fillText('SET — HIKE', W / 2, LOS - 14);
      ctx.textAlign = 'left';
    }

    animProgress = raw;
    updateAnimScrubUI();
  }

  // Expose for scrub/step
  animRenderFn = renderAt2D;

  // Start timing from current progress
  animT0 = performance.now() - (animProgress * animTotalMs / Math.max(animSpeed, 0.01));

  function step(t) {
    if (!anim) return;
    if (animPaused) { raf = requestAnimationFrame(step); return; } // idle while paused

    const elapsed = (t - animT0) * animSpeed;
    const raw = Math.min(elapsed / animTotalMs, 1);

    renderAt2D(raw);

    if (raw >= 1) {
      setTimeout(() => stopPlay(true), 450);
      return;
    }
    raf = requestAnimationFrame(step);
  }

  animStepRef = step;
  raf = requestAnimationFrame(step);
  status(hasMotion ? 'Motion → snap → play...' : 'Running...', 'loading');
}

function stopPlay(done = false) {
  anim = false;
  animPaused = false;
  if (animProgress >= 1) animProgress = 0; // reset for next run
  if (raf) cancelAnimationFrame(raf);
  players.forEach(p => { p.animX = p.x; p.animY = p.y; });
  defenders.forEach(d => { d.animX = d.x; d.animY = d.y; });
  const progEl = document.getElementById('animProgress');
  if (progEl) progEl.classList.remove('active');

  // Hide row 3
  const row3 = document.getElementById('playbackRow');
  if (row3) row3.classList.add('hidden');
  const pauseBtn = document.getElementById('animPauseBtn');
  if (pauseBtn) pauseBtn.textContent = '⏸';
  updateAnimScrubUI();

  if (isRecording) stopVideoRecording();
  drawFrame(null);
  if (!isRecording) status(done ? 'Play complete.' : 'Stopped.', done ? 'success' : '');
}

// ─────────────────────────────────────────────
// DRAW ENGINE
// ─────────────────────────────────────────────
function draw() { drawFrame(null); }

function drawFrame(footballPos) {
  ctx.clearRect(0, 0, W, H);
  drawField();

  // Only draw path lines when showPaths is true
  if (showPaths) {
    drawLines(motions, '#3498db', false);
    drawLines(routes, '#f5c842', false);
    drawLines(blocks, '#e74c3c', true);
    drawBallScriptPaths();

    // Legacy ballPath
    if (ballPath && !ballScript.length) {
      if (ballPath._isThrow) {
        drawThrowArc(ballPath[0], ballPath[1], ballPath[2], 'rgba(255,180,40,.45)');
      } else {
        drawPath(ballPath, '#d8892b', false, 5);
      }
    }

    defRoutes.forEach(dr => drawPath(dr.pts, '#ff9090', true, 2.2));
  }

  if (drawing && drawPts.length > 1) {
    const isDefDraw = selected.side === 'defense' && selected.id !== null;
    drawPath(drawPts, isDefDraw ? '#ff9090' : mode === 'block' ? '#e74c3c' : mode === 'motion' ? '#3498db' : '#f5c842', true, 2);
  }

  // Ball draw preview — always show even when paths hidden
  if (ballDrawing && ballDrawPts.length > 1) {
    const start = ballDrawPts[0];
    const end   = ballDrawPts[ballDrawPts.length - 1];
    const dist  = Math.hypot(end.x - start.x, end.y - start.y);
    const nearRec  = hit(players.filter(p => ['WR','TE'].includes(p.pos)), end.x, end.y, 32);
    const nearBack = hit(players.filter(p => ['RB','FB'].includes(p.pos)), end.x, end.y, 32);
    const previewColor = nearBack ? '#e67e22' : nearRec ? '#f5c842' : dist > 80 ? '#f5c842' : '#e67e22';
    drawPath(ballDrawPts, previewColor, true, 3);
    drawFootball(end.x, end.y);
  }

  drawPeople(defenders, true);
  drawPeople(players, false);

  const ballPos = footballPos || (ballScript.length ? getStaticBallPos() : null);
  if (ballPos) drawFootball(ballPos.x, ballPos.y);
}

// Draw the ball script paths as colored lines on the static diagram
function drawBallScriptPaths() {
  for (const step of ballScript) {
    if (step.phase === 'snap') {
      const from = players.find(p => p.id === step.fromId);
      const to   = players.find(p => p.id === step.toId);
      if (from && to) {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        if (dist > 50) {
          // Shotgun — dashed arc
          drawThrowArc({ x: from.x, y: from.y },
            { x: (from.x+to.x)/2, y: Math.min(from.y,to.y) - dist*0.10 },
            { x: to.x, y: to.y }, 'rgba(255,255,255,0.55)');
        } else {
          // Under center — short white dashed line
          drawPath([{ x: from.x, y: from.y }, { x: to.x, y: to.y }], 'rgba(255,255,255,0.55)', true, 2);
        }
        // Football icon on center (static diagram only — animation draws the live ball)
        if (!anim) drawFootball(from.x, from.y);
      }

    } else if (step.phase === 'carry' || step.phase === 'qbmove') {
      const carrier = players.find(p => p.id === step.carrierId);
      if (carrier && step.pts && step.pts.length > 1) {
        const color = step.phase === 'qbmove' ? '#a0d8f0' : '#e67e22'; // light blue for QB move, orange for carry
        drawPath(step.pts, color, false, step.phase === 'qbmove' ? 2.5 : 4);
        // Football icon at end of carry/QB move (static diagram only)
        if (!anim) {
          const endPt = step.pts[step.pts.length - 1];
          drawFootball(endPt.x, endPt.y);
        }
      }

    } else if (step.phase === 'fake') {
      // Orange DASHED line = fake (not real ball movement)
      if (step.pts && step.pts.length > 1) {
        drawPath(step.pts, 'rgba(230,126,34,0.65)', true, 2.5);
        // FAKE label at end
        const ep = step.pts[step.pts.length - 1];
        ctx.fillStyle = 'rgba(230,126,34,0.85)';
        ctx.font = '700 9px Barlow Condensed';
        ctx.textAlign = 'center';
        ctx.fillText('FAKE', ep.x, ep.y - 12);
        ctx.textAlign = 'left';
      }

    } else if (step.phase === 'handoff') {
      const from = players.find(p => p.id === step.fromId);
      const to   = players.find(p => p.id === step.toId);
      if (from && to) {
        const mesh = step.meshPt || { x:(from.x+to.x)/2, y:(from.y+to.y)/2 };
        drawThrowArc({ x: from.x, y: from.y }, mesh, { x: to.x, y: to.y }, 'rgba(230,126,34,0.75)');
      }

    } else if (step.phase === 'pass') {
      if (step.releasePt && step.arcPeak && step.catchPt) {
        drawThrowArc(step.releasePt, step.arcPeak, step.catchPt, 'rgba(245,200,66,0.85)');
      }

    } else if (step.phase === 'lateral') {
      if (step.releasePt && step.arcPeak && step.catchPt) {
        drawThrowArc(step.releasePt, step.arcPeak, step.catchPt, 'rgba(52,152,219,0.75)');
      }
    }
  }
}

function getStaticBallPos() {
  // Show ball at snap position (on center) when not animating
  const center = players.find(p => p.label === 'C');
  if (ballScript.length && ballScript[0]?.phase === 'snap') {
    const fromP = players.find(p => p.id === ballScript[0].fromId);
    return fromP ? { x: fromP.x, y: fromP.y } : null;
  }
  return center ? { x: center.x, y: center.y } : null;
}

function drawThrowArc(p0, p1, p2, color) {
  if (!p0 || !p1 || !p2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  // Bezier curve through the arc peak
  ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrow at catch point
  arrow({ x: p1.x * 0.5 + p2.x * 0.5, y: p1.y * 0.5 + p2.y * 0.5 }, p2, color);
}

function drawFootball(x, y) {
  ctx.save();
  // Outer shape — brown ellipse
  ctx.beginPath();
  ctx.ellipse(x, y, 11, 6, -0.45, 0, Math.PI * 2);
  ctx.fillStyle = '#8B4513';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
  // White laces stripe
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 1);
  ctx.lineTo(x + 3, y + 1);
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Small lace hash marks
  for (let i = -2; i <= 2; i += 2) {
    ctx.beginPath();
    ctx.moveTo(x + i * 0.8 - 1, y + i * 0.4 - 2);
    ctx.lineTo(x + i * 0.8 + 1, y + i * 0.4 + 2);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawField() {
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#285215' : '#2a5518';
    ctx.fillRect(0, i * H / 10, W, H / 10);
  }
  // Yard lines
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const y = i * H / 10;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // Hash marks
  ctx.strokeStyle = 'rgba(255,255,255,.3)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) {
    const y = i * H / 10;
    for (const hx of [W * .33, W * .67]) {
      ctx.beginPath(); ctx.moveTo(hx - 6, y); ctx.lineTo(hx + 6, y); ctx.stroke();
    }
  }
  // LOS
  ctx.strokeStyle = 'rgba(255,220,0,.7)';
  ctx.setLineDash([10, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, LOS); ctx.lineTo(W, LOS); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,220,0,.6)';
  ctx.font = '700 10px Barlow Condensed';
  ctx.fillText('LINE OF SCRIMMAGE', 8, LOS - 5);
  // End zone
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  ctx.fillRect(0, 0, W, H * .08);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.font = '900 20px Barlow Condensed';
  ctx.textAlign = 'center';
  ctx.fillText('END ZONE', W / 2, H * .055);
  ctx.textAlign = 'left';
}

function drawPeople(list, isDef) {
  list.forEach(p => {
    const x = anim ? p.animX || p.x : p.x;
    const y = anim ? p.animY || p.y : p.y;
    const r = isDef ? DEF_RADIUS : PLAYER_RADIUS;
    const sel = selected.id === p.id && selected.side === (isDef ? 'defense' : 'offense');

    // Selection halo
    if (sel) {
      ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.fillStyle = (p.color || '#fff') + '33'; ctx.fill();
      ctx.strokeStyle = p.color || '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Shadow
    ctx.beginPath(); ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();

    // Body
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color || '#999'; ctx.fill();
    ctx.strokeStyle = sel ? '#fff' : isDef ? '#ff8080' : 'rgba(0,0,0,.6)';
    ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();

    // Label
    ctx.fillStyle = isDef ? '#ffe0e0' : '#060606';
    ctx.font = `900 ${isDef ? 9 : p.label.length > 3 ? 8 : 10}px Barlow Condensed`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.label.slice(0, 4), x, y);
    ctx.textBaseline = 'alphabetic';
  });
  ctx.textAlign = 'left';
}

function drawLines(arr, color, dash) {
  arr.forEach(a => drawPath(a.pts, color, dash, 2.8));
}

function drawPath(pts, color, dash, lw) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dash ? [7, 5] : []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (pts.length >= 2) arrow(pts[pts.length - 2], pts[pts.length - 1], color);
}

function arrow(a, b, c) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = 10;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - s * Math.cos(ang - .42), b.y - s * Math.sin(ang - .42));
  ctx.lineTo(b.x - s * Math.cos(ang + .42), b.y - s * Math.sin(ang + .42));
  ctx.closePath(); ctx.fill();
}

// ─────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────
function status(t, c) {
  const e = document.getElementById('status');
  e.textContent = t;
  e.className = 'status ' + (c || '');
}

function switchRTab(tab) {
  document.querySelectorAll('.rtab').forEach((el, i) => {
    const tabs = ['editor','plays','legend'];
    el.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.rtab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'rtab-' + tab);
  });
}

// ─────────────────────────────────────────────
// SAVE / LOAD / EXPORT
// ─────────────────────────────────────────────

// Serialize — store ballPath throw metadata properly (not as array props)
function serialize() {
  const bp = ballPath ? {
    pts: ballPath,
    isThrow: !!ballPath._isThrow,
    throwDelay: ballPath._throwDelay || 0,
    targetId: ballPath._targetId || null
  } : null;

  return {
    version: 7,
    name: document.getElementById('playName').value || 'Untitled Play',
    formation: currentFormation, flipped,
    teamColorOff, teamColorDef,
    players, defenders, routes, blocks, motions, defRoutes,
    ballPath: bp, ballScript,
    date: Date.now()
  };
}

// Restore from serialized object
function deserialize(data) {
  players      = data.players      || [];
  defenders    = data.defenders    || [];
  routes       = data.routes       || [];
  blocks       = data.blocks       || [];
  motions      = data.motions      || [];
  defRoutes    = data.defRoutes    || [];
  currentFormation = data.formation || 'Shotgun';
  flipped      = data.flipped      || false;
  ballScript   = data.ballScript   || [];

  // Restore team colors if saved
  if (data.teamColorOff) {
    teamColorOff = data.teamColorOff;
    const offPicker = document.getElementById('teamColorOffPicker');
    if (offPicker) offPicker.value = teamColorOff;
  }
  if (data.teamColorDef) {
    teamColorDef = data.teamColorDef;
    const defPicker = document.getElementById('teamColorDefPicker');
    if (defPicker) defPicker.value = teamColorDef;
  }

  // Restore ballPath with throw metadata
  if (data.ballPath) {
    const bp = data.ballPath.pts || data.ballPath; // handle both formats
    ballPath = bp;
    if (data.ballPath.isThrow) {
      ballPath._isThrow    = true;
      ballPath._throwDelay = data.ballPath.throwDelay || 0.58;
      ballPath._targetId   = data.ballPath.targetId   || null;
    }
  } else {
    ballPath = null;
  }

  document.getElementById('playName').value = data.name || '';
  selected = { side: 'offense', id: null };
  updateFlipButton();
  buildList(); renderEditor(); draw();
}

// ── Download as .pdpro file ──────────────────
function savePlay() {
  const data = serialize();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const safeName = (data.name || 'play').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.href     = url;
  a.download = safeName + '.pdpro';
  a.click();
  URL.revokeObjectURL(url);
  status('Downloaded "' + data.name + '.pdpro" — load it back with Open.', 'success');
  refreshSavedList(); // also keep in session list
}

// ── Session memory (in-page only, lost on refresh — user has .pdpro for persistence) ──
const sessionPlays = [];

function saveToSession() {
  const data = serialize();
  const existing = sessionPlays.findIndex(p => p.name === data.name);
  if (existing >= 0) sessionPlays[existing] = data;
  else sessionPlays.unshift(data);
  refreshSavedList();
  status('Saved "' + data.name + '" to session. Hit 💾 Save to download a .pdpro file.', 'success');
}

function refreshSavedList() {
  const s = document.getElementById('saved');
  if (!s) return;
  if (!sessionPlays.length) {
    s.innerHTML = '<option value="">No session plays yet...</option>';
    return;
  }
  s.innerHTML = '<option value="">Load session play...</option>' +
    sessionPlays.map((p, i) =>
      `<option value="${i}">${p.name} · ${new Date(p.date).toLocaleTimeString()}</option>`
    ).join('');
}
// Keep old name working
function refreshSaved() { refreshSavedList(); }

function loadSaved(i) {
  if (i === '') return;
  const data = sessionPlays[+i];
  if (!data) return;
  deserialize(data);
  status('Loaded "' + data.name + '".', 'success');
}

// ── Open .pdpro file ─────────────────────────
function openPlayFile() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.pdpro,.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        deserialize(data);
        // Also add to session list so it shows in the dropdown
        const existing = sessionPlays.findIndex(p => p.name === data.name);
        if (existing >= 0) sessionPlays[existing] = data;
        else sessionPlays.unshift(data);
        refreshSavedList();
        status('Opened "' + data.name + '" successfully.', 'success');
      } catch(err) {
        status('Could not read file — make sure it\'s a .pdpro save file.', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Copy JSON to clipboard ───────────────────
function copyJSON() {
  try {
    navigator.clipboard.writeText(JSON.stringify(serialize(), null, 2));
    status('Copied play JSON to clipboard.', 'success');
  } catch (e) {
    status('Copy not supported — use 💾 Save to download instead.', 'error');
  }
}

function clearDefPaths() {
  pushHistory('Clear def paths');
  defRoutes = [];
  defenders.forEach(d => {
    if (d.assignment === 'Custom path drawn') d.assignment = document.getElementById('coverage').value;
  });
  draw();
  status('Defender custom paths cleared.', 'success');
}

function clearOneDefPath(did) {
  pushHistory('Clear one def path');
  defRoutes = defRoutes.filter(r => r.did !== did);
  const d = defenders.find(x => x.id === did);
  if (d && d.assignment === 'Custom path drawn') d.assignment = document.getElementById('coverage').value;
  renderEditor(); draw();
  status('Custom path removed — auto reactions can apply.', 'success');
}

function resetAll() {
  pushHistory('Reset all');
  routes = []; blocks = []; motions = []; ballPath = null; defRoutes = [];
  loadFormation(currentFormation);
  autoDefense();
}

function hardReset() {
  if (!confirm('Reset everything? This will clear all routes, blocks, motions, formation, and defense.')) return;
  historyStack = []; redoStack = [];
  routes = []; blocks = []; motions = []; ballPath = null; defRoutes = []; ballScript = [];
  selected = { side: 'offense', id: null };
  document.getElementById('playName').value = '';
  loadFormation('Shotgun');
  autoDefense();
  status('Everything reset.', 'success');
}

function exportPNG() {
  const a = document.createElement('a');
  const n = (document.getElementById('playName').value || 'play-designer-pro').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = n + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  status('PNG exported.', 'success');
}

// ─────────────────────────────────────────────
// VIDEO EXPORT — MediaRecorder → WebM download
// ─────────────────────────────────────────────
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function startVideoRecording() {
  if (!canvas.captureStream) {
    status('Video recording not supported in this browser. Use Chrome or Edge.', 'error');
    return false;
  }
  try {
    recordedChunks = [];
    const stream = canvas.captureStream(30); // 30fps
    const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? { mimeType: 'video/webm;codecs=vp9' }
      : MediaRecorder.isTypeSupported('video/webm')
        ? { mimeType: 'video/webm' }
        : {};
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => saveVideoFile();
    mediaRecorder.start(100); // collect chunks every 100ms
    isRecording = true;
    return true;
  } catch (err) {
    status('Could not start recording: ' + err.message, 'error');
    return false;
  }
}

function stopVideoRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
  }
}

function saveVideoFile() {
  if (!recordedChunks.length) return;
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const n    = (document.getElementById('playName').value || 'play').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.href     = url;
  a.download = n + '.webm';
  a.click();
  URL.revokeObjectURL(url);
  recordedChunks = [];
  status('Video saved as .webm — opens in Chrome, VLC, or Firefox. Convert to MP4 with VLC if needed.', 'success');
}

function exportVideo() {
  if (anim) { status('Stop the animation before recording.', 'error'); return; }
  if (!canvas.captureStream) {
    status('Video export needs Chrome or Edge. On Safari, use Cmd+Shift+5 screen record.', 'error');
    return;
  }
  const ok = startVideoRecording();
  if (ok) {
    runPlay();
    status('Recording started — video saves automatically when animation finishes.', 'loading');
  }
}

// ─────────────────────────────────────────────
// TOUCH EVENTS
// ─────────────────────────────────────────────
['touchstart','touchmove','touchend','touchcancel'].forEach(ev =>
  canvas.addEventListener(ev, e => e.preventDefault(), { passive: false }));
canvas.addEventListener('touchstart', e => {
  const t = e.touches[0];
  if (t) canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
});
canvas.addEventListener('touchmove', e => {
  const t = e.touches[0];
  if (t) canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
});
canvas.addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  if (t) canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: t.clientX, clientY: t.clientY }));
});

// ─────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undoStep(); return; }
  if ((e.metaKey || e.ctrlKey) && (k === 'y' || (e.shiftKey && k === 'z'))) { e.preventDefault(); redoStep(); return; }
  if (k === 'r') setMode('route');
  if (k === 'b') setMode('block');
  if (k === 's') setMode('select');
  if (k === 'm') setMode('motion');
  if (k === 'p') autoPlayAction();
  if (k === 'escape') stopPlay();
  if (k === ' ') { e.preventDefault(); anim ? toggleAnimPause() : runPlay(); }
});

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
function init() {
  suspendHistory = true;
  refreshFormations();
  loadFormation('Shotgun');
  autoDefense();
  refreshSaved();
  refreshCustomFormations();
  updateFlipButton();
  renderBallScript();
  draw();
  suspendHistory = false;
  historyStack = []; redoStack = [];
  // Paths are on by default — reflect that in the button
  const btnP = document.getElementById('btnPaths');
  if (btnP) btnP.classList.add('active');
}


// ═══════════════════════════════════════════════════════

// ── POV engine loaded from pov.js ──

init();
