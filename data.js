// ---- Reference brewing data (public-domain style figures, standard homebrew references) ----

const FERMENTABLES = [
  { name: "Maris Otter (Crisp)", type: "Grain", ppg: 37, srm: 4, mashable: true },
  { name: "Pale 2-Row", type: "Grain", ppg: 37, srm: 2, mashable: true },
  { name: "Pilsner Malt", type: "Grain", ppg: 37, srm: 1.6, mashable: true },
  { name: "Munich Malt", type: "Grain", ppg: 35, srm: 9, mashable: true },
  { name: "Vienna Malt", type: "Grain", ppg: 36, srm: 4, mashable: true },
  { name: "Wheat Malt", type: "Grain", ppg: 38, srm: 2, mashable: true },
  { name: "Honey Malt", type: "Grain", ppg: 34, srm: 25, mashable: true },
  { name: "Caramel/Crystal 10L", type: "Grain", ppg: 35, srm: 10, mashable: true },
  { name: "Caramel/Crystal 40L", type: "Grain", ppg: 34, srm: 40, mashable: true },
  { name: "Caramel/Crystal 60L", type: "Grain", ppg: 34, srm: 60, mashable: true },
  { name: "Caramel/Crystal 120L", type: "Grain", ppg: 33, srm: 120, mashable: true },
  { name: "Biscuit Malt", type: "Grain", ppg: 35, srm: 23, mashable: true },
  { name: "Victory Malt", type: "Grain", ppg: 34, srm: 28, mashable: true },
  { name: "Chocolate Malt", type: "Grain", ppg: 28, srm: 350, mashable: true },
  { name: "Roasted Barley", type: "Grain", ppg: 33, srm: 300, mashable: true },
  { name: "Black Patent Malt", type: "Grain", ppg: 25, srm: 500, mashable: true },
  { name: "Flaked Corn", type: "Grain", ppg: 39, srm: 1, mashable: true },
  { name: "Flaked Oats", type: "Grain", ppg: 33, srm: 2, mashable: true },
  { name: "Flaked Wheat", type: "Grain", ppg: 36, srm: 2, mashable: true },
  { name: "Rice Hulls", type: "Adjunct", ppg: 0, srm: 0, mashable: true },
  { name: "Corn Sugar (Dextrose)", type: "Sugar", ppg: 46, srm: 0, mashable: false },
  { name: "Cane Sugar", type: "Sugar", ppg: 46, srm: 0, mashable: false },
  { name: "Honey", type: "Sugar", ppg: 35, srm: 1, mashable: false },
  { name: "Maple Syrup", type: "Sugar", ppg: 30, srm: 20, mashable: false },
  { name: "Light DME", type: "Extract", ppg: 44, srm: 3, mashable: false },
  { name: "Light LME", type: "Extract", ppg: 36, srm: 3, mashable: false },
  { name: "Amber DME", type: "Extract", ppg: 42, srm: 10, mashable: false },
];

const HOPS = [
  { name: "Northern Brewer", alpha: 8.5 },
  { name: "Cascade", alpha: 6.0 },
  { name: "Centennial", alpha: 10.0 },
  { name: "Citra", alpha: 12.5 },
  { name: "Simcoe", alpha: 13.0 },
  { name: "Mosaic", alpha: 11.5 },
  { name: "Fuggle", alpha: 4.8 },
  { name: "East Kent Goldings", alpha: 5.5 },
  { name: "Willamette", alpha: 5.5 },
  { name: "Saaz", alpha: 3.5 },
  { name: "Hallertau", alpha: 4.0 },
  { name: "Chinook", alpha: 12.0 },
  { name: "Amarillo", alpha: 9.0 },
  { name: "Magnum", alpha: 14.0 },
  { name: "Nugget", alpha: 13.0 },
];

const YEASTS = [
  { name: "English Ale (White Labs #WLP002)", attenuation: 0.67, type: "Ale" },
  { name: "American Ale (Wyeast #1056)", attenuation: 0.75, type: "Ale" },
  { name: "California Ale (WLP001)", attenuation: 0.75, type: "Ale" },
  { name: "London Ale III (WLP013)", attenuation: 0.71, type: "Ale" },
  { name: "Irish Ale (WLP004)", attenuation: 0.71, type: "Ale" },
  { name: "Belgian Saison (WLP565)", attenuation: 0.78, type: "Ale" },
  { name: "German Lager (WLP830)", attenuation: 0.74, type: "Lager" },
  { name: "Kolsch (WLP029)", attenuation: 0.72, type: "Ale" },
  { name: "Hefeweizen (WLP300)", attenuation: 0.75, type: "Ale" },
  { name: "Dry English Ale (S-04)", attenuation: 0.72, type: "Ale Dry" },
  { name: "Safale US-05", attenuation: 0.78, type: "Ale Dry" },
];

// Simplified BJCP-style guideline ranges: [OG lo/hi, FG lo/hi, IBU lo/hi, SRM lo/hi, ABV lo/hi]
const STYLES = [
  { name: "American Light Lager", og: [1.028, 1.040], fg: [0.998, 1.008], ibu: [8, 12], srm: [2, 3], abv: [2.8, 4.2] },
  { name: "American Pale Ale", og: [1.045, 1.060], fg: [1.010, 1.015], ibu: [30, 50], srm: [5, 10], abv: [4.5, 6.2] },
  { name: "American IPA", og: [1.056, 1.070], fg: [1.008, 1.014], ibu: [40, 70], srm: [6, 14], abv: [5.5, 7.5] },
  { name: "English Bitter (Ordinary)", og: [1.030, 1.039], fg: [1.007, 1.011], ibu: [25, 35], srm: [8, 14], abv: [3.2, 3.8] },
  { name: "Strong Bitter (ESB)", og: [1.048, 1.060], fg: [1.010, 1.016], ibu: [30, 50], srm: [8, 18], abv: [4.6, 6.2] },
  { name: "Dry Irish Stout", og: [1.036, 1.044], fg: [1.007, 1.011], ibu: [25, 45], srm: [25, 40], abv: [4.0, 4.5] },
  { name: "Foreign Extra Stout", og: [1.056, 1.075], fg: [1.010, 1.018], ibu: [30, 70], srm: [30, 40], abv: [5.5, 8.0] },
  { name: "Robust Porter", og: [1.048, 1.065], fg: [1.012, 1.016], ibu: [25, 50], srm: [22, 35], abv: [4.8, 6.5] },
  { name: "German Pilsner", og: [1.044, 1.050], fg: [1.008, 1.013], ibu: [22, 40], srm: [2, 5], abv: [4.4, 5.2] },
  { name: "Vienna Lager", og: [1.046, 1.052], fg: [1.010, 1.014], ibu: [18, 30], srm: [9, 15], abv: [4.5, 5.5] },
  { name: "Belgian Saison", og: [1.048, 1.065], fg: [1.002, 1.012], ibu: [20, 35], srm: [5, 14], abv: [5.0, 7.0] },
  { name: "Weissbier (Hefeweizen)", og: [1.044, 1.052], fg: [1.010, 1.014], ibu: [8, 15], srm: [2, 6], abv: [4.3, 5.6] },
  { name: "Imperial Stout", og: [1.075, 1.115], fg: [1.018, 1.030], ibu: [50, 90], srm: [30, 40], abv: [8.0, 12.0] },
  { name: "Barleywine", og: [1.090, 1.120], fg: [1.016, 1.030], ibu: [35, 70], srm: [10, 22], abv: [8.4, 12.2] },
];

// ppm contribution per gram of salt in 1 US gallon of water (standard homebrew water-chemistry constants)
const WATER_SALTS = {
  "Gypsum (Calcium Sulfate)":     { Ca: 61.5, Mg: 0,    Na: 0,    SO4: 147.4, Cl: 0 },
  "Calcium Chloride":             { Ca: 72.0, Mg: 0,    Na: 0,    SO4: 0,     Cl: 127.5 },
  "Epsom Salt (MgSO4)":           { Ca: 0,    Mg: 26.0, Na: 0,    SO4: 103.0, Cl: 0 },
  "Salt (NaCl)":                  { Ca: 0,    Mg: 0,    Na: 104.2,SO4: 0,     Cl: 160.7 },
  "Baking Soda (NaHCO3)":         { Ca: 0,    Mg: 0,    Na: 72.7, SO4: 0,     Cl: 0,    HCO3: 152.7 },
  "Chalk (CaCO3)":                { Ca: 60.6, Mg: 0,    Na: 0,    SO4: 0,     Cl: 0,    HCO3: 92.5 },
};

const WATER_TARGET_PROFILES = {
  "Balanced Pale Ale":  { Ca: 100, Mg: 10, Na: 15, SO4: 100, Cl: 80,  HCO3: 40 },
  "Hoppy IPA":          { Ca: 130, Mg: 10, Na: 15, SO4: 250, Cl: 60,  HCO3: 25 },
  "Malty / English":    { Ca: 90,  Mg: 20, Na: 70, SO4: 70,  Cl: 70,  HCO3: 100 },
  "Dry Stout":          { Ca: 100, Mg: 15, Na: 25, SO4: 55,  Cl: 45,  HCO3: 200 },
  "Delicate Pilsner":   { Ca: 55,  Mg: 8,  Na: 8,  SO4: 10,  Cl: 15,  HCO3: 20 },
  "Reset (RO / Distilled)": { Ca: 0, Mg: 0, Na: 0, SO4: 0, Cl: 0, HCO3: 0 },
};

const EQUIPMENT_PRESETS = [
  { name: "5 Gallon Basic Kettle", batchVolGal: 5, boilTimeMin: 60, boilOffRateGalHr: 1.0, trubLossGal: 0.5, mashEfficiencyPct: 70, tempAdjustF: 2 },
  { name: "10 Gallon BrewEasy System", batchVolGal: 11, boilTimeMin: 75, boilOffRateGalHr: 1.5, trubLossGal: 0.75, mashEfficiencyPct: 64, tempAdjustF: 3 },
  { name: "BIAB 5 Gallon", batchVolGal: 5.5, boilTimeMin: 60, boilOffRateGalHr: 1.2, trubLossGal: 0.25, mashEfficiencyPct: 72, tempAdjustF: 1 },
];

const CARBONATION_PROFILES = {
  "British Cask Ale": 1.5,
  "European Lager": 2.6,
  "American Ale": 2.4,
  "Belgian Ale": 2.8,
  "German Wheat Beer": 3.3,
  "Highly Carbonated": 3.4,
};

const FERMENTATION_PROFILES = {
  "Standard Ale": "Primary at 18-20\u00b0C for 10-14 days, then condition 2 weeks.",
  "British Ale": "Primary at 18-19\u00b0C for 5-7 days, then condition.",
  "Lager": "Primary at 10-12\u00b0C for 2-3 weeks, diacetyl rest at 16\u00b0C for 2 days, then lager at 1-4\u00b0C for 4-8 weeks.",
  "Belgian Warm Ferment": "Primary at 22-26\u00b0C for 10-14 days, allow temperature to free-rise late in fermentation.",
  "Hefeweizen": "Primary at 18-20\u00b0C for 7-10 days; keep temperature steady early on for classic ester/phenol balance.",
};

const ACID_TYPES = ["Lactic Acid (88%)", "Phosphoric Acid (10%)", "Citric Acid", "Acid Malt (Sauermalz)"];

const MASH_PROFILES = {
  "Single Infusion, Full Body": [{ name: "Saccharification", temp: 154, time: 60 }],
  "Single Infusion, Light Body": [{ name: "Saccharification", temp: 149, time: 60 }],
  "Single Infusion, Full Body Batch Sparge": [{ name: "Saccharification", temp: 156, time: 60 }],
  "BIAB, Full Body": [{ name: "Saccharification", temp: 154, time: 60 }],
  "Two-Step, Well Modified": [{ name: "Protein Rest", temp: 122, time: 15 }, { name: "Saccharification", temp: 152, time: 45 }],
};
