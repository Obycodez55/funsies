import type { FrameState } from "../shared/types";

interface OverlayApi {
  update(frameState: FrameState, fps: number): void;
  destroy(): void;
}

const formatNum = (value: number | undefined): string =>
  typeof value === "number" ? value.toFixed(2) : "-";

export const createOverlay = (parent: HTMLElement): OverlayApi => {
  const root = document.createElement("div");
  root.className = "debug-overlay";
  parent.appendChild(root);

  return {
    update(frameState, fps) {
      const raw = frameState.rawHeadPose;
      const smooth = frameState.headPose;

      root.innerHTML = [
        `<div><strong>Status:</strong> ${frameState.trackerStatus}</div>`,
        `<div><strong>FPS:</strong> ${fps.toFixed(1)}</div>`,
        `<div><strong>Raw:</strong> x=${formatNum(raw?.x)} y=${formatNum(raw?.y)} z=${formatNum(raw?.z)} c=${formatNum(raw?.confidence)} faces=${raw?.faceCount ?? 0}</div>`,
        `<div><strong>Smooth:</strong> x=${formatNum(smooth?.x)} y=${formatNum(smooth?.y)} z=${formatNum(smooth?.z)} c=${formatNum(smooth?.confidence)} faces=${smooth?.faceCount ?? 0}</div>`,
      ].join("");
    },
    destroy() {
      root.remove();
    },
  };
};
