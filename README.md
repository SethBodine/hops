# Hops 🍺

A free, self-contained homebrew recipe builder — a spiritual replacement for BeerSmith that
runs entirely in your browser. No account, no server, no cost, no subscription. Built for
**hops.insecure.co.nz**, deployed on Cloudflare Pages.

Recipes, brew logs, inventory, and equipment profiles all live in your browser
(`localStorage`), with JSON backup/restore, BeerXML import/export, and shareable links so a
recipe can be sent to (and opened straight into the app on) any phone or computer.

## Features

- **Recipe design** — fermentables, hops, yeast, and misc/fining ingredients, with live
  OG/FG/ABV/IBU/colour calculations and a style-guideline comparison against ~14 built-in
  styles.
- **Water chemistry** — base water profile, salt additions (gypsum, calcium chloride, Epsom
  salt, table salt, baking soda, chalk), one-click "match a target profile," residual
  alkalinity and sulfate:chloride analysis.
- **Mash & fermentation profiles**, **carbonation targets**.
- **Recipe/folder tree** — unlimited nested folders, drag-and-drop to reorganise, right-click
  to clone/rename/delete/move a recipe or folder, folder notes.
- **Batches** — separate from the recipe itself; track Planning → Brewing → Fermenting →
  Completed, log actual OG/FG against estimates, and see every batch's history from the
  recipe's own "Brew History" tab so you can tweak the next version with real data.
- **Inventory** — simple stock tracking for fermentables, hops, yeast, and misc items, with
  a one-click "deduct from inventory" when you start brewing a batch.
- **Equipment profiles** — reusable batch size / boil-off rate / trub loss / efficiency
  defaults, applied to any recipe from its Design tab.
- **Quick calculators** (Tools) — ABV from readings, priming sugar, hydrometer temperature
  correction — for brew-day use without opening a full recipe.
- **Recipe scaling** — rescale a whole recipe to a new batch size in one step.
- **BeerXML import/export** — the standard format BeerSmith itself uses, so existing recipes
  can move in and out cleanly.
- **Shareable links** — a recipe compresses into a URL that opens straight into the app on
  any device. Optionally shortened via b0x.nz. Opening a link with a recipe you already have
  always asks before doing anything — see [SECURITY.md](./SECURITY.md).
- **Metric/Imperial toggle** — metric (kg/g/L/°C) by default (NZ locale), Imperial available
  in one click.
- **Full backup export/import** — everything (recipes, folders, batches, inventory,
  equipment) as one JSON file.

See [FORMULAS.md](./FORMULAS.md) for exactly how every number is calculated, and
[SECURITY.md](./SECURITY.md) for how the app addresses the OWASP Top 10.

## Running it locally

No build step — it's plain HTML/CSS/JS. Just serve the folder:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Deploying to Cloudflare Pages (Wrangler)

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. From this folder, log in once: `wrangler login`
3. Deploy:
   ```bash
   wrangler pages deploy . --project-name=hops
   ```
4. Point `hops.insecure.co.nz` at the Pages project in the Cloudflare dashboard (**Workers &
   Pages → hops → Custom domains → Add**).

Or connect the GitHub repo directly in the Cloudflare dashboard
(**Workers & Pages → Create → Pages → Connect to Git**) for auto-deploy on every push — since
there's no build step, leave the build command empty and set the output directory to `/`.

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
data.js          Ingredient/style/water-salt/equipment-preset reference data
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

Built with [Claude](https://claude.ai) (Anthropic), based on a review of feature sets from:

- **[Brewfather](https://brewfather.app)** — equipment profiles, batch tracking
  (Planning/Brewing/Fermenting/Completed with actual-vs-estimated readings), inventory
  tracking, and BeerXML interoperability.
- **[pyBrew](https://github.com/tgvoskuilen/pyBrew)** — the recipe/batch split itself: a
  recipe is a reusable template, a batch is one brew day's actual log against it.
- **[biermacht](https://github.com/caseydavenport/biermacht)** — the idea of small
  standalone calculators (ABV, priming sugar, hydrometer correction) for quick brew-day use.

Originally modelled on the look and feature set of BeerSmith's classic desktop interface.

## Licence

MIT — see [LICENSE](./LICENSE). Do whatever you like with it.
