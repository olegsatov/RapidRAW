import type { Adjustments } from './adjustments';

// Returns the sorted list of top-level adjustment keys whose values differ
// between two history snapshots. Used for naming history entries and for
// merging consecutive edits that touch the same keys.
export function getChangedTopLevelKeys(prev: Adjustments, curr: Adjustments): string[] {
  const keys = Object.keys(curr) as (keyof Adjustments)[];
  return keys.filter((key) => JSON.stringify(prev[key]) !== JSON.stringify(curr[key])).sort() as string[];
}

export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
