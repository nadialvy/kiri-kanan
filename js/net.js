// Peer-to-peer link via PeerJS (free public signalling server, then direct WebRTC).
const PREFIX = 'kirikanan-v1-';
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] };
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Net {
  constructor() { this.peer = null; this.conn = null; this.handlers = {}; this.isHost = false; this.code = ''; this.mic = null; this.calls = []; this.voiceVol = 1; this.micGain = 1; }
  setVoiceVolume(v) { this.voiceVol = v; const a = document.getElementById('remoteAudio'); if (a) a.volume = v; }
  setMicGain(v) { this.micGain = v; if (this.micGainNode) this.micGainNode.gain.value = v; }
  on(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { this.handlers[type]?.(data); }
  get connected() { return !!(this.conn && this.conn.open); }

  host() {
    return new Promise((resolve, reject) => {
      const tryOpen = (attempt) => {
        this.code = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
        const peer = new window.Peer(PREFIX + this.code, { config: ICE, debug: 0 });
        peer.on('open', () => { this.peer = peer; this.isHost = true; this._listen(); resolve(this.code); });
        peer.on('error', (e) => {
          if (e.type === 'unavailable-id' && attempt < 5) { peer.destroy(); tryOpen(attempt + 1); }
          else if (!this.peer) reject(e); else this.emit('error', e);
        });
      };
      tryOpen(0);
    });
  }

  join(code) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(undefined, { config: ICE, debug: 0 });
      let done = false;
      const fail = (e) => { if (!done) { done = true; reject(e); } else this.emit('error', e); };
      peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? new Error('Room tidak ditemukan') : e));
      peer.on('open', () => {
        this.peer = peer; this.code = code; this._listen();
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const t = setTimeout(() => fail(new Error('Gagal konek (timeout)')), 15000);
        conn.on('open', () => { clearTimeout(t); done = true; this._setConn(conn); resolve(); });
      });
    });
  }

  _listen() {
    this.peer.on('connection', (conn) => {
      if (this.connected) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
      conn.on('open', () => this._setConn(conn));
    });
    this.peer.on('call', (call) => {
      call.answer();
      call.on('stream', (stream) => this._playRemote(stream));
      this.calls.push(call);
    });
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
  }

  _setConn(conn) {
    this.conn = conn;
    conn.on('data', (d) => d && d.t && this.emit(d.t, d));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.emit('close'); } });
    conn.on('error', () => {});
    this.emit('connected');
    if (this.mic) this._callWithMic();
  }

  send(msg) { if (this.connected) this.conn.send(msg); }

  async toggleMic() {
    if (this.mic) { this._stopMic(); this.calls.forEach((c) => c.close()); this.calls = []; return false; }
    this.rawMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    // route through a gain node so the player can make their own mic louder/quieter
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.micCtx = this.micCtx || new AC(); await this.micCtx.resume();
      const src = this.micCtx.createMediaStreamSource(this.rawMic);
      this.micGainNode = this.micCtx.createGain(); this.micGainNode.gain.value = this.micGain;
      const dest = this.micCtx.createMediaStreamDestination();
      src.connect(this.micGainNode); this.micGainNode.connect(dest);
      this.mic = dest.stream;
    } catch (_) { this.mic = this.rawMic; this.micGainNode = null; }
    if (this.connected) this._callWithMic();
    return true;
  }
  _callWithMic() {
    const call = this.peer.call(this.conn.peer, this.mic);
    this.calls.push(call);
  }
  _playRemote(stream) {
    let a = document.getElementById('remoteAudio');
    if (!a) { a = document.createElement('audio'); a.id = 'remoteAudio'; a.autoplay = true; document.body.appendChild(a); }
    a.volume = this.voiceVol; a.srcObject = stream; a.play().catch(() => {});
  }

  _stopMic() {
    for (const s of [this.mic, this.rawMic]) s?.getTracks().forEach((t) => t.stop());
    this.mic = this.rawMic = this.micGainNode = null;
  }

  close() {
    try { this.conn?.close(); } catch (_) {}
    try { this.peer?.destroy(); } catch (_) {}
    this._stopMic();
    this.peer = this.conn = null; this.calls = []; this.isHost = false;
  }
}
