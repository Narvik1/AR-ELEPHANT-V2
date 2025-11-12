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

let scaleSlider, rotateSlider;

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
      model.position.set(1.5, 0, 0);
      model.name = 'tulangModel';
      model.visible = false; 
      gajahGroup.add(model);
  }, undefined, (e) => console.error('Gagal load tulang_gajah.glb', e));

  // Jantung (Kiri)
  loader.load('./assets/jantung/jantung.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.set(0.5, 0.5, 0.5);
      model.position.set(-1.5, 0, 0);
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

// --- MODIFIKASI SLIDER LOGIC ---
/** Mendapatkan grup objek yang sedang aktif (baik di AR atau di fallback) */
function getActiveGroup() {
  const placedGroup = placed.length > 0 ? placed[0].mesh : null;
  
  if (placedGroup && placedGroup.visible) {
    return placedGroup; // Target: Objek AR
  } else if (gajahGroup && gajahGroup.visible) {
    return gajahGroup; // Target: Objek Fallback 3D
  }
  return null; // Tidak ada yang bisa diubah
}

function handleScale(event) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return;

  const scale = parseFloat(event.target.value);
  targetGroup.scale.set(scale, scale, scale);
}

function handleRotation(event) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return;

  const rotationY = parseFloat(event.target.value);
  // Ubah derajat ke radian untuk rotasi Three.js
  targetGroup.rotation.y = THREE.MathUtils.degToRad(rotationY);
}
// --- AKHIR MODIFIKASI SLIDER LOGIC ---

function showModel(nameToShow) {
  const targetGroup = getActiveGroup();
  if (!targetGroup) return; 

  targetGroup.traverse((child) => {
    if (child.name === 'gajahModel' || child.name === 'tulangModel' || child.name === 'jantungModel') {
      child.visible = (child.name === nameToShow);
    }
  });
}

function animateFallback() {
  if (xrSession) return;
  requestAnimationFrame(animateFallback);
  
  // --- MODIFIKASI: Hapus rotasi otomatis ---
  // if (gajahGroup) gajahGroup.rotation.y += 0.01; // <-- DINONAKTIFKAN
  // --- AKHIR MODIFIKASI ---
  
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

  if (gajahGroup) {
    gajahGroup.visible = false;
    // Pindahkan rotasi & skala dari slider ke gajahGroup saat masuk AR
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

  document.getElementById('overlayRoot').classList.remove('ar-active');

  placed.length = 0; 
  groupPlaced = false;

  if (gajahGroup) {
    gajahGroup.visible = true;
    showModel('gajahModel');
    
    // Terapkan rotasi/skala dari slider ke fallback group
    gajahGroup.rotation.y = THREE.MathUtils.degToRad(parseFloat(rotateSlider.value));
    const scale = parseFloat(scaleSlider.value);
    gajahGroup.scale.set(scale, scale, scale);
  }
  
  // Reset slider saat keluar
  if(scaleSlider) scaleSlider.value = 1.0;
  if(rotateSlider) rotateSlider.value = 0;
  
  // Terapkan reset ke gajahGroup (karena slider sekarang 0)
  if (gajahGroup) {
      gajahGroup.rotation.y = 0;
      gajahGroup.scale.set(1, 1, 1);
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
    // Panggil animateFallback HANYA jika tidak ada sesi XR
    animateFallback(); 
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
  if (!reticle || !reticle.visible) return; // --- MODIFIKASI: Izinkan penempatan ulang ---

  const now = performance.now();
  if (now - lastSpawnTs < 160) return;
  lastSpawnTs = now;

  // Hapus objek lama jika ada
  if (placed.length > 0) {
      const oldMesh = placed.pop().mesh;
      if (oldMesh && oldMesh.parent) {
          oldMesh.parent.remove(oldMesh);
      }
      // Sebaiknya dispose geometri/material jika tidak digunakan lagi
  }
  groupPlaced = false; 
  
  // Reset slider ke default
  if(scaleSlider) scaleSlider.value = 1.0;
  if(rotateSlider) rotateSlider.value = 0;

  const mesh = gajahGroup.clone();
  mesh.visible = true; 
  mesh.position.set(0, 0, 0); 
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1); 
  
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
        // reticle.visible = false; // --- MODIFIKASI: Biarkan reticle terlihat untuk penempatan ulang
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
    // reticle.visible = false; // --- MODIFIKASI: Biarkan reticle terlihat untuk penempatan ulang
  }
}

function domSelectFallback(e) {
  if (e.target?.closest?.('.xr-btn')) return;
  if (renderer.xr.isPresenting) onSelect();
}