import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { geocode, GeocodeResult, LatLon } from "../api";
import { colors } from "../theme";

type Props = {
  placeholder: string;
  value: string;
  near?: LatLon;
  onChangeText: (text: string) => void;
  onSelect: (r: GeocodeResult) => void;
};

export default function SearchField({ placeholder, value, near, onChangeText, onSelect }: Props) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!focused || value.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setResults(await geocode(value.trim(), near));
      } catch {
        setResults([]);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, focused]);

  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        autoCorrect={false}
      />
      {focused && results.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            keyboardShouldPersistTaps="handled"
            data={results}
            keyExtractor={(item, i) => `${item.lat},${item.lon},${i}`}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  onSelect(item);
                  setResults([]);
                  setFocused(false);
                }}
              >
                <Text style={styles.rowText} numberOfLines={1}>
                  {item.name}
                </Text>
                {!!item.city && <Text style={styles.rowCity}>{item.city}</Text>}
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", zIndex: 10 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  dropdown: {
    position: "absolute",
    top: 46,
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    maxHeight: 180,
    zIndex: 20,
    elevation: 4,
  },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { fontSize: 14, color: colors.text },
  rowCity: { fontSize: 12, color: colors.subtext },
});
