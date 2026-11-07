import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUp } from 'lucide-react';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cn } from '@/lib/utils';
import droneFallback from '@/public/drone nobr.png';
import {
  createDrone,
  createLandingPad,
  DRONE_SPAN,
  LANDING_GEAR_DEPTH,
  makeRadialTexture,
  PROP_RADIUS,
} from './drone-model';
import { createWord, type WordEffect, type WordFrame, type WordFx } from './scene-words';

gsap.registerPlugin(ScrollTrigger);

/* ------------------------------------------------------------------ */
/* Flight plan                                                          */
/* ------------------------------------------------------------------ */

/** Where the HTML text sits. The drone takes the other side / half. */
type TextLayout = 'left' | 'right' | 'center-bottom' | 'center-top';

/** How the drone travels INTO a section. */
interface Maneuver {
  /** Height gained (negative = dip) mid-flight. Ignored when the section's word defines a path. */
  arcY?: number;
  /** Distance pulled back into the scene mid-flight (negative = swoops toward the camera). */
  arcZ?: number;
  /** Full 360° yaw turns. */
  spins?: number;
  /** Full barrel rolls around the direction of travel. */
  rolls?: number;
  /** Full front flips. */
  flips?: number;
  /** Part of the flight (0–1) where rolls / flips happen. */
  trick?: [number, number];
}

interface SectionDef {
  id: string;
  title: string;
  lines: string[];
  text: TextLayout;
  /** Desktop stop: x / y as a fraction of half the viewport, z in world units, yaw in radians. */
  drone: { x: number; y: number; z?: number; yaw: number };
  /** Stacked (mobile / tablet) stop height as a fraction of half the viewport. */
  droneMobileY?: number;
  camera?: { y?: number; z?: number };
  /** Halo / rim-light colour for this section. */
  glow: number;
  maneuver?: Maneuver;
  /** Render the title as a giant 3D word the drone interacts with. */
  word?: { effect: WordEffect; y: number; mobileY?: number };
  stats?: Array<{ value: number; unit: string; label: string }>;
  cta?: boolean;
  /** Final section only: the drone touches down on a landing pad. */
  landing?: boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'horizon',
    title: 'HORIZON',
    lines: ['Where vision meets reality,', 'we shape the future of tomorrow'],
    text: 'left',
    drone: { x: 0.46, y: -0.03, yaw: -0.55 },
    glow: 0xff6a20,
  },
  {
    id: 'cosmos',
    title: 'COSMOS',
    lines: ['Beyond the boundaries of imagination,', 'lies the universe of possibilities'],
    text: 'right',
    drone: { x: -0.46, y: 0.02, yaw: 0.5 },
    glow: 0xff3d6e,
    maneuver: { arcY: 1.4, arcZ: 4, spins: 1 },
  },
  {
    id: 'precision',
    title: 'PRECISION',
    lines: ['Six rotors, one perfectly steady eye —', 'stabilised to the millimetre in any wind'],
    text: 'center-bottom',
    drone: { x: 0, y: 0.56, z: 0.5, yaw: 0 },
    droneMobileY: 0.5,
    glow: 0xffb238,
    maneuver: { spins: 1 },
    word: { effect: 'slice', y: 0.04, mobileY: 0.14 },
    stats: [
      { value: 48, unit: 'MIN', label: 'Flight time' },
      { value: 15, unit: 'KM', label: 'Range' },
      { value: 8, unit: 'K', label: 'Gimbal camera' },
      { value: 72, unit: 'KM/H', label: 'Top speed' },
    ],
  },
  {
    id: 'infinity',
    title: 'INFINITY',
    lines: ['In the space between thought and creation,', 'we find the essence of true innovation'],
    text: 'center-bottom',
    drone: { x: 0.3, y: 0.58, z: 0.6, yaw: -0.35 },
    droneMobileY: 0.5,
    glow: 0x2fd0ff,
    maneuver: { rolls: 1, trick: [0.03, 0.34] },
    word: { effect: 'scan', y: -0.02, mobileY: 0.14 },
  },
  {
    id: 'velocity',
    title: 'VELOCITY',
    lines: ['Built to chase the light,', 'faster than the horizon can move'],
    text: 'center-bottom',
    drone: { x: -0.32, y: 0.56, z: 0.8, yaw: 0.45 },
    droneMobileY: 0.5,
    glow: 0xff4a1a,
    maneuver: { spins: 1 },
    word: { effect: 'burst', y: 0, mobileY: 0.14 },
  },
  {
    id: 'orbit',
    title: 'ORBIT',
    lines: ['Circle the impossible,', 'and see it from every side'],
    text: 'center-bottom',
    drone: { x: 0.3, y: 0.56, z: 0.8, yaw: -0.4 },
    droneMobileY: 0.5,
    glow: 0xa06bff,
    maneuver: { spins: 1 },
    word: { effect: 'orbit', y: 0, mobileY: 0.14 },
  },
  {
    id: 'ascend',
    title: 'ASCEND',
    lines: ['Your next perspective', 'is one flight away'],
    text: 'center-top',
    drone: { x: 0, y: -0.24, yaw: 0 },
    droneMobileY: -0.2,
    camera: { y: 2.6 },
    glow: 0xff7a2a,
    maneuver: { arcY: 1.8, arcZ: 2, flips: 1 },
    cta: true,
    landing: true,
  },
];

const TAU = Math.PI * 2;
const FOV = 35;
const CAMERA_DISTANCE = 11;
const CAMERA_HEIGHT = 0.8;
/** Side-by-side layout (text one side, drone the other) from this width up; stacked below. */
const SPLIT_BREAKPOINT = 1024;
/** Fraction at each end of a scroll segment where the drone holds its pose at a section. */
const HOLD = 0.12;
/** How high above the pad the drone hovers before the final bit of scroll sets it down. */
const LANDING_HOVER = 0.6;
const DOWNWASH_PARTICLES = 180;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Eased flight progress into section `i` for a continuous section index `t`. */
const arrivalProgress = (i: number, t: number) =>
  easeInOutCubic(clamp((clamp(t - (i - 1), 0, 1) - HOLD) / (1 - 2 * HOLD), 0, 1));
/** Frame-rate independent exponential smoothing. */
const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
const pad = (n: number) => String(n).padStart(2, '0');

const SECTION_CLASSES: Record<TextLayout, string> = {
  left: 'items-end pb-32 lg:items-center lg:pb-0',
  right: 'items-end pb-32 lg:items-center lg:pb-0',
  'center-bottom': 'items-end pb-28 lg:pb-16',
  'center-top': 'items-start pt-24 lg:pt-24',
};
const TEXT_CLASSES: Record<TextLayout, string> = {
  left: 'lg:w-1/2 lg:pl-28 lg:pr-8 lg:text-left',
  right: 'lg:ml-auto lg:w-1/2 lg:pl-8 lg:pr-28 lg:text-right',
  'center-bottom': 'mx-auto max-w-4xl',
  'center-top': 'mx-auto max-w-4xl',
};
const NUMBER_CLASSES: Record<TextLayout, string> = {
  left: 'left-[3vw] top-[8%]',
  right: 'right-[3vw] top-[8%]',
  'center-bottom': 'left-[3vw] top-[6%]',
  'center-top': 'left-1/2 bottom-[2%] -translate-x-1/2',
};

type HudField = 'mode' | 'alt' | 'spd' | 'hdg' | 'bat';

type Stop = { x: number; y: number; z: number; yaw: number; camY: number; camZ: number };

export const Component = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const scrollProgressRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const hudFields = useRef<Partial<Record<HudField, HTMLSpanElement | null>>>({});
  /** 0 → 1 take-off progress, tweened by GSAP once the scene is ready. */
  const introRef = useRef({ value: 0 });

  const [currentSection, setCurrentSection] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);

  /* ------------------------------------------------------------------ */
  /* Three.js scene                                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.warn('WebGL unavailable — showing static drone instead.', err);
      setWebglFailed(true);
      setIsReady(true);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = window.innerWidth;
    let height = window.innerHeight;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.028);

    // Subtle studio reflections on the metal / clear-coated carbon
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envMap = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    scene.environment = envMap;
    scene.environmentIntensity = 0.18;

    const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 200);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);

    // Rim lighting from behind (one warm, one tinted per section) + front fill
    const rimWarm = new THREE.DirectionalLight(0xff8a3c, 3.2);
    rimWarm.position.set(6, 4, -7);
    const rimGlow = new THREE.DirectionalLight(0xff5a1e, 1.6);
    rimGlow.position.set(-7, 1.5, -5);
    const key = new THREE.DirectionalLight(0xffe2c4, 0.9);
    key.position.set(4, 6, 6);
    const fill = new THREE.DirectionalLight(0xa9bcff, 0.55);
    fill.position.set(-4, 3, 8);
    const padLight = new THREE.PointLight(0xff7a2a, 0, 6, 2);
    scene.add(new THREE.HemisphereLight(0x8fa4c8, 0x120804, 0.45), rimWarm, rimGlow, key, fill, padLight);

    // Drone hierarchy: flight (position + world-space banking/aerobatics) → heading (yaw) → model
    const rig = createDrone();
    const flight = new THREE.Group();
    const heading = new THREE.Group();
    heading.add(rig.root);
    flight.add(heading);
    scene.add(flight);

    const landingPad = createLandingPad();
    landingPad.root.visible = false;
    scene.add(landingPad.root);

    // Giant 3D titles the drone interacts with
    const words: (WordFx | null)[] = SECTIONS.map((s) => (s.word ? createWord(s.title, s.word.effect) : null));
    words.forEach((w) => w && scene.add(w.group));

    const dotTexture = makeRadialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.35)'],
      [1, 'rgba(255,255,255,0)'],
    ], 64);

    // Soft glow behind the drone, tinted per section
    const haloMaterial = new THREE.SpriteMaterial({
      map: makeRadialTexture([
        [0, 'rgba(255,255,255,0.34)'],
        [0.3, 'rgba(255,255,255,0.12)'],
        [0.65, 'rgba(255,255,255,0.03)'],
        [1, 'rgba(255,255,255,0)'],
      ], 256),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.7,
    });
    const halo = new THREE.Sprite(haloMaterial);
    scene.add(halo);

    // Floating dust for depth: rises and streams past as you scroll
    const DUST_COUNT = 1400;
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * 40;
      dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      dustPositions[i * 3 + 2] = 6 - Math.random() * 60;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        size: 0.07, map: dotTexture.clone(), color: 0xffc9a0, transparent: true, opacity: 0.55, depthWrite: false,
      }),
    );
    scene.add(dust);

    // Rotor downwash: faint air streams pushed down from each propeller
    const washSeeds = Array.from({ length: DOWNWASH_PARTICLES }, () => ({
      phase: Math.random(),
      angle: Math.random() * TAU,
      radius: Math.sqrt(Math.random()),
      spread: 0.5 + Math.random(),
      rotor: Math.floor(Math.random() * 6),
    }));
    const washGeometry = new THREE.BufferGeometry();
    washGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOWNWASH_PARTICLES * 3), 3));
    washGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DOWNWASH_PARTICLES * 3), 3));
    const downwash = new THREE.Points(
      washGeometry,
      new THREE.PointsMaterial({
        size: 0.05, map: dotTexture.clone(), vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    downwash.frustumCulled = false;
    scene.add(downwash);

    // Post-processing: bloom makes the LEDs / rim light glow
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.55, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    /* ---------- responsive flight plan ---------- */
    const glowColors = SECTIONS.map((s) => new THREE.Color(s.glow));
    const lastIndex = SECTIONS.length - 1;
    const hasLanding = SECTIONS[lastIndex].landing === true;
    const layout = {
      stops: [] as Stop[],
      /** Waypoint flight paths, indexed by the section they lead into. */
      curves: [] as (THREE.CatmullRomCurve3 | null)[],
      scale: 1,
      stacked: false,
      halfW: 1,
      halfH: 1,
      tops: [] as number[],
      maxScroll: 1,
    };

    const computeLayout = () => {
      const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_DISTANCE;
      const halfW = halfH * (width / height);
      const stacked = width < SPLIT_BREAKPOINT;
      layout.stacked = stacked;
      layout.halfW = halfW;
      layout.halfH = halfH;
      layout.scale = stacked
        ? Math.min(0.75, (halfW * 1.45) / DRONE_SPAN)
        : Math.min(0.95, (halfW * 0.85) / DRONE_SPAN);

      let turns = 0;
      layout.stops = SECTIONS.map((s) => {
        turns += s.maneuver?.spins ?? 0;
        const side = s.text === 'left' ? 1 : s.text === 'right' ? -1 : 0;
        return {
          x: stacked ? side * halfW * 0.06 : s.drone.x * halfW,
          y: stacked ? (s.droneMobileY ?? 0.38) * halfH : s.drone.y * halfH,
          z: stacked ? 0 : s.drone.z ?? 0,
          yaw: s.drone.yaw + turns * TAU,
          camY: s.camera?.y ?? CAMERA_HEIGHT,
          camZ: stacked ? CAMERA_DISTANCE : s.camera?.z ?? CAMERA_DISTANCE,
        };
      });

      words.forEach((word, i) => {
        const cfg = SECTIONS[i].word;
        if (!word || !cfg) return;
        const y = (stacked ? cfg.mobileY ?? cfg.y : cfg.y) * halfH;
        word.place(new THREE.Vector3(0, y, 0), stacked ? halfW * 1.8 : Math.min(halfW * 1.56, 12));
      });

      layout.curves = SECTIONS.map((_, i) => {
        const word = words[i];
        if (!word || i === 0) return null;
        const a = layout.stops[i - 1];
        const b = layout.stops[i];
        const from = new THREE.Vector3(a.x, a.y, a.z);
        const to = new THREE.Vector3(b.x, b.y, b.z);
        const curve = new THREE.CatmullRomCurve3(
          [from, ...word.waypoints(from, to, layout.scale), to],
          false,
          'centripetal',
        );
        word.bindPath(curve, layout.scale);
        return curve;
      });

      layout.tops = sectionRefs.current.map((el) =>
        el ? el.getBoundingClientRect().top + window.scrollY : 0,
      );
      layout.maxScroll = Math.max(1, document.documentElement.scrollHeight - height);
      rig.root.scale.setScalar(layout.scale);
      landingPad.root.scale.setScalar(layout.scale);
    };
    computeLayout();

    /** Scroll position → continuous section index (1.5 = halfway between sections 1 and 2). */
    const scrollToT = (y: number) => {
      const { tops } = layout;
      if (tops.length < 2 || y <= tops[0]) return 0;
      for (let i = 0; i < tops.length - 1; i++) {
        if (y < tops[i + 1]) return i + (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]);
      }
      return tops.length - 1;
    };

    const target = {
      x: 0, y: 0, z: 0, yaw: 0, roll: 0, flip: 0,
      camY: CAMERA_HEIGHT, camZ: CAMERA_DISTANCE, aerobatic: false,
    };
    const glowColor = new THREE.Color();
    const pathPoint = new THREE.Vector3();

    const poseAt = (t: number) => {
      const { stops, stacked } = layout;
      const tc = clamp(t, 0, lastIndex);
      const i = Math.min(Math.floor(tc), lastIndex - 1);
      const e = arrivalProgress(i + 1, tc);
      const a = stops[i];
      const b = stops[i + 1];
      const m: Maneuver = SECTIONS[i + 1].maneuver ?? {};
      const curve = layout.curves[i + 1];

      if (curve) {
        curve.getPointAt(e, pathPoint);
        target.x = pathPoint.x;
        target.y = pathPoint.y;
        target.z = pathPoint.z;
      } else {
        const arc = Math.sin(Math.PI * e);
        const k = stacked ? 0.55 : 1; // tighter manoeuvres on small screens
        target.x = lerp(a.x, b.x, e);
        target.y = lerp(a.y, b.y, e) + arc * (m.arcY ?? 1) * k;
        target.z = lerp(a.z, b.z, e) - arc * (m.arcZ ?? 3) * k;
      }
      target.yaw = lerp(a.yaw, b.yaw, e);

      const [trickStart, trickEnd] = m.trick ?? [0.2, 0.8];
      const trick = smoothstep(trickStart, trickEnd, e);
      const travelDir = b.x >= a.x ? 1 : -1;
      target.roll = -travelDir * TAU * (m.rolls ?? 0) * trick;
      target.flip = TAU * (m.flips ?? 0) * trick;
      target.aerobatic = Boolean(m.rolls || m.flips) && trick > 0.02 && trick < 0.98;

      target.camY = lerp(a.camY, b.camY, e);
      target.camZ = lerp(a.camZ, b.camZ, e);
      glowColor.lerpColors(glowColors[i], glowColors[i + 1], e);
    };

    /* ---------- click the drone for a trick ---------- */
    const clickTrick = { flip: 0, roll: 0, spin: 0 };
    const trickKinds = ['flip', 'roll', 'spin'] as const;
    let trickCount = 0;
    let trickTween: gsap.core.Tween | null = null;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pointerOnDrone = (clientX: number, clientY: number) => {
      ndc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(flight, true).length > 0;
    };

    /* ---------- per-frame state ---------- */
    const pos = new THREE.Vector3();
    const prevPos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const gimbalWorld = new THREE.Vector3();
    const aimTarget = new THREE.Vector3();
    const effectAim = new THREE.Vector3();
    const aimMatrix = new THREE.Matrix4();
    const aimDesired = new THREE.Quaternion();
    const aimSmoothed = new THREE.Quaternion();
    const parentQuat = new THREE.Quaternion();
    const droneUp = new THREE.Vector3();
    const rotorWorld = rig.rotors.map(() => new THREE.Vector3());
    const washPoint = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
    const wordFrame: WordFrame = {
      e: 0, enter: 0, exit: 0, time: 0, drone: pos, droneScale: 1, glow: glowColor, gimbal: gimbalWorld,
    };
    let smoothT = scrollToT(window.scrollY);
    let tiltX = 0;
    let tiltZ = 0;
    let firstFrame = true;
    let lastSection = -1;
    let hudTimer = 0;
    let rafId = 0;
    const startTime = performance.now();
    let lastTime = startTime;

    const setText = (field: HudField, text: string) => {
      const el = hudFields.current[field];
      if (el && el.textContent !== text) el.textContent = text;
    };

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const time = (now - startTime) / 1000;
      const intro = reduceMotion ? 1 : introRef.current.value;
      const { scale } = layout;

      // Scroll → smoothed position along the flight path
      const scrollY = window.scrollY;
      const t = scrollToT(scrollY);
      smoothT = damp(smoothT, t, 5, dt);
      poseAt(smoothT);

      // Touch-down: the last sliver of scroll sets the drone onto the pad
      const landed = hasLanding ? smoothstep(lastIndex - 0.1, lastIndex - 0.01, smoothT) : 0;
      const airborne = 1 - landed;

      // Hover drift + take-off offset
      const bobY = (Math.sin(time * 1.4) * 0.07 + Math.sin(time * 0.6) * 0.04) * airborne;
      const bobX = Math.sin(time * 0.9) * 0.04 * airborne;
      pos.set(
        target.x + bobX,
        target.y + bobY - (1 - intro) * 3.2 - landed * LANDING_HOVER * scale,
        target.z - (1 - intro) * 1.5,
      );
      if (firstFrame) {
        prevPos.copy(pos);
        firstFrame = false;
      }
      vel.subVectors(pos, prevPos).divideScalar(Math.max(dt, 1e-4));
      prevPos.copy(pos);
      const speed = vel.length();

      // Bank into the direction of travel, like a real multirotor
      tiltZ = damp(tiltZ, (clamp(-vel.x * 0.07, -0.45, 0.45) + Math.sin(time * 1.1) * 0.012) * airborne, 5, dt);
      tiltX = damp(tiltX, (clamp(vel.z * 0.07, -0.35, 0.35) + Math.sin(time * 0.8) * 0.01) * airborne, 5, dt);
      flight.position.copy(pos);
      flight.rotation.set(tiltX + target.flip + clickTrick.flip, 0, tiltZ + target.roll + clickTrick.roll);
      heading.rotation.y = target.yaw + clickTrick.spin + Math.sin(time * 0.5) * 0.04 * airborne;
      flight.updateMatrixWorld(true);
      rig.gimbal.getWorldPosition(gimbalWorld);

      // Propellers: spool up on take-off, work harder in flight, idle once landed
      const spool = clamp(intro * 3, 0.08, 1) * lerp(1, 0.18, landed);
      const tricking = Boolean(trickTween?.isActive());
      const load = Math.min(speed, 8) * 2.5 + (target.aerobatic || tricking ? 10 : 0);
      const omega = (32 + load) * spool;
      for (const rotor of rig.rotors) rotor.spinner.rotation.y += rotor.direction * rotor.trim * omega * dt;
      const blur = clamp((omega - 10) / 30, 0, 1);
      rig.materials.rotorBlur.opacity = 0.5 * blur;
      rig.materials.blade.opacity = 1 - 0.45 * blur;

      // Navigation lights
      rig.materials.navRear.emissiveIntensity = time % 1.4 < 0.7 ? 2.6 : 0.25;
      const strobePhase = time % 1.6;
      rig.materials.strobe.emissiveIntensity =
        strobePhase < 0.05 || (strobePhase > 0.15 && strobePhase < 0.2) ? 12 : 0;
      rig.materials.rec.emissiveIntensity = Math.sin(time * TAU * 0.8) > 0 ? 4 : 0.15;

      // 3D words: slice / scan / burst / orbit
      let effectStatus: string | null = null;
      let aimWeight = 0;
      wordFrame.time = time;
      wordFrame.droneScale = scale;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (!word) continue;
        wordFrame.e = arrivalProgress(i, smoothT);
        wordFrame.enter = smoothstep(i - 0.8, i - 0.67, smoothT);
        wordFrame.exit = i === lastIndex ? 0 : smoothstep(i + 0.02, i + 0.25, smoothT);
        const result = word.update(wordFrame);
        if (result.status) effectStatus = result.status;
        if (result.aim && result.aimWeight > aimWeight) {
          aimWeight = result.aimWeight;
          effectAim.copy(result.aim);
        }
      }

      // Gimbal camera: follows your cursor, or locks onto whatever the drone is working on
      aimTarget.set(pointer.sx * layout.halfW, CAMERA_HEIGHT - pointer.sy * layout.halfH, CAMERA_DISTANCE);
      aimTarget.lerp(effectAim, aimWeight);
      aimMatrix.lookAt(aimTarget, gimbalWorld, UP); // +Z of the gimbal points at the target
      aimDesired.setFromRotationMatrix(aimMatrix);
      if (time < 0.1) aimSmoothed.copy(aimDesired);
      else aimSmoothed.slerp(aimDesired, 1 - Math.exp(-6 * dt));
      rig.gimbal.parent!.getWorldQuaternion(parentQuat);
      rig.gimbal.quaternion.copy(parentQuat.invert()).multiply(aimSmoothed);

      // Section colour
      rimGlow.color.copy(glowColor);
      haloMaterial.color.copy(glowColor);
      halo.position.set(pos.x, pos.y - 0.1, pos.z - 2.5);
      halo.scale.setScalar(9 * scale * (0.9 + 0.1 * Math.sin(time * 1.3)));

      // Landing pad fades in on the final approach
      const padFade = hasLanding ? smoothstep(lastIndex - 0.4, lastIndex - 0.1, smoothT) : 0;
      const stop = layout.stops[lastIndex];
      const padY = stop.y - (LANDING_HOVER + LANDING_GEAR_DEPTH) * scale - 0.004;
      landingPad.root.visible = padFade > 0.001;
      if (landingPad.root.visible) {
        landingPad.root.position.set(stop.x, padY, stop.z);
        landingPad.fadeMaterials.forEach((m) => {
          m.opacity = m.userData.baseOpacity * padFade;
        });
        landingPad.glowMaterials.forEach((m) => m.color.copy(glowColor));
        landingPad.shadow.opacity = padFade * (0.3 + 0.55 * landed);
        landingPad.ripples.forEach((ripple, k) => {
          const phase = (time * 0.45 + k * 0.5) % 1;
          ripple.scale.setScalar(1 + phase * 0.8);
          ripple.material.opacity = (1 - phase) * 0.6 * landed * padFade;
        });
        padLight.position.set(stop.x, padY + 0.5, stop.z + 0.6);
        padLight.color.copy(glowColor);
        padLight.intensity = 6 * padFade;
      } else {
        padLight.intensity = 0;
      }

      // Downwash streams out of each rotor and fans out across the pad
      rig.rotors.forEach((rotor, k) => rotor.spinner.getWorldPosition(rotorWorld[k]));
      droneUp.copy(UP).applyQuaternion(flight.quaternion);
      const washStrength = reduceMotion ? 0 : spool * (0.35 + 0.25 * landed);
      const washPositions = washGeometry.attributes.position as THREE.BufferAttribute;
      const washColors = washGeometry.attributes.color as THREE.BufferAttribute;
      const padTop = padY + 0.01;
      washSeeds.forEach((seed, j) => {
        const age = (time * 1.6 + seed.phase) % 1;
        const ring = seed.radius * PROP_RADIUS * scale * 0.8;
        washPoint.copy(rotorWorld[seed.rotor]).addScaledVector(droneUp, -age * 2.2 * scale);
        washPoint.x += Math.cos(seed.angle) * ring;
        washPoint.z += Math.sin(seed.angle) * ring;
        const outX = washPoint.x - pos.x;
        const outZ = washPoint.z - pos.z;
        const outLen = Math.hypot(outX, outZ) || 1;
        const fan = age * age * seed.spread * scale;
        washPoint.x += (outX / outLen) * fan;
        washPoint.z += (outZ / outLen) * fan;
        if (padFade > 0.01 && washPoint.y < padTop) {
          const below = padTop - washPoint.y;
          washPoint.y = padTop;
          washPoint.x += (outX / outLen) * below * 1.8;
          washPoint.z += (outZ / outLen) * below * 1.8;
        }
        washPositions.setXYZ(j, washPoint.x, washPoint.y, washPoint.z);
        const k = (1 - age) * (1 - age) * washStrength;
        washColors.setXYZ(j, k * 0.8, k * 0.88, k);
      });
      washPositions.needsUpdate = true;
      washColors.needsUpdate = true;

      dust.position.y = smoothT * 2.2;
      dust.position.z = smoothT * 2.5;
      dust.rotation.y = time * 0.01;

      // Camera: per-section framing + gentle pointer parallax
      pointer.sx = damp(pointer.sx, pointer.x, 2.5, dt);
      pointer.sy = damp(pointer.sy, pointer.y, 2.5, dt);
      camera.position.set(pointer.sx * 0.6, target.camY - pointer.sy * 0.35, target.camZ);
      camera.lookAt(pos.x * 0.06, pos.y * 0.04, 0);

      composer.render(dt);

      // UI: progress bar, section counter, telemetry
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${clamp(scrollY / layout.maxScroll, 0, 1)})`;
      }
      const section = Math.round(clamp(t, 0, lastIndex));
      if (section !== lastSection) {
        lastSection = section;
        setCurrentSection(section);
      }
      hudTimer += dt;
      if (hudTimer > 0.12) {
        hudTimer = 0;
        const headingDeg = ((THREE.MathUtils.radToDeg(heading.rotation.y) % 360) + 360) % 360;
        const mode = intro < 0.98
          ? 'TAKEOFF'
          : landed > 0.9
            ? 'LANDED'
            : tricking
              ? 'TRICK'
              : effectStatus ?? (target.aerobatic ? 'AEROBATIC' : speed > 1.2 ? 'TRANSIT' : 'HOVER');
        setText('mode', mode);
        setText('alt', (Math.max(0, (pos.y + 3.2) * 9 + 38) * airborne).toFixed(1));
        setText('spd', (speed * 3.6).toFixed(1));
        setText('hdg', String(Math.round(headingDeg) % 360).padStart(3, '0'));
        setText('bat', String(Math.max(18, 98 - Math.floor(time / 45))));
      }
    };
    rafId = requestAnimationFrame(animate);
    setIsReady(true);

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      computeLayout();
    };

    let lastHoverCheck = 0;
    const handlePointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (e.timeStamp - lastHoverCheck > 80) {
        lastHoverCheck = e.timeStamp;
        document.documentElement.style.cursor = pointerOnDrone(e.clientX, e.clientY) ? 'pointer' : '';
      }
    };

    const handleClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a, button, input, textarea, select')) return;
      if (trickTween?.isActive() || !pointerOnDrone(e.clientX, e.clientY)) return;
      const kind = trickKinds[trickCount++ % trickKinds.length];
      clickTrick[kind] = 0;
      trickTween = gsap.to(clickTrick, {
        [kind]: TAU,
        duration: kind === 'spin' ? 1.1 : 0.9,
        ease: 'power2.inOut',
        onComplete: () => {
          clickTrick[kind] = 0;
        },
      });
    };

    window.addEventListener('resize', handleResize);
    if (!reduceMotion) {
      window.addEventListener('pointermove', handlePointer, { passive: true });
      window.addEventListener('click', handleClick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      trickTween?.kill();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointer);
      window.removeEventListener('click', handleClick);
      document.documentElement.style.cursor = '';

      scene.traverse((obj) => {
        const { geometry, material } = obj as THREE.Mesh;
        // Sprites share one internal geometry across instances — leave it alone.
        if (geometry && !(obj instanceof THREE.Sprite)) geometry.dispose();
        const materials = Array.isArray(material) ? material : material ? [material] : [];
        materials.forEach((mat) => {
          Object.values(mat).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          if (mat instanceof THREE.ShaderMaterial) {
            Object.values(mat.uniforms).forEach(({ value }) => {
              if (value instanceof THREE.Texture) value.dispose();
            });
          }
          mat.dispose();
        });
      });
      dotTexture.dispose();
      envMap.dispose();
      pmrem.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /* Intro + scroll-driven text effects                                   */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!isReady) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = gsap.context(() => {
      gsap.set(
        [menuRef.current, titleRef.current, subtitleRef.current, scrollProgressRef.current, hudRef.current, navRef.current],
        { visibility: 'visible' },
      );
      if (reduceMotion) {
        introRef.current.value = 1;
        return;
      }

      // Drone take-off
      gsap.to(introRef.current, { value: 1, duration: 3, ease: 'power2.out', delay: 0.1 });

      const tl = gsap.timeline({ delay: 0.4 });
      tl.from(menuRef.current, { x: -100, opacity: 0, duration: 1, ease: 'power3.out' })
        .from(titleRef.current, { y: 100, opacity: 0, duration: 1.5, ease: 'power4.out' }, '-=0.5')
        .from(subtitleRef.current?.querySelectorAll('.subtitle-line') ?? [], {
          y: 50, opacity: 0, duration: 1, stagger: 0.2, ease: 'power3.out',
        }, '-=0.8')
        .from([scrollProgressRef.current, hudRef.current, navRef.current], {
          opacity: 0, y: 50, duration: 1, ease: 'power2.out',
        }, '-=0.5');

      // Letters rise, then copy / stats / buttons follow, as the drone arrives
      gsap.utils.toArray<HTMLElement>('[data-reveal-section]').forEach((section) => {
        const reveal = gsap.timeline({
          scrollTrigger: { trigger: section, start: 'top 80%', end: 'top 20%', scrub: 0.8 },
        });
        const chars = section.querySelectorAll('[data-char]');
        if (chars.length) reveal.from(chars, { yPercent: 110, stagger: 0.04, ease: 'power3.out' });
        reveal.from(section.querySelectorAll('[data-reveal]'), {
          y: 50, opacity: 0, stagger: 0.1, ease: 'power3.out',
        }, chars.length ? '<0.15' : 0);
      });

      // Giant outline section numbers drift at a different speed
      gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
        gsap.fromTo(el, { yPercent: 30 }, {
          yPercent: -30,
          ease: 'none',
          scrollTrigger: { trigger: el.closest('section'), start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });

      // Stats count up when they come into view
      const counters = gsap.utils.toArray<HTMLElement>('[data-count]');
      counters.forEach((el) => {
        const counter = { value: 0 };
        el.textContent = '0';
        gsap.to(counter, {
          value: Number(el.dataset.count),
          duration: 1.6,
          ease: 'power2.out',
          scrollTrigger: { trigger: el.closest('section'), start: 'top 40%', once: true },
          onUpdate: () => {
            el.textContent = String(Math.round(counter.value));
          },
        });
      });
      return () => counters.forEach((el) => {
        el.textContent = el.dataset.count ?? '';
      });
    }, containerRef);

    return () => ctx.revert();
  }, [isReady]);

  const scrollToSection = (index: number) => {
    const el = sectionRefs.current[index];
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  return (
    <div ref={containerRef} className="relative w-full bg-black text-white">
      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" aria-hidden="true" />

      {webglFailed && (
        <img
          src={droneFallback}
          alt=""
          className="pointer-events-none fixed right-[4%] top-1/2 w-[44vw] max-w-3xl -translate-y-1/2 opacity-90"
        />
      )}

      {/* Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.7)_100%)]"
      />

      <div
        ref={menuRef}
        className="fixed left-6 top-6 z-20 flex flex-col items-center gap-8 lg:left-8 lg:top-1/2 lg:-translate-y-1/2"
        style={{ visibility: 'hidden' }}
      >
        <div className="flex flex-col gap-2">
          <span className="h-0.5 w-8 bg-white"></span>
          <span className="h-0.5 w-8 bg-white"></span>
          <span className="h-0.5 w-8 bg-white"></span>
        </div>
        <div className="hidden text-sm font-light tracking-[0.3em] text-white [writing-mode:vertical-lr] lg:block">DRONES</div>
      </div>

      {/* Section navigation — clicking a dot flies the drone there */}
      <nav
        ref={navRef}
        aria-label="Sections"
        className="fixed right-8 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-end gap-4 lg:flex"
        style={{ visibility: 'hidden' }}
      >
        {SECTIONS.map((section, i) => {
          const active = currentSection === i;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(i)}
              aria-label={`Go to ${section.title}`}
              aria-current={active ? 'true' : undefined}
              className="group flex items-center gap-3 rounded-none border-0 bg-transparent p-0 text-[10px] font-light tracking-[0.3em] text-transparent transition-colors hover:text-white/70 focus-visible:text-white/70"
            >
              {section.title}
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-all duration-300',
                  active ? 'scale-150 bg-orange-400' : 'bg-white/40 group-hover:bg-white',
                )}
              />
            </button>
          );
        })}
      </nav>

      {/* Live telemetry */}
      <div
        ref={hudRef}
        aria-hidden="true"
        className="fixed bottom-12 left-8 z-20 hidden font-mono text-[11px] uppercase tracking-[0.2em] text-white/55 lg:block"
        style={{ visibility: 'hidden' }}
      >
        <div className="mb-3 flex items-center gap-2 text-orange-400/90">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
          <span ref={(el) => { hudFields.current.mode = el; }}>TAKEOFF</span>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
          <dt>ALT</dt>
          <dd className="text-white/85"><span ref={(el) => { hudFields.current.alt = el; }}>0.0</span> M</dd>
          <dt>SPD</dt>
          <dd className="text-white/85"><span ref={(el) => { hudFields.current.spd = el; }}>0.0</span> M/S</dd>
          <dt>HDG</dt>
          <dd className="text-white/85"><span ref={(el) => { hudFields.current.hdg = el; }}>000</span>°</dd>
          <dt>BAT</dt>
          <dd className="text-white/85"><span ref={(el) => { hudFields.current.bat = el; }}>98</span>%</dd>
        </dl>
        <div className="mt-3 text-[10px] text-white/30">Click the drone</div>
      </div>

      <div
        ref={scrollProgressRef}
        className="fixed bottom-6 right-6 z-20 flex flex-col items-end gap-4 lg:bottom-12 lg:right-12"
        style={{ visibility: 'hidden' }}
      >
        <div className="text-xs font-light tracking-[0.3em] text-white">SCROLL</div>
        <div className="relative h-0.5 w-32 overflow-hidden bg-white/30">
          <div
            ref={progressFillRef}
            className="absolute inset-0 origin-left bg-white"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
        <div className="text-sm font-light text-white">
          {pad(currentSection + 1)} / {pad(SECTIONS.length)}
        </div>
      </div>

      <main className="relative z-10">
        {SECTIONS.map((section, i) => {
          const isHero = i === 0;
          const hiddenUntilIntro = isHero ? { visibility: 'hidden' as const } : undefined;
          const reveal = isHero ? undefined : '';

          return (
            <section
              key={section.id}
              id={section.id}
              ref={(el) => { sectionRefs.current[i] = el; }}
              data-reveal-section={reveal}
              className={cn('relative flex h-screen overflow-hidden px-6 lg:px-0', SECTION_CLASSES[section.text])}
            >
              <div aria-hidden="true" className={cn('pointer-events-none absolute hidden select-none lg:block', NUMBER_CLASSES[section.text])}>
                <span
                  data-parallax
                  className="block text-[20vw] font-bold leading-none text-transparent [-webkit-text-stroke:1px_rgba(255,255,255,0.07)]"
                >
                  {pad(i + 1)}
                </span>
              </div>

              <div className={cn('relative w-full text-center', TEXT_CLASSES[section.text])}>
                {isHero ? (
                  <h1
                    ref={titleRef}
                    className="mb-6 text-[clamp(3rem,7vw,7.5rem)] font-bold leading-[0.95] tracking-wider text-white"
                    style={hiddenUntilIntro}
                  >
                    {section.title}
                  </h1>
                ) : section.word ? (
                  // Drawn as a 3D word in the scene; keep the real heading for screen readers.
                  <h2 className="sr-only">{section.title}</h2>
                ) : (
                  <h2
                    aria-label={section.title}
                    className="mb-6 text-[clamp(3rem,7vw,7.5rem)] font-bold leading-[0.95] tracking-wider text-white"
                  >
                    <span aria-hidden="true" className="inline-block overflow-hidden pb-[0.08em] align-top">
                      {Array.from(section.title).map((char, k) => (
                        <span key={k} data-char className="inline-block">{char}</span>
                      ))}
                    </span>
                  </h2>
                )}

                <div
                  ref={isHero ? subtitleRef : undefined}
                  className="text-lg font-light leading-relaxed text-white/75 md:text-2xl"
                  style={hiddenUntilIntro}
                >
                  {section.lines.map((line) => (
                    <p key={line} className="subtitle-line" data-reveal={reveal}>
                      {line}
                    </p>
                  ))}
                </div>

                {section.stats && (
                  <dl className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-y-6 lg:grid-cols-4 lg:divide-x lg:divide-white/10">
                    {section.stats.map((stat) => (
                      <div key={stat.label} data-reveal className="flex flex-col-reverse px-4">
                        <dt className="mt-2 text-[10px] uppercase tracking-[0.3em] text-white/50 lg:text-xs">
                          {stat.label}
                        </dt>
                        <dd className="text-4xl font-light text-white lg:text-5xl">
                          <span data-count={stat.value}>{stat.value}</span>
                          <span className="ml-1 text-sm tracking-widest text-orange-400/90 lg:text-base">{stat.unit}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}

                {section.cta && (
                  <div data-reveal className="mt-10">
                    <button
                      type="button"
                      onClick={() => scrollToSection(0)}
                      className="group inline-flex items-center gap-3 rounded-full border border-orange-400/40 bg-orange-500/10 px-7 py-3 text-xs font-medium tracking-[0.3em] text-white backdrop-blur transition-colors hover:border-orange-400 hover:bg-orange-500/20"
                    >
                      FLY AGAIN
                      <ArrowUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
};
