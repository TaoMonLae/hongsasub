export interface Settings {
  autosaveSeconds: number;
  autoFill: boolean;
  snap: boolean;
}

export const DEFAULT_SETTINGS: Settings = { autosaveSeconds: 45, autoFill: true, snap: true };
export const AUTOSAVE_CHOICES = [0, 15, 45, 120, 300];

const KEY = "hongsasub.settings";

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      autosaveSeconds: AUTOSAVE_CHOICES.includes(Number(saved.autosaveSeconds)) ? Number(saved.autosaveSeconds) : DEFAULT_SETTINGS.autosaveSeconds,
      autoFill: typeof saved.autoFill === "boolean" ? saved.autoFill : DEFAULT_SETTINGS.autoFill,
      snap: typeof saved.snap === "boolean" ? saved.snap : DEFAULT_SETTINGS.snap,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function storeSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}
