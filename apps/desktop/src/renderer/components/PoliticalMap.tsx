import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import type { ActorId, RegionId, WorldState } from '@pax-localia/domain';
import { getMapDataset } from '@pax-localia/map-data';

interface PoliticalMapProps {
  datasetId: string;
  world: WorldState;
  selectedRegionId: RegionId | undefined;
  reducedMotion: boolean;
  colorblindMode: string;
  onSelectRegion: (regionId: RegionId) => void;
  onSelectActor: (actorId: ActorId) => void;
}

type LayerMode = 'control' | 'ownership';

const colorblindPalette = [
  '#4477aa',
  '#ee6677',
  '#228833',
  '#ccbb44',
  '#66ccee',
  '#aa3377',
  '#bbbbbb',
];

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ??
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }),
    );
  } catch {
    return false;
  }
}

function collectionFor(
  datasetId: string,
  world: WorldState,
  mode: LayerMode,
  selectedRegionId: RegionId | undefined,
  colorblindMode: string,
): FeatureCollection {
  const source = getMapDataset(datasetId);
  const actorColors = new Map(
    Object.values(world.actors).map((actor, index) => [
      actor.id,
      colorblindMode === 'off'
        ? actor.color
        : (colorblindPalette[index % colorblindPalette.length] ?? actor.color),
    ]),
  );
  return {
    type: 'FeatureCollection',
    features: source.features.map((feature) => {
      const region = world.regions[feature.properties.regionId];
      const actorId = mode === 'control' ? region?.controllerId : region?.ownerId;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          actorId: actorId ?? '',
          actorName: actorId ? (world.actors[actorId]?.name ?? 'Unknown') : 'Unowned',
          color: actorId ? (actorColors.get(actorId) ?? '#5f6670') : '#313944',
          contested: Boolean(region?.contested),
          occupied: Boolean(region?.occupied),
          selected: region?.id === selectedRegionId,
        },
      };
    }),
  };
}

function boundsFor(collection: FeatureCollection): LngLatBoundsLike {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of collection.features) {
    if (feature.geometry.type !== 'Polygon') continue;
    for (const ring of feature.geometry.coordinates) {
      for (const coordinate of ring) {
        bounds.extend([coordinate[0] ?? 0, coordinate[1] ?? 0]);
      }
    }
  }
  return bounds;
}

export function PoliticalMap({
  datasetId,
  world,
  selectedRegionId,
  reducedMotion,
  colorblindMode,
  onSelectRegion,
  onSelectActor,
}: PoliticalMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | undefined>(undefined);
  const markers = useRef<Marker[]>([]);
  const worldRef = useRef(world);
  const selectRegionRef = useRef(onSelectRegion);
  const selectActorRef = useRef(onSelectActor);
  const reducedMotionRef = useRef(reducedMotion);
  const [layerMode, setLayerMode] = useState<LayerMode>('control');
  const [showCities, setShowCities] = useState(true);
  const [showUnits, setShowUnits] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const collection = useMemo(
    () => collectionFor(datasetId, world, layerMode, selectedRegionId, colorblindMode),
    [datasetId, world, layerMode, selectedRegionId, colorblindMode],
  );
  const collectionRef = useRef(collection);
  useEffect(() => {
    worldRef.current = world;
    selectRegionRef.current = onSelectRegion;
    selectActorRef.current = onSelectActor;
    reducedMotionRef.current = reducedMotion;
    collectionRef.current = collection;
  }, [collection, onSelectActor, onSelectRegion, reducedMotion, world]);

  useEffect(() => {
    if (!container.current || map.current) return;
    if (!supportsWebGl()) {
      queueMicrotask(() => setMapUnavailable(true));
      return;
    }
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#18232d' },
          },
        ],
      },
      attributionControl: false,
      renderWorldCopies: false,
      pitchWithRotate: false,
      dragRotate: false,
      maxPitch: 0,
      fadeDuration: reducedMotionRef.current ? 0 : 200,
    });
    map.current = instance;
    instance.on('error', (event: unknown) => {
      const error = (event as { error?: unknown }).error;
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.toLocaleLowerCase().includes('webgl')) {
        setMapUnavailable(true);
      }
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Original bundled schematic geometry · CC0',
      }),
      'bottom-right',
    );
    instance.on('load', () => {
      instance.addSource('regions', { type: 'geojson', data: collectionRef.current });
      instance.addLayer({
        id: 'region-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['boolean', ['get', 'occupied'], false], 0.62, 0.82],
        },
      });
      instance.addLayer({
        id: 'region-border',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': ['case', ['boolean', ['get', 'selected'], false], '#f5d58a', '#111820'],
          'line-width': [
            'case',
            ['boolean', ['get', 'selected'], false],
            3,
            ['boolean', ['get', 'contested'], false],
            2.4,
            1,
          ],
          'line-dasharray': [
            'case',
            ['boolean', ['get', 'contested'], false],
            ['literal', [2, 1.5]],
            ['literal', [1, 0]],
          ],
        },
      });
      instance.fitBounds(boundsFor(collectionRef.current), {
        padding: 54,
        duration: reducedMotionRef.current ? 0 : 450,
      });
    });
    instance.on('mouseenter', 'region-fill', () => {
      instance.getCanvas().style.cursor = 'pointer';
    });
    instance.on('mouseleave', 'region-fill', () => {
      instance.getCanvas().style.cursor = '';
    });
    instance.on('mousemove', 'region-fill', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const regionName = String(feature.properties?.name ?? 'Unknown region');
      const actorName = String(feature.properties?.actorName ?? 'Unowned');
      container.current?.setAttribute('data-tooltip', `${regionName} · ${actorName}`);
    });
    instance.on('click', 'region-fill', (event) => {
      const feature = event.features?.[0];
      const regionId = feature?.properties?.regionId as RegionId | undefined;
      if (!regionId) return;
      selectRegionRef.current(regionId);
      const actorId = worldRef.current.regions[regionId]?.controllerId;
      if (actorId) selectActorRef.current(actorId);
    });
    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      instance.remove();
      map.current = undefined;
    };
  }, []);

  useEffect(() => {
    const source = map.current?.getSource<GeoJSONSource>('regions');
    source?.setData(collection);
  }, [collection]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    if (showLabels) {
      Object.values(world.regions).forEach((region) => {
        const label = document.createElement('button');
        label.className = 'map-label';
        label.type = 'button';
        label.textContent = region.name;
        label.setAttribute(
          'aria-label',
          `Inspect ${region.name}, controlled by ${
            region.controllerId ? (world.actors[region.controllerId]?.name ?? 'unknown') : 'nobody'
          }`,
        );
        label.addEventListener('click', () => onSelectRegion(region.id));
        markers.current.push(
          new maplibregl.Marker({ element: label, anchor: 'center' })
            .setLngLat(region.labelPosition)
            .addTo(instance),
        );
      });
    }
    if (showCities) {
      Object.values(world.cities).forEach((city) => {
        const markerElement = document.createElement('button');
        markerElement.type = 'button';
        markerElement.className = city.isCapital ? 'city-marker capital' : 'city-marker';
        markerElement.textContent = city.isCapital ? '★' : '•';
        markerElement.title = `${city.name}${city.isCapital ? ' — capital' : ''}`;
        markerElement.setAttribute('aria-label', city.name);
        markerElement.addEventListener('click', () => onSelectRegion(city.regionId));
        markers.current.push(
          new maplibregl.Marker({ element: markerElement, anchor: 'center' })
            .setLngLat(city.coordinates)
            .addTo(instance),
        );
      });
    }
    if (showUnits) {
      Object.values(world.units)
        .filter((unit) => unit.status !== 'destroyed')
        .forEach((unit) => {
          const region = world.regions[unit.regionId];
          if (!region) return;
          const markerElement = document.createElement('button');
          markerElement.type = 'button';
          markerElement.className = 'unit-marker';
          markerElement.textContent =
            unit.kind === 'space' || unit.kind === 'fleet'
              ? '◆'
              : unit.kind === 'air-wing'
                ? '▲'
                : '▰';
          markerElement.title = `${unit.name} · strength ${unit.strength}`;
          markerElement.setAttribute('aria-label', markerElement.title);
          markerElement.addEventListener('click', () => onSelectActor(unit.actorId));
          const index = region.unitIds.indexOf(unit.id);
          markers.current.push(
            new maplibregl.Marker({ element: markerElement, anchor: 'bottom' })
              .setLngLat([region.labelPosition[0] + index * 0.18, region.labelPosition[1] - 0.45])
              .addTo(instance),
          );
        });
    }
  }, [world, showCities, showUnits, showLabels, onSelectActor, onSelectRegion]);

  const resetView = (): void => {
    map.current?.fitBounds(boundsFor(collection), {
      padding: 54,
      duration: reducedMotion ? 0 : 350,
    });
  };

  const fallbackBounds = useMemo(() => {
    const coordinates = collection.features.flatMap((feature) =>
      feature.geometry.type === 'Polygon' ? feature.geometry.coordinates.flat() : [],
    );
    const longitudes = coordinates.map((coordinate) => coordinate[0] ?? 0);
    const latitudes = coordinates.map((coordinate) => coordinate[1] ?? 0);
    return {
      minimumLongitude: Math.min(...longitudes),
      maximumLongitude: Math.max(...longitudes),
      minimumLatitude: Math.min(...latitudes),
      maximumLatitude: Math.max(...latitudes),
    };
  }, [collection]);

  const fallbackPoint = useCallback(
    (coordinate: readonly number[]): [number, number] => {
      const longitudeRange = fallbackBounds.maximumLongitude - fallbackBounds.minimumLongitude || 1;
      const latitudeRange = fallbackBounds.maximumLatitude - fallbackBounds.minimumLatitude || 1;
      return [
        40 + (((coordinate[0] ?? 0) - fallbackBounds.minimumLongitude) / longitudeRange) * 920,
        40 + ((fallbackBounds.maximumLatitude - (coordinate[1] ?? 0)) / latitudeRange) * 520,
      ];
    },
    [fallbackBounds],
  );

  return (
    <section className="map-shell" aria-label="Interactive political map">
      {mapUnavailable ? (
        <div className="map-fallback" role="group" aria-label="Accessible political map fallback">
          <svg viewBox="0 0 1000 600" role="img" aria-label="Political region map">
            {collection.features.map((feature) => {
              if (feature.geometry.type !== 'Polygon') return null;
              const points = feature.geometry.coordinates[0]
                ?.map((coordinate) => fallbackPoint(coordinate).join(','))
                .join(' ');
              const regionId = feature.properties?.regionId as RegionId | undefined;
              if (!regionId) return null;
              return (
                <polygon
                  key={regionId}
                  points={points}
                  fill={String(feature.properties?.color ?? '#5f6670')}
                  className={[
                    feature.properties?.contested ? 'contested' : '',
                    feature.properties?.selected ? 'selected' : '',
                  ].join(' ')}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${feature.properties?.name ?? regionId}`}
                  onClick={() => onSelectRegion(regionId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRegion(regionId);
                    }
                  }}
                />
              );
            })}
          </svg>
          {showLabels &&
            Object.values(world.regions).map((region) => {
              const point = fallbackPoint(region.labelPosition);
              return (
                <button
                  type="button"
                  className="map-label fallback-map-label"
                  style={{ left: `${point[0] / 10}%`, top: `${point[1] / 6}%` }}
                  key={region.id}
                  onClick={() => onSelectRegion(region.id)}
                >
                  {region.name}
                </button>
              );
            })}
          <p className="map-fallback-notice">WebGL is unavailable; using the accessible SVG map.</p>
        </div>
      ) : (
        <div ref={container} className="map-canvas" />
      )}
      <div className="map-tools panel">
        <fieldset>
          <legend>Map layers</legend>
          <label>
            <input
              type="radio"
              name="map-mode"
              checked={layerMode === 'control'}
              onChange={() => setLayerMode('control')}
            />
            Control
          </label>
          <label>
            <input
              type="radio"
              name="map-mode"
              checked={layerMode === 'ownership'}
              onChange={() => setLayerMode('ownership')}
            />
            Legal ownership
          </label>
          <label>
            <input
              type="checkbox"
              checked={showCities}
              onChange={(event) => setShowCities(event.target.checked)}
            />
            Cities
          </label>
          <label>
            <input
              type="checkbox"
              checked={showUnits}
              onChange={(event) => setShowUnits(event.target.checked)}
            />
            Units
          </label>
          <label>
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
            />
            Labels
          </label>
        </fieldset>
        <button type="button" className="button subtle" onClick={resetView}>
          Fit world
        </button>
      </div>
      <div className="map-legend panel" aria-label="Map legend">
        {Object.values(world.actors)
          .filter((actor) => actor.isActive)
          .map((actor, index) => (
            <button key={actor.id} type="button" onClick={() => onSelectActor(actor.id)}>
              <span
                className="legend-swatch"
                style={{
                  background:
                    colorblindMode === 'off'
                      ? actor.color
                      : colorblindPalette[index % colorblindPalette.length],
                }}
              />
              {actor.shortName}
            </button>
          ))}
        <span className="legend-pattern">//// contested / occupied</span>
      </div>
    </section>
  );
}
