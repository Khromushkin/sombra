export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export type LatLon = { lat: number; lon: number };
export type Mode = "walk" | "bike";

export type RouteSegment = { coords: [number, number][]; shaded: boolean };

export type Route = {
  kind: "shady" | "fastest";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distance_m: number;
  duration_min: number;
  shade_pct: number;
  segments: RouteSegment[];
};

export type RouteResponse = {
  routes: Route[];
  sun: { elevation_deg: number; azimuth_deg: number; is_low_sun: boolean };
  computed_for: string;
};

export type GeocodeResult = {
  name: string;
  lat: number;
  lon: number;
  city?: string | null;
  in_spain: boolean;
};

export async function fetchRoute(params: {
  origin: LatLon;
  destination: LatLon;
  mode: Mode;
  departAt?: Date | null;
  shadePreference: number;
}): Promise<RouteResponse> {
  const body: Record<string, unknown> = {
    origin: params.origin,
    destination: params.destination,
    mode: params.mode,
    shade_preference: params.shadePreference,
  };
  if (params.departAt) body.depart_at = params.departAt.toISOString();
  const resp = await fetch(`${API_URL}/api/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.detail) detail = String(j.detail);
    } catch {}
    const err = new Error(detail) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function geocode(q: string, near?: LatLon): Promise<GeocodeResult[]> {
  const p = new URLSearchParams({ q });
  if (near) {
    p.set("lat", String(near.lat));
    p.set("lon", String(near.lon));
  }
  const resp = await fetch(`${API_URL}/api/geocode?${p.toString()}`);
  if (!resp.ok) return [];
  const j = await resp.json();
  return j.results ?? [];
}
