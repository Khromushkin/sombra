import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { LatLng, Marker, Polyline, Region } from "react-native-maps";
import { fetchRoute, GeocodeResult, LatLon, Mode, RouteResponse } from "./src/api";
import Controls, { DEPART_CHOICES } from "./src/components/Controls";
import SearchField from "./src/components/SearchField";
import StatsCard from "./src/components/StatsCard";
import { t } from "./src/i18n";
import { colors } from "./src/theme";

const VALENCIA: Region = {
  latitude: 39.4699,
  longitude: -0.3763,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

function toLatLng(coords: [number, number][]): LatLng[] {
  return coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}

export default function App() {
  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState("");
  const [mode, setMode] = useState<Mode>("walk");
  const [shade, setShade] = useState(0.5);
  const [departIndex, setDepartIndex] = useState(0);
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departAt = useCallback((): Date | null => {
    const c = DEPART_CHOICES[departIndex];
    if (c.hoursFromNow === 0) return null; // "now" -> let the server use its clock
    const d = new Date();
    if (c.hoursFromNow != null) {
      d.setTime(d.getTime() + c.hoursFromNow * 3600_000);
    } else if (c.fixedHour != null) {
      d.setHours(c.fixedHour, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    }
    return d;
  }, [departIndex]);

  const useMyLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setOrigin(p);
      setOriginText(t("myLocation"));
      mapRef.current?.animateToRegion(
        { latitude: p.lat, longitude: p.lon, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        400
      );
    } catch {
      // location unavailable -- user can type or long-press instead
    }
  }, []);

  const requestRoute = useCallback(async () => {
    if (!origin || !destination) return;
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchRoute({
        origin,
        destination,
        mode,
        departAt: departAt(),
        shadePreference: shade,
      });
      setResult(resp);
      const shady = resp.routes.find((r) => r.kind === "shady");
      if (shady && mapRef.current) {
        mapRef.current.fitToCoordinates(toLatLng(shady.geometry.coordinates), {
          edgePadding: { top: 80, bottom: 340, left: 40, right: 40 },
          animated: true,
        });
      }
    } catch (e: any) {
      setResult(null);
      setError(e?.status === 503 ? t("errorRetry") : e?.message || t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [origin, destination, mode, shade, departAt]);

  // Re-route automatically when settings change and we already have both points
  useEffect(() => {
    if (origin && destination) requestRoute();
  }, [mode, shade, departIndex]);

  const shady = result?.routes.find((r) => r.kind === "shady");
  const fastest = result?.routes.find((r) => r.kind === "fastest");

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={VALENCIA}
        showsUserLocation
        onLongPress={(e) => {
          const c = e.nativeEvent.coordinate;
          setDestination({ lat: c.latitude, lon: c.longitude });
          setDestText(`${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`);
        }}
      >
        {fastest && (
          <Polyline
            coordinates={toLatLng(fastest.geometry.coordinates)}
            strokeColor={colors.ghost}
            strokeWidth={3}
            lineDashPattern={[6, 6]}
          />
        )}
        {shady?.segments.map((seg, i) => (
          <Polyline
            key={i}
            coordinates={toLatLng(seg.coords)}
            strokeColor={seg.shaded ? colors.shade : colors.sun}
            strokeWidth={5}
            lineCap="round"
          />
        ))}
        {origin && <Marker coordinate={{ latitude: origin.lat, longitude: origin.lon }} pinColor="green" />}
        {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lon }} />}
      </MapView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.panelWrap}
        pointerEvents="box-none"
      >
        <View style={styles.panel}>
          <Text style={styles.title}>🌳 {t("appName")}</Text>
          <SearchField
            placeholder={t("originPlaceholder")}
            value={originText}
            near={origin ?? { lat: VALENCIA.latitude, lon: VALENCIA.longitude }}
            onChangeText={(x) => setOriginText(x)}
            onSelect={(r: GeocodeResult) => {
              setOrigin({ lat: r.lat, lon: r.lon });
              setOriginText(r.name);
            }}
          />
          <View style={styles.rowBetween}>
            <TouchableOpacity onPress={useMyLocation}>
              <Text style={styles.link}>📍 {t("myLocation")}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>{t("longPressHint")}</Text>
          </View>
          <SearchField
            placeholder={t("destinationPlaceholder")}
            value={destText}
            near={origin ?? { lat: VALENCIA.latitude, lon: VALENCIA.longitude }}
            onChangeText={(x) => setDestText(x)}
            onSelect={(r: GeocodeResult) => {
              setDestination({ lat: r.lat, lon: r.lon });
              setDestText(r.name);
            }}
          />
          <Controls
            mode={mode}
            onMode={setMode}
            shade={shade}
            onShade={setShade}
            departIndex={departIndex}
            onDepart={setDepartIndex}
          />
          <TouchableOpacity
            style={[styles.cta, (!origin || !destination || loading) && styles.ctaDisabled]}
            disabled={!origin || !destination || loading}
            onPress={requestRoute}
          >
            {loading ? (
              <View style={styles.ctaLoading}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.ctaText}> {t("searching")}</Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>{t("findRoute")}</Text>
            )}
          </TouchableOpacity>
          {error && <Text style={styles.error}>{error}</Text>}
          {shady && fastest && (
            <StatsCard shady={shady} fastest={fastest} isLowSun={!!result?.sun.is_low_sun} />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  panelWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  panel: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 14,
    paddingBottom: 26,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.primary, fontSize: 13.5 },
  hint: { color: colors.subtext, fontSize: 11.5 },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.45 },
  ctaLoading: { flexDirection: "row", alignItems: "center" },
  ctaText: { color: "#fff", fontSize: 15.5, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});
