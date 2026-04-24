export interface AudioController {
  update(dt: number): void;
  dispose(): void;
}

interface SpaceDroneController extends AudioController {
  resumeOnInteraction(): void;
}

const createAudioContext = (): AudioContext | null => {
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  return new Ctx();
};

export const createSpaceDrone = (): SpaceDroneController => {
  const context = createAudioContext();
  if (!context) {
    return {
      resumeOnInteraction() {},
      update() {},
      dispose() {},
    };
  }

  const masterGain = context.createGain();
  masterGain.gain.value = 0.0;
  masterGain.connect(context.destination);

  const lowOsc = context.createOscillator();
  lowOsc.type = "sine";
  lowOsc.frequency.value = 56;

  const highOsc = context.createOscillator();
  highOsc.type = "triangle";
  highOsc.frequency.value = 84;

  const lowGain = context.createGain();
  lowGain.gain.value = 0.045;
  const highGain = context.createGain();
  highGain.gain.value = 0.018;

  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 620;
  filter.Q.value = 0.45;

  lowOsc.connect(lowGain);
  highOsc.connect(highGain);
  lowGain.connect(filter);
  highGain.connect(filter);
  filter.connect(masterGain);

  lowOsc.start();
  highOsc.start();

  let disposed = false;
  let phase = 0;
  let listenersAttached = false;
  const eventTypes: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];

  const resume = (): void => {
    if (disposed || context.state === "running") {
      return;
    }
    void context.resume().then(() => {
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0.14, now + 0.8);
      eventTypes.forEach((type) => window.removeEventListener(type, resume));
      listenersAttached = false;
    });
  };

  return {
    resumeOnInteraction() {
      if (disposed) {
        return;
      }
      if (context.state === "running") {
        resume();
        return;
      }
      if (!listenersAttached) {
        eventTypes.forEach((type) =>
          window.addEventListener(type, resume, { once: true, passive: true }),
        );
        listenersAttached = true;
      }
    },
    update(dt: number) {
      if (disposed || context.state !== "running") {
        return;
      }
      phase += dt;
      const wobble = Math.sin(phase * 0.6);
      const now = context.currentTime;
      filter.frequency.setTargetAtTime(560 + wobble * 80, now, 0.25);
      highOsc.frequency.setTargetAtTime(82 + wobble * 3.5, now, 0.3);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      eventTypes.forEach((type) => window.removeEventListener(type, resume));
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0.0, now + 0.2);
      lowOsc.stop(now + 0.25);
      highOsc.stop(now + 0.25);
      lowOsc.disconnect();
      highOsc.disconnect();
      lowGain.disconnect();
      highGain.disconnect();
      filter.disconnect();
      masterGain.disconnect();
      void context.close();
    },
  };
};
