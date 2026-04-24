import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { DEFAULT_HEAD_Z_CM, SCREEN_DIMENSIONS_CM, SPACE_WORLD_CONFIG } from "../shared/constants";
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
  let portalRing: Mesh | null = null;
  let planetNear: Mesh | null = null;
  let planetFar: Mesh | null = null;
  let ambient: AmbientLight | null = null;
  let directional: DirectionalLight | null = null;

  return {
    init(ctx) {
      sceneCtx = ctx;
      ctx.scene.background = new Color(0x04060c);

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

      ctx.scene.add(
        ambient,
        directional,
        deepStars,
        shallowStars,
        portalRing,
        planetNear,
        planetFar,
      );
    },
    update(dt: number, _frameState: FrameState) {
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
      disposeMesh(portalRing);
      disposeMesh(planetNear);
      disposeMesh(planetFar);

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
      deepStarTexture = null;
      shallowStarTexture = null;
      portalRing = null;
      planetNear = null;
      planetFar = null;
      ambient = null;
      directional = null;
      sceneCtx = null;
    },
  };
};
