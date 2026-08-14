# ⛳ Island Golf Party

Online realtime multiplayer minigolf PoC — Mario-Party-style, one island hole.

- Rooms with 4-letter join codes, 1–4 players, host starts the round
- Authoritative Node server: physics, turns, and scores run server-side at
  ~30 Hz; clients render snapshots (WebSocket, `ws`)
- One island course: bumpers → dogleg with sand trap → bridge over a
  water canal → rotating spinner gate → green (water is out of play — the
  ball always bounces back, never lost)
- Slingshot controls: drag back from the ball, release to shoot
- Camera: Q/E or arrow keys, right-drag, or on-screen buttons
- Custom 2D physics (XZ plane, shared `js/physics.js` + `js/course-data.js` on
  client and server) + Three.js rendering

## Run locally

```bash
npm install
npm start   # serves http://localhost:3000
```

Open the URL in two browser windows (or share your LAN URL) to play.

## Deploy

Node app (`server.js` serves static files + WebSocket). On Dokploy use the
`nixpacks` type; listens on `PORT` (default 3000).
