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
  const ambientTrack = new Audio("/audio/ambient.m4a");
  ambientTrack.loop = true;
  ambientTrack.preload = "auto";
  ambientTrack.crossOrigin = "anonymous";
  ambientTrack.volume = 0.42;
  const nasaJupiterTrack = new Audio("/audio/nasa-jupiter-voyager.mp3");
  nasaJupiterTrack.loop = true;
  nasaJupiterTrack.preload = "auto";
  nasaJupiterTrack.crossOrigin = "anonymous";
  const nasaSaturnTrack = new Audio("/audio/nasa-saturn-radio.mp3");
  nasaSaturnTrack.loop = true;
  nasaSaturnTrack.preload = "auto";
  nasaSaturnTrack.crossOrigin = "anonymous";

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
  const ambientSource = context.createMediaElementSource(ambientTrack);
  const ambientGain = context.createGain();
  ambientGain.gain.value = 1.0;
  ambientSource.connect(ambientGain);
  ambientGain.connect(masterGain);
  const nasaJupiterSource = context.createMediaElementSource(nasaJupiterTrack);
  const nasaJupiterGain = context.createGain();
  nasaJupiterGain.gain.value = 0;
  nasaJupiterSource.connect(nasaJupiterGain);
  nasaJupiterGain.connect(masterGain);
  const nasaSaturnSource = context.createMediaElementSource(nasaSaturnTrack);
  const nasaSaturnGain = context.createGain();
  nasaSaturnGain.gain.value = 0;
  nasaSaturnSource.connect(nasaSaturnGain);
  nasaSaturnGain.connect(masterGain);

  // Layer 1: soft warmth (light, not cinematic sub-rumble)
  const subOsc = context.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.value = 72;
  const subGain = context.createGain();
  subGain.gain.value = 0.02;
  subOsc.connect(subGain);
  subGain.connect(masterGain);

  // Layer 2: friendly “root” — triangle reads softer than sine here
  const midOsc = context.createOscillator();
  midOsc.type = "triangle";
  midOsc.frequency.value = 220;
  const midGain = context.createGain();
  midGain.gain.value = 0.028;
  midOsc.connect(midGain);
  midGain.connect(masterGain);

  // Layer 2b: perfect fifth for airy major color (very quiet)
  const fifthOsc = context.createOscillator();
  fifthOsc.type = "sine";
  fifthOsc.frequency.value = 330;
  const fifthGain = context.createGain();
  fifthGain.gain.value = 0.01;
  fifthOsc.connect(fifthGain);
  fifthGain.connect(masterGain);

  // Layer 3: wide sparkly band (lower Q = less “horror whistle”)
  const shimOsc = context.createOscillator();
  shimOsc.type = "triangle";
  shimOsc.frequency.value = 1400;
  const shimGain = context.createGain();
  shimGain.gain.value = 0.014;
  const shimFilter = context.createBiquadFilter();
  shimFilter.type = "bandpass";
  shimFilter.frequency.value = 1200;
  shimFilter.Q.value = 4.5;
  shimOsc.connect(shimFilter);
  shimFilter.connect(shimGain);
  shimGain.connect(masterGain);

  let disposed = false;
  let phase = 0;
  let listenersAttached = false;
  let started = false;
  let oscillatorsStarted = false;
  let ambientStarted = false;
  let nasaStarted = false;

  const MASTER_TARGET = 0.34;
  const eventTypes: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];

  const startMaster = (): void => {
    if (disposed || started) {
      return;
    }
    started = true;
    const now = context.currentTime;
    if (!oscillatorsStarted) {
      oscillatorsStarted = true;
      subOsc.start(now);
      midOsc.start(now);
      fifthOsc.start(now);
      shimOsc.start(now);
    }
    if (!ambientStarted) {
      ambientStarted = true;
      void ambientTrack.play().catch(() => {});
    }
    if (!nasaStarted) {
      nasaStarted = true;
      void nasaJupiterTrack.play().then(() => {
        const t = context.currentTime;
        nasaJupiterGain.gain.cancelScheduledValues(t);
        nasaJupiterGain.gain.setValueAtTime(0, t);
        nasaJupiterGain.gain.linearRampToValueAtTime(0.28, t + 4);
      }).catch(() => {});
      void nasaSaturnTrack.play().then(() => {
        const t = context.currentTime;
        nasaSaturnGain.gain.cancelScheduledValues(t);
        nasaSaturnGain.gain.setValueAtTime(0, t);
        nasaSaturnGain.gain.linearRampToValueAtTime(0.12, t + 6);
      }).catch(() => {});
    }
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(MASTER_TARGET, now + 0.65);
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
    void context
      .resume()
      .then(() => {
        if (disposed) return;
        startMaster();
        clearInteractionListeners();
      })
      .catch(() => {});
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
      // Light “bounce” on the root — a bit quicker than the old slow swell
      const breath = 0.02 + 0.012 * Math.sin(phase * 0.32 * Math.PI * 2);
      midGain.gain.setTargetAtTime(breath, now, 0.35);
      // Gentle shimmer on the fifth
      const fifthBreath = 0.006 + 0.005 * Math.sin(phase * 0.41 * Math.PI * 2 + 1.1);
      fifthGain.gain.setTargetAtTime(fifthBreath, now, 0.45);
      // Sparkly filter motion (carrier + filter peak wander)
      shimOsc.frequency.setTargetAtTime(1320 + 120 * Math.sin(phase * 2.9), now, 0.18);
      shimFilter.frequency.setTargetAtTime(1050 + 220 * Math.sin(phase * 2.1 + 0.4), now, 0.25);
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
      eventGain.gain.value = 1;
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
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(260, now + 0.32);
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.065, now + 0.07);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.44);
          } else if (type === "supernova") {
            osc.type = "triangle";
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(720, now + 0.28);
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.09, now + 0.1);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.48);
            osc.start(now);
            osc.stop(now + 0.52);
          } else if (type === "shootingStar") {
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(2200, now + 0.1);
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.055, now + 0.035);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.16);
            osc.start(now);
            osc.stop(now + 0.2);
          } else {
            osc.type = "triangle";
            osc.frequency.setValueAtTime(640, now);
            osc.frequency.exponentialRampToValueAtTime(360, now + 0.18);
            burstGain.gain.setValueAtTime(0, now);
            burstGain.gain.linearRampToValueAtTime(0.06, now + 0.04);
            burstGain.gain.linearRampToValueAtTime(0, now + 0.22);
            osc.start(now);
            osc.stop(now + 0.26);
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
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.24);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.12, now + 0.05);
      g.gain.linearRampToValueAtTime(0, now + 0.42);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.46);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      eventTypes.forEach((type) => window.removeEventListener(type, resume));
      ambientTrack.pause();
      ambientTrack.currentTime = 0;
      nasaJupiterTrack.pause();
      nasaJupiterTrack.src = "";
      nasaSaturnTrack.pause();
      nasaSaturnTrack.src = "";
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.linearRampToValueAtTime(0.0, now + 0.2);
      if (oscillatorsStarted) {
        subOsc.stop(now + 0.25);
        midOsc.stop(now + 0.25);
        fifthOsc.stop(now + 0.25);
        shimOsc.stop(now + 0.25);
      }
      subOsc.disconnect();
      midOsc.disconnect();
      fifthOsc.disconnect();
      shimOsc.disconnect();
      subGain.disconnect();
      midGain.disconnect();
      fifthGain.disconnect();
      shimGain.disconnect();
      shimFilter.disconnect();
      ambientGain.disconnect();
      ambientSource.disconnect();
      nasaJupiterGain.disconnect();
      nasaJupiterSource.disconnect();
      nasaSaturnGain.disconnect();
      nasaSaturnSource.disconnect();
      masterGain.disconnect();
      void context.close();
    },
  };
};
