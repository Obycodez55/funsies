import type { ScreenDimensionsCm } from "./types";

export const APP_MODE = {
  TEST_WORLD: "test-world",
  SPACE: "space",
} as const;

export type AppMode = (typeof APP_MODE)[keyof typeof APP_MODE];

export const DEFAULT_MODE: AppMode = APP_MODE.SPACE;

export const TRACKER_SMOOTHING_ALPHA = 0.14;
export const TRACKER_TARGET_FPS = 45;
export const TRACKER_BASELINE_EYE_ALPHA = 0.04;
export const TRACKER_DEPTH_RESPONSE_GAIN = 820;
export const MIN_HEAD_Z_CM = 25;
export const MAX_HEAD_Z_CM = 140;
export const DEFAULT_HEAD_Z_CM = 60;
export const HEAD_X_RANGE = 8;
export const HEAD_Y_RANGE = 5;
export const HEAD_DEADZONE_X = 1.1;
export const HEAD_DEADZONE_Y = 0.9;
export const HEAD_DEADZONE_Z = 0.8;

export const MOTION_TUNING = {
  // Mirror-style behavior is often intuitive for users; keep configurable per experience.
  invertX: true,
  invertY: false,
  invertZ: true,
  sensitivityX: 0.08,
  sensitivityY: 0.08,
  sensitivityZ: 0.05,
} as const;

export const SCREEN_DIMENSIONS_CM: ScreenDimensionsCm = {
  // Assumption for off-axis projection until real calibration is added.
  width: 53.0, // ~24 inch 16:9 monitor width in cm
  height: 29.8, // matching 16:9 ratio
};

export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 500;

export const MEDIAPIPE_WASM_BASE_URI =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";

export const SPACE_WORLD_CONFIG = {
  deepStarCount: 9000,
  shallowStarCount: 1800,
  warmStarCount: 700,
  deepStarZMin: -320,
  deepStarZMax: -70,
  shallowStarZMin: -45,
  shallowStarZMax: -18,
  planetNearZ: -80,
  planetFarZ: -220,
} as const;

export const BLOOM_RESOLUTION_SCALE = 0.5;

export const MOON_ORBIT_RADIUS = 14;
export const MOON_ORBIT_PERIOD = 90;

export const COMET_INTERVAL_MIN = 60;
export const COMET_INTERVAL_MAX = 90;

export const SUPERNOVA_INTERVAL_MIN = 120;
export const SUPERNOVA_INTERVAL_MAX = 180;

export const HEAD_STILL_DURATION = 8;

export const WARP_INTERVAL_MIN = 4;
export const WARP_INTERVAL_MAX = 7;
