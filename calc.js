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

  // Tinseth IBU formula. hops: [{amountOz, alphaPct, timeMin, use}], batchVolGal, og
  estimateIBU(hops, batchVolGal, og) {
    let totalIBU = 0;
    for (const h of hops) {
      if (h.use !== "Boil") continue; // whirlpool/dry hop contribute negligible/variable IBU, skip for simplicity
      const utilization = this.tinsethUtilization(h.timeMin, og);
      const volLiters = batchVolGal * 3.78541;
      const aauMg = (h.amountOz * 28.3495 * (h.alphaPct / 100) * 1000) / volLiters; // mg/L alpha acids added
      totalIBU += aauMg * utilization; // Tinseth: mg/L alpha acid x utilization = IBU (ppm)
    }
    return totalIBU;
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
};
