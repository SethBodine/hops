// ---- BeerXML 1.0 generate / parse ----
// BeerXML uses metric internally (kg, liters, celsius). Our recipe model is self-contained
// (each ingredient row carries its own ppg/color/alpha/attenuation), so import/export is lossless
// for the fields BeerXML defines.

const BeerXML = {
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },

  yieldFromPPG(ppg) { return Math.max(0, Math.min(100, (ppg / 46) * 100)); },
  ppgFromYield(pct) { return (Number(pct) / 100) * 46; },

  generate(recipe) {
    const r = recipe;
    const ferm = r.fermentables.map(f => `
      <FERMENTABLE>
        <NAME>${this.esc(f.name)}</NAME>
        <VERSION>1</VERSION>
        <TYPE>${this.esc(f.type || "Grain")}</TYPE>
        <AMOUNT>${Units.lbToKg(f.amountLb).toFixed(4)}</AMOUNT>
        <YIELD>${this.yieldFromPPG(f.ppg).toFixed(1)}</YIELD>
        <COLOR>${Number(f.color || 0).toFixed(1)}</COLOR>
      </FERMENTABLE>`).join("");

    const hops = r.hops.map(h => `
      <HOP>
        <NAME>${this.esc(h.name)}</NAME>
        <VERSION>1</VERSION>
        <ALPHA>${Number(h.alphaPct).toFixed(1)}</ALPHA>
        <AMOUNT>${Units.ozToG(h.amountOz) / 1000}</AMOUNT>
        <USE>${this.esc(h.use)}</USE>
        <TIME>${Number(h.timeMin)}</TIME>
        <FORM>Pellet</FORM>
      </HOP>`).join("");

    const misc = r.misc.map(m => `
      <MISC>
        <NAME>${this.esc(m.name)}</NAME>
        <VERSION>1</VERSION>
        <TYPE>Other</TYPE>
        <USE>${this.esc(m.use || "Boil")}</USE>
        <AMOUNT>${Number(m.amount || 0)}</AMOUNT>
        <UNIT>${this.esc(m.unit || "g")}</UNIT>
      </MISC>`).join("");

    const mashSteps = r.mashSteps.map(s => `
        <MASH_STEP>
          <NAME>${this.esc(s.name)}</NAME>
          <VERSION>1</VERSION>
          <TYPE>Infusion</TYPE>
          <STEP_TEMP>${Units.fToC(s.temp).toFixed(1)}</STEP_TEMP>
          <STEP_TIME>${Number(s.time)}</STEP_TIME>
        </MASH_STEP>`).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<RECIPES>
  <RECIPE>
    <NAME>${this.esc(r.name)}</NAME>
    <VERSION>1</VERSION>
    <TYPE>${this.esc(r.type)}</TYPE>
    <BREWER>${this.esc(r.brewer)}</BREWER>
    <BATCH_SIZE>${Units.galToL(r.batchVolGal).toFixed(2)}</BATCH_SIZE>
    <BOIL_SIZE>${Units.galToL(r.batchVolGal).toFixed(2)}</BOIL_SIZE>
    <BOIL_TIME>${Number(r.boilTimeMin)}</BOIL_TIME>
    <EFFICIENCY>${Number(r.efficiencyPct)}</EFFICIENCY>
    <FERMENTABLES>${ferm}
    </FERMENTABLES>
    <HOPS>${hops}
    </HOPS>
    <YEASTS>
      <YEAST>
        <NAME>${this.esc(r.yeast.name)}</NAME>
        <VERSION>1</VERSION>
        <TYPE>${this.esc(r.yeast.type || "Ale")}</TYPE>
        <FORM>Liquid</FORM>
        <ATTENUATION>${(Number(r.yeast.attenuation) * 100).toFixed(1)}</ATTENUATION>
      </YEAST>
    </YEASTS>
    <MISCS>${misc}
    </MISCS>
    <STYLE>
      <NAME>${this.esc(r.styleName)}</NAME>
      <VERSION>1</VERSION>
    </STYLE>
    <MASH>
      <NAME>${this.esc(r.mashProfileName)}</NAME>
      <VERSION>1</VERSION>
      <MASH_STEPS>${mashSteps}
      </MASH_STEPS>
    </MASH>
    <NOTES>${this.esc(r.notes)}</NOTES>
  </RECIPE>
</RECIPES>`;
  },

  text(el, tag, fallback) {
    const node = el.querySelector(tag);
    return node ? node.textContent.trim() : fallback;
  },
  num(el, tag, fallback) {
    const t = this.text(el, tag, null);
    return t === null || t === "" ? fallback : Number(t);
  },

  parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid BeerXML file");
    const recipeEls = Array.from(doc.querySelectorAll("RECIPE"));
    if (!recipeEls.length) throw new Error("No <RECIPE> found in file");

    return recipeEls.map(rec => {
      const batchVolL = this.num(rec, ":scope > BATCH_SIZE", 19);
      const r = {
        id: uid(),
        name: this.text(rec, ":scope > NAME", "Imported Recipe"),
        brewer: this.text(rec, ":scope > BREWER", ""),
        type: this.text(rec, ":scope > TYPE", "All Grain"),
        batchVolGal: Units.lToGal(batchVolL),
        boilTimeMin: this.num(rec, ":scope > BOIL_TIME", 60),
        efficiencyPct: this.num(rec, ":scope > EFFICIENCY", 70),
        styleName: (rec.querySelector("STYLE > NAME") && rec.querySelector("STYLE > NAME").textContent.trim()) || STYLES[0].name,
        fermentables: Array.from(rec.querySelectorAll("FERMENTABLES > FERMENTABLE")).map(f => ({
          name: this.text(f, "NAME", "Imported Fermentable"),
          type: this.text(f, "TYPE", "Grain"),
          amountLb: Units.kgToLb(this.num(f, "AMOUNT", 0)),
          ppg: this.ppgFromYield(this.num(f, "YIELD", 75)),
          color: this.num(f, "COLOR", 2),
          mashable: ["Grain", "Adjunct"].includes(this.text(f, "TYPE", "Grain")),
          cost: 0,
        })),
        hops: Array.from(rec.querySelectorAll("HOPS > HOP")).map(h => ({
          name: this.text(h, "NAME", "Imported Hop"),
          amountOz: Units.gToOz(this.num(h, "AMOUNT", 0) * 1000),
          alphaPct: this.num(h, "ALPHA", 5),
          timeMin: this.num(h, "TIME", 60),
          use: this.text(h, "USE", "Boil"),
          cost: 0,
        })),
        misc: Array.from(rec.querySelectorAll("MISCS > MISC")).map(m => ({
          name: this.text(m, "NAME", "Misc Item"),
          amount: this.num(m, "AMOUNT", 1),
          unit: this.text(m, "UNIT", "g"),
          use: this.text(m, "USE", "Boil"),
          cost: 0,
        })),
        yeast: (() => {
          const y = rec.querySelector("YEASTS > YEAST");
          return y ? {
            name: this.text(y, "NAME", "Imported Yeast"),
            type: this.text(y, "TYPE", "Ale"),
            attenuation: this.num(y, "ATTENUATION", 75) / 100,
            cost: 0,
          } : { name: YEASTS[0].name, attenuation: YEASTS[0].attenuation, cost: 0 };
        })(),
        mashWaterVolGal: Units.lToGal(batchVolL) * 0.65,
        spargeWaterVolGal: Units.lToGal(batchVolL) * 0.45,
        waterBaseName: "Custom",
        waterBase: { Ca: 50, Mg: 5, Na: 10, SO4: 30, Cl: 30, HCO3: 50 },
        waterSalts: [],
        waterTarget: "Balanced Pale Ale",
        mashAcid: { type: ACID_TYPES[0], amountMl: 0 },
        spargeAcid: { type: ACID_TYPES[0], amountMl: 0 },
        mashProfileName: (rec.querySelector("MASH > NAME") && rec.querySelector("MASH > NAME").textContent.trim()) || "Single Infusion, Full Body",
        mashSteps: Array.from(rec.querySelectorAll("MASH_STEPS > MASH_STEP")).map(s => ({
          name: this.text(s, "NAME", "Mash Step"),
          temp: Math.round(Units.cToF(this.num(s, "STEP_TEMP", 67))),
          time: this.num(s, "STEP_TIME", 60),
        })),
        grainTempF: 68,
        adjustTempForEquip: false,
        carbProfileName: "Custom",
        carbLevelVols: 2.4,
        fermentationProfileName: "Custom",
        fermentationProfile: "",
        preBoilVolGal: null,
        notes: this.text(rec, ":scope > NOTES", ""),
      };
      if (!r.mashSteps.length) r.mashSteps = [{ name: "Saccharification", temp: 152, time: 60 }];
      return r;
    });
  },
};
