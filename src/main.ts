import "./styles/base.css";
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  MOTION_TUNING,
  SCREEN_DIMENSIONS_CM,
} from "./shared/constants";
import { createRendererRuntime } from "./core/renderer";
import { HeadTracker } from "./core/tracker";
import { updateCamera } from "./core/camera";
import { createTestWorld } from "./worlds/test-world";
import { createOverlay } from "./ui/overlay";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("App root #app not found.");
}

const runtime = createRendererRuntime(appRoot);
const tracker = new HeadTracker();
const world = createTestWorld();
world.init(runtime.ctx);
world.resize(runtime.size);

const overlay = createOverlay(appRoot);

let fps = 0;
runtime.setFrameHandler((dt) => {
  const frameState = tracker.getFrameState();
  updateCamera(
    runtime.ctx.camera,
    frameState.headPose,
    SCREEN_DIMENSIONS_CM,
    CAMERA_NEAR,
    CAMERA_FAR,
    MOTION_TUNING,
  );
  world.update(dt, frameState);
  fps = dt > 0 ? 1 / dt : fps;
  overlay.update(frameState, fps);
});

const boot = async (): Promise<void> => {
  try {
    await tracker.start();
  } catch (error) {
    console.error(error);
  }
  runtime.start();
};

void boot();

window.addEventListener("beforeunload", () => {
  runtime.stop();
  world.dispose();
  overlay.destroy();
  tracker.dispose();
  runtime.dispose();
});
