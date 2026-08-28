import { clamp, smooth, type Art } from './botanical';
import type { BotanicalAtlas } from './botanicalAtlas';

export type GardenTheme = 'overview' | 'portfolio' | 'invest' | 'chores' | 'gifts' | 'graduation';
type Point = { x: number; y: number };
type SectionArt = Art & Partial<BotanicalAtlas>;

const stem = '#276947';
const darkStem = '#1d5b3d';
const soil = '#9a7041';

function bezier(start: Point, controlA: Point, controlB: Point, end: Point, count = 48): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    const inverse = 1 - t;
    return {
      x: inverse * inverse * inverse * start.x + 3 * inverse * inverse * t * controlA.x + 3 * inverse * t * t * controlB.x + t * t * t * end.x,
      y: inverse * inverse * inverse * start.y + 3 * inverse * inverse * t * controlA.y + 3 * inverse * t * t * controlB.y + t * t * t * end.y,
    };
  });
}

function pointAt(path: Point[], fraction: number): Point {
  return path[Math.min(path.length - 1, Math.max(0, Math.floor(fraction * (path.length - 1))))]!;
}

function trace(context: CanvasRenderingContext2D, path: Point[], progress: number, width = 2.8, colour = stem) {
  const p = clamp(progress);
  if (p <= 0) return;
  const end = Math.max(1, Math.floor(p * (path.length - 1)));
  context.save();
  context.strokeStyle = colour;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  // Segment widths taper toward each growing tip, keeping the hand-drawn stems
  // light at the foliage while never exceeding the 4px silhouette budget.
  for (let index = 1; index <= end; index += 1) {
    context.lineWidth = Math.min(4, width * (1.12 - (index / end) * 0.34));
    context.beginPath();
    context.moveTo(path[index - 1]!.x, path[index - 1]!.y);
    context.lineTo(path[index]!.x, path[index]!.y);
    context.stroke();
  }
  context.restore();
}

/** A blade opens from its true bottom anchor; width expands ahead of length and rotation. */
function unfurl(
  context: CanvasRenderingContext2D,
  art: SectionArt,
  name: keyof BotanicalAtlas,
  anchor: Point,
  width: number,
  height: number,
  tangent: number,
  progress: number,
  hanging = false,
) {
  const image = art[name];
  const p = clamp(progress);
  if (!image || p <= 0) return;
  const reveal = smooth(p);
  const bladeWidth = width * (0.1 + reveal * 0.9);
  const bladeHeight = height * (0.28 + reveal * 0.72);
  const opening = tangent * (0.2 + reveal * 0.8) + (hanging ? Math.PI * reveal : 0);
  context.save();
  context.translate(anchor.x, anchor.y);
  context.rotate(opening);
  context.globalAlpha = 0.84 + reveal * 0.16;
  context.drawImage(image, -bladeWidth / 2, -bladeHeight, bladeWidth, bladeHeight);
  context.restore();
}

function localLeafProgress(parentProgress: number, attachment: number, threshold: number) {
  return childProgress(childProgress(parentProgress, attachment), threshold);
}

function childProgress(parentProgress: number, attachment: number) {
  const p = clamp(parentProgress);
  if (attachment >= 1) return p >= 1 ? 1 : 0;
  return clamp((p - attachment) / (1 - attachment));
}

function soilIsland(context: CanvasRenderingContext2D, x: number, y: number, width: number, progress: number) {
  if (progress <= 0) return;
  context.save();
  context.strokeStyle = soil;
  context.lineWidth = 2.2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(x - width / 2, y);
  context.quadraticCurveTo(x, y - 4, x + width / 2, y);
  context.stroke();
  context.restore();
}

/** Draw one page-specific scene. The overview bouquet is rendered by botanical.ts and never enters here. */
export function sectionGarden(
  context: CanvasRenderingContext2D,
  art: SectionArt,
  width: number,
  height: number,
  progress: number,
  _time: number,
  theme: GardenTheme,
) {
  context.clearRect(0, 0, width, height);
  const scale = Math.min(width / 720, height / 270);
  context.save();
  // Keep every rooted scene on the lane's lower edge, including tall narrow
  // mobile canvases where centering would leave the soil floating above cards.
  context.translate((width - 720 * scale) / 2, height - 270 * scale);
  context.scale(scale, scale);
  const normalized = clamp((clamp(progress) - 0.28) / 0.72);
  const growth = clamp(0.16 + normalized * 0.84);

  if (theme === 'portfolio') {
    // A bough arrives through the upper-right corner and sweeps into the lower-left.
    const bough = bezier({ x: 716, y: 35 }, { x: 570, y: 20 }, { x: 350, y: 70 }, { x: 100, y: 135 }, 58);
    const hangingBranches = [
      bezier(pointAt(bough, 0.16), { x: 610, y: 58 }, { x: 592, y: 84 }, { x: 584, y: 98 }),
      bezier(pointAt(bough, 0.36), { x: 484, y: 66 }, { x: 466, y: 91 }, { x: 455, y: 108 }),
      bezier(pointAt(bough, 0.58), { x: 350, y: 92 }, { x: 338, y: 108 }, { x: 330, y: 122 }),
      bezier(pointAt(bough, 0.78), { x: 226, y: 120 }, { x: 218, y: 127 }, { x: 210, y: 132 }),
    ];
    const branchAttachments = [0.16, 0.36, 0.58, 0.78];
    trace(context, bough, growth, 3.4, darkStem);
    const groundRoot = bezier(pointAt(bough, 0.88), { x: 170, y: 170 }, { x: 138, y: 225 }, { x: 130, y: 270 });
    trace(context, groundRoot, childProgress(growth, 0.88), 2.8, darkStem);
    hangingBranches.forEach((branch, index) => trace(context, branch, childProgress(growth, branchAttachments[index]!), 2.5));
    hangingBranches.forEach((branch, branchIndex) => {
      const branchProgress = childProgress(growth, branchAttachments[branchIndex]!);
      [0.38, 1].forEach((attachment, leafIndex) => {
        const anchor = pointAt(branch, attachment === 1 ? branchProgress : attachment);
        unfurl(context, art, 'ginkgo', anchor, 90 - leafIndex * 6, 80 - leafIndex * 5, leafIndex ? -0.26 : 0.2, attachment === 1 ? childProgress(branchProgress, .48) : localLeafProgress(branchProgress, attachment, 0.08 + branchIndex * 0.04), true);
      });
    });
  } else if (theme === 'invest') {
    // The generated fern already contains each frond's rachis, so no bare rods are added.
    const fronds = [
      { anchor: { x: 150, y: 270 }, width: 112, height: 202, angle: -0.34 },
      { anchor: { x: 355, y: 270 }, width: 104, height: 190, angle: 0.02 },
      { anchor: { x: 555, y: 270 }, width: 92, height: 176, angle: 0.3 },
    ];
    fronds.forEach(({ anchor }, index) => soilIsland(context, anchor.x, anchor.y, 112 - index * 10, growth));
    fronds.forEach((frond, index) => unfurl(context, art, 'fern', frond.anchor, frond.width, frond.height, frond.angle, childProgress(growth, index * 0.08)));
  } else if (theme === 'chores') {
    // Short soil islands keep this a clustered garden rather than a row of lollipops.
    const plants = [
      { x: 130, y: 270, width: 177, height: 136, angle: -0.2 },
      { x: 174, y: 270, width: 161, height: 124, angle: 0.16 },
      { x: 276, y: 270, width: 195, height: 150, angle: -0.08 },
      { x: 370, y: 270, width: 172, height: 132, angle: 0.22 },
      { x: 468, y: 270, width: 189, height: 145, angle: -0.18 },
      { x: 560, y: 270, width: 164, height: 126, angle: 0.16 },
      { x: 620, y: 270, width: 195, height: 150, angle: -0.04 },
    ];
    const islands: Array<[number, number, number]> = [[152, 270, 112], [324, 270, 104], [514, 270, 124], [628, 270, 108]];
    islands.forEach(([x, y, islandWidth]) => soilIsland(context, x, y, islandWidth, growth));
    plants.forEach((plant, index) => unfurl(context, art, 'seedling', { x: plant.x, y: plant.y }, plant.width, plant.height, plant.angle, (growth - index * 0.07) / 0.62));
  } else if (theme === 'gifts') {
    // A loose upper garland with uneven downward tails, leaving the centre open.
    const garland = bezier({ x: 18, y: 58 }, { x: 172, y: 23 }, { x: 348, y: 72 }, { x: 704, y: 42 }, 64);
    const tails = [
      bezier(pointAt(garland, 0.2), { x: 162, y: 80 }, { x: 154, y: 125 }, { x: 150, y: 174 }),
      bezier(pointAt(garland, 0.44), { x: 314, y: 86 }, { x: 302, y: 122 }, { x: 315, y: 176 }),
      bezier(pointAt(garland, 0.68), { x: 488, y: 88 }, { x: 506, y: 130 }, { x: 494, y: 180 }),
      bezier(pointAt(garland, 0.88), { x: 625, y: 78 }, { x: 644, y: 126 }, { x: 628, y: 165 }),
    ];
    const tailAttachments = [0.2, 0.44, 0.68, 0.88];
    trace(context, garland, growth, 2.8, darkStem);
    tails.forEach((tail, index) => trace(context, tail, childProgress(growth, tailAttachments[index]!), 2.4));
    tails.forEach((tail, index) => {
      const tailProgress = childProgress(growth, tailAttachments[index]!);
      unfurl(context, art, 'berries', pointAt(tail, tailProgress), 80 - index * 4, 74 - index * 4, index % 2 ? -0.12 : 0.16, childProgress(tailProgress, 0.68), true);
    });
    [0.08, 0.31, 0.57, 0.83].forEach((attachment, index) => unfurl(context, art, 'berries', pointAt(garland, attachment), 62, 57, index % 2 ? 0.15 : -0.12, localLeafProgress(growth, attachment, 0.36 + index * 0.04), true));
  } else if (theme === 'graduation') {
    // One organic oak rises from the low-right and branches diagonally toward centre.
    const trunk = bezier({ x: 603, y: 270 }, { x: 585, y: 228 }, { x: 491, y: 174 }, { x: 410, y: 106 }, 56);
    const branches = [
      bezier(pointAt(trunk, 0.3), { x: 575, y: 192 }, { x: 595, y: 180 }, { x: 605, y: 170 }),
      bezier(pointAt(trunk, 0.53), { x: 495, y: 150 }, { x: 485, y: 133 }, { x: 475, y: 120 }),
      bezier(pointAt(trunk, 0.72), { x: 420, y: 130 }, { x: 370, y: 118 }, { x: 330, y: 115 }),
      bezier(pointAt(trunk, 0.84), { x: 370, y: 130 }, { x: 270, y: 170 }, { x: 200, y: 180 }),
    ];
    const branchAttachments = [0.3, 0.53, 0.72, 0.84];
    trace(context, trunk, growth, 3.6, darkStem);
    branches.forEach((branch, index) => trace(context, branch, childProgress(growth, branchAttachments[index]!), 2.5));
    branches.forEach((branch, branchIndex) => {
      const branchProgress = childProgress(growth, branchAttachments[branchIndex]!);
      const leafHeads: Array<[number, number]> = [[78, 88], [74, 84], [76, 86], [72, 78]];
      const [leafWidth, leafHeight] = leafHeads[branchIndex]!;
      const anchor = pointAt(branch, branchProgress);
      unfurl(context, art, 'oak', anchor, leafWidth, leafHeight, branchIndex % 2 ? -0.3 : 0.24, childProgress(branchProgress, 0.42));
    });
    unfurl(context, art, 'butterfly-new', { x: 260, y: 58 }, 52, 38, -0.18, (growth - 0.6) / 0.32);
    unfurl(context, art, 'butterfly-new', { x: 690, y: 60 }, 44, 32, 0.2, (growth - 0.78) / 0.22);
  }

  context.restore();
}
