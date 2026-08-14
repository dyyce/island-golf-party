// Pure course data — shared between the browser client and the Node server.
// No imports allowed here (must run in both). Top-down layout, units ~meters.

export const GROUND_Y = 0.2;

function arcWalls(cx, cz, r, gapCenterDeg, gapHalfDeg, stepDeg = 12) {
  // wall segments around a circle, skipping a gap centered at gapCenterDeg
  const walls = [];
  const start = gapCenterDeg + gapHalfDeg;
  const end = gapCenterDeg - gapHalfDeg + 360;
  for (let a = start; a < end; a += stepDeg) {
    const a1 = (a * Math.PI) / 180, a2 = ((a + stepDeg) * Math.PI) / 180;
    walls.push({
      ax: cx + r * Math.cos(a1), az: cz + r * Math.sin(a1),
      bx: cx + r * Math.cos(a2), bz: cz + r * Math.sin(a2),
    });
  }
  return walls;
}

const GREEN = { x: -4, z: 17, r: 4.6 };

export const course = {
  island: { cx: -9, cz: 9, rx: 23, rz: 17.5 },
  tee: { x: -19, z: 0 },
  green: GREEN,
  cup: { x: -4, z: 18.9, r: 0.32 },
  spinner: { x: -4, z: 13.1, len: 2.1, thick: 0.15, angSpeed: 1.4, angle: 0 },
  bridge: { x: -4, z: 10, w: 1.7, d: 3.9 },
  waterZones: [{ x: -5, z: 10, w: 52, d: 3.6 }],   // the canal
  sandZones: [{ x: -5.1, z: 4.5, r: 1.7 }],
  bumpers: [
    { x: -14, z: 0.85, r: 0.55 },
    { x: -9, z: -0.85, r: 0.55 },
  ],
  walls: [
    // tee box end
    { ax: -20.5, az: -1.7, bx: -20.5, bz: 1.7 },
    // lane A (east-west)
    { ax: -20.5, az: -1.7, bx: -2.3, bz: -1.7 },
    { ax: -20.5, az: 1.7, bx: -5.7, bz: 1.7 },
    // lane B (south-north)
    { ax: -2.3, az: -1.7, bx: -2.3, bz: 8.2 },
    { ax: -5.7, az: 1.7, bx: -5.7, bz: 8.2 },
    // green perimeter with south-facing entrance gap
    ...arcWalls(GREEN.x, GREEN.z, GREEN.r, 270, 24),
    // canal banks + bridge rails (invisible — the ball can never fall in)
    { ax: -31, az: 8.2, bx: -4.9, bz: 8.2, hidden: true },
    { ax: -3.1, az: 8.2, bx: 21, bz: 8.2, hidden: true },
    { ax: -31, az: 11.8, bx: -4.9, bz: 11.8, hidden: true },
    { ax: -3.1, az: 11.8, bx: 21, bz: 11.8, hidden: true },
    { ax: -4.9, az: 8.2, bx: -4.9, bz: 11.8, hidden: true },
    { ax: -3.1, az: 8.2, bx: -3.1, bz: 11.8, hidden: true },
  ],
};
