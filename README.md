# IRON V — 3D Lock-On Boxing

A fast, original, browser-based 3D boxing game. Lock-on shoulder camera, feint
mind-games, guard breaks, counters, stamina management and a cinematic ultimate —
tuned to run at max FPS on average phones and to automatically scale up
resolution/quality on desktops with GPUs.

## ▶ Play

**https://pompomroma.github.io/Iron-V/**

(Deployed automatically from `main` by GitHub Actions. If the link 404s, enable
GitHub Pages once: repo **Settings → Pages → Source → GitHub Actions**.)

Works on desktop (keyboard) and mobile (touch joystick + buttons).

## Controls

| Action           | Keyboard        | Mobile               |
| ---------------- | --------------- | -------------------- |
| Move             | `W` `A` `S` `D` | Left-side joystick   |
| Light punch      | `K`             | 🥊 button            |
| Heavy punch      | `L`             | 💥 button            |
| Block (hold)     | `F`             | 🛡 button (hold)      |
| Dash / dodge     | `Space`         | ⚡ button             |
| Ultimate (full)  | `Q`             | ★ button             |
| FPS / debug      | `F3`            | —                    |

### Mechanics

- **Lock-on**: you and your opponent always face each other; the camera keeps
  the opponent centered over your right shoulder. Movement strafes around them.
- **Feint switch**: press Light then quickly Heavy (or the reverse) during the
  windup to smoothly cancel into the other punch — bait blocks and dodges.
- **Block**: absorbs punches into your guard meter. If it's shattered you are
  **stunned**. Guard recovers while you don't block.
- **Counter**: hit an opponent during their windup for bonus damage.
- **Dash**: brief invincibility at the start. Costs stamina.
- **Stamina**: spent by punches, feints and dashes (never by walking); regenerates
  after a short pause.
- **Ultimate**: meter builds from damage dealt and taken. At 100%, unleash a
  cinematic rush attack.
- First to **3 KOs** wins the match. AI gets tougher every round.

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tech

- [Three.js](https://threejs.org) (vendored, MIT) — no other dependencies.
- 100% procedural assets: avatars, arena, VFX textures and all sound effects
  (WebAudio synthesis) are generated in code. No external asset downloads.
- Fixed-timestep simulation (60 Hz) with interpolated rendering — combat timing
  is identical everywhere while rendering runs uncapped (60/120/144+ Hz).
- Adaptive performance: device tier detection (LOW/MED/HIGH) plus a dynamic
  resolution scaler that tunes pixel ratio in real time to hold your display's
  native refresh rate.
