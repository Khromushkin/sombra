// Sombra PWA configuration
window.SOMBRA = window.SOMBRA || {};
SOMBRA.config = {
  OVERPASS_URLS: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ],
  PHOTON_URL: "https://photon.komoot.io/api",
  // Spanish Cadastre INSPIRE Buildings WFS (BuildingPart carries floor counts)
  CATASTRO_WFS: "https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx",
  BASEMAP_STYLE: "https://tiles.openfreemap.org/styles/liberty",

  DEFAULT_CENTER: [-0.3763, 39.4699], // Valencia
  DEFAULT_ZOOM: 13.5,

  MAX_WALK_KM: 6,
  MAX_BIKE_KM: 15,
  WALK_KMH: 4.7,
  BIKE_KMH: 15,

  MIN_BUFFER_M: 350,
  BUFFER_FRACTION: 0.25,

  LOW_SUN_DEG: 3,
  MAX_SHADOW_LEN_M: 150,
  DEFAULT_BUILDING_H: 9,
  METERS_PER_LEVEL: 3.2,
  TREE_H: 8,
  TREE_R: 4,

  SAMPLE_STEP_M: 4, // edge shade sampling step
  GRID_CELL_M: 60, // spatial bucket size for shadow polygons
  MAX_SHADE_WEIGHT: 3.0,
  SHADED_THRESHOLD: 0.5,

  HIGHWAY_WALK: new Set(["residential","living_street","pedestrian","footway","path","steps",
    "service","unclassified","tertiary","tertiary_link","secondary","secondary_link",
    "primary","primary_link","cycleway","track","bridleway","corridor"]),
  HIGHWAY_BIKE: new Set(["residential","living_street","pedestrian","service","unclassified",
    "tertiary","tertiary_link","secondary","secondary_link","primary","primary_link",
    "cycleway","track","path"]),

  COLORS: { shade: "#1d4ed8", sun: "#f97316", ghost: "#9ca3af", shadow: "#312e81" },
};
