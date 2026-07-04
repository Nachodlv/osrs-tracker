// Cloudflare Worker: OSRS hiscores CORS proxy for Iron Tracker.
//
// The OSRS hiscores endpoint sends no CORS headers, so a browser can't call it
// directly from a static page (e.g. GitHub Pages). This Worker fetches it
// server-side and re-serves the JSON with an Access-Control-Allow-Origin header.
// It mirrors server.py's /api/hiscores response shape, so the tracker can point
// at it with a one-line URL change later.
//
// Call it as:  GET https://<worker-url>/?player=NAME
// Deploy: see README.md in this folder.

const HISCORES_URL = "https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=";

// "*" allows any origin. To lock it to your site, set this to that origin, e.g.
// "https://nachodlv.github.io".
const ALLOW_ORIGIN = "*";

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  };
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders() });
}

export default {
  async fetch(request) {
    // CORS preflight (harmless to support even for a simple GET).
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOW_ORIGIN,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }
    if (request.method !== "GET") return jsonError(405, "Use GET");

    const player = (new URL(request.url).searchParams.get("player") || "").trim();
    if (!player) return jsonError(400, "Missing ?player=name");

    try {
      const upstream = await fetch(HISCORES_URL + encodeURIComponent(player), {
        headers: { "User-Agent": "Mozilla/5.0" },
        // Cache good lookups briefly at the edge to spare Jagex repeated hits;
        // never cache server errors so a blip clears on the next try.
        cf: { cacheTtlByStatus: { "200-299": 60, "404": 10, "500-599": 0 } },
      });
      if (upstream.status === 404) return jsonError(404, "Player not found on the hiscores");
      if (!upstream.ok) return jsonError(502, `Hiscores lookup failed (HTTP ${upstream.status})`);
      const body = await upstream.text();
      return new Response(body, { status: 200, headers: corsHeaders() });
    } catch (e) {
      return jsonError(502, "Hiscores lookup failed: " + e);
    }
  },
};
