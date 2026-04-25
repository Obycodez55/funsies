import { PerspectiveCamera, Vector3 } from "three";
import {
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

// Pre-allocated vectors — reused every frame to avoid GC pressure.
const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();

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
  orbitPosition: Vector3,
  orbitTarget: Vector3,
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
  const x = clamp(
    (motion.invertX ? -activeHead.x : activeHead.x) * motion.sensitivityX,
    -HEAD_X_RANGE,
    HEAD_X_RANGE,
  );
  const y = clamp(
    (motion.invertY ? -activeHead.y : activeHead.y) * motion.sensitivityY,
    -HEAD_Y_RANGE,
    HEAD_Y_RANGE,
  );

  // Head Z: distance from physical screen (used for frustum depth, not world position)
  const zDelta = activeHead.z - DEFAULT_HEAD_Z_CM;
  const tunedDelta = (motion.invertZ ? -zDelta : zDelta) * motion.sensitivityZ;
  const headZ = clamp(DEFAULT_HEAD_Z_CM + tunedDelta, MIN_HEAD_Z_CM, MAX_HEAD_Z_CM);

  // Extract the camera's local right / up axes from its current orientation.
  // The orbit controller has already called camera.lookAt(target), so the
  // quaternion is set correctly. We use it directly rather than matrixWorld
  // to avoid a redundant updateMatrixWorld call here.
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  _fwd.set(0, 0, 1).applyQuaternion(camera.quaternion); // camera +Z = world "behind" camera

  // Apply head x/y delta in camera-local space on top of the orbit base position.
  // This creates genuine parallax: near objects shift more than far ones because
  // the camera has actually translated, while the frustum asymmetry keeps the
  // physical screen aligned as the "window frame".
  camera.position
    .copy(orbitPosition)
    .addScaledVector(_right, x)
    .addScaledVector(_up, y);

  // Re-orient toward orbit target from the slightly-shifted position.
  // For small head offsets the angular difference is negligible (<1°),
  // but this keeps the camera precisely aimed.
  camera.lookAt(orbitTarget);
  camera.updateMatrixWorld();

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
