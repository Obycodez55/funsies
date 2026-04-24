import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { DEFAULT_HEAD_Z_CM, SCREEN_DIMENSIONS_CM, SPACE_WORLD_CONFIG } from "../shared/constants";
import { createSpaceDrone } from "../core/audio";
import { noBloomProfile, spaceBloomProfile } from "../shared/postfx";
import type { AppContext, FrameState, SceneModule, ViewportSize } from "../shared/types";

const randomInRange = (min: number, max: number): number =>
  min + Math.random() * (max - min);

const makeCircleTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D context for star texture.");
  }
  ctx.clearRect(0, 0, 64, 64);
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const makeNebulaTexture = (coreColor: string, outerColor: string): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create 2D context for nebula texture.");
  }
  const gradient = ctx.createRadialGradient(128, 128, 28, 128, 128, 128);
  gradient.addColorStop(0, coreColor);
  gradient.addColorStop(0.55, outerColor);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const createStarPositions = (count: number, kind: "deep" | "shallow"): Float32Array => {
  const positions = new Float32Array(count * 3);
  const halfW = SCREEN_DIMENSIONS_CM.width / 2;
  const halfH = SCREEN_DIMENSIONS_CM.height / 2;

  for (let i = 0; i < count; i += 1) {
    const idx = i * 3;
    let x = 0;
    let y = 0;
    let z = 0;

    if (kind === "deep") {
      x = randomInRange(-240, 240);
      y = randomInRange(-140, 140);
      z = randomInRange(SPACE_WORLD_CONFIG.deepStarZMin, SPACE_WORLD_CONFIG.deepStarZMax);
    } else {
      z = randomInRange(
        SPACE_WORLD_CONFIG.shallowStarZMin,
        SPACE_WORLD_CONFIG.shallowStarZMax,
      );
      do {
        x = randomInRange(-halfW * 1.8, halfW * 1.8);
        y = randomInRange(-halfH * 1.8, halfH * 1.8);
      } while (Math.abs(x) < halfW * 0.95 && Math.abs(y) < halfH * 0.95);
    }

    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
  }

  return positions;
};

export const createSpaceWorld = (): SceneModule => {
  let sceneCtx: AppContext | null = null;

  let deepStars: Points | null = null;
  let shallowStars: Points | null = null;
  let deepStarTexture: CanvasTexture | null = null;
  let shallowStarTexture: CanvasTexture | null = null;
  let nebulaTextures: CanvasTexture[] = [];
  let nebulaLayers: Mesh[] = [];
  let warpPool: Array<{
    mesh: Mesh;
    state: "idle" | "animating";
    elapsed: number;
    duration: number;
  }> = [];
  let warpSpawnTimer = 0;
  let warpNextSpawn = 2.4;
  let drone: ReturnType<typeof createSpaceDrone> | null = null;
  let portalRing: Mesh | null = null;
  let planetNear: Mesh | null = null;
  let planetFar: Mesh | null = null;
  let ambient: AmbientLight | null = null;
  let directional: DirectionalLight | null = null;

  return {
    init(ctx) {
      sceneCtx = ctx;
      ctx.setBloom(spaceBloomProfile);
      ctx.scene.background = new Color(0x04060c);
      drone = createSpaceDrone();
      drone.resumeOnInteraction();

      ambient = new AmbientLight(0xb9c7ff, 0.22);
      directional = new DirectionalLight(0x9fc4ff, 1.15);
      directional.position.set(24, 18, 30);

      const deepGeometry = new BufferGeometry();
      deepGeometry.setAttribute(
        "position",
        new BufferAttribute(createStarPositions(SPACE_WORLD_CONFIG.deepStarCount, "deep"), 3),
      );
      const deepMaterial = new PointsMaterial({
        color: 0xc9dbff,
        size: 0.8,
        sizeAttenuation: true,
        map: (deepStarTexture = makeCircleTexture()),
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
      });
      deepStars = new Points(deepGeometry, deepMaterial);

      const shallowGeometry = new BufferGeometry();
      shallowGeometry.setAttribute(
        "position",
        new BufferAttribute(
          createStarPositions(SPACE_WORLD_CONFIG.shallowStarCount, "shallow"),
          3,
        ),
      );
      const shallowMaterial = new PointsMaterial({
        color: 0x9fe0ff,
        size: 1.35,
        sizeAttenuation: true,
        map: (shallowStarTexture = makeCircleTexture()),
        transparent: true,
        alphaTest: 0.5,
        depthWrite: false,
      });
      shallowStars = new Points(shallowGeometry, shallowMaterial);

      const nebulaDefs = [
        {
          texture: makeNebulaTexture("rgba(135,170,255,0.50)", "rgba(70,90,190,0.16)"),
          size: 180,
          pos: [-70, 24, -130] as const,
          rot: 0.22,
        },
        {
          texture: makeNebulaTexture("rgba(170,145,255,0.45)", "rgba(95,62,180,0.18)"),
          size: 230,
          pos: [82, -8, -210] as const,
          rot: -0.33,
        },
        {
          texture: makeNebulaTexture("rgba(120,205,255,0.40)", "rgba(42,90,145,0.14)"),
          size: 130,
          pos: [8, 36, -82] as const,
          rot: 0.09,
        },
      ];

      nebulaTextures = nebulaDefs.map((def) => def.texture);
      nebulaLayers = nebulaDefs.map((def) => {
        const mesh = new Mesh(
          new PlaneGeometry(def.size, def.size),
          new MeshBasicMaterial({
            map: def.texture,
            transparent: true,
            opacity: 0.15,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
          }),
        );
        mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
        mesh.rotation.z = def.rot;
        return mesh;
      });

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
          emissiveIntensity: 4.8,
          roughness: 0.35,
          metalness: 0.22,
        }),
      );
      portalRing.position.set(0, 0, ringZ);

      planetNear = new Mesh(
        new SphereGeometry(16, 36, 36),
        new MeshStandardMaterial({
          color: 0x3b6ec5,
          emissive: 0x101b40,
          roughness: 0.75,
          metalness: 0.08,
        }),
      );
      planetNear.position.set(-34, 12, SPACE_WORLD_CONFIG.planetNearZ);

      planetFar = new Mesh(
        new SphereGeometry(34, 40, 40),
        new MeshStandardMaterial({
          color: 0x4e3ea8,
          emissive: 0x1a1240,
          roughness: 0.85,
          metalness: 0.04,
        }),
      );
      planetFar.position.set(68, -22, SPACE_WORLD_CONFIG.planetFarZ);

      warpPool = Array.from({ length: 2 }).map(() => {
        const mesh = new Mesh(
          new PlaneGeometry(34, 0.9),
          new MeshBasicMaterial({
            color: 0xbfe4ff,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
          }),
        );
        mesh.visible = false;
        mesh.position.set(0, 0, -120);
        return {
          mesh,
          state: "idle" as const,
          elapsed: 0,
          duration: 0.8,
        };
      });

      ctx.scene.add(
        ambient,
        directional,
        deepStars,
        shallowStars,
        ...nebulaLayers,
        portalRing,
        planetNear,
        planetFar,
        ...warpPool.map((entry) => entry.mesh),
      );
    },
    update(dt: number, _frameState: FrameState) {
      drone?.update(dt);
      if (planetNear) {
        planetNear.rotation.y += dt * 0.11;
      }
      if (planetFar) {
        planetFar.rotation.y += dt * 0.05;
      }
      if (deepStars) {
        deepStars.rotation.z += dt * 0.003;
      }
      if (shallowStars) {
        shallowStars.rotation.z -= dt * 0.004;
      }

      nebulaLayers.forEach((layer, idx) => {
        const direction = idx % 2 === 0 ? 1 : -1;
        layer.rotation.z += dt * 0.008 * direction;
        layer.position.x += dt * 0.9 * direction;
        if (layer.position.x > 110) {
          layer.position.x = -110;
        } else if (layer.position.x < -110) {
          layer.position.x = 110;
        }
      });

      warpSpawnTimer += dt;
      if (warpSpawnTimer >= warpNextSpawn) {
        const idle = warpPool.find((entry) => entry.state === "idle");
        if (idle) {
          idle.state = "animating";
          idle.elapsed = 0;
          idle.duration = randomInRange(0.6, 1.1);
          idle.mesh.visible = true;
          idle.mesh.position.set(
            randomInRange(-90, 90),
            randomInRange(-50, 50),
            randomInRange(-190, -70),
          );
          idle.mesh.rotation.z = randomInRange(-0.35, 0.35);
          (idle.mesh.material as MeshBasicMaterial).opacity = 0;
          idle.mesh.scale.set(1, 1, 1);
        }
        warpSpawnTimer = 0;
        warpNextSpawn = randomInRange(2.0, 4.8);
      }

      warpPool.forEach((entry) => {
        if (entry.state !== "animating") {
          return;
        }
        entry.elapsed += dt;
        const t = Math.min(entry.elapsed / entry.duration, 1);
        const opacity = Math.sin(t * Math.PI) * 0.8;
        const mat = entry.mesh.material as MeshBasicMaterial;
        mat.opacity = opacity;
        entry.mesh.scale.x = MathUtils.lerp(1, 2.2, t);
        entry.mesh.position.z += dt * 110;
        if (t >= 1) {
          entry.state = "idle";
          entry.mesh.visible = false;
          entry.mesh.position.z = -120;
          mat.opacity = 0;
        }
      });
    },
    resize(_size: ViewportSize) {
      // Reserved for potential per-world responsive adjustments.
    },
    dispose() {
      if (!sceneCtx) {
        return;
      }

      const disposeMesh = (mesh: Mesh | null): void => {
        if (!mesh) {
          return;
        }
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat: Material) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
        sceneCtx?.scene.remove(mesh);
      };

      const disposePoints = (points: Points | null): void => {
        if (!points) {
          return;
        }
        points.geometry.dispose();
        if (Array.isArray(points.material)) {
          points.material.forEach((mat: Material) => mat.dispose());
        } else {
          points.material.dispose();
        }
        sceneCtx?.scene.remove(points);
      };

      disposePoints(deepStars);
      disposePoints(shallowStars);
      nebulaLayers.forEach((layer) => disposeMesh(layer));
      disposeMesh(portalRing);
      disposeMesh(planetNear);
      disposeMesh(planetFar);
      warpPool.forEach((entry) => disposeMesh(entry.mesh));

      if (ambient) {
        sceneCtx.scene.remove(ambient);
      }
      if (directional) {
        sceneCtx.scene.remove(directional);
      }

      deepStars = null;
      shallowStars = null;
      deepStarTexture?.dispose();
      shallowStarTexture?.dispose();
      nebulaTextures.forEach((texture) => texture.dispose());
      deepStarTexture = null;
      shallowStarTexture = null;
      nebulaTextures = [];
      nebulaLayers = [];
      warpPool = [];
      warpSpawnTimer = 0;
      warpNextSpawn = 2.4;
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
