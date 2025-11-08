import * as THREE from './modules/three.module.js';
import { ARButton } from './ARButton.js';
import { createReticle, createHitTestSource, updateReticle, disposeReticle } from './reticleHelper.js';
import { GLTFLoader } from './modules/gltfloader.js';

// ===== Globals =====
let renderer, scene;
let camera;
let controller;
let reticle;
let hitTestSource = null, hitCancel = null;
let xrSession = null;
let arRoot = null;
let lastSpawnTs = 0;

let refSpace = null;
let lastXRFrame = null;
let lastHit = null;
const placed = [];

let gajahGroup = null;
let groupPlaced = false;
const loader = new GLTFLoader();

// ===== Bootstrap =====
init();
animateFallback();

function init() {
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl', { antialias: true });

  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 1.6, 0); 

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  scene.add(hemi);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 1.5, 0.5);
  scene.add(dirLight);

  gajahGroup = new THREE.Group();
  gajahGroup.name = "GajahWorld";
  gajahGroup.position.set(0, 1.5, -3); 
  scene.add(gajahGroup);

  // Gajah (Tengah)
  loader.load('./assets/gajah/gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(0, 0, 0);
      model.name = 'gajahModel';
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load gajah.glb', e));

  // Tulang (Kanan)
  loader.load('./assets/tulang/tulang_gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(0, 0, 0);
      model.name = 'tulangModel';
      model.visible = false; 
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load tulang_gajah.glb', e));

  // Jantung (Kiri)
  loader.load('./assets/jantung/jantung.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(0, 0, 0);
      model.name = 'jantungModel';
      model.visible = false;
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load jantung.glb', e));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  ARButton.createButton(renderer, {
    referenceSpaceType: 'local',
    sessionInit: {
      requiredFeatures: ['hit-test', 'anchors'], 
      optionalFeatures: ['dom-overlay','local'],
      domOverlay: { root: document.getElementById('overlayRoot') || document.body }
    }
  });

  document.getElementById('btn-gajah').addEventListener('click', () => showModel('gajahModel'));
  document.getElementById('btn-tulang').addEventListener('click', () => showModel('tulangModel'));
  document.getElementById('btn-jantung').addEventListener('click', () => showModel('jantungModel'));

  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);
}

// --- MODIFIKASI UTAMA DI SINI ---
/**
 * Menampilkan model berdasarkan nama dan menyembunyikan yang lain.
 * Ini sekarang menargetkan objek yang sudah ditempatkan di AR.
 * @param {string} nameToShow Nama model yang ingin ditampilkan.
 */
function showModel(nameToShow) {
  // Dapatkan grup objek yang sudah ditempatkan di AR (yang ada di dalam array 'placed')
  const placedGroup = placed.length > 0 ? placed[0].mesh : null;

  let targetGroup = null;

  if (placedGroup && placedGroup.visible) {
    // Jika kita sudah menempatkan objek di AR, itulah target kita
    targetGroup = placedGroup;
  } else if (gajahGroup && gajahGroup.visible) {
    // Jika kita masih di mode 3D fallback (sebelum masuk AR atau setelah keluar)
    targetGroup = gajahGroup;
  }

  if (!targetGroup) return; // Tidak ada yang bisa diubah

  // Jalankan traverse pada grup yang TEPAT (baik itu yang di AR atau yang fallback)
  targetGroup.traverse((child) => {
    if (child.name === 'gajahModel' || child.name === 'tulangModel' || child.name === 'jantungModel') {
      child.visible = (child.name === nameToShow);
    }
  });
}
// --- AKHIR MODIFIKASI UTAMA ---

function animateFallback() {
  if (xrSession) return;
  requestAnimationFrame(animateFallback);
  if (gajahGroup) gajahGroup.rotation.y += 0.01;
  renderer.render(scene, camera);
}

// ===== AR lifecycle =====
async function onSessionStart() {
  xrSession = renderer.xr.getSession();

  lastSpawnTs = 0;
  lastXRFrame = null;
  lastHit = null;
  placed.length = 0;
  groupPlaced = false; 

  if (gajahGroup) gajahGroup.visible = false;

  document.getElementById('overlayRoot').classList.add('ar-active');

  refSpace = await xrSession.requestReferenceSpace('local');

  arRoot = new THREE.Group();
  arRoot.name = 'ar-session-root';
  scene.add(arRoot);

  xrSession.addEventListener('selectstart', onSelectLike);
  xrSession.addEventListener('select', onSelectLike);

  controller = renderer.xr.getController(0);
  controller.addEventListener('selectstart', onSelectLike);
  controller.addEventListener('select', onSelectLike);
  scene.add(controller);

  const domOpts = { passive: true };
  renderer.domElement.addEventListener('pointerup', domSelectFallback, domOpts);
  renderer.domElement.addEventListener('click', domSelectFallback, domOpts);
  renderer.domElement.addEventListener('touchend', domSelectFallback, domOpts);

  reticle = createReticle();
  scene.add(reticle);

  try {
    const r = await createHitTestSource(xrSession);
    hitTestSource = r.hitTestSource;
    hitCancel = r.cancel;
  } catch (e) {
    console.warn('Hit-test source unavailable:', e);
  }

  renderer.setAnimationLoop(renderXR);
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);

  document.getElementById('overlayRoot').classList.remove('ar-active');

  // Bersihkan array 'placed' saat sesi berakhir
  placed.length = 0; 
  groupPlaced = false;

  if (gajahGroup) {
    gajahGroup.visible = true;
    // Reset visibilitas default saat keluar AR
    showModel('gajahModel'); 
  }

  renderer.domElement.removeEventListener('pointerup', domSelectFallback);
  renderer.domElement.removeEventListener('click', domSelectFallback);
  renderer.domElement.removeEventListener('touchend', domSelectFallback);

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

  try { hitCancel?.(); } catch {}
  hitCancel = null;
  hitTestSource = null;
  lastHit = null;
  lastXRFrame = null;

  if (reticle) { disposeReticle(reticle); reticle = null; }

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

  const haveReticle = updateReticle(reticle, frame, hitTestSource, refSpace);
  if (!haveReticle || groupPlaced) { 
    lastHit = null;
    if(reticle) reticle.visible = false;
  } else {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length) lastHit = results[0];
  }

  for (const p of placed) {
    if (!p.anchorSpace) continue;
    const apose = frame.getPose(p.anchorSpace, refSpace);
    if (apose) {
      p.mesh.matrix.fromArray(apose.transform.matrix);
      p.mesh.matrixAutoUpdate = false;
      p.mesh.updateMatrixWorld(true);
    }
  }

  renderer.render(scene, renderer.xr.getCamera(camera));
}

// ===== Interaksi =====
function onSelectLike() { onSelect(); }

async function onSelect() {
  if (!reticle || !reticle.visible || groupPlaced) return;

  const now = performance.now();
  if (now - lastSpawnTs < 160) return;
  lastSpawnTs = now;

  const mesh = gajahGroup.clone();
  mesh.visible = true; 
  mesh.position.set(0, 0, 0); 
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);     
  
  // Pastikan visibilitas anak-anaknya benar saat di-clone
  mesh.traverse((child) => {
    if (child.name === 'tulangModel' || child.name === 'jantungModel') {
        child.visible = false;
    } else if (child.name === 'gajahModel') {
        child.visible = true;
    }
  });

  let anchored = false;
  try {
    if (lastHit && typeof lastHit.createAnchor === 'function') {
      const anchor = await lastHit.createAnchor();
      if (anchor?.anchorSpace) {
        (arRoot ?? scene).add(mesh);
        placed.push({ mesh, anchorSpace: anchor.anchorSpace });
        anchored = true;
        groupPlaced = true;      
        reticle.visible = false; 
      }
    }
  } catch (e) {
    anchored = false; 
  }

  if (!anchored) {
    mesh.applyMatrix4(reticle.matrix);
    mesh.matrixAutoUpdate = false;
    placed.push({ mesh }); 
    (arRoot ?? scene).add(mesh);
    groupPlaced = true;      
    reticle.visible = false; 
  }
}

function domSelectFallback(e) {
  if (e.target?.closest?.('.xr-btn')) return;
  if (renderer.xr.isPresenting) onSelect();
}