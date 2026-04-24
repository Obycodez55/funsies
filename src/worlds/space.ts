import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { DEFAULT_HEAD_Z_CM, SCREEN_DIMENSIONS_CM, SPACE_WORLD_CONFIG } from "../shared/constants";
import { createSpaceDrone } from "../core/audio";
import { spaceBloomProfile } from "../shared/postfx";
import type { AppContext, FrameState, SceneModule, ViewportSize } from "../shared/types";

// --- Shaders ---

const STAR_VERT = /* glsl */ `
  uniform float uTime;
  attribute float aPhase;
  attribute float aSize;
  varying float vOpacity;

  void main() {
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.8 + aPhase);
    vOpacity = twinkle;
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

// --- Helpers ---

const randomInRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const makeNebulaTexture = (coreColor: string, outerColor: string): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context for nebula texture.");
  const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
  gradient.addColorStop(0, coreColor);
  gradient.addColorStop(0.45, outerColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
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
    let x = 0;
    let y = 0;
    let z = 0;

    if (kind === "deep" || kind === "warm") {
      x = randomInRange(-240, 240);
      y = randomInRange(-140, 140);
      z = randomInRange(SPACE_WORLD_CONFIG.deepStarZMin, SPACE_WORLD_CONFIG.deepStarZMax);
    } else {
      z = randomInRange(SPACE_WORLD_CONFIG.shallowStarZMin, SPACE_WORLD_CONFIG.shallowStarZMax);
      do {
        x = randomInRange(-halfW * 1.8, halfW * 1.8);
        y = randomInRange(-halfH * 1.8, halfH * 1.8);
      } while (Math.abs(x) < halfW * 0.95 && Math.abs(y) < halfH * 0.95);
    }

    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    phases[i] = Math.random() * Math.PI * 2;

    const r = Math.random();
    if (kind === "deep") {
      // Mostly tiny pinpricks, few medium, very few large
      if (r < 0.82) sizes[i] = randomInRange(0.6, 1.8);
      else if (r < 0.96) sizes[i] = randomInRange(1.8, 3.2);
      else sizes[i] = randomInRange(3.2, 5.0);
    } else if (kind === "shallow") {
      // Noticeably larger than deep — the parallax payoff layer
      if (r < 0.72) sizes[i] = randomInRange(1.4, 3.0);
      else if (r < 0.93) sizes[i] = randomInRange(3.0, 5.0);
      else sizes[i] = randomInRange(5.0, 7.5);
    } else {
      // Warm accents — medium, scattered through deep field
      sizes[i] = randomInRange(0.9, 2.8);
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
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
  });

// --- World ---

export const createSpaceWorld = (): SceneModule => {
  let sceneCtx: AppContext | null = null;
  let time = 0;

  let deepStars: Points | null = null;
  let shallowStars: Points | null = null;
  let warmStars: Points | null = null;
  let nebulaTextures: CanvasTexture[] = [];
  let nebulaLayers: Mesh[] = [];
  let nebulaBaseOpacities: number[] = [];
  let warpPool: Array<{
    mesh: Mesh;
    state: "idle" | "animating";
    elapsed: number;
    duration: number;
  }> = [];
  let warpSpawnTimer = 0;
  let warpNextSpawn = 1.5;
  let drone: ReturnType<typeof createSpaceDrone> | null = null;
  let portalRing: Mesh | null = null;
  let planetNear: Mesh | null = null;
  let planetFar: Mesh | null = null;
  let ambient: AmbientLight | null = null;
  let directional: DirectionalLight | null = null;

  return {
    init(ctx) {
      sceneCtx = ctx;
      time = 0;
      ctx.setBloom(spaceBloomProfile);
      ctx.scene.background = new Color(0x04060c);
      drone = createSpaceDrone();
      drone.resumeOnInteraction();

      ambient = new AmbientLight(0xb9c7ff, 0.22);
      directional = new DirectionalLight(0x9fc4ff, 1.15);
      directional.position.set(24, 18, 30);

      // Stars — per-vertex twinkling via ShaderMaterial
      deepStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.deepStarCount, "deep"),
        makeStarMaterial(0xc9dbff),
      );
      shallowStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.shallowStarCount, "shallow"),
        makeStarMaterial(0xddf0ff), // slightly brighter/cooler than deep
      );
      warmStars = new Points(
        createStarGeometry(SPACE_WORLD_CONFIG.warmStarCount, "warm"),
        makeStarMaterial(0xffcc88),
      );

      // Nebula layers — 2 cool + 1 red-purple for colour break
      const nebulaDefs = [
        {
          texture: makeNebulaTexture("rgba(100,140,255,0.45)", "rgba(55,80,180,0.10)"),
          size: 155,
          pos: [-65, 20, -130] as const,
          rot: 0.22,
          opacity: 0.065,
        },
        {
          texture: makeNebulaTexture("rgba(155,115,255,0.40)", "rgba(88,50,165,0.10)"),
          size: 195,
          pos: [72, -10, -205] as const,
          rot: -0.33,
          opacity: 0.055,
        },
        {
          texture: makeNebulaTexture("rgba(210,65,115,0.38)", "rgba(125,30,70,0.09)"),
          size: 115,
          pos: [12, 28, -92] as const,
          rot: 0.55,
          opacity: 0.05,
        },
      ];

      nebulaTextures = nebulaDefs.map((d) => d.texture);
      nebulaBaseOpacities = nebulaDefs.map((d) => d.opacity);
      nebulaLayers = nebulaDefs.map((def) => {
        const mesh = new Mesh(
          new PlaneGeometry(def.size, def.size),
          new MeshBasicMaterial({
            map: def.texture,
            transparent: true,
            opacity: def.opacity,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
          }),
        );
        mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
        mesh.rotation.z = def.rot;
        return mesh;
      });

      // Portal ring — radius computed from frustum diagonal at its depth
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

      // Planets — distinct colours, sized to 14-17% of screen height, fully in frame
      planetNear = new Mesh(
        new SphereGeometry(10, 40, 40),
        new MeshStandardMaterial({
          color: 0xd4783c, // warm orange
          emissive: 0x4a1400,
          roughness: 0.78,
          metalness: 0.06,
        }),
      );
      planetNear.position.set(-28, 10, SPACE_WORLD_CONFIG.planetNearZ);

      planetFar = new Mesh(
        new SphereGeometry(14, 44, 44),
        new MeshStandardMaterial({
          color: 0x3a9fc8, // ice blue
          emissive: 0x0a2535,
          roughness: 0.72,
          metalness: 0.12,
        }),
      );
      planetFar.position.set(42, -16, SPACE_WORLD_CONFIG.planetFarZ);

      // Warp streak pool — 3 meshes, reused
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
        return { mesh, state: "idle" as const, elapsed: 0, duration: 0.45 };
      });

      ctx.scene.add(
        ambient,
        directional,
        deepStars,
        shallowStars,
        warmStars,
        ...nebulaLayers,
        portalRing,
        planetNear,
        planetFar,
        ...warpPool.map((e) => e.mesh),
      );
    },

    update(dt: number, _frameState: FrameState) {
      time += dt;
      drone?.update(dt);

      // Twinkling — push time to each star material
      if (deepStars) (deepStars.material as ShaderMaterial).uniforms.uTime.value = time;
      if (shallowStars) (shallowStars.material as ShaderMaterial).uniforms.uTime.value = time;
      if (warmStars) (warmStars.material as ShaderMaterial).uniforms.uTime.value = time;

      // Planet rotation — perceptible but not distracting
      if (planetNear) planetNear.rotation.y += dt * 0.18;
      if (planetFar) planetFar.rotation.y += dt * 0.07;

      // Star field slow counter-rotation for subtle life
      if (deepStars) deepStars.rotation.z += dt * 0.003;
      if (shallowStars) shallowStars.rotation.z -= dt * 0.004;

      // Nebula breathing (8-10s cycle) + slow drift
      nebulaLayers.forEach((layer, idx) => {
        const mat = layer.material as MeshBasicMaterial;
        const phase = idx * ((Math.PI * 2) / 3);
        mat.opacity = nebulaBaseOpacities[idx]! * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(time * 0.6 + phase)));
        const dir = idx % 2 === 0 ? 1 : -1;
        layer.rotation.z += dt * 0.005 * dir;
        layer.position.x += dt * 0.55 * dir;
        if (layer.position.x > 110) layer.position.x = -110;
        else if (layer.position.x < -110) layer.position.x = 110;
      });

      // Portal ring pulse — emissive intensity oscillation
      if (portalRing) {
        (portalRing.material as MeshStandardMaterial).emissiveIntensity =
          4.0 + 1.8 * Math.sin(time * 0.9);
      }

      // Warp spawn
      warpSpawnTimer += dt;
      if (warpSpawnTimer >= warpNextSpawn) {
        const idle = warpPool.find((e) => e.state === "idle");
        if (idle) {
          idle.state = "animating";
          idle.elapsed = 0;
          idle.duration = randomInRange(0.3, 0.55);
          idle.mesh.visible = true;
          idle.mesh.position.set(
            randomInRange(-80, 80),
            randomInRange(-45, 45),
            randomInRange(-160, -60),
          );
          idle.mesh.rotation.z = randomInRange(-0.3, 0.3);
          (idle.mesh.material as MeshBasicMaterial).opacity = 0;
          idle.mesh.scale.set(1, 1, 1);
        }
        warpSpawnTimer = 0;
        warpNextSpawn = randomInRange(2.0, 4.0);
      }

      // Warp animation — fast, bright, gone
      warpPool.forEach((entry) => {
        if (entry.state !== "animating") return;
        entry.elapsed += dt;
        const t = Math.min(entry.elapsed / entry.duration, 1);
        (entry.mesh.material as MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * 0.92;
        entry.mesh.scale.x = MathUtils.lerp(1, 2.8, t);
        entry.mesh.position.z += dt * 190;
        if (t >= 1) {
          entry.state = "idle";
          entry.mesh.visible = false;
          entry.mesh.position.z = -100;
          (entry.mesh.material as MeshBasicMaterial).opacity = 0;
        }
      });
    },

    resize(_size: ViewportSize) {},

    dispose() {
      if (!sceneCtx) return;

      const disposeMesh = (mesh: Mesh | null): void => {
        if (!mesh) return;
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m: Material) => m.dispose());
        } else {
          mesh.material.dispose();
        }
        sceneCtx?.scene.remove(mesh);
      };

      const disposePoints = (points: Points | null): void => {
        if (!points) return;
        points.geometry.dispose();
        if (Array.isArray(points.material)) {
          points.material.forEach((m: Material) => m.dispose());
        } else {
          points.material.dispose();
        }
        sceneCtx?.scene.remove(points);
      };

      disposePoints(deepStars);
      disposePoints(shallowStars);
      disposePoints(warmStars);
      nebulaLayers.forEach((l) => disposeMesh(l));
      disposeMesh(portalRing);
      disposeMesh(planetNear);
      disposeMesh(planetFar);
      warpPool.forEach((e) => disposeMesh(e.mesh));

      if (ambient) sceneCtx.scene.remove(ambient);
      if (directional) sceneCtx.scene.remove(directional);

      deepStars = null;
      shallowStars = null;
      warmStars = null;
      nebulaTextures.forEach((t) => t.dispose());
      nebulaTextures = [];
      nebulaLayers = [];
      nebulaBaseOpacities = [];
      warpPool = [];
      warpSpawnTimer = 0;
      warpNextSpawn = 1.5;
      drone?.dispose();
      drone = null;
      portalRing = null;
      planetNear = null;
      planetFar = null;
      ambient = null;
      directional = null;
      sceneCtx.setBloom(null);
      sceneCtx = null;
    },
  };
};
