# Funsies Foundation (TypeScript)

Foundational implementation for Funsies using vanilla Vite, TypeScript, Three.js, and MediaPipe Face Landmarker.

## Stack

- Vite + TypeScript
- Three.js
- `@mediapipe/tasks-vision`
- Package manager: `pnpm`

## MediaPipe Asset Strategy

This project intentionally uses CDN-hosted MediaPipe WASM assets to reduce setup friction:

- API/types from npm package: `@mediapipe/tasks-vision`
- WASM delivery via `wasmFilesBaseUri`:
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm`

## Development

```bash
pnpm install
pnpm dev
```

## Production Build

```bash
pnpm build
pnpm preview
```

## Foundation Modules

- `src/core/tracker.ts` — webcam + Face Landmarker pipeline, smoothing, and face-count gating
- `src/core/camera.ts` — per-frame off-axis frustum projection update
- `src/core/renderer.ts` — renderer bootstrap, resize handling, and RAF loop
- `src/worlds/test-world.ts` — minimal validation world
- `src/ui/overlay.ts` — tracker/FPS diagnostics overlay

## Projection Units and Calibration Assumption

Current off-axis projection uses physical screen dimensions in cm:

- width: `53.0 cm`
- height: `29.8 cm` (16:9)

Head pose is normalized into the same approximate cm space. This is a practical default for foundation testing; a per-device calibration step can be added later.

## Smoke Test Checklist

1. Start app with `pnpm dev`.
2. Grant camera permission.
3. Verify single-face tracking state:
   - overlay status is `tracking`
   - moving head left/right/up/down shifts perspective naturally
4. Verify no-face behavior:
   - leave frame
   - overlay status changes to `no-face`
5. Verify multi-face lock:
   - show two faces in frame
   - overlay status changes to `multi-face`
6. Verify resize resilience:
   - resize browser window
   - canvas remains stable and rendering continues
