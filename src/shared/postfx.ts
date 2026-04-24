import type { BloomProfile } from "./types";

export const noBloomProfile: BloomProfile = {
  strength: 0,
  radius: 0,
  threshold: 1,
};

export const spaceBloomProfile: BloomProfile = {
  strength: 0.95,
  radius: 0.65,
  threshold: 0.3,
};
