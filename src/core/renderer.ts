import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { AppContext, ViewportSize } from "../shared/types";

interface RendererRuntime {
  ctx: AppContext;
  size: ViewportSize;
  setFrameHandler(handler: (dt: number) => void): void;
  resize(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export const createRendererRuntime = (container: HTMLElement): RendererRuntime => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 500);
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x06090f);

  container.appendChild(renderer.domElement);

  let frameHandler: ((dt: number) => void) | null = null;
  let rafId = 0;
  let lastTs = 0;

  const size: ViewportSize = {
    width: 0,
    height: 0,
    dpr: 1,
  };

  const syncSize = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    size.width = width;
    size.height = height;
    size.dpr = dpr;

    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  };

  const loop = (ts: number): void => {
    const dt = lastTs === 0 ? 0 : (ts - lastTs) / 1000;
    lastTs = ts;

    frameHandler?.(dt);
    renderer.render(scene, camera);
    rafId = window.requestAnimationFrame(loop);
  };

  const handleResize = (): void => {
    syncSize();
  };

  window.addEventListener("resize", handleResize);
  syncSize();

  return {
    ctx: { scene, camera, renderer },
    size,
    setFrameHandler(handler) {
      frameHandler = handler;
    },
    resize() {
      syncSize();
    },
    start() {
      if (rafId !== 0) {
        return;
      }
      lastTs = 0;
      rafId = window.requestAnimationFrame(loop);
    },
    stop() {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    dispose() {
      this.stop();
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
