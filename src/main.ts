import "./styles/base.css";
import {
  APP_MODE,
  type AppMode,
  CAMERA_FAR,
  CAMERA_NEAR,
  DEFAULT_MODE,
  MOTION_TUNING,
  SCREEN_DIMENSIONS_CM,
} from "./shared/constants";
import { createRendererRuntime } from "./core/renderer";
import { HeadTracker } from "./core/tracker";
import { updateCamera } from "./core/camera";
import { createTestWorld } from "./worlds/test-world";
import { createSpaceWorld } from "./worlds/space";
import { createOverlay } from "./ui/overlay";
import type { SceneModule } from "./shared/types";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("App root #app not found.");
}

const runtime = createRendererRuntime(appRoot);
const tracker = new HeadTracker();
const worldFactory: Record<AppMode, () => SceneModule> = {
  [APP_MODE.TEST_WORLD]: createTestWorld,
  [APP_MODE.SPACE]: createSpaceWorld,
};

const parseModeFromUrl = (): AppMode => {
  const world = new URLSearchParams(window.location.search).get("world");
  if (world === APP_MODE.SPACE) {
    return APP_MODE.SPACE;
  }
  if (world === APP_MODE.TEST_WORLD) {
    return APP_MODE.TEST_WORLD;
  }
  return DEFAULT_MODE;
};

let activeMode: AppMode = parseModeFromUrl();
let world = worldFactory[activeMode]();
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

const switchWorld = (nextMode: AppMode): void => {
  if (nextMode === activeMode) {
    return;
  }
  world.dispose();
  activeMode = nextMode;
  world = worldFactory[activeMode]();
  world.init(runtime.ctx);
  world.resize(runtime.size);
};

const handleKeySwitch = (event: KeyboardEvent): void => {
  const key = event.key.toLowerCase();
  if (key === "s") {
    switchWorld(APP_MODE.SPACE);
  } else if (key === "t") {
    switchWorld(APP_MODE.TEST_WORLD);
  }
};

const handleResize = (): void => {
  world.resize(runtime.size);
};

window.addEventListener("keydown", handleKeySwitch);
window.addEventListener("resize", handleResize);

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
  window.removeEventListener("keydown", handleKeySwitch);
  window.removeEventListener("resize", handleResize);
  runtime.dispose();
});
