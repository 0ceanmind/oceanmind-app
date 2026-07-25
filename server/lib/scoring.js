/** Score → OceanMind dive-depth mapping. */

export const ZONE_BOUNDS = {
  sunlight: { min: 40, max: 200 },
  twilight: { min: 200, max: 1000 },
  midnight: { min: 1000, max: 4000 },
};

export function zoneForScore(scorePct) {
  if (scorePct < 40) return 'sunlight';
  if (scorePct < 75) return 'twilight';
  return 'midnight';
}

/**
 * Map score % to a dive depth in meters.
 *   0–39%  → 40–200 m   (Sunlight)
 *   40–74% → 200–1000 m (Twilight)
 *   75–100%→ 1000–4000 m (Midnight)
 */
export function depthForScore(scorePct) {
  const s = Math.max(0, Math.min(100, scorePct));
  if (s < 40) return Math.round(40 + (s / 40) * 160);
  if (s < 75) return Math.round(200 + ((s - 40) / 35) * 800);
  return Math.round(1000 + ((s - 75) / 25) * 3000);
}

/** Representative depth for a zone (used when support sets a zone directly). */
export function midZoneDepth(zone) {
  const b = ZONE_BOUNDS[zone];
  return Math.round((b.min + b.max) / 2);
}
