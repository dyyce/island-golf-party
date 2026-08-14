// Three.js scene construction. Course data lives in course-data.js (shared
// with the server).

import * as THREE from 'three';
import { course, GROUND_Y } from './course-data.js';

export { course, GROUND_Y };

// ---------- helpers ----------
function stripedTexture(c1 = '#ffffff', c2 = '#e64545') {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = c1; g.fillRect(0, 0, 64, 64);
  g.fillStyle = c2;
  for (let i = -64; i < 64; i += 32) {
    g.beginPath();
    g.moveTo(i, 64); g.lineTo(i + 16, 64); g.lineTo(i + 80, 0); g.lineTo(i + 64, 0);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function mat(color, opts = {}) {
  return new THREE.MeshPhongMaterial({ color, shininess: 30, ...opts });
}

// ---------- scene building ----------
export function buildCourse(scene) {
  const dynamic = {}; // things main.js animates

  // lights
  scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x3f7a3f, 0.9));
  const sun = new THREE.DirectionalLight(0xfff5dd, 1.6);
  sun.position.set(-30, 45, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.far = 120;
  scene.add(sun);

  scene.background = new THREE.Color(0x8fd4f5);
  scene.fog = new THREE.Fog(0x8fd4f5, 80, 160);

  // ocean
  const waterGeo = new THREE.PlaneGeometry(220, 220, 40, 40);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, mat(0x2a8fbd, { shininess: 120, specular: 0x88ccff }));
  water.position.y = -0.45;
  scene.add(water);
  dynamic.water = water;
  dynamic.waterBase = waterGeo.attributes.position.array.slice();

  // island: sand base + grass top (ellipses)
  const { cx, cz, rx, rz } = course.island;
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.12, 1.1, 48), mat(0xf2d38a));
  sand.scale.set(rx + 2.5, 1, rz + 2.5);
  sand.position.set(cx, -0.45, cz); // top at y=0.10, below the grass top (0.20)
  sand.receiveShadow = true;
  scene.add(sand);

  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.4, 48), mat(0x4cc24f));
  grass.scale.set(rx, 1, rz);
  grass.position.set(cx, 0, cz);
  grass.receiveShadow = true;
  scene.add(grass);

  // canal (visual water strip across the island)
  for (const w of course.waterZones) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.1, w.d), mat(0x2a8fbd, { shininess: 120 }));
    strip.position.set(w.x, GROUND_Y - 0.06, w.z);
    scene.add(strip);
    // sandy banks
    for (const side of [-1, 1]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.06, 0.5), mat(0xf2d38a));
      bank.position.set(w.x, GROUND_Y - 0.02, w.z + side * (w.d / 2 + 0.22));
      scene.add(bank);
    }
  }

  // bridge planks
  const b = course.bridge;
  const plankMat = mat(0xb5763c);
  const nPlanks = 8;
  for (let i = 0; i < nPlanks; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.15, 0.09, b.d / nPlanks - 0.06), plankMat);
    p.position.set(b.x, GROUND_Y - 0.045, b.z - b.d / 2 + (i + 0.5) * (b.d / nPlanks));
    p.receiveShadow = true;
    scene.add(p);
  }

  // green (lighter circle)
  const green = new THREE.Mesh(new THREE.CircleGeometry(course.green.r, 40), mat(0x63d95e));
  green.rotation.x = -Math.PI / 2;
  green.position.set(course.green.x, GROUND_Y + 0.005, course.green.z);
  green.receiveShadow = true;
  scene.add(green);

  // sand traps
  for (const s of course.sandZones) {
    const trap = new THREE.Mesh(new THREE.CircleGeometry(s.r, 28), mat(0xf2d38a));
    trap.rotation.x = -Math.PI / 2;
    trap.position.set(s.x, GROUND_Y + 0.006, s.z);
    trap.receiveShadow = true;
    scene.add(trap);
  }

  // tee box marker
  const tee = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), mat(0x9be08a));
  tee.rotation.x = -Math.PI / 2;
  tee.position.set(course.tee.x, GROUND_Y + 0.005, course.tee.z);
  scene.add(tee);

  // walls (striped boxes along segments)
  const wallTex = stripedTexture();
  const wallMat = new THREE.MeshPhongMaterial({ map: wallTex, shininess: 20 });
  for (const w of course.walls) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const g = new THREE.BoxGeometry(len + 0.3, 0.5, 0.56);
    const m = new THREE.Mesh(g, wallMat.clone());
    m.material.map = wallTex.clone();
    m.material.map.repeat.set(len / 1.2, 1);
    m.material.map.needsUpdate = true;
    m.position.set((w.ax + w.bx) / 2, GROUND_Y + 0.25, (w.az + w.bz) / 2);
    m.rotation.y = -Math.atan2(w.bz - w.az, w.bx - w.ax);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }

  // bumpers (pink donuts)
  for (const bp of course.bumpers) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(bp.r, bp.r + 0.08, 0.42, 24), mat(0xff6fa5));
    base.position.set(bp.x, GROUND_Y + 0.21, bp.z);
    base.castShadow = true;
    scene.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(bp.r, 0.09, 10, 24), mat(0xffffff));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(bp.x, GROUND_Y + 0.4, bp.z);
    scene.add(ring);
  }

  // spinner: center pole + rotating bar
  const s = course.spinner;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 12), mat(0x888888));
  pole.position.set(s.x, GROUND_Y + 0.45, s.z);
  pole.castShadow = true;
  scene.add(pole);
  const barGroup = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(s.len * 2, 0.22, s.thick * 2),
    new THREE.MeshPhongMaterial({ map: stripedTexture('#ffcf3f', '#e64545'), shininess: 20 })
  );
  bar.position.y = GROUND_Y + 0.28;
  bar.castShadow = true;
  barGroup.add(bar);
  barGroup.position.set(s.x, 0, s.z);
  scene.add(barGroup);
  dynamic.spinnerBar = barGroup;

  // cup + flag
  const cup = new THREE.Mesh(new THREE.CircleGeometry(course.cup.r, 20), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  cup.rotation.x = -Math.PI / 2;
  cup.position.set(course.cup.x, GROUND_Y + 0.007, course.cup.z);
  scene.add(cup);
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), mat(0xdddddd));
  flagPole.position.set(course.cup.x, GROUND_Y + 1.1, course.cup.z);
  scene.add(flagPole);
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.9, -0.22, 0, 0, -0.45, 0], 3));
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xe64545, side: THREE.DoubleSide }));
  flag.position.set(course.cup.x, GROUND_Y + 2.15, course.cup.z);
  scene.add(flag);
  dynamic.flag = flag;

  // palm trees scattered on the island
  const palmSpots = [
    { x: -24, z: 8 }, { x: -26, z: -3 }, { x: 4, z: 3 }, { x: 2, z: 17 },
    { x: -14, z: 20 }, { x: -18, z: 14 }, { x: 6, z: 14.5 }, { x: -28, z: 14 },
  ];
  for (const p of palmSpots) scene.add(makePalm(p.x, p.z));

  // clouds
  for (let i = 0; i < 5; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1.6 - j * 0.3, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      puff.position.set(j * 1.8 - 1.8, j % 2 * 0.5, 0);
      cloud.add(puff);
    }
    cloud.position.set(-40 + i * 20, 16 + (i % 3) * 3, -20 + (i % 2) * 30);
    scene.add(cloud);
    (dynamic.clouds ??= []).push(cloud);
  }

  return dynamic;
}

function makePalm(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 8), mat(0x9a6b3f));
  trunk.position.y = 1.2;
  trunk.rotation.z = 0.12;
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.0, 6), mat(0x2e9e44));
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.8 + 0.28, 2.55, Math.sin(a) * 0.8);
    leaf.rotation.z = Math.cos(a) * 1.25;
    leaf.rotation.x = -Math.sin(a) * 1.25;
    leaf.castShadow = true;
    g.add(leaf);
  }
  const coconuts = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(0x6b4a2a));
  coconuts.position.set(0.28, 2.3, 0);
  g.add(coconuts);
  g.position.set(x, GROUND_Y, z);
  return g;
}
