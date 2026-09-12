import * as THREE from 'three';
import { horse, animateHorse } from './horse-model.js';

const COLORS = [0x41654b, 0xf0b755, 0xe47f68, 0x8e9dc2, 0x90af75, 0xb17b9d, 0xe6c9a1, 0x69a9aa];
const sphere = new THREE.SphereGeometry(1, 16, 12);
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const materials = new Map();
function material(color) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .85 }));
  return materials.get(color);
}
function part(parent, geometry, color, position, scale, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export class RaceScene {
  constructor(container) {
    this.container = container; this.mode = 'race'; this.racers = [];
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0xe5e8d7, 25, 110);
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 550);
    try { this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { container.innerHTML = '<div class="scene-fallback">🐎<p>3D 화면을 사용하려면<br>브라우저의 그래픽 가속을 켜주세요.</p></div>'; return; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '배경 위에 서 있는 갈색 말의 3D 모습');
    this.scene.add(new THREE.HemisphereLight(0xfff9e5, 0x61714d, 3));
    const rim = new THREE.DirectionalLight(0xe8fff6, 2.5);
    rim.position.set(3, 5, -5); this.scene.add(rim);
    const sun = this.sun = new THREE.DirectionalLight(0xfff5dc, 3.4);
    sun.position.set(-6, 12, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
    sun.shadow.bias = -.001; this.scene.add(sun); this.scene.add(sun.target);
    this.track = new THREE.Group(); this.track.visible = true; this.scene.add(this.track);
    this.buildTrack();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.resize(); this.clock = new THREE.Clock(); this.frame = requestAnimationFrame(() => this.draw());
  }
  buildTrack() {
    const ground = part(this.track, box, 0x88a365, [0, -.13, -155], [600, .2, 1000]); ground.castShadow = false;
    const dirt = part(this.track, box, 0xc6ae86, [0, -.015, -170], [25, .1, 440]); dirt.castShadow = false;
    for (let lane = 0; lane < 8; lane++) part(this.track, box, 0xd5bd96, [-10.5 + lane * 3, .042, -170], [.055, .006, 440]).castShadow = false;
    for (let z = 20; z > -370; z -= 4) {
      for (const x of [-13, 13]) {
        part(this.track, box, 0xf2f0dd, [x, .7, z], [.13, 1.4, .13]);
        for (const y of [.62, 1.2]) part(this.track, box, 0xfffbea, [x, y, z - 2], [.12, .12, 4.05]);
      }
      // Repeated short hoof marks give a strong speed cue in first-person view.
      for (let lane = 0; lane < 8; lane++) {
        const x = -10.5 + lane * 3 + Math.sin(z * 12 + lane) * .7;
        part(this.track, box, 0xb59d76, [x, .041, z], [.15, .007, .48]).castShadow = false;
      }
    }
    for (let i = 0; i < 35; i++) {
      const z = -i * 12 + 15;
      for (const side of [-1, 1]) {
        const x = side * (22 + (i % 4) * 4);
        part(this.track, cylinder, 0x7e7253, [x, 1.5, z], [.22, 3, .22]);
        part(this.track, sphere, i % 2 ? 0x668650 : 0x749356, [x, 4, z], [2.1, 2.7, 2.1]);
      }
    }
    // Grandstand beyond the right rail.
    for (let i = 0; i < 5; i++) {
      part(this.track, box, i % 2 ? 0xadb7a4 : 0xd7d8bf, [31 + i * 2.5, .5 + i * .6, -120], [3, 1 + i * 1.2, 110]);
      for (let j = 0; j < 45; j++) part(this.track, sphere, COLORS[(i + j) % 8], [31 + i * 2.5, 1.25 + i * 1.2, -68 - j * 2.4], [.24, .35, .24]);
    }
    part(this.track, box, 0xeff0dc, [38, 8.5, -120], [21, .3, 116], [0, 0, .08]);
    const finish = new THREE.Group(); finish.position.z = -300; this.track.add(finish);
    for (const x of [-12.5, 12.5]) part(finish, box, 0xf1edcf, [x, 3.4, 0], [.4, 6.8, .4]);
    part(finish, box, 0x244b37, [0, 6.3, 0], [25.5, 1.2, .3]);
    const label = document.createElement('canvas'); label.width = 1024; label.height = 96;
    const ctx = label.getContext('2d'); ctx.fillStyle = '#244b37'; ctx.fillRect(0, 0, 1024, 96); ctx.fillStyle = '#f8f2d9'; ctx.font = 'bold 60px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('F I N I S H', 512, 69);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.05), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(label) })); sign.position.set(0, 6.3, .17); finish.add(sign);
    for (let x = -12; x < 13; x++) for (let z = 0; z < 3; z++) part(finish, box, (x + z) % 2 ? 0xf1eddd : 0x3d493b, [x, .052, z * .8], [1, .009, .8]).castShadow = false;
  }
  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
  setMode(mode, players = [], myId) {
    if (!this.renderer) return;
    this.mode = mode; this.track.visible = mode !== 'home';
    if (mode !== 'home') {
      this.racers.forEach(h => this.track.remove(h));
      this.racers = players.map(p => { const h = horse(p.lane, p.id !== myId); h.userData.id = p.id; h.position.x = -10.5 + p.lane * 3; this.track.add(h); return h; });
      this.myId = myId;
      this.scene.background = new THREE.Color(0xbadbe0); this.scene.fog.color.set(0xbadbe0); this.scene.fog.near = 80; this.scene.fog.far = 220;
      this.camera.fov = 72;
      this.renderer.domElement.setAttribute('aria-label', '말 위에서 바라보는 1인칭 경주 트랙');
    } else {
      this.scene.background = null; this.scene.fog.color.set(0xe5e8d7); this.scene.fog.near = 25; this.scene.fog.far = 110; this.camera.fov = 35;

    }
    this.camera.updateProjectionMatrix(); this.resize();
  }
  update(state) { this.state = state; this.updated = performance.now(); }
  draw() {
    if (!this.renderer) return;
    const time = this.clock.getElapsedTime();
    if (this.mode !== 'home' && this.state) {
      const elapsed = Math.min(.15, (performance.now() - this.updated) / 1000);
      for (const h of this.racers) {
        const p = this.state.players.find(p => p.id === h.userData.id); if (!p) continue;
        const running = this.state.phase === 'racing' && !p.finishTime && p.connected;
        const target = -(p.distance + (running ? p.speed * elapsed : 0));
        h.position.z += (target - h.position.z) * .3;
        animateHorse(h, time, running ? p.speed : 0);
        if (p.id === this.myId) {
          const bob = running ? Math.sin(time * (9 + p.speed * .45)) * .035 : 0;
          this.camera.position.set(h.position.x, 2.65 + bob, h.position.z + .42);
          this.camera.lookAt(h.position.x, 2.05, h.position.z - 18);
          this.camera.rotation.z = running ? Math.sin(time * 5) * .003 : 0;
          this.sun.position.set(h.position.x - 10, 15, h.position.z + 12); this.sun.target.position.set(h.position.x, 0, h.position.z - 5);
        }
      }
    }
    if (this.mode !== 'home') this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(() => this.draw());
  }
}
