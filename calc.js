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

  // Tinseth IBU formula, per-addition breakdown. hops: [{amountOz, alphaPct, timeMin, use, whirlpoolTempF}], batchVolGal, og
  // Returns an array parallel to `hops` with the IBU contributed by each addition.
  // Boil additions use the standard Tinseth curve. Whirlpool/hop-stand additions still isomerize
  // alpha acids (just more slowly, since they're below boiling), so they're calculated the same
  // way and then scaled down by a temperature factor - see whirlpoolUtilizationFactor(). Dry hop
  // additions get no heat at all, so they're the one use that stays at 0 IBU.
  ibuBreakdown(hops, batchVolGal, og) {
    const volLiters = batchVolGal * 3.78541;
    return hops.map(h => {
      if (h.use === "Dry Hop") return 0; // no heat, no isomerization, no meaningful IBU contribution
      const utilization = this.tinsethUtilization(h.timeMin, og);
      const aauMg = (h.amountOz * 28.3495 * (h.alphaPct / 100) * 1000) / volLiters; // mg/L alpha acids added
      let ibu = aauMg * utilization; // Tinseth: mg/L alpha acid x utilization = IBU (ppm)
      if (h.use === "Whirlpool") {
        const tempF = h.whirlpoolTempF != null ? h.whirlpoolTempF : 194; // default ~90C, a typical flameout/whirlpool temp
        ibu *= this.whirlpoolUtilizationFactor(tempF);
      }
      return ibu;
    });
  },

  // Below boiling, alpha-acid isomerization slows dramatically but doesn't stop - hops added
  // at flameout/whirlpool still contribute real (if reduced) bitterness as the wort cools.
  // This models that as an Arrhenius-style temperature falloff, fitted against published
  // whirlpool utilisation figures (Grainfather Brewing, citing Hieronymus/Raspuzzi/Hosom):
  //   90C -> 49%, 80C -> 23%, 70C -> 10%, 60C -> 4.3%, 50C -> 1.75% (relative to a full boil)
  // Below ~50C isomerization is negligible for homebrew timescales, so it's floored at 0.
  whirlpoolUtilizationFactor(tempF) {
    const tempC = (tempF - 32) * 5 / 9;
    if (tempC >= 100) return 1;
    if (tempC < 50) return 0;
    const tK = tempC + 273.15;
    const boilK = 373.15;
    return Math.exp(-9756.6 * (1 / tK - 1 / boilK));
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

  // ---- Batch-day measured stats (fills in BeerSmith's Session-tab parity for the Batches tab) ----

  // Total possible gravity points from a grain bill, at 100% theoretical extraction
  // (mashable fermentables only - steeping grains contribute nothing extra beyond their PPG,
  // that's already baked into a lower PPG figure for those, same convention as estimateOG).
  maxPossiblePoints(fermentables) {
    return fermentables.reduce((sum, f) => sum + (Number(f.amountLb) || 0) * (Number(f.ppg) || 0), 0);
  },

  // Efficiency (%) actually achieved, given a measured gravity reading at a known volume -
  // this is the inverse of estimateOG/estimatePreBoilGravity: given the points you actually
  // collected (gravity x volume), what fraction of the grain bill's theoretical maximum is that?
  // Used for both "measured mash efficiency" (pre-boil gravity/volume) and "measured brewhouse
  // efficiency" (into-fermenter gravity/volume) - same formula, different inputs.
  measuredEfficiency(fermentables, measuredGravity, measuredVolGal) {
    const maxPoints = this.maxPossiblePoints(fermentables);
    if (!maxPoints || !measuredVolGal) return null;
    const points = (measuredGravity - 1) * 1000 * measuredVolGal;
    return (points / maxPoints) * 100;
  },

  // Apparent attenuation (%) from a gravity pair - same formula whether it's the recipe's
  // estimated OG/FG or a batch's measured readings.
  attenuationPct(og, fg) {
    const ogPoints = (og - 1) * 1000;
    if (!ogPoints) return null;
    const fgPoints = (fg - 1) * 1000;
    return ((ogPoints - fgPoints) / ogPoints) * 100;
  },

  // Calories per 12oz serving, from OG/FG (the standard homebrew formula - real-extract based,
  // as used across most brewing calculators/software).
  estimateCalories(og, fg) {
    const alcCal = 1881.22 * fg * (og - fg) / (1.775 - og);
    const carbCal = 3550.0 * fg * ((0.1808 * og) + (0.8192 * fg) - 1.0004);
    return Math.max(0, alcCal + carbCal);
  },

  // Corn sugar (dextrose) needed, in grams, for bottle priming to a target CO2 volumes at a
  // given beer temperature (residual CO2 already in solution is netted out first). Same formula
  // used by the standalone Priming Sugar tool, factored out here so batch-level carbonation can
  // share it.
  primingSugarGrams(volGal, tempF, targetVols) {
    const residual = 3.0378 - 0.050062 * tempF + 0.00026555 * tempF * tempF;
    const diff = Math.max(0, targetVols - residual);
    return 4 * this.galToLHelper(volGal) * diff;
  },
  galToLHelper(volGal) { return volGal * 3.785411784; },

  // Keg pressure (PSI) needed to reach a target CO2 volumes at a given beer temperature -
  // a widely-published quadratic regression fit to Henry's-law CO2 solubility data (the same
  // general-purpose formula used across most brewing calculators, not tool-specific).
  kegCarbPSI(tempF, targetVols) {
    const T = tempF, V = targetVols;
    return -16.6999 - 0.0101059 * T + 0.00116512 * T * T + 0.173354 * T * V + 4.24267 * V - 0.0684226 * V * V;
  },

  // ---- Recipe readiness checklist ("Run Checks" - BeerSmith 4's on-demand check button) ----
  // Distinct from sanityWarnings: that flags physically-impossible values automatically and is
  // always visible in a banner. This is a broader, on-demand "is this recipe actually ready to
  // brew" pass - missing ingredients, incomplete hop schedules, style-range misses, etc. Each
  // item is { severity: "error"|"warning"|"info", message }.
  recipeChecks(d, r, style) {
    const checks = [];
    const add = (severity, message) => checks.push({ severity, message });

    if (!r.fermentables.length) add("error", "No fermentables in this recipe.");
    if (!r.hops.length) add("warning", "No hops added \u2014 this will be a completely unbittered, unflavoured beer unless that's intentional.");
    if (!r.yeast.name) add("error", "No yeast strain selected.");
    if (!r.styleName) add("info", "No style selected \u2014 the style-guideline comparison won't be shown.");

    const hasBoilHop = r.hops.some(h => h.use === "Boil" && Number(h.timeMin) > 0);
    const hasAnyBittering = r.hops.some(h => (h.use === "Boil" || h.use === "Whirlpool") && Number(h.amountOz) > 0);
    if (r.hops.length && !hasBoilHop && !hasAnyBittering) add("warning", "No boil or whirlpool hop addition found \u2014 bitterness will be at or near zero.");

    const mashableGrain = r.fermentables.some(f => f.mashable !== false);
    if (mashableGrain && (!r.mashSteps || !r.mashSteps.length)) add("warning", "This recipe has mashable grain but no mash steps defined.");

    const dryHops = r.hops.filter(h => h.use === "Dry Hop");
    const dryHopsMissingSchedule = dryHops.filter(h => h.dryHopDay == null || h.dryHopDurationDays == null);
    if (dryHopsMissingSchedule.length) add("warning", dryHopsMissingSchedule.length + " dry hop addition" + (dryHopsMissingSchedule.length > 1 ? "s don't" : " doesn't") + " have a start day and/or duration set.");

    const whirlpoolMissingTemp = r.hops.filter(h => h.use === "Whirlpool" && h.whirlpoolTempF == null);
    if (whirlpoolMissingTemp.length) add("info", whirlpoolMissingTemp.length + " whirlpool addition" + (whirlpoolMissingTemp.length > 1 ? "s are" : " is") + " using the default 194\u00b0F stand temperature \u2014 confirm this matches your process.");

    if (Number(r.batchVolGal) > 0) {
      const totalCost = this.totalCost([...r.fermentables, ...r.hops, r.yeast, ...r.misc]);
      if (totalCost === 0) add("info", "No ingredient costs entered \u2014 cost tracking will show $0.");
    }

    const equip = r.equipmentId;
    if (!equip) add("info", "No equipment profile linked \u2014 boil-off, trub loss, and equipment thermal-mass adjustments won't be applied.");

    if (style && d) {
      const rows = [
        ["Original Gravity", d.og, style.og],
        ["Final Gravity", d.fg, style.fg],
        ["ABV", d.abv, style.abv],
        ["IBU", d.ibu, style.ibu],
        ["Colour", d.srm, style.srm],
      ];
      const outOfRange = rows.filter(([, val, range]) => this.inRange(val, range) === false);
      if (outOfRange.length) add("info", outOfRange.length + " of 5 style metrics (" + outOfRange.map(o => o[0]).join(", ") + ") fall outside " + style.name + "'s guideline range.");
    }

    // Fold in the existing physical-implausibility checks too, so "Run Checks" is a genuine
    // one-stop report rather than missing what the always-on banner already catches.
    this.sanityWarnings(d, r).forEach(w => add("error", w));

    return checks;
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
