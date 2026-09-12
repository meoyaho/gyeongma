import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const coats = [0xb87f50, 0x65504a, 0xd3aa70, 0xcec9bc, 0x9e674c, 0x55504c, 0xc2906a, 0x8c7b69];
const silks = [0x477e6b, 0xdcb268, 0xc8796e, 0x8594b8, 0x91a77c, 0xaa839e, 0xc5ad8c, 0x74a3ac];
const sphere = new THREE.SphereGeometry(1, 24, 18);
const rounded = new RoundedBoxGeometry(1, 1, 1, 3, .15);
const mats = new Map();
function mat(color, roughness = .65, metalness = 0) {
  const key = `${color}:${roughness}:${metalness}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return mats.get(key);
}
function mesh(parent, geometry, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], roughness = .65) {
  const m = new THREE.Mesh(geometry, mat(color, roughness));
  m.position.set(...position); m.scale.set(...scale); m.rotation.set(...rotation);
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
// Smoothly join anatomical volumes once, then share the finished geometry
// between the preview and all racehorses. No remeshing occurs during a race.
function sculpt(volumes, center, extent, resolution = 52) {
  const iso = new MarchingCubes(resolution, mat(0xffffff), false, false, 24000);
  iso.isolation = 0;
  const blend = .11;
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const px = (x / resolution * 2 - 1) * extent + center[0];
    const py = (y / resolution * 2 - 1) * extent + center[1];
    const pz = (z / resolution * 2 - 1) * extent + center[2];
    let distance = 100;
    for (const [cx, cy, cz, rx, ry, rz, angle = 0] of volumes) {
      const dx = px - cx, dy = py - cy, dz = pz - cz;
      const ly = dy * Math.cos(angle) + dz * Math.sin(angle), lz = -dy * Math.sin(angle) + dz * Math.cos(angle);
      const d = (Math.hypot(dx / rx, ly / ry, lz / rz) - 1) * Math.min(rx, ry, rz);
      const h = Math.max(blend - Math.abs(distance - d), 0) / blend;
      distance = Math.min(distance, d) - h * h * blend * .25;
    }
    iso.field[x + y * resolution + z * resolution * resolution] = -distance;
  }
  iso.update();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(iso.geometry.attributes.position.array.slice(0, iso.count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(iso.geometry.attributes.normal.array.slice(0, iso.count * 3), 3));
  geometry.scale(extent, extent, extent); geometry.translate(...center);
  geometry.computeBoundingSphere(); iso.geometry.dispose(); return geometry;
}
// A tapered continuous surface through elliptical cross sections.
function loft(sections, sides = 16) {
  const points = [], indices = [];
  sections.forEach(([x, y, z, rx, rz]) => {
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      points.push(x + Math.cos(a) * rx, y, z + Math.sin(a) * rz);
    }
  });
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
    indices.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}
function cord(parent, color, points, radius = .014) {
  return mesh(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 24, radius, 6, false), color);
}
let bodyGeometry, headGeometry, frontGeometry, backGeometry, maneGeometry, tailGeometry;
function prepareGeometry() {
  if (bodyGeometry) return;
  bodyGeometry = sculpt([
    [0, 1.40, .11, .38, .40, .80], [0, 1.44, .65, .40, .40, .43],
    [0, 1.44, -.48, .32, .44, .39], [0, 1.79, -.69, .255, .53, .30, -.43],
    [0, 2.12, -.87, .19, .43, .235, -.37],
    [-.23, 1.25, -.48, .16, .28, .21], [.23, 1.25, -.48, .16, .28, .21],
    [-.25, 1.25, .65, .18, .28, .23], [.25, 1.25, .65, .18, .28, .23],
  ], [0, 1.7, 0], 1.45);
  headGeometry = sculpt([
    [0, 0, -.10, .195, .255, .31, -.16], [0, -.13, -.31, .155, .19, .31, -.3],
    [0, -.22, -.49, .16, .13, .20],
  ], [0, -.02, -.20], .7, 44);
  frontGeometry = loft([[0, .06, 0, .015, .015], [0, 0, 0, .13, .17], [0, -.25, .01, .10, .115], [0, -.51, .025, .068, .08], [0, -.61, .025, .074, .08], [0, -.81, -.015, .045, .054], [0, -1.02, -.035, .052, .065], [0, -1.10, -.07, .07, .09]]);
  backGeometry = loft([[0, .06, 0, .02, .02], [0, 0, 0, .16, .21], [0, -.23, -.10, .12, .14], [0, -.40, -.08, .08, .095], [0, -.59, .10, .069, .085], [0, -.68, .10, .059, .075], [0, -.94, .005, .045, .055], [0, -1.10, -.03, .07, .09]]);
  maneGeometry = loft([[0, 2.46, -.77, .008, .01], [0, 2.40, -.73, .075, .12], [.01, 2.28, -.63, .09, .15], [.025, 2.12, -.49, .10, .16], [.04, 1.97, -.35, .105, .16], [.045, 1.82, -.24, .075, .15], [.025, 1.72, -.14, .005, .015]], 18);
  tailGeometry = loft([[0, .05, 0, .035, .035], [0, -.02, .05, .10, .105], [0, -.25, .20, .12, .125], [.025, -.53, .28, .10, .115], [.045, -.80, .28, .075, .085], [.035, -.96, .22, .008, .012]], 18);
}
export function horse(index = 0, jockey = false) {
  prepareGeometry();
  const g = new THREE.Group(), coat = coats[index % 8], tack = silks[index % 8], hair = 0x3e322e;
  mesh(g, bodyGeometry, coat);
  mesh(g, maneGeometry, hair);
  const head = new THREE.Group(); head.position.set(0, 2.31, -1.01); head.rotation.x = -.13; g.add(head);
  mesh(head, headGeometry, coat);
  mesh(head, sphere, 0x816653, [0, -.227, -.52], [.162, .102, .18]);
  // A small ivory blaze, inset ears and warm dark eyes keep the face expressive.
  mesh(head, sphere, 0xeee3c9, [0, .045, -.323], [.045, .12, .055], [-.65, 0, 0]);
  mesh(head, sphere, 0xeee3c9, [0, -.045, -.381], [.031, .085, .045], [-.6, 0, 0]);
  for (const side of [-1, 1]) {
    mesh(head, sphere, coat, [side * .135, .30, .012], [.053, .17, .073], [-.18, 0, -side * .15]);
    mesh(head, sphere, 0x856356, [side * .135, .315, -.044], [.028, .11, .018], [-.18, 0, -side * .15]);
    mesh(head, sphere, 0x71513d, [side * .18, .017, -.195], [.027, .065, .057]);
    mesh(head, sphere, 0x251f1b, [side * .198, .025, -.206], [.021, .041, .038], [0, 0, 0], .13);
    mesh(head, sphere, 0xffffff, [side * .214, .04, -.221], [.007, .011, .010]);
    mesh(head, sphere, 0x41352e, [side * .132, -.213, -.626], [.022, .032, .015], [.2, side * .5, 0]);
    cord(head, 0x514137, [[side * .17, .16, .04], [side * .205, .02, -.03], [side * .17, -.16, -.38], [side * .155, -.19, -.51]], .014);
    mesh(head, new THREE.TorusGeometry(.035, .008, 6, 16), 0xc9b380, [side * .175, -.17, -.39], [1, 1, 1], [0, Math.PI / 2, 0]);
    cord(g, 0x514137, [[side * .17, 2.12, -1.39], [side * .29, 1.79, -.72], [side * .27, 1.74, .09]], .012);
  }
  cord(head, 0x514137, [[-.154, -.16, -.54], [0, -.12, -.586], [.154, -.16, -.54]], .018);
  const legs = [-1, 1, -1, 1].map((side, i) => {
    const leg = new THREE.Group(); leg.position.set(side * (i > 1 ? .275 : .245), 1.20, i > 1 ? .65 : -.48); g.add(leg);
    mesh(leg, i > 1 ? backGeometry : frontGeometry, coat);
    mesh(leg, sphere, 0xe7dac0, [0, -.98, i > 1 ? -.003 : -.034], [.057, .13, .068]);
    mesh(leg, rounded, 0x49443e, [0, -1.105, -.055], [.135, .145, .19], [0, 0, 0], .5);
    return leg;
  });
  const tail = new THREE.Group(); tail.position.set(0, 1.48, .96); mesh(tail, tailGeometry, hair); g.add(tail);
  // Soft fitted blanket, leather saddle and slender stirrups.
  mesh(g, sphere, tack, [0, 1.81, .12], [.385, .11, .44]);
  for (const side of [-1, 1]) {
    mesh(g, rounded, tack, [side * .375, 1.43, .12], [.038, .47, .64], [0, 0, -side * .08]);
    cord(g, 0xe4d7ba, [[side * .40, 1.65, .40], [side * .41, 1.22, .40], [side * .41, 1.20, -.16], [side * .40, 1.59, -.18]], .009);
    mesh(g, sphere, 0xeadfc7, [side * .40, 1.45, .15], [.009, .075, .075]);
    mesh(g, rounded, tack, [side * .413, 1.45, .15], [.008, .081, .02]);
    cord(g, 0x5b4636, [[side * .26, 1.77, -.05], [side * .42, 1.42, -.03], [side * .43, 1.13, -.02]], .016);
    mesh(g, new THREE.TorusGeometry(.065, .009, 6, 18), 0xb6ae9b, [side * .43, 1.10, -.02], [.8, 1.2, 1], [0, Math.PI / 2, 0]);
  }
  mesh(g, sphere, 0x5b4233, [0, 1.92, .13], [.28, .055, .32]);
  mesh(g, sphere, 0x5b4233, [0, 1.94, .38], [.285, .09, .095]);
  if (jockey) {
    mesh(g, sphere, tack, [0, 2.10, -.02], [.23, .30, .20], [-.7, 0, 0]);
    mesh(g, sphere, 0xedbc96, [0, 2.38, -.34], [.14, .16, .145]);
    mesh(g, sphere, tack, [0, 2.48, -.34], [.16, .12, .17]);
    mesh(g, sphere, 0x252d28, [0, 2.38, -.48], [.135, .04, .024]);
    for (const side of [-1, 1]) {
      mesh(g, sphere, 0xeee9d9, [side * .28, 1.75, .23], [.10, .28, .12], [-.8, 0, side * .3]);
      mesh(g, sphere, 0x292c27, [side * .36, 1.39, .03], [.065, .25, .08], [.2, 0, 0]);
      cord(g, tack, [[side * .17, 2.20, -.21], [side * .26, 2.01, -.40], [side * .19, 1.95, -.57]], .065);
    }
  }
  g.userData = { legs, tail, head, phase: index * 1.3 }; return g;
}
export function animateHorse(h, time, speed) {
  const { legs, tail, head, phase } = h.userData;
  const t = time * (speed > 0 ? 9 + speed * .45 : 1.7) + phase;
  h.position.y = speed > 0 ? Math.abs(Math.sin(t)) * .085 : Math.sin(t) * .006;
  legs.forEach((leg, i) => { leg.rotation.x = speed > 0 ? Math.sin(t + (i === 0 || i === 3 ? 0 : Math.PI) + (i > 1 ? .6 : 0)) * .60 : 0; });
  tail.rotation.z = Math.sin(t * .5) * .13;
  head.rotation.x = -.13 + Math.sin(t) * (speed > 0 ? .045 : .017);
}
