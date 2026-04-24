import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import {
  COMET_INTERVAL_MAX,
  COMET_INTERVAL_MIN,
  DEFAULT_HEAD_Z_CM,
  HEAD_STILL_DURATION,
  MOON_ORBIT_PERIOD,
  MOON_ORBIT_RADIUS,
  SCREEN_DIMENSIONS_CM,
  SPACE_WORLD_CONFIG,
  SUPERNOVA_INTERVAL_MAX,
  SUPERNOVA_INTERVAL_MIN,
  WARP_INTERVAL_MAX,
  WARP_INTERVAL_MIN,
} from "../shared/constants";
import { createSpaceAudio } from "../core/audio";
import type { EventPanner } from "../core/audio";
import { spaceBloomProfile } from "../shared/postfx";
import type { AppContext, FrameState, SceneModule, ViewportSize } from "../shared/types";

// ─── Shaders ─────────────────────────────────────────────────────────────────

const STAR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacityScale;
  attribute float aPhase;
  attribute float aSize;
  varying float vOpacity;

  void main() {
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.8 + aPhase);
    vOpacity = twinkle * uOpacityScale;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * twinkle * (180.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vOpacity;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv);
    if (dist > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.3, 0.5, dist)) * vOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rnd = (min: number, max: number): number => min + Math.random() * (max - min);

const makeNebulaTexture = (coreColor: string, outerColor: string): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
  gradient.addColorStop(0, coreColor);
  gradient.addColorStop(0.45, outerColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

const makePlanetTexture = (
  base: [number, number, number],
  detail: [number, number, number],
): CanvasTexture => {
  const SIZE = 256;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(SIZE, SIZE);
  const noise = new ImprovedNoise();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = x / SIZE;
      const ny = y / SIZE;
      let n = 0;
      let amp = 1;
      let freq = 1;
      for (let o = 0; o < 4; o++) {
        n += amp * noise.noise(nx * freq * 4, ny * freq * 4, 0.5);
        amp *= 0.5;
        freq *= 2;
      }
      const t = (n + 1) / 2;
      const idx = (y * SIZE + x) * 4;
      imageData.data[idx] = Math.round(base[0] * (1 - t) + detail[0] * t);
      imageData.data[idx + 1] = Math.round(base[1] * (1 - t) + detail[1] * t);
      imageData.data[idx + 2] = Math.round(base[2] * (1 - t) + detail[2] * t);
      imageData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

const makeCometTailTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.7, "rgba(200,230,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 32);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

type StarKind = "deep" | "shallow" | "warm";

const createStarGeometry = (count: number, kind: StarKind): BufferGeometry => {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const halfW = SCREEN_DIMENSIONS_CM.width / 2;
  const halfH = SCREEN_DIMENSIONS_CM.height / 2;
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    if (kind === "deep" || kind === "warm") {
      positions[idx] = rnd(-240, 240);
      positions[idx + 1] = rnd(-140, 140);
      positions[idx + 2] = rnd(SPACE_WORLD_CONFIG.deepStarZMin, SPACE_WORLD_CONFIG.deepStarZMax);
    } else {
      positions[idx + 2] = rnd(SPACE_WORLD_CONFIG.shallowStarZMin, SPACE_WORLD_CONFIG.shallowStarZMax);
      let sx: number, sy: number;
      do {
        sx = rnd(-halfW * 1.8, halfW * 1.8);
        sy = rnd(-halfH * 1.8, halfH * 1.8);
      } while (Math.abs(sx) < halfW * 0.95 && Math.abs(sy) < halfH * 0.95);
      positions[idx] = sx;
      positions[idx + 1] = sy;
    }
    phases[i] = Math.random() * Math.PI * 2;
    const r = Math.random();
    if (kind === "deep") {
      sizes[i] = r < 0.82 ? rnd(0.45, 1.35) : r < 0.96 ? rnd(1.35, 2.4) : rnd(2.4, 3.1);
    } else if (kind === "shallow") {
      sizes[i] = r < 0.72 ? rnd(2.1, 4.2) : r < 0.93 ? rnd(4.2, 7.2) : rnd(7.2, 9.5);
    } else {
      sizes[i] = rnd(0.9, 2.8);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geo.setAttribute("aSize", new BufferAttribute(sizes, 1));
  return geo;
};

const makeStarMaterial = (color: number): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(color) },
      uOpacityScale: { value: 1.0 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
  });

const createStation = (): Group => {
  const g = new Group();
  const hullMat = new MeshStandardMaterial({ color: 0x4a5060, roughness: 0.8, metalness: 0.55 });
  g.add(new Mesh(new CylinderGeometry(2.5, 2.5, 20, 10), hullMat));

  const armMat = new MeshStandardMaterial({ color: 0x3a4050, roughness: 0.85, metalness: 0.5 });
  [0, Math.PI / 2].forEach((ry) => {
    const arm = new Mesh(new CylinderGeometry(0.9, 0.9, 16, 8), armMat);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = ry;
    g.add(arm);
  });

  const panelMat = new MeshStandardMaterial({ color: 0x1a2c4a, roughness: 0.7, metalness: 0.45 });
  [-10, 10].forEach((px) => {
    const p = new Mesh(new BoxGeometry(0.3, 7, 12), panelMat);
    p.position.set(px, 0, 0);
    g.add(p);
  });

  const winMat = new MeshStandardMaterial({
    color: 0xffaa22,
    emissive: 0xffaa22,
    emissiveIntensity: 2.5,
  });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const w = new Mesh(new BoxGeometry(0.35, 0.35, 0.2), winMat);
    w.position.set(Math.cos(a) * 2.65, rnd(-8, 8), Math.sin(a) * 2.65);
    g.add(w);
  }

  // Tunable starting position — adjust after pan feel is confirmed
  g.position.set(90, -5, -125);
  g.rotation.y = 0.4;
  return g;
};

// ─── World ────────────────────────────────────────────────────────────────────

export const createSpaceWorld = (): SceneModule => {
  let sceneCtx: AppContext | null = null;
  let time = 0;

  // Scene group (all world objects, rotated by drag pan)
  let sceneGroup: Group | null = null;

  // Drag/inertia state
  let panRotation = { y: 0 };
  let dragVelocity = { y: 0 };
  let isDragging = false;
  let lastPointer = { x: 0, y: 0 };
  const PAN_MAX_Y = Math.PI / 3;
  const DRAG_SENSITIVITY = 0.006;

  // Stars
  let deepStars: Points | null = null;
  let shallowStars: Points | null = null;
  let warmStars: Points | null = null;

  // Nebula
  let nebulaTextures: CanvasTexture[] = [];
  let nebulaLayers: Mesh[] = [];
  let nebulaBaseOpacities: number[] = [];

  // Scene objects
  let portalRing: Mesh | null = null;
  let planetNear: Mesh | null = null;
  let planetFar: Mesh | null = null;
  let moon: Mesh | null = null;
  let moonOrbitAngle = 0;
  let station: Group | null = null;
  let rimNear: PointLight | null = null;
  let rimFar: PointLight | null = null;
  let ambient: AmbientLight | null = null;
  let directional: DirectionalLight | null = null;
  let planetTextures: CanvasTexture[] = [];

  // Warp pool
  let warpPool: Array<{ mesh: Mesh; state: "idle" | "animating"; elapsed: number; duration: number }> = [];
  let warpSpawnTimer = 0;
  let warpNextSpawn = rnd(WARP_INTERVAL_MIN, WARP_INTERVAL_MAX);
  let ringFlashTimer = 0;

  // Audio
  let audio: ReturnType<typeof createSpaceAudio> | null = null;
  let cometPanner: EventPanner | null = null;
  let supernovaPanner: EventPanner | null = null;
  let shootingPanner: EventPanner | null = null;
  let warpPanner: EventPanner | null = null;

  // Comet
  let cometGroup: Group | null = null;
  let cometNucleus: Mesh | null = null;
  let cometTailTex: CanvasTexture | null = null;
  let cometActive = false;
  let cometElapsed = 0;
  let cometDuration = 5;
  let cometTimer = 0;
  let cometNextAt = rnd(COMET_INTERVAL_MIN, COMET_INTERVAL_MAX);
  const cometStartPos = new Vector3();
  const cometEndPos = new Vector3();

  // Supernova
  let supernovaMesh: Mesh | null = null;
  let supernovaElapsed = -1;
  let supernovaTimer = 0;
  let supernovaNextAt = rnd(SUPERNOVA_INTERVAL_MIN, SUPERNOVA_INTERVAL_MAX);

  // Shooting star
  let shootingStarMesh: Mesh | null = null;
  let shootingStarActive = false;
  let shootingStarElapsed = 0;
  let headStillTimer = 0;
  let prevHeadX = 0;
  let prevHeadY = 0;

  // Arrival sequence
  type ArrivalPhase = "warp" | "transition" | "zoom" | "done";
  let arrivalPhase: ArrivalPhase = "warp";
  let arrivalElapsed = 0;
  let arrivalOverlay: Mesh | null = null;
  let arrivalWarpMeshes: Mesh[] = [];
  let arrivalSoundPlayed = false;

  // ─── Pointer handlers ──────────────────────────────────────────────────────

  const onPointerDown = (e: PointerEvent): void => {
    if (arrivalPhase !== "done") return;
    isDragging = true;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointer.x;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    dragVelocity.y = dx * DRAG_SENSITIVITY;
    panRotation.y = MathUtils.clamp(panRotation.y + dragVelocity.y, -PAN_MAX_Y, PAN_MAX_Y);
  };
  const onPointerUp = (): void => {
    isDragging = false;
  };

  // ─── Comet spawn ───────────────────────────────────────────────────────────

  const spawnComet = (): void => {
    const fromLeft = Math.random() < 0.5;
    cometStartPos.set(
      fromLeft ? rnd(-150, -90) : rnd(90, 150),
      rnd(-20, 30),
      rnd(-200, -120),
    );
    cometEndPos.set(
      fromLeft ? rnd(90, 150) : rnd(-150, -90),
      rnd(-20, 15),
      rnd(-160, -80),
    );
    cometDuration = rnd(4.5, 6.5);
    cometElapsed = 0;
    cometActive = true;
    if (cometGroup) {
      cometGroup.position.copy(cometStartPos);
      cometGroup.visible = true;
      // Orient so tail faces away from travel direction
      cometGroup.lookAt(cometEndPos);
    }
    cometPanner?.playBurst("comet");
  };

  // ─── Disposal helpers ──────────────────────────────────────────────────────

  const disposeMesh = (mesh: Mesh | null): void => {
    if (!mesh || !sceneCtx) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m: Material) => m.dispose());
    } else {
      mesh.material.dispose();
    }
    sceneCtx.scene.remove(mesh);
  };

  const disposePoints = (pts: Points | null): void => {
    if (!pts || !sceneCtx) return;
    pts.geometry.dispose();
    if (Array.isArray(pts.material)) {
      pts.material.forEach((m: Material) => m.dispose());
    } else {
      pts.material.dispose();
    }
    sceneCtx.scene.remove(pts);
  };

  const disposeGroup = (grp: Group | null): void => {
    if (!grp || !sceneCtx) return;
    grp.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m: Material) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    sceneGroup?.remove(grp);
  };

  // ──────────────────────────────────────────────────────────────────────────

  return {
    init(ctx) {
      sceneCtx = ctx;
      time = 0;
      arrivalPhase = "warp";
      arrivalElapsed = 0;
      arrivalSoundPlayed = false;
      panRotation = { y: 0 };
      dragVelocity = { y: 0 };
      moonOrbitAngle = 0;
      headStillTimer = 0;
      prevHeadX = 0;
      prevHeadY = 0;
      warpSpawnTimer = 0;
      warpNextSpawn = rnd(WARP_INTERVAL_MIN, WARP_INTERVAL_MAX);
      ringFlashTimer = 0;

      ctx.setBloom(spaceBloomProfile);
      ctx.scene.background = new Color(0x04060c);

      // Audio
      audio = createSpaceAudio();
      audio.resumeOnInteraction();
      cometPanner = audio.createEventPanner();
      supernovaPanner = audio.createEventPanner();
      shootingPanner = audio.createEventPanner();
      warpPanner = audio.createEventPanner();

      // Scene group
      sceneGroup = new Group();
      ctx.scene.add(sceneGroup);

      // Lights
      ambient = new AmbientLight(0xb9c7ff, 0.22);
      directional = new DirectionalLight(0x9fc4ff, 1.15);
      directional.position.set(24, 18, 30);
      rimNear = new PointLight(0xff7733, 1.5, 60);
      rimNear.position.set(-45, 5, -70);
      rimFar = new PointLight(0x33ffee, 1.2, 90);
      rimFar.position.set(65, -20, -230);
      sceneGroup.add(ambient, directional, rimNear, rimFar);

      // Stars
      deepStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.deepStarCount, "deep"),
        makeStarMaterial(0xc9dbff),
      );
      shallowStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.shallowStarCount, "shallow"),
        makeStarMaterial(0xddf0ff),
      );
      warmStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.warmStarCount, "warm"),
        makeStarMaterial(0xffcc88),
      );
      sceneGroup.add(deepStars, shallowStars, warmStars);

      // Nebula cloud clusters — 3 sprites per region
      const nebulaDefs = [
        {
          coreColor: "rgba(165,95,210,0.42)",
          outerColor: "rgba(96,28,132,0.12)",
          size: 190,
          pos: [-24, 10, -195] as [number, number, number],
          rot: 0.12,
          opacity: 0.072,
        },
        {
          coreColor: "rgba(110,208,188,0.36)",
          outerColor: "rgba(45,123,105,0.10)",
          size: 150,
          pos: [54, 26, -135] as [number, number, number],
          rot: -0.28,
          opacity: 0.052,
        },
        {
          coreColor: "rgba(245,172,95,0.30)",
          outerColor: "rgba(120,62,20,0.09)",
          size: 120,
          pos: [-20, 10, -103] as [number, number, number],
          rot: 0.38,
          opacity: 0.043,
        },
      ];

      for (const def of nebulaDefs) {
        for (let s = 0; s < 3; s++) {
          const tex = makeNebulaTexture(def.coreColor, def.outerColor);
          nebulaTextures.push(tex);
          const size = def.size * rnd(0.5, 0.85);
          const baseOpacity = def.opacity * rnd(0.7, 1.2);
          const mesh = new Mesh(
            new PlaneGeometry(size, size),
            new MeshBasicMaterial({
              map: tex,
              transparent: true,
              opacity: baseOpacity,
              blending: AdditiveBlending,
              depthWrite: false,
              side: DoubleSide,
            }),
          );
          mesh.position.set(
            def.pos[0] + rnd(-def.size * 0.25, def.size * 0.25),
            def.pos[1] + rnd(-def.size * 0.1, def.size * 0.1),
            def.pos[2] + rnd(-12, 12),
          );
          mesh.rotation.z = def.rot + rnd(-0.4, 0.4);
          nebulaLayers.push(mesh);
          nebulaBaseOpacities.push(baseOpacity);
          sceneGroup.add(mesh);
        }
      }

      // Portal ring
      const ringZ = -10;
      const ringDepth = DEFAULT_HEAD_Z_CM - ringZ;
      const halfW = SCREEN_DIMENSIONS_CM.width / 2;
      const halfH = SCREEN_DIMENSIONS_CM.height / 2;
      const ringRadius = Math.hypot(
        (halfW * ringDepth) / DEFAULT_HEAD_Z_CM,
        (halfH * ringDepth) / DEFAULT_HEAD_Z_CM,
      );
      portalRing = new Mesh(
        new TorusGeometry(ringRadius, 1.8, 24, 120),
        new MeshStandardMaterial({
          color: 0x6fa8ff,
          emissive: 0x1f59d9,
          emissiveIntensity: 4.0,
          roughness: 0.35,
          metalness: 0.22,
        }),
      );
      portalRing.position.set(0, 0, ringZ);
      sceneGroup.add(portalRing);

      // Planets — −30% size, procedural texture
      const nearTex = makePlanetTexture([180, 110, 60], [120, 60, 20]);
      const farTex = makePlanetTexture([50, 130, 180], [20, 60, 100]);
      planetTextures = [nearTex, farTex];

      planetNear = new Mesh(
        new SphereGeometry(8.6, 40, 40),
        new MeshStandardMaterial({
          map: nearTex,
          color: 0xd4783c,
          emissive: 0x3a1000,
          roughness: 0.78,
          metalness: 0.06,
        }),
      );
      planetNear.position.set(-18, 11, SPACE_WORLD_CONFIG.planetNearZ);

      planetFar = new Mesh(
        new SphereGeometry(6.0, 40, 40),
        new MeshStandardMaterial({
          map: farTex,
          color: 0x3a9fc8,
          emissive: 0x0a2535,
          roughness: 0.72,
          metalness: 0.12,
        }),
      );
      planetFar.position.set(24, -8, SPACE_WORLD_CONFIG.planetFarZ);
      sceneGroup.add(planetNear, planetFar);

      // Moon
      const moonTex = makePlanetTexture([130, 120, 110], [80, 75, 70]);
      planetTextures.push(moonTex);
      moon = new Mesh(
        new SphereGeometry(1.6, 20, 20),
        new MeshStandardMaterial({ map: moonTex, roughness: 0.9, metalness: 0.0 }),
      );
      sceneGroup.add(moon);

      // Derelict station
      station = createStation();
      sceneGroup.add(station);

      // Warp pool
      warpPool = Array.from({ length: 3 }).map(() => {
        const mesh = new Mesh(
          new PlaneGeometry(28, 0.65),
          new MeshBasicMaterial({
            color: 0xe8f4ff,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
          }),
        );
        mesh.visible = false;
        mesh.position.set(0, 0, -100);
        sceneGroup!.add(mesh);
        return { mesh, state: "idle" as const, elapsed: 0, duration: 0.45 };
      });

      // Comet
      cometTailTex = makeCometTailTexture();
      cometNucleus = new Mesh(
        new SphereGeometry(1.0, 12, 12),
        new MeshStandardMaterial({ color: 0xeef8ff, emissive: 0x88ccff, emissiveIntensity: 3.0 }),
      );
      const cometTail = new Mesh(
        new PlaneGeometry(28, 1.8),
        new MeshBasicMaterial({
          map: cometTailTex,
          transparent: true,
          opacity: 0.7,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      cometTail.position.x = -14;
      cometGroup = new Group();
      cometGroup.add(cometNucleus, cometTail);
      cometGroup.visible = false;
      sceneGroup.add(cometGroup);

      // Supernova
      supernovaMesh = new Mesh(
        new SphereGeometry(1, 16, 16),
        new MeshBasicMaterial({
          color: 0xffeedd,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      supernovaMesh.visible = false;
      sceneGroup.add(supernovaMesh);

      // Shooting star
      shootingStarMesh = new Mesh(
        new PlaneGeometry(45, 0.25),
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      shootingStarMesh.visible = false;
      sceneGroup.add(shootingStarMesh);

      // Arrival overlay — parented to camera so it stays in front
      arrivalOverlay = new Mesh(
        new PlaneGeometry(200, 150),
        new MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 1.0,
          depthTest: false,
        }),
      );
      arrivalOverlay.position.z = -1.5;
      arrivalOverlay.renderOrder = 100;
      ctx.camera.add(arrivalOverlay);

      // Arrival warp streak pool — in ctx.scene (not sceneGroup, unaffected by zoom)
      arrivalWarpMeshes = Array.from({ length: 40 }).map(() => {
        const baseOpacity = rnd(0.4, 0.9);
        const w = rnd(20, 60);
        const mesh = new Mesh(
          new PlaneGeometry(w, 0.18),
          new MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: baseOpacity,
            blending: AdditiveBlending,
            depthWrite: false,
          }),
        );
        mesh.position.set(rnd(-60, 60), rnd(-35, 35), rnd(-180, -40));
        mesh.rotation.z = rnd(-0.15, 0.15);
        mesh.userData.baseOpacity = baseOpacity;
        ctx.scene.add(mesh);
        return mesh;
      });

      // Stars start invisible during arrival warp phase
      (deepStars.material as ShaderMaterial).uniforms.uOpacityScale.value = 0;
      (shallowStars.material as ShaderMaterial).uniforms.uOpacityScale.value = 0;
      (warmStars.material as ShaderMaterial).uniforms.uOpacityScale.value = 0;

      // Pointer events
      const el = ctx.renderer.domElement;
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointercancel", onPointerUp);
    },

    update(dt: number, frameState: FrameState) {
      if (!sceneCtx || !sceneGroup) return;
      time += dt;
      audio?.update(dt);

      // ── Arrival sequence ────────────────────────────────────────────────────
      if (arrivalPhase !== "done") {
        arrivalElapsed += dt;

        if (arrivalPhase === "warp") {
          // 0–1.2s: black overlay + warp streaks, stars hidden
          if (!arrivalSoundPlayed) {
            arrivalSoundPlayed = true;
            audio?.playArrivalBurst();
          }
          if (arrivalElapsed >= 1.2) {
            arrivalPhase = "transition";
            arrivalElapsed = 0;
          }
        } else if (arrivalPhase === "transition") {
          // 1.2–2.4s: shrink warp streaks, stars fade in
          const t = MathUtils.clamp(arrivalElapsed / 1.2, 0, 1);
          arrivalWarpMeshes.forEach((m) => {
            m.scale.x = 1 - t;
            const baseOpacity =
              typeof m.userData.baseOpacity === "number" ? m.userData.baseOpacity : 0.7;
            (m.material as MeshBasicMaterial).opacity = (1 - t) * baseOpacity;
          });
          const starFade = t;
          (deepStars!.material as ShaderMaterial).uniforms.uOpacityScale.value = starFade;
          (shallowStars!.material as ShaderMaterial).uniforms.uOpacityScale.value = starFade;
          (warmStars!.material as ShaderMaterial).uniforms.uOpacityScale.value = starFade;
          if (arrivalElapsed >= 1.2) {
            arrivalPhase = "zoom";
            arrivalElapsed = 0;
            // Hide and remove warp streaks
            arrivalWarpMeshes.forEach((m) => {
              (m.material as MeshBasicMaterial).opacity = 0;
              m.visible = false;
              sceneCtx!.scene.remove(m);
            });
          }
        } else if (arrivalPhase === "zoom") {
          // 2.4–4.0s: overlay fades, sceneGroup scales 1.4→1.0
          const t = MathUtils.clamp(arrivalElapsed / 1.6, 0, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          sceneGroup.scale.setScalar(MathUtils.lerp(1.4, 1.0, ease));
          if (arrivalOverlay) {
            (arrivalOverlay.material as MeshBasicMaterial).opacity = 1 - ease;
          }
          if (arrivalElapsed >= 1.6) {
            arrivalPhase = "done";
            sceneGroup.scale.setScalar(1.0);
            if (arrivalOverlay) {
              sceneCtx.camera.remove(arrivalOverlay);
              arrivalOverlay.geometry.dispose();
              (arrivalOverlay.material as MeshBasicMaterial).dispose();
              arrivalOverlay = null;
            }
            // Dispose arrival warp meshes geometry/material
            arrivalWarpMeshes.forEach((m) => {
              m.geometry.dispose();
              (m.material as MeshBasicMaterial).dispose();
            });
            arrivalWarpMeshes = [];
          }
        }
        if (arrivalPhase !== "done") {
          // Still in arrival — skip rest of update except star twinkle time
          if (deepStars) (deepStars.material as ShaderMaterial).uniforms.uTime.value = time;
          if (shallowStars) (shallowStars.material as ShaderMaterial).uniforms.uTime.value = time;
          if (warmStars) (warmStars.material as ShaderMaterial).uniforms.uTime.value = time;
          return;
        }
      }

      // ── Drag/inertia ────────────────────────────────────────────────────────
      if (!isDragging) {
        const decay = Math.exp(-3.5 * dt);
        dragVelocity.y *= decay;
        panRotation.y = MathUtils.clamp(panRotation.y + dragVelocity.y, -PAN_MAX_Y, PAN_MAX_Y);
      }
      sceneGroup.rotation.x = 0;
      sceneGroup.rotation.y = panRotation.y;

      // ── Stars ───────────────────────────────────────────────────────────────
      if (deepStars) (deepStars.material as ShaderMaterial).uniforms.uTime.value = time;
      if (shallowStars) (shallowStars.material as ShaderMaterial).uniforms.uTime.value = time;
      if (warmStars) (warmStars.material as ShaderMaterial).uniforms.uTime.value = time;
      if (deepStars) deepStars.rotation.z += dt * 0.003;
      if (shallowStars) shallowStars.rotation.z -= dt * 0.004;

      // ── Planets ─────────────────────────────────────────────────────────────
      if (planetNear) planetNear.rotation.y += dt * 0.18;
      if (planetFar) planetFar.rotation.y += dt * 0.07;

      // ── Moon orbit ──────────────────────────────────────────────────────────
      if (moon && planetNear) {
        moonOrbitAngle += (Math.PI * 2 / MOON_ORBIT_PERIOD) * dt;
        const mx = Math.cos(moonOrbitAngle) * MOON_ORBIT_RADIUS;
        const mz = Math.sin(moonOrbitAngle) * MOON_ORBIT_RADIUS;
        const my = Math.sin(moonOrbitAngle) * Math.sin(Math.PI / 12) * MOON_ORBIT_RADIUS;
        moon.position.set(
          planetNear.position.x + mx,
          planetNear.position.y + my,
          planetNear.position.z + mz,
        );
      }

      // ── Station rotation ─────────────────────────────────────────────────
      if (station) station.rotation.y += dt * 0.03;

      // ── Nebula breathing ────────────────────────────────────────────────────
      nebulaLayers.forEach((layer, idx) => {
        const mat = layer.material as MeshBasicMaterial;
        const phase = idx * ((Math.PI * 2) / 9);
        mat.opacity =
          nebulaBaseOpacities[idx]! * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(time * 0.6 + phase)));
        const dir = idx % 2 === 0 ? 1 : -1;
        layer.rotation.z += dt * 0.004 * dir;
        layer.position.x += dt * 0.4 * dir;
        if (layer.position.x > 120) layer.position.x = -120;
        else if (layer.position.x < -120) layer.position.x = 120;
      });

      // ── Portal ring pulse ────────────────────────────────────────────────
      if (portalRing) {
        const baseIntensity = ringFlashTimer > 0 ? MathUtils.lerp(12, 4.0, 1 - ringFlashTimer / 0.5) : 4.0;
        if (ringFlashTimer > 0) ringFlashTimer = Math.max(0, ringFlashTimer - dt);
        (portalRing.material as MeshStandardMaterial).emissiveIntensity =
          baseIntensity + 1.8 * Math.sin(time * 0.9);
      }

      // ── Warp pool ────────────────────────────────────────────────────────
      warpSpawnTimer += dt;
      if (warpSpawnTimer >= warpNextSpawn) {
        const idle = warpPool.find((e) => e.state === "idle");
        if (idle) {
          idle.state = "animating";
          idle.elapsed = 0;
          idle.duration = rnd(0.3, 0.55);
          idle.mesh.visible = true;
          idle.mesh.position.set(rnd(-80, 80), rnd(-45, 45), rnd(-160, -60));
          idle.mesh.rotation.z = rnd(-0.3, 0.3);
          (idle.mesh.material as MeshBasicMaterial).opacity = 0;
          idle.mesh.scale.set(1, 1, 1);
          const wp = new Vector3();
          idle.mesh.getWorldPosition(wp);
          warpPanner?.setPosition(wp.x * 0.05, wp.y * 0.05, wp.z * 0.05);
          warpPanner?.playBurst("warpStreak");
        }
        warpSpawnTimer = 0;
        warpNextSpawn = rnd(WARP_INTERVAL_MIN, WARP_INTERVAL_MAX);
      }

      warpPool.forEach((entry) => {
        if (entry.state !== "animating") return;
        entry.elapsed += dt;
        const t = Math.min(entry.elapsed / entry.duration, 1);
        (entry.mesh.material as MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.92;
        entry.mesh.scale.x = MathUtils.lerp(1, 2.8, t);
        const prevZ = entry.mesh.position.z;
        entry.mesh.position.z += dt * 190;
        const wp = new Vector3();
        entry.mesh.getWorldPosition(wp);
        warpPanner?.setPosition(wp.x * 0.05, wp.y * 0.05, wp.z * 0.05);
        // Ring flash trigger when warp streak crosses ring plane
        if (prevZ < -10 && entry.mesh.position.z >= -10 && ringFlashTimer <= 0) {
          ringFlashTimer = 0.5;
        }
        if (t >= 1) {
          entry.state = "idle";
          entry.mesh.visible = false;
          entry.mesh.position.z = -100;
          (entry.mesh.material as MeshBasicMaterial).opacity = 0;
        }
      });

      // ── Comet ────────────────────────────────────────────────────────────
      cometTimer += dt;
      if (!cometActive && cometTimer >= cometNextAt) {
        cometTimer = 0;
        cometNextAt = rnd(COMET_INTERVAL_MIN, COMET_INTERVAL_MAX);
        spawnComet();
      }
      if (cometActive && cometGroup) {
        cometElapsed += dt;
        const t = MathUtils.clamp(cometElapsed / cometDuration, 0, 1);
        cometGroup.position.lerpVectors(cometStartPos, cometEndPos, t);
        const fadeOpacity = Math.sin(t * Math.PI);
        if (cometNucleus) {
          (cometNucleus.material as MeshStandardMaterial).emissiveIntensity = 3.0 * fadeOpacity;
        }
        // Update panner position using world position
        const tmp = new Vector3();
        cometGroup.getWorldPosition(tmp);
        cometPanner?.setPosition(tmp.x * 0.05, tmp.y * 0.05, tmp.z * 0.05);
        if (t >= 1) {
          cometActive = false;
          cometGroup.visible = false;
        }
      }

      // ── Supernova ────────────────────────────────────────────────────────
      supernovaTimer += dt;
      if (supernovaElapsed < 0 && supernovaTimer >= supernovaNextAt) {
        supernovaTimer = 0;
        supernovaNextAt = rnd(SUPERNOVA_INTERVAL_MIN, SUPERNOVA_INTERVAL_MAX);
        supernovaElapsed = 0;
        if (supernovaMesh) {
          supernovaMesh.position.set(rnd(-150, 150), rnd(-100, 100), rnd(-280, -100));
          supernovaMesh.visible = true;
          supernovaMesh.scale.setScalar(1);
          const tmp2 = new Vector3();
          supernovaMesh.getWorldPosition(tmp2);
          supernovaPanner?.setPosition(tmp2.x * 0.05, tmp2.y * 0.05, tmp2.z * 0.05);
          supernovaPanner?.playBurst("supernova");
        }
      }
      if (supernovaElapsed >= 0) {
        supernovaElapsed += dt;
        const t = MathUtils.clamp(supernovaElapsed / 4.0, 0, 1);
        if (t >= 1) {
          supernovaElapsed = -1;
          if (supernovaMesh) {
            supernovaMesh.visible = false;
            (supernovaMesh.material as MeshBasicMaterial).opacity = 0;
          }
        } else {
          const scale = 1 + t * 25;
          const opacity = t < 0.15 ? t / 0.15 : (1 - t) * 0.65;
          if (supernovaMesh) {
            supernovaMesh.scale.setScalar(scale);
            (supernovaMesh.material as MeshBasicMaterial).opacity = opacity;
          }
        }
      }

      // ── Shooting star (head stillness) ─────────────────────────────────
      const head = frameState.headPose;
      if (head) {
        const moved = Math.abs(head.x - prevHeadX) > 2 || Math.abs(head.y - prevHeadY) > 2;
        if (moved) {
          headStillTimer = 0;
          prevHeadX = head.x;
          prevHeadY = head.y;
        } else {
          headStillTimer += dt;
          if (headStillTimer >= HEAD_STILL_DURATION && !shootingStarActive) {
            shootingStarActive = true;
            shootingStarElapsed = 0;
            headStillTimer = 0;
            if (shootingStarMesh) {
              shootingStarMesh.position.set(rnd(-40, 0), rnd(10, 25), -95);
              shootingStarMesh.rotation.z = rnd(-0.4, 0.1);
              shootingStarMesh.visible = true;
              const sp = new Vector3();
              shootingStarMesh.getWorldPosition(sp);
              shootingPanner?.setPosition(sp.x * 0.05, sp.y * 0.05, sp.z * 0.05);
              shootingPanner?.playBurst("shootingStar");
            }
          }
        }
      }
      if (shootingStarActive && shootingStarMesh) {
        shootingStarElapsed += dt;
        const t = MathUtils.clamp(shootingStarElapsed / 0.65, 0, 1);
        shootingStarMesh.position.x += 80 * dt / 0.65;
        shootingStarMesh.position.y -= 20 * dt / 0.65;
        (shootingStarMesh.material as MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.9;
        const sp = new Vector3();
        shootingStarMesh.getWorldPosition(sp);
        shootingPanner?.setPosition(sp.x * 0.05, sp.y * 0.05, sp.z * 0.05);
        if (t >= 1) {
          shootingStarActive = false;
          shootingStarMesh.visible = false;
          (shootingStarMesh.material as MeshBasicMaterial).opacity = 0;
        }
      }
    },

    resize(_size: ViewportSize) {},

    dispose() {
      if (!sceneCtx) return;

      // Remove pointer listeners
      const el = sceneCtx.renderer.domElement;
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);

      // Arrival overlay
      if (arrivalOverlay) {
        sceneCtx.camera.remove(arrivalOverlay);
        arrivalOverlay.geometry.dispose();
        (arrivalOverlay.material as MeshBasicMaterial).dispose();
        arrivalOverlay = null;
      }

      // Arrival warp meshes
      arrivalWarpMeshes.forEach((m) => {
        sceneCtx!.scene.remove(m);
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      });
      arrivalWarpMeshes = [];

      // Points
      disposePoints(deepStars);
      disposePoints(shallowStars);
      disposePoints(warmStars);
      deepStars = null;
      shallowStars = null;
      warmStars = null;

      // Nebula
      nebulaLayers.forEach((l) => {
        l.geometry.dispose();
        (l.material as MeshBasicMaterial).dispose();
        sceneGroup?.remove(l);
      });
      nebulaTextures.forEach((t) => t.dispose());
      nebulaLayers = [];
      nebulaTextures = [];
      nebulaBaseOpacities = [];

      // Planet textures
      planetTextures.forEach((t) => t.dispose());
      planetTextures = [];

      // Warp pool
      warpPool.forEach((e) => {
        e.mesh.geometry.dispose();
        (e.mesh.material as MeshBasicMaterial).dispose();
        sceneGroup?.remove(e.mesh);
      });
      warpPool = [];

      // Scene meshes
      if (portalRing) {
        portalRing.geometry.dispose();
        (portalRing.material as MeshStandardMaterial).dispose();
        sceneGroup?.remove(portalRing);
        portalRing = null;
      }
      if (planetNear) {
        planetNear.geometry.dispose();
        (planetNear.material as MeshStandardMaterial).dispose();
        sceneGroup?.remove(planetNear);
        planetNear = null;
      }
      if (planetFar) {
        planetFar.geometry.dispose();
        (planetFar.material as MeshStandardMaterial).dispose();
        sceneGroup?.remove(planetFar);
        planetFar = null;
      }
      if (moon) {
        moon.geometry.dispose();
        (moon.material as MeshStandardMaterial).dispose();
        sceneGroup?.remove(moon);
        moon = null;
      }

      disposeGroup(station);
      station = null;

      if (cometGroup) {
        disposeGroup(cometGroup);
        cometGroup = null;
        cometNucleus = null;
      }
      if (cometTailTex) { cometTailTex.dispose(); cometTailTex = null; }

      if (supernovaMesh) {
        supernovaMesh.geometry.dispose();
        (supernovaMesh.material as MeshBasicMaterial).dispose();
        sceneGroup?.remove(supernovaMesh);
        supernovaMesh = null;
      }
      if (shootingStarMesh) {
        shootingStarMesh.geometry.dispose();
        (shootingStarMesh.material as MeshBasicMaterial).dispose();
        sceneGroup?.remove(shootingStarMesh);
        shootingStarMesh = null;
      }

      // Lights
      if (ambient) { sceneGroup?.remove(ambient); ambient = null; }
      if (directional) { sceneGroup?.remove(directional); directional = null; }
      if (rimNear) { sceneGroup?.remove(rimNear); rimNear = null; }
      if (rimFar) { sceneGroup?.remove(rimFar); rimFar = null; }

      // Remove sceneGroup
      if (sceneGroup) {
        sceneCtx.scene.remove(sceneGroup);
        sceneGroup = null;
      }

      // Audio
      cometPanner?.dispose();
      supernovaPanner?.dispose();
      shootingPanner?.dispose();
      warpPanner?.dispose();
      cometPanner = null;
      supernovaPanner = null;
      shootingPanner = null;
      warpPanner = null;
      audio?.dispose();
      audio = null;

      sceneCtx.setBloom(null);
      sceneCtx = null;
    },
  };
};
