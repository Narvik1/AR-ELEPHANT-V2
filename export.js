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

let gajahGroup = null; // Ini adalah prefab/template kita
let groupPlaced = false;
const loader = new GLTFLoader();

let scaleSlider, rotateSlider;

// --- BARU: Menyimpan posisi default model ---
const modelOffsets = {
  gajahModel: new THREE.Vector3(0, 0, 0),
  tulangModel: new THREE.Vector3(1.5, 0, 0),
  jantungModel: new THREE.Vector3(-1.5, 0, 0)
};
// ---

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
  gajahGroup.name = "GajahWorld_Prefab"; // Beri nama prefab
  gajahGroup.position.set(0, 1.5, -3); 
  scene.add(gajahGroup);

  // Gajah (Tengah)
  loader.load('./assets/gajah/gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.copy(modelOffsets.gajahModel); 
      model.name = 'gajahModel';
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load gajah.glb', e));

  // Tulang (Kanan)
  loader.load('./assets/tulang/tulang_gajah.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.copy(modelOffsets.tulangModel); 
      model.name = 'tulangModel';
      model.visible = false; 
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load tulang_gajah.glb', e));

  // Jantung (Kiri)
  loader.load('./assets/jantung/jantung.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.copy(modelOffsets.jantungModel); 
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

  scaleSlider = document.getElementById('scale-slider');
  rotateSlider = document.getElementById('rotate-slider');
  
  scaleSlider.addEventListener('input', handleScale);
  rotateSlider.addEventListener('input', handleRotation);

  renderer.xr.addEventListener('sessionstart', onSessionStart);
  renderer.xr.addEventListener('sessionend', onSessionEnd);
}

// --- PERBAIKAN LOGIKA SLIDER & POSISI ---

/**
 * Mendapatkan grup objek yang sedang aktif (baik di AR atau di fallback)
 * Ini adalah perbaikan utama untuk slider agar berfungsi di PC.
 */
function getActiveGroup() {
  // --- PERBAIKAN ---
  // Selalu periksa grup fallback (PC) dulu JIKA kita tidak sedang dalam sesi AR
  if (!xrSession && gajahGroup && gajahGroup.visible) {
    return gajahGroup; // Target: Objek Fallback 3D di PC
  }

  // Jika sedang dalam sesi AR, cari objek yang ditempatkan
  const placedGroup = placed.length > 0 ? placed[0].mesh : null;
  if (xrSession && placedGroup && placedGroup.visible) {
    return placedGroup; // Target: Objek AR
  }
  
  // Fallback terakhir jika gajahGroup masih terlihat (walaupun seharusnya tidak saat AR)
  if (gajahGroup && gajahGroup.visible) {
      return gajahGroup;
  }

  return null; // Tidak ada yang bisa diubah
}

/**
 * Fungsi baru untuk mereset posisi/visibilitas GajahGroup (prefab)
 */
function resetFallbackGroup() {
  if (!gajahGroup) return;
  gajahGroup.traverse((child) => {
    if (child.name === 'gajahModel') {
      child.visible = true;
      child.position.copy(modelOffsets.gajahModel);
    } else if (child.name === 'tulangModel') {
      child.visible = false;
      child.position.copy(modelOffsets.tulangModel);
    } else if (child.name === 'jantungModel') {
      child.visible = false;
      child.position.copy(modelOffsets.jantungModel);
    }
  });
  // Reset juga skala dan rotasi grup fallback
  gajahGroup.scale.set(1, 1, 1);
  gajahGroup.rotation.set(0, 0, 0);
}

/**
 * Fungsi ini sekarang menangani logika slider untuk grup APAPUN yang aktif.
 */
function handleScale(event) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return;

  const scale = parseFloat(event.target.value);
  targetGroup.scale.set(scale, scale, scale);
}

/**
 * Fungsi ini sekarang menangani logika slider untuk grup APAPUN yang aktif.
 */
function handleRotation(event) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return;

  const rotationY = parseFloat(event.target.value);
  targetGroup.rotation.y = THREE.MathUtils.degToRad(rotationY);
}

/**
 * PERBAIKAN: Fungsi ini sekarang memindahkan model anak ke tengah (0,0,0) saat aktif
 * dan mengembalikan mereka ke offset saat tidak aktif.
 */
function showModel(nameToShow) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return; 

  targetGroup.traverse((child) => {
    // --- PERBAIKAN BUG COPY-PASTE ADA DI SINI ---
    if (child.name === 'gajahModel') {
      child.visible = (nameToShow === 'gajahModel'); // <-- HARUSNYA nameToShow
      child.position.copy(modelOffsets.gajahModel);
    } else if (child.name === 'tulangModel') {
      child.visible = (nameToShow === 'tulangModel'); // <-- HARUSNYA nameToShow
      child.position.copy(nameToShow === 'tulangModel' ? modelOffsets.gajahModel : modelOffsets.tulangModel); 
    } else if (child.name === 'jantungModel') {
      child.visible = (nameToShow === 'jantungModel'); // <-- HARUSNYA nameToShow
      child.position.copy(nameToShow === 'jantungModel' ? modelOffsets.gajahModel : modelOffsets.jantungModel);
    }
    // --- AKHIR PERBAIKAN ---
  });
}
// --- AKHIR FUNGSI PERBAIKAN ---


function animateFallback() {
  if (xrSession) return;
  requestAnimationFrame(animateFallback);
  
  // Hapus rotasi otomatis agar slider berfungsi
  // if (gajahGroup) gajahGroup.rotation.y += 0.01; // <-- DINONAKTIFKAN
  
  renderer.render(scene, camera);
}

// ===== AR lifecycle =====
async function onSessionStart() {
  xrSession = renderer.xr.getSession(); // <-- Penting: set xrSession DI AWAL

  lastSpawnTs = 0;
  lastXRFrame = null;
  lastHit = null;
  placed.length = 0;
  groupPlaced = false; 

  if (gajahGroup) {
    gajahGroup.visible = false;
    // Bawa state (skala/rotasi) dari fallback ke AR
    gajahGroup.rotation.y = THREE.MathUtils.degToRad(parseFloat(rotateSlider.value));
    const scale = parseFloat(scaleSlider.value);
    gajahGroup.scale.set(scale, scale, scale);
  }

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
  xrSession = null; // <-- Penting: set xrSession di awal

  document.getElementById('overlayRoot').classList.remove('ar-active');

  placed.length = 0; 
  groupPlaced = false;

  // Reset slider ke default
  if(scaleSlider) scaleSlider.value = 1.0;
  if(rotateSlider) rotateSlider.value = 0;

  if (gajahGroup) {
    gajahGroup.visible = true;
    resetFallbackGroup(); // Panggil fungsi reset baru
  }
  
  renderer.domElement.removeEventListener('pointerup', domSelectFallback);
  renderer.domElement.removeEventListener('click', domSelectFallback);
  renderer.domElement.removeEventListener('touchend', domSelectFallback);

  if (controller) { // Cek controller, bukan xrSession
    controller.removeEventListener('selectstart', onSelectLike);
    controller.removeEventListener('select', onSelectLike);
    scene.remove(controller);
    controller = null;
  }
  // Tidak perlu cek xrSession di sini, sudah di-null-kan

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
  
  requestAnimationFrame(animateFallback); 
}

// ===== XR render loop =====
function renderXR(time, frame) {
  const isXR = renderer.xr.isPresenting;

  if (!isXR || !frame) {
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
  if (!reticle || !reticle.visible) return; 

  const now = performance.now();
  if (now - lastSpawnTs < 160) return;
  lastSpawnTs = now;

  if (placed.length > 0) {
      const oldMesh = placed.pop().mesh;
      if (oldMesh && oldMesh.parent) {
          oldMesh.parent.remove(oldMesh);
      }
  }
  groupPlaced = false; 
  
  if(scaleSlider) scaleSlider.value = 1.0;
  if(rotateSlider) rotateSlider.value = 0;

  resetFallbackGroup(); 
  const mesh = gajahGroup.clone();
  mesh.visible = true;
  
  mesh.position.set(0, 0, 0); 
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1); 
  
  let anchored = false;
  try {
    if (lastHit && typeof lastHit.createAnchor === 'function') {
      const anchor = await lastHit.createAnchor();
      if (anchor?.anchorSpace) {
        (arRoot ?? scene).add(mesh);
        placed.push({ mesh, anchorSpace: anchor.anchorSpace }); 
        anchored = true;
        groupPlaced = true;      
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
  }
}

function domSelectFallback(e) {
  if (e.target?.closest?.('.xr-btn')) return;
  if (renderer.xr.isPresenting) onSelect();
}