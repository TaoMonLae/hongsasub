const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const MOD = mac ? "⌘" : "Ctrl+";
export const ALT = mac ? "⌥" : "Alt+";
export const SHIFT = mac ? "⇧" : "Shift+";
export const ENTER = mac ? "↩" : "Enter";
