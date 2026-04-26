import { PerspectiveCamera, Vector3 } from "three";
import {
  HEAD_DEADZONE_X,
  HEAD_DEADZONE_Y,
  HEAD_DEADZONE_Z,
  DEFAULT_HEAD_Z_CM,
  HEAD_X_RANGE,
  HEAD_Y_RANGE,
  MAX_HEAD_Z_CM,
  MIN_HEAD_Z_CM,
} from "../shared/constants";
import { clamp } from "../shared/math";
import type { HeadPose, ScreenDimensionsCm } from "../shared/types";

interface MotionTuning {
  invertX: boolean;
  invertY: boolean;
  invertZ: boolean;
  sensitivityX: number;
  sensitivityY: number;
  sensitivityZ: number;
}

const applyDeadzone = (value: number, deadzone: number): number => {
  if (Math.abs(value) <= deadzone) return 0;
  return value > 0 ? value - deadzone : value + deadzone;
};

/**
 * Applies head-tracking to the camera.
 *
 * The orbit controller owns camera.position (world locomotion).
 * This function adds a small head-offset ON TOP of the orbit position,
 * expressed in camera-local space so it works correctly from any orbit angle.
 * It also computes and sets the off-axis projection frustum every frame.
 *
 * @param orbitPosition  The base world position set by the orbit controller.
 *                       Captured BEFORE calling this function.
 * @param orbitTarget    The point the orbit is looking at. Used to re-orient
 *                       the camera correctly after the small head offset.
 */
export const updateCamera = (
  camera: PerspectiveCamera,
  _orbitPosition: Vector3,
  _orbitTarget: Vector3,
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

  // Head offset in screen-space scene units
  const xRaw = clamp(
    (motion.invertX ? -activeHead.x : activeHead.x) * motion.sensitivityX,
    -HEAD_X_RANGE,
    HEAD_X_RANGE,
  );
  const yRaw = clamp(
    (motion.invertY ? -activeHead.y : activeHead.y) * motion.sensitivityY,
    -HEAD_Y_RANGE,
    HEAD_Y_RANGE,
  );
  const x = applyDeadzone(xRaw, HEAD_DEADZONE_X);
  const y = applyDeadzone(yRaw, HEAD_DEADZONE_Y);

  // Head Z: distance from physical screen (used for frustum depth, not world position)
  const zDelta = activeHead.z - DEFAULT_HEAD_Z_CM;
  const tunedDeltaRaw = (motion.invertZ ? -zDelta : zDelta) * motion.sensitivityZ;
  const tunedDelta = applyDeadzone(tunedDeltaRaw, HEAD_DEADZONE_Z);
  const headZ = clamp(DEFAULT_HEAD_Z_CM + tunedDelta, MIN_HEAD_Z_CM, MAX_HEAD_Z_CM);

  // Head tracking must not touch camera world transform.
  // Orbit/dolly owns camera position + orientation. We only shift frustum planes.

  // Off-axis frustum — computed from the head's physical position relative to
  // the screen plane. headZ is the eye-to-screen distance in scene units (≈ cm).
  // x and y are the lateral offsets from screen centre.
  const halfW = screenDimensions.width / 2;
  const halfH = screenDimensions.height / 2;

  const left = ((-halfW - x) * nearPlane) / headZ;
  const right = ((halfW - x) * nearPlane) / headZ;
  const top = ((halfH - y) * nearPlane) / headZ;
  const bottom = ((-halfH - y) * nearPlane) / headZ;

  camera.projectionMatrix.makePerspective(left, right, top, bottom, nearPlane, farPlane);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
};
