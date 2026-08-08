export interface ManualLocality {
  id: string;
  label: string;
  region: string;
  latitude: number;
  longitude: number;
  note: string;
}

export const manualLocalityPresets: readonly ManualLocality[] = [
  {
    id: "bogota",
    label: "Bogota",
    region: "Colombia",
    latitude: 4.711,
    longitude: -74.0721,
    note: "Default manual coordinate used by fixtures."
  },
  {
    id: "mexico-city",
    label: "Mexico City",
    region: "Mexico",
    latitude: 19.4326,
    longitude: -99.1332,
    note: "Manual city preset."
  },
  {
    id: "santiago",
    label: "Santiago",
    region: "Chile",
    latitude: -33.4489,
    longitude: -70.6693,
    note: "Manual city preset."
  },
  {
    id: "buenos-aires",
    label: "Buenos Aires",
    region: "Argentina",
    latitude: -34.6037,
    longitude: -58.3816,
    note: "Manual city preset."
  },
  {
    id: "quito",
    label: "Quito",
    region: "Ecuador",
    latitude: -0.1807,
    longitude: -78.4678,
    note: "Manual city preset."
  }
] as const;

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}
