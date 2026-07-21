// Deterministic PRNG so the simulated dataset is stable across reloads.
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

export const jitter = (rng: Rng, base: number, spread: number): number =>
  base * (1 + (rng() * 2 - 1) * spread)

export const randInt = (rng: Rng, min: number, max: number): number =>
  Math.floor(rng() * (max - min + 1)) + min

export const pick = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)]
