export const UI_SYSTEM_PACKAGE = true;

export const cosmoColors = {
  night950: "#100a18",
  night900: "#181021",
  night850: "#21162b",
  bone100: "#f4efe5",
  bone300: "#c9c0b2",
  acid: "#c9f45a",
  solar: "#ffb84c",
  aqua: "#6be5d7",
  violet: "#b79cff",
  rose: "#ff7e9d"
} as const;

export const epistemicMarks = {
  measured: "●",
  forecast: "◐",
  event: "◆",
  aggregate: "▥",
  inferred: "◇",
  interpreted: "≈",
  speculative: "✧",
  unknown: "○",
  refused: "⊘"
} as const;

export const sourceStrata = [
  "cosmos",
  "atmosphere",
  "hydrosphere",
  "geosphere",
  "biosphere",
  "human",
  "machine"
] as const;

export type SourceStratum = (typeof sourceStrata)[number];

export const sourceStratumLabels: Record<SourceStratum, string> = {
  cosmos: "Cosmos",
  atmosphere: "Atmosphere",
  hydrosphere: "Hydrosphere",
  geosphere: "Geosphere",
  biosphere: "Biosphere",
  human: "Human activity",
  machine: "Machine / infrastructure"
};

export const layerLabels = {
  earth: "Tierra",
  cloud: "Nube",
  city: "Ciudad",
  address: "Dirección",
  interface: "Interfaz",
  user: "Usuario"
} as const;
