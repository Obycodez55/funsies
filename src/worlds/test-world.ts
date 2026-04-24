import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Material,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { AppContext, FrameState, SceneModule, ViewportSize } from "../shared/types";

export const createTestWorld = (): SceneModule => {
  let cube: Mesh | null = null;
  let grid: GridHelper | null = null;
  let axes: AxesHelper | null = null;
  let ambient: AmbientLight | null = null;
  let directional: DirectionalLight | null = null;
  let sceneCtx: AppContext | null = null;

  return {
    init(ctx) {
      sceneCtx = ctx;
      ctx.scene.background = new Color(0x080d16);

      ambient = new AmbientLight(0xffffff, 0.35);
      directional = new DirectionalLight(0x9ac8ff, 1.25);
      directional.position.set(20, 25, 18);

      cube = new Mesh(
        new BoxGeometry(8, 8, 8),
        new MeshStandardMaterial({
          color: 0x64c8ff,
          metalness: 0.2,
          roughness: 0.35,
        }),
      );
      cube.position.z = -45;

      grid = new GridHelper(160, 24, 0x4672b3, 0x1e2f4d);
      grid.position.y = -12;
      grid.position.z = -40;

      axes = new AxesHelper(16);
      axes.position.z = -30;

      ctx.scene.add(ambient, directional, cube, grid, axes);
    },
    update(dt, frameState) {
      if (!cube) {
        return;
      }
      cube.rotation.y += dt * 0.35;
      cube.rotation.x += dt * 0.15;
      if (frameState.trackerStatus !== "tracking") {
        cube.rotation.y += dt * 0.1;
      }
    },
    resize(_size: ViewportSize) {
      // Reserved for world-specific responsive logic.
    },
    dispose() {
      if (!sceneCtx) {
        return;
      }

      if (cube) {
        cube.geometry.dispose();
        (cube.material as MeshStandardMaterial).dispose();
        sceneCtx.scene.remove(cube);
      }
      if (grid) {
        grid.geometry.dispose();
        if (Array.isArray(grid.material)) {
          grid.material.forEach((mat: Material) => mat.dispose());
        } else {
          grid.material.dispose();
        }
        sceneCtx.scene.remove(grid);
      }
      if (axes) {
        sceneCtx.scene.remove(axes);
      }
      if (ambient) {
        sceneCtx.scene.remove(ambient);
      }
      if (directional) {
        sceneCtx.scene.remove(directional);
      }

      cube = null;
      grid = null;
      axes = null;
      ambient = null;
      directional = null;
      sceneCtx = null;
    },
  };
};
