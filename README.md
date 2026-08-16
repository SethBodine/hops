# Hops 🍺

A free, self-contained homebrew recipe builder — a spiritual replacement for BeerSmith that
runs entirely in your browser. No account, no server, no cost, no subscription. Built for
**hops.insecure.co.nz**, deployed on Cloudflare Pages.

Recipes, brew logs, inventory, and equipment profiles all live in your browser
(`localStorage`), with JSON backup/restore, BeerXML import/export, and shareable links so a
recipe can be sent to (and opened straight into the app on) any phone or computer.

## Features

- **Recipe design** — fermentables, hops, yeast, and misc/fining ingredients, with live
  OG/FG/ABV/IBU/colour calculations, per-fermentable **% of grist** and per-hop **IBU
  contribution** (including whirlpool/hop-stand additions, which contribute a real,
  temperature-scaled IBU amount instead of being ignored), and a style-guideline comparison
  against 62 built-in styles, each shown as an explicit min\u2013max range with an optional
  manual/measured override plotted alongside the calculated estimate.
- **Cost & batch stats** — total recipe cost, pre-boil volume/gravity, pounds (or kilograms)
  per barrel. **Update Prices** pulls current costs from your Inventory in one click.
- **Inventory-backed ingredients, browsable via a searchable picker** — clicking a
  Style/Fermentable/Hop/Yeast name opens a searchable, region- or category-grouped picker
  (rather than a plain dropdown) showing each item's key spec and, for inventory-backed
  kinds, its current stock level. The picker is fed directly from your Inventory, not a fixed
  built-in list: add an ingredient in Inventory and it shows up in the picker; type a
  brand-new name and it's added to Inventory automatically. **Save Item** works the same way,
  reading from and writing to that same list.
- **World ingredient catalogue, by region** — hops, malts, and 184 yeast strains across all
  the major labs (Fermentis, Lallemand, White Labs, Wyeast, Omega, Imperial Yeast, Mangrove
  Jack's, Escarpment Labs) from New Zealand, Australia, the USA, UK, Germany, France, Canada,
  Czech Republic, and Slovenia, each tagged with its country of origin. On the Inventory tab,
  **+ Add Region** pulls in every catalogue item
  for a chosen country you don't already have, and **+ Add All Regions** pulls in the whole
  catalogue at once — both skip anything already tracked by name. A region filter (multiple
  regions at once, e.g. NZ + AU) hides the rest from view without removing anything; your
  choice is remembered across sessions and travels with backups. There's no live database
  behind this catalogue — see [REFRESH_CATALOGUE.md](./REFRESH_CATALOGUE.md) for how it gets
  refreshed periodically.
- **Undo Last** — reverts the last structural change (add/delete/substitute/scale/price
  update) to a recipe, mirroring BeerSmith's own "Undo Last".
- **Water chemistry** — base water profile, salt additions tracked separately for **mash vs.
  sparge** water, mash/sparge acid additions, one-click "match a target profile," and mash
  water analysis (residual alkalinity, raw alkalinity, effective hardness,
  sulfate:chloride ratio).
- **Mash & fermentation profiles**, a **strike water temperature** calculator (with an
  optional equipment thermal-mass adjustment), and reusable **carbonation** and
  **fermentation** profiles you can still fine-tune per recipe.
- **Recipe/folder tree** — unlimited nested folders, drag-and-drop to reorganise, right-click
  to clone/rename/delete/move a recipe or folder, folder notes.
- **Batches** — separate from the recipe itself; track Planning → Brewing → Fermenting →
  Completed, log actual OG/FG against estimates, and see every batch's history from the
  recipe's own "Brew History" tab so you can tweak the next version with real data.
- **Inventory** — stock tracking (quantity, unit, cost) for fermentables, hops, yeast, and
  misc items, alongside each ingredient's own spec (alpha %, PPG, colour, attenuation), with
  a one-click "deduct from inventory" when you start brewing a batch.
- **Equipment profiles** — reusable batch size / boil-off rate / trub loss / efficiency /
  thermal-mass defaults, applied to any recipe from its Design tab.
- **Quick calculators** (Tools) — ABV from readings, priming sugar, hydrometer temperature
  correction — for brew-day use without opening a full recipe.
- **Recipe scaling** — rescale a whole recipe (including mash/sparge water) to a new batch
  size in one step.
- **BeerXML import/export** — the standard format BeerSmith itself uses, so existing recipes
  can move in and out cleanly.
- **Shareable links** — a recipe compresses into a URL that opens straight into the app on
  any device. Optionally shortened via b0x.nz. Opening a link with a recipe you already have
  always asks before doing anything — see [SECURITY.md](./SECURITY.md).
- **Metric/Imperial toggle** — metric (kg/g/L/°C/EBC) by default (NZ locale), Imperial
  (lb/oz/gal/°F/SRM) available in one click; colour switches between SRM and EBC along with
  everything else.
- **Full backup export/import** — everything (recipes, folders, batches, inventory with its
  full ingredient specs, equipment) as one JSON file.

See [FORMULAS.md](./FORMULAS.md) for exactly how every number is calculated,
[REFRESH_CATALOGUE.md](./REFRESH_CATALOGUE.md) for how the built-in ingredient catalogue
gets kept current, and [SECURITY.md](./SECURITY.md) for how the app addresses the OWASP Top
10.

## Running it locally

No build step — it's plain HTML/CSS/JS. Just serve the folder:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Deploying to Cloudflare Pages (Wrangler)

**Option A — deploy from your own machine:**

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. From this folder, log in once: `wrangler login`
3. Deploy:
   ```bash
   wrangler pages deploy . --project-name=hops
   ```
4. Point `hops.insecure.co.nz` at the Pages project in the Cloudflare dashboard (**Workers &
   Pages → hops → Custom domains → Add**).

**Option B — auto-deploy on every push to GitHub (recommended):**

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick
   this repo. Leave the build command empty and set the output directory to `/` — there's no
   build step.
2. Add the custom domain the same way as Option A.

That's it for most people — Cloudflare's own Git integration handles the deploy-on-push for
you without any extra config. If you'd rather run the deploy explicitly from a GitHub Actions
workflow instead (e.g. to add a test/lint step first), this is a minimal example:

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name=hops
```

You'd need to create a scoped Cloudflare API token (**Pages: Edit** permission is enough)
and add it plus your Account ID as repo secrets (**Settings → Secrets and variables →
Actions**) for this to work.

## Data & sharing

- Recipes auto-save to `localStorage` as you type.
- **Export Backup** downloads everything as one JSON file.
- **Export BeerXML** / **Export JSON** on a recipe downloads just that recipe.
- **Import** reads a `.json` (single recipe or full backup) or `.xml` (BeerXML) file.
- **Share** (in a recipe's header, or right-click → Share Link) generates a URL containing
  the whole compressed recipe — nothing is uploaded anywhere unless you also choose to
  shorten it via b0x.nz.

## Import adapters

`importers.js` is a small registry mapping file types to parser functions — BeerXML and
Hops' own JSON format are wired in now. To add support for another tool's export format once
you have a sample file (Brewfather, pyBrew, etc.), write a `parse(text)` function that
returns an array of recipe objects and add an entry to `IMPORT_ADAPTERS` — see the comments
at the top of that file.

## Project structure

```
index.html      Page shell, CSP, script loading order
style.css        "Instrument panel" visual theme + responsive/mobile layout
data.js          Ingredient catalogue (region-tagged), style/water-salt/equipment presets
calc.js          All brewing formulas, isolated from the UI (see FORMULAS.md)
units.js         Metric <-> Imperial conversion helpers
security.js      HTML-escaping, safe JSON parsing, prototype-pollution guards
tree.js          Pure functions over the recipe/folder tree structure
beerxml.js       BeerXML 1.0 generate/parse
share.js         URL-based recipe sharing (compression + optional b0x.nz shortening)
importers.js     Import adapter registry
app.js           State, rendering, and all UI wiring
```

## Credits

Built with [Claude](https://claude.ai) (Anthropic).

**Primary reference: [BeerSmith](https://www.beersmith.com)**. The whole project started
from a review of BeerSmith's desktop interface (Design, Water, and ingredient-table
screenshots) and aims for close feature parity with it: equipment profiles, mash/sparge
water agents with per-addition use, mash & sparge acid tracking, style guide comparison,
strike water temperature, pre-boil gravity, pounds per barrel, per-fermentable grist % and
per-hop IBU breakdown, an inventory-backed ingredient library with Substitute/Save Item,
Update Prices from inventory, and Undo Last are all modelled directly on BeerSmith's own
feature set. Hops isn't affiliated with or endorsed by BeerSmith — it's an independent,
free, browser-based alternative inspired by it.

Additional features were reviewed in and adapted from:

- **[Brewfather](https://brewfather.app)** — equipment profiles, batch tracking
  (Planning/Brewing/Fermenting/Completed with actual-vs-estimated readings), inventory
  tracking, and BeerXML interoperability.
- **[pyBrew](https://github.com/tgvoskuilen/pyBrew)** — the recipe/batch split itself: a
  recipe is a reusable template, a batch is one brew day's actual log against it.
- **[biermacht](https://github.com/caseydavenport/biermacht)** — the idea of small
  standalone calculators (ABV, priming sugar, hydrometer correction) for quick brew-day use.

## Licence

MIT — see [LICENSE](./LICENSE). Do whatever you like with it.
