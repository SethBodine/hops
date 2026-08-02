// Internal canonical units: lb (fermentables), oz (hops), gal (volume), F (temp), g (salts, already metric)
// Display units switch based on state.unitSystem: "us" or "metric"

const Units = {
  lbToKg: v => v * 0.45359237,
  kgToLb: v => v / 0.45359237,
  ozToG: v => v * 28.349523125,
  gToOz: v => v / 28.349523125,
  galToL: v => v * 3.785411784,
  lToGal: v => v / 3.785411784,
  fToC: v => (v - 32) * 5 / 9,
  cToF: v => v * 9 / 5 + 32,
  // SRM/Lovibond and EBC both describe wort/beer colour; EBC is the convention used across
  // most of the world outside North America (NZ, AU, UK, EU brewing sheets are usually EBC).
  // Canonical storage stays in SRM (matches BeerXML's <COLOR> convention); EBC is a display-only
  // conversion, same pattern as every other unit here.
  srmToEbc: v => v * 1.97,
  ebcToSrm: v => v / 1.97,

  // Convert a canonical (US) value to the display value for the current unit system
  toDisplay(canonicalVal, kind, system) {
    const v = Number(canonicalVal) || 0;
    if (kind === "color-srm") return system === "metric" ? this.srmToEbc(v) : v;
    if (system !== "metric") return v;
    if (kind === "weight-lb") return this.lbToKg(v);
    if (kind === "weight-oz") return this.ozToG(v);
    if (kind === "volume-gal") return this.galToL(v);
    if (kind === "temp-f") return this.fToC(v);
    return v;
  },

  // Convert a display value (in the current unit system) back to canonical US units for storage
  toCanonical(displayVal, kind, system) {
    const v = Number(displayVal) || 0;
    if (kind === "color-srm") return system === "metric" ? this.ebcToSrm(v) : v;
    if (system !== "metric") return v;
    if (kind === "weight-lb") return this.kgToLb(v);
    if (kind === "weight-oz") return this.gToOz(v);
    if (kind === "volume-gal") return this.lToGal(v);
    if (kind === "temp-f") return this.cToF(v);
    return v;
  },

  unitLabel(kind, system) {
    if (kind === "color-srm") return system === "metric" ? "EBC" : "SRM";
    if (system !== "metric") {
      return { "weight-lb": "lb", "weight-oz": "oz", "volume-gal": "gal", "temp-f": "\u00b0F" }[kind] || "";
    }
    return { "weight-lb": "kg", "weight-oz": "g", "volume-gal": "L", "temp-f": "\u00b0C" }[kind] || "";
  },

  step(kind, system) {
    if (kind === "temp-f") return 1;
    if (kind === "color-srm") return 0.1;
    if (system === "metric" && kind === "weight-oz") return 1;
    if (kind === "weight-oz") return 0.1;
    return 0.01;
  },
};
