import { MathUtils, PerspectiveCamera, Vector3 } from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrbitController {
  /** Called every frame before updateCamera. Sets camera.position and camera.lookAt. */
  update(dt: number, camera: PerspectiveCamera): void;
  /** World-space point the camera orbits around. */
  getTarget(): Vector3;
  /** Attach pointer/wheel event listeners to a DOM element. */
  attach(el: HTMLElement): void;
  /** Remove all listeners previously attached. */
  detach(): void;
}

interface OrbitOptions {
  /** Initial orbit target in world space. Default (0, 0, -60). */
  target?: Vector3;
  /** Initial distance from target. Default 120. */
  radius?: number;
  /** Initial horizontal angle in radians. Default 0 (looking along -Z). */
  azimuth?: number;
  /** Initial vertical angle in radians. Default 0 (horizontal). */
  elevation?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAG_SENSITIVITY = 0.0048; // radians per pixel
const INERTIA_DECAY = 4.2;       // higher = snappier stop
const DOLLY_DECAY = 5.0;
const MIN_RADIUS = 18;
const MAX_RADIUS = 380;
const MAX_ELEVATION = Math.PI / 2 - 0.01;
const MIN_ELEVATION = -(Math.PI / 2 - 0.01);

// ─── Factory ──────────────────────────────────────────────────────────────────

export const createOrbitController = (options: OrbitOptions = {}): OrbitController => {
  const target = options.target?.clone() ?? new Vector3(0, 0, -60);

  let azimuth = options.azimuth ?? 0;
  let elevation = options.elevation ?? 0;
  let radius = options.radius ?? 120;

  // Inertia — radians/second for az/el, radius-units/second for dolly
  let velAz = 0;
  let velEl = 0;
  let velDolly = 0;

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let attachedEl: HTMLElement | null = null;

  // Pre-allocated to avoid per-frame allocations
  const camPos = new Vector3();

  // ─── Internal helpers ──────────────────────────────────────────────────────

  const applyDollyDelta = (rawDelta: number): void => {
    // Scale scroll delta so one mouse-wheel notch (~100px) moves ~20% of current radius.
    // exp-decay integrated distance = velocity / decay, target = 0.20 * radius.
    // velocity = 0.20 * radius * DOLLY_DECAY per notch → per pixel: /100.
    velDolly += (rawDelta / 100) * 0.20 * radius * DOLLY_DECAY;
  };

  // ─── Pointer handlers ──────────────────────────────────────────────────────

  const onPointerDown = (e: PointerEvent): void => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    // Drag right → azimuth increases (scene rotates left, feel of camera orbiting right)
    velAz = -dx * DRAG_SENSITIVITY;
    velEl = -dy * DRAG_SENSITIVITY;

    azimuth += velAz;
    elevation = MathUtils.clamp(elevation + velEl, MIN_ELEVATION, MAX_ELEVATION);
  };

  const onPointerUp = (): void => {
    isDragging = false;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 24;  // line → pixel
    if (e.deltaMode === 2) delta *= window.innerHeight; // page → pixel
    applyDollyDelta(delta);
  };

  // ─── Public interface ──────────────────────────────────────────────────────

  return {
    update(dt: number, camera: PerspectiveCamera): void {
      // Inertia — only apply when not actively dragging
      if (!isDragging) {
        const decay = Math.exp(-INERTIA_DECAY * dt);
        velAz *= decay;
        velEl *= decay;
        azimuth += velAz;
        elevation = MathUtils.clamp(elevation + velEl, MIN_ELEVATION, MAX_ELEVATION);
      }

      // Dolly inertia (runs regardless of drag state)
      if (Math.abs(velDolly) > 0.001) {
        radius = MathUtils.clamp(radius + velDolly * dt, MIN_RADIUS, MAX_RADIUS);
        velDolly *= Math.exp(-DOLLY_DECAY * dt);
      }

      // Compute camera world position from spherical coordinates
      const cosEl = Math.cos(elevation);
      camPos.set(
        target.x + radius * cosEl * Math.sin(azimuth),
        target.y + radius * Math.sin(elevation),
        target.z + radius * cosEl * Math.cos(azimuth),
      );

      camera.position.copy(camPos);
      camera.lookAt(target);
    },

    getTarget(): Vector3 {
      return target;
    },

    attach(el: HTMLElement): void {
      attachedEl = el;
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
      el.addEventListener("pointercancel", onPointerUp);
      el.addEventListener("wheel", onWheel, { passive: false });
    },

    detach(): void {
      if (!attachedEl) return;
      attachedEl.removeEventListener("pointerdown", onPointerDown);
      attachedEl.removeEventListener("pointermove", onPointerMove);
      attachedEl.removeEventListener("pointerup", onPointerUp);
      attachedEl.removeEventListener("pointercancel", onPointerUp);
      attachedEl.removeEventListener("wheel", onWheel);
      attachedEl = null;
    },
  };
};
