import { SE, type MoveKind, type PType } from './data';
import { url } from './assets';
import { createPlayer, type SongPlayer } from './music';

const MUSIC_VOL = 0.55;

/** Pokémon cries and FireRed's music are real game audio (see scripts/fetch-assets.ts); SFX are synthesized chiptune blips. */
class AudioEngine {
  muted = (() => {
    try {
      return localStorage.getItem('pr-muted') === '1';
    } catch {
      return false;
    }
  })();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private cries = new Map<string, Promise<AudioBuffer | null>>();
  private gates = new Map<string, number>();
  private musicBus!: GainNode; // music volume; ducked under jingles
  private jingleBus!: GainNode;
  private sfxBus!: GainNode; // game sound effects played from FireRed's own sequences
  private music: SongPlayer | null = null;
  private musicName = '';
  private musicReq = 0; // guards against an older song finishing its load after a newer request
  private musicStarted = false;

  /** Must be called from a user gesture before anything is audible. */
  unlock() {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(c.destination);
      // Songs differ a lot in loudness (the battle themes are dense); a gentle compressor evens them out.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = MUSIC_VOL;
      this.musicBus.connect(comp);
      this.jingleBus = c.createGain();
      this.jingleBus.gain.value = MUSIC_VOL;
      this.jingleBus.connect(comp);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(comp);
      void createPlayer(c, this.sfxBus, SE.select, false); // load it now so the first press isn't late
      this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    // Music requested before the first gesture starts now (once: later gestures find it playing or loading).
    if (this.musicName && !this.musicStarted) {
      this.musicStarted = true;
      const name = this.musicName;
      this.musicName = '';
      this.playMusic(name);
    }
  }

  /** Freeze all sound while the tab is hidden; the music scheduler runs on ctx time, so it picks up where it left off. */
  watchVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('pr-muted', this.muted ? '1' : '0');
    } catch {}
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }

  // ── real audio ──

  preloadCry(id: string) {
    if (!this.ctx || this.cries.has(id)) return this.cries.get(id);
    const p = fetch(url.cry(id))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((b) => this.ctx!.decodeAudioData(b))
      .catch(() => null);
    this.cries.set(id, p);
    return p;
  }

  async cry(id: string, vol = 0.5, rate = 1) {
    if (!this.ctx || !this.gate('cry', 250)) return;
    const buf = await this.preloadCry(id);
    if (!buf || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  /**
   * Crossfades to a looping song (no-op if it's already playing or loading). Only the latest request ever starts:
   * a song that finishes loading after something newer was asked for is dropped, so tracks can't pile up.
   */
  playMusic(name: string) {
    if (this.musicName === name) return;
    this.musicName = name;
    if (!this.ctx) return; // starts on unlock()
    this.musicStarted = true;
    this.stopJingles();
    this.stopMusic(false);
    const req = ++this.musicReq;
    void this.loadSong(name, true).then((p) => {
      if (!p) return;
      if (req !== this.musicReq) return p.stop();
      this.music = p;
      this.fadeIn(p, 0.5);
      p.start();
    });
  }

  stopMusic(reset = true) {
    this.musicReq++;
    if (this.music) this.fadeOut(this.music, 0.6);
    this.music = null;
    if (reset) this.musicName = '';
  }

  private jingles = new Set<SongPlayer>();

  /** Plays a fanfare once (Pokémon caught, healed) with the music ducked underneath until it ends. */
  async jingle(name: string) {
    if (!this.ctx) return;
    this.setMusicVol(MUSIC_VOL * 0.12, 0.1);
    const req = this.musicReq;
    const p = await this.loadSong(name, false);
    // Dropped if the music changed while it loaded (e.g. the round ended): a late fanfare would talk over it.
    if (!p || req !== this.musicReq) {
      p?.stop();
      if (!this.jingles.size) this.setMusicVol(MUSIC_VOL, 0.5);
      return;
    }
    this.jingles.add(p);
    p.start();
    await p.done;
    this.jingles.delete(p);
    if (!this.jingles.size) this.setMusicVol(MUSIC_VOL, 0.8);
  }

  private stopJingles() {
    for (const j of this.jingles) this.fadeOut(j, 0.3);
    this.jingles.clear();
    this.setMusicVol(MUSIC_VOL, 0.3);
  }

  private loadSong(name: string, loop: boolean) {
    return createPlayer(this.ctx!, loop ? this.musicBus : this.jingleBus, name, loop);
  }

  private fadeIn(p: SongPlayer, s: number) {
    const t = this.ctx!.currentTime, v = p.out.gain.value;
    p.out.gain.setValueAtTime(0, t);
    p.out.gain.linearRampToValueAtTime(v, t + s);
  }

  private fadeOut(p: SongPlayer, s: number) {
    const ctx = this.ctx!;
    const g = p.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + s);
    p.stop(s);
  }

  private setMusicVol(v: number, s: number) {
    if (!this.ctx) return;
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(v, t + s);
  }

  // ── synth ──

  private gate(key: string, ms: number) {
    const now = performance.now();
    if ((this.gates.get(key) ?? 0) > now) return false;
    this.gates.set(key, now + ms);
    return true;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType = 'square', vol = 0.1, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, f0: number, f1: number, vol = 0.15, type: BiquadFilterType = 'bandpass', delay = 0, q = 1) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  throw() {
    this.noise(0.25, 600, 2400, 0.1);
    this.tone(300, 900, 0.18, 'sine', 0.05);
  }
  ballOpen() {
    this.tone(1200, 400, 0.12, 'square', 0.06);
    this.noise(0.15, 3000, 800, 0.08);
  }
  wobble() {
    this.tone(220, 180, 0.07, 'square', 0.07);
    this.tone(330, 260, 0.06, 'square', 0.05, 0.05);
  }
  breakFree() {
    this.noise(0.25, 1500, 300, 0.18, 'lowpass');
    this.tone(600, 150, 0.25, 'sawtooth', 0.06);
  }
  hit(mult: number) {
    if (!this.gate('hit', 70)) return;
    if (mult > 1) {
      this.noise(0.18, 2500, 400, 0.2, 'lowpass');
      this.tone(880, 1320, 0.12, 'square', 0.06);
    } else if (mult < 1) this.noise(0.12, 600, 200, 0.1, 'lowpass');
    else this.noise(0.12, 1600, 300, 0.14, 'lowpass');
  }
  move(type: PType, kind: MoveKind) {
    if (!this.gate(`move-${type}`, kind === 'spray' ? 250 : 120)) return;
    switch (type) {
      case 'fire': return this.noise(0.35, 700, 2600, 0.09);
      case 'water': return this.noise(0.35, 2400, 500, 0.09, 'bandpass', 0, 4);
      case 'grass': this.noise(0.2, 3000, 6000, 0.06, 'highpass'); return this.tone(1800, 2600, 0.1, 'sine', 0.03);
      case 'electric': this.tone(90, 70, 0.25, 'sawtooth', 0.06); return this.tone(1400, 300, 0.2, 'square', 0.035);
      case 'psychic': this.tone(400, 1200, 0.35, 'sine', 0.07); return this.tone(600, 1800, 0.35, 'triangle', 0.035);
      case 'ghost': return this.tone(220, 110, 0.4, 'triangle', 0.08);
      case 'rock': return this.noise(0.25, 500, 120, 0.16, 'lowpass');
      case 'flying': return this.noise(0.3, 900, 2200, 0.08);
      case 'ice': this.noise(0.25, 5000, 8000, 0.06, 'highpass'); return this.tone(2200, 1600, 0.2, 'sine', 0.04);
      case 'poison': return this.noise(0.3, 400, 900, 0.1, 'bandpass', 0, 6);
      case 'ground': this.noise(0.4, 300, 60, 0.22, 'lowpass'); return this.tone(70, 45, 0.3, 'square', 0.06);
      case 'bug': return this.tone(180, 220, 0.2, 'sawtooth', 0.04);
      case 'dragon': this.tone(140, 90, 0.4, 'sawtooth', 0.06); return this.noise(0.35, 500, 1500, 0.08);
      default: return this.noise(0.08, 1200, 400, 0.12, 'lowpass');
    }
  }
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.1, 'square', 0.05, i * 0.07));
  }
  faint() {
    this.tone(600, 80, 0.6, 'square', 0.05);
  }
  roundStart() {
    [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.05, i * 0.1));
    this.tone(784, 784, 0.3, 'square', 0.06, 0.3);
  }
  /** A strong Pokémon appears (the area's evolved finale). */
  strong() {
    this.tone(110, 55, 1, 'sawtooth', 0.08);
    this.noise(1, 200, 60, 0.18, 'lowpass');
  }
  dash() {
    this.noise(0.18, 400, 2000, 0.12);
  }
  shiny() {
    [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, f, 0.18, 'sine', 0.05, i * 0.07));
  }
  /** FireRed's menu select sound: what pressing A makes. */
  ui() {
    if (!this.ctx || !this.gate('ui', 60)) return;
    void createPlayer(this.ctx, this.sfxBus, SE.select, false).then((p) => p?.start());
  }
}

export const audio = new AudioEngine();
