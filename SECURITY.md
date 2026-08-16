# Security Notes

Hops is a fully static, client-only site (HTML/CSS/JS served from Cloudflare Pages) with no
backend of its own — all recipe data lives in the browser (`localStorage`) or is passed
through the URL. That shrinks the attack surface a lot compared to a typical web app, but
"static site" doesn't mean "nothing to think about." This doc maps the app's design against
the [OWASP Top 10 (2021)](https://owasp.org/Top10/) and calls out the one external service
call it makes.

| # | Risk | How Hops addresses it |
|---|---|---|
| A01 | Broken Access Control | No accounts, no server-side authorisation to break — every recipe belongs to whoever's browser it's stored in. Nothing to bypass. |
| A02 | Cryptographic Failures | No secrets are stored or transmitted by the app itself. If you use the optional shh.insecure.co.nz integration for full-backup transfer, encryption happens **client-side via the Web Crypto API (AES-256-GCM)** before anything leaves the browser — the plaintext backup never crosses the network. |
| A03 | Injection | The main real risk for a client-rendered app: XSS via `innerHTML`. **Every** value that could originate from outside the app's own code (recipe names, notes, ingredient names, imported JSON/BeerXML, URL share payloads) is passed through `Security.escapeHtml()` before being interpolated into a template string. There is no use of `eval()`, `Function()`, `document.write()`, or unsanitised `innerHTML` assignment of raw user input anywhere in the codebase — this was specifically verified with an automated test that injects an `<img onerror=...>` payload as a recipe name and confirms it renders as inert text, not executable markup. |
| A04 | Insecure Design | Sharing is intentionally one-directional and explicit: opening a shared link never silently overwrites your data — it always shows a confirmation dialog with "Add as New" / "Update Existing" (only offered when an ID actually matches) / "Dismiss". Deletions (recipes, folders, batches) always require a native `confirm()` before proceeding. |
| A05 | Security Misconfiguration | A strict `Content-Security-Policy`, delivered as a **real HTTP response header** via Cloudflare Pages' `_headers` file, restricts script execution to same-origin only (`script-src 'self'`), disallows framing (`frame-ancestors 'none'`), disallows form submission to other origins, and only permits network connections (`connect-src`) to the app's own origin plus the two explicitly-approved, keyless partner APIs (b0x.nz, shh.insecure.co.nz). `_headers` also sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, and `Cross-Origin-Opener-Policy`. A matching `<meta http-equiv="Content-Security-Policy">` tag in `index.html` is kept as a fallback, but it is **not** what enforces `frame-ancestors` - per the CSP spec, `frame-ancestors` (and `sandbox`/`report-uri`) are silently ignored when delivered via `<meta>` and only take effect as a real header. (An earlier version of this app only had the meta tag, which meant the site was actually framable despite this doc claiming otherwise - fixed by adding `_headers`.) |
| A06 | Vulnerable and Outdated Components | The app deliberately has **zero third-party JavaScript dependencies** at runtime — no CDN scripts, no npm packages shipped to the browser. The only external resource is Google Fonts (CSS only, no script execution) — see "Known limitation" below if you want to remove even that. |
| A07 | Identification and Authentication Failures | No authentication exists (no accounts) — not applicable. |
| A08 | Software and Data Integrity Failures | Imported data (JSON backups, BeerXML files, URL share payloads) is never trusted blindly: `Security.safeParseJSON()` enforces a size cap and strips `__proto__`/`constructor`/`prototype` keys before merging anything into app state, to prevent prototype-pollution attacks via a crafted import file or share link. BeerXML is parsed with the browser's native `DOMParser`, which does not resolve external entities/DTDs by default — this is deliberately left as the default (do not switch to a parser or configuration that does resolve external entities, as that would reintroduce XXE risk). |
| A09 | Security Logging and Monitoring Failures | Not applicable in the traditional sense (no server to log). Client-side errors are caught and surfaced to the person via toast notifications rather than failing silently, so problems are visible rather than hidden. |
| A10 | Server-Side Request Forgery (SSRF) | No server exists to make outbound requests on anyone's behalf. The only outbound `fetch()` calls the app makes are client-initiated, to a fixed, hardcoded endpoint (`https://b0x.nz/api/shorten`) for the optional link-shortening feature — the destination is never influenced by user input beyond the URL being shortened itself. |

## Defence-in-depth details worth knowing about

- **Size caps everywhere untrusted data enters the app**: imported JSON files, BeerXML
  files, and URL share payloads are all capped (see `MAX_SHARE_PAYLOAD_BYTES` in `share.js`
  and the `maxBytes` parameter of `Security.safeParseJSON`) to prevent a malicious or
  corrupted file from causing pathological memory/CPU usage.
- **No inline event handlers** (`onclick="..."` etc.) anywhere in generated HTML — every
  interaction is wired via `addEventListener` in JS after render, which is both cleaner and
  keeps the CSP simple (no need for `'unsafe-inline'` in `script-src`).
- **`unsafe-inline` is only permitted for `style-src`**, needed for a handful of dynamically
  computed inline styles (progress-bar widths, colour swatches). These are all
  numeric/computed values, never raw user text, so this doesn't reopen the XSS surface
  closed by the `script-src` restriction.

## Known limitation

The Google Fonts `@import` in `style.css` is the one resource the app loads from a
third-party origin. It's CSS-only (fonts + a stylesheet, no executable script) and is
explicitly scoped in the CSP's `style-src`/`font-src`. If you want a genuinely zero-external-
request deployment, download the three font families used (Fraunces, Inter, JetBrains Mono)
and self-host the `.woff2` files instead — the CSP and CSS would both need a small update to
point at `'self'` instead of `fonts.googleapis.com`/`fonts.gstatic.com`.

## Deploys not showing up without a hard refresh

`_headers` also sets `Cache-Control: no-cache` on every file. `app.js`, `data.js`, `style.css`,
etc. are served under static, unhashed filenames (unlike a typical bundler build that names
files `app.a1b2c3.js`), so without an explicit header the browser and Cloudflare's edge have
no signal to ever re-check them after the first load - a push can go live and visitors just
keep getting the previous version until they hard-refresh. `no-cache` doesn't disable caching;
it makes the browser/edge revalidate (a cheap conditional `If-None-Match` request) on every
load, so a new deploy is served the moment it's live. `index.html` previously worked around
this with manual `?v=4` query strings on every `<script>`/`<link>` tag, which only helped if
someone remembered to bump the number on every release - removed now that it's unnecessary.

## Reporting a concern

This is a small personal-use project without a formal disclosure process, but if you spot
something wrong here, the fix is almost always in one of: `security.js` (escaping/sanitising
helpers), `share.js` (URL payload handling), or the CSP meta tag in `index.html`.
