// POV ENGINE v2 — First Person · Broadcast · Birds Eye
// Low-poly football player models · True eye-level camera
// ═══════════════════════════════════════════════════════
let povScene, povCamera, povRenderer;
let povPlayerMeshes = [];
let povDefMeshes    = [];

// ── GLTF MODEL SYSTEM ─────────────────────────────────
const GLB_URL = 'https://raw.githubusercontent.com/FutureXRP/Football-Plays/main/american_football_players_animated_rigged.glb';
let gltfModelCache  = null;   // cached loaded GLTF scene
let gltfMixers      = [];     // AnimationMixer per player instance
let gltfClockDelta  = 0;
const gltfClock     = { then: performance.now() };

// Position → character root node index (see getCharRootIndex below)
let povRoutelines   = [];
let povBallMesh     = null;
let povSelectedId   = null;
let povSelectedSide = 'offense';
let povAnimating    = false;
let povRaf          = null;
let povThrowArc     = null;
let povCamMode      = 'fp'; // 'fp' | 'broadcast' | 'ezoff' | 'ezdef'
let povSpeed        = 1.0;
let povPaused       = false;
let povProgress     = 0;
let povStepFn       = null;
let povZoom         = 1.0; // 0.4 = zoomed in, 2.0 = zoomed out

// Field scale: 760px → 76 units
const PX  = 1 / 10;
const W3  = W * PX;
const H3  = H * PX;
const LOS3 = LOS * PX;
const EYE_HEIGHT = 1.75; // camera at eye level for first-person

function canvasToWorld(cx, cy) {
  return { x: (cx - W/2)*PX, z: (cy - H/2)*PX };
}
function hexColor(h) { return parseInt((h||'#888888').replace('#',''),16); }

// ── CEL-SHADING SYSTEM — Nintendo/Fortnite quality ─────
// gradientMap is the KEY to real cel-shading with MeshToonMaterial.
// Without it you get flat Lambert. With it: hard 3-band shadow/mid/highlight.
let _celGradMap = null;
function getCelGradMap() {
  if (_celGradMap) return _celGradMap;
  // 4-pixel wide gradient: deep shadow / shadow / midtone / highlight
  const data = new Uint8Array([
    38,  38,  38,  255,   // deep shadow
    100, 100, 100, 255,   // shadow
    195, 195, 195, 255,   // midtone
    255, 255, 255, 255    // highlight
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;  // HARD edges — no smoothing
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _celGradMap = tex;
  return tex;
}

// Helmet-specific gradient: slightly shinier (fewer shadow bands)
let _helmetGradMap = null;
function getHelmetGradMap() {
  if (_helmetGradMap) return _helmetGradMap;
  const data = new Uint8Array([
    30,  30,  30,  255,   // deep shadow
    80,  80,  80,  255,   // shadow edge
    175, 175, 175, 255,   // body
    255, 255, 255, 255    // specular highlight
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _helmetGradMap = tex;
  return tex;
}

function jerseyMat(color) {
  return new THREE.MeshToonMaterial({
    color, gradientMap: getCelGradMap()
  });
}
function helmetMat(color) {
  // Boost saturation so team color stays bold under lighting
  const r = (color >> 16) & 0xff;
  const g = (color >> 8)  & 0xff;
  const b = (color)       & 0xff;
  const mx = Math.max(r, g, b);
  const boost = 1.25;
  const br = Math.min(255, Math.round(r === mx ? r * boost : r * 0.8));
  const bg = Math.min(255, Math.round(g === mx ? g * boost : g * 0.8));
  const bb = Math.min(255, Math.round(b === mx ? b * boost : b * 0.8));
  const boostedColor = (br << 16) | (bg << 8) | bb;
  return new THREE.MeshToonMaterial({
    color: boostedColor, gradientMap: getHelmetGradMap()
  });
}
function padMat() {
  return new THREE.MeshToonMaterial({
    color: 0xf4f4f4, gradientMap: getCelGradMap()
  });
}
function skinMat() {
  // Warm brown — Blitz style, not pale pink
  return new THREE.MeshToonMaterial({
    color: 0xa0622a, gradientMap: getCelGradMap()
  });
}
function fmMat() {
  return new THREE.MeshToonMaterial({
    color: 0x999999, gradientMap: getHelmetGradMap()
  });
}
// Thick outline — back-face expansion on all key pieces
function addOutline(mesh, scale=1.115, col=0x050505) {
  const o = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: col, side: THREE.BackSide })
  );
  o.scale.setScalar(scale);
  mesh.add(o);
  return mesh;
}

// ── GLTF PLAYER — clone individual character from loaded model ─
// GLB hierarchy: scene → Sketchfab_model → root → [6 Metarig nodes]
// Each Metarig contains one character mesh.
//
// Three.js r128 sanitizes node names on load:
//   spaces → underscores, dots removed
//   e.g. "Metarig Man.005" → "Metarig_Man005_44"
//
// CHAR_PAIRS uses the sanitized names (what Three.js actually produces).
// Use startsWith() so the numeric suffix (_44, _89, etc.) is ignored.
//
// Armature/mesh pairing (confirmed by GLB inspection + console diagnostics):
//   Metarig_Man005  ↔ Object_6   (skin 0) → athletic upright
//   Metarig_Man006  ↔ Object_53  (skin 1) → running
//   Metarig_Man013  ↔ Object_100 (skin 2) → upright ready
//   Metarig_Woman019↔ Object_147 (skin 3) → female upright
//   Metarig_Woman020↔ Object_194 (skin 4) → crouching lineman
//   Metarig_Woman021↔ Object_241 (skin 5) → female running
const CHAR_PAIRS = [
  { armature: 'Metarig_Man005',   mesh: 'Object_6'   }, // 0: athletic upright
  { armature: 'Metarig_Man006',   mesh: 'Object_53'  }, // 1: running
  { armature: 'Metarig_Man013',   mesh: 'Object_100' }, // 2: upright ready
  { armature: 'Metarig_Woman019', mesh: 'Object_147' }, // 3: female upright
  { armature: 'Metarig_Woman020', mesh: 'Object_194' }, // 4: crouching lineman
  { armature: 'Metarig_Woman021', mesh: 'Object_241' }, // 5: female running
];

function getCharPairIdx(pos, isDef) {
  if (!isDef) {
    if (pos === 'OL') return 4;             // crouching lineman
    if (pos === 'QB') return 0;             // athletic upright
    if (pos === 'RB' || pos === 'FB') return 1; // running
    return 2;                               // WR/TE upright ready
  } else {
    if (pos === 'DL') return 4;             // crouching lineman
    if (pos === 'LB') return 0;             // athletic stance
    return 1;                               // CB/S running
  }
}

function makeGLTFPlayer(p, isDef) {
  const group = new THREE.Group();
  const pairIdx = getCharPairIdx(p.pos, isDef);
  const pair    = CHAR_PAIRS[pairIdx];

  // Find armature and SkinnedMesh nodes by name.
  // pair.armature is already the sanitized form Three.js r128 produces,
  // so a plain startsWith() match is all that's needed.
  // The numeric suffix (_44, _89, etc.) is ignored by startsWith.
  let armNode  = null;
  let meshNode = null;

  const skinnedMeshes = [];
  gltfModelCache.scene.traverse(n => {
    const name = n.name || '';

    // Armature: match sanitized name prefix, ignore numeric suffix
    if (!armNode && name.startsWith(pair.armature)) {
      armNode = n;
    }

    // Collect all SkinnedMeshes in traversal order (index-based fallback)
    if (n.isSkinnedMesh) skinnedMeshes.push(n);

    // Mesh: exact name match
    if (!meshNode && name === pair.mesh) meshNode = n;
  });

  // Index-based mesh fallback
  if (!meshNode && skinnedMeshes.length > pairIdx) {
    meshNode = skinnedMeshes[pairIdx];
    console.log('Using index-based mesh fallback[' + pairIdx + ']:', meshNode.name || meshNode.uuid);
  }

  // Log actual names first time for debugging
  if (!makeGLTFPlayer._logged) {
    makeGLTFPlayer._logged = true;
    console.log('GLTF lookup — pair:', pair);
    console.log('armNode found:', armNode ? armNode.name : 'NOT FOUND');
    console.log('meshNode found:', meshNode ? (meshNode.name || 'unnamed') : 'NOT FOUND');
    console.log('Total SkinnedMeshes:', skinnedMeshes.length, skinnedMeshes.map(n => n.name || 'unnamed'));
  }

  // Armature index-based fallback: collect all Metarig nodes, pick by pairIdx
  if (!armNode) {
    const armatures = [];
    gltfModelCache.scene.traverse(n => {
      const name = n.name || '';
      if (name.toLowerCase().startsWith('metarig') || name.toLowerCase().includes('armature')) {
        armatures.push(n);
      }
    });
    if (armatures.length > pairIdx) {
      armNode = armatures[pairIdx];
      console.log('Using index-based armature fallback[' + pairIdx + ']:', armNode.name);
    }
  }

  if (!armNode || !meshNode) {
    console.warn('GLTF pair not found after all fallbacks — pos:', p.pos, 'pairIdx:', pairIdx,
      '| armNode:', !!armNode, '| meshNode:', !!meshNode);
    return makeFootballPlayer(p, isDef);
  }

  // Find the smallest common parent that contains BOTH armature and mesh
  function containsNode(root, target) {
    let found = false;
    root.traverse(n => {
      if (n === target) found = true;
    });
    return found;
  }

  let commonRoot = armNode.parent;
  while (commonRoot && !containsNode(commonRoot, meshNode)) {
    commonRoot = commonRoot.parent;
  }

  if (!commonRoot) {
    console.warn('No common GLTF parent found -- falling back');
    return makeFootballPlayer(p, isDef);
  }

  // Clone the whole character subtree so SkeletonUtils can rewire bones correctly
  if (!makeGLTFPlayer._loggedRoot) { makeGLTFPlayer._loggedRoot = true; console.log('commonRoot name:', commonRoot.name, '| children:', commonRoot.children.length, '| is scene root:', commonRoot === gltfModelCache.scene); }
  const clonedRoot = THREE.SkeletonUtils.clone(commonRoot);

  // Hide every skinned mesh except the one we want
  clonedRoot.traverse(node => {
    if (node.isSkinnedMesh) {
      const keep = node.name === pair.mesh;
      node.visible = keep;
      node.frustumCulled = false;

      if (keep && node.material) {
        node.material = node.material.clone();

        const col = hexColor(p.color || (isDef ? '#8b0000' : '#3498db'));
        const tr = ((col >> 16) & 0xff) / 255;
        const tg = ((col >> 8)  & 0xff) / 255;
        const tb = (col & 0xff) / 255;

        node.material.color = new THREE.Color(
          0.30 + tr * 0.70,
          0.30 + tg * 0.70,
          0.30 + tb * 0.70
        );

        node.castShadow = true;
      }
    }
  });

  const charGroup = new THREE.Group();
  charGroup.add(clonedRoot);

  // First: hide ALL SkinnedMeshes, then show only the one we want (pair.mesh).
  // n.visible=true blanket pass is what caused the mosh pit — every cloned
  // character was visible at once. Keep frustumCulled=false on everything so
  // Three.js doesn't cull the skeleton we're not showing.
  clonedRoot.traverse(n => {
    n.frustumCulled = false;
    if (n.isSkinnedMesh || (n.isMesh && !n.isSkinnedMesh)) {
      n.visible = (n.name === pair.mesh);
    }
    // Material fixup only on the one we're keeping
    if (n.isSkinnedMesh && n.name === pair.mesh && n.material) {
      n.material = n.material.clone();
      n.material.side = THREE.DoubleSide;
      n.material.transparent = false;
      n.material.opacity = 1;
      n.material.depthWrite = true;
      n.material.needsUpdate = true;
      n.castShadow = true;
      n.receiveShadow = true;
      // Team color tint
      const col = hexColor(p.color || (isDef ? '#8b0000' : '#3498db'));
      const tr = ((col >> 16) & 0xff) / 255;
      const tg = ((col >> 8)  & 0xff) / 255;
      const tb = (col & 0xff) / 255;
      n.material.color = new THREE.Color(
        0.30 + tr * 0.70,
        0.30 + tg * 0.70,
        0.30 + tb * 0.70
      );
    }
  });

  // Normalize the imported model to local origin.
  // Compute bbox from ONLY the visible mesh so we don't include the 5 hidden ones.
  clonedRoot.updateMatrixWorld(true);
  let targetMesh = null;
  clonedRoot.traverse(n => { if (n.isSkinnedMesh && n.name === pair.mesh) targetMesh = n; });

  if (targetMesh) {
    const box    = new THREE.Box3().setFromObject(targetMesh);
    const size   = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // Move model so feet are at y=0, centered on x/z
    clonedRoot.position.x -= center.x;
    clonedRoot.position.z -= center.z;
    clonedRoot.position.y -= box.min.y;
    // Auto-scale to 2.8 world units tall
    const scale = 2.8 / (size.y || 1);
    charGroup.scale.setScalar(scale);
  } else {
    charGroup.scale.setScalar(0.026); // safe fallback
  }

  charGroup.rotation.y = isDef ? 0 : Math.PI;
  group.add(charGroup);



  // Animation mixer -- drive the cloned root; SkinnedMesh follows via rebound skeleton
  if (gltfModelCache.animations && gltfModelCache.animations.length > 0) {
    const mixer  = new THREE.AnimationMixer(clonedRoot);
    const clip   = gltfModelCache.animations[0];
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(Math.random() * clip.duration);
    gltfMixers.push(mixer);
    group._mixer = mixer;

  }

  // Soft shadow
  const sc = document.createElement('canvas');
  sc.width = sc.height = 128;
  const sx = sc.getContext('2d');
  const sg = sx.createRadialGradient(64,64,0,64,64,64);
  sg.addColorStop(0,   'rgba(0,0,0,0.55)');
  sg.addColorStop(0.45,'rgba(0,0,0,0.30)');
  sg.addColorStop(0.75,'rgba(0,0,0,0.10)');
  sg.addColorStop(1.0, 'rgba(0,0,0,0)');
  sx.fillStyle = sg; sx.fillRect(0,0,128,128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.8),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.01, 0.3);
  group.add(shadow);

  // Label
  const label = makeLabelCrisp(p.label, isDef ? '#ff9999' : '#ffffff', isDef ? '#550000' : '#002255');
  label.position.y = 3.4;
  label.scale.set(2.4, 0.95, 1);
  group._labelSprite = label;
  group.add(label);

  const w = canvasToWorld(p.x, p.y);
  group.position.set(w.x, 0, w.z);
  group._eyeY  = EYE_HEIGHT;
  group._bodyH = 3.0;
  group._isDef = isDef;
  group._animT = Math.random() * Math.PI * 2;

  return group;
}


// Key ratios vs realistic:
//   Helmet  : ~42% of total height  (realistic ~14%)
//   Legs    : ~22% of total height  (realistic ~45%)
//   Torso   : ~22% of total height
//   Shoulders: wider than player is tall
// Total height ~2.8 units
function makeFootballPlayer(p, isDef) {
  const group = new THREE.Group();
  const col   = hexColor(p.color || (isDef ? '#8b0000' : '#3498db'));
  const jerseyColor = isDef ? Math.max(0, col - 0x111000) : col;

  const jMat  = jerseyMat(jerseyColor);
  const pMat  = padMat();
  const hMat  = helmetMat(jerseyColor);
  const sMat  = skinMat();
  const fMat  = fmMat();
  const pantCol = isDef ? 0x6a0808 : 0xf0f0f0;
  const pantMat = jerseyMat(pantCol);
  const cleatMat = new THREE.MeshToonMaterial({ color: 0x050505, gradientMap: getCelGradMap() });
  // White collar/detail color
  const accentMat = new THREE.MeshToonMaterial({ color: isDef ? 0xffdddd : 0xffffff, gradientMap: getCelGradMap() });

  // ── SOFT-EDGE BLOB SHADOW ───────────────────────────
  // Radial gradient canvas: dark center fading to transparent edge
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0,   'rgba(0,0,0,0.55)');
  grad.addColorStop(0.45,'rgba(0,0,0,0.35)');
  grad.addColorStop(0.75,'rgba(0,0,0,0.12)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const blobShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.0),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 1 })
  );
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.set(0, 0.01, 0.12);
  group.add(blobShadow);

  // ── LEGS — Blitz-style short, tapered cylinders ────
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  group._legL = legL;
  group._legR = legR;

  [-1, 1].forEach(side => {
    const legGrp = side < 0 ? legL : legR;
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.138, 0.115, 0.40, 10), pantMat
    );
    upper.position.set(0, -0.20, 0);
    upper.castShadow = true;
    addOutline(upper, 1.09);
    legGrp.add(upper);

    const lower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.090, 0.30, 10), pantMat
    );
    lower.position.set(0, -0.50, 0);
    lower.castShadow = true;
    addOutline(lower, 1.09);
    legGrp.add(lower);

    // Cleat — low tapered box
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, 0.29), cleatMat);
    cleat.position.set(0.02, -0.67, 0.04);
    legGrp.add(cleat);

    legGrp.position.set(side * 0.185, 0.87, 0);
    group.add(legGrp);
  });

  // ── TORSO — LatheGeometry tapered silhouette ────────
  // Profile: [radius, y] from hip to shoulder
  // Wide at shoulder (top), narrow at waist, slight flare at hip
  const torsoPoints = [
    new THREE.Vector2(0.30, 0.00),   // hip flare
    new THREE.Vector2(0.26, 0.12),   // waist narrow start
    new THREE.Vector2(0.22, 0.28),   // waist
    new THREE.Vector2(0.24, 0.40),   // chest lower
    new THREE.Vector2(0.30, 0.52),   // chest
    new THREE.Vector2(0.32, 0.62),   // upper chest / shoulder base
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoPoints, 12);
  const torso = new THREE.Mesh(torsoGeo, jMat);
  torso.position.set(0, 0.98, 0);
  torso.castShadow = true;
  addOutline(torso, 1.07);
  group.add(torso);

  // ── JERSEY COLLAR — two-tone detail ─────────────────
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.195, 0.21, 0.09, 12),
    accentMat
  );
  collar.position.set(0, 1.62, 0);
  group.add(collar);

  // ── JERSEY NUMBER — two-tone panel + number ─────────
  // White/contrast panel behind the number
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 128; panelCanvas.height = 128;
  const pc = panelCanvas.getContext('2d');
  // Rounded rect panel in white/accent
  pc.fillStyle = isDef ? 'rgba(255,220,220,0.92)' : 'rgba(255,255,255,0.92)';
  pc.beginPath();
  pc.roundRect(18, 18, 92, 92, 14);
  pc.fill();
  // Number on top
  pc.shadowColor = 'rgba(0,0,0,0.5)';
  pc.shadowBlur = 3;
  // Jersey color for the number text
  const r = (jerseyColor >> 16) & 0xff;
  const g = (jerseyColor >> 8) & 0xff;
  const b = jerseyColor & 0xff;
  pc.fillStyle = isDef ? `rgb(${Math.min(180,r)},${Math.min(30,g)},${Math.min(30,b)})` : `rgb(${Math.min(30,r)},${Math.min(80,g)},${Math.min(180,b)})`;
  pc.font = 'bold 72px Barlow Condensed, Arial Black, sans-serif';
  pc.textAlign = 'center'; pc.textBaseline = 'middle';
  pc.fillText(p.label.slice(0, 2), 64, 66);
  const numMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.36),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(panelCanvas), transparent: true, depthTest: false })
  );
  numMesh.position.set(0, 1.32, 0.32);
  group.add(numMesh);

  // ── SHOULDER PADS — curved crescent via CylinderGeometry ─
  // Main yoke: flattened wide cylinder — rounded edge vs sharp box
  const spadGeo = new THREE.CylinderGeometry(0.72, 0.68, 0.17, 16, 1, false, 0, Math.PI * 2);
  const spad = new THREE.Mesh(spadGeo, pMat);
  spad.scale.set(1, 1, 0.46); // flatten front-to-back into pad shape
  spad.position.set(0, 1.66, 0);
  spad.castShadow = true;
  addOutline(spad, 1.06);
  group.add(spad);

  // Front/back arch plates — slightly curved slabs
  for (const [z, rz] of [[-0.10, 0.12], [0.10, -0.12]]) {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.60, 0.58, 0.11, 14, 1, false, 0, Math.PI * 2),
      pMat
    );
    plate.scale.set(1, 1, 0.22);
    plate.position.set(0, 1.57, z);
    plate.rotation.x = rz;
    group.add(plate);
  }

  // Side wings — angled drop pads, rounded cylinder slice
  [-0.66, 0.66].forEach(x => {
    const wing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.12, 0.24, 10),
      pMat
    );
    wing.position.set(x, 1.55, 0);
    wing.rotation.z = x > 0 ? -0.42 : 0.42;
    wing.scale.set(1.4, 1, 1.5);
    addOutline(wing, 1.08);
    group.add(wing);
  });

  // ── ARMS — upper/lower with natural angle ───────────
  [[-1, 0.60], [1, -0.60]].forEach(([side, rz]) => {
    const x = side * 0.74;
    const uArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.108, 0.095, 0.42, 10), jMat
    );
    uArm.position.set(x, 1.53, 0);
    uArm.rotation.z = rz;
    uArm.castShadow = true;
    addOutline(uArm, 1.08);
    group.add(uArm);

    const lArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.090, 0.078, 0.30, 10), sMat
    );
    lArm.position.set(x + side * 0.26, 1.30, 0);
    lArm.rotation.z = rz * 0.62;
    lArm.castShadow = true;
    group.add(lArm);
  });

  // ── NECK — bull neck, tapered ───────────────────────
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.155, 0.175, 0.19, 10), sMat
  );
  neck.position.set(0, 1.74, 0);
  addOutline(neck, 1.07);
  group.add(neck);

  // ── HELMET — high-res dome, proper proportions ──────
  // More segments = smoother dome, better light catch
  const helmGeo = new THREE.SphereGeometry(0.52, 24, 16);
  const helm = new THREE.Mesh(helmGeo, hMat);
  helm.scale.set(1.0, 0.96, 1.08);
  helm.position.set(0, 2.31, 0.04);
  helm.castShadow = true;
  addOutline(helm, 1.068);
  group.add(helm);

  // Helmet chin cup — small rounded box under front
  const chinCup = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.10, 0.12),
    new THREE.MeshToonMaterial({ color: 0x333333, gradientMap: getCelGradMap() })
  );
  chinCup.position.set(0, 1.96, 0.44);
  group.add(chinCup);

  // Crown stripe — slightly raised panel on top
  const stripeCol = Math.min(0xffffff, jerseyColor + 0x606060);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, 0.56, 1.00),
    new THREE.MeshToonMaterial({ color: stripeCol, gradientMap: getCelGradMap() })
  );
  stripe.position.set(0, 2.54, 0.04);
  group.add(stripe);

  // Ear flaps — rounded via cylinder slice
  [-0.49, 0.49].forEach(x => {
    const ear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.14, 0.08, 10),
      new THREE.MeshToonMaterial({ color: jerseyColor, gradientMap: getCelGradMap() })
    );
    ear.rotation.z = Math.PI / 2;
    ear.position.set(x, 2.14, 0.10);
    addOutline(ear, 1.07);
    group.add(ear);
  });

  // ── FACEMASK — 3 bold rounded bars ──────────────────
  const fmRadius = 0.036;
  for (let i = 0; i < 3; i++) {
    const fm = new THREE.Mesh(
      new THREE.CylinderGeometry(fmRadius, fmRadius, 0.74, 8), fMat
    );
    fm.rotation.z = Math.PI / 2;
    fm.position.set(0, 2.13 + i * 0.115, 0.47);
    addOutline(fm, 1.13);
    group.add(fm);
  }
  // Vertical bar
  const fmV = new THREE.Mesh(
    new THREE.CylinderGeometry(fmRadius, fmRadius, 0.36, 8), fMat
  );
  fmV.position.set(0, 2.16, 0.54);
  addOutline(fmV, 1.13);
  group.add(fmV);

  // ── VISOR — tinted with subtle curve ────────────────
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.095, 0.07),
    new THREE.MeshToonMaterial({
      color: 0x0a1520, transparent: true, opacity: 0.84,
      gradientMap: getHelmetGradMap()
    })
  );
  visor.position.set(0, 2.32, 0.48);
  group.add(visor);

  // ── LABEL SPRITE ────────────────────────────────────
  const labelSprite = makeLabelCrisp(
    p.label,
    isDef ? '#ff9999' : '#ffffff',
    isDef ? '#550000' : '#002255'
  );
  labelSprite.position.y = 3.22;
  labelSprite.scale.set(2.4, 0.95, 1);
  group._labelSprite = labelSprite;
  group.add(labelSprite);

  const w = canvasToWorld(p.x, p.y);
  group.position.set(w.x, 0, w.z);
  group.rotation.y = isDef ? 0 : Math.PI;
  group._eyeY  = EYE_HEIGHT;
  group._bodyH = 2.88;
  group._isDef = isDef;
  group._animT = Math.random() * Math.PI * 2;

  return group;
}

// ── Football mesh — cel-shaded leather ball ──────────
function makeBallMesh() {
  const g = new THREE.Group();
  const bMat = new THREE.MeshToonMaterial({
    color: 0x7a3410, gradientMap: getCelGradMap()
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), bMat);
  ball.scale.set(0.65, 1, 0.65);
  addOutline(ball, 1.09, 0x2a0a00);
  g.add(ball);

  // White laces
  const laceMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: getCelGradMap() });
  const laceMain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.07), laceMat);
  laceMain.position.set(0.02, 0, 0.24);
  g.add(laceMain);
  // Crosshatches
  for (let i = -1; i <= 1; i++) {
    const lh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.05), laceMat);
    lh.position.set(0.02, i * 0.08, 0.25);
    g.add(lh);
  }

  // Seam lines
  const seamMat = new THREE.MeshBasicMaterial({ color: 0x3a1505 });
  const seamGeo = new THREE.TorusGeometry(0.18, 0.012, 4, 20);
  const seam = new THREE.Mesh(seamGeo, seamMat);
  seam.rotation.y = Math.PI / 2;
  seam.position.set(0, 0, 0);
  g.add(seam);

  g.visible = false;
  return g;
}

// ── 3D route line ──────────────────────────────────────
function makeLine3D(pts2d, color, ht=0.06) {
  if (!pts2d || pts2d.length < 2) return null;
  const pts = pts2d.map(p => { const w=canvasToWorld(p.x,p.y); return new THREE.Vector3(w.x,ht,w.z); });
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, linewidth:2 }));
}

// ── Floating label sprite (original, kept for compat) ─
function makeLabel(text, color) {
  const c2 = document.createElement('canvas');
  c2.width=128; c2.height=56;
  const cx=c2.getContext('2d');
  cx.fillStyle=color||'#fff';
  cx.font='bold 26px Barlow Condensed,monospace';
  cx.textAlign='center'; cx.textBaseline='middle';
  cx.fillText(text.slice(0,4),64,28);
  const tex=new THREE.CanvasTexture(c2);
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false});
  const s=new THREE.Sprite(mat);
  s.scale.set(1.4,0.6,1);
  return s;
}

// ── Crisp label with pill background (new) ────────────
function makeLabelCrisp(text, textColor, bgColor) {
  const c2 = document.createElement('canvas');
  c2.width = 192; c2.height = 72;
  const cx = c2.getContext('2d');
  // Pill background
  const r = 16;
  cx.fillStyle = bgColor || 'rgba(0,20,60,0.85)';
  cx.beginPath();
  cx.moveTo(r, 4); cx.lineTo(c2.width - r, 4);
  cx.quadraticCurveTo(c2.width - 4, 4, c2.width - 4, r);
  cx.lineTo(c2.width - 4, c2.height - r);
  cx.quadraticCurveTo(c2.width - 4, c2.height - 4, c2.width - r, c2.height - 4);
  cx.lineTo(r, c2.height - 4);
  cx.quadraticCurveTo(4, c2.height - 4, 4, c2.height - r);
  cx.lineTo(4, r);
  cx.quadraticCurveTo(4, 4, r, 4);
  cx.closePath();
  cx.fill();
  // Pill border
  cx.strokeStyle = textColor || '#ffffff';
  cx.lineWidth = 3;
  cx.globalAlpha = 0.5;
  cx.stroke();
  cx.globalAlpha = 1.0;
  // Text
  cx.fillStyle = textColor || '#ffffff';
  cx.font = 'bold 34px Barlow Condensed, Arial Black, sans-serif';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.fillText(text.slice(0, 4), c2.width / 2, c2.height / 2);
  const tex = new THREE.CanvasTexture(c2);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  return s;
}

// ── Init Three.js scene ───────────────────────────────
function initPOV() {
  if (povScene) return;
  const c = document.getElementById('povCanvas');
  povRenderer = new THREE.WebGLRenderer({ canvas:c, antialias:true, preserveDrawingBuffer:true });
  povRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  povRenderer.shadowMap.enabled = true;
  povRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  povRenderer.setClearColor(0x87ceeb);
  // Tone mapping — lower exposure keeps team colors saturated, not blown out
  povRenderer.outputEncoding = THREE.sRGBEncoding || 3001;
  povRenderer.toneMapping = THREE.ACESFilmicToneMapping || 4;
  povRenderer.toneMappingExposure = 0.88;

  povScene = new THREE.Scene();
  // Blitz-style bright stadium sky — clear afternoon blue
  povScene.fog = new THREE.FogExp2(0x6aabdf, 0.004);
  povScene.background = new THREE.Color(0x4f8fd6);

  povCamera = new THREE.PerspectiveCamera(72, 1, 0.05, 300);

  // ── LIGHTING — tuned for MeshToonMaterial ─────────
  // Toon needs STRONG directional lights to produce visible band transitions.
  // Ambient fills the dark sides. No specular in toon so dial up intensity.
  povScene.add(new THREE.AmbientLight(0xffeedd, 0.70)); // warm fill — lower so shadows read

  // Primary sun — strong but not blowing out team colors
  const sun = new THREE.DirectionalLight(0xfff4d0, 3.2);
  sun.position.set(30, 55, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.width  = 4096;
  sun.shadow.mapSize.height = 4096;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far  = 200;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
  sun.shadow.camera.right = sun.shadow.camera.top   =  80;
  sun.shadow.bias = -0.0005;
  povScene.add(sun);

  const fill = new THREE.DirectionalLight(0x8ecbff, 0.75);
  fill.position.set(-30, 20, 20);
  povScene.add(fill);

  // Hemisphere — keep low so turf color stays deep
  povScene.add(new THREE.HemisphereLight(0x88bbdd, 0x1a3a10, 0.3));

  // ── STADIUM LIGHTS — 4 rigs, emissive + point lights ──
  const lightRigPositions = [
    [-W3*0.72, 28,  H3*0.3],
    [ W3*0.72, 28,  H3*0.3],
    [-W3*0.72, 28, -H3*0.3],
    [ W3*0.72, 28, -H3*0.3],
  ];
  const lightRigMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
  lightRigPositions.forEach(([lx, ly, lz]) => {
    // Visual rig: horizontal bar with lamp clusters
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.2, 0.4), new THREE.MeshToonMaterial({ color: 0x888888, gradientMap: getCelGradMap() }));
    bar.position.set(lx, ly, lz);
    povScene.add(bar);
    // Lamp clusters on bar
    for (let dx = -1.8; dx <= 1.8; dx += 0.9) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.35), lightRigMat);
      lamp.position.set(lx + dx, ly - 0.28, lz);
      povScene.add(lamp);
    }
    // Support pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, ly - 8, 8),
      new THREE.MeshToonMaterial({ color: 0x777777, gradientMap: getCelGradMap() })
    );
    pole.position.set(lx, (ly - 8) / 2 + 4, lz);
    povScene.add(pole);
    // Point light — contributes to band shading on nearby players
    const pt = new THREE.PointLight(0xfff8e0, 0.6, 60);
    pt.position.set(lx, ly - 2, lz);
    povScene.add(pt);
  });

  // ── TURF — Blitz style flat deep green alternating stripes ──
  // MeshBasicMaterial = completely immune to lighting blowout.
  // Deep saturated NFL green, subtle stripe contrast, clean.
  // Blitz turf reads as ~#1a5c20 dark / #1e6824 light
  const turfDark  = new THREE.MeshBasicMaterial({ color: 0x175218 }); // dark stripe
  const turfLight = new THREE.MeshBasicMaterial({ color: 0x1c6320 }); // lighter stripe — subtle diff

  // 10 stripes across the visible field
  for (let i = 0; i < 10; i++) {
    const zFrom = (-H3/2) + i*(H3/10);
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(W3 * 2.0, H3/10),
      i % 2 === 0 ? turfDark : turfLight
    );
    stripe.rotation.x = -Math.PI/2;
    stripe.position.set(0, 0, zFrom + H3/20);
    stripe.receiveShadow = false; // BasicMaterial ignores shadows — that's fine
    povScene.add(stripe);
  }

  // Sideline borders — white painted lines at field edge
  for (const sx of [-W3*0.755, W3*0.755]) {
    const sideline = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, H3*1.15),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    sideline.rotation.x = -Math.PI/2;
    sideline.position.set(sx, 0.015, 0);
    povScene.add(sideline);
  }
  // Back of end zone borders
  for (const sz of [-H3*0.582, H3*0.582]) {
    const ezline = new THREE.Mesh(
      new THREE.PlaneGeometry(W3*1.55, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    ezline.rotation.x = -Math.PI/2;
    ezline.position.set(0, 0.015, sz);
    povScene.add(ezline);
  }

  // ── Yard lines — bold painted white, Blitz style ──────
  for (let i = 0; i <= 10; i++) {
    const z = (-H3/2) + i*(H3/10);
    const isLOS = Math.abs(z - ((LOS-H/2)*PX)) < 0.3;

    // Painted line on turf — use PlaneGeometry so MeshBasicMaterial works
    const lineW = isLOS ? 0.28 : 0.18;
    const lineMat = new THREE.MeshBasicMaterial({
      color: isLOS ? 0xffee00 : 0xffffff,
      transparent: !isLOS, opacity: isLOS ? 1.0 : 0.88
    });
    const lineMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W3 * 1.56, lineW),
      lineMat
    );
    lineMesh.rotation.x = -Math.PI/2;
    lineMesh.position.set(0, 0.02, z);
    povScene.add(lineMesh);

    // Yard number sprites — large, bold, Blitz painted style
    if (!isLOS && i > 0 && i < 10) {
      const yardNum = Math.abs(i*10 - 50);
      for (const sx of [-W3*0.52, W3*0.52]) {
        const nc2 = document.createElement('canvas');
        nc2.width = 96; nc2.height = 64;
        const nctx = nc2.getContext('2d');
        // White painted number — large, bold, Blitz style
        nctx.fillStyle = 'rgba(255,255,255,0.95)';
        nctx.font = 'bold 52px Barlow Condensed, Arial Black, sans-serif';
        nctx.textAlign = 'center';
        nctx.textBaseline = 'middle';
        nctx.fillText(yardNum, 48, 32);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(nc2), transparent: true, depthTest: false
        }));
        sp.scale.set(4.0, 2.6, 1);
        sp.position.set(sx, 0.05, z + 1.5); // offset slightly behind line
        povScene.add(sp);
      }
    }
  }

  // ── Hash marks — painted on turf ──────────────────
  const hashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j < 8; j++) {
      const z = (-H3/2) + i*(H3/10) + j*(H3/80);
      for (const hx of [-W3*0.165, W3*0.165]) {
        const hm = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.12), hashMat);
        hm.rotation.x = -Math.PI/2;
        hm.position.set(hx, 0.02, z);
        povScene.add(hm);
      }
    }
  }

  // ── End zones — deeper than field, Blitz style ─────
  for (const zOff of [-H3*0.54, H3*0.54]) {
    const ez = new THREE.Mesh(
      new THREE.PlaneGeometry(W3*2.0, H3*0.09),
      new THREE.MeshBasicMaterial({ color: 0x103d12 })
    );
    ez.rotation.x = -Math.PI/2;
    ez.position.set(0, 0.005, zOff);
    povScene.add(ez);
  }

  // ── Goal posts — cel-shaded yellow ─────────────────
  function makeGoalPost(z) {
    const mat = new THREE.MeshToonMaterial({
      color: 0xf0cc28, gradientMap: getHelmetGradMap()
    });
    const post = new THREE.Group();
    const u = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,8,10), mat);
    u.position.set(0,4,0); addOutline(u,1.08); post.add(u);
    const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,6.2,8), mat);
    cb.rotation.z = Math.PI/2; cb.position.set(0,5.5,0); addOutline(cb,1.08); post.add(cb);
    for (const x of [-3.1,3.1]) {
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,4.2,8), mat);
      up.position.set(x,7.6,0); addOutline(up,1.08); post.add(up);
    }
    post.position.set(0,0,z);
    return post;
  }
  povScene.add(makeGoalPost(-H3*0.85));
  povScene.add(makeGoalPost( H3*0.85));

  // ── STANDS — tiered, with cel-shaded crowd color blocks ──
  for (const sx of [-W3*0.84, W3*0.84]) {
    // Main concrete structure — tiers
    for (let tier = 0; tier < 3; tier++) {
      const h = 4 + tier * 2;
      const w = 3.8 - tier * 0.3;
      const standMat = new THREE.MeshToonMaterial({ color: 0x3a3d4a, gradientMap: getCelGradMap() });
      const stand = new THREE.Mesh(new THREE.BoxGeometry(w, h, H3*1.1), standMat);
      stand.position.set(sx + (tier * (sx > 0 ? 0.3 : -0.3)), h/2, 0);
      povScene.add(stand);
    }

    // Crowd color rows — bright saturated for game feel
    const rowColors = [0x2244aa, 0xcc2222, 0x2244aa, 0xeeeeee, 0xcc2222, 0x2244aa, 0xeeeeee, 0xcc2222];
    rowColors.forEach((c, row) => {
      const rowMesh = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.6, H3*1.05),
        new THREE.MeshToonMaterial({ color: c, gradientMap: getCelGradMap() })
      );
      rowMesh.position.set(sx, 1.0 + row * 1.05, 0);
      povScene.add(rowMesh);
    });
  }

  resizePOV();
  window.addEventListener('resize', resizePOV);
}

function resizePOV() {
  if (!povRenderer) return;
  const c = document.getElementById('povCanvas');
  const w = c.clientWidth  || window.innerWidth;
  const h = c.clientHeight || (window.innerHeight - 10);
  povRenderer.setSize(w, h, false);
  if (povCamera) { povCamera.aspect = w/h; povCamera.updateProjectionMatrix(); }
}

// ── Camera mode switching ─────────────────────────────
let povRedZoneMode = false; // red zone: offense at def 30

function setCamMode(mode) {
  povCamMode = mode;
  document.querySelectorAll('.pov-cam-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('camBtn-'+mode);
  if (btn) btn.classList.add('active');
  updateSelfVisibility();
  if (!povAnimating) applyStaticCamera();
}

// Red zone world-space offset — how far downfield offense is spotted
// In red zone mode, offense is at defense's 30 (30 yards from end zone)
function getRedZoneOffset() {
  if (!povRedZoneMode) return 0;
  // Move scene so offense lines up at what would be the defense's 30
  // LOS3 is the line of scrimmage in world units
  // We want offense to appear ~18 world units closer to def end zone
  return -14.0;
}

function updateSelfVisibility() {
  const allMeshes = [...povPlayerMeshes, ...povDefMeshes];
  allMeshes.forEach(pm => {
    const isSelf = pm.id === povSelectedId && pm.side === povSelectedSide;
    // In FP mode hide the selected player's body (we ARE them)
    // Show floating label still
    pm.group.children.forEach((child, i) => {
      if (child.isSprite) return; // always show label
      child.visible = !(isSelf && povCamMode === 'fp');
    });
  });
}

function applyStaticCamera() {
  const selList = povSelectedSide==='offense' ? players : defenders;
  const selP    = selList.find(x => x.id===povSelectedId);
  if (!selP) return;
  const w = canvasToWorld(selP.x, selP.y);
  applyCameraForMode(w.x, EYE_HEIGHT, w.z, 0, selP);
  // Force an immediate render so the new camera position is visible right away
  if (povRenderer && povScene && povCamera) povRenderer.render(povScene, povCamera);
}

function applyCameraForMode(px, py, pz, facingY, selP) {
  const isDef = povSelectedSide === 'defense';
  const rzOff = getRedZoneOffset();

  if (povCamMode === 'fp') {
    // Tightened FOV — more game camera, less browser demo
    povCamera.fov = Math.max(42, Math.min(90, 68 * povZoom));
    povCamera.position.set(px, EYE_HEIGHT, pz + rzOff);

    const forwardZ = isDef ? 1 : -1;
    let lx, lz;
    if (facingY !== 0) {
      lx = px + Math.sin(facingY) * 20;
      lz = (pz + rzOff) - Math.cos(facingY) * 20 * (isDef ? -1 : 1);
    } else {
      lx = px;
      lz = (pz + rzOff) + forwardZ * 20;
    }
    povCamera.lookAt(lx, EYE_HEIGHT - 0.12, lz);

  } else if (povCamMode === 'broadcast') {
    const zoomD = povZoom;
    povCamera.fov = 58;
    povCamera.position.set(W3 * 0.52 * zoomD, 10 * zoomD, pz + rzOff + 4 * zoomD);
    povCamera.lookAt(px, 1.2, pz + rzOff - 5);

  } else if (povCamMode === 'blitz') {
    // ── BLITZ ISOMETRIC — the signature Blitz camera ──
    // Low angle, slightly behind offense, looking upfield at ~45°
    // Tight FOV makes players fill the frame
    const zoomD = povZoom;
    povCamera.fov = Math.max(38, Math.min(72, 56 * zoomD));
    // Position: behind and above offense looking toward defense
    // Offset slightly to the right for that classic Blitz angle
    const behindZ = (H3 / 2) * 0.38 * zoomD;  // behind offensive LOS
    const camH    = 11.5 / zoomD;
    const camX    = W3 * 0.12; // slight right offset
    // Look target: just past the LOS toward defense
    const lookZ   = -(H3 / 2) * 0.18 + rzOff;
    povCamera.position.set(camX, camH, behindZ + rzOff);
    povCamera.lookAt(0, 0.5, lookZ);

  } else if (povCamMode === 'ezoff') {
    const zoomD = povZoom;
    const camZ  =  (H3 / 2) * 0.62;
    const camY  =  14 / zoomD;
    const lookZ = -(H3 / 2) * 0.55 + rzOff;
    povCamera.fov = Math.min(88, 62 * zoomD);
    povCamera.position.set(0, camY, camZ + rzOff);
    povCamera.lookAt(0, 0, lookZ);

  } else {
    // ezdef
    const zoomD = povZoom;
    const camZ  = -(H3 / 2) * 0.62 + rzOff;
    const camY  =  14 / zoomD;
    const lookZ =  (H3 / 2) * 0.55 + rzOff;
    povCamera.fov = Math.min(88, 62 * zoomD);
    povCamera.position.set(0, camY, camZ);
    povCamera.lookAt(0, 0, lookZ);
  }
  povCamera.updateProjectionMatrix();
}

// ── Populate scene with players and routes ─────────────
function populatePOVScene() {
  povPlayerMeshes.forEach(m => povScene.remove(m.group));
  povDefMeshes.forEach(m    => povScene.remove(m.group));
  povRoutelines.forEach(l   => povScene.remove(l));
  if (povBallMesh) povScene.remove(povBallMesh);
  povPlayerMeshes=[]; povDefMeshes=[]; povRoutelines=[];
  gltfMixers = [];

  const build = (useGLTF) => {
    if (!povScene) return;
    players.forEach(p => {
      const group = useGLTF ? makeGLTFPlayer(p, false) : makeFootballPlayer(p, false);
      povScene.add(group);
      povPlayerMeshes.push({ id:p.id, side:'offense', group, ox:p.x, oy:p.y });
    });
    defenders.forEach(d => {
      const group = useGLTF ? makeGLTFPlayer(d, true) : makeFootballPlayer(d, true);
      povScene.add(group);
      povDefMeshes.push({ id:d.id, side:'defense', group, ox:d.x, oy:d.y });
    });
    routes.forEach(r  => { const l=makeLine3D(r.pts,0xf5c842,0.07); if(l){povScene.add(l);povRoutelines.push(l);} });
    blocks.forEach(b  => { const l=makeLine3D(b.pts,0xe74c3c,0.07); if(l){povScene.add(l);povRoutelines.push(l);} });
    motions.forEach(m => { const l=makeLine3D(m.pts,0x3498db,0.07); if(l){povScene.add(l);povRoutelines.push(l);} });
    povBallMesh = makeBallMesh();
    povScene.add(povBallMesh);
    // Show the ball at its pre-snap spot (on the center) if a ball script exists
    const staticBall = ballScript.length ? getStaticBallPos() : null;
    if (staticBall) {
      const bw = canvasToWorld(staticBall.x, staticBall.y);
      povBallMesh.position.set(bw.x, 0.5, bw.z);
      povBallMesh.visible = true;
    }
    povThrowArc = (ballPath && ballPath._isThrow) ? ballPath : null;
    buildPOVTabs();
    updatePOVHUD();
    updateSelfVisibility();
    applyStaticCamera();
  };

  build(false); // GLTF disabled — procedural models only
}

// ── Build player tab buttons ───────────────────────────
function buildPOVTabs() {
  const container = document.getElementById('povTabs');
  container.innerHTML = '';
  [...players.map(p=>({...p,side:'offense'})), ...defenders.map(d=>({...d,side:'defense'}))].forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'pov-tab' + (p.id===povSelectedId && p.side===povSelectedSide ? ' active' : '');
    btn.textContent = p.label;
    btn.style.cssText = `border-color:${p.color};color:${p.side==='offense'?'#eee':'#ffaaaa'}`;
    btn.onclick = () => {
      povSelectedId=p.id; povSelectedSide=p.side;
      document.querySelectorAll('.pov-tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      updatePOVHUD();
      updateSelfVisibility();
      if (!povAnimating) applyStaticCamera();
    };
    container.appendChild(btn);
  });
}

function updatePOVHUD() {
  const list = povSelectedSide==='offense' ? players : defenders;
  const p    = list.find(x=>x.id===povSelectedId);
  if (!p) return;
  document.getElementById('povPlayerBadge').textContent    = p.label+' — '+p.pos;
  document.getElementById('povAssignmentBadge').textContent= p.assignment||'No assignment';
  document.getElementById('povHudPlayer').textContent      = p.label;
  document.getElementById('povHudAssign').textContent      = (p.assignment||'—').slice(0,32);
  document.getElementById('povFormation').textContent      = currentFormation;
  document.getElementById('povCoverage').textContent       = document.getElementById('coverage')?.value||'—';
  document.getElementById('povKeyRead').textContent        = getKeyRead(p);
  document.getElementById('povDn').textContent             = '2nd & 7';
}

function getKeyRead(p) {
  const reads = {QB:'Watch safety rotation pre-snap',WR:'Read CB leverage — inside or outside',RB:'Hit the first down lineman',TE:'Release inside or outside the LB',OL:'Gap assignment — who do you fire on?',DL:'Read guard\'s first step',LB:'Key the near back — read mesh',CB:'Watch #1 release — press or bail',S:'Read QB eyes post-snap'};
  return reads[p.pos] || 'Execute your assignment';
}

// ── GLTF Model Loader ──────────────────────────────────
function loadGLTFModel(onLoaded) {
  if (gltfModelCache) { if (onLoaded) onLoaded(); return; }
  // GLTFLoader is now embedded inline — always available
  if (!THREE.GLTFLoader) {
    console.error('GLTFLoader not available');
    status('3D model loader not available.', '');
    return;
  }
  status('Loading 3D models…', '');
  const loader = new THREE.GLTFLoader();
  loader.load(
    GLB_URL,
    gltf => {
      gltfModelCache = gltf;
      console.log('GLTF loaded:', gltf.scene.children.length, 'root children,', gltf.animations.length, 'animations');
      if (onLoaded) onLoaded();
    },
    xhr => {
      if (xhr.total > 0) {
        const pct = Math.round(xhr.loaded / xhr.total * 100);
        status('Loading 3D models… ' + pct + '%', '');
      }
    },
    err => {
      console.error('GLTF load error:', err);
      status('3D model load failed — using procedural models.', '');
    }
  );
}

// ── Open POV ──────────────────────────────────────────
function openPOV() {
  document.getElementById('povOverlay').classList.add('open');
  const doInit = () => {
    initPOV();
    populatePOVScene();
    const def = players.find(p=>p.pos==='QB')||players[0];
    if (def) { povSelectedId=def.id; povSelectedSide='offense'; }
    povProgress = 0;
    povPaused   = false;
    povSpeed    = 1;
    povZoom     = 1.0;
    povLabelsVisible = true; // reset labels to visible on open
    const lBtn = document.getElementById('povLabelBtn');
    if (lBtn) { lBtn.textContent = '🏷 IDs On'; lBtn.style.opacity = '1'; }
    buildPOVTabs();
    updatePOVHUD();
    updateSelfVisibility();
    updateScrubUI();
    updateZoomUI();
    resizePOV();
    applyStaticCamera();
    povRenderLoop();

    // ── Scroll wheel zoom — normalized so speed is consistent ──
    const povCanvasEl = document.getElementById('povCanvas');
    povCanvasEl.onwheel = e => {
      e.preventDefault();
      // Normalize deltaY — trackpad gives small floats, mouse wheel gives 100+
      // Cap at ±1 effective step per event
      const raw   = e.deltaY;
      const step  = Math.sign(raw) * Math.min(Math.abs(raw) / 400, 1) * 0.12;
      povZoom = Math.max(0.25, Math.min(3.0, povZoom + step));
      updateZoomUI();
      if (!povAnimating) applyStaticCamera();
    };
  };
  // THREE.js loaded eagerly in <head> — always available
  doInit();
}

function closePOV() {
  document.getElementById('povOverlay').classList.remove('open');
  povAnimating = false;
  povPaused    = false;
  povProgress  = 0;
  if (povRaf) cancelAnimationFrame(povRaf);
  if (povRecording) stopPOVVideo();
  // Stop all mixers
  gltfMixers.forEach(m => m.stopAllAction());
  gltfMixers = [];
  // Fully dispose and null — next open rebuilds scene with current materials
  if (povRenderer) { povRenderer.dispose(); povRenderer = null; }
  povScene = null; povCamera = null;
  povPlayerMeshes = []; povDefMeshes = []; povRoutelines = [];
  povBallMesh = null;
}

function povRenderLoop() {
  if (!document.getElementById('povOverlay').classList.contains('open')) return;
  povRaf = requestAnimationFrame(povRenderLoop);
  // Tick GLTF animation mixers
  if (gltfMixers.length > 0) {
    const now = performance.now();
    const delta = (now - gltfClock.then) / 1000;
    gltfClock.then = now;
    gltfMixers.forEach(m => m.update(delta));
  }
  if (povScene && povCamera && povRenderer) povRenderer.render(povScene, povCamera);
}

// ── Playback control functions ─────────────────────────
function adjustZoom(delta) {
  if (delta === 0) {
    povZoom = 1.0; // reset
  } else {
    povZoom = Math.max(0.25, Math.min(3.0, povZoom + delta));
  }
  updateZoomUI();
  if (!povAnimating) applyStaticCamera();
}

function updateZoomUI() {
  const lbl = document.getElementById('povZoomLabel');
  if (lbl) lbl.textContent = povZoom.toFixed(1) + '×';
}

function setPovSpeed(s) {
  povSpeed = s;
  document.querySelectorAll('.pov-ctrl-btn').forEach(b => {
    if (b.textContent === s+'×' || (s===0.25&&b.textContent==='¼×') || (s===0.5&&b.textContent==='½×')) b.classList.add('active');
    else if (['¼×','½×','1×','2×'].includes(b.textContent)) b.classList.remove('active');
  });
  const lbl = document.getElementById('speedBtn-1');
}

function togglePovPause() {
  if (!povAnimating && povProgress === 0) { povRunPlay(); return; }
  povPaused = !povPaused;
  const btn = document.getElementById('povPauseBtn');
  if (btn) btn.textContent = povPaused ? '▶ Resume' : '⏸ Pause';
  if (!povPaused && povAnimating) {
    // Resume — restart rAF from current progress
    povT0 = performance.now() - (povProgress * povTotalMs / povSpeed);
    povRaf = requestAnimationFrame(povStepRef);
  }
}

function stepFrame(dir) {
  // Step ±1% through the play, render that frame statically
  povPaused = true;
  const btn = document.getElementById('povPauseBtn');
  if (btn) btn.textContent = '▶ Resume';
  povProgress = Math.max(0, Math.min(1, povProgress + dir * 0.01));
  updateScrubUI();
  if (povStepFn) povStepFn(povProgress);
}

function scrubTo(val) {
  povPaused = true;
  const btn = document.getElementById('povPauseBtn');
  if (btn) btn.textContent = '▶ Resume';
  povProgress = Number(val) / 100;
  updateScrubUI();
  if (povStepFn) povStepFn(povProgress);
}

function updateScrubUI() {
  const scrub = document.getElementById('povScrub');
  const lbl   = document.getElementById('povProgressLabel');
  if (scrub) scrub.value = Math.round(povProgress * 100);
  if (lbl)   lbl.textContent = Math.round(povProgress * 100) + '%';
}

// Shared state for pause/resume timing
let povT0 = 0;
let povTotalMs = 3400;
let povStepRef = null;

// ── Play animation in POV ──────────────────────────────
function povRunPlay() {
  if (povAnimating && !povPaused) return;

  const allActions = [...motions,...routes,...blocks];
  if (!allActions.length) { alert('Generate a play first, then open POV.'); return; }

  povAnimating = true;
  povPaused    = false;
  if (povProgress >= 1) povProgress = 0; // restart if finished
  document.getElementById('povRunBtn').textContent = '■ Stop';
  document.getElementById('povRunBtn').onclick = stopPOVPlay;
  const pauseBtn = document.getElementById('povPauseBtn');
  if (pauseBtn) pauseBtn.textContent = '⏸ Pause';

  const hasM  = motions.length > 0;
  const MEND  = hasM ? 0.28 : 0;
  povTotalMs  = hasM ? 4200 : 3400;

  // ── Build tracks ───────────────────────────────────
  const offTrk={};
  players.forEach(p=>{
    const pM=motions.filter(a=>a.pid===p.id);
    const pP=[...routes,...blocks].filter(a=>a.pid===p.id);
    const sp={x:p.x,y:p.y};
    let mPts=[];
    pM.forEach(a=>{ const seg=a.pts?.length?a.pts:[sp,sp]; mPts=mPts.concat(mPts.length?seg.slice(1):seg); });
    const mEnd=mPts.length?mPts[mPts.length-1]:sp;
    let plPts=[mEnd];
    pP.forEach(a=>{ let seg=a.pts?.length?a.pts:[mEnd,mEnd]; if(a.type==='block'){const l=seg[seg.length-1];const pv=seg.length>=2?seg[seg.length-2]:seg[0];seg=[...seg,{x:l.x+(l.x-pv.x)*.15,y:l.y+(l.y-pv.y)*.15}];} plPts=plPts.concat(seg.slice(1)); });
    offTrk[p.id]={ motion:mPts.length>1?mPts:null, play:plPts.length>1?plPts:[sp,sp], isQB:p.pos==='QB'||p.label==='QB', isOL:p.pos==='OL'||['LT','LG','C','RG','RT'].includes(p.label) };
  });
  // Ball carriers follow their drawn ball paths (same fix as the 2D engine)
  {
    const plain = {};
    Object.keys(offTrk).forEach(id => plain[id] = offTrk[id].play);
    mergeCarrierTracks(plain);
    Object.keys(plain).forEach(id => offTrk[id].play = plain[id]);
  }
  const defTrk = computeDefenderTracks();
  const isDef = povSelectedSide === 'defense';

  function eIO(t){return t<.5?2*t*t:-1+(4-2*t)*t;}
  function ptAt2D(pts,e){if(!pts||pts.length<2)return pts?pts[0]:{x:0,y:0};const ci=Math.max(0,Math.min(1,e));const idx=Math.min(pts.length-2,Math.floor(ci*(pts.length-1)));const loc=ci*(pts.length-1)-idx;const a=pts[idx],b=pts[idx+1]||a;return{x:a.x+(b.x-a.x)*loc,y:a.y+(b.y-a.y)*loc};}

  // ── Core render-at-progress function (shared by rAF and scrub) ──
  // Track time for leg animation
  let _animFrameTime = 0;

  function renderAtProgress(raw) {
    _animFrameTime += 0.016 * povSpeed; // advance animation clock

    // Move offense
    players.forEach(p=>{
      const pm=povPlayerMeshes.find(m=>m.id===p.id); if(!pm) return;
      const tr=offTrk[p.id];
      let pos2d;
      if(hasM&&raw<MEND){ pos2d=tr.motion?ptAt2D(tr.motion,eIO(raw/MEND)):{x:p.x,y:p.y}; }
      else{ const pr=hasM?(raw-MEND)/(1-MEND):raw; const sp=tr.isQB?Math.min(pr/0.62,1):tr.isOL?Math.min(pr/0.75,1):pr; pos2d=ptAt2D(tr.play,eIO(sp)); }
      const w=canvasToWorld(pos2d.x,pos2d.y);

      // Record live 2D position so the shared ball engine can track players
      p.animX = pos2d.x; p.animY = pos2d.y;

      // Check movement speed for leg animation
      const prevPos = pm.group.position.clone();
      pm.group.position.set(w.x,0,w.z);
      const moveSpd = prevPos.distanceTo(pm.group.position);

      // Face direction
      const pr2=hasM?(Math.min(raw+0.025,1)-MEND)/(1-MEND):Math.min(raw+0.025,1);
      const npos=ptAt2D(tr.play,eIO(Math.max(0,Math.min(1,pr2))));
      const ddx=npos.x-pos2d.x,ddz=npos.y-pos2d.y;
      if(Math.abs(ddx)>0.3||Math.abs(ddz)>0.3) pm.group.rotation.y=Math.atan2(ddx,ddz)+Math.PI;

      // ── LEG ANIMATION ──────────────────────────────
      // Swing legs if moving; settle into stance if stopped
      if (pm.group._legL && pm.group._legR) {
        const phase = pm.group._animT || 0;
        const spd   = moveSpd > 0.004 ? 18 : 0;
        const swing = spd > 0 ? Math.sin(_animFrameTime * spd + phase) * 0.45 : 0;
        const bob   = spd > 0 ? Math.abs(Math.sin(_animFrameTime * spd + phase)) * 0.04 : 0;
        pm.group._legL.rotation.x =  swing;
        pm.group._legR.rotation.x = -swing;
        // Slight body bob on step
        pm.group.position.y = bob;
      }
    });

    // Move defense
    defenders.forEach(d=>{
      const dm=povDefMeshes.find(m=>m.id===d.id); if(!dm) return;
      if(hasM&&raw<MEND) return;
      const pr=hasM?(raw-MEND)/(1-MEND):raw;
      const pts=defTrk[d.id]||[{x:d.x,y:d.y}];
      const pos2d=ptAt2D(pts.length>1?pts:[pts[0],pts[0]],eIO(pr));
      const w=canvasToWorld(pos2d.x,pos2d.y);

      const prevPos = dm.group.position.clone();
      dm.group.position.set(w.x,0,w.z);
      const moveSpd = prevPos.distanceTo(dm.group.position);

      if (dm.group._legL && dm.group._legR) {
        const phase = dm.group._animT || 0;
        const spd   = moveSpd > 0.004 ? 18 : 0;
        const swing = spd > 0 ? Math.sin(_animFrameTime * spd + phase) * 0.42 : 0;
        const bob   = spd > 0 ? Math.abs(Math.sin(_animFrameTime * spd + phase)) * 0.04 : 0;
        dm.group._legL.rotation.x =  swing;
        dm.group._legR.rotation.x = -swing;
        dm.group.position.y = bob;
      }
    });

    // Ball — full ball-script support (snap → carry → handoff → pass)
    if(povBallMesh){
      let bp=null;
      if(ballScript.length){
        bp=getBallPos(raw,hasM,MEND,true);            // live player tracking
        if(!bp){
          const sp=getStaticBallPos();                 // pre-snap: ball on the center
          if(sp){ bp={x:sp.x,y:sp.y,h:0.5,phase:'presnap'}; }
        }
      } else if(povThrowArc){
        // Legacy play-action throw arc
        const pr=hasM?(raw-MEND)/(1-MEND):raw;
        const delay=povThrowArc._throwDelay||0.58;
        if(pr>=delay){
          const tT=Math.min((pr-delay)/(1-delay),1);
          const p0=povThrowArc[0],p1=povThrowArc[1],p2=povThrowArc[2];
          const bx=(1-tT)*(1-tT)*p0.x+2*(1-tT)*tT*p1.x+tT*tT*p2.x;
          const by=(1-tT)*(1-tT)*p0.y+2*(1-tT)*tT*p1.y+tT*tT*p2.y;
          bp={x:bx,y:by,h:Math.sin(tT*Math.PI)*7+0.6,phase:'pass'};
        }
      }
      if(bp){
        const bw=canvasToWorld(bp.x,bp.y);
        povBallMesh.position.set(bw.x,bp.h??0.9,bw.z);
        povBallMesh.visible=true;
        if(bp.phase==='pass'||bp.phase==='snap'||bp.phase==='lateral') povBallMesh.rotation.z+=0.15;
      } else {
        povBallMesh.visible=false;
      }
    }

    // Camera follow
    const sArr=povSelectedSide==='offense'?povPlayerMeshes:povDefMeshes;
    const sMesh=sArr.find(m=>m.id===povSelectedId);
    const rzOff = getRedZoneOffset();
    if(sMesh){
      const mp=sMesh.group.position;
      const fy=sMesh.group.rotation.y;
      if(povCamMode==='fp'){
        povCamera.fov = Math.max(42, Math.min(90, 68 * povZoom));
        povCamera.updateProjectionMatrix();
        povCamera.position.lerp(new THREE.Vector3(mp.x,EYE_HEIGHT,mp.z+rzOff),0.18);
        const forwardZ=isDef?1:-1;
        let lx,lz;
        if(Math.abs(fy)>0.05){
          lx=mp.x+Math.sin(fy)*20;
          lz=(mp.z+rzOff)-Math.cos(fy)*20*(isDef?-1:1);
        } else {
          lx=mp.x;
          lz=(mp.z+rzOff)+forwardZ*20;
        }
        povCamera.lookAt(lx,EYE_HEIGHT-0.12,lz);
      } else if(povCamMode==='broadcast'){
        const zoomD = povZoom;
        povCamera.fov = 58;
        povCamera.updateProjectionMatrix();
        povCamera.position.lerp(new THREE.Vector3(W3*0.52*zoomD, 10*zoomD, mp.z+rzOff+4*zoomD), 0.05);
        povCamera.lookAt(mp.x, 1.2, mp.z+rzOff-5);
      } else if(povCamMode==='blitz'){
        // Static Blitz isometric — doesn't track individual player, shows the play
        const zoomD = povZoom;
        povCamera.fov = Math.max(38, Math.min(72, 56*zoomD));
        povCamera.updateProjectionMatrix();
        const behindZ = (H3/2)*0.38*zoomD;
        const camH    = 11.5/zoomD;
        povCamera.position.lerp(new THREE.Vector3(W3*0.12, camH, behindZ+rzOff), 0.04);
        povCamera.lookAt(0, 0.5, -(H3/2)*0.18+rzOff);
      } else if(povCamMode==='ezoff'){
        const zoomD = povZoom;
        povCamera.fov = Math.min(88, 62*zoomD);
        povCamera.updateProjectionMatrix();
        povCamera.position.set(0, 14/zoomD, (H3/2)*0.62+rzOff);
        povCamera.lookAt(0, 0, -(H3/2)*0.55+rzOff);
      } else {
        const zoomD = povZoom;
        povCamera.fov = Math.min(88, 62*zoomD);
        povCamera.updateProjectionMatrix();
        povCamera.position.set(0, 14/zoomD, -(H3/2)*0.62+rzOff);
        povCamera.lookAt(0, 0, (H3/2)*0.55+rzOff);
      }
    }

    povRenderer.render(povScene,povCamera);
    updateScrubUI();
  }

  // Expose for scrubbing
  povStepFn = renderAtProgress;

  // ── rAF loop ───────────────────────────────────────
  // Start timing from current progress position
  povT0 = performance.now() - (povProgress * povTotalMs / Math.max(povSpeed, 0.1));

  function povStep(ts) {
    if (!povAnimating) return;
    if (povPaused) { povRaf = requestAnimationFrame(povStep); return; } // idle loop while paused

    const elapsed = (ts - povT0) * povSpeed;
    const raw = Math.min(elapsed / povTotalMs, 1);
    povProgress = raw;

    renderAtProgress(raw);

    if (raw >= 1) {
      povAnimating = false;
      povProgress  = 1;
      updateScrubUI();
      document.getElementById('povRunBtn').textContent = '▶ Run Play';
      document.getElementById('povRunBtn').onclick = povRunPlay;
      povRaf = null;
      povRenderLoop(); // restart idle render loop — camera/zoom must work after play ends
      return;
    }
    povRaf = requestAnimationFrame(povStep);
  }

  povStepRef = povStep;
  povRaf = requestAnimationFrame(povStep);
}

// ── POV PNG screenshot ────────────────────────
function savePOVPNG() {
  if (!povRenderer) { alert('Open the POV view first.'); return; }
  // Force a render to make sure canvas is current
  if (povScene && povCamera) povRenderer.render(povScene, povCamera);
  const c   = document.getElementById('povCanvas');
  const a   = document.createElement('a');
  const n   = (document.getElementById('playName')?.value || 'pov').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const cam = povCamMode === 'fp' ? 'firstperson' : povCamMode === 'broadcast' ? 'broadcast' :
              povCamMode === 'ezoff' ? 'endzone-off' : 'endzone-def';
  a.download = n + '-' + cam + '.png';
  // Three.js canvas needs preserveDrawingBuffer — use toDataURL with a fresh render
  try {
    a.href = c.toDataURL('image/png');
    a.click();
    status('POV screenshot saved.', 'success');
  } catch(e) {
    // If preserveDrawingBuffer wasn't set, re-init renderer with it
    reinitPOVWithBuffer();
  }
}

function reinitPOVWithBuffer() {
  // Re-create renderer with preserveDrawingBuffer:true so PNG export works
  if (!povScene) return;
  const c = document.getElementById('povCanvas');
  povRenderer.dispose();
  povRenderer = new THREE.WebGLRenderer({ canvas:c, antialias:true, preserveDrawingBuffer:true });
  povRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  povRenderer.shadowMap.enabled = true;
  povRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  povRenderer.setClearColor(0x87ceeb);
  resizePOV();
  if (povScene && povCamera) povRenderer.render(povScene, povCamera);
  setTimeout(() => savePOVPNG(), 100);
}

// ── POV WebM video recording ──────────────────
let povMediaRecorder = null;
let povRecordedChunks = [];
let povRecording = false;

function startPOVVideo() {
  if (povRecording) { stopPOVVideo(); return; }
  const c = document.getElementById('povCanvas');
  if (!c.captureStream) {
    alert('Video recording needs Chrome or Edge. On Safari use Cmd+Shift+5 screen record.');
    return;
  }
  try {
    povRecordedChunks = [];
    const stream = c.captureStream(30);
    const opts = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? { mimeType:'video/webm;codecs=vp9' }
      : { mimeType:'video/webm' };
    povMediaRecorder = new MediaRecorder(stream, opts);
    povMediaRecorder.ondataavailable = e => { if(e.data.size>0) povRecordedChunks.push(e.data); };
    povMediaRecorder.onstop = savePOVVideoFile;
    povMediaRecorder.start(100);
    povRecording = true;
    const btn = document.getElementById('povVideoBtn');
    if (btn) { btn.textContent = '⏹ Stop Rec'; btn.style.background='rgba(180,30,30,.85)'; }
    // Auto-start play
    povRunPlay();
    status('POV recording started — will save when animation finishes.', 'loading');
  } catch(err) {
    alert('Could not start POV recording: ' + err.message);
  }
}

function stopPOVVideo() {
  if (povMediaRecorder && povRecording) {
    povMediaRecorder.stop();
    povRecording = false;
    const btn = document.getElementById('povVideoBtn');
    if (btn) { btn.textContent = '🎬 Video'; btn.style.background='rgba(30,60,120,.85)'; }
  }
}

function savePOVVideoFile() {
  if (!povRecordedChunks.length) return;
  const blob = new Blob(povRecordedChunks, { type:'video/webm' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const n    = (document.getElementById('playName')?.value||'pov').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const cam  = povCamMode==='fp'?'firstperson':povCamMode==='broadcast'?'broadcast':
               povCamMode==='ezoff'?'endzone-off':'endzone-def';
  a.href = url; a.download = n+'-'+cam+'.webm'; a.click();
  URL.revokeObjectURL(url);
  povRecordedChunks = [];
  status('POV video saved as .webm — opens in Chrome, VLC, Firefox.', 'success');
}

function stopPOVPlay() {
  povAnimating = false;
  povPaused    = false;
  povProgress  = 0;
  if (povRaf) cancelAnimationFrame(povRaf);
  povRaf = null;
  // Auto-stop POV video recording if active
  if (povRecording) stopPOVVideo();
  document.getElementById('povRunBtn').textContent = '▶ Run Play';
  document.getElementById('povRunBtn').onclick = povRunPlay;
  const pauseBtn = document.getElementById('povPauseBtn');
  if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
  updateScrubUI();
  if (povBallMesh) povBallMesh.visible = false;
  players.forEach(p=>{const pm=povPlayerMeshes.find(m=>m.id===p.id);if(pm){const w=canvasToWorld(p.x,p.y);pm.group.position.set(w.x,0,w.z);pm.group.rotation.y=Math.PI;}});
  defenders.forEach(d=>{const dm=povDefMeshes.find(m=>m.id===d.id);if(dm){const w=canvasToWorld(d.x,d.y);dm.group.position.set(w.x,0,w.z);dm.group.rotation.y=0;}});
  applyStaticCamera();
  povRenderLoop(); // restart idle render loop so camera/zoom changes are visible
}
// ═══════════════════════════════════════════════════════

// ── Label visibility toggle ────────────────────────────
let povLabelsVisible = true;
function togglePOVLabels() {
  povLabelsVisible = !povLabelsVisible;
  [...povPlayerMeshes, ...povDefMeshes].forEach(pm => {
    if (pm.group._labelSprite) pm.group._labelSprite.visible = povLabelsVisible;
  });
  const btn = document.getElementById('povLabelBtn');
  if (btn) {
    btn.textContent = povLabelsVisible ? '🏷 IDs On' : '🏷 IDs Off';
    btn.style.opacity = povLabelsVisible ? '1' : '0.5';
  }
}

// ── Red Zone mode toggle ───────────────────────────────
function toggleRedZone() {
  povRedZoneMode = !povRedZoneMode;
  const btn = document.getElementById('povRedZoneBtn');
  if (btn) {
    btn.textContent = povRedZoneMode ? '🔴 Red Zone ON' : '🔴 Red Zone';
    btn.style.background = povRedZoneMode ? 'rgba(160,20,20,0.9)' : 'rgba(80,10,10,0.7)';
    btn.style.borderColor = povRedZoneMode ? '#ff4444' : '#882222';
  }
  if (!povAnimating) applyStaticCamera();
}
