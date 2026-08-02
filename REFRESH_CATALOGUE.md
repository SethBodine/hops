# Refreshing the ingredient catalogue

There's no free, reliable, always-current public API for hop/malt/yeast specs (alpha acid %,
colour, PPG, attenuation) that this app can query live — the commercial brewing tools
(BeerSmith, Brewfather, etc.) maintain their catalogues by hand against supplier spec sheets,
and this project does the same. `data.js` (`FERMENTABLES`, `HOPS`, `YEASTS`) is the catalogue;
it's a static list that needs a human (or an LLM prompted like below) to refresh it periodically,
since alpha acid ranges shift crop-to-crop and new varieties/products show up every year.

Recommended cadence: once a quarter, or whenever a brewer reports a variety that isn't in the
list (that's usually the actual trigger — see the feedback thread this file came out of).

## The prompt

Paste this into Claude (or another capable LLM with web search) with `data.js` attached:

> I maintain the ingredient catalogue for an open-source brewing recipe tool. Here's the current
> `data.js` (attached). Please:
>
> 1. Web-search current supplier spec sheets for hop alpha-acid ranges and malt colour/PPG
>    figures, prioritising these regions: [list your priority regions, e.g. New Zealand,
>    Australia, USA, UK, Germany]. Use each variety's typical/mid-range alpha % (not a min-max
>    range - the app stores one number).
> 2. Flag any existing entries whose figures look stale or out of typical range vs. current
>    supplier data, and propose corrected values with a source.
> 3. Propose new entries for any well-established varieties from those regions that are missing,
>    following the existing object shape exactly: `{ name, alpha, origin }` for hops;
>    `{ name, type, ppg, srm, mashable, origin }` for fermentables (colour converted from EBC to
>    SRM as `EBC / 1.97` if the spec sheet quotes EBC - see the comment above the New Zealand
>    entries in the current file for the pattern); `{ name, attenuation, type, origin }` for
>    yeast (attenuation as a 0-1 decimal).
> 4. Don't invent figures — if you can't find a sourced number for something, say so rather than
>    guessing, and leave the existing entry alone.
> 5. Output only the new/changed array entries (not the whole file), ready to paste in, with a
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
