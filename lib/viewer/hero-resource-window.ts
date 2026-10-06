export interface HeroResourceWindow<T> {
  ready: T[];
  files: T[];
}

/** Keep neighbors nearest first, including the carousel's wrap from last to first. */
export function createHeroResourceWindow<T>(
  entries: readonly (T | null | undefined)[],
  selectedIndex: number,
  key: (entry: T) => string,
): HeroResourceWindow<T> {
  if (!entries.length || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= entries.length) return { ready: [], files: [] };

  const collect = (radius: number): T[] => {
    const result: T[] = [];
    const seen = new Set<string>();
    const visit = (offset: number) => {
      const index = ((selectedIndex + offset) % entries.length + entries.length) % entries.length;
      const entry = entries[index];
      if (!entry) return;
      const id = key(entry);
      if (seen.has(id)) return;
      seen.add(id);
      result.push(entry);
    };
    visit(0);
    for (let offset = 1; offset <= Math.min(radius, entries.length - 1); offset++) {
      visit(offset);
      visit(-offset);
    }
    return result;
  };

  return { ready: collect(2), files: collect(10) };
}
