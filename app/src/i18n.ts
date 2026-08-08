import { NativeModules, Platform } from "react-native";

type Dict = { [k: string]: string };

const es: Dict = {
  appName: "Sombra",
  origin: "Origen",
  destination: "Destino",
  originPlaceholder: "¿Desde dónde?",
  destinationPlaceholder: "¿A dónde vas?",
  myLocation: "Mi ubicación",
  walk: "A pie",
  bike: "En bici",
  faster: "Más rápido",
  shadier: "Más sombra",
  departure: "Salida",
  now: "Ahora",
  inShade: "a la sombra",
  vsFastest: "vs la ruta más rápida",
  fastestHas: "la más rápida tiene",
  lowSun: "☁️ El sol está bajo — todo el camino va a la sombra",
  findRoute: "Buscar ruta a la sombra",
  searching: "Calculando sombras…",
  errorGeneric: "Algo salió mal. Inténtalo de nuevo.",
  errorRetry: "El mapa está ocupado, prueba en unos segundos.",
  longPressHint: "Mantén pulsado el mapa para fijar el destino",
  min: "min",
};

const en: Dict = {
  appName: "Sombra",
  origin: "Origin",
  destination: "Destination",
  originPlaceholder: "From where?",
  destinationPlaceholder: "Where to?",
  myLocation: "My location",
  walk: "Walk",
  bike: "Bike",
  faster: "Faster",
  shadier: "More shade",
  departure: "Departure",
  now: "Now",
  inShade: "in the shade",
  vsFastest: "vs the fastest route",
  fastestHas: "fastest has",
  lowSun: "☁️ The sun is low — the whole way is in shade",
  findRoute: "Find a shady route",
  searching: "Computing shadows…",
  errorGeneric: "Something went wrong. Please try again.",
  errorRetry: "Map data is busy, try again in a few seconds.",
  longPressHint: "Long-press the map to set the destination",
  min: "min",
};

function deviceLang(): string {
  try {
    const locale =
      Platform.OS === "ios"
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier;
    return (locale || "es").toLowerCase();
  } catch {
    return "es";
  }
}

const dict = deviceLang().startsWith("en") ? en : es;

export function t(key: keyof typeof es): string {
  return dict[key] ?? es[key] ?? String(key);
}
