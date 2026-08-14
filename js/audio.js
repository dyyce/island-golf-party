// Tiny WebAudio synth for game sounds — no assets needed.
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'square', gain = 0.12, slideTo = null) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch (e) { /* audio unavailable — fine */ }
}

export const sfx = {
  hit(power = 0.5) { tone(140 + power * 120, 0.12, 'square', 0.10 + power * 0.10); },
  bounce() { tone(280, 0.07, 'triangle', 0.08); },
  bumper() { tone(320, 0.18, 'square', 0.12, 700); },
  splash() { tone(220, 0.35, 'sawtooth', 0.10, 60); },
  whistle() { tone(900, 0.25, 'sine', 0.06, 1400); },
  hole() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.12), i * 90));
  },
  turn() { tone(660, 0.08, 'sine', 0.05); },
};
