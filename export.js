import * as THREE from './modules/three.module.js';
import { ARButton } from './ARButton.js';
import { createReticle, createHitTestSource, updateReticle, disposeReticle } from './reticleHelper.js';
// ---- IMPORT BARU ----
import { GLTFLoader } from './modules/GLTFLoader.js';

// ===== Globals =====
let renderer, scene;
let camera;                        // non-AR camera for fallback view
let controller;
let reticle;
let hitTestSource = null, hitCancel = null;
let xrSession = null;
let arRoot = null;                 // session-scoped container (spawned shapes)
let lastSpawnTs = 0;

let refSpace = null;               // XRReferenceSpace (local)
let lastXRFrame = null;            // keep last frame for anchors
let lastHit = null;                // last XRHitTestResult (for anchor creation)
const placed = [];                 // [{ mesh, anchorSpace? }]

// ---- ASET BARU ----
let gajahGroup = null;             // Grup untuk menampung 3 model
let groupPlaced = false;           // Flag agar kita hanya menempatkan 1x
const loader = new GLTFLoader();

// ===== Bootstrap =====
init();
animateFallback();

function init() {
  // WebGL manual
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl', { antialias: true });

  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = null;

  // Fallback camera (non-AR)
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 1.6, 0); // Posisi kamera fallback

  // ---- HAPUS KUBUS MERAH, GANTI DENGAN GRUP GAJAH ----
  
  // Pencahayaan
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(hemi);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 1.5, 0.5);
  scene.add(dirLight);

  // Grup untuk menampung semua model
  gajahGroup = new THREE.Group();
  gajahGroup.name = "GajahWorld";
  gajahGroup.position.set(0, 1.5, -3); // Posisi untuk fallback view
  scene.add(gajahGroup);

  // Gajah (Tengah)
  loader.load('./assets/gajah/gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(0, 0, 0);
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load gajah.glb', e));

  // Tulang (Kanan)
  loader.load('./assets/tulang/tulang_gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(1.5, 0, 0);
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load tulang_gajah.glb', e));

  // Jantung (Kiri)
  loader.load('./assets/jantung/jantung.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(-1.5, 0, 0);
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load jantung.glb', e));
  // ---- SELESAI MODIFIKASI ASET ----

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Button Enter/Exit di header (DOM overlay aktif)
  ARButton.createButton(renderer, {
    referenceSpaceType: 'local',
    sessionInit: {
      requiredFeatures: ['hit-test', 'anchors'], // ---- PASTIKAN MINTA 'anchors' ----
      optionalFeatures: ['dom-overlay','local'],
      domOverlay: { root: document.getElementById('overlayRoot') || document.body }
    }
  });

  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);
}

function animateFallback() {
  if (xrSession) return;
  requestAnimationFrame(animateFallback);
  // ---- ROTASI GRUP GAJAH ----
  if (gajahGroup) gajahGroup.rotation.y += 0.01;
  renderer.render(scene, camera);
}

// ===== AR lifecycle =====
async function onSessionStart() {
  xrSession = renderer.xr.getSession();

  // reset per-sesi
  lastSpawnTs = 0;
  lastXRFrame = null;
  lastHit = null;
  placed.length = 0;
  groupPlaced = false; // ---- Flag untuk menempatkan grup

  // ---- Sembunyikan grup fallback ----
  if (gajahGroup) gajahGroup.visible = false;

  // reference space
  refSpace = await xrSession.requestReferenceSpace('local');

  // container untuk objek sesi (spawn shapes)
  arRoot = new THREE.Group();
  arRoot.name = 'ar-session-root';
  scene.add(arRoot);

  // input jalur 1: session-level
  xrSession.addEventListener('selectstart', onSelectLike);
  xrSession.addEventListener('select', onSelectLike);

  // input jalur 2: controller(0)
  controller = renderer.xr.getController(0);
  controller.addEventListener('selectstart', onSelectLike);
  controller.addEventListener('select', onSelectLike);
  scene.add(controller);

  // input jalur 3: DOM fallback
  const domOpts = { passive: true };
  renderer.domElement.addEventListener('pointerup', domSelectFallback, domOpts);
  renderer.domElement.addEventListener('click', domSelectFallback, domOpts);
  renderer.domElement.addEventListener('touchend', domSelectFallback, domOpts);

  // reticle
  reticle = createReticle();
  scene.add(reticle);

  // hit-test source (viewer space)
  try {
    const r = await createHitTestSource(xrSession);
    hitTestSource = r.hitTestSource;
    hitCancel = r.cancel;
  } catch (e) {
    console.warn('Hit-test source unavailable:', e);
  }

  // XR loop
  renderer.setAnimationLoop(renderXR);
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);

  // ---- Tampilkan kembali grup fallback ----
  if (gajahGroup) gajahGroup.visible = true;

  // Lepas DOM fallback
  renderer.domElement.removeEventListener('pointerup', domSelectFallback);
  renderer.domElement.removeEventListener('click', domSelectFallback);
  renderer.domElement.removeEventListener('touchend', domSelectFallback);

  // Lepas session/controller listeners
  if (xrSession) {
    xrSession.removeEventListener('selectstart', onSelectLike);
    xrSession.removeEventListener('select', onSelectLike);
  }
  if (controller) {
    controller.removeEventListener('selectstart', onSelectLike);
    controller.removeEventListener('select', onSelectLike);
    scene.remove(controller);
    controller = null;
  }

  // stop & reset hit-test
  try { hitCancel?.(); } catch {}
  hitCancel = null;
  hitTestSource = null;
  lastHit = null;
  lastXRFrame = null;

  // reticle bersih
  if (reticle) { disposeReticle(reticle); reticle = null; }

  // bersihkan objek sesi (spawned shapes)
  if (arRoot) {
    arRoot.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => m?.dispose?.());
      }
    });
    scene.remove(arRoot);
    arRoot = null;
  }
  
  // ---- Hapus save anchor ----
  // saveAnchorMatrix(cubeAnchor); 

  xrSession = null;
  requestAnimationFrame(animateFallback);
}

// ===== XR render loop =====
function renderXR(time, frame) {
  const isXR = renderer.xr.isPresenting;

  if (!isXR || !frame) {
    if (gajahGroup) gajahGroup.rotation.y += 0.01;
    const cam = isXR ? renderer.xr.getCamera(camera) : camera;
    renderer.render(scene, cam);
    return;
  }

  lastXRFrame = frame;
  const session = frame.session;

  if (!refSpace) refSpace = renderer.xr.getReferenceSpace?.() || refSpace;

  // update reticle & lastHit
  const haveReticle = updateReticle(reticle, frame, hitTestSource, refSpace);
  if (!haveReticle || groupPlaced) { // ---- Sembunyikan reticle jika grup sudah ditempatkan
    lastHit = null;
    if(reticle) reticle.visible = false;
  } else {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length) lastHit = results[0];
  }

  // ---- Hapus penempatan 'cubeAnchor' ----
  // if (!session._cubePlacedOnce) { ... }

  // update anchored shapes
  for (const p of placed) {
    if (!p.anchorSpace) continue;
    const apose = frame.getPose(p.anchorSpace, refSpace);
    if (apose) {
      p.mesh.matrix.fromArray(apose.transform.matrix);
      p.mesh.matrixAutoUpdate = false;
      p.mesh.updateMatrixWorld(true); // Pastikan world matrix terupdate
    }
  }

  // ---- Hapus rotasi 'cube' ----
  // cube.rotation.y += 0.01;

  renderer.render(scene, renderer.xr.getCamera(camera));
}

// ===== Interaksi =====
function onSelectLike() { onSelect(); }

async function onSelect() {
  // ---- Modifikasi untuk menempatkan GRUP GAJAH, hanya satu kali ----
  if (!reticle || !reticle.visible || groupPlaced) return;

  // debounce
  const now = performance.now();
  if (now - lastSpawnTs < 160) return;
  lastSpawnTs = now;

  // Clone grup gajah kita
  const mesh = gajahGroup.clone();
  mesh.visible = true;
  mesh.position.set(0, 0, 0); // Pastikan posisi lokal 0,0,0 relatif terhadap anchor
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);     // Skala sudah di-apply di dalam grup

  // === Coba anchor dulu (stay-in-place anti-drift) ===
  let anchored = false;
  try {
    if (lastHit && typeof lastHit.createAnchor === 'function') {
      const anchor = await lastHit.createAnchor();
      if (anchor?.anchorSpace) {
        (arRoot ?? scene).add(mesh);
        placed.push({ mesh, anchorSpace: anchor.anchorSpace });
        anchored = true;
        groupPlaced = true;      // Tandai sudah ditempatkan
        reticle.visible = false; // Sembunyikan reticle
      }
    }
  } catch (e) {
    anchored = false; // fallback di bawah
  }

  if (!anchored) {
    // === Fallback klasik: tempel world-matrix reticle ===
    mesh.applyMatrix4(reticle.matrix);
    mesh.matrixAutoUpdate = false;
    placed.push({ mesh }); // tanpa anchorSpace
    (arRoot ?? scene).add(mesh);
    groupPlaced = true;      // Tandai sudah ditempatkan
    reticle.visible = false; // Sembunyikan reticle
  }
}

// DOM fallback saat XR aktif
function domSelectFallback(e) {
  if (e.target?.closest?.('.xr-btn')) return;
  if (renderer.xr.isPresenting) onSelect();
}

// ===== Hapus Persist utilities =====
// function saveAnchorMatrix(anchor) { ... }
// function loadAnchorMatrix(anchor) { ... }
// function placeAnchorInFrontOfCamera(anchor, cam, dist = 1.0) { ... }