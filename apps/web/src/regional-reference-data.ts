import snapshot from './regional-reference-snapshot.json' with { type: 'json' };

export const regionalReferenceData = snapshot;
export type ReferenceRecord = (typeof snapshot.records)[number];

export function filterReferenceRecords(query: string, canal: string, source: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return snapshot.records.filter(
    (record) =>
      (!canal || record.canal === canal) &&
      (!source || record.sourceId === source) &&
      (!normalized ||
        `${record.name ?? ''} ${record.raw.sequence} ${record.id}`
          .toLocaleLowerCase()
          .includes(normalized)),
  );
}

export const referenceCounts = {
  savay: snapshot.records.filter(
    (row) => row.sourceId === 'savay-register' && row.canal === 'savay',
  ).length,
  oqbura: snapshot.records.filter((row) => row.canal === 'oqbura').length,
  supplement: snapshot.records.filter((row) => row.sourceId === 'savay-supplement').length,
  unnamed: snapshot.records.filter((row) => row.name === null).length,
};
