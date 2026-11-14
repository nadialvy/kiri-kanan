// Tiny WebAudio sound layer: engine/skid loops (Kenney CC0 sounds), impacts, beeps, speech.
export class Sfx {
  constructor() { this.ctx = null; this.buf = {}; this.loops = null; this.vol = 0.7; }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
    for (const n of ['engine', 'skid', 'impact']) {
      fetch(`assets/${n}.mp3`).then((r) => r.arrayBuffer()).then((a) => this.ctx.decodeAudioData(a)).then((b) => { this.buf[n] = b; if (this.wantLoops) this.startLoops(); }).catch(() => {});
    }
    // warm up speech voices list
    try { speechSynthesis.getVoices(); } catch (_) {}
  }

  _loop(buf) {
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.master); src.start();
    return { src, g };
  }
  startLoops() {
    this.wantLoops = true;
    if (!this.ctx || this.loops || !this.buf.engine || !this.buf.skid) return;
    this.ctx.resume();
    this.loops = { engine: this._loop(this.buf.engine), skid: this._loop(this.buf.skid) };
  }
  stopLoops() {
    this.wantLoops = false;
    if (!this.loops) return;
    for (const l of Object.values(this.loops)) { try { l.src.stop(); } catch (_) {} }
    this.loops = null;
  }
  update(speed, gas, slip, muted) {
    if (!this.loops) return;
    const t = this.ctx.currentTime;
    const e = this.loops.engine;
    e.src.playbackRate.setTargetAtTime(0.55 + Math.min(1, speed / 40) * 1.3 + (gas ? 0.12 : 0), t, 0.08);
    e.g.gain.setTargetAtTime(muted ? 0 : gas ? 0.5 : 0.28, t, 0.1);
    const sk = this.loops.skid;
    sk.g.gain.setTargetAtTime(muted ? 0 : Math.max(0, Math.min(0.6, (slip - 2.5) * 0.12)) * Math.min(1, speed / 8), t, 0.06);
  }
  impact(k = 1) {
    if (!this.ctx || !this.buf.impact) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf.impact;
    const g = this.ctx.createGain(); g.gain.value = 0.4 + k * 0.8; s.connect(g); g.connect(this.master); s.start();
  }
  beep(freq = 660, dur = 0.09) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  say(text, lang) {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 1.25; u.pitch = 1.05; u.volume = Math.min(1, this.vol * 1.4);
      if (u.volume <= 0) return;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.replace('_', '-').startsWith(lang.slice(0, 2)));
      if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (_) {}
  }
}
