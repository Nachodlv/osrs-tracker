# Hiscores proxy (Cloudflare Worker)

A tiny CORS proxy so the tracker can read OSRS hiscores when hosted as a static
site (e.g. GitHub Pages), without running `server.py`. The hiscores endpoint
sends no CORS headers, so the browser can't call it directly; this Worker
fetches it server-side and adds the header. See `hiscores-proxy.js`.

This is optional and independent: it does nothing to the tracker until the app
is pointed at the Worker URL (a later step). Free-tier Workers cover ~100k
requests/day, which is far more than a personal tracker needs.

## Deploy (dashboard, no CLI)

1. Sign in at https://dash.cloudflare.com (a free account is enough).
2. Workers & Pages -> Create -> Create Worker. Give it a name (e.g. `osrs-hiscores`) and Deploy.
3. Open the Worker -> Edit code, delete the sample, paste the contents of `hiscores-proxy.js`, and Deploy.
4. Copy the Worker URL shown (e.g. `https://osrs-hiscores.<your-subdomain>.workers.dev`).

## Deploy (Wrangler CLI, alternative)

From this folder:

```
npx wrangler login
npx wrangler deploy
```

## Test

Open in a browser (or curl):

```
https://<worker-url>/?player=Zezima
```

A valid name returns the hiscores JSON; a made-up name returns
`{"error":"Player not found on the hiscores"}`.

## Rate limiting (optional)

The Worker caps lookups per client IP so nobody can hammer the public URL (and,
through it, Jagex). It uses a `RATE_LIMITER` binding; when that binding is absent
the Worker skips the check and still works, so it is safe to leave unconfigured.

- **Wrangler CLI:** already set up. `wrangler.toml` declares the binding
  (`[[ratelimits]]`, 20 lookups / 60s per IP); `wrangler deploy` wires it in.
- **Dashboard:** add it once by hand. Open the Worker -> Settings -> Bindings ->
  Add -> Rate limiting, name it `RATE_LIMITER`, set a unique namespace id (any
  positive integer, e.g. `1001`), limit `20`, period `60` seconds, then Deploy.

Tune `limit` in `wrangler.toml` (or the dashboard) if 20/60s is too tight or loose;
`period` must be `10` or `60`.

## Notes

- Response shape matches `server.py`'s `/api/hiscores`, so wiring the app to it
  later is a one-line URL change.
- To lock it to your site instead of any origin, set `ALLOW_ORIGIN` in
  `hiscores-proxy.js` to your origin (e.g. `https://nachodlv.github.io`).
