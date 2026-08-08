import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Route } from "../api";
import { t } from "../i18n";
import { colors } from "../theme";

type Props = { shady: Route; fastest: Route; isLowSun: boolean };

export default function StatsCard({ shady, fastest, isLowSun }: Props) {
  const km = (shady.distance_m / 1000).toFixed(1);
  const extraMin = Math.max(0, Math.round(shady.duration_min - fastest.duration_min));

  if (isLowSun) {
    return (
      <View style={styles.card}>
        <Text style={styles.lowSun}>{t("lowSun")}</Text>
        <Text style={styles.sub}>
          {Math.round(shady.duration_min)} {t("min")} · {km} km
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.headline}>
        {Math.round(shady.duration_min)} {t("min")} · {km} km ·{" "}
        <Text style={styles.shadePct}>🌳 {Math.round(shady.shade_pct)}% {t("inShade")}</Text>
      </Text>
      <View style={styles.chip}>
        <Text style={styles.chipText}>
          +{extraMin} {t("min")} {t("vsFastest")} ({t("fastestHas")} {Math.round(fastest.shade_pct)}%)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  headline: { fontSize: 16, fontWeight: "600", color: colors.text },
  shadePct: { color: colors.shade },
  sub: { fontSize: 14, color: colors.subtext },
  lowSun: { fontSize: 15, fontWeight: "500", color: colors.text },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: colors.chipBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12.5, color: colors.primary },
});
