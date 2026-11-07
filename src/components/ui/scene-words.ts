import * as THREE from 'three';
import { DRONE_SPAN, PROP_PLANE_HEIGHT, makeRadialTexture } from './drone-model';

/**
 * Giant 3D section titles that live inside the scene so the drone can physically
 * interact with them: slice through them, scan them in, burst through them, orbit them.
 * Every effect is driven by scroll progress, so scrolling back up rewinds it.
 */

export type WordEffect = 'slice' | 'scan' | 'burst' | 'orbit';

export interface WordFrame {
  /** Eased arrival progress for this section's flight (0 → 1, stays 1 once arrived). */
  e: number;
  /** 0 → 1 as the section scrolls in. */
  enter: number;
  /** 0 → 1 as the section scrolls out. */
  exit: number;
  time: number;
  drone: THREE.Vector3;
  droneScale: number;
  glow: THREE.Color;
  /** World position of the drone's camera gimbal. */
  gimbal: THREE.Vector3;
}

export interface WordFrameResult {
  /** Telemetry status while the effect is happening (e.g. "CUTTING"). */
  status: string | null;
  /** Point the drone's camera should look at, if any. */
  aim: THREE.Vector3 | null;
  aimWeight: number;
}

const PATH_SAMPLES = 400;
/** Slightly below white so the words stay under the bloom threshold and read crisp. */
const WORD_COLOR = 0xe6e6e6;
const NONE: WordFrameResult = { status: null, aim: null, aimWeight: 0 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const dotTexture = () =>
  makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']], 64);

function nearestIndex(points: THREE.Vector3[], target: THREE.Vector3) {
  let best = 0;
  let bestDist = Infinity;
  points.forEach((p, i) => {
    const d = p.distanceToSquared(target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Renders the title tightly cropped to its cap height on a canvas. */
function drawWord(text: string) {
  const fontPx = 240;
  const font = `800 ${fontPx}px Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const chars = Array.from(text);
  const spacing = fontPx * 0.06;
  const advances = chars.map((c) => measure.measureText(c).width);
  const metrics = measure.measureText(text);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent);
  const pad = Math.round(fontPx * 0.08);

  const canvas = document.createElement('canvas');
  canvas.width = Math.min(4096, Math.ceil(advances.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1) + pad * 2));
  canvas.height = ascent + descent + pad * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  let x = pad;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, pad + ascent);
    x += advances[i] + spacing;
  });
  return canvas;
}

export abstract class WordFx {
  /** Positioned at the word centre and scaled so the word is 1 unit wide in local space. */
  readonly group = new THREE.Group();
  /** Carries the enter / exit motion. */
  protected readonly inner = new THREE.Group();
  protected readonly canvas: HTMLCanvasElement;
  protected readonly texture: THREE.CanvasTexture;
  /** Word height when its width is 1. */
  protected readonly unitHeight: number;
  protected readonly center = new THREE.Vector3();
  protected width = 1;
  protected readonly tmp = new THREE.Vector3();
  protected readonly aimPoint = new THREE.Vector3();

  constructor(text: string) {
    this.canvas = drawWord(text);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.unitHeight = this.canvas.height / this.canvas.width;
    this.group.add(this.inner);
    this.group.visible = false;
  }

  get height() {
    return this.width * this.unitHeight;
  }

  place(center: THREE.Vector3, width: number) {
    this.center.copy(center);
    this.width = width;
    this.group.position.copy(center);
    this.group.scale.setScalar(width);
  }

  /** Extra points the drone flies through between the previous stop and this section's stop. */
  abstract waypoints(from: THREE.Vector3, to: THREE.Vector3, droneScale: number): THREE.Vector3[];
  /** Pre-computes where along the flight path the drone meets the word. */
  abstract bindPath(curve: THREE.Curve<THREE.Vector3>, droneScale: number): void;
  abstract update(frame: WordFrame): WordFrameResult;

  protected toLocal(world: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(world).sub(this.center).divideScalar(this.width);
  }

  protected toWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).multiplyScalar(this.width).add(this.center);
  }

  /** Rises in from below / behind, then lifts away on exit. Returns 0..1 visibility. */
  protected visibility(frame: WordFrame) {
    const vis = frame.enter * (1 - frame.exit);
    this.group.visible = vis > 0.002;
    this.inner.position.set(
      0,
      -0.04 * (1 - frame.enter) + 0.06 * frame.exit,
      -0.12 * (1 - frame.enter) - 0.04 * frame.exit,
    );
    return vis;
  }

  protected wordMaterial() {
    return new THREE.MeshBasicMaterial({
      map: this.texture,
      color: WORD_COLOR,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Slice: the propellers cut every letter in half as the drone sweeps  */
/* ------------------------------------------------------------------ */

const CUT = 0.54; // cut line, as a fraction of the word height from the bottom
const STRIPS = 40;
const SPARKS = 140;

interface Strip {
  top: THREE.Mesh;
  bottom: THREE.Mesh;
  topBase: THREE.Vector3;
  bottomBase: THREE.Vector3;
  x: number;
  seed: number;
  eCut: number;
}

export class SliceWord extends WordFx {
  private readonly material: THREE.MeshBasicMaterial;
  private readonly strips: Strip[] = [];
  private readonly seam: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly sparkSeeds = new Float32Array(SPARKS * 4);
  private readonly sweepStart = new THREE.Vector3();
  private eStart = 2;
  private eEnd = 2;
  private lead = 0;

  constructor(text: string) {
    super(text);
    this.material = this.wordMaterial();

    // Each letter column is split into a top and bottom piece along the cut line
    for (let k = 0; k < STRIPS; k++) {
      const u0 = k / STRIPS;
      const u1 = (k + 1) / STRIPS;
      const top = this.piece(u0, u1, CUT, 1);
      const bottom = this.piece(u0, u1, 0, CUT);
      this.strips.push({
        top: top.mesh,
        bottom: bottom.mesh,
        topBase: top.base,
        bottomBase: bottom.base,
        x: (u0 + u1) / 2 - 0.5,
        seed: Math.random(),
        eCut: 2,
      });
    }

    this.seam = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.004),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    this.seam.position.set(0, (CUT - 0.5) * this.unitHeight, 0.002);
    this.inner.add(this.seam);

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sparkGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    for (let i = 0; i < SPARKS; i++) {
      this.sparkSeeds[i * 4] = Math.random(); // phase
      this.sparkSeeds[i * 4 + 1] = -(0.01 + Math.random() * 0.05); // thrown back, away from travel
      this.sparkSeeds[i * 4 + 2] = (Math.random() - 0.4) * 0.07;
      this.sparkSeeds[i * 4 + 3] = (Math.random() - 0.5) * 0.04;
    }
    this.sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({
        size: 0.07, map: dotTexture(), vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  private piece(u0: number, u1: number, v0: number, v1: number) {
    const h = this.unitHeight;
    const geometry = new THREE.PlaneGeometry(u1 - u0, (v1 - v0) * h);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    const mesh = new THREE.Mesh(geometry, this.material);
    const base = v3((u0 + u1) / 2 - 0.5, ((v0 + v1) / 2 - 0.5) * h, 0);
    mesh.position.copy(base);
    this.inner.add(mesh);
    return { mesh, base };
  }

  waypoints(_from: THREE.Vector3, _to: THREE.Vector3, droneScale: number) {
    // Fly so the propeller disc runs exactly along the cut line
    const y = this.center.y + (CUT - 0.5) * this.height - PROP_PLANE_HEIGHT * droneScale;
    const z = this.center.z;
    const left = this.center.x - this.width / 2;
    const right = this.center.x + this.width / 2;
    this.sweepStart.set(left - 1, y, z);
    return [v3(left - 1.8, y + 0.2, z), this.sweepStart.clone(), v3(right + 0.4, y, z), v3(right + 1.6, y + 0.4, z + 0.3)];
  }

  bindPath(curve: THREE.Curve<THREE.Vector3>, droneScale: number) {
    const points = curve.getSpacedPoints(PATH_SAMPLES);
    const startIdx = nearestIndex(points, this.sweepStart);
    this.lead = DRONE_SPAN * droneScale * 0.2; // leading propeller reaches the letters first
    this.eStart = 2;
    this.eEnd = -1;
    for (const strip of this.strips) {
      const worldX = this.center.x + strip.x * this.width;
      strip.eCut = 2;
      for (let i = startIdx; i <= PATH_SAMPLES; i++) {
        if (points[i].x + this.lead >= worldX) {
          strip.eCut = i / PATH_SAMPLES;
          break;
        }
      }
      if (strip.eCut <= 1) {
        this.eStart = Math.min(this.eStart, strip.eCut);
        this.eEnd = Math.max(this.eEnd, strip.eCut);
      }
    }
    if (this.eEnd < 0) this.eEnd = 2;
  }

  update(frame: WordFrame): WordFrameResult {
    const vis = this.visibility(frame);
    if (!this.group.visible) return NONE;
    const { e, time } = frame;
    const h = this.unitHeight;
    this.material.opacity = vis;

    for (const strip of this.strips) {
      const s = smoothstep(strip.eCut, strip.eCut + 0.08, e);
      const wobble = Math.sin(time * 0.8 + strip.seed * 9) * 0.003 * s;
      strip.top.position.set(strip.topBase.x + 0.025 * s, strip.topBase.y + 0.32 * h * s + wobble, -0.04 * s);
      strip.top.rotation.z = (0.02 + strip.seed * 0.05) * s;
      strip.bottom.position.set(strip.bottomBase.x - 0.01 * s, strip.bottomBase.y - 0.18 * h * s - wobble, 0.025 * s);
      strip.bottom.rotation.z = -(0.01 + strip.seed * 0.03) * s;
    }

    // Glowing seam grows behind the drone, then fades
    const progress = clamp((e - this.eStart) / Math.max(1e-3, this.eEnd - this.eStart), 0, 1);
    this.seam.scale.x = Math.max(progress, 1e-3);
    this.seam.position.x = -0.5 + progress / 2;
    this.seam.material.color.copy(frame.glow);
    this.seam.material.opacity = vis * (progress > 0 ? 1 : 0) * (1 - smoothstep(this.eEnd, this.eEnd + 0.15, e));

    // Sparks where the propellers meet the letters
    const cutting = smoothstep(this.eStart - 0.01, this.eStart, e) * (1 - smoothstep(this.eEnd, this.eEnd + 0.03, e));
    const ex = clamp((frame.drone.x + this.lead - this.center.x) / this.width, -0.5, 0.5);
    const ey = (CUT - 0.5) * h;
    const positions = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    const colors = this.sparks.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      const age = (time * 1.8 + this.sparkSeeds[i * 4]) % 1;
      positions.setXYZ(
        i,
        ex + this.sparkSeeds[i * 4 + 1] * age,
        ey + this.sparkSeeds[i * 4 + 2] * age - 0.05 * age * age,
        0.01 + this.sparkSeeds[i * 4 + 3] * age,
      );
      const k = (1 - age) * cutting * vis;
      colors.setXYZ(i, k, k * 0.7, k * 0.4);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;

    return {
      status: cutting > 0.5 ? 'CUTTING' : null,
      aim: this.toWorld(this.tmp.set(ex, ey, 0), this.aimPoint),
      aimWeight: cutting,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Scan: the gimbal camera projects a beam that writes the word in     */
/* ------------------------------------------------------------------ */

const SCAN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SCAN_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float uReveal;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uActive;
  uniform vec3 uGlow;
  varying vec2 vUv;

  void main() {
    float a = texture2D(map, vUv).a;
    float d = uReveal - vUv.x;
    float revealed = smoothstep(-0.002, 0.002, d);
    float scanlines = 0.8 + 0.2 * sin(vUv.y * 380.0 - uTime * 5.0);
    float flicker = 0.94 + 0.06 * sin(uTime * 37.0 + vUv.y * 12.0);
    float band = (1.0 - smoothstep(0.0, 0.08, abs(d))) * uActive;
    float line = (1.0 - smoothstep(0.0, 0.0025, abs(d))) * uActive;

    vec3 color = mix(vec3(0.82, 0.9, 1.0), uGlow * 2.2, band * 0.85);
    float alpha = a * (mix(0.07, scanlines * flicker, revealed) + band * 0.6);
    alpha = max(alpha, line * 0.9);
    color = mix(color, uGlow * 3.0, line);
    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`;

export class ScanWord extends WordFx {
  private readonly material: THREE.ShaderMaterial;
  private readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly entry = new THREE.Vector3();
  private eStart = 2;

  constructor(text: string) {
    super(text);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        uReveal: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uActive: { value: 0 },
        uGlow: { value: new THREE.Color() },
      },
      vertexShader: SCAN_VERTEX,
      fragmentShader: SCAN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.inner.add(new THREE.Mesh(new THREE.PlaneGeometry(1, this.unitHeight), this.material));

    const beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    beamGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18]), 3));
    this.beam = new THREE.Mesh(
      beamGeometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.beam.frustumCulled = false;
    this.group.add(this.beam);
  }

  waypoints(_from: THREE.Vector3, to: THREE.Vector3) {
    // Approach above the left end of the word, then glide right while scanning
    this.entry.set(this.center.x - this.width * 0.42, to.y + 0.15, to.z);
    return [this.entry.clone()];
  }

  bindPath(curve: THREE.Curve<THREE.Vector3>) {
    this.eStart = nearestIndex(curve.getSpacedPoints(PATH_SAMPLES), this.entry) / PATH_SAMPLES;
  }

  update(frame: WordFrame): WordFrameResult {
    const vis = this.visibility(frame);
    if (!this.group.visible) return NONE;
    const reveal = clamp((frame.e - this.eStart) / Math.max(1e-3, 1 - this.eStart), 0, 1);
    const active = smoothstep(0, 0.02, reveal) * (1 - smoothstep(0.97, 1, reveal));

    const u = this.material.uniforms;
    u.uReveal.value = reveal;
    u.uOpacity.value = vis;
    u.uTime.value = frame.time;
    u.uActive.value = active;
    (u.uGlow.value as THREE.Color).copy(frame.glow);

    // Beam from the camera lens to the scan line
    const x = -0.5 + reveal;
    const half = this.unitHeight * 0.48;
    const positions = this.beam.geometry.attributes.position as THREE.BufferAttribute;
    this.toLocal(frame.gimbal, this.tmp);
    positions.setXYZ(0, this.tmp.x, this.tmp.y, this.tmp.z);
    positions.setXYZ(1, x, half, 0.002);
    positions.setXYZ(2, x, -half, 0.002);
    positions.needsUpdate = true;
    this.beam.material.color.copy(frame.glow);
    this.beam.material.opacity = 0.55 * active * vis;

    return {
      status: active > 0.05 ? 'SCANNING' : null,
      aim: this.toWorld(this.tmp.set(x, 0, 0), this.aimPoint),
      aimWeight: active,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Burst: the drone smashes through and the word shatters into dust    */
/* ------------------------------------------------------------------ */

export class BurstWord extends WordFx {
  private readonly planeMaterial: THREE.MeshBasicMaterial;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly home: Float32Array;
  private readonly velocity: Float32Array;
  private readonly seeds: Float32Array;
  private readonly flash: THREE.Sprite;
  private readonly hit = new THREE.Vector3();
  private readonly hitWaypoint = new THREE.Vector3();
  private eHit = 2;

  constructor(text: string) {
    super(text);
    this.planeMaterial = this.wordMaterial();
    this.inner.add(new THREE.Mesh(new THREE.PlaneGeometry(1, this.unitHeight), this.planeMaterial));

    // Sample the word's pixels into particles (~9k)
    const { width: W, height: H } = this.canvas;
    const data = this.canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 128) opaque++;
    const step = Math.max(2, Math.ceil(Math.sqrt(opaque / 9000)));
    const home: number[] = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        if (data[(y * W + x) * 4 + 3] > 128) home.push(x / W - 0.5, (0.5 - y / H) * this.unitHeight, 0);
      }
    }
    this.home = new Float32Array(home);
    const count = this.home.length / 3;
    this.velocity = new Float32Array(count * 3);
    this.seeds = new Float32Array(count).map(() => Math.random());

    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const ember = Math.random() < 0.22;
      colors.set(ember ? [1, 0.55, 0.25] : [0.8, 0.8, 0.84], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.home.slice(), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.05, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0,
        depthWrite: false, fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.inner.add(this.points);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,200,150,0.6)'], [1, 'rgba(255,120,40,0)']], 128),
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    this.inner.add(this.flash);
  }

  waypoints(_from: THREE.Vector3, _to: THREE.Vector3, droneScale: number) {
    // Come up from behind the word, punch through it, swoop toward the camera
    const { x, y: cy, z } = this.center;
    const y = cy - 0.25 * droneScale;
    this.hitWaypoint.set(x + this.width * 0.06, y, z);
    return [v3(x + this.width * 0.18, y + 0.5, z - 5), this.hitWaypoint.clone(), v3(x - this.width * 0.1, y - 0.5, z + 4.2)];
  }

  bindPath(curve: THREE.Curve<THREE.Vector3>) {
    const points = curve.getSpacedPoints(PATH_SAMPLES);
    let idx = points.findIndex((p, i) => i > 0 && points[i - 1].z < this.center.z && p.z >= this.center.z);
    if (idx < 0) idx = nearestIndex(points, this.hitWaypoint);
    this.eHit = idx / PATH_SAMPLES;
    this.toLocal(points[idx], this.hit);
    this.flash.position.set(this.hit.x, this.hit.y, 0.01);

    // Blast pattern: particles near the impact fly fastest, everything is thrown toward the camera
    for (let i = 0; i < this.seeds.length; i++) {
      const dx = this.home[i * 3] - this.hit.x;
      const dy = this.home[i * 3 + 1] - this.hit.y;
      const r = Math.hypot(dx, dy) + 1e-4;
      const near = 1.25 - Math.min(r, 0.6);
      const push = (0.04 + Math.random() * 0.22) * near;
      this.velocity[i * 3] = (dx / r) * push;
      this.velocity[i * 3 + 1] = (dy / r) * push * 1.4 - 0.02;
      this.velocity[i * 3 + 2] = (0.03 + Math.random() * 0.32) * near;
    }
  }

  update(frame: WordFrame): WordFrameResult {
    const vis = this.visibility(frame);
    if (!this.group.visible) return NONE;
    const { e, time } = frame;
    const broken = e >= this.eHit;
    const s = clamp((e - this.eHit) / 0.5, 0, 1);
    const d = 1 - (1 - s) ** 3;

    this.planeMaterial.opacity = broken ? 0 : vis;
    this.points.visible = broken;
    if (broken) {
      const positions = this.points.geometry.attributes.position as THREE.BufferAttribute;
      const arr = positions.array as Float32Array;
      for (let i = 0; i < this.seeds.length; i++) {
        const seed = this.seeds[i] * 20;
        arr[i * 3] = this.home[i * 3] + this.velocity[i * 3] * d + Math.sin(time * 0.7 + seed) * 0.006 * d;
        arr[i * 3 + 1] = this.home[i * 3 + 1] + this.velocity[i * 3 + 1] * d + Math.cos(time * 0.6 + seed) * 0.004 * d;
        arr[i * 3 + 2] = this.velocity[i * 3 + 2] * d;
      }
      positions.needsUpdate = true;
      this.points.material.opacity = vis * (1 - 0.45 * d);
    }

    const flash = broken ? 1 - smoothstep(0, 0.12, e - this.eHit) : 0;
    this.flash.material.opacity = flash * vis;
    this.flash.scale.setScalar(0.08 + 0.35 * (1 - flash));

    return { status: Math.abs(e - this.eHit) < 0.06 ? 'BREACH' : null, aim: null, aimWeight: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Orbit: the drone circles the word, passing behind the letters       */
/* ------------------------------------------------------------------ */

export class OrbitWord extends WordFx {
  private readonly material: THREE.MeshBasicMaterial;
  private readonly first = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private orbitStart = 2;
  private orbitEnd = 2;

  constructor(text: string) {
    super(text);
    this.material = this.wordMaterial();
    this.inner.add(new THREE.Mesh(new THREE.PlaneGeometry(1, this.unitHeight), this.material));
  }

  waypoints(_from: THREE.Vector3, _to: THREE.Vector3, droneScale: number) {
    const { x, y: cy, z } = this.center;
    const rx = this.width * 0.58;
    const rz = 2.8;
    const y = cy - 0.35 * droneScale;
    this.first.set(x - rx, y + 0.3, z + 0.5);
    this.last.set(x, y - 0.25, z + rz);
    return [
      this.first.clone(),
      v3(x - rx * 0.55, y + 0.2, z - rz),
      v3(x + rx * 0.55, y + 0.1, z - rz),
      v3(x + rx, y, z + 0.5),
      this.last.clone(),
    ];
  }

  bindPath(curve: THREE.Curve<THREE.Vector3>) {
    const points = curve.getSpacedPoints(PATH_SAMPLES);
    this.orbitStart = nearestIndex(points, this.first) / PATH_SAMPLES;
    this.orbitEnd = nearestIndex(points, this.last) / PATH_SAMPLES;
  }

  update(frame: WordFrame): WordFrameResult {
    const vis = this.visibility(frame);
    if (!this.group.visible) return NONE;
    this.material.opacity = vis;
    const orbiting =
      smoothstep(this.orbitStart - 0.05, this.orbitStart, frame.e) *
      (1 - smoothstep(this.orbitEnd, this.orbitEnd + 0.08, frame.e));
    return {
      status: orbiting > 0.5 ? 'ORBITING' : null,
      aim: this.aimPoint.copy(this.center),
      aimWeight: orbiting * 0.8,
    };
  }
}

export function createWord(text: string, effect: WordEffect): WordFx {
  switch (effect) {
    case 'slice':
      return new SliceWord(text);
    case 'scan':
      return new ScanWord(text);
    case 'burst':
      return new BurstWord(text);
    case 'orbit':
      return new OrbitWord(text);
  }
}
