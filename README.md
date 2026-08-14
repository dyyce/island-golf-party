# ⛳ Island Golf Party

Couch-multiplayer (hotseat) minigolf PoC — Mario-Party-style, one island hole.

- 1–4 players, quick-pick avatars (name, color, hat) — optional, defaults provided
- One island course: bumpers → dogleg with sand trap → rail-less bridge over a
  water canal (penalty +1) → rotating spinner gate → green
- Slingshot controls: drag back from the ball, release to shoot
- Custom 2D physics (XZ plane) + Three.js rendering, no build step

## Run locally

Any static server, e.g. `python3 -m http.server` in this folder, then open
`http://localhost:8000`. Three.js is loaded from CDN via import map.

## Deploy

Static site — serve the repo root as-is (Dokploy `static` type).
