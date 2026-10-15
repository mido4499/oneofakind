export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Maps a count onto 0..1 on a log scale: `decades` = how many powers of ten reach 1.0. */
export function logScale(value: number | null | undefined, decades: number): number {
  if (!value || value < 0) return 0;
  return clamp(Math.log10(value + 1) / decades);
}

export function monthsSince(iso: string, now: Date): number | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return Math.max(0, (now.getTime() - time) / (30.44 * 24 * 3600 * 1000));
}

/** Probability that at least one of several independent risks materializes. */
export function orCombine(risks: number[]): number {
  return 1 - risks.reduce((survival, risk) => survival * (1 - risk), 1);
}

export function compact<T>(values: (T | null | undefined | '' | false)[]): T[] {
  return values.filter(Boolean) as T[];
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
