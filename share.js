// ---- Share: compress a recipe into a URL, decode one back out ----
// Uses the browser's native CompressionStream (gzip) - no third-party library, so nothing
// to audit for supply-chain risk. Falls back to plain (uncompressed) base64url if the
// browser doesn't support CompressionStream (older Safari).

const MAX_SHARE_PAYLOAD_BYTES = 500_000; // sanity cap: refuse to encode/decode anything absurd

const Share = {
  supportsCompression() {
    return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
  },

  base64urlEncode(bytes) {
    let bin = "";
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  base64urlDecode(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },

  async gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  },
  async gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder().decode(buf);
  },

  // Encode a recipe or a batch (plus its recipe, so the recipient has full context)
  // into a URL-safe string. kind: "recipe" | "batch".
  async encode(kind, data) {
    const envelope = { v: 1, kind, data, ts: Date.now() };
    const json = JSON.stringify(envelope);
    if (json.length > MAX_SHARE_PAYLOAD_BYTES) throw new Error("Too large to share as a link");
    let payload, prefix;
    if (this.supportsCompression()) {
      payload = this.base64urlEncode(await this.gzip(json));
      prefix = "gz.";
    } else {
      payload = this.base64urlEncode(new TextEncoder().encode(json));
      prefix = "raw.";
    }
    return prefix + payload;
  },
  async encodeRecipe(recipe) { return this.encode("recipe", recipe); },
  async encodeBatch(batch, recipe) { return this.encode("batch", { batch, recipe }); },

  // Decode any share payload, returning { kind, data }. Validates shape per kind.
  async decode(encoded) {
    if (typeof encoded !== "string" || encoded.length > MAX_SHARE_PAYLOAD_BYTES * 2) {
      throw new Error("Share link is invalid or too large");
    }
    let json;
    if (encoded.startsWith("gz.")) {
      json = await this.gunzip(this.base64urlDecode(encoded.slice(3)));
    } else if (encoded.startsWith("raw.")) {
      json = new TextDecoder().decode(this.base64urlDecode(encoded.slice(4)));
    } else {
      throw new Error("Unrecognised share link format");
    }
    const envelope = Security.safeParseJSON(json, MAX_SHARE_PAYLOAD_BYTES);
    if (!envelope || !envelope.kind) throw new Error("Link does not contain valid Hops data");
    if (envelope.kind === "recipe") {
      if (!Security.looksLikeRecipe(envelope.data)) throw new Error("Link does not contain a valid recipe");
    } else if (envelope.kind === "batch") {
      if (!envelope.data || typeof envelope.data !== "object" || !envelope.data.batch) throw new Error("Link does not contain a valid batch");
      if (envelope.data.recipe && !Security.looksLikeRecipe(envelope.data.recipe)) throw new Error("Link's recipe data is invalid");
    } else {
      throw new Error("Unknown share type: " + envelope.kind);
    }
    return { kind: envelope.kind, data: envelope.data };
  },
  async decodeRecipe(encoded) {
    const { kind, data } = await this.decode(encoded);
    if (kind !== "recipe") throw new Error("This link is a " + kind + ", not a recipe");
    return data;
  },

  buildShareUrl(encoded) {
    const url = new URL(window.location.href);
    url.hash = "r=" + encoded;
    url.search = "";
    return url.toString();
  },

  // Read a share payload out of the current page URL hash, if present. Returns null if none.
  readFromLocation() {
    const hash = window.location.hash;
    const m = hash.match(/^#r=(.+)$/);
    return m ? m[1] : null;
  },

  clearFromLocation() {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  },
};

// ---- Optional link shortening via b0x.nz (public, keyless, CORS-enabled) ----
// Confirmed working endpoint/shape as of the API docs supplied for this project.
// Rate limit: 25 req/hour, 100/day per IP on the public tier - always fall back
// to the full (unshortened) link on any failure so sharing never breaks.
const LinkShortener = {
  endpoint: "https://b0x.nz/api/shorten",

  async shorten(longUrl, opts = {}) {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: longUrl, expiryDays: opts.expiryDays || 90 }),
      });
      if (!res.ok) throw new Error("b0x.nz returned " + res.status);
      const data = await res.json();
      // Expecting a slug or full short URL back; handle both shapes defensively.
      if (data.shortUrl) return data.shortUrl;
      if (data.slug) return `https://b0x.nz/${data.slug}`;
      throw new Error("Unexpected response shape from b0x.nz");
    } catch (e) {
      console.warn("Link shortening failed, falling back to full link:", e.message);
      return null;
    }
  },
};
