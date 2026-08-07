# Formulas Used in Hops

Every calculation the app makes is listed here, in plain language, next to the code that
implements it. If a number looks wrong on a real brew day, this is the place to check first
— compare the maths below against `calc.js` (the formulas are deliberately kept in one small
file, separate from the UI code, for exactly this reason).

All internal storage is in US units (pounds, ounces, US gallons, °F) regardless of which
units the interface displays — this keeps one canonical formula set instead of two. Display
conversion happens only in `units.js`, at the point of showing a number to the person.

---

## Original Gravity (OG)

```
gravity points (per fermentable) = amount (lb) × PPG × mash efficiency (mashable only)
OG = 1 + (sum of gravity points ÷ batch volume in gallons) ÷ 1000
```

- **PPG** ("points per pound per gallon") is how much gravity one pound of that fermentable
  contributes to one gallon of wort at 100% efficiency. It's stored per-ingredient in your
  **Inventory** (Fermentables) — seeded from the built-in catalogue in `data.js`, but editable
  or fully custom per ingredient, since that's what feeds every recipe's fermentable dropdown.
- **Mash efficiency** only applies to mashable ingredients (grains/adjuncts). Sugars and
  extracts are assumed 100% efficient — they don't need to be extracted from a mash.
- Source: standard homebrew gravity-point arithmetic used by BeerSmith, Brewfather, and
  every major brewing text (e.g. Palmer, *How to Brew*).

## Final Gravity (FG)

```
FG = 1 + ((OG - 1) × 1000 × (1 - yeast attenuation)) ÷ 1000
```

Yeast attenuation (stored as a decimal, e.g. 0.75 for 75%) is how much of the available
sugar the yeast strain typically converts to alcohol/CO₂. Stored per-recipe on the yeast
object so custom/imported strains work without a lookup table.

**Target Final Gravity (solving backwards)**: FG isn't pulled from a style automatically —
typing a value into the recipe's Target Final Gravity field (or clicking Match Style, which
fills in the midpoint of the selected style's FG range) runs the FG formula above in
reverse, solving for the attenuation that would produce that FG at the recipe's current OG:

```
attenuation = 1 - ((target FG - 1) × 1000) ÷ ((OG - 1) × 1000)
```

The recipe's yeast Attenuation field is then set to that value (clamped to 0–100%; a target
outside what's physically reachable from the current OG is capped at the nearer bound, with
a note explaining why, rather than silently producing a nonsense attenuation).

## Alcohol by Volume (ABV)

```
ABV% = (76.08 × (OG - FG) / (1.775 - OG)) × (FG / 0.794)
```

Standard homebrew ABV formula. Reasonably accurate across normal beer gravity ranges
(roughly 1.030–1.130 OG); it's the same formula used by most homebrew ABV calculators.

## Bitterness (IBU) — Tinseth method, with a whirlpool/hop-stand adjustment

```
utilisation = bignessFactor × boilTimeFactor
bignessFactor = 1.65 × 0.000125^(OG - 1)
boilTimeFactor = (1 - e^(-0.04 × boil/stand time in minutes)) / 4.15
alpha acid concentration (mg/L) = (hop weight in grams × alpha acid % ÷ 100 × 1000) ÷ wort volume in litres
IBU (Boil addition) = alpha acid concentration × utilisation
IBU (Whirlpool addition) = alpha acid concentration × utilisation × whirlpoolUtilizationFactor(stand temp)
IBU (Dry Hop addition) = 0
```

**Boil** additions use the standard Tinseth curve unmodified. **Dry hop** additions get no
heat at all, so isomerization doesn't happen — they're the one use that stays at 0 IBU.
**Whirlpool/hop-stand** additions are calculated the same way (using the stand time as the
"boil time" input above), then scaled down by a temperature factor, since isomerization
continues — just more slowly — below boiling as the wort cools:

```
whirlpoolUtilizationFactor(stand temp in °F):
  tempC = (tempF - 32) × 5/9
  if tempC ≥ 100: factor = 1
  if tempC < 50:  factor = 0
  else: factor = e^(-9756.6 × (1/(tempC+273.15) - 1/373.15))
```

This is an Arrhenius-style exponential falloff, fitted against published whirlpool
utilisation figures (Grainfather Brewing, citing Hieronymus/Raspuzzi/Hosom): 90°C → 49%,
80°C → 23%, 70°C → 10%, 60°C → 4.3%, 50°C → 1.75% of full-boil utilisation. Below ~50°C the
contribution is negligible on homebrew timescales, so it's floored at 0. Each hop addition
has its own **Stand Temp** field (default 194°F/90°C, a typical flameout/whirlpool
temperature) — since that temperature is the single biggest factor in how much IBU a
whirlpool addition actually contributes, it's worth setting to what your system actually
does rather than leaving it at the default.

⚠️ **This is the one formula that had a real bug during development**: the concentration
term needs wort volume in **litres**, not gallons. Using gallons directly overstated IBU by
roughly 3.8×. Verified fix against a known reference case (1 oz of 6% AA hops, 60 minutes,
5 US gallon batch, ~1.052 OG → should be ~20 IBU; confirmed 20.4 IBU after the fix).

## Colour (SRM) — Morey equation

```
MCU (per fermentable) = (amount in lb × colour in °L) ÷ batch volume in gallons
SRM = 1.4922 × (total MCU)^0.6859
```

The Morey equation is the standard non-linear colour formula used because colour
contribution isn't linear with grain colour at the high end (a 500°L grain doesn't make
beer 10× darker than a 50°L grain in the same quantity). °Lovibond and SRM are treated as
numerically equivalent here, matching how BeerXML's `<COLOR>` field is commonly interpreted
by other tools — a reasonable approximation at typical homebrew colour ranges.

**Display units — SRM vs EBC**: internal/canonical storage is always SRM, matching the
formula above and BeerXML's convention. When the interface is set to metric units, colour
is *displayed* (and entered) in EBC instead, converted with:

```
EBC = SRM × 1.97
SRM = EBC ÷ 1.97
```

a standard fixed-ratio approximation. This conversion is purely for display/input — the
Morey equation itself always runs in SRM.

## Water Chemistry

Each salt has a known ppm contribution per gram added to one US gallon of water (see
`data.js` → `WATER_SALTS`). Adding a salt to *n* gallons of water:

```
ppm contributed = (ppm-per-gram-per-gallon × grams added) ÷ actual volume in gallons
```

These per-gram constants are the standard values used across homebrew water calculators
(Bru'n Water, Brewer's Friend, EZ Water Calculator, etc.) — e.g. gypsum contributes ~61.5
ppm calcium and ~147.4 ppm sulfate per gram per gallon.

**Residual Alkalinity** (Kolbach approximation):

```
RA (ppm as CaCO3) = (HCO3 meq/L − (Ca meq/L ÷ 3.5 + Mg meq/L ÷ 7)) × 50
```

where meq/L for each ion = ppm ÷ its equivalent weight (Ca: 20.04, Mg: 12.15, HCO3: 61).

**Sulfate:Chloride ratio** = SO4 (ppm) ÷ Cl (ppm) — used only as a rough flavour-balance
indicator (< 0.6 malty, 0.6–1.5 balanced, > 1.5 hoppy/crisp), not a scientifically precise
threshold; different brewers draw these lines slightly differently.

## Priming Sugar (bottle carbonation)

```
residual CO2 (volumes, at temp T in °F) = 3.0378 − 0.050062×T + 0.00026555×T²
sugar needed (grams, corn sugar/dextrose) = 4 × batch volume in litres × (target volumes − residual volumes)
```

The residual-CO2-at-temperature formula is a widely used cubic approximation (originally
from Charlie Bamforth / brewing-science literature, popularised by Kaiser Schwarz's
priming calculator). The 4 g/L-per-volume-of-CO₂ constant is specific to corn sugar
(dextrose); table sugar (sucrose) needs slightly less due to its different fermentability
— not currently offered as a separate option.

## Hydrometer Temperature Correction

```
correctionFactor(T) = 1.00130346 − 0.000134722124×T + 0.00000204052596×T² − 0.0000000023282098×T³
corrected SG = measured SG × (correctionFactor(sample temp) ÷ correctionFactor(calibration temp))
```

Standard cubic polynomial correction for hydrometers calibrated at a reference temperature
(usually 60°F or 68°F) but read at a different sample temperature.

## Recipe Scaling

```
ratio = new batch volume ÷ old batch volume
```

Every fermentable amount, hop amount, misc amount, and the mash/sparge water volumes are
multiplied by this ratio. Percentages (efficiency, attenuation, alpha acid, hop boil times)
are left unchanged, since scaling volume doesn't change process percentages or hop chemistry
timing.

## Pre-Boil Gravity

```
Pre-Boil Gravity = same gravity-point formula as OG, evaluated at the pre-boil volume instead of the batch volume
```

Uses the identical gravity-points calculation as OG (see above) - the total sugar extracted
from the grain bill doesn't change between pre-boil and post-boil, only the volume it's
dissolved in does, so a bigger pre-boil volume reads a lower gravity that then concentrates
up to OG as the boil reduces it.

Pre-boil volume, if not manually overridden, is estimated as:

```
pre-boil volume = batch volume + equipment trub/chiller loss + (boil-off rate × boil time ÷ 60)
```

using the linked Equipment Profile's boil-off rate and trub loss. Without an equipment
profile linked, a simple 1 gal/hr boil-off assumption is used as a fallback so the field
still shows a sensible placeholder.

## Pounds (or Kilograms) per Barrel

```
barrels = batch volume (US gal) ÷ 31
lb per barrel = total fermentable weight (lb) ÷ barrels
```

A standard commercial-brewing yield metric (1 US barrel = 31 US gallons), included for
comparison against commercial recipe formulation figures.

## Strike Water Temperature

```
ratio (qt/lb) = mash water volume (quarts) ÷ mashable grain weight (lb)
strike temp = (0.2 ÷ ratio) × (target mash temp − grain temp) + target mash temp
strike temp (adjusted) = strike temp + equipment thermal-mass adjustment (if "Adjust Temp for Equipment" is ticked)
```

The classic strike-water-temperature formula (Palmer, *How to Brew*) — it accounts for how
much a given water-to-grain ratio will cool (or need to overshoot) to land the mash at the
target temperature, given the grain's starting temperature. The optional equipment
adjustment (a fixed °F offset stored per Equipment Profile, default 2°F) is a simple
approximation of how much extra heat a given mash tun's thermal mass absorbs — real
absorption varies with tun material/insulation, so treat this as a starting estimate to
tune against your own system's actual results, exactly as BeerSmith's own "Adjust Temp for
Equipment" option does.

## Water Hardness & Alkalinity

**Effective (total) hardness**, ppm as CaCO3:

```
hardness = 2.497 × Ca (ppm) + 4.118 × Mg (ppm)
```

**Alkalinity** (raw, from bicarbonate alone — distinct from Residual Alkalinity above, which
also nets out calcium/magnesium's buffering effect):

```
alkalinity = HCO3 (ppm) × 50 / 61
```

Both are standard ppm-as-CaCO3-equivalent conversions using the equivalent weights of
calcium (20.04), magnesium (12.15), and bicarbonate (61), calculated from the **mash water**
profile specifically (mash and sparge water are tracked separately — see below).

## Mash vs. Sparge Water

Salt additions are tracked per-addition as "Mash" or "Sparge" use, and diluted into their
respective water volumes independently. All of the mash-chemistry stats above (Residual
Alkalinity, Alkalinity, Effective Hardness, Sulfate:Chloride) are calculated from the mash
water's adjusted profile only, since that's what actually affects mash pH — sparge water
chemistry mostly just affects the final beer's mineral perception, not the mash itself, so
it isn't run through the same "is this in a healthy range" analysis.

Mash and sparge acid additions (e.g. lactic or phosphoric acid to lower mash/sparge pH) are
tracked for record-keeping but are **not** currently factored into the Residual Alkalinity
estimate — accurately predicting the pH effect of an acid addition needs a grain-acidity
buffering model (malt colour, base malt vs. specialty malt proportions, etc.) that's out of
scope for this calculator. Treat the RA number as your starting point, then adjust acid
additions by taste/pH-meter reading as you always would.

## % of Grist and Per-Hop IBU

Two small "how much did each ingredient contribute" breakdowns, both straightforward:

```
% of grist (per fermentable) = that fermentable's weight ÷ total fermentable weight × 100
IBU (per hop addition) = that addition's individual Tinseth contribution (see Bitterness above) — the total IBU is the sum across all additions (Boil, Whirlpool, and Dry Hop, the last of which is always 0)
```

---

## Known simplifications (documented, not hidden)

- IBU: whirlpool/hop-stand additions are modelled (see Bitterness above), but via a fitted
  temperature-falloff curve driven by a single per-addition Stand Temp value, not an actual
  cooling-curve simulation of your kettle. Dry hop additions still contribute 0 IBU (no
  heat, no isomerization) — that part is standard, not a simplification.
- Colour: °Lovibond and SRM are treated as equal, and EBC is a fixed-ratio (×1.97) display
  conversion of SRM, not an independently-modelled colour space. Both are common
  simplifications, most accurate for pale/crystal malts and least accurate for very dark
  roasted grains.
- Water: only 6 ions are tracked (Ca, Mg, Na, SO4, Cl, HCO3) and only 6 common salts are
  modelled. pH is not calculated — residual alkalinity is used as a proxy, as is standard
  in most free/open homebrew water calculators.
- Priming sugar: corn sugar (dextrose) only. If you prime with table sugar or DME, use
  roughly 10% more sugar by weight for table sugar, or about 25% more for DME.
- Strike water temperature: the "Adjust Temp for Equipment" offset is a fixed °F value per
  Equipment Profile (default 2°F), not a physics-based thermal mass calculation - tune it
  against what actually works for your system after a brew or two.
- Mash/sparge acid additions are recorded but don't feed back into the Residual Alkalinity
  number (see "Mash vs. Sparge Water" above) - they're for your own reference/repeatability.
