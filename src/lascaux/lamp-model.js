import {
  BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, Group,
  Mesh, MeshBasicMaterial, TubeGeometry, Vector3
} from 'three';

// Approximate geometry drawn from the Musée national de Préhistoire
// catalogue photograph and the recorded dimensions of MAN 83461.
// https://musee-prehistoire-eyzies.fr/collection/objet/lampe-bruloir
export const LAMP_DIMENSIONS_METRES = Object.freeze({
  length: 0.224, width: 0.106, thickness: 0.032
});

const front = -0.065;
const tail = front + LAMP_DIMENSIONS_METRES.length;
const bowlCentre = -0.014;
const outline = [
  [front, 0.00018], [-0.063, 0.010], [-0.058, 0.024], [-0.047, 0.038],
  [-0.032, 0.048], [-0.014, 0.053], [0.005, 0.052], [0.022, 0.044],
  [0.038, 0.035], [0.055, 0.028], [0.080, 0.024], [0.107, 0.024],
  [0.131, 0.025], [0.147, 0.023], [0.154, 0.017], [0.157, 0.010],
  [tail, 0.00018]
];

// The grooves describe the documented design, not a tracing of the artefact.
const cuts = [
  [[-0.002, 0.033], [0.003, 0.146]],
  [[-0.021, 0.052], [-0.009, 0.067]], [[-0.009, 0.067], [-0.017, 0.077]],
  [[-0.021, 0.064], [-0.011, 0.079]], [[-0.011, 0.079], [-0.019, 0.088]],
  [[0.020, 0.093], [0.010, 0.107]], [[0.010, 0.107], [0.018, 0.117]],
  [[0.020, 0.108], [0.009, 0.122]], [[0.009, 0.122], [0.017, 0.131]]
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, weight) => from + (to - from) * weight;
const smooth = (min, max, value) => {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};

function stoneNoise(x, z, frequency) {
  const px = x * frequency;
  const pz = z * frequency;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const sample = (i, j) => {
    let value = Math.imul(i + 12389, 374761393) + Math.imul(j + 6491, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const tx = smooth(0, 1, px - ix);
  const tz = smooth(0, 1, pz - iz);
  return mix(mix(sample(ix, iz), sample(ix + 1, iz), tx),
    mix(sample(ix, iz + 1), sample(ix + 1, iz + 1), tx), tz);
}

function halfWidth(z) {
  if (z >= tail) return outline.at(-1)[1];
  const index = clamp(outline.findIndex(([at]) => at >= z) - 1, 0, outline.length - 2);
  const [z0, width0] = outline[index];
  const [z1, width1] = outline[index + 1];
  const before = outline[Math.max(0, index - 1)];
  const after = outline[Math.min(outline.length - 1, index + 2)];
  const span = z1 - z0;
  const t = clamp((z - z0) / span, 0, 1);
  const delta0 = span * (width1 - before[1]) / (z1 - before[0]);
  const delta1 = span * (after[1] - width0) / (after[0] - z0);
  return mix(width0, width1, t * t * (3 - 2 * t)) +
    t * (1 - t) * ((1 - t) * delta0 - t * delta1);
}

function bowlRadius(x, z) {
  return Math.hypot((x + 0.0006) / 0.0415, (z - bowlCentre) / 0.0445);
}

function groove(x, z) {
  if (z < 0.030) return 0;
  let distance = Infinity;
  for (const [[ax, az], [bx, bz]] of cuts) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return 1 - smooth(0, 0.0018, distance);
}

function createStone() {
  const rings = 124;
  const sides = 64;
  const positions = [];
  const colours = [];
  const indices = [];
  for (let i = 0; i <= rings; i++) {
    const z = mix(front, tail, i / rings);
    const width = halfWidth(z);
    const edge = Math.min(smooth(front, front + 0.011, z), 1 - smooth(tail - 0.010, tail, z));
    const handle = smooth(0.020, 0.089, z);
    const middle = mix(-0.024, -0.019, handle);
    const thickness = mix(0.032, 0.013, handle) * mix(0.025, 1, edge);
    for (let j = 0; j < sides; j++) {
      const angle = 2 * Math.PI * j / sides;
      const lateral = Math.cos(angle);
      const upper = j <= sides / 2;
      const asymmetry = 0.0017 * Math.sin(26 * z + 0.6) +
        lateral * edge * (0.00055 * Math.sin(231 * z) + 0.00028 * Math.sin(433 * z + 2));
      const x = lateral * width + asymmetry;
      const round = Math.sqrt(Math.max(0, 1 - lateral * lateral));
      const face = upper ? 1 - smooth(0.86, 1, Math.abs(lateral)) : round;
      const cavity = upper ? Math.max(0, 1 - bowlRadius(x, z) ** 2) ** 1.14 : 0;
      const grain = edge * face * 0.00032 * (stoneNoise(x, z, 180) - 0.5);
      const carve = upper ? groove(x, z) * face : 0;
      const y = middle + (upper ? 1 : -1) * thickness * 0.5 * face -
        cavity * 0.017 - carve * 0.00075 + grain;
      positions.push(x, y, z);
      colours.push([cavity, carve, upper]);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + (j + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  for (const [ring, reversed] of [[0, true], [rings, false]]) {
    const first = ring * sides;
    const centre = positions.length / 3;
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < sides; j++) {
      cx += positions[(first + j) * 3];
      cy += positions[(first + j) * 3 + 1];
    }
    positions.push(cx / sides, cy / sides, positions[first * 3 + 2]);
    colours.push([0, 0, false]);
    for (let j = 0; j < sides; j++) {
      const a = first + j;
      const b = first + (j + 1) % sides;
      indices.push(centre, reversed ? b : a, reversed ? a : b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  geometry.scale(LAMP_DIMENSIONS_METRES.width / (max.x - min.x),
    LAMP_DIMENSIONS_METRES.thickness / (max.y - min.y), 1);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const point = geometry.getAttribute('position');
  const rgb = [];
  const sandstone = new Color(0xa8735d);
  const warmBand = new Color(0xba8168);
  const recess = new Color(0x704532);
  const smoke = new Color(0x54423a);
  const colour = new Color();
  for (let i = 0; i < point.count; i++) {
    const [cavity, carve, upper] = colours[i];
    const x = point.getX(i);
    const z = point.getZ(i);
    const grain = stoneNoise(x, z, 690);
    const band = stoneNoise(x, z, 31);
    const patina = (1 - smooth(front + 0.007, front + 0.023, z)) *
      (0.28 + 0.25 * (0.5 + 0.5 * Math.sin(105 * x + 1.7)));
    const shade = clamp(0.66 + 0.29 * normal.getY(i) - 0.13 * normal.getX(i) -
      0.13 * normal.getZ(i), 0.36, 1.1);
    colour.copy(sandstone).lerp(warmBand, 0.14 + 0.32 * band + 0.17 * grain);
    if (upper) colour.lerp(recess, 0.65 * cavity + 0.40 * carve);
    colour.lerp(smoke, patina).multiplyScalar(shade * (0.92 + 0.15 * grain));
    rgb.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(rgb, 3));
  const stone = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
  stone.name = 'Sandstone body';
  return stone;
}

function createFuel() {
  const positions = [0, -0.0215, bowlCentre];
  const colours = [];
  const indices = [];
  const centre = new Color(0x956338);
  const edge = new Color(0x745034);
  colours.push(centre.r, centre.g, centre.b);
  for (let i = 0; i < 40; i++) {
    const angle = i / 40 * Math.PI * 2;
    const contour = 1 + 0.06 * Math.sin(3 * angle + 1.2) + 0.03 * Math.cos(5 * angle);
    positions.push(0.022 * Math.cos(angle) * contour, -0.0216,
      bowlCentre + 0.023 * Math.sin(angle) * contour);
    colours.push(edge.r, edge.g, edge.b);
    indices.push(0, 1 + (i + 1) % 40, 1 + i);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  const grease = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
  grease.name = 'Illustrative grease';
  return grease;
}

function createWick() {
  const curve = new CatmullRomCurve3([
    new Vector3(0.007, -0.023, -0.013),
    new Vector3(0.004, -0.017, -0.008),
    new Vector3(0.0005, -0.009, -0.002),
    new Vector3(0, 0, 0)
  ]);
  const geometry = new TubeGeometry(curve, 12, 0.0019, 6, false);
  const positions = geometry.getAttribute('position');
  // Close the tip at the light origin instead of extending it past the origin.
  for (let i = positions.count - 7; i < positions.count; i++) positions.setXYZ(i, 0, 0, 0);
  const wick = new Mesh(geometry, new MeshBasicMaterial({ color: 0x38261c }));
  wick.name = 'Illustrative wick';
  return wick;
}

/** Y up, handle along +Z. The illustrated wick tip is the light origin. */
export function createLascauxLamp({ fuel = true } = {}) {
  const lamp = new Group();
  lamp.name = 'Lascaux-style grease lamp';
  lamp.add(createStone());
  if (fuel) lamp.add(createFuel(), createWick());
  return lamp;
}
