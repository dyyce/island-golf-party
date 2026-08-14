// Island Golf Party — hotseat couch-multiplayer minigolf (PoC).
// One island hole: bumpers → dogleg sand trap → rail-less bridge over the
// canal → spinner gate → green. Drag back from the ball to aim, release to shoot.

import * as THREE from 'three';
import { course, buildCourse, GROUND_Y } from './course.js';
import { BALL_R, MAX_SPEED, step, allRested, clampSpeed } from './physics.js';
import { makeAvatar, animateAvatar, HATS } from './avatar.js';
import { sfx } from './audio.js';

const PLAYER_COLORS = [0xe64545, 0x3f7fff, 0x2e9e44, 0xb44fe6];
const COLOR_HEX = ['#e64545', '#3f7fff', '#2e9e44', '#b44fe6', '#ff8f3f', '#e6cf4f'];
const MAX_STROKES = 12;
const MAX_PLAYERS = 4;

// ---------- three.js setup ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
camera.position.set(-19, 14, -12);

const dynamic = buildCourse(scene);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- game state ----------
let state = 'menu'; // menu | playing | over
let players = [];   // {name, color, hat, strokes, holed, ball:{pos,vel,restPos,holed,inWater}, mesh, avatar}
let current = 0;
let aiming = false;
let aimStart = null; // pointer ground pos when drag started
let aimDir = new THREE.Vector3();
let aimPower = 0;
let respawnQueue = []; // {player, t}
let confetti = [];

// aim visuals
const aimGroup = new THREE.Group();
const aimArrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.5, 10),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
);
aimArrow.rotation.x = -Math.PI / 2; // point along local -z
aimGroup.add(aimArrow);
const aimDots = [];
for (let i = 0; i < 10; i++) {
  const d = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  aimGroup.add(d);
  aimDots.push(d);
}
aimGroup.visible = false;
scene.add(aimGroup);

// current-player marker (bouncing triangle over the ball)
const marker = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.4, 4),
  new THREE.MeshBasicMaterial({ color: 0xffcf3f })
);
marker.rotation.x = Math.PI;
scene.add(marker);

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const setupScreen = $('setup-screen'), hud = $('hud'), endScreen = $('end-screen');
const playerListEl = $('player-list'), chipsEl = $('score-chips'), bannerEl = $('turn-banner');
const powerWrap = $('power-wrap'), powerBar = $('power-bar');

// ---------- setup screen ----------
let roster = [
  { name: 'Player 1', color: PLAYER_COLORS[0], hat: 'cap' },
  { name: 'Player 2', color: PLAYER_COLORS[1], hat: 'cone' },
];
let editingIdx = null;

function renderRoster() {
  playerListEl.innerHTML = '';
  roster.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>
      <span class="pname">${p.name}</span>
      <span class="pdesc">${HATS.find(h => h.id === p.hat)?.label ?? ''}</span>
      <button data-edit="${i}" title="Customize">✏️</button>
      ${roster.length > 1 ? `<button data-del="${i}" title="Remove">✖</button>` : ''}`;
    playerListEl.appendChild(row);
  });
  $('add-player-btn').disabled = roster.length >= MAX_PLAYERS;
}

playerListEl.addEventListener('click', e => {
  const edit = e.target.dataset.edit, del = e.target.dataset.del;
  if (edit !== undefined) openEditor(+edit);
  if (del !== undefined) { roster.splice(+del, 1); renderRoster(); }
});

$('add-player-btn').addEventListener('click', () => {
  if (roster.length >= MAX_PLAYERS) return;
  const i = roster.length;
  roster.push({ name: `Player ${i + 1}`, color: PLAYER_COLORS[i % PLAYER_COLORS.length], hat: HATS[i % HATS.length].id });
  renderRoster();
});

// avatar editor popover
const editorEl = $('avatar-editor');
function openEditor(i) {
  editingIdx = i;
  const p = roster[i];
  editorEl.classList.remove('hidden');
  $('ae-name').value = p.name;
  const colorsEl = $('ae-colors');
  colorsEl.innerHTML = '';
  for (const c of COLOR_HEX) {
    const b = document.createElement('div');
    b.className = 'swatch' + (p.color === parseInt(c.slice(1), 16) ? ' selected' : '');
    b.style.background = c;
    b.addEventListener('click', () => { p.color = parseInt(c.slice(1), 16); openEditor(i); });
    colorsEl.appendChild(b);
  }
  const hatsEl = $('ae-hats');
  hatsEl.innerHTML = '';
  for (const h of HATS) {
    const b = document.createElement('div');
    b.className = 'swatch' + (p.hat === h.id ? ' selected' : '');
    b.textContent = h.label;
    b.addEventListener('click', () => { p.hat = h.id; openEditor(i); });
    hatsEl.appendChild(b);
  }
}
$('ae-done').addEventListener('click', () => {
  if (editingIdx !== null) {
    const v = $('ae-name').value.trim();
    if (v) roster[editingIdx].name = v;
  }
  editingIdx = null;
  editorEl.classList.add('hidden');
  renderRoster();
});

// ---------- round lifecycle ----------
function startRound() {
  // clear previous round objects
  for (const p of players) { scene.remove(p.mesh); scene.remove(p.avatar); }
  players = roster.map((r, i) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 20, 14),
      new THREE.MeshPhongMaterial({ color: r.color, shininess: 90, specular: 0x666666 })
    );
    mesh.castShadow = true;
    scene.add(mesh);
    const avatar = makeAvatar(r.color, r.hat);
    scene.add(avatar);
    return {
      ...r,
      strokes: 0, holed: false,
      ball: {
        pos: { x: course.tee.x - 0.0, z: course.tee.z + (i - (roster.length - 1) / 2) * 0.55 },
        vel: { x: 0, z: 0 },
        restPos: null, holed: false, inWater: false,
        sinkT: 0,
      },
      mesh, avatar,
    };
  });
  for (const p of players) p.ball.restPos = { ...p.ball.pos };
  current = 0;
  aiming = false;
  aimPower = 0;
  aimGroup.visible = false;
  powerWrap.classList.add('hidden');
  respawnQueue = [];
  pendingTurnAdvance = false;
  wasMoving = false;
  state = 'playing';
  setupScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  updateHUD();
  sfx.whistle();
}

function endRound() {
  state = 'over';
  hud.classList.add('hidden');
  endScreen.classList.remove('hidden');
  const sorted = [...players].sort((a, b) => a.strokes - b.strokes);
  const best = sorted[0].strokes;
  const winners = sorted.filter(p => p.strokes === best);
  $('winner-title').textContent = winners.length > 1 ? "🤝 It's a tie!" : `🎉 ${winners[0].name} wins!`;
  $('scorecard').innerHTML =
    '<tr><th>Player</th><th>Strokes</th></tr>' +
    sorted.map(p => `<tr><td>${p.name}</td><td>${p.strokes}${p.holed ? '' : ' (max)'}</td></tr>`).join('');
}

function updateHUD() {
  chipsEl.innerHTML = '';
  players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (i === current && state === 'playing' ? ' current' : '') + (p.holed ? ' holed' : '');
    chip.innerHTML = `<span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>${p.name} · ${p.strokes}`;
    chipsEl.appendChild(chip);
  });
  if (state === 'playing' && players[current]) {
    bannerEl.textContent = `${players[current].name}'s turn`;
  }
}

function nextTurn() {
  if (players.every(p => p.holed)) { endRound(); return; }
  do { current = (current + 1) % players.length; } while (players[current].holed);
  updateHUD();
  sfx.turn();
}

function holeOut(p) {
  p.holed = true;
  p.ball.sinkT = 0.0001;
  sfx.hole();
  spawnConfetti(course.cup.x, GROUND_Y + 0.3, course.cup.z, p.color);
}

function splash(p) {
  p.strokes += 1; // penalty
  sfx.splash();
  spawnConfetti(p.ball.pos.x, GROUND_Y + 0.2, p.ball.pos.z, 0x2a8fbd, 40);
  p.mesh.visible = false;
  respawnQueue.push({ p, t: 0.9 });
  updateHUD();
}

// ---------- confetti ----------
function spawnConfetti(x, y, z, color, n = 80) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, up = 2.5 + Math.random() * 4;
    vel.push([Math.cos(a) * (1 + Math.random() * 2.5), up, Math.sin(a) * (1 + Math.random() * 2.5)]);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.16 }));
  scene.add(pts);
  confetti.push({ pts, vel, life: 1.6 });
}

// ---------- input ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);
const ndc = new THREE.Vector2();

function pointerGround(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const out = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, out) ? out : null;
}

function currentBall() { return players[current]?.ball; }
function canShoot() {
  return state === 'playing' && currentBall() && !currentBall().holed &&
    !currentBall().inWater && allRested(players.map(p => p.ball)) && respawnQueue.length === 0;
}

canvas.addEventListener('pointerdown', e => {
  if (!canShoot()) return;
  const g = pointerGround(e);
  if (!g) return;
  aiming = true;
  aimStart = g;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (!aiming) return;
  const g = pointerGround(e);
  if (!g) return;
  const b = currentBall();
  // slingshot: drag away from target, shoot opposite
  const dx = b.pos.x - g.x, dz = b.pos.z - g.z;
  const dist = Math.hypot(dx, dz);
  aimPower = Math.min(1, dist / 7);
  if (dist > 1e-4) aimDir.set(dx / dist, 0, dz / dist);
  updateAimVisual();
});

canvas.addEventListener('pointerup', e => {
  if (!aiming) return;
  aiming = false;
  aimGroup.visible = false;
  powerWrap.classList.add('hidden');
  if (aimPower > 0.06 && canShoot()) {
    const b = currentBall();
    b.vel.x = aimDir.x * aimPower * MAX_SPEED;
    b.vel.z = aimDir.z * aimPower * MAX_SPEED;
    clampSpeed(b.vel);
    players[current].strokes += 1;
    sfx.hit(aimPower);
    updateHUD();
  }
  aimPower = 0;
});

function updateAimVisual() {
  const b = currentBall();
  aimGroup.visible = aimPower > 0.02;
  powerWrap.classList.toggle('hidden', aimPower <= 0.02);
  powerBar.style.width = `${aimPower * 100}%`;
  if (!aimGroup.visible) return;
  aimGroup.position.set(b.pos.x, GROUND_Y + BALL_R, b.pos.z);
  // children extend along local -z; map that onto the aim direction
  aimGroup.rotation.y = Math.atan2(-aimDir.x, -aimDir.z);
  // cone at the tip
  const reach = 1 + aimPower * 6;
  aimArrow.position.set(0, 0, -(reach + 0.5));
  // dotted line
  aimDots.forEach((d, i) => {
    d.position.set(0, 0, -0.8 - i * (reach / aimDots.length));
    d.material.opacity = 0.9 - i * 0.07;
  });
}

// ---------- buttons ----------
$('quick-start-btn').addEventListener('click', startRound);
$('restart-btn').addEventListener('click', startRound);
$('play-again-btn').addEventListener('click', startRound);
$('menu-btn').addEventListener('click', () => { state = 'menu'; hud.classList.add('hidden'); setupScreen.classList.remove('hidden'); });
$('end-menu-btn').addEventListener('click', () => { state = 'menu'; endScreen.classList.add('hidden'); setupScreen.classList.remove('hidden'); });

renderRoster();

// ---------- animation ----------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(course.tee.x, 0, course.tee.z);
let wasMoving = false;
let pendingTurnAdvance = false;
let lastBounceSfx = -1;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // physics in fixed-ish substeps
  if (state === 'playing' || state === 'over') {
    const events = { bounce: false, bumper: false, splash: null, holed: null };
    const n = 4;
    for (let i = 0; i < n; i++) step(course, players.map(p => p.ball), dt / n, events);
    if (events.bounce && t - lastBounceSfx > 0.12) { sfx.bounce(); lastBounceSfx = t; }
    if (events.bumper) sfx.bumper();
    if (events.splash) { const p = players.find(pl => pl.ball === events.splash); if (p) splash(p); }
    if (events.holed) { const p = players.find(pl => pl.ball === events.holed); if (p && !p.holed) holeOut(p); }

    // respawn splashed balls
    for (const r of respawnQueue) r.t -= dt;
    for (const r of respawnQueue.filter(r => r.t <= 0)) {
      r.p.ball.pos = { ...r.p.ball.restPos };
      r.p.ball.inWater = false;
      r.p.mesh.visible = true;
    }
    respawnQueue = respawnQueue.filter(r => r.t > 0);

    // turn advance once everything rests (and pending respawns are done)
    const moving = !allRested(players.map(p => p.ball));
    if (state === 'playing') {
      if (wasMoving && !moving) pendingTurnAdvance = true;
      if (pendingTurnAdvance && !moving && respawnQueue.length === 0) {
        pendingTurnAdvance = false;
        for (const p of players) {
          if (!p.ball.holed && !p.ball.inWater) p.ball.restPos = { ...p.ball.pos };
          if (p.strokes >= MAX_STROKES && !p.holed) { p.holed = true; p.ball.holed = true; p.mesh.visible = false; }
        }
        nextTurn();
      }
    }
    wasMoving = moving;

    // sync meshes
    for (const p of players) {
      const b = p.ball;
      if (b.holed && b.sinkT > 0) {
        b.sinkT += dt;
        const k = Math.min(1, b.sinkT / 0.4);
        p.mesh.position.set(course.cup.x, GROUND_Y + BALL_R - k * 0.5, course.cup.z);
        p.mesh.scale.setScalar(1 - k * 0.9);
        if (k >= 1) { p.mesh.visible = false; b.sinkT = 0; }
      } else {
        p.mesh.position.set(b.pos.x, GROUND_Y + BALL_R, b.pos.z);
      }
      // avatar stands beside own ball, facing the cup
      const ax = b.pos.x + 0.75, az = b.pos.z - 0.35;
      p.avatar.position.x = ax; p.avatar.position.z = az;
      p.avatar.rotation.y = Math.atan2(course.cup.x - ax, course.cup.z - az);
      animateAvatar(p.avatar, t + players.indexOf(p));
    }

    // current-player marker
    if (state === 'playing' && currentBall() && !currentBall().holed) {
      marker.visible = true;
      marker.position.set(currentBall().pos.x, GROUND_Y + 1.15 + Math.sin(t * 4) * 0.12, currentBall().pos.z);
      marker.rotation.y = t * 2;
    } else marker.visible = false;

    // camera follows current ball (or cup at end)
    const focus = state === 'playing' && currentBall() ? currentBall().pos : course.cup;
    camTarget.lerp(new THREE.Vector3(focus.x, 0, focus.z), 1 - Math.pow(0.001, dt));
    const camOff = aiming ? new THREE.Vector3(0, 8.5, -7.5) : new THREE.Vector3(0, 11, -9.5);
    camera.position.lerp(new THREE.Vector3(camTarget.x + camOff.x, camOff.y, camTarget.z + camOff.z), 1 - Math.pow(0.002, dt));
    camera.lookAt(camTarget.x, 0, camTarget.z + 1.5);
  }

  // environment motion
  const wp = dynamic.water.geometry.attributes.position;
  const base = dynamic.waterBase;
  for (let i = 0; i < wp.count; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    wp.array[i * 3 + 1] = Math.sin(t * 1.4 + x * 0.25 + z * 0.18) * 0.22;
  }
  wp.needsUpdate = true;
  dynamic.spinnerBar.rotation.y = -course.spinner.angle;
  dynamic.flag.rotation.y = Math.sin(t * 2.5) * 0.35;
  for (const c of dynamic.clouds ?? []) {
    c.position.x += dt * 0.5;
    if (c.position.x > 70) c.position.x = -70;
  }

  // confetti particles
  for (const c of confetti) {
    c.life -= dt;
    const arr = c.pts.geometry.attributes.position.array;
    for (let i = 0; i < c.vel.length; i++) {
      c.vel[i][1] -= 9 * dt;
      arr[i * 3] += c.vel[i][0] * dt;
      arr[i * 3 + 1] += c.vel[i][1] * dt;
      arr[i * 3 + 2] += c.vel[i][2] * dt;
    }
    c.pts.geometry.attributes.position.needsUpdate = true;
    c.pts.material.opacity = Math.max(0, c.life / 1.6);
    c.pts.material.transparent = true;
  }
  confetti = confetti.filter(c => {
    if (c.life <= 0) { scene.remove(c.pts); return false; }
    return true;
  });

  renderer.render(scene, camera);
}
animate();
