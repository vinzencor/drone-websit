import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural hexacopter (heavy-lift cinema-drone style) built from primitives,
 * so it needs no external model file. Front of the drone faces +Z.
 */

/** Distance from the drone's centre to each motor axis (model units). */
export const ARM_TIP = 1.55;
/** Propeller radius (model units). */
export const PROP_RADIUS = 0.68;
/** Prop-tip to prop-tip span, used to fit the drone to the viewport. */
export const DRONE_SPAN = 2 * (ARM_TIP + PROP_RADIUS);
/** Distance from the drone's origin down to the bottom of the landing skids. */
export const LANDING_GEAR_DEPTH = 0.942;

const ARM_COUNT = 6;
const ARM_START = 0.42;
const MOTOR_TOP = 0.26;

export interface Rotor {
  spinner: THREE.Group;
  /** +1 / -1: adjacent motors spin in opposite directions, like a real multirotor. */
  direction: 1 | -1;
  /** Small per-motor RPM variation so the props don't spin in lockstep. */
  trim: number;
}

export interface DroneRig {
  root: THREE.Group;
  rotors: Rotor[];
  /** Camera gimbal. The scene counter-rotates it every frame to keep it level. */
  gimbal: THREE.Group;
  materials: {
    blade: THREE.MeshStandardMaterial;
    rotorBlur: THREE.MeshBasicMaterial;
    navRear: THREE.MeshStandardMaterial;
    strobe: THREE.MeshStandardMaterial;
    rec: THREE.MeshStandardMaterial;
  };
}

export function makeRadialTexture(stops: Array<[number, string]>, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeCarbonTexture() {
  const size = 64;
  const cell = 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const horizontal = (x / cell + y / cell) % 2 === 0;
      const g = horizontal
        ? ctx.createLinearGradient(x, y, x, y + cell)
        : ctx.createLinearGradient(x, y, x + cell, y);
      g.addColorStop(0, '#0c0d0f');
      g.addColorStop(0.5, '#2b2d32');
      g.addColorStop(1, '#0c0d0f');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeBladeGeometry() {
  // Blade outline in the XY plane, root near the hub, tip at PROP_RADIUS.
  const shape = new THREE.Shape();
  shape.moveTo(0.04, -0.028);
  shape.quadraticCurveTo(0.22, -0.07, 0.46, -0.05);
  shape.quadraticCurveTo(PROP_RADIUS, -0.03, PROP_RADIUS, 0);
  shape.quadraticCurveTo(PROP_RADIUS - 0.01, 0.022, 0.5, 0.026);
  shape.quadraticCurveTo(0.22, 0.034, 0.04, 0.028);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -0.006);
  geometry.rotateX(-Math.PI / 2); // lay the blade flat (XZ plane)
  return geometry;
}

const UP = new THREE.Vector3(0, 1, 0);

function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 14), material);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function place<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x = 0, y = 0, z = 0): T {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => new THREE.Mesh(geometry, material);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function createDrone(): DroneRig {
  const root = new THREE.Group();
  root.name = 'drone';
  // Lift the model so its visual centre (GPS dome to skids) sits at the origin.
  const model = place(root, new THREE.Group(), 0, 0.22, 0);

  /* ---------- materials ---------- */
  const carbonPlateTex = makeCarbonTexture();
  carbonPlateTex.repeat.set(3, 3);
  const carbonTubeTex = carbonPlateTex.clone();
  carbonTubeTex.repeat.set(1, 8);
  carbonTubeTex.needsUpdate = true;

  const carbonPlate = new THREE.MeshPhysicalMaterial({
    map: carbonPlateTex, roughness: 0.4, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.18,
  });
  const carbonTube = new THREE.MeshPhysicalMaterial({
    map: carbonTubeTex, roughness: 0.35, metalness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.12,
  });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.9, roughness: 0.28 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.35, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({
    color: 0xff6a1a, metalness: 0.55, roughness: 0.3, emissive: 0xff4a00, emissiveIntensity: 0.12,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x03050a, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    iridescence: 0.8, iridescenceIOR: 1.4,
  });
  const blade = new THREE.MeshStandardMaterial({
    color: 0x0e0f11, metalness: 0.15, roughness: 0.45, transparent: true, side: THREE.DoubleSide,
  });
  const rotorBlur = new THREE.MeshBasicMaterial({
    map: makeRadialTexture([
      [0, 'rgba(255,255,255,0)'],
      [0.25, 'rgba(255,255,255,0.05)'],
      [0.7, 'rgba(255,255,255,0.18)'],
      [0.92, 'rgba(255,255,255,0.32)'],
      [0.97, 'rgba(255,255,255,0.12)'],
      [1, 'rgba(255,255,255,0)'],
    ], 256),
    color: 0xd6dae2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const led = (color: number, intensity: number) =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  const navFront = led(0xff2414, 2.4);
  const navRear = led(0x22ff66, 2.4);
  const strobe = led(0xffffff, 0);
  const rec = led(0xff1a1a, 3);
  const batteryLed = led(0x3dff7a, 1.6);

  /* ---------- centre frame ---------- */
  const plate = (radius: number) => new THREE.CylinderGeometry(radius, radius, 0.045, 6);
  place(model, mesh(plate(0.64), carbonPlate), 0, 0.1, 0).rotation.y = Math.PI / 6;
  place(model, mesh(plate(0.58), carbonPlate), 0, -0.1, 0).rotation.y = Math.PI / 6;
  place(model, mesh(new RoundedBoxGeometry(0.6, 0.15, 0.6, 3, 0.035), shell));

  const standoffGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    place(model, mesh(standoffGeo, alloy), Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
  }

  // Twin smart batteries with charge-level LEDs
  const batteryGeo = new RoundedBoxGeometry(0.22, 0.13, 0.6, 3, 0.03);
  const bandGeo = new THREE.BoxGeometry(0.224, 0.02, 0.06);
  const batteryLedGeo = new THREE.BoxGeometry(0.022, 0.012, 0.01);
  for (const x of [-0.13, 0.13]) {
    const battery = place(model, mesh(batteryGeo, shell), x, 0.19, -0.02);
    place(battery, mesh(bandGeo, accent), 0, 0.02, 0.2);
    for (let k = 0; k < 4; k++) place(battery, mesh(batteryLedGeo, batteryLed), -0.06 + k * 0.04, 0, 0.302);
  }

  // GPS mast + puck
  const mastBaseY = 0.26;
  const puckY = 0.64;
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3;
    model.add(strut(
      v3(Math.sin(a) * 0.12, mastBaseY, Math.cos(a) * 0.12 - 0.02),
      v3(Math.sin(a) * 0.05, puckY - 0.04, Math.cos(a) * 0.05),
      0.011,
      alloy,
    ));
  }
  place(model, mesh(new THREE.CylinderGeometry(0.2, 0.215, 0.07, 40), shell), 0, puckY, 0);
  const dome = place(model, mesh(new THREE.SphereGeometry(0.2, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell), 0, puckY + 0.035, 0);
  dome.scale.y = 0.32;
  place(model, mesh(new THREE.TorusGeometry(0.212, 0.007, 8, 64), accent), 0, puckY - 0.01, 0).rotation.x = Math.PI / 2;

  // Rear anti-collision strobe
  place(model, mesh(new THREE.SphereGeometry(0.028, 16, 8), strobe), 0, 0.14, -0.5);

  /* ---------- arms, motors, propellers ---------- */
  const armGeo = new THREE.CylinderGeometry(0.04, 0.05, ARM_TIP - ARM_START, 20);
  armGeo.rotateX(Math.PI / 2); // run along +Z
  const clampGeo = new RoundedBoxGeometry(0.15, 0.13, 0.12, 2, 0.02);
  const jointGeo = new RoundedBoxGeometry(0.12, 0.1, 0.16, 2, 0.02);
  const jointRingGeo = new THREE.TorusGeometry(0.058, 0.009, 8, 32);
  const mountGeo = new RoundedBoxGeometry(0.2, 0.04, 0.26, 2, 0.015);
  const escGeo = new RoundedBoxGeometry(0.15, 0.15, 0.17, 2, 0.02);
  const statorGeo = new THREE.CylinderGeometry(0.105, 0.115, 0.07, 32);
  const ledRingGeo = new THREE.CylinderGeometry(0.118, 0.118, 0.02, 32, 1, true);
  const bellGeo = new THREE.CylinderGeometry(0.122, 0.125, 0.1, 32);
  const capGeo = new THREE.CylinderGeometry(0.05, 0.062, 0.022, 24);
  const hubGeo = new THREE.CylinderGeometry(0.042, 0.05, 0.045, 20);
  const nutGeo = new THREE.SphereGeometry(0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bladeGeo = makeBladeGeometry();
  const blurGeo = new THREE.RingGeometry(0.05, PROP_RADIUS + 0.01, 64);
  blurGeo.rotateX(-Math.PI / 2);

  const rotors: Rotor[] = [];
  for (let i = 0; i < ARM_COUNT; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = Math.PI / 6 + (i * 2 * Math.PI) / ARM_COUNT; // 30°, 90°, … from the nose
    model.add(arm);

    place(arm, mesh(armGeo, carbonTube), 0, 0, (ARM_START + ARM_TIP) / 2);
    place(arm, mesh(clampGeo, alloy), 0, 0, ARM_START + 0.08);
    place(arm, mesh(jointGeo, alloy), 0, 0, 0.82);
    place(arm, mesh(jointRingGeo, accent), 0, 0, 0.91);
    place(arm, mesh(mountGeo, alloy), 0, 0.045, ARM_TIP);
    place(arm, mesh(escGeo, shell), 0, -0.08, ARM_TIP);
    place(arm, mesh(statorGeo, alloy), 0, 0.1, ARM_TIP);
    const isRear = i === 2 || i === 3;
    place(arm, mesh(ledRingGeo, isRear ? navRear : navFront), 0, 0.075, ARM_TIP);
    place(arm, mesh(bellGeo, alloy), 0, 0.185, ARM_TIP);
    place(arm, mesh(capGeo, accent), 0, 0.245, ARM_TIP);

    const direction: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const spinner = place(arm, new THREE.Group(), 0, MOTOR_TOP, ARM_TIP);
    spinner.rotation.y = Math.random() * Math.PI;
    place(spinner, mesh(hubGeo, alloy), 0, 0.02, 0);
    place(spinner, mesh(nutGeo, accent), 0, 0.042, 0);
    for (let b = 0; b < 2; b++) {
      const holder = place(spinner, new THREE.Group(), 0, 0.025, 0);
      holder.rotation.y = b * Math.PI;
      place(holder, mesh(bladeGeo, blade)).rotation.x = 0.16 * direction; // blade pitch
    }
    place(arm, mesh(blurGeo, rotorBlur), 0, MOTOR_TOP + 0.028, ARM_TIP);

    rotors.push({ spinner, direction, trim: 0.97 + Math.random() * 0.06 });
  }

  /* ---------- landing gear ---------- */
  const legMountGeo = new RoundedBoxGeometry(0.09, 0.07, 0.09, 2, 0.015);
  const footGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.07, 16);
  const skidGeo = new THREE.CylinderGeometry(0.038, 0.038, 1.5, 18);
  const skidCapGeo = new THREE.SphereGeometry(0.042, 16, 10);
  for (const side of [-1, 1]) {
    const braceEnds: THREE.Vector3[] = [];
    for (const z of [-1, 1]) {
      const top = v3(side * 0.28, -0.12, z * 0.2);
      const foot = v3(side * 0.8, -1.12, z * 0.42);
      model.add(strut(top, foot, 0.03, carbonTube));
      place(model, mesh(legMountGeo, alloy), top.x, top.y, top.z);
      place(model, mesh(footGeo, alloy), foot.x, foot.y, foot.z);
      braceEnds.push(top.clone().lerp(foot, 0.56));
    }
    model.add(strut(braceEnds[0], braceEnds[1], 0.016, alloy));
    place(model, mesh(skidGeo, carbonTube), side * 0.8, -1.12, 0).rotation.x = Math.PI / 2;
    place(model, mesh(skidCapGeo, rubber), side * 0.8, -1.12, 0.75);
    place(model, mesh(skidCapGeo, rubber), side * 0.8, -1.12, -0.75);
  }

  /* ---------- stabilised camera gimbal ---------- */
  const gimbal = place(model, new THREE.Group(), 0, -0.14, 0.16);
  place(gimbal, mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 32), alloy));
  const damperGeo = new THREE.SphereGeometry(0.026, 12, 8);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    place(gimbal, mesh(damperGeo, accent), dx * 0.09, -0.03, dz * 0.09);
  }
  place(gimbal, mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 24), alloy), 0, -0.08, 0);
  place(gimbal, mesh(new RoundedBoxGeometry(0.38, 0.03, 0.07, 2, 0.01), alloy), 0, -0.13, 0);
  const yokeArmGeo = new RoundedBoxGeometry(0.03, 0.17, 0.07, 2, 0.01);
  place(gimbal, mesh(yokeArmGeo, alloy), -0.175, -0.21, 0);
  place(gimbal, mesh(yokeArmGeo, alloy), 0.175, -0.21, 0);

  const camera = place(gimbal, new THREE.Group(), 0, -0.25, 0);
  place(camera, mesh(new RoundedBoxGeometry(0.28, 0.19, 0.24, 3, 0.03), shell));
  place(camera, mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 32), alloy), 0, 0, 0.17).rotation.x = Math.PI / 2;
  place(camera, mesh(new THREE.TorusGeometry(0.079, 0.007, 8, 40), accent), 0, 0, 0.23);
  place(camera, mesh(new THREE.CircleGeometry(0.068, 40), lens), 0, 0, 0.231);
  place(camera, mesh(new THREE.SphereGeometry(0.012, 10, 6), rec), 0.1, 0.065, 0.121);

  return {
    root,
    rotors,
    gimbal,
    materials: { blade, rotorBlur, navRear, strobe, rec },
  };
}

export interface LandingPad {
  root: THREE.Group;
  /** Materials faded in/out together; each keeps its full opacity in `userData.baseOpacity`. */
  fadeMaterials: THREE.Material[];
  /** Materials tinted with the current section glow colour. */
  glowMaterials: THREE.MeshBasicMaterial[];
  /** Expanding rings that pulse once the drone has touched down. */
  ripples: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
  /** Soft contact shadow under the drone. */
  shadow: THREE.MeshBasicMaterial;
}

/** Helipad the drone lands on in the final section. Top surface sits at y = 0. */
export function createLandingPad(): LandingPad {
  const root = new THREE.Group();
  const flat = <G extends THREE.BufferGeometry>(geometry: G) => {
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  };
  const fadeMaterials: THREE.Material[] = [];
  const fading = <M extends THREE.Material>(material: M, baseOpacity: number) => {
    material.transparent = true;
    material.opacity = 0;
    material.userData.baseOpacity = baseOpacity;
    fadeMaterials.push(material);
    return material;
  };

  const base = fading(new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.5, roughness: 0.55 }), 0.92);
  place(root, mesh(flat(new THREE.CircleGeometry(1.75, 72)), base));

  const ring = fading(
    new THREE.MeshBasicMaterial({ color: 0xff6a20, blending: THREE.AdditiveBlending, depthWrite: false }),
    0.9,
  );
  place(root, mesh(flat(new THREE.RingGeometry(1.6, 1.68, 96)), ring), 0, 0.004, 0);

  const marking = fading(new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }), 0.35);
  const dashes = 16;
  for (let k = 0; k < dashes; k++) {
    const step = (Math.PI * 2) / dashes;
    place(root, mesh(flat(new THREE.RingGeometry(1.18, 1.22, 6, 1, k * step, step * 0.55)), marking), 0, 0.004, 0);
  }

  const letter = fading(new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }), 0.55);
  place(root, mesh(flat(new THREE.PlaneGeometry(0.13, 0.95)), letter), -0.3, 0.005, 0);
  place(root, mesh(flat(new THREE.PlaneGeometry(0.13, 0.95)), letter), 0.3, 0.005, 0);
  place(root, mesh(flat(new THREE.PlaneGeometry(0.6, 0.13)), letter), 0, 0.005, 0);

  const shadow = new THREE.MeshBasicMaterial({
    map: makeRadialTexture([[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  place(root, mesh(flat(new THREE.CircleGeometry(1.4, 48)), shadow), 0, 0.006, 0);

  const rippleGeo = flat(new THREE.RingGeometry(1.6, 1.64, 96));
  const ripples = [0, 1].map(() => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return place(root, new THREE.Mesh(rippleGeo, material), 0, 0.003, 0);
  });

  return {
    root,
    fadeMaterials,
    glowMaterials: [ring, ...ripples.map((r) => r.material)],
    ripples,
    shadow,
  };
}
