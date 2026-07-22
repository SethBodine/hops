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
  contributes to one gallon of wort at 100% efficiency. It's stored per-ingredient (see
  `data.js` → `FERMENTABLES`, or entered directly for a custom ingredient).
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

## Alcohol by Volume (ABV)

```
ABV% = (76.08 × (OG - FG) / (1.775 - OG)) × (FG / 0.794)
```

Standard homebrew ABV formula. Reasonably accurate across normal beer gravity ranges
(roughly 1.030–1.130 OG); it's the same formula used by most homebrew ABV calculators.

## Bitterness (IBU) — Tinseth method

```
utilisation = bignessFactor × boilTimeFactor
bignessFactor = 1.65 × 0.000125^(OG - 1)
boilTimeFactor = (1 - e^(-0.04 × boil time in minutes)) / 4.15
alpha acid concentration (mg/L) = (hop weight in grams × alpha acid % ÷ 100 × 1000) ÷ wort volume in litres
IBU (per addition) = alpha acid concentration × utilisation
```

Only additions marked **Boil** are counted — whirlpool and dry-hop additions contribute
variable, hard-to-model IBU and are conventionally excluded from Tinseth-style estimates.

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

Every fermentable amount, hop amount, misc amount, and the water volume are multiplied by
this ratio. Percentages (efficiency, attenuation, alpha acid, hop boil times) are left
unchanged, since scaling volume doesn't change process percentages or hop chemistry timing.

---

## Known simplifications (documented, not hidden)

- IBU: only **Boil** additions count toward the IBU total. Whirlpool/hopstand and dry-hop
  contributions are real but require assumptions (whirlpool temperature/duration curves)
  that vary a lot between brewers and aren't modelled.
- Colour: °Lovibond and SRM are treated as equal. This is a common simplification, most
  accurate for pale/crystal malts and least accurate for very dark roasted grains.
- Water: only 6 ions are tracked (Ca, Mg, Na, SO4, Cl, HCO3) and only 6 common salts are
  modelled. pH is not calculated — residual alkalinity is used as a proxy, as is standard
  in most free/open homebrew water calculators.
- Priming sugar: corn sugar (dextrose) only. If you prime with table sugar or DME, use
  roughly 10% more sugar by weight for table sugar, or about 25% more for DME.
