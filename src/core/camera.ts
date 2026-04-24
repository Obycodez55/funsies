import { PerspectiveCamera } from "three";
import {
  DEFAULT_HEAD_Z_CM,
  MAX_HEAD_Z_CM,
  MIN_HEAD_Z_CM,
} from "../shared/constants";
import type { HeadPose, ScreenDimensionsCm } from "../shared/types";
import { clamp } from "../shared/math";

interface MotionTuning {
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
  sensitivityX: number;
  sensitivityY: number;
  sensitivityZ: number;
}

export const updateCamera = (
  camera: PerspectiveCamera,
  headPosition: HeadPose | null,
  screenDimensions: ScreenDimensionsCm,
  nearPlane: number,
  farPlane: number,
  motion: MotionTuning,
): void => {
  const activeHead = headPosition ?? {
    x: 0,
    y: 0,
    z: DEFAULT_HEAD_Z_CM,
    confidence: 0,
    faceCount: 0,
  };

  const x = (motion.invertX ? -activeHead.x : activeHead.x) * motion.sensitivityX;
  const y = (motion.invertY ? -activeHead.y : activeHead.y) * motion.sensitivityY;
  const rawZ = motion.invertZ ? -activeHead.z : activeHead.z;
  const z = clamp(rawZ * motion.sensitivityZ, MIN_HEAD_Z_CM, MAX_HEAD_Z_CM);
  const halfW = screenDimensions.width / 2;
  const halfH = screenDimensions.height / 2;

  const left = ((-halfW - x) * nearPlane) / z;
  const right = ((halfW - x) * nearPlane) / z;
  const top = ((halfH - y) * nearPlane) / z;
  const bottom = ((-halfH - y) * nearPlane) / z;

  camera.projectionMatrix.makePerspective(
    left,
    right,
    top,
    bottom,
    nearPlane,
    farPlane,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
};
