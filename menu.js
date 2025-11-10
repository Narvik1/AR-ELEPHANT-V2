import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/gltfloader.js';

let scene, camera, renderer, model;
const container = document.getElementById('gajah-viewer');

// 1. Inisialisasi Scene
scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222); // Samakan dengan warna div2

// 2. Inisialisasi Kamera
camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(0, 1.5, 4); // Posisikan kamera agar gajah terlihat

// 3. Inisialisasi Renderer
renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // Beri efek warna yang bagus
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // Ganti jika gajah terlihat pudar
container.appendChild(renderer.domElement);

// 4. Tambahkan Pencahayaan
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
scene.add(hemiLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// 5. Muat Model Gajah
const loader = new GLTFLoader();
loader.load(
    './assets/gajah/gajah.glb', // Path ke gajah Anda
    (gltf) => {
        model = gltf.scene;
        model.scale.set(1.5, 1.5, 1.5); // Sesuaikan ukuran agar pas
        model.position.set(0, -0.5, 0); // Sesuaikan posisi
        scene.add(model);
    },
    undefined,
    (e) => console.error(e)
);

// 6. Animate Loop (Hanya berputar)
function animate() {
    requestAnimationFrame(animate);

    if (model) {
        model.rotation.y += 0.005; // Putar model
    }
    
    renderer.render(scene, camera);
}
animate();

// 7. Handle Resize
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});