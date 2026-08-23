/** Maps a read-model entity discriminator to a stable table/API identity. */
export const networkEntityTypes = [
  'region',
  'basin',
  'waterway',
  'junction',
  'section',
  'control_structure',
  'station',
  'device',
  'sensor',
] as const;
export type NetworkEntityType = (typeof networkEntityTypes)[number];

export function isMonitoringOnlyControlStructure(entity: {
  type: string;
  monitoringOnly?: boolean;
}): boolean {
  return entity.type !== 'control_structure' || entity.monitoringOnly === true;
}
