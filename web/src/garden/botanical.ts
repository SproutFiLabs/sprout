/** One raster puppet rig shared by the dashboard and the campaign renderer. */
export type Art = Record<string, CanvasImageSource>;
export const PARTS = ['petal-orange', 'petal-blue', 'petal-yellow', 'centre', 'leaf-green', 'leaf-purple', 'wing-left', 'wing-right', 'body', 'sparkle'];
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p); };
const TAU = Math.PI * 2;

export function part(c: CanvasRenderingContext2D, art: Art, name: string, x: number, y: number, w: number, h: number, angle = 0, base = false) {
  if (!art[name] || w < .1 || h < .1) return;
  c.save(); c.translate(x, y); c.rotate(angle);
  c.drawImage(art[name], -w / 2, base ? -h : -h / 2, w, h); c.restore();
}

export function flower(c: CanvasRenderingContext2D, art: Art, x: number, base: number, height: number, bloom: number, time: number, colour = 'orange', phase = 0) {
  const p = clamp(bloom), grow = .24 + .76 * smooth(p / .75);
  const bend = Math.sin(time * 1.2 + phase) * height * .035 + Math.sin(time * .63 + phase) * height * .016;
  const top = base - height * grow, headX = x + bend;
  c.save(); c.strokeStyle = '#087349'; c.lineWidth = Math.max(3, height * .025); c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, base); c.bezierCurveTo(x - bend * .3, base - height * .3, x + bend * 1.3, top + height * .15, headX, top); c.stroke();
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1, q = smooth((p - i * .045) / .68);
    const y = base - height * grow * (.22 + i * .13);
    const angle = side * (.24 + .78 * q) + Math.sin(time * 1.6 + i + phase) * .055 * q;
    part(c, art, 'leaf-green', x + bend * (.12 + i * .16), y, height * .18 * (.3 + .7 * q), height * .36 * (.15 + .85 * q), angle, true);
  }
  const radius = height * .235;
  for (let i = 0; i < 7; i++) {
    const q = smooth((p - .15 - i * .016) / .68);
    const target = i * TAU / 7;
    // Petal bases remain attached while the blade spreads from a tight upright bud.
    const angle = (target > Math.PI ? target - TAU : target) * q + Math.sin(time * 1.5 + i * .8 + phase) * .035 * q;
    const length = radius * (.52 + .66 * q);
    part(c, art, 'petal-' + colour, headX, top + radius * .08, radius * (.23 + .64 * q), length, angle, true);
  }
  const heart = smooth((p - .35) / .55);
  part(c, art, 'centre', headX, top, radius * (.22 + .8 * heart), radius * (.22 + .8 * heart), Math.sin(time * .9 + phase) * .04);
  c.restore();
}

export function butterfly(c: CanvasRenderingContext2D, art: Art, x: number, y: number, size: number, time: number, angle = 0) {
  if (!art['wing-left'] || !art['wing-right']) return;
  const flap = .2 + .8 * (Math.cos(time * 12) * .5 + .5);
  c.save(); c.translate(x, y); c.rotate(angle);
  c.drawImage(art['wing-left'], -size * .62 * flap, -size * .45, size * .65 * flap, size * .85);
  c.drawImage(art['wing-right'], -size * .03 * flap, -size * .45, size * .65 * flap, size * .85);
  part(c, art, 'body', 0, 0, size * .17, size * .72);
  c.restore();
}

/** Short, connected sprigs fill the lower gaps without crowding flower heads. */
function rootedSprigs(c: CanvasRenderingContext2D, art: Art, progress: number, time: number) {
  const root = { x: 330, y: 276 };
  const opened = smooth(progress);
  const reach = .2 + opened * .8;
  const leafScale = .36 + opened * .64;
  const sway = Math.sin(time * .85) * 2 * opened;
  const at = (x: number, y: number) => ({
    x: root.x + (x - root.x) * reach + sway * ((x - root.x) / 260),
    y: root.y + (y - root.y) * reach,
  });

  const branches = [
    { c1: [290, 258], c2: [205, 260], end: [145, 236], leaves: [{ t: .43, w: 25, h: 48, a: .62 }, { t: .8, w: 29, h: 54, a: -.82 }] },
    { c1: [315, 250], c2: [270, 231], end: [242, 218], leaves: [{ t: .44, w: 22, h: 43, a: .78 }, { t: .8, w: 26, h: 49, a: -.72 }] },
    { c1: [345, 250], c2: [390, 231], end: [418, 218], leaves: [{ t: .44, w: 22, h: 43, a: -.78 }, { t: .8, w: 26, h: 49, a: .72 }] },
    { c1: [370, 258], c2: [455, 260], end: [510, 236], leaves: [{ t: .43, w: 25, h: 48, a: -.62 }, { t: .8, w: 29, h: 54, a: .82 }] },
  ];
  const p0 = at(root.x, root.y);
  const draw = branches.map((branch) => ({
    p0,
    p1: at(branch.c1[0]!, branch.c1[1]!),
    p2: at(branch.c2[0]!, branch.c2[1]!),
    p3: at(branch.end[0]!, branch.end[1]!),
    leaves: branch.leaves,
  }));

  c.save(); c.strokeStyle = '#087349'; c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  for (const branch of draw) {
    c.moveTo(branch.p0.x, branch.p0.y);
    c.bezierCurveTo(branch.p1.x, branch.p1.y, branch.p2.x, branch.p2.y, branch.p3.x, branch.p3.y);
  }
  c.stroke();

  const bezierPoint = (p1: typeof p0, p2: typeof p0, p3: typeof p0, t: number) => {
    const u = 1 - t;
    return {
      x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
      y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    };
  };
  draw.forEach((branch, index) => {
    for (const leaf of branch.leaves) {
      const point = bezierPoint(branch.p1, branch.p2, branch.p3, leaf.t);
      part(c, art, 'leaf-green', point.x, point.y, leaf.w * leafScale, leaf.h * leafScale, leaf.a + Math.sin(time + index) * .035 * opened, true);
    }
  });
  c.restore();
}

export function bouquet(c: CanvasRenderingContext2D, art: Art, width: number, height: number, progress: number, time: number, mottoColor = '#216235', compact = false) {
  c.clearRect(0, 0, width, height); c.save();
  if (compact) {
    // The empty-dashboard hero has less room beside its copy, so keep its
    // flowers and foliage together as one small, anchored arrangement.
    const scale = Math.min(width / 720, height / 270);
    c.translate((width - 720 * scale) / 2, height - 270 * scale);
    c.scale(scale, scale);
    rootedSprigs(c, art, progress, time);
    flower(c, art, 145, 276, 160, progress, time, 'blue', .7);
    flower(c, art, 330, 278, 194, progress, time, 'orange', 2);
    flower(c, art, 490, 276, 162, progress, time, 'yellow', 1.4);
    butterfly(c, art, 580 + Math.sin(time * .7) * 10, 76 - progress * 20 + Math.sin(time * .8) * 6, 28, time, -.18);
    c.fillStyle = mottoColor; c.textAlign = 'center'; c.font = 'italic 20px Georgia';
    c.translate(632, 126); c.rotate(-.12);
    for (const [i, line] of ['Small steps.', 'Brighter', 'days.'].entries()) c.fillText(line, 0, i * 25);
    c.restore();
    return;
  }
  c.scale(width / 720, height / 270);
  rootedSprigs(c, art, progress, time);
  flower(c, art, 145, 275, 180, progress, time, 'blue', .7);
  flower(c, art, 490, 276, 190, progress, time, 'orange', 2);
  flower(c, art, 330, 294, 122, progress, time, 'yellow', 1.4);
  butterfly(c, art, 565 + Math.sin(time * .7) * 13, 112 - progress * 45 + Math.sin(time * .8) * 8, 31, time, -.18);
  c.fillStyle = mottoColor; c.textAlign = 'center'; c.font = 'italic 22px Georgia';
  c.translate(652, 115); c.rotate(-.12);
  for (const [i, line] of ['Small steps.', 'Brighter', 'days.'].entries()) c.fillText(line, 0, i * 27);
  c.restore();
}

/** A responsive meadow: add flowers across wide screens instead of stretching them. */
export function meadow(c: CanvasRenderingContext2D, art: Art, width: number, height: number, progress: number, time: number) {
  c.clearRect(0, 0, width, height);
  const scale = height / 320, span = width / scale;
  const count = Math.max(3, Math.min(9, Math.round(span / 210)));
  c.save(); c.scale(scale, scale);
  for (let i = 0; i < count; i++) {
    const x = (i + .5) * span / count;
    const p = clamp(progress - (i % 3) * .035);
    part(c, art, i % 2 ? 'leaf-purple' : 'leaf-green', x - 38, 327, 65, 120 + i % 2 * 45, -.4, true);
    flower(c, art, x, 325, 190 + i % 3 * 18, p, time, ['orange', 'blue', 'yellow'][i % 3], i * 1.6);
  }
  butterfly(c, art, span * .69 + Math.sin(time) * 20, 67 + Math.sin(time * .8) * 13, 43, time, -.12);
  c.restore();
}
