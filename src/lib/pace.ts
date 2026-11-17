const IDLE_CAP = 3 * 60 * 1000;

export interface Pace {
  perHour: number;
  leftMs: number;
  count: number;
}

export function pace(stamps: number[], remaining: number): Pace | null {
  if (stamps.length < 3) return null;
  let active = 0;
  for (let i = 1; i < stamps.length; i += 1) active += Math.min(IDLE_CAP, Math.max(0, stamps[i] - stamps[i - 1]));
  if (active <= 0) return null;
  const perMs = (stamps.length - 1) / active;
  return { perHour: perMs * 3_600_000, leftMs: remaining / perMs, count: stamps.length };
}

export function formatLeft(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
