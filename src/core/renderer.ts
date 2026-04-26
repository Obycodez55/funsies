import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Vector2 } from "three";
import { BLOOM_RESOLUTION_SCALE } from "../shared/constants";
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
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0, 0, 1);
  bloomPass.enabled = false;
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

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
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(
      Math.max(1, Math.floor(width * BLOOM_RESOLUTION_SCALE)),
      Math.max(1, Math.floor(height * BLOOM_RESOLUTION_SCALE)),
    );
  };

  const loop = (ts: number): void => {
    const dt = lastTs === 0 ? 0 : (ts - lastTs) / 1000;
    lastTs = ts;

    frameHandler?.(dt);
    composer.render();
    rafId = window.requestAnimationFrame(loop);
  };

  const handleResize = (): void => {
    syncSize();
  };

  window.addEventListener("resize", handleResize);
  syncSize();

  const setBloom: AppContext["setBloom"] = (profile) => {
    if (!profile) {
      bloomPass.enabled = false;
      return;
    }

    bloomPass.enabled = true;
    bloomPass.strength = profile.strength;
    bloomPass.radius = profile.radius;
    bloomPass.threshold = profile.threshold;
  };

  return {
    ctx: { scene, camera, renderer, setBloom },
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
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
