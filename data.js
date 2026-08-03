// ---- Reference brewing data (public-domain style figures, standard homebrew references) ----

// `origin` is the country the ingredient is most associated with/produced in. It's used to group
// and prioritise the ingredient pickers by region (see buildIngredientSelect in app.js) so a
// brewer isn't stuck substituting for malts/hops that aren't sold anywhere near them.
const FERMENTABLES = [
  // United States
  { name: "Pale 2-Row", type: "Grain", ppg: 37, srm: 2, mashable: true, origin: "USA" },
  { name: "Victory Malt", type: "Grain", ppg: 34, srm: 28, mashable: true, origin: "USA" },
  { name: "Honey Malt", type: "Grain", ppg: 34, srm: 25, mashable: true, origin: "USA" },
  // United Kingdom
  { name: "Maris Otter (Crisp)", type: "Grain", ppg: 37, srm: 4, mashable: true, origin: "UK" },
  { name: "Golden Promise (Simpsons)", type: "Grain", ppg: 37, srm: 3, mashable: true, origin: "UK" },
  { name: "Biscuit Malt", type: "Grain", ppg: 35, srm: 23, mashable: true, origin: "UK" },
  { name: "Black Patent Malt", type: "Grain", ppg: 25, srm: 500, mashable: true, origin: "UK" },
  { name: "Roasted Barley", type: "Grain", ppg: 33, srm: 300, mashable: true, origin: "UK" },
  // Germany
  { name: "Pilsner Malt (Weyermann)", type: "Grain", ppg: 37, srm: 1.6, mashable: true, origin: "Germany" },
  { name: "Munich Malt", type: "Grain", ppg: 35, srm: 9, mashable: true, origin: "Germany" },
  { name: "Vienna Malt", type: "Grain", ppg: 36, srm: 4, mashable: true, origin: "Germany" },
  { name: "Wheat Malt", type: "Grain", ppg: 38, srm: 2, mashable: true, origin: "Germany" },
  { name: "Chocolate Malt (Weyermann Carafa II)", type: "Grain", ppg: 28, srm: 350, mashable: true, origin: "Germany" },
  // New Zealand (Gladfield) - colours quoted in EBC on the spec sheet, converted here to SRM
  // (EBC / 1.97) to match this file's SRM convention; the app displays EBC back out again
  // automatically when the interface is set to metric units.
  { name: "Gladfield Ale Malt", type: "Grain", ppg: 37, srm: 3.0, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Pilsner Malt", type: "Grain", ppg: 37, srm: 1.9, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Gladiator Malt", type: "Grain", ppg: 36, srm: 4.2, mashable: true, origin: "New Zealand" },
  { name: "Gladfield American Ale Malt", type: "Grain", ppg: 37, srm: 3.6, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Munich Malt", type: "Grain", ppg: 35, srm: 9.1, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Wheat Malt", type: "Grain", ppg: 38, srm: 2.0, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Manuka Smoked Malt", type: "Grain", ppg: 36, srm: 4.6, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Light Crystal Malt", type: "Grain", ppg: 34, srm: 15.2, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Medium Crystal Malt", type: "Grain", ppg: 34, srm: 30.5, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Dark Crystal Malt", type: "Grain", ppg: 33, srm: 55.8, mashable: true, origin: "New Zealand" },
  { name: "Gladfield Biscuit Malt", type: "Grain", ppg: 35, srm: 20.3, mashable: true, origin: "New Zealand" },
  // Australia
  { name: "Joe White Traditional Ale Malt", type: "Grain", ppg: 37, srm: 3, mashable: true, origin: "Australia" },
  { name: "Joe White Pilsner Malt", type: "Grain", ppg: 37, srm: 1.7, mashable: true, origin: "Australia" },
  { name: "Bairds Wheat Malt", type: "Grain", ppg: 38, srm: 2, mashable: true, origin: "Australia" },
  // Caramel/crystal (generic, sold under this name almost everywhere)
  { name: "Caramel/Crystal 10L", type: "Grain", ppg: 35, srm: 10, mashable: true, origin: "Generic" },
  { name: "Caramel/Crystal 40L", type: "Grain", ppg: 34, srm: 40, mashable: true, origin: "Generic" },
  { name: "Caramel/Crystal 60L", type: "Grain", ppg: 34, srm: 60, mashable: true, origin: "Generic" },
  { name: "Caramel/Crystal 120L", type: "Grain", ppg: 33, srm: 120, mashable: true, origin: "Generic" },
  { name: "Chocolate Malt", type: "Grain", ppg: 28, srm: 350, mashable: true, origin: "Generic" },
  { name: "Flaked Corn", type: "Grain", ppg: 39, srm: 1, mashable: true, origin: "Generic" },
  { name: "Flaked Oats", type: "Grain", ppg: 33, srm: 2, mashable: true, origin: "Generic" },
  { name: "Flaked Wheat", type: "Grain", ppg: 36, srm: 2, mashable: true, origin: "Generic" },
  { name: "Rice Hulls", type: "Adjunct", ppg: 0, srm: 0, mashable: true, origin: "Generic" },
  { name: "Corn Sugar (Dextrose)", type: "Sugar", ppg: 46, srm: 0, mashable: false, origin: "Generic" },
  { name: "Cane Sugar", type: "Sugar", ppg: 46, srm: 0, mashable: false, origin: "Generic" },
  { name: "Honey", type: "Sugar", ppg: 35, srm: 1, mashable: false, origin: "Generic" },
  { name: "Maple Syrup", type: "Sugar", ppg: 30, srm: 20, mashable: false, origin: "Generic" },
  { name: "Light DME", type: "Extract", ppg: 44, srm: 3, mashable: false, origin: "Generic" },
  { name: "Light LME", type: "Extract", ppg: 36, srm: 3, mashable: false, origin: "Generic" },
  { name: "Amber DME", type: "Extract", ppg: 42, srm: 10, mashable: false, origin: "Generic" },
];

const HOPS = [
  // United States
  { name: "Cascade", alpha: 6.0, origin: "USA" },
  { name: "Centennial", alpha: 10.0, origin: "USA" },
  { name: "Citra", alpha: 12.5, origin: "USA" },
  { name: "Simcoe", alpha: 13.0, origin: "USA" },
  { name: "Mosaic", alpha: 11.5, origin: "USA" },
  { name: "Chinook", alpha: 12.0, origin: "USA" },
  { name: "Amarillo", alpha: 9.0, origin: "USA" },
  { name: "Magnum", alpha: 14.0, origin: "USA" },
  { name: "Nugget", alpha: 13.0, origin: "USA" },
  { name: "Willamette", alpha: 5.5, origin: "USA" },
  { name: "Northern Brewer", alpha: 8.5, origin: "USA" },
  // United Kingdom
  { name: "Fuggle", alpha: 4.8, origin: "UK" },
  { name: "East Kent Goldings", alpha: 5.5, origin: "UK" },
  { name: "Challenger", alpha: 7.5, origin: "UK" },
  { name: "First Gold", alpha: 8.0, origin: "UK" },
  { name: "Bramling Cross", alpha: 6.0, origin: "UK" },
  // Germany
  { name: "Hallertau Mittelfr\u00fch", alpha: 4.0, origin: "Germany" },
  { name: "Tettnanger", alpha: 4.5, origin: "Germany" },
  { name: "Perle", alpha: 7.5, origin: "Germany" },
  { name: "Spalt", alpha: 4.5, origin: "Germany" },
  { name: "Hersbrucker", alpha: 3.5, origin: "Germany" },
  // Czech Republic
  { name: "Saaz", alpha: 3.5, origin: "Czech Republic" },
  // Slovenia
  { name: "Styrian Goldings (Celeia)", alpha: 4.5, origin: "Slovenia" },
  // New Zealand
  { name: "Nelson Sauvin", alpha: 12.0, origin: "New Zealand" },
  { name: "Motueka", alpha: 7.0, origin: "New Zealand" },
  { name: "Riwaka", alpha: 6.5, origin: "New Zealand" },
  { name: "Wai-iti", alpha: 3.0, origin: "New Zealand" },
  { name: "Rakau", alpha: 11.0, origin: "New Zealand" },
  { name: "Waimea", alpha: 17.0, origin: "New Zealand" },
  { name: "Green Bullet", alpha: 13.0, origin: "New Zealand" },
  { name: "Pacifica", alpha: 5.5, origin: "New Zealand" },
  { name: "Southern Cross", alpha: 13.0, origin: "New Zealand" },
  { name: "Dr Rudi", alpha: 11.0, origin: "New Zealand" },
  // Australia
  { name: "Galaxy", alpha: 14.0, origin: "Australia" },
  { name: "Vic Secret", alpha: 16.0, origin: "Australia" },
  { name: "Ella", alpha: 15.0, origin: "Australia" },
  { name: "Topaz", alpha: 16.5, origin: "Australia" },
  { name: "Enigma", alpha: 17.5, origin: "Australia" },
  { name: "Summer", alpha: 5.5, origin: "Australia" },
];

const YEASTS = [
  { name: "English Ale (White Labs #WLP002)", attenuation: 0.67, type: "Ale", origin: "UK" },
  { name: "London Ale III (WLP013)", attenuation: 0.71, type: "Ale", origin: "UK" },
  { name: "Irish Ale (WLP004)", attenuation: 0.71, type: "Ale", origin: "UK" },
  { name: "Dry English Ale (S-04)", attenuation: 0.72, type: "Ale Dry", origin: "UK" },
  { name: "American Ale (Wyeast #1056)", attenuation: 0.75, type: "Ale", origin: "USA" },
  { name: "California Ale (WLP001)", attenuation: 0.75, type: "Ale", origin: "USA" },
  { name: "Safale US-05", attenuation: 0.78, type: "Ale Dry", origin: "USA" },
  { name: "Belgian Saison (WLP565)", attenuation: 0.78, type: "Ale", origin: "Belgium" },
  { name: "German Lager (WLP830)", attenuation: 0.74, type: "Lager", origin: "Germany" },
  { name: "Kolsch (WLP029)", attenuation: 0.72, type: "Ale", origin: "Germany" },
  { name: "Hefeweizen (WLP300)", attenuation: 0.75, type: "Ale", origin: "Germany" },
  { name: "Nottingham Ale (Lallemand)", attenuation: 0.75, type: "Ale Dry", origin: "New Zealand" },
  { name: "Mangrove Jack's M42 New World Strong Ale", attenuation: 0.75, type: "Ale Dry", origin: "New Zealand" },
];

// All the recognised origin/region values above, in a sensible display order (used to build
// grouped <optgroup> ingredient pickers - see buildIngredientSelect in app.js).
// "Custom" isn't a real country - it's the bucket for ingredients you've typed in yourself
// (via + Add Item, or a brand-new name in a recipe dropdown) that don't match anything in the
// built-in catalogue, so they don't have a real origin. It must stay in this list and in the
// default inventory filter, or custom ingredients silently disappear whenever a region filter
// is active.
const REGIONS = ["New Zealand", "Australia", "USA", "UK", "Germany", "Czech Republic", "Slovenia", "Belgium", "Generic", "Custom"];

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
