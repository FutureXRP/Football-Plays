// ── GLB CHARACTER SYSTEM ──────────────────────────────
// Loads the rigged player model, builds per-character prefabs,
// poses skeletons into football stances, and drives a procedural
// run cycle while players move. Shared by pov.js and pose tools.

const CHAR_GLB_URL = 'american_football_players_animated_rigged.glb';

// Armature/mesh pairs inside the GLB (names as sanitized by Three.js r128)
const CHAR_PAIRS = [
  { armature: 'Metarig_Man005',   mesh: 'Object_6'   }, // 0
  { armature: 'Metarig_Man006',   mesh: 'Object_53'  }, // 1
  { armature: 'Metarig_Man013',   mesh: 'Object_100' }, // 2
  { armature: 'Metarig_Woman019', mesh: 'Object_147' }, // 3
  { armature: 'Metarig_Woman020', mesh: 'Object_194' }, // 4
  { armature: 'Metarig_Woman021', mesh: 'Object_241' }, // 5
];

let charGLTF = null;        // raw loaded gltf
let charPrefabs = [];       // one trimmed subtree per character

// Approximate world bbox of a posed SkinnedMesh by sampling skinned vertices.
// Box3.setFromObject ignores skinning, which is why the old sizing was wrong.
function charSkinnedBox(mesh) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  const step = Math.max(1, Math.floor(pos.count / 350));
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i);
    mesh.boneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(v);
  }
  return box;
}

// Bone lookup tolerant of name sanitization differences
// ("thigh.L_36" / "thighL_36" / "thigh_L_36" all match "thighL")
function charNormName(n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function charFindBone(skeleton, want) {
  const w = charNormName(want);
  for (const b of skeleton.bones) {
    const n = charNormName(b.name);
    // strip trailing numeric node-index suffix for comparison
    if (n.startsWith(w)) return b;
  }
  return null;
}

// ── STANCE LIBRARY ────────────────────────────────────
// Each stance: list of [boneName, axisRotations {x,y,z} in radians]
// applied as deltas on top of the bind pose.
const CHAR_STANCES = {
  // Relaxed athletic stand — arms down from the A-pose
  stand: [
    ['upper_arm.L', { z: -1.10 }],
    ['upper_arm.R', { z:  1.10 }],
    ['forearm.L',   { x:  0.20 }],
    ['forearm.R',   { x:  0.20 }],
  ],
  // Two-point ready: knees bent, slight forward lean, arms hanging ready
  ready2pt: [
    ['thigh.L',     { x: -0.55 }],
    ['thigh.R',     { x: -0.55 }],
    ['shin.L',      { x:  0.85 }],
    ['shin.R',      { x:  0.85 }],
    ['foot.L',      { x: -0.30 }],
    ['foot.R',      { x: -0.30 }],
    ['spine.001',   { x:  0.22 }],
    ['spine.002',   { x:  0.18 }],
    ['spine.004',   { x: -0.18 }],
    ['upper_arm.L', { z: -1.00, x: 0.35 }],
    ['upper_arm.R', { z:  1.00, x: 0.35 }],
    ['forearm.L',   { x:  0.55 }],
    ['forearm.R',   { x:  0.55 }],
  ],
  // RB: deeper crouch, hands resting on knees
  handsOnKnees: [
    ['thigh.L',     { x: -0.85 }],
    ['thigh.R',     { x: -0.85 }],
    ['shin.L',      { x:  1.15 }],
    ['shin.R',      { x:  1.15 }],
    ['foot.L',      { x: -0.35 }],
    ['foot.R',      { x: -0.35 }],
    ['spine.001',   { x:  0.42 }],
    ['spine.002',   { x:  0.28 }],
    ['spine.004',   { x: -0.35 }],
    ['upper_arm.L', { z: -0.55, x: 0.85 }],
    ['upper_arm.R', { z:  0.55, x: 0.85 }],
    ['forearm.L',   { x:  0.25 }],
    ['forearm.R',   { x:  0.25 }],
  ],
  // Three-point: deep squat, trunk pitched hard, right hand to the ground
  threePoint: [
    ['thigh.L',     { x: -1.25 }],
    ['thigh.R',     { x: -1.05 }],
    ['shin.L',      { x:  1.65 }],
    ['shin.R',      { x:  1.45 }],
    ['foot.L',      { x: -0.45 }],
    ['foot.R',      { x: -0.45 }],
    ['spine.001',   { x:  0.55 }],
    ['spine.002',   { x:  0.40 }],
    ['spine.003',   { x:  0.15 }],
    ['spine.004',   { x: -0.50 }],
    // Right arm reaches down to the turf
    ['upper_arm.R', { z:  0.35, x: 1.30 }],
    ['forearm.R',   { x:  0.10 }],
    // Left forearm rests across the thigh
    ['upper_arm.L', { z: -0.65, x: 0.95 }],
    ['forearm.L',   { x:  0.85 }],
  ],
  // QB under center: medium knee bend, hands extended forward (under center)
  qbUnderCenter: [
    ['thigh.L',     { x: -0.55 }],
    ['thigh.R',     { x: -0.55 }],
    ['shin.L',      { x:  0.80 }],
    ['shin.R',      { x:  0.80 }],
    ['foot.L',      { x: -0.25 }],
    ['foot.R',      { x: -0.25 }],
    ['spine.001',   { x:  0.30 }],
    ['spine.002',   { x:  0.22 }],
    ['spine.004',   { x: -0.25 }],
    ['upper_arm.L', { z: -0.50, x: 1.10 }],
    ['upper_arm.R', { z:  0.50, x: 1.10 }],
    ['forearm.L',   { x:  0.30 }],
    ['forearm.R',   { x:  0.30 }],
  ],
  // WR split-end stance: upright, staggered lean
  sprinter: [
    ['thigh.L',     { x: -0.35 }],
    ['thigh.R',     { x: -0.15 }],
    ['shin.L',      { x:  0.55 }],
    ['shin.R',      { x:  0.30 }],
    ['spine.001',   { x:  0.30 }],
    ['spine.002',   { x:  0.20 }],
    ['spine.004',   { x: -0.25 }],
    ['upper_arm.L', { z: -1.05, x: 0.25 }],
    ['upper_arm.R', { z:  1.05, x: 0.25 }],
    ['forearm.L',   { x:  0.65 }],
    ['forearm.R',   { x:  0.65 }],
  ],
};

function charApplyStance(skeleton, stanceName) {
  skeleton.pose(); // reset to bind
  const stance = CHAR_STANCES[stanceName] || CHAR_STANCES.stand;
  stance.forEach(([name, rot]) => {
    const b = charFindBone(skeleton, name);
    if (!b) return;
    if (rot.x) b.rotation.x += rot.x;
    if (rot.y) b.rotation.y += rot.y;
    if (rot.z) b.rotation.z += rot.z;
  });
}

// Stance per football role
function charStanceFor(pos, isDef, opts = {}) {
  if (!isDef) {
    if (pos === 'OL') return 'threePoint';
    if (pos === 'TE') return 'threePoint';
    if (pos === 'QB') return opts.underCenter ? 'qbUnderCenter' : 'ready2pt';
    if (pos === 'RB' || pos === 'FB') return 'handsOnKnees';
    return 'sprinter';            // WR
  }
  if (pos === 'DL') return 'threePoint';
  if (pos === 'LB') return 'ready2pt';
  return 'ready2pt';              // CB / S read position
}

// Character model per role (body types from the GLB)
function charIdxFor(pos, isDef) {
  if (!isDef) {
    if (pos === 'OL') return 4;
    if (pos === 'QB') return 0;
    if (pos === 'RB' || pos === 'FB') return 1;
    if (pos === 'TE') return 2;
    return 5;                     // WR
  }
  if (pos === 'DL') return 4;
  if (pos === 'LB') return 0;
  if (pos === 'CB') return 1;
  return 2;                       // S
}

// ── LOADING & PREFABS ─────────────────────────────────
function charLoad(onDone, onError) {
  if (charPrefabs.length) { onDone && onDone(); return; }
  if (!THREE.GLTFLoader) { onError && onError('no loader'); return; }
  new THREE.GLTFLoader().load(CHAR_GLB_URL, gltf => {
    try {
      charGLTF = gltf;
      charPrefabs = CHAR_PAIRS.map(pair => buildCharPrefab(gltf, pair));
      if (charPrefabs.some(p => !p)) throw new Error('missing character parts');
      onDone && onDone();
    } catch (e) {
      console.error('Character prefab build failed:', e);
      charPrefabs = [];
      onError && onError(e);
    }
  }, undefined, err => {
    console.error('GLB load failed:', err);
    onError && onError(err);
  });
}

// One full-scene clone per character type, with the other 5 meshes removed
function buildCharPrefab(gltf, pair) {
  const clone = THREE.SkeletonUtils.clone(gltf.scene);
  let target = null;
  const trash = [];
  clone.traverse(n => {
    n.frustumCulled = false;
    if (n.isSkinnedMesh) {
      if (n.name === pair.mesh) target = n;
      else trash.push(n);
    }
  });
  if (!target) return null;
  trash.forEach(n => n.parent && n.parent.remove(n));
  return { root: clone, meshName: pair.mesh };
}

// ── CHARACTER INSTANCE ────────────────────────────────
// Returns { group, mesh, skeleton, bones, eyeY, height } — group has feet
// at y=0, centered on x/z, facing its bind direction; caller rotates it.
const CHAR_TARGET_HEIGHT = 2.35; // world units (standing)

function makeCharInstance(charIdx, stanceName, tintHex) {
  const prefab = charPrefabs[charIdx % charPrefabs.length];
  if (!prefab) return null;
  const root = THREE.SkeletonUtils.clone(prefab.root);
  let mesh = null;
  root.traverse(n => {
    n.frustumCulled = false;
    if (n.isSkinnedMesh && n.name === prefab.meshName) mesh = n;
  });
  if (!mesh) return null;

  // Soft team tint over the baked texture
  mesh.material = mesh.material.clone();
  if (tintHex !== undefined && tintHex !== null) {
    const tr = ((tintHex >> 16) & 0xff) / 255;
    const tg = ((tintHex >> 8)  & 0xff) / 255;
    const tb = (tintHex & 0xff) / 255;
    mesh.material.color = new THREE.Color(
      0.38 + tr * 0.62, 0.38 + tg * 0.62, 0.38 + tb * 0.62);
  }
  mesh.castShadow = true;

  const group = new THREE.Group();
  group.add(root);

  // cache animation bones for the run cycle
  const bones = {
    thighL: charFindBone(mesh.skeleton, 'thigh.L'),
    thighR: charFindBone(mesh.skeleton, 'thigh.R'),
    shinL:  charFindBone(mesh.skeleton, 'shin.L'),
    shinR:  charFindBone(mesh.skeleton, 'shin.R'),
    footL:  charFindBone(mesh.skeleton, 'foot.L'),
    footR:  charFindBone(mesh.skeleton, 'foot.R'),
    armL:   charFindBone(mesh.skeleton, 'upper_arm.L'),
    armR:   charFindBone(mesh.skeleton, 'upper_arm.R'),
    foreL:  charFindBone(mesh.skeleton, 'forearm.L'),
    foreR:  charFindBone(mesh.skeleton, 'forearm.R'),
    spine1: charFindBone(mesh.skeleton, 'spine.001'),
  };

  // 1) uniform scale from BIND height so body proportions are constant
  mesh.skeleton.pose();
  // bind rotations: the run cycle poses limbs as deltas from these
  const bindRot = {};
  Object.entries(bones).forEach(([k, b]) => {
    if (b) bindRot[k] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
  });
  root.updateMatrixWorld(true);
  const bindBox = charSkinnedBox(mesh);
  const bindSize = new THREE.Vector3(); bindBox.getSize(bindSize);
  const s = CHAR_TARGET_HEIGHT / (bindSize.y || 1);
  group.scale.setScalar(s);

  // 2) stance pose, then re-ground feet and center
  charApplyStance(mesh.skeleton, stanceName);
  group.updateMatrixWorld(true);
  const posedBox = charSkinnedBox(mesh);
  const center = new THREE.Vector3(); posedBox.getCenter(center);
  // convert world offsets back into root-local (group is scaled)
  root.position.x -= center.x / s;
  root.position.z -= center.z / s;
  root.position.y -= posedBox.min.y / s;

  const eyeY = (posedBox.max.y - posedBox.min.y) * 0.93;

  // remember stance rotations so the run cycle can settle back into them
  const stanceRot = {};
  Object.entries(bones).forEach(([k, b]) => {
    if (b) stanceRot[k] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
  });

  return {
    group, mesh, skeleton: mesh.skeleton, bones, stanceRot, bindRot,
    eyeY, height: posedBox.max.y - posedBox.min.y, stanceName,
  };
}

// Procedural run cycle — call every frame with phase (radians) while moving,
// or with moving=false to settle back into the stance.
function charRunCycle(inst, phase, moving) {
  const { bones, stanceRot, bindRot } = inst;
  if (!bones.thighL || !bones.thighR) return;
  if (!moving) {
    Object.entries(bones).forEach(([k, b]) => {
      if (b && stanceRot[k]) {
        b.rotation.x = stanceRot[k].x;
        b.rotation.y = stanceRot[k].y;
        b.rotation.z = stanceRot[k].z;
      }
    });
    return;
  }
  // All offsets are deltas from the bind pose
  const B = k => bindRot[k] || { x: 0, y: 0, z: 0 };
  const swing = Math.sin(phase) * 0.80;
  bones.thighL.rotation.x = B('thighL').x - 0.30 + swing;
  bones.thighR.rotation.x = B('thighR').x - 0.30 - swing;
  if (bones.shinL) bones.shinL.rotation.x = B('shinL').x + 0.45 + Math.max(0, -swing) * 1.2;
  if (bones.shinR) bones.shinR.rotation.x = B('shinR').x + 0.45 + Math.max(0,  swing) * 1.2;
  if (bones.footL) bones.footL.rotation.x = B('footL').x - 0.20;
  if (bones.footR) bones.footR.rotation.x = B('footR').x - 0.20;
  // arms pump opposite the legs, held low and bent
  if (bones.armL) {
    bones.armL.rotation.x = B('armL').x + 0.30 - swing * 0.65;
    bones.armL.rotation.z = B('armL').z - 1.20;
  }
  if (bones.armR) {
    bones.armR.rotation.x = B('armR').x + 0.30 + swing * 0.65;
    bones.armR.rotation.z = B('armR').z + 1.20;
  }
  if (bones.foreL) bones.foreL.rotation.x = B('foreL').x + 0.95;
  if (bones.foreR) bones.foreR.rotation.x = B('foreR').x + 0.95;
  if (bones.spine1) bones.spine1.rotation.x = B('spine1').x + 0.22;
}
