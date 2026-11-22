import { useEffect } from "react";
import { api, type BundledFont } from "./api";

let listing: Promise<BundledFont[]> | null = null;
const started = new Set<string>();

export function loadBundledFonts(): Promise<BundledFont[]> {
  listing ??= api.bundledFonts().catch((e) => {
    listing = null;
    throw e;
  });
  return listing;
}

async function loadFace(face: BundledFont) {
  const data = await api.bundledFontData(face.file);
  const loaded = await new FontFace(face.family, data, { weight: face.weight }).load();
  document.fonts.add(loaded);
}

export function ensureFont(family: string) {
  const wanted = family.trim().toLowerCase();
  if (!wanted || started.has(wanted)) return;
  started.add(wanted);
  loadBundledFonts()
    .then((fonts) => Promise.all(fonts.filter((f) => f.family.toLowerCase() === wanted).map(loadFace)))
    .catch(() => {
      started.delete(wanted);
    });
}

export function useFonts(families: string[]) {
  const key = families.join("\n");
  useEffect(() => {
    for (const family of key.split("\n")) ensureFont(family);
  }, [key]);
}
