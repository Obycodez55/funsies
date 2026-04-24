export interface AudioController {
  update(dt: number): void;
  dispose(): void;
}

export type EventSoundType = "comet" | "supernova" | "shootingStar" | "warpStreak";

export interface EventPanner {
  setPosition(x: number, y: number, z: number): void;
  playBurst(type: EventSoundType): void;
  dispose(): void;
}

interface SpaceAudioController extends AudioController {
  resumeOnInteraction(): void;
  createEventPanner(): EventPanner;
  playArrivalBurst(): void;
}

const createAudioContext = (): AudioContext | null => {
  const Ctx =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
};

const nullEventPanner: EventPanner = {
  setPosition() {},
  playBurst() {},
  dispose() {},
};

export const createSpaceAudio = (): SpaceAudioController => {
  const context = createAudioContext();
  if (!context) {
    return {
      resumeOnInteraction() {},
      update() {},
      dispose() {},
      createEventPanner: () => nullEventPanner,
      playArrivalBurst() {},
    };
  }

  const masterGain = context.createGain();
  masterGain.gain.value = 0.0;
  masterGain.connect(context.destination);

  // Layer 1: 45 Hz sub-bass
  const subOsc = context.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.value = 45;
  const subGain = context.createGain();
  subGain.gain.value = 0.07;
  subOsc.connect(subGain);
  subGain.connect(masterGain);

  // Layer 2: 110 Hz breathing mid — gain oscillates slowly via update()
  const midOsc = context.createOscillator();
  midOsc.type = "sine";
  midOsc.frequency.value = 110;
  const midGain = context.createGain();
  midGain.gain.value = 0.025;
  midOsc.connect(midGain);
  midGain.connect(masterGain);

  // Layer 3: 900 Hz shimmer through bandpass
  const shimOsc = context.createOscillator();
  shimOsc.type = "triangle";
  shimOsc.frequency.value = 900;
  const shimGain = context.createGain();
  shimGain.gain.value = 0.015;
  const shimFilter = context.createBiquadFilter();
  shimFilter.type = "bandpass";
  shimFilter.frequency.value = 900;
  shimFilter.Q.value = 18;
  shimOsc.connect(shimFilter);
  shimFilter.connect(shimGain);
  shimGain.connect(masterGain);

  subOsc.start();
  midOsc.start();
  shimOsc.start();

  let disposed = false;
  let phase = 0;
  let listenersAttached = false;
  let started = false;
  const eventTypes: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];

  const startMaster = (): void => {
    if (disposed || started) return;
    started = true;
    const now = context.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0.16, now + 0.8);
  };

  const clearInteractionListeners = (): void => {
    eventTypes.forEach((type) => window.removeEventListener(type, resume));
    listenersAttached = false;
  };

  const resume = (): void => {
    if (disposed) return;
    if (context.state === "running") {
      startMaster();
      clearInteractionListeners();
      return;
    }
    void context.resume().then(() => {
      if (disposed) return;
      startMaster();
      const now = context.currentTime;
      // Slightly reinforce post-resume transition in case browser paused timers.
      masterGain.gain.setTargetAtTime(0.16, now, 0.25);
      clearInteractionListeners();
    });
  };

  return {
    resumeOnInteraction() {
      if (disposed) return;
      if (context.state === "running") {
        startMaster();
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
      if (disposed || context.state !== "running") return;
      phase += dt;
      const now = context.currentTime;
      // Mid layer breathing: 0.015–0.04 at ~0.15 Hz
      const breath = 0.0275 + 0.0125 * Math.sin(phase * 0.15 * Math.PI * 2);
      midGain.gain.setTargetAtTime(breath, now, 0.4);
      // Shimmer frequency flutter
      shimOsc.frequency.setTargetAtTime(895 + 10 * Math.sin(phase * 0.7), now, 0.2);
    },

    createEventPanner(): EventPanner {
      if (disposed) return nullEventPanner;
      const panner = context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 1;
      panner.maxDistance = 200;
      panner.rolloffFactor = 0.5;
      const eventGain = context.createGain();
      eventGain.gain.value = 0;
      panner.connect(eventGain);
      eventGain.connect(masterGain);

      let pannerDisposed = false;

      return {
        setPosition(x: number, y: number, z: number) {
          if (pannerDisposed) return;
          panner.positionX.setValueAtTime(x, context.currentTime);
          panner.positionY.setValueAtTime(y, context.currentTime);
          panner.positionZ.setValueAtTime(z, context.currentTime);
        },
        playBurst(type: EventSoundType) {
          if (pannerDisposed || context.state !== "running") return;
          const now = context.currentTime;
          const osc = context.createOscillator();
          const burstGain = context.createGain();
          osc.connect(burstGain);
          burstGain.connect(panner);

          if (type === "comet") {
            osc.type = "triangle";
            osc.frequency.value = 220;
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.12, now + 0.15);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.8);
            osc.start(now);
            osc.stop(now + 0.85);
          } else if (type === "supernova") {
            osc.type = "sine";
            osc.frequency.value = 55;
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.2, now + 0.3);
            burstGain.gain.linearRampToValueAtTime(0, now + 3.0);
            osc.start(now);
            osc.stop(now + 3.1);
          } else if (type === "shootingStar") {
            osc.type = "sine";
            osc.frequency.value = 800;
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.08, now + 0.05);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.4);
          } else {
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(1400, now);
            osc.frequency.exponentialRampToValueAtTime(520, now + 0.28);
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.1, now + 0.03);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.32);
          }
        },
        dispose() {
          if (pannerDisposed) return;
          pannerDisposed = true;
          panner.disconnect();
          eventGain.disconnect();
        },
      };
    },

    playArrivalBurst() {
      if (disposed || context.state !== "running") return;
      const now = context.currentTime;
      const osc = context.createOscillator();
      const g = context.createGain();
      osc.type = "sine";
      osc.frequency.value = 45;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.3, now + 0.1);
      g.gain.linearRampToValueAtTime(0, now + 0.8);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.85);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      eventTypes.forEach((type) => window.removeEventListener(type, resume));
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0.0, now + 0.2);
      subOsc.stop(now + 0.25);
      midOsc.stop(now + 0.25);
      shimOsc.stop(now + 0.25);
      subOsc.disconnect();
      midOsc.disconnect();
      shimOsc.disconnect();
      subGain.disconnect();
      midGain.disconnect();
      shimGain.disconnect();
      shimFilter.disconnect();
      masterGain.disconnect();
      void context.close();
    },
  };
};
