// ---- Core brewing math ----
// References: standard homebrew formulas (Tinseth IBU, Morey SRM, simple/refractometer ABV)

const Calc = {

  // Convert lb -> gravity points contribution for a given batch volume (gal), given PPG and efficiency (0-1)
  gravityPoints(amountLb, ppg, efficiency, mashable) {
    const eff = mashable ? efficiency : 1.0;
    return amountLb * ppg * eff;
  },

  // Original gravity from fermentable list + batch volume (gal)
  estimateOG(fermentables, batchVolGal, efficiencyPct) {
    const eff = efficiencyPct / 100;
    let points = 0;
    for (const f of fermentables) {
      points += this.gravityPoints(f.amountLb, f.ppg, eff, f.mashable);
    }
    const gp = batchVolGal > 0 ? points / batchVolGal : 0;
    return 1 + gp / 1000;
  },

  // Final gravity from OG and yeast attenuation (0-1)
  estimateFG(og, attenuation) {
    const points = (og - 1) * 1000;
    const fgPoints = points * (1 - attenuation);
    return 1 + fgPoints / 1000;
  },

  // ABV (standard formula, reasonably accurate across normal gravity ranges)
  estimateABV(og, fg) {
    return (76.08 * (og - fg) / (1.775 - og)) * (fg / 0.794);
  },

  // Tinseth IBU formula, per-addition breakdown. hops: [{amountOz, alphaPct, timeMin, use}], batchVolGal, og
  // Returns an array parallel to `hops` with the IBU contributed by each addition (0 for non-Boil uses).
  ibuBreakdown(hops, batchVolGal, og) {
    const volLiters = batchVolGal * 3.78541;
    return hops.map(h => {
      if (h.use !== "Boil") return 0; // whirlpool/dry hop contribute negligible/variable IBU, skip for simplicity
      const utilization = this.tinsethUtilization(h.timeMin, og);
      const aauMg = (h.amountOz * 28.3495 * (h.alphaPct / 100) * 1000) / volLiters; // mg/L alpha acids added
      return aauMg * utilization; // Tinseth: mg/L alpha acid x utilization = IBU (ppm)
    });
  },

  // Tinseth IBU formula, total. hops: [{amountOz, alphaPct, timeMin, use}], batchVolGal, og
  estimateIBU(hops, batchVolGal, og) {
    return this.ibuBreakdown(hops, batchVolGal, og).reduce((sum, v) => sum + v, 0);
  },

  tinsethUtilization(timeMin, og) {
    const bignessFactor = 1.65 * Math.pow(0.000125, og - 1);
    const boilTimeFactor = (1 - Math.exp(-0.04 * timeMin)) / 4.15;
    return bignessFactor * boilTimeFactor;
  },

  // Morey SRM formula. fermentables: [{amountLb, srm}], batchVolGal
  estimateSRM(fermentables, batchVolGal) {
    let mcu = 0;
    for (const f of fermentables) {
      mcu += (f.amountLb * f.srm) / batchVolGal;
    }
    return 1.4922 * Math.pow(mcu, 0.6859);
  },

  srmToRgb(srm) {
    // Approximate SRM -> beer color swatch (standard homebrew color chart approximation)
    const stops = [
      [0, [255, 230, 153]], [2, [255, 216, 120]], [4, [250, 189, 84]], [6, [244, 161, 39]],
      [8, [219, 130, 28]], [10, [193, 106, 24]], [13, [158, 77, 18]], [17, [118, 55, 16]],
      [20, [92, 42, 14]], [24, [67, 32, 12]], [30, [45, 21, 10]], [40, [25, 12, 8]],
    ];
    const s = Math.max(0, Math.min(40, srm));
    for (let i = 0; i < stops.length - 1; i++) {
      const [s0, c0] = stops[i], [s1, c1] = stops[i + 1];
      if (s >= s0 && s <= s1) {
        const t = (s - s0) / (s1 - s0);
        const c = c0.map((v, idx) => Math.round(v + t * (c1[idx] - v)));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    }
    return "rgb(25,12,8)";
  },

  totalCost(items) {
    return items.reduce((sum, i) => sum + (Number(i.cost) || 0), 0);
  },

  // ---- Water chemistry ----
  // salts: [{name, grams}], batchGal -> returns {Ca,Mg,Na,SO4,Cl,HCO3} ppm added
  saltAdditions(salts, waterGal) {
    const totals = { Ca: 0, Mg: 0, Na: 0, SO4: 0, Cl: 0, HCO3: 0 };
    for (const s of salts) {
      const profile = WATER_SALTS[s.name];
      if (!profile || !waterGal) continue;
      for (const ion of Object.keys(totals)) {
        const perGalPpm = profile[ion] || 0;
        totals[ion] += (perGalPpm * s.grams) / waterGal;
      }
    }
    return totals;
  },

  addProfiles(base, added) {
    const out = {};
    for (const ion of ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"]) {
      out[ion] = (base[ion] || 0) + (added[ion] || 0);
    }
    return out;
  },

  // Residual alkalinity (Kolbach), inputs in ppm as CaCO3-equivalent math
  residualAlkalinity(profile) {
    const caMeq = profile.Ca / 20.04;
    const mgMeq = profile.Mg / 12.15;
    const hco3Meq = (profile.HCO3 || 0) / 61;
    return (hco3Meq - (caMeq / 3.5 + mgMeq / 7)) * 50;
  },

  sulfateChlorideRatio(profile) {
    if (!profile.Cl) return profile.SO4 > 0 ? Infinity : 0;
    return profile.SO4 / profile.Cl;
  },

  inRange(value, range) {
    if (!range) return null;
    return value >= range[0] && value <= range[1];
  },

  // ---- Batch stats (BeerSmith-parity additions) ----

  // Gravity as it would read pre-boil, given the larger pre-boil volume. Same total
  // gravity points as OG, just measured before boil-off concentrates them.
  estimatePreBoilGravity(fermentables, preBoilVolGal, efficiencyPct) {
    return this.estimateOG(fermentables, preBoilVolGal, efficiencyPct);
  },

  // Total fermentable weight (lb) per US barrel (31 US gallons) of finished beer.
  poundsPerBarrel(totalFermentableLb, batchVolGal) {
    if (!batchVolGal) return 0;
    const barrels = batchVolGal / 31;
    return barrels > 0 ? totalFermentableLb / barrels : 0;
  },

  // Classic strike water temperature formula (Palmer, How to Brew).
  // ratioQtPerLb = mash water (quarts) / grain weight (lb). Temps in Fahrenheit.
  strikeWaterTemp(grainTempF, targetMashTempF, ratioQtPerLb, equipAdjustF) {
    if (!ratioQtPerLb) return targetMashTempF;
    const base = (0.2 / ratioQtPerLb) * (targetMashTempF - grainTempF) + targetMashTempF;
    return base + (equipAdjustF || 0);
  },

  // Total hardness (ppm as CaCO3) from calcium and magnesium.
  effectiveHardness(profile) {
    return 2.497 * (profile.Ca || 0) + 4.118 * (profile.Mg || 0);
  },

  // Raw (total) alkalinity as ppm CaCO3, from bicarbonate alone - distinct from residual alkalinity,
  // which also nets out the buffering effect of calcium/magnesium.
  alkalinityAsCaCO3(profile) {
    return (profile.HCO3 || 0) * (50 / 61);
  },

  // % of total fermentable weight each item represents (BeerSmith's "Grain %" column).
  grainPercent(fermentables) {
    const total = fermentables.reduce((sum, f) => sum + (Number(f.amountLb) || 0), 0);
    if (!total) return fermentables.map(() => 0);
    return fermentables.map(f => ((Number(f.amountLb) || 0) / total) * 100);
  },

  // ---- Sanity checks: flag values that are physically implausible or likely a typo,
  // without being prescriptive about what "correct" looks like. Each returns a short,
  // friendly message rather than a technical one.
  sanityWarnings(d, r) {
    const warnings = [];
    if (d.fg >= d.og) warnings.push("Final gravity isn't lower than original gravity \u2014 that's not physically possible during fermentation. Check your yeast attenuation and OG/FG inputs.");
    if (d.og > 1.14) warnings.push("Original gravity is unusually high (" + d.og.toFixed(3) + "). Double-check your fermentable amounts and batch size.");
    if (d.og < 1.020 && d.og > 1.000) warnings.push("Original gravity is unusually low (" + d.og.toFixed(3) + ") for a beer with fermentables in it \u2014 check your batch size and mash efficiency.");
    if (d.abv < 0) warnings.push("Estimated ABV came out negative \u2014 check OG/FG and attenuation.");
    if (d.abv > 20) warnings.push("Estimated ABV is unusually high (" + d.abv.toFixed(1) + "%). Worth double-checking OG/FG.");
    if (d.ibu > 150) warnings.push("Estimated bitterness (" + Math.round(d.ibu) + " IBU) is far beyond typical beer styles \u2014 check hop amounts, boil times, and batch size.");
    if (d.srm > 80) warnings.push("Estimated colour (" + d.srm.toFixed(0) + " SRM) is beyond typical beer styles \u2014 check fermentable amounts and colour values.");
    if (Number(r.efficiencyPct) <= 0 || Number(r.efficiencyPct) > 100) warnings.push("Mash efficiency of " + r.efficiencyPct + "% is outside the possible 0\u2013100% range.");
    if (Number(r.yeast.attenuation) <= 0 || Number(r.yeast.attenuation) > 1) warnings.push("Yeast attenuation of " + (Number(r.yeast.attenuation) * 100).toFixed(0) + "% is outside the possible 0\u2013100% range.");
    if (Number(r.batchVolGal) <= 0) warnings.push("Batch size is zero or negative.");
    if (d.preBoilVolGal < Number(r.batchVolGal)) warnings.push("Pre-boil volume is smaller than the batch size \u2014 boiling should reduce volume, not the other way around. Check your pre-boil volume or equipment boil-off settings.");
    if (r.mashWaterVolGal <= 0 && r.fermentables.some(f => f.mashable)) warnings.push("Mash water volume is zero, but this recipe has mashable grains \u2014 check your water volumes.");
    ["Ca", "Mg", "Na", "SO4", "Cl", "HCO3"].forEach(ion => {
      if (d.finalWater[ion] < 0) warnings.push(ion + " in the mash water came out negative \u2014 check your base water profile and salt additions.");
      if (d.finalWater[ion] > 500) warnings.push(ion + " in the mash water is unusually high (" + Math.round(d.finalWater[ion]) + " ppm) \u2014 check your salt addition amounts.");
    });
    return warnings;
  },
};
