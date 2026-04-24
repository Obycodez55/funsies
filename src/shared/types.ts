import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

export type TrackerStatus =
  | "idle"
  | "initializing"
  | "tracking"
  | "no-face"
  | "multi-face"
  | "permission-denied"
  | "error";

export interface HeadPose {
  x: number;
  y: number;
  z: number;
  confidence: number;
  faceCount: number;
}

export interface FrameState {
  rawHeadPose: HeadPose | null;
  headPose: HeadPose | null;
  trackerStatus: TrackerStatus;
}

export interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

export interface ScreenDimensionsCm {
  width: number;
  height: number;
}

export interface BloomProfile {
  strength: number;
  radius: number;
  threshold: number;
}

export interface AppContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  setBloom(profile: BloomProfile | null): void;
}

export interface SceneModule {
  init(ctx: AppContext): void;
  update(dt: number, frameState: FrameState): void;
  resize(size: ViewportSize): void;
  dispose(): void;
}
