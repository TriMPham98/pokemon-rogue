/** Meta-progression that survives between runs (localStorage; silently in-memory if unavailable). */
export interface Save {
  best: number;
  runs: number;
  caught: string[]; // species ids ever owned (caught or evolved into)
  shinies: string[];
}

const KEY = 'pr-save';

function load(): Save {
  const empty: Save = { best: 0, runs: 0, caught: [], shinies: [] };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return empty;
  }
}

export const save = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {}
}

/** Returns true the first time a species is registered. */
export function register(id: string, shiny = false) {
  const isNew = !save.caught.includes(id);
  if (isNew) save.caught.push(id);
  if (shiny && !save.shinies.includes(id)) save.shinies.push(id);
  persist();
  return isNew;
}

/** Records a finished run; returns true on a new best. */
export function finishRun(round: number) {
  save.runs++;
  const best = round > save.best;
  if (best) save.best = round;
  persist();
  return best;
}
