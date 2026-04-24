import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  DEFAULT_HEAD_Z_CM,
  HEAD_X_RANGE,
  HEAD_Y_RANGE,
  MAX_HEAD_Z_CM,
  MEDIAPIPE_WASM_BASE_URI,
  MIN_HEAD_Z_CM,
  TRACKER_BASELINE_EYE_ALPHA,
  TRACKER_DEPTH_RESPONSE_GAIN,
  TRACKER_SMOOTHING_ALPHA,
  TRACKER_TARGET_FPS,
} from "../shared/constants";
import type { FrameState, HeadPose, TrackerStatus } from "../shared/types";
import { clamp, lerp } from "../shared/math";

const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const LANDMARK_INDEX = {
  noseTip: 1,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
} as const;

const createDefaultFrameState = (): FrameState => ({
  rawHeadPose: null,
  headPose: null,
  trackerStatus: "idle",
});

export class HeadTracker {
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private frameState: FrameState = createDefaultFrameState();
  private rafId = 0;
  private lastProcessTs = 0;
  private lastVideoTime = -1;
  private smoothedPose: HeadPose | null = null;
  private baselineEyeDistance: number | null = null;

  async start(): Promise<void> {
    if (this.rafId !== 0) {
      return;
    }

    try {
      this.setStatus("initializing");
      await this.initVideo();
      await this.initLandmarker();
    } catch {
      this.dispose();
      if (this.frameState.trackerStatus !== "permission-denied") {
        this.setStatus("error");
        throw new Error("Face landmarker failed to load.");
      }
      throw new Error("Camera permission denied.");
    }

    const tick = (): void => {
      this.processFrame();
      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  dispose(): void {
    this.stop();
    this.faceLandmarker?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.videoElement?.remove();
    this.faceLandmarker = null;
    this.stream = null;
    this.videoElement = null;
    this.smoothedPose = null;
    this.baselineEyeDistance = null;
    this.lastProcessTs = 0;
    this.lastVideoTime = -1;
    this.frameState = createDefaultFrameState();
  }

  getFrameState(): FrameState {
    return this.frameState;
  }

  private setStatus(status: TrackerStatus): void {
    this.frameState = {
      ...this.frameState,
      trackerStatus: status,
    };
  }

  private async initVideo(): Promise<void> {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      this.videoElement = video;
      this.stream = stream;
    } catch {
      this.setStatus("permission-denied");
      throw new Error("Camera permission denied.");
    }
  }

  private async initLandmarker(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URI);
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL,
      },
      runningMode: "VIDEO",
      numFaces: 2,
    });
  }

  private processFrame(): void {
    if (!this.videoElement || !this.faceLandmarker) {
      return;
    }

    const now = performance.now();
    const minInterval = 1000 / TRACKER_TARGET_FPS;
    const hasNewVideoFrame = this.videoElement.currentTime !== this.lastVideoTime;
    if (now - this.lastProcessTs < minInterval || !hasNewVideoFrame) {
      return;
    }

    this.lastProcessTs = now;
    this.lastVideoTime = this.videoElement.currentTime;

    const result = this.faceLandmarker.detectForVideo(
      this.videoElement,
      now,
    );
    this.updateStateFromResult(result);
  }

  private updateStateFromResult(result: FaceLandmarkerResult): void {
    const faceCount = result.faceLandmarks.length;

    if (faceCount === 0) {
      this.smoothedPose = null;
      this.baselineEyeDistance = null;
      this.frameState = {
        rawHeadPose: null,
        headPose: null,
        trackerStatus: "no-face",
      };
      return;
    }

    if (faceCount > 1) {
      this.smoothedPose = null;
      this.baselineEyeDistance = null;
      this.frameState = {
        rawHeadPose: null,
        headPose: null,
        trackerStatus: "multi-face",
      };
      return;
    }

    const rawPose = this.getRawHeadPose(result, faceCount);
    if (!rawPose) {
      this.baselineEyeDistance = null;
      this.frameState = {
        rawHeadPose: null,
        headPose: null,
        trackerStatus: "no-face",
      };
      return;
    }

    const nextSmoothed = this.smoothedPose
      ? {
          ...rawPose,
          x: lerp(this.smoothedPose.x, rawPose.x, TRACKER_SMOOTHING_ALPHA),
          y: lerp(this.smoothedPose.y, rawPose.y, TRACKER_SMOOTHING_ALPHA),
          z: lerp(this.smoothedPose.z, rawPose.z, TRACKER_SMOOTHING_ALPHA),
          confidence: rawPose.confidence,
        }
      : rawPose;

    this.smoothedPose = nextSmoothed;
    this.frameState = {
      rawHeadPose: rawPose,
      headPose: nextSmoothed,
      trackerStatus: "tracking",
    };
  }

  private getRawHeadPose(
    result: FaceLandmarkerResult,
    faceCount: number,
  ): HeadPose | null {
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) {
      return null;
    }

    const nose = landmarks[LANDMARK_INDEX.noseTip];
    const leftEye = landmarks[LANDMARK_INDEX.leftEyeOuter];
    const rightEye = landmarks[LANDMARK_INDEX.rightEyeOuter];

    if (!nose || !leftEye || !rightEye) {
      return null;
    }

    const eyeDistanceNorm = Math.hypot(
      rightEye.x - leftEye.x,
      rightEye.y - leftEye.y,
      rightEye.z - leftEye.z,
    );

    if (eyeDistanceNorm <= 0.0001) {
      return null;
    }

    this.baselineEyeDistance =
      this.baselineEyeDistance === null
        ? eyeDistanceNorm
        : lerp(this.baselineEyeDistance, eyeDistanceNorm, TRACKER_BASELINE_EYE_ALPHA);

    const depthDelta = eyeDistanceNorm - this.baselineEyeDistance;
    const x = (nose.x - 0.5) * HEAD_X_RANGE;
    const y = -(nose.y - 0.5) * HEAD_Y_RANGE;
    const z = clamp(
      DEFAULT_HEAD_Z_CM - depthDelta * TRACKER_DEPTH_RESPONSE_GAIN,
      MIN_HEAD_Z_CM,
      MAX_HEAD_Z_CM,
    );

    return {
      x,
      y,
      z,
      confidence: 1,
      faceCount,
    };
  }
}
