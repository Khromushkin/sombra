import Slider from "@react-native-community/slider";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Mode } from "../api";
import { t } from "../i18n";
import { colors } from "../theme";

export type DepartChoice = { label: string; hoursFromNow: number | null; fixedHour?: number };

export const DEPART_CHOICES: DepartChoice[] = [
  { label: t("now"), hoursFromNow: 0 },
  { label: "+1 h", hoursFromNow: 1 },
  { label: "+2 h", hoursFromNow: 2 },
  { label: "18:00", hoursFromNow: null, fixedHour: 18 },
];

type Props = {
  mode: Mode;
  onMode: (m: Mode) => void;
  shade: number;
  onShade: (v: number) => void;
  departIndex: number;
  onDepart: (i: number) => void;
};

export default function Controls({ mode, onMode, shade, onShade, departIndex, onDepart }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.modeGroup}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "walk" && styles.modeActive]}
            onPress={() => onMode("walk")}
          >
            <Text style={[styles.modeText, mode === "walk" && styles.modeTextActive]}>🚶 {t("walk")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "bike" && styles.modeActive]}
            onPress={() => onMode("bike")}
          >
            <Text style={[styles.modeText, mode === "bike" && styles.modeTextActive]}>🚴 {t("bike")}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.departGroup}>
          {DEPART_CHOICES.map((c, i) => (
            <TouchableOpacity
              key={c.label}
              style={[styles.chip, departIndex === i && styles.chipActive]}
              onPress={() => onDepart(i)}
            >
              <Text style={[styles.chipText, departIndex === i && styles.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>{t("faster")}</Text>
        <Slider
          style={{ flex: 1, marginHorizontal: 8 }}
          minimumValue={0}
          maximumValue={1}
          step={0.1}
          value={shade}
          onSlidingComplete={onShade}
          minimumTrackTintColor={colors.shade}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.shade}
        />
        <Text style={styles.sliderLabel}>{t("shadier")} 🌳</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 },
  modeGroup: { flexDirection: "row", backgroundColor: colors.card, borderRadius: 10, padding: 3 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  modeActive: { backgroundColor: colors.bg, elevation: 2 },
  modeText: { fontSize: 13.5, color: colors.subtext },
  modeTextActive: { color: colors.text, fontWeight: "600" },
  departGroup: { flexDirection: "row", gap: 5 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.chipBg, borderColor: colors.shade },
  chipText: { fontSize: 12.5, color: colors.subtext },
  chipTextActive: { color: colors.shade, fontWeight: "600" },
  sliderRow: { flexDirection: "row", alignItems: "center" },
  sliderLabel: { fontSize: 12, color: colors.subtext },
});
