// Peer-to-peer multiplayer over WebRTC data channels — no backend needed.
//
// GitHub Pages can't run a signalling server, so we use MANUAL signalling:
// the host generates an offer code, the guest pastes it and returns an answer
// code, the host pastes that back. Once connected the two peers exchange a
// tiny JSON protocol over an unreliable/unordered data channel:
//   {f, t:'p', ...}  player pose      {f, t:'b', ...}  block edit
//   {f, t:'c', s}    chat             {f, t:'h', n}    hello (name)
//
// The world is shared by broadcasting each peer's own block edits and pose;
// each side applies the other's edits locally (remote edits are flagged so
// they don't echo back). Mobs are simulated independently per peer.

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

export function encodeMsg(o) { return JSON.stringify(o); }
export function decodeMsg(s) { try { return JSON.parse(s); } catch { return null; } }

// Compact, URL-safe code for an SDP description (base64 of JSON).
export function packCode(desc) {
  const json = JSON.stringify({ type: desc.type, sdp: desc.sdp });
  const b = typeof btoa === 'function' ? btoa(json) : Buffer.from(json).toString('base64');
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unpackCode(code) {
  const b = code.replace(/-/g, '+').replace(/_/g, '/');
  const json = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString();
  return JSON.parse(json);
}

export class NetSession {
  // hooks: { onBlock(x,y,z,id), onPlayer(id,x,y,z,yaw,pitch), onChat(id,s),
  //          onStatus(text), onPeerGone(id) }
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.id = Math.random().toString(36).slice(2, 8);
    this.name = 'Player-' + this.id.slice(0, 3);
    this.pc = null;
    this.chan = null;
    this.connected = false;
    this.isHost = false;
    this.remote = new Map();          // peerId -> { x,y,z,yaw,pitch, name, t }
  }

  _newConnection() {
    const pc = new RTCPeerConnection({ iceServers: STUN });
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      this.hooks.onStatus?.(st);
      if (st === 'disconnected' || st === 'failed' || st === 'closed') this._teardown();
    };
    this.pc = pc;
    return pc;
  }

  // Wait for ICE gathering so the code carries all candidates (non-trickle).
  _gathered(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); res(); } };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(res, 2500);          // fall back if a candidate stalls
    });
  }

  // HOST step 1 → returns an offer code to hand to the guest.
  async createOffer() {
    this.isHost = true;
    const pc = this._newConnection();
    const ch = pc.createDataChannel('blocks', { ordered: false, maxRetransmits: 0 });
    this._bindChannel(ch);
    await pc.setLocalDescription(await pc.createOffer());
    await this._gathered(pc);
    return packCode(pc.localDescription);
  }
  // HOST step 2 → paste the guest's answer code to finish connecting.
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(unpackCode(code));
  }

  // GUEST → paste the host's offer code, returns an answer code to send back.
  async acceptOffer(code) {
    const pc = this._newConnection();
    pc.ondatachannel = (e) => this._bindChannel(e.channel);
    await pc.setRemoteDescription(unpackCode(code));
    await pc.setLocalDescription(await pc.createAnswer());
    await this._gathered(pc);
    return packCode(pc.localDescription);
  }

  _bindChannel(ch) {
    this.chan = ch;
    ch.onopen = () => {
      this.connected = true;
      this.hooks.onStatus?.('connected');
      this.send({ t: 'h', n: this.name });
    };
    ch.onclose = () => this._teardown();
    ch.onmessage = (e) => this._recv(e.data);
  }

  _recv(data) {
    const m = decodeMsg(data);
    if (!m || m.f === this.id) return;
    const id = m.f;
    if (m.t === 'p') {
      this.remote.set(id, { x: m.x, y: m.y, z: m.z, yaw: m.a, pitch: m.b, name: (this.remote.get(id) || {}).name });
      this.hooks.onPlayer?.(id, m.x, m.y, m.z, m.a, m.b);
    } else if (m.t === 'b') {
      this.hooks.onBlock?.(m.x, m.y, m.z, m.i);
    } else if (m.t === 'c') {
      this.hooks.onChat?.(id, m.s);
    } else if (m.t === 'h') {
      const r = this.remote.get(id) || {}; r.name = m.n; this.remote.set(id, r);
      this.hooks.onChat?.(id, `${m.n} joined`);
    }
  }

  send(obj) {
    if (!this.chan || this.chan.readyState !== 'open') return;
    obj.f = this.id;
    try { this.chan.send(encodeMsg(obj)); } catch { /* channel hiccup */ }
  }

  broadcastBlock(x, y, z, id) { this.send({ t: 'b', x, y, z, i: id }); }
  broadcastPose(x, y, z, yaw, pitch) { this.send({ t: 'p', x, y, z, a: +yaw.toFixed(2), b: +pitch.toFixed(2) }); }
  chat(s) { this.send({ t: 'c', s }); this.hooks.onChat?.(this.id, `${this.name}: ${s}`); }

  _teardown() {
    if (!this.connected && !this.pc) return;
    this.connected = false;
    for (const id of this.remote.keys()) this.hooks.onPeerGone?.(id);
    this.remote.clear();
    this.hooks.onStatus?.('disconnected');
  }
  close() {
    try { this.chan?.close(); this.pc?.close(); } catch { /* already gone */ }
    this._teardown();
    this.pc = null; this.chan = null;
  }
}
