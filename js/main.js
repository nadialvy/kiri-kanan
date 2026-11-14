import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateTrack, medalTimes, DS } from './track.js';
import { buildWorld, buildCockpit } from './world.js';
import { createCar, stepCar, manualReset, speedOf } from './car.js';
import { Net } from './net.js';
import { Sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const FOG = [{ near: 10, far: 120 }, { near: 5, far: 48 }, { near: 3, far: 30 }];
const SKY = 0xcfe3ee;

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, FOG[1].near, FOG[1].far);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 900);
const hemi = new THREE.HemisphereLight(0xe6f4ff, 0x5d7a3e, 1.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.1); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 88 : 72; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// ---------------- assets ----------------
const assets = {};
const sfx = new Sfx();
async function loadAssets() {
  const loader = new GLTFLoader();
  const load = (u) => new Promise((res) => loader.load(u, (g) => res(g.scene), undefined, () => res(null)));
  const [truck, forest] = await Promise.all([load('assets/vehicle-truck-red.glb'), load('assets/decoration-forest.glb')]);
  assets.truck = truck; assets.forest = forest;
}

// ---------------- car visual ----------------
const carGroup = new THREE.Group(); scene.add(carGroup);
const cockpit = buildCockpit(); carGroup.add(cockpit.group);
let truck = null, wheels = [];
function setupTruck() {
  if (!assets.truck) return;
  truck = assets.truck.clone(); truck.scale.setScalar(1.65);
  truck.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  wheels = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'].map((n) => truck.getObjectByName(n)).filter(Boolean);
  carGroup.add(truck);
}

// ---------------- game state ----------------
const net = new Net();
const G = {
  mode: 'menu',          // menu | lobby | race
  solo: false,
  role: 'driver',        // my role
  hostRole: 'driver',
  seed: (Math.random() * 1e6) | 0,
  fog: 1,
  track: null, world: null, car: null, medals: null,
  phase: 'idle',         // countdown | running | finished
  t: 0,                  // race clock (negative during countdown)
  camMode: 'cockpit',
  shake: 0,
  snaps: [],             // navigator interpolation buffer
  view: { x: 0, z: 0, h: 0, steer: 0, v: 0, idx: 0, slip: 0, t: 0, pen: 0, phase: 'idle' },
  notesSaid: new Set(),
  showMini: true,
};
const input = { left: false, right: false, gas: false, tL: false, tR: false, tGas: false };

function buildStage(seed) {
  if (G.world) G.world.dispose();
  G.track = generateTrack(seed);
  G.world = buildWorld(scene, G.track, assets);
  G.medals = medalTimes(G.track.length);
  G.car = createCar(G.track);
  G.notesSaid = new Set();
}

// ---------------- UI helpers ----------------
function show(id) { for (const s of ['menu', 'lobby', 'hud', 'finish']) $(s).classList.toggle('hidden', s !== id && !(id === 'finish' && s === 'hud')); }
let toastT;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
const fmt = (s) => { if (s < 0) s = 0; const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };

// ---------------- menu ----------------
const params = new URLSearchParams(location.search);
if (params.get('room')) $('joinCode').value = params.get('room').toUpperCase();

$('btnHost').onclick = async () => {
  sfx.init();
  $('menuMsg').textContent = 'bikin room…';
  try {
    const code = await net.host();
    G.solo = false; G.mode = 'lobby'; G.hostRole = 'driver';
    $('roomCode').textContent = code; $('lobbyStatus').textContent = 'nunggu teman gabung…';
    $('btnStart').disabled = true; renderLobby(); show('lobby'); $('menuMsg').textContent = '';
  } catch (e) { $('menuMsg').textContent = 'Gagal bikin room: ' + (e.message || e.type); }
};
$('btnJoin').onclick = async () => {
  sfx.init();
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) { $('menuMsg').textContent = 'kodenya 4 huruf ya'; return; }
  $('menuMsg').textContent = 'nyambung ke ' + code + '…';
  try {
    await net.join(code);
    G.solo = false; G.mode = 'lobby';
    $('roomCode').textContent = code; $('lobbyStatus').textContent = 'tersambung! nunggu host mulai 🙌';
    renderLobby(); show('lobby'); $('menuMsg').textContent = '';
  } catch (e) { net.close(); $('menuMsg').textContent = e.message || 'Gagal gabung'; }
};
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnSolo').onclick = () => { sfx.init(); G.solo = true; G.role = 'driver'; startRace((Math.random() * 1e6) | 0, 1, 'driver'); };

// ---------------- lobby ----------------
function myRoleFromHost(hostRole) { return net.isHost ? hostRole : hostRole === 'driver' ? 'nav' : 'driver'; }
function renderLobby() {
  const me = myRoleFromHost(G.hostRole);
  const other = net.connected ? 'Teman' : '…';
  $('whoDriver').textContent = me === 'driver' ? 'Kamu' : other; $('whoDriver').classList.toggle('me', me === 'driver');
  $('whoNav').textContent = me === 'nav' ? 'Kamu' : other; $('whoNav').classList.toggle('me', me === 'nav');
  $('seedLbl').textContent = '#' + String(G.seed % 10000).padStart(4, '0');
  $('selFog').value = String(G.fog);
  $('selFog').disabled = !net.isHost; $('btnSeed').disabled = !net.isHost;
  $('btnStart').disabled = !(net.isHost && net.connected);
  $('btnStart').textContent = net.isHost ? 'Mulai!' : 'nunggu host…';
}
function syncLobby() { if (net.isHost) net.send({ t: 'lobby', hostRole: G.hostRole, fog: G.fog, seed: G.seed }); }
$('btnSwap').onclick = () => { if (net.isHost) { G.hostRole = G.hostRole === 'driver' ? 'nav' : 'driver'; renderLobby(); syncLobby(); } else net.send({ t: 'req', what: 'swap' }); };
$('selFog').onchange = () => { G.fog = +$('selFog').value; syncLobby(); };
$('btnSeed').onclick = () => { G.seed = (Math.random() * 1e6) | 0; renderLobby(); syncLobby(); };
$('btnCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${net.code}`;
  try { await navigator.clipboard.writeText(url); toast('link disalin ✨'); } catch { toast(url, 6000); }
};
$('btnStart').onclick = () => { if (net.isHost && net.connected) hostStart(G.seed); };
$('btnLeave').onclick = () => backToMenu();
async function micToggle() {
  try { const on = await net.toggleMic(); $('btnMic').textContent = '🎤 Voice chat: ' + (on ? 'ON' : 'off'); $('btnMicHud').textContent = on ? '🎤' : '🔇'; toast(on ? 'mic nyala, ngobrol aja langsung 🎙️' : 'mic mati'); }
  catch (e) { toast('mic ga bisa dipakai (butuh https / izin mic)'); }
}
$('btnMic').onclick = micToggle; $('btnMicHud').onclick = micToggle;

function hostStart(seed) {
  G.seed = seed;
  net.send({ t: 'start', seed, fog: G.fog, hostRole: G.hostRole });
  startRace(seed, G.fog, myRoleFromHost(G.hostRole));
}

net.on('connected', () => {
  if (net.isHost) { $('lobbyStatus').textContent = 'teman udah masuk! 🎉'; toast('teman gabung 🎉'); syncLobby(); }
  renderLobby();
});
net.on('close', () => { toast('koneksi ke teman putus 😢', 4000); if (G.mode !== 'menu') backToMenu(); });
net.on('error', (e) => console.warn('net', e));
net.on('full', () => { toast('room udah penuh'); backToMenu(); });
net.on('lobby', (d) => { G.hostRole = d.hostRole; G.fog = d.fog; G.seed = d.seed; renderLobby(); });
net.on('start', (d) => { G.hostRole = d.hostRole; G.fog = d.fog; G.seed = d.seed; startRace(d.seed, d.fog, myRoleFromHost(d.hostRole)); });
net.on('req', (d) => {
  if (!net.isHost) return;
  if (d.what === 'swap') { G.hostRole = G.hostRole === 'driver' ? 'nav' : 'driver'; if (G.mode === 'lobby') { renderLobby(); syncLobby(); } else hostStart(G.seed); }
  if (d.what === 'retry') hostStart(G.seed);
  if (d.what === 'new') hostStart((Math.random() * 1e6) | 0);
  if (d.what === 'lobby') goLobby(true);
});
net.on('tolobby', () => goLobby(false));
net.on('s', (d) => { if (G.role === 'nav') { d.rt = performance.now(); G.snaps.push(d); if (G.snaps.length > 30) G.snaps.shift(); } });
net.on('call', (d) => { if (G.role === 'driver') showCallout(d.d, true); });
net.on('crash', (d) => { if (G.role === 'nav') { sfx.impact(d.k); G.shake = Math.max(G.shake, d.k); flashPen(); } });
net.on('reset', () => { if (G.role === 'nav') { toast('keluar jalur! +10 detik'); flashPen(); } });
net.on('finish', (d) => { if (G.role === 'nav') showFinish(d); });

function goLobby(broadcast) {
  if (broadcast && net.isHost) net.send({ t: 'tolobby' });
  G.mode = 'lobby'; G.phase = 'idle'; sfx.stopLoops(); renderLobby(); show('lobby');
}
function backToMenu() {
  net.close(); G.mode = 'menu'; G.phase = 'idle'; G.solo = false; sfx.stopLoops();
  $('btnMic').textContent = '🎤 Voice chat: off';
  show('menu');
}

// ---------------- race ----------------
function startRace(seed, fog, role) {
  G.role = role; G.fog = fog; G.seed = seed;
  buildStage(seed);
  scene.fog.near = FOG[fog].near; scene.fog.far = FOG[fog].far;
  G.mode = 'race'; G.phase = 'countdown'; G.t = -3; G.snaps = []; G.camMode = 'cockpit';
  G.view = { x: G.car.x, z: G.car.z, h: G.car.h, steer: 0, v: 0, idx: G.car.idx, slip: 0, t: -3, pen: 0, phase: 'countdown' };
  G.lastSend = 0; G.lastCount = 4;
  show('hud');
  const isDriver = role === 'driver';
  $('tablet').classList.toggle('hidden', isDriver);
  $('miniWrap').classList.toggle('hidden', !(G.solo && G.showMini));
  $('touch').classList.toggle('hidden', !(isDriver && matchMedia('(pointer: coarse)').matches));
  $('btnMicHud').classList.toggle('hidden', G.solo);
  $('hint').innerHTML = isDriver
    ? (G.solo ? 'W/↑ gas · A D / ← → belok · R reset (+10s) · V kamera · M peta' : 'W/↑ gas · A D / ← → belok · R reset (+10s) · V kamera<br/>dengerin navigator-mu 👂')
    : '← ↑ → atau A W D = panggil arah · S = pelan · G = gas!<br/>kamu yang liat peta. jagain supirnya ya 🫶';
  $('callout').className = ''; $('pen').textContent = '';
  sfx.startLoops();
}

function showCallout(d, speak) {
  const text = { L: '⬅ KIRI!', R: 'KANAN! ➡', S: '⬆ LURUS!', SLOW: '🐢 PELAN!', GO: '🔥 GAS POL!' }[d] || d;
  const el = $('callout'); el.textContent = text; el.className = d + ' show';
  clearTimeout(showCallout.t); showCallout.t = setTimeout(() => el.classList.remove('show'), 1300);
  if (speak) { sfx.beep(d === 'L' ? 520 : d === 'R' ? 700 : d === 'SLOW' ? 300 : 880); sfx.say({ L: 'kiri', R: 'kanan', S: 'lurus', SLOW: 'pelan pelan', GO: 'gas!' }[d], 'id-ID'); }
}
function sendCall(d) {
  if (G.mode !== 'race' || G.role !== 'nav') return;
  net.send({ t: 'call', d });
  const b = document.querySelector(`[data-call="${d}"]`); if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 200); }
  sfx.beep(600, 0.05);
}
document.querySelectorAll('[data-call]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); sendCall(b.dataset.call); }));

function flashPen() { const p = $('pen'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); }

// keyboard
const keymap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'gas', KeyW: 'gas', Space: 'gas' };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (G.mode !== 'race') return;
  if (G.role === 'nav') {
    const c = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'S', KeyW: 'S', ArrowDown: 'SLOW', KeyS: 'SLOW', KeyG: 'GO', Space: 'GO' }[e.code];
    if (c && !e.repeat) { sendCall(c); e.preventDefault(); }
    return;
  }
  if (keymap[e.code]) { input[keymap[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR' && G.phase === 'running') { manualReset(G.car, G.track); net.send({ t: 'reset' }); flashPen(); }
  if (e.code === 'KeyV') G.camMode = G.camMode === 'cockpit' ? 'chase' : 'cockpit';
  if (e.code === 'KeyM' && G.solo) { G.showMini = !G.showMini; $('miniWrap').classList.toggle('hidden', !G.showMini); }
});
window.addEventListener('keyup', (e) => { if (keymap[e.code]) input[keymap[e.code]] = false; });
window.addEventListener('blur', () => { input.left = input.right = input.gas = false; });
for (const [id, k] of [['tL', 'tL'], ['tR', 'tR'], ['tGas', 'tGas']]) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); input[k] = true; b.setPointerCapture(e.pointerId); });
  const up = () => (input[k] = false); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
}
$('btnQuit').onclick = () => { if (G.solo) { G.mode = 'menu'; G.phase = 'idle'; sfx.stopLoops(); show('menu'); } else if (confirm('keluar dari room?')) backToMenu(); };

// ---------------- finish ----------------
function showFinish(d) {
  G.phase = 'finished';
  const total = d.time + d.pen;
  const m = G.medals;
  const medal = total <= m.gold ? ['🥇', 'GOLD!'] : total <= m.silver ? ['🥈', 'SILVER!'] : total <= m.bronze ? ['🥉', 'BRONZE'] : ['🐌', 'FINISH… pelan banget wkwk'];
  $('finMedal').textContent = medal[0]; $('finTitle').textContent = medal[1];
  $('finTime').textContent = fmt(total);
  $('finBreak').textContent = `waktu ${fmt(d.time)} · nabrak ${d.crashes}× (+${d.crashes * 3}s) · keluar jalur ${d.resets}× (+${d.resets * 10}s)`;
  const key = 'kk-best-' + G.seed + '-' + G.fog;
  let best = null; try { best = +localStorage.getItem(key) || null; if (!best || total < best) localStorage.setItem(key, total); } catch (_) {}
  $('finBest').textContent = best && best < total ? `best di track ini: ${fmt(best)}` : best ? '✨ rekor baru di track ini!' : '';
  const canRun = G.solo || net.isHost;
  $('finWait').textContent = canRun ? '' : 'pilihanmu dikirim ke host';
  $('finSwap').classList.toggle('hidden', G.solo);
  show('finish');
}
const finAction = (what) => {
  if (G.solo) { if (what === 'retry') startRace(G.seed, G.fog, 'driver'); else if (what === 'new') startRace((Math.random() * 1e6) | 0, G.fog, 'driver'); return; }
  if (net.isHost) net.emit('req', { what }); else net.send({ t: 'req', what });
};
$('finRetry').onclick = () => finAction('retry');
$('finNew').onclick = () => finAction('new');
$('finSwap').onclick = () => finAction('swap');
$('finMenu').onclick = () => { if (G.solo) { G.mode = 'menu'; sfx.stopLoops(); show('menu'); } else finAction('lobby'); };

// ---------------- simulation (driver) ----------------
const STEP = 1 / 120;
let acc = 0;
function simulate(dt) {
  const c = G.car, tr = G.track;
  acc += Math.min(dt, 0.1);
  while (acc >= STEP) {
    acc -= STEP;
    if (G.phase === 'countdown') { G.t += STEP; if (G.t >= 0) { G.t = 0; G.phase = 'running'; } }
    else if (G.phase === 'running') G.t += STEP;
    const inp = { steer: (input.left || input.tL ? 1 : 0) - (input.right || input.tR ? 1 : 0), gas: input.gas || input.tGas ? 1 : 0 };
    const ev = stepCar(c, inp, STEP, tr, G.world.colliders, performance.now() / 1000, G.phase === 'running');
    if (ev.crash) { sfx.impact(ev.crash); G.shake = Math.max(G.shake, ev.crash); flashPen(); net.send({ t: 'crash', k: ev.crash }); }
    if (ev.reset) { toast('keluar jalur! +10 detik'); flashPen(); net.send({ t: 'reset' }); }
    if (G.phase === 'running' && c.idx >= tr.n - 30) {
      const d = { t: 'finish', time: G.t, pen: c.penalty, crashes: c.crashes, resets: c.resets };
      net.send(d); showFinish(d);
    }
  }
  const v = G.view;
  Object.assign(v, { x: c.x, z: c.z, h: c.h, steer: c.steer, v: speedOf(c), idx: c.idx, slip: c.slip, t: G.t, pen: c.penalty, phase: G.phase, gas: input.gas || input.tGas, surface: c.surface });
  const now = performance.now();
  if (!G.solo && now - G.lastSend > 33) {
    G.lastSend = now;
    net.send({ t: 's', x: +c.x.toFixed(2), z: +c.z.toFixed(2), h: +c.h.toFixed(4), st: +c.steer.toFixed(3), v: +v.v.toFixed(2), i: c.idx, sl: +c.slip.toFixed(2), tm: +G.t.toFixed(2), pen: c.penalty, ph: G.phase, g: v.gas ? 1 : 0, sf: c.surface });
  }
}

// ---------------- interpolation (navigator) ----------------
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }
function interpolate() {
  const s = G.snaps; if (!s.length) return;
  const rt = performance.now() - 90;
  let a = s[0], b = s[s.length - 1];
  for (let i = s.length - 1; i > 0; i--) if (s[i - 1].rt <= rt) { a = s[i - 1]; b = s[i]; break; }
  const span = b.rt - a.rt;
  const t = span > 0 ? Math.max(0, Math.min(1.2, (rt - a.rt) / span)) : 1;
  const v = G.view;
  v.x = a.x + (b.x - a.x) * t; v.z = a.z + (b.z - a.z) * t; v.h = lerpAngle(a.h, b.h, t);
  v.steer = b.st; v.v = b.v; v.idx = b.i; v.slip = b.sl; v.t = b.tm; v.pen = b.pen; v.phase = b.ph; v.gas = b.g; v.surface = b.sf;
}

// ---------------- maps ----------------
const sevColor = (sev) => (sev <= 2 ? '#ff4d4d' : sev <= 4 ? '#ffa53a' : sev <= 6 ? '#ffe14d' : '#9be37d');
function drawMap(canvas, big) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0b0b0f'; g.fillRect(0, 0, W, H);
  const tr = G.track, v = G.view; if (!tr) return;
  const ahead = big ? 260 : 170;
  const scale = (H * 0.78) / ahead;
  const cx = W / 2, cy = H * 0.82;
  const fx = Math.sin(v.h), fz = Math.cos(v.h), lx = fz, lz = -fx;
  const P = (i) => { const dx = tr.X[i] - v.x, dz = tr.Z[i] - v.z; return [cx - (dx * lx + dz * lz) * scale, cy - (dx * fx + dz * fz) * scale]; };
  const i0 = Math.max(0, v.idx - 25), i1 = Math.min(tr.n - 1, v.idx + Math.round((ahead * 1.6) / DS));
  // grid feel
  g.strokeStyle = 'rgba(255,255,255,0.04)'; g.lineWidth = 1;
  for (let y = cy % 40; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = (a, b) => { g.beginPath(); for (let i = a; i <= b; i++) { const [x, y] = P(i); i === a ? g.moveTo(x, y) : g.lineTo(x, y); } };
  path(i0, i1); g.strokeStyle = '#f4f4f4'; g.lineWidth = Math.max(6, 8 * scale + 4); g.stroke();
  path(i0, i1); g.strokeStyle = '#2d2d36'; g.lineWidth = Math.max(3, 8 * scale); g.stroke();
  // corners coloured by severity
  for (const nt of tr.notes) {
    if (nt.dir === 'S' || nt.s1 / DS < i0 || nt.s / DS > i1) continue;
    path(Math.max(i0, Math.round(nt.s / DS)), Math.min(i1, Math.round(nt.s1 / DS)));
    g.strokeStyle = sevColor(nt.sev); g.lineWidth = Math.max(3, 8 * scale * 0.55); g.stroke();
  }
  // driven part
  path(i0, v.idx); g.strokeStyle = 'rgba(120,200,255,0.55)'; g.lineWidth = 2.5; g.stroke();
  // finish
  if (tr.n - 30 <= i1) { const [x, y] = P(tr.n - 30); g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText('🏁', x, y + 7); }
  // labels
  g.font = `800 ${big ? 13 : 10}px 'Baloo 2', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const nt of tr.notes) {
    const si = Math.round(nt.s / DS); if (si < v.idx || si > i1) continue;
    const [x, y] = P(si); if (y < 8 || y > H) continue;
    const txt = nt.label.replace('HAIRPIN', 'HP');
    const w = g.measureText(txt).width + 10;
    g.fillStyle = sevColor(nt.sev); g.fillRect(x - w / 2, y - 9, w, 18);
    g.fillStyle = '#111'; g.fillText(txt, x, y + 1);
  }
  // car
  g.save(); g.translate(cx, cy);
  g.fillStyle = '#58c4ff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
  g.restore();
  // progress bar
  const prog = v.idx / (tr.n - 30);
  g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(8, H - 8, W - 16, 4);
  g.fillStyle = '#ffd23f'; g.fillRect(8, H - 8, (W - 16) * Math.min(1, prog), 4);
}

function upcomingNotes(k) {
  const s = G.view.idx * DS, out = [];
  for (const nt of G.track.notes) { if (nt.s > s - 3) { out.push(nt); if (out.length >= k) break; } }
  return out;
}

// ---------------- HUD ----------------
let lastHud = 0;
function updateHud(now) {
  if (now - lastHud < 50) return; lastHud = now;
  const v = G.view, m = G.medals;
  $('timer').textContent = fmt(v.t);
  $('pen').textContent = v.pen ? `+${v.pen.toFixed(3)}` : '';
  const total = Math.max(0, v.t) + v.pen;
  const nextMedal = total <= m.gold ? ['🥇 GOLD', m.gold] : total <= m.silver ? ['🥈 SILVER', m.silver] : total <= m.bronze ? ['🥉 BRONZE', m.bronze] : null;
  $('medal').textContent = nextMedal ? `${nextMedal[0]} ${fmt(nextMedal[1])}` : '🐌 no medal';
  $('speed').firstElementChild.textContent = Math.round(v.v * 3.6);
  const cd = $('countdown');
  if (v.phase === 'countdown') { const n = Math.ceil(-v.t); cd.textContent = n > 0 ? n : ''; cd.className = ''; if (n !== G.lastCount) { G.lastCount = n; if (n > 0) sfx.beep(440, 0.12); } }
  else if (v.phase === 'running' && v.t < 1) { cd.textContent = 'GO!'; cd.className = 'go'; if (G.lastCount !== 0) { G.lastCount = 0; sfx.beep(880, 0.25); } }
  else cd.textContent = '';
  if (G.role === 'nav' && G.track) {
    const [a, b, c] = upcomingNotes(3);
    if (a) {
      const d = Math.max(0, a.s - v.idx * DS);
      $('tabNote').textContent = a.label; $('tabNote').style.color = sevColor(a.sev);
      $('tabDist').textContent = d > 2 ? `${Math.round(d)} m` : 'NOW';
      $('tabSub').textContent = a.sub || '';
      $('tabNext').textContent = [b, c].filter(Boolean).map((n) => `${n.label} (${Math.round(n.s - v.idx * DS)}m)`).join('  ›  ');
    }
  }
}

// solo: bot co-driver reads pace notes out loud
function botNavigator() {
  const v = G.view; if (v.phase !== 'running' && v.phase !== 'countdown') return;
  const s = v.idx * DS;
  for (const nt of G.track.notes) {
    if (G.notesSaid.has(nt) || nt.s < s - 5) continue;
    const lead = 45 + v.v * 2.2;
    if (nt.s - s < lead) {
      G.notesSaid.add(nt);
      const spoken = nt.label.toLowerCase() + (nt.sub ? ', ' + nt.sub.toLowerCase().replace(/·/g, ',') : '');
      sfx.say(spoken.replace('straight', 'straight,'), 'en-US');
      if (nt.dir !== 'S') showCallout(nt.dir, false);
    }
    break;
  }
}

// ---------------- camera ----------------
const camTarget = new THREE.Vector3();
function updateCamera(dt, t) {
  const v = G.view;
  carGroup.position.set(v.x, 0, v.z); carGroup.rotation.y = v.h;
  cockpit.update(v.steer, t);
  if (wheels.length) { for (let i = 0; i < wheels.length; i++) { wheels[i].rotation.x += (v.v * dt) / 0.5; if (i < 2) wheels[i].rotation.y = v.steer * 0.45; } }
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const rough = v.surface === 'grass' ? 0.012 : v.surface === 'dirt' ? 0.006 : 0.0015;
  const sh = G.shake * 0.12 + rough * Math.min(1, v.v / 15);
  const jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
  const inCockpit = G.mode === 'race' && G.camMode === 'cockpit';
  cockpit.group.visible = inCockpit;
  if (truck) truck.visible = !inCockpit;
  if (inCockpit) {
    if (camera.parent !== carGroup) carGroup.add(camera);
    const seatX = G.role === 'driver' ? 0.42 : -0.42;
    camera.position.set(seatX + jx, 1.34 + jy, -0.3);
    camera.rotation.set(0, Math.PI - v.steer * 0.06, 0);
    camera.rotateX(G.role === 'driver' ? -0.06 : -0.1);
  } else {
    if (camera.parent !== scene) scene.add(camera);
    if (G.mode === 'race') {
      const back = 9, up = 3.6;
      camTarget.set(v.x - Math.sin(v.h) * back, up, v.z - Math.cos(v.h) * back);
      camera.position.lerp(camTarget, 1 - Math.exp(-dt * 6));
      camera.position.x += jx * 3; camera.position.y += jy * 3;
      camera.lookAt(v.x + Math.sin(v.h) * 4, 1.2, v.z + Math.cos(v.h) * 4);
    } else {
      // menu orbit
      const a = t * 0.18;
      camera.position.set(v.x + Math.sin(a) * 9, 3.2, v.z + Math.cos(a) * 9);
      camera.lookAt(v.x, 1, v.z);
    }
  }
  sun.position.set(v.x + 30, 60, v.z + 20); sun.target.position.set(v.x, 0, v.z);
}

// ---------------- main loop ----------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (G.mode === 'race' && G.track) {
    if (G.role === 'driver') { if (G.phase !== 'finished') simulate(dt); }
    else interpolate();
    updateHud(now);
    if (G.role === 'nav') drawMap($('map'), true);
    else if (G.solo && G.showMini) { drawMap($('mini'), false); }
    if (G.solo) botNavigator();
    const v = G.view;
    sfx.update(v.v, v.gas, v.surface === 'road' ? v.slip : v.slip * 0.4, G.phase === 'finished');
  } else {
    scene.fog.far = 220; scene.fog.near = 30;
  }
  updateCamera(dt, t);
  renderer.render(scene, camera);
}

// ---------------- boot ----------------
(async function boot() {
  await loadAssets();
  setupTruck();
  buildStage(424242);
  G.view.x = G.car.x; G.view.z = G.car.z; G.view.h = G.car.h; G.view.idx = G.car.idx;
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
})();
