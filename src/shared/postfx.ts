import type { BloomProfile } from "./types";

export const noBloomProfile: BloomProfile = {
  strength: 0,
  radius: 0,
  threshold: 1,
};

export const spaceBloomProfile: BloomProfile = {
  strength: 0.72,
  radius: 0.5,
  threshold: 0.62,
};
