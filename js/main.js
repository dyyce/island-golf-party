// Island Golf Party client — online multiplayer.
// The server is authoritative: it owns physics, turns and scores. This client
// renders server snapshots, sends aim/shoot input, and runs the lobby.

import * as THREE from 'three';
import { course, buildCourse, GROUND_Y } from './course.js';
import { BALL_R, MAX_SPEED } from './physics.js';
import { sfx } from './audio.js';

const COLOR_HEX = ['#e64545', '#3f7fff', '#2e9e44', '#b44fe6', '#ff8f3f', '#e6cf4f'];

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

// ---------- client state ----------
let me = { id: null, name: '', color: parseInt(COLOR_HEX[0].slice(1), 16) };
let hostId = null;
let roomPlayers = []; // lobby roster
let status = 'menu';  // menu | lobby | playing | over
let players = new Map(); // id -> {id,name,color,strokes,holed, mesh, target:{x,z}, inWater, sinking}
let currentId = null;
let rested = true;
let aiming = false;
let aimDir = new THREE.Vector3();
let aimPower = 0;
let confetti = [];
let lastBounceSfx = -1;

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
marker.visible = false;
scene.add(marker);

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const setupScreen = $('setup-screen'), hud = $('hud'), endScreen = $('end-screen');
const lobbyEntry = $('lobby-entry'), lobbyRoom = $('lobby-room');
const chipsEl = $('score-chips'), bannerEl = $('turn-banner');
const powerWrap = $('power-wrap'), powerBar = $('power-bar');

// color swatches
{
  const wrap = $('me-colors');
  for (const c of COLOR_HEX) {
    const b = document.createElement('div');
    b.className = 'swatch' + (me.color === parseInt(c.slice(1), 16) ? ' selected' : '');
    b.style.background = c;
    b.addEventListener('click', () => {
      me.color = parseInt(c.slice(1), 16);
      wrap.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
      b.classList.add('selected');
    });
    wrap.appendChild(b);
  }
}

// ---------- networking ----------
let ws = null;

function connect(action) {
  const name = $('me-name').value.trim() || 'Player';
  me.name = name;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    if (action.type === 'create') ws.send(JSON.stringify({ t: 'create', name, color: me.color }));
    else ws.send(JSON.stringify({ t: 'join', code: action.code, name, color: me.color }));
  };
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
  ws.onerror = () => { $('lobby-error').textContent = 'Connection failed.'; };
  ws.onclose = () => {
    if (status === 'playing' || status === 'over' || status === 'lobby') {
      bannerEl.textContent = 'Disconnected — reload to rejoin';
    }
  };
}

function handleMsg(msg) {
  switch (msg.t) {
    case 'me':
      me.id = msg.id;
      break;
    case 'error':
      $('lobby-error').textContent = msg.error;
      break;
    case 'lobby': {
      hostId = msg.hostId;
      roomPlayers = msg.players;
      status = 'lobby';
      lobbyEntry.classList.add('hidden');
      lobbyRoom.classList.remove('hidden');
      $('room-code').textContent = msg.code;
      const list = $('player-list');
      list.innerHTML = '';
      for (const p of msg.players) {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.innerHTML = `<span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>
          <span class="pname">${p.name}${p.id === me.id ? ' (you)' : ''}</span>
          ${p.id === hostId ? '<span class="pdesc">host 👑</span>' : ''}`;
        list.appendChild(row);
      }
      $('start-btn').classList.toggle('hidden', me.id !== hostId);
      $('waiting-host').classList.toggle('hidden', me.id === hostId);
      break;
    }
    case 'started':
      beginRound(msg.players);
      break;
    case 'state':
      applyState(msg);
      break;
    case 'events':
      for (const ev of msg.events) handleEvent(ev);
      break;
    case 'over':
      showEnd(msg.players);
      break;
  }
}

// ---------- round lifecycle ----------
function beginRound(playerInfos) {
  for (const p of players.values()) scene.remove(p.mesh);
  players = new Map();
  for (const info of playerInfos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 20, 14),
      new THREE.MeshPhongMaterial({ color: info.color, shininess: 90, specular: 0x666666 })
    );
    mesh.castShadow = true;
    mesh.position.set(course.tee.x, GROUND_Y + BALL_R, course.tee.z);
    scene.add(mesh);
    players.set(info.id, { ...info, mesh, target: { x: course.tee.x, z: course.tee.z }, inWater: false, sinking: 0 });
  }
  status = 'playing';
  aiming = false;
  aimGroup.visible = false;
  powerWrap.classList.add('hidden');
  setupScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  sfx.whistle();
}

function applyState(msg) {
  currentId = msg.current;
  rested = msg.rested;
  dynamic.spinnerBar.rotation.y = -msg.spinner;
  for (const ps of msg.players) {
    const p = players.get(ps.id);
    if (!p) continue;
    p.strokes = ps.strokes;
    p.holed = ps.holed;
    p.target.x = ps.x; p.target.z = ps.z;
    if (ps.inWater !== p.inWater) {
      p.inWater = ps.inWater;
      if (ps.inWater) p.mesh.visible = false;
      else if (!p.holed && !p.sinking) p.mesh.visible = true;
    }
  }
  updateHUD();
}

function handleEvent(ev) {
  const t = clock.elapsedTime;
  switch (ev.e) {
    case 'bounce':
      if (t - lastBounceSfx > 0.12) { sfx.bounce(); lastBounceSfx = t; }
      break;
    case 'bumper':
      sfx.bumper();
      break;
    case 'splash': {
      const p = players.get(ev.id);
      sfx.splash();
      if (p) spawnConfetti(p.target.x, GROUND_Y + 0.2, p.target.z, 0x2a8fbd, 40);
      break;
    }
    case 'respawn': {
      const p = players.get(ev.id);
      if (p && !p.holed) p.mesh.visible = true;
      break;
    }
    case 'hole': {
      const p = players.get(ev.id);
      if (p && !p.sinking) {
        p.sinking = 0.0001;
        sfx.hole();
        spawnConfetti(course.cup.x, GROUND_Y + 0.3, course.cup.z, p.color);
      }
      break;
    }
  }
}

function showEnd(playerInfos) {
  status = 'over';
  hud.classList.add('hidden');
  endScreen.classList.remove('hidden');
  const sorted = [...playerInfos].sort((a, b) => a.strokes - b.strokes);
  const best = sorted[0]?.strokes ?? 0;
  const winners = sorted.filter(p => p.strokes === best);
  $('winner-title').textContent = winners.length > 1 ? "🤝 It's a tie!" : `🎉 ${winners[0].name} wins!`;
  $('scorecard').innerHTML =
    '<tr><th>Player</th><th>Strokes</th></tr>' +
    sorted.map(p => `<tr><td>${p.name}${p.id === me.id ? ' (you)' : ''}</td><td>${p.strokes}${p.holed ? '' : ' (max)'}</td></tr>`).join('');
  $('play-again-btn').classList.toggle('hidden', me.id !== hostId);
  $('end-waiting').classList.toggle('hidden', me.id === hostId);
}

let lastHud = '';
function updateHUD() {
  if (status !== 'playing') return;
  const parts = [];
  for (const p of players.values()) {
    parts.push(`${p.id}:${p.strokes}:${p.holed}:${p.id === currentId}`);
  }
  const key = parts.join('|') + '#' + currentId;
  if (key === lastHud) return;
  lastHud = key;
  chipsEl.innerHTML = '';
  for (const p of players.values()) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (p.id === currentId ? ' current' : '') + (p.holed ? ' holed' : '');
    chip.innerHTML = `<span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>${p.name} · ${p.strokes}`;
    chipsEl.appendChild(chip);
  }
  const cur = players.get(currentId);
  bannerEl.textContent = cur ? (cur.id === me.id ? "Your turn — shoot!" : `${cur.name}'s turn`) : '';
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

function myBall() { return players.get(me.id); }
function canShoot() {
  const p = myBall();
  return status === 'playing' && p && currentId === me.id && rested &&
    !p.holed && !p.inWater && !p.sinking;
}

canvas.addEventListener('pointerdown', e => {
  if (e.button === 2) { orbiting = true; canvas.setPointerCapture(e.pointerId); return; }
  if (!canShoot()) return;
  const g = pointerGround(e);
  if (!g) return;
  aiming = true;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (orbiting) { targetYaw -= e.movementX * 0.006; return; }
  if (!aiming) return;
  const g = pointerGround(e);
  if (!g) return;
  const p = myBall();
  const dx = p.target.x - g.x, dz = p.target.z - g.z;
  const dist = Math.hypot(dx, dz);
  aimPower = Math.min(1, dist / 7);
  if (dist > 1e-4) aimDir.set(dx / dist, 0, dz / dist);
  updateAimVisual();
});

canvas.addEventListener('pointerup', e => {
  if (orbiting && e.button === 2) { orbiting = false; return; }
  if (!aiming) return;
  aiming = false;
  aimGroup.visible = false;
  powerWrap.classList.add('hidden');
  if (aimPower > 0.06 && canShoot()) {
    ws.send(JSON.stringify({
      t: 'shoot',
      x: aimDir.x * aimPower * MAX_SPEED,
      z: aimDir.z * aimPower * MAX_SPEED,
    }));
    sfx.hit(aimPower);
  }
  aimPower = 0;
});

canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  keysDown.add(e.code);
  if (['ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keysDown.delete(e.code));

function updateAimVisual() {
  const p = myBall();
  aimGroup.visible = aimPower > 0.02;
  powerWrap.classList.toggle('hidden', aimPower <= 0.02);
  powerBar.style.width = `${aimPower * 100}%`;
  if (!aimGroup.visible) return;
  aimGroup.position.set(p.target.x, GROUND_Y + BALL_R, p.target.z);
  // children extend along local -z; map that onto the aim direction
  aimGroup.rotation.y = Math.atan2(-aimDir.x, -aimDir.z);
  const reach = 1 + aimPower * 6;
  aimArrow.position.set(0, 0, -(reach + 0.5));
  aimDots.forEach((d, i) => {
    d.position.set(0, 0, -0.8 - i * (reach / aimDots.length));
    d.material.opacity = 0.9 - i * 0.07;
  });
}

// ---------- buttons ----------
$('create-room-btn').addEventListener('click', () => connect({ type: 'create' }));
$('join-room-btn').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) { $('lobby-error').textContent = 'Enter the 4-letter room code.'; return; }
  connect({ type: 'join', code });
});
$('start-btn').addEventListener('click', () => ws.send(JSON.stringify({ t: 'start' })));
$('play-again-btn').addEventListener('click', () => ws.send(JSON.stringify({ t: 'start' })));
$('cam-left-btn').addEventListener('click', () => { targetYaw += Math.PI / 4; });
$('cam-right-btn').addEventListener('click', () => { targetYaw -= Math.PI / 4; });

// ---------- animation ----------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(course.tee.x, 0, course.tee.z);
let camYaw = 0, targetYaw = 0;
let orbiting = false;
const keysDown = new Set();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // held-key camera rotation
  if (keysDown.has('KeyQ') || keysDown.has('ArrowLeft')) targetYaw += dt * 1.8;
  if (keysDown.has('KeyE') || keysDown.has('ArrowRight')) targetYaw -= dt * 1.8;

  if (status === 'playing' || status === 'over') {
    // interpolate balls toward server targets
    const k = 1 - Math.pow(0.0001, dt);
    for (const p of players.values()) {
      if (p.sinking > 0) {
        p.sinking += dt;
        const s = Math.min(1, p.sinking / 0.4);
        p.mesh.position.set(course.cup.x, GROUND_Y + BALL_R - s * 0.5, course.cup.z);
        p.mesh.scale.setScalar(1 - s * 0.9);
        if (s >= 1) { p.mesh.visible = false; p.sinking = -1; }
      } else if (!p.inWater && !p.holed) {
        p.mesh.position.x += (p.target.x - p.mesh.position.x) * k;
        p.mesh.position.z += (p.target.z - p.mesh.position.z) * k;
        p.mesh.position.y = GROUND_Y + BALL_R;
      }
    }

    // current-player marker
    const cur = players.get(currentId);
    if (status === 'playing' && cur && !cur.holed && !cur.inWater) {
      marker.visible = true;
      marker.position.set(cur.mesh.position.x, GROUND_Y + 1.15 + Math.sin(t * 4) * 0.12, cur.mesh.position.z);
      marker.rotation.y = t * 2;
    } else marker.visible = false;

    // camera follows the ball of whoever is up (or the cup at the end)
    const focus = status === 'playing' && cur ? cur.mesh.position : new THREE.Vector3(course.cup.x, 0, course.cup.z);
    camYaw += (targetYaw - camYaw) * (1 - Math.pow(0.005, dt));
    camTarget.lerp(new THREE.Vector3(focus.x, 0, focus.z), 1 - Math.pow(0.001, dt));
    const baseOff = aiming ? new THREE.Vector3(0, 8.5, -7.5) : new THREE.Vector3(0, 11, -9.5);
    const cosY = Math.cos(camYaw), sinY = Math.sin(camYaw);
    const camOff = new THREE.Vector3(
      baseOff.x * cosY + baseOff.z * sinY, baseOff.y,
      -baseOff.x * sinY + baseOff.z * cosY
    );
    camera.position.lerp(new THREE.Vector3(camTarget.x + camOff.x, camOff.y, camTarget.z + camOff.z), 1 - Math.pow(0.002, dt));
    camera.lookAt(camTarget.x + 1.5 * sinY, 0, camTarget.z + 1.5 * cosY);
  }

  // environment motion
  const wp = dynamic.water.geometry.attributes.position;
  const base = dynamic.waterBase;
  for (let i = 0; i < wp.count; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    wp.array[i * 3 + 1] = Math.sin(t * 1.4 + x * 0.25 + z * 0.18) * 0.22;
  }
  wp.needsUpdate = true;
  if (status !== 'playing' && status !== 'over') {
    // idle spin before the round starts (server drives it during play)
    dynamic.spinnerBar.rotation.y = -t * course.spinner.angSpeed;
  }
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
