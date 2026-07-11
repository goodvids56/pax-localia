export interface MapGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface MapFeature {
  type: 'Feature';
  id: string;
  properties: {
    regionId: string;
    name: string;
  };
  geometry: MapGeometry;
}

export interface MapFeatureCollection {
  type: 'FeatureCollection';
  features: MapFeature[];
}

interface DatasetDefinition {
  id: string;
  columns: number;
  rows: number;
  origin: [number, number];
  cell: [number, number];
  regions: readonly { id: string; name: string }[];
}

const datasets: readonly DatasetDefinition[] = [
  {
    id: 'map:border-crisis-v1',
    columns: 5,
    rows: 3,
    origin: [-10, 40],
    cell: [4, 3],
    regions: [
      { id: 'region:northwatch', name: 'Northwatch' },
      { id: 'region:pine-march', name: 'Pine March' },
      { id: 'region:high-vale', name: 'High Vale' },
      { id: 'region:brine-coast', name: 'Brine Coast' },
      { id: 'region:east-harbor', name: 'East Harbor' },
      { id: 'region:westmere', name: 'Westmere' },
      { id: 'region:amber-fields', name: 'Amber Fields' },
      { id: 'region:selene-crossing', name: 'Selene Crossing' },
      { id: 'region:veyra-gate', name: 'Veyra Gate' },
      { id: 'region:red-cliffs', name: 'Red Cliffs' },
      { id: 'region:aster-bay', name: 'Aster Bay' },
      { id: 'region:greenfold', name: 'Greenfold' },
      { id: 'region:south-road', name: 'South Road' },
      { id: 'region:glass-steppe', name: 'Glass Steppe' },
      { id: 'region:dawn-coast', name: 'Dawn Coast' },
    ],
  },
  {
    id: 'map:hellenic-peace-v1',
    columns: 3,
    rows: 3,
    origin: [20, 36],
    cell: [2.2, 2],
    regions: [
      { id: 'region:attica', name: 'Attica' },
      { id: 'region:boeotia', name: 'Boeotia' },
      { id: 'region:euboea', name: 'Euboea' },
      { id: 'region:argolid', name: 'Argolid' },
      { id: 'region:corinthia', name: 'Corinthia' },
      { id: 'region:arcadia', name: 'Arcadia' },
      { id: 'region:laconia', name: 'Laconia' },
      { id: 'region:messene', name: 'Messene' },
      { id: 'region:mantinea', name: 'Mantinea' },
    ],
  },
  {
    id: 'map:orpheus-reach-v1',
    columns: 4,
    rows: 3,
    origin: [105, -12],
    cell: [5, 4],
    regions: [
      { id: 'region:helion-prime', name: 'Helion Prime' },
      { id: 'region:flare-belt', name: 'Flare Belt' },
      { id: 'region:veil-port', name: 'Veil Port' },
      { id: 'region:echo-drift', name: 'Echo Drift' },
      { id: 'region:chorus-one', name: 'Chorus One' },
      { id: 'region:spore-sea', name: 'Spore Sea' },
      { id: 'region:relay-nine', name: 'Relay Nine' },
      { id: 'region:ashen-ring', name: 'Ashen Ring' },
      { id: 'region:pilgrim-span', name: 'Pilgrim Span' },
      { id: 'region:quiet-moon', name: 'Quiet Moon' },
      { id: 'region:foundry-arc', name: 'Foundry Arc' },
      { id: 'region:outer-dark', name: 'Outer Dark' },
    ],
  },
] as const;

function polygonFor(
  column: number,
  row: number,
  origin: [number, number],
  cell: [number, number],
): number[][][] {
  const left = origin[0] + column * cell[0];
  const bottom = origin[1] + row * cell[1];
  const right = left + cell[0];
  const top = bottom + cell[1];
  const notch = (column + row) % 2 === 0 ? cell[1] * 0.14 : -cell[1] * 0.14;
  return [
    [
      [left, bottom],
      [right, bottom + notch],
      [right, top + notch],
      [left, top],
      [left, bottom],
    ],
  ];
}

export function getMapDataset(id: string): MapFeatureCollection {
  const dataset = datasets.find((candidate) => candidate.id === id);
  if (!dataset) {
    throw new Error(`Unknown bundled map dataset: ${id}`);
  }
  return {
    type: 'FeatureCollection',
    features: dataset.regions.map((region, index) => {
      const column = index % dataset.columns;
      const row = dataset.rows - 1 - Math.floor(index / dataset.columns);
      return {
        type: 'Feature',
        id: region.id,
        properties: {
          regionId: region.id,
          name: region.name,
        },
        geometry: {
          type: 'Polygon',
          coordinates: polygonFor(column, row, dataset.origin, dataset.cell),
        },
      };
    }),
  };
}

export function listMapDatasets(): readonly string[] {
  return datasets.map((dataset) => dataset.id);
}

export function mapAttribution(id: string): string {
  if (!datasets.some((dataset) => dataset.id === id)) {
    throw new Error(`Unknown bundled map dataset: ${id}`);
  }
  return 'Original schematic atomic-region geometry, Pax Localia contributors, CC0-1.0.';
}
