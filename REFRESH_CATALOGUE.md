# Refreshing the ingredient catalogue

There's no free, reliable, always-current public API for hop/malt/yeast specs (alpha acid %,
colour, PPG, attenuation) that this app can query live — the commercial brewing tools
(BeerSmith, Brewfather, etc.) maintain their catalogues by hand against supplier spec sheets,
and this project does the same. `data.js` (`FERMENTABLES`, `HOPS`, `YEASTS`) is the catalogue;
it's a static list that needs a human (or an LLM prompted like below) to refresh it periodically,
since alpha acid ranges shift crop-to-crop and new varieties/products show up every year.

Recommended cadence: once a quarter, or whenever a brewer reports it - or a coverage gap is
found, as happened in August 2026: `FERMENTABLES` and `HOPS` had zero France and Belgium
entries, and `YEASTS` had zero Australia entries, despite all three being in `REGIONS` - they'd
simply never been populated. **Check the coverage table below every time you refresh the
catalogue**, not just when someone happens to notice a gap.

## Coverage checklist

Every `origin` in `REGIONS` should have at least one entry in each of `FERMENTABLES`, `HOPS`,
and `YEASTS` wherever a real commercial product exists for that combination. Run this after
any edit to confirm nothing regressed:

```js
// paste into a browser console on the app, or a node script that loads data.js
["FERMENTABLES", "HOPS", "YEASTS"].forEach(name => {
  const list = { FERMENTABLES, HOPS, YEASTS }[name];
  const byOrigin = {};
  list.forEach(x => { byOrigin[x.origin] = (byOrigin[x.origin] || 0) + 1; });
  console.log(name, REGIONS.filter(r => r !== "Custom" && r !== "Generic").map(r => r + ": " + (byOrigin[r] || 0)).join(", "));
});
```

As of this writing, two region/category cells are intentionally empty rather than missed:
**Slovenia has no `FERMENTABLES` entry** and **Canada has no `HOPS` entry** - neither region
has an internationally-recognised commercial maltster/hop-grower to source a real, sourced
entry from (Slovenia's brewing ingredient exports are hops-only; Canadian hop growing is small
and regional rather than an established export variety). Don't fill these with an invented
entry just to make the table green - leave them empty and note why, per the "don't invent
figures" rule below, until a real sourced product turns up.

## The prompt

Paste this into Claude (or another capable LLM with web search) with `data.js` attached:

> I maintain the ingredient catalogue for an open-source brewing recipe tool. Here's the current
> `data.js` (attached). Please:
>
> 1. Web-search current supplier spec sheets for hop alpha-acid ranges and malt colour/PPG
>    figures, prioritising these regions: New Zealand, Australia, USA, UK, Germany, France,
>    Canada, Czech Republic, Slovenia, Belgium (the full `REGIONS` list in `data.js`, minus
>    "Generic"/"Custom"). Use each variety's typical/mid-range alpha % (not a min-max
>    range - the app stores one number).
> 2. Before proposing anything else, run the coverage check from the "Coverage checklist"
>    section of this file and flag any region with zero entries in `FERMENTABLES`, `HOPS`, or
>    `YEASTS` - then either source a real product to fill it, or confirm (with a one-line
>    reason) that the gap is genuine and shouldn't be filled.
> 3. Flag any existing entries whose figures look stale or out of typical range vs. current
>    supplier data, and propose corrected values with a source.
> 4. Propose new entries for any well-established varieties from those regions that are missing,
>    following the existing object shape exactly: `{ name, alpha, origin }` for hops;
>    `{ name, type, ppg, srm, mashable, origin }` for fermentables (colour converted from EBC to
>    SRM as `EBC / 1.97` if the spec sheet quotes EBC - see the comment above the New Zealand
>    entries in the current file for the pattern); `{ name, attenuation, type, origin }` for
>    yeast (attenuation as a 0-1 decimal).
> 5. Don't invent figures — if you can't find a sourced number for something, say so rather than
>    guessing, and leave the existing entry alone.
> 6. Output only the new/changed array entries (not the whole file), ready to paste in, with a
>    one-line source note per new/changed entry as a trailing comment.
>
> Keep every existing entry that's still accurate exactly as-is — brewers may have recipes and
> inventory referencing those names, and renaming/removing an entry silently breaks their recipe.

## Rules for editing `data.js` by hand

- **Never rename or remove an existing entry** without a fallback. Recipes and inventory items
  reference ingredients by `name` (a plain string) — if a name disappears from the catalogue, any
  recipe or inventory row using it just becomes a "(custom)" one-off with no accompanying spec
  data. If a variety is genuinely discontinued, leave the entry in place; don't delete it.
- **`origin`** is the country used to group/sort the ingredient in the app's pickers (see the
  region selector in the sidebar). Use the country most brewers would associate the product with
  (e.g. `"New Zealand"` for Gladfield malts, `"USA"` for Citra), not necessarily where an
  individual batch was grown.
- **Fermentable colour (`srm`)** is stored as SRM/Lovibond internally regardless of what unit the
  spec sheet quotes. If a spec sheet gives EBC (common outside North America), convert with
  `srm = ebc / 1.97` before adding it.
- If you add a new `origin` value that isn't already in the `REGIONS` list at the bottom of
  `data.js`, add it there too, or it won't get its own group in the ingredient pickers (it'll
  fall into the "Other" group instead — not wrong, just not called out by name).
