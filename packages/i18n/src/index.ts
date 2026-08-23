export const messages = {
  en: { syntheticData: 'Synthetic demonstration data — not government telemetry' },
  ru: { syntheticData: 'Демонстрационные синтетические данные — не государственная телеметрия' },
  uz: { syntheticData: "Sun'iy namoyish ma'lumotlari — davlat telemetriyasi emas" },
} as const;
export type Locale = keyof typeof messages;
