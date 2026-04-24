# Funsies — Project Specification
### A collection of head-tracked 3D worlds and a motion-based game, built for the pure joy of it.

---

## 1. What We're Building

**Funsies** is a browser-based collection of interactive experiences powered by real-time head tracking. The centrepiece is a set of four miniature 3D worlds that react to how you move your head — creating the illusion that your monitor is a physical window into another space. Alongside the worlds is a head-movement-controlled game that serves as both a standalone experience and a warm-up mechanic for first-time visitors.

There are no frameworks, no dashboards, no business logic. This is a passion project — built to be technically interesting, visually impressive, and genuinely fun.

---

## 2. The Core Illusion — How It Works

The foundation of the entire project is a technique called **head-tracked off-axis projection**.

### The Concept
When you move your head in real life, nearby objects appear to shift more than distant ones. This is called *motion parallax* — one of the key ways your brain perceives depth without needing two eyes. If we track where your head is in real space and move a virtual camera to match, a 3D scene on screen starts to feel like a physical object sitting behind a window.

### The Three Components

**1. Face Tracking**
A webcam feed is processed every frame by **MediaPipe Face Mesh**, which detects 468 facial landmarks and returns their coordinates. From this we extract the head's approximate `(x, y, z)` position in real space — how far left/right, up/down, and close/far the viewer is.

**2. Off-Axis Projection**
This is the critical and often misunderstood part. It is *not* enough to simply move the camera. The camera's **projection frustum** must also be recalculated each frame so that the edges of the screen always align perfectly with the scene's virtual frame. Without this correction, the effect feels like a floating camera. With it, the monitor becomes a window.

The formula per frame:
```
left   = (screenLeft   - headX) * nearPlane / headZ
right  = (screenRight  - headX) * nearPlane / headZ
top    = (screenTop    - headY) * nearPlane / headZ
bottom = (screenBottom - headY) * nearPlane / headZ

camera.projectionMatrix = offAxisFrustum(left, right, top, bottom, near, far)
camera.position.set(headX, headY, headZ)
```

**3. Real-Time Render Loop**
Three.js renders the scene from the corrected camera position at up to 60fps. The loop is:
```
webcam frame → MediaPipe → head (x, y, z) → update camera → render scene → repeat
```

### Multiple Faces
The illusion is mathematically valid for exactly **one viewpoint**. If multiple faces are detected, the scene locks and a message is displayed: *"Only one pair of eyes at a time 👀"*. If no face is detected, the scene pauses and waits.

---

## 3. Tech Stack

| Concern | Tool | Why |
|---|---|---|
| 3D rendering | **Three.js** | Mature, well-documented, full WebGL abstraction |
| Head tracking | **MediaPipe Face Mesh** | Runs in-browser via WASM, low latency, no install |
| Animation / tweening | **GSAP** | Precise timelines, smooth object animation |
| Spatial audio | **Web Audio API** | Native, no library needed, supports 3D positioning |
| Post-processing | **Three.js PostProcessing** (`pmndrs/postprocessing`) | Bloom, DoF, film grain, colour grading |
| Dev environment | **Vite** | Fast HMR, clean ESM imports, zero config overhead |
| Asset loading | **Three.js GLTFLoader** | Standard GLTF/GLB format for 3D models |
| Character animation | **Mixamo** (source) + **Three.js AnimationMixer** | Free rigged characters, pre-made animation clips |
| Low-poly assets | **Kenney.nl** (source) | Free, clean low-poly asset packs |

**No React. No Next.js.** The project is almost entirely a WebGL canvas running its own loop. A UI framework would add abstraction with no benefit and potential interference with Three.js DOM management.

---

## 4. Project Structure

```
/funsies
  index.html                  ← landing page (is itself a funsie)
  vite.config.js
  /src
    main.js                   ← entry, routing between experiences
    /core
      tracker.js              ← MediaPipe head tracking (shared by everything)
      camera.js               ← off-axis projection logic (shared by everything)
      audio.js                ← Web Audio context + spatial sound utilities
      renderer.js             ← shared Three.js renderer + postprocessing setup
    /worlds
      index.js                ← world switcher + transition logic
      space.js                ← World 1: Space Portal
      tiny-world.js           ← World 2: Miniature Island
      tiny-person.js          ← World 3: Tiny Person Living in Your Screen
      aquarium.js             ← World 4: Aquarium
    /game
      dodge.js                ← Dodge: the head-movement game
    /shared
      assets.js               ← asset preloading + caching
      postfx.js               ← per-world post-processing profiles
      utils.js
  /assets
    /models                   ← GLTF/GLB files
    /textures
    /audio
```

The tracker and camera modules are **the most important files in the project**. They are built first, tested independently, and shared by every subsequent experience. Getting these right makes everything else snap into place.

---

## 5. The Core Modules

### `tracker.js`
Initialises MediaPipe Face Mesh, processes webcam frames, and emits a clean head position object on each frame.

```js
// Output shape every frame:
{
  x: Number,        // horizontal offset from screen centre (cm equivalent)
  y: Number,        // vertical offset
  z: Number,        // estimated depth (derived from face bounding box size)
  confidence: Number,
  faceCount: Number
}
```

Handles:
- Camera permission request + fallback UI
- `faceCount === 0` → emit null, scene pauses
- `faceCount > 1` → emit null, show "one pair of eyes" message
- Smoothing via exponential moving average to reduce jitter

### `camera.js`
Takes a head position and a reference to a Three.js camera and updates it with the correct off-axis frustum every frame.

```js
updateCamera(camera, headPosition, screenDimensions, nearPlane, farPlane)
```

Handles:
- Frustum recalculation
- Camera position sync
- Fallback to a neutral default when no head is present

---

## 6. The Four Worlds

Each world is a self-contained Three.js scene with its own lighting, assets, animations, audio, and post-processing profile. They share the tracker and camera modules but nothing else.

---

### World 1 — Space Portal

**The feeling:** Your monitor is a hole cut through your wall into deep space. Lean in and the stars rush toward you. Look around the edges and you see what's just out of frame.

**Visual elements:**
- Starfield — 10,000–15,000 point particles at varied depths
- Nebula clouds — sprite-based particles with additive blending, deep purples and blues
- 2–3 planets at different depths — spheres with NASA texture maps, slow rotation
- A glowing portal ring around the screen edge — emissive torus with bloom
- Occasional distant asteroid or satellite drifting past

**Post-processing profile:**
- Heavy `UnrealBloomPass` — the defining look of this world
- Subtle `FilmPass` grain
- Dark, cold colour grade

**Audio:**
- Procedurally generated deep space ambient drone via Web Audio API oscillators
- Low-frequency rumble when leaning in close
- No music — silence is part of the feel

**Animations:**
- Slow nebula particle drift (GSAP)
- Planet rotation
- Occasional "warp" — a fast streak of light across the scene (triggered randomly)

**Build difficulty:** ⭐⭐ — Easiest of the four. Good starting point.

---

### World 2 — Miniature Island

**The feeling:** A tiny world sitting on a surface in front of you. Like a snow globe without the globe. Lean right and you see the back of the hill. Lean in and a tiny flag becomes readable.

**Visual elements:**
- Low-poly island with hills, water edge, small beach
- 4–6 low-poly trees with GSAP sway animation
- A tiny lighthouse with a rotating emissive light
- Slow-moving clouds above (flat card geometry, parallax with head)
- Soft fog layer at the waterline

**Art style:** Intentionally low-poly. Clean, charming, not trying to be realistic.

**Post-processing profile:**
- Subtle `SSAOPass` (ambient occlusion) — makes objects feel grounded
- Warm, slightly desaturated colour grade
- Very light bloom on the lighthouse beam

**Audio:**
- Gentle wind ambience
- Distant seagulls (randomly placed in 3D space via Web Audio PannerNode)
- Soft water lapping

**Animations:**
- Trees: continuous gentle sway (GSAP sine loop)
- Lighthouse beam: rotation (Three.js animation loop)
- Clouds: slow drift across scene
- Water: animated shader with subtle wave displacement

**Assets:** Kenney.nl Nature Pack + custom geometry for terrain.

**Build difficulty:** ⭐⭐⭐ — Moderate. Asset loading + idle animation management.

---

### World 3 — Tiny Person Living in Your Screen

**The feeling:** There is a tiny person in there, living their life, completely unaware of you. Move your head to spy on different parts of their room. Get too close — they notice.

**Visual elements:**
- A small interior room: desk, chair, bookshelf, window (looking out to a tiny sky)
- A rigged human character going about their day
- Warm interior lighting (point light from a desk lamp)
- Details: a tiny TV playing static, a plant, a mug on the desk

**Character behaviour (state machine):**

| State | Animation | Trigger |
|---|---|---|
| Idle | Sitting, looking around | Default |
| Walking | Walk cycle between desk and bookshelf | Every ~20s |
| Reacting | Looks up, backs away | Head gets too close (z threshold) |
| Searching | Looks around confused | Head disappears and reappears |

**Post-processing profile:**
- Warm colour grade (yellows, soft amber)
- Very subtle `BokehPass` depth of field — background slightly soft
- No bloom — this world is cosy, not glowy

**Audio:**
- Ambient room tone (light hum, subtle creak)
- Footstep sounds on state change
- Character reaction sound when they notice you

**Assets:** Mixamo character + animations (GLTF export). Room furniture as simple Three.js geometry or Kenney interior pack.

**Build difficulty:** ⭐⭐⭐⭐ — Most complex. Requires state machine, character animation, proximity detection.

---

### World 4 — Aquarium

**The feeling:** A deep, living aquarium. Fish swim at different depths. Bubbles rise slowly. Lean and see fish that were hidden behind others. Light dances on the floor.

**Visual elements:**
- 30–50 fish at varied depths using instanced meshes
- Animated water surface plane with refraction shader
- Caustic light patterns on the floor (animated texture or shader)
- Rising bubble particle system
- Coral and rock geometry at the base
- Volumetric blue-green depth haze

**Post-processing profile:**
- Blue-green colour grade — everything takes on the underwater tone
- `UnrealBloomPass` on the water surface highlights
- Strong `FogPass` equivalent for depth haze

**Audio:**
- Low ambient underwater hum (generated via Web Audio)
- Randomised bubble sounds (short, spatial)
- Subtle water movement

**Animations:**
- Fish: each instance follows a slow sine-path with slight randomisation
- Bubbles: upward particle drift with gentle horizontal sway
- Water surface: vertex shader displacement
- Caustics: animated UV scrolling or procedural shader

**Assets:** Low-poly fish GLTF models (Kenney or Sketchfab free tier). Coral as simple geometry.

**Build difficulty:** ⭐⭐⭐⭐⭐ — Hardest. Shaders for water and caustics are the challenge. Build last.

---

## 7. The Game — Dodge

**Concept:** A first-person endless dodger. Obstacles fly directly toward the camera. You physically move your head to avoid them. No keyboard, no mouse, no controller — just your face.

**Why it fits:**
- Uses the exact same tracker already built for the worlds
- Teaches the player the head-tracking mechanic through play — by the time they're done they're ready for the worlds
- Can serve as the entry point to the whole Funsies project

**Gameplay loop:**
1. Countdown — "Get ready. Move your head."
2. Obstacles (geometric shapes — cubes, rings, walls with holes) fly toward the camera on the z-axis
3. Player moves head to dodge
4. Speed increases progressively
5. Three lives. On each hit the screen cracks/flashes.
6. Death screen shows survival time + best time. Plays again immediately.

**Obstacle types (introduced progressively):**

| Obstacle | Description | Introduced at |
|---|---|---|
| Block | Simple cube, dodge around it | From start |
| Wall with hole | Full-width wall, move head to align with gap | 15s |
| Spiral | Rotating ring of blocks | 30s |
| Swarm | Multiple small blocks scattered | 45s |

**Visual style:**
- Dark tunnel / void aesthetic — black background, neon-outlined obstacles
- Speed lines as particles on the z-axis — intensify with speed
- Screen crack overlay on hit (canvas overlay or CSS)
- Bloom on obstacle edges

**Audio:**
- Rhythmic low pulse that speeds up with the game
- Impact sound on hit
- Near-miss whoosh
- Death sound + slow-down effect

**Head position usage:**
```js
// Tracker output maps directly to camera offset
camera.position.x = headX * SENSITIVITY
camera.position.y = headY * SENSITIVITY
// z is not used for movement — obstacles come toward a fixed z
```

**Build difficulty:** ⭐⭐⭐ — Moderate. Core loop is simple, polish takes time.

---

## 8. Build Order

Build in this sequence. Each step depends on the last and introduces one new concept at a time.

```
Step 1 — Core tracker + camera modules
  ↓
Step 2 — Minimal test scene (a floating cube, head tracking wired up)
  ↓
Step 3 — World 1: Space Portal (nail the full pipeline with simple visuals)
  ↓
Step 4 — Dodge game (uses same tracker, introduces game loop)
  ↓
Step 5 — World 2: Miniature Island (adds asset loading + idle animation)
  ↓
Step 6 — World 3: Tiny Person (adds character animation + state machine)
  ↓
Step 7 — World 4: Aquarium (shaders, instancing — tackle last)
  ↓
Step 8 — Landing page + world switcher + transitions
  ↓
Step 9 — Polish pass: audio, post-processing, performance
```

---

## 9. Performance Targets & Constraints

| Metric | Target |
|---|---|
| Frame rate | 60fps, graceful at 30fps |
| Tracking latency | < 50ms head-to-render |
| Memory | No leaks on world switch (dispose all Three.js objects) |
| First load | Assets for active world only — lazy load others |

**Key rules:**
- Dispose geometries, materials, and textures when switching worlds
- Use instanced meshes for repeated objects (fish, stars, trees)
- Cap particle counts — test on a mid-range machine, not just your dev setup
- Tracker runs in a `requestAnimationFrame` loop — do not use `setInterval`

---

## 10. What We Are Not Building

Being explicit about scope keeps this fun:

- No backend, no server, no database
- No user accounts or saved state (high scores stored in `localStorage` only)
- No mobile support — this requires a webcam and works best on a laptop/desktop
- No full OS 3D effect — the illusion is constrained to the browser window, which is the right scope
- No multi-user / multiplayer
- No framework (React, Vue, etc.)

---

## 11. Finalized Design Decisions

---

### Landing Page
The landing page is itself an illusion — but a different one from the 3D worlds, so it doesn't give away the main trick early.

**Depth of field illusion.** The page title and nav sit in sharp focus. Everything behind them — a slowly, subtly shifting background — is beautifully blurred. As the visitor moves their cursor (or head), the focal point shifts. Things that were blurred drift into clarity. It is quiet and elegant, and it tells the visitor immediately: *this whole project is about perception.*

Dodge starts automatically when the visitor lands. Finish or quit, and the worlds become accessible. This teaches the head-tracking mechanic through play before the worlds demand it — without gating or forcing anyone.

---

### World Switcher
Two layers, intentionally:

**Visible nav** — a minimal, always-accessible floating nav so nobody is ever stuck. Small, unobtrusive, out of the way of the experience.

**Secret gesture** — slowly tilt your head to one side and hold it for 1.5 seconds to trigger the world switcher. Deliberate enough that it never fires accidentally during Dodge or normal exploration. Discovered by the curious, invisible to everyone else. Finding it should feel like finding a cheat code.

> Rejected alternative: head shake — too easily triggered during Dodge gameplay.

---

### Dodge as Entry Point
The worlds are always freely accessible — no score gate. Dodge is simply the default first experience when you land. The goal is to warm people up to head-tracking naturally, not to punish them into it.

---

### World 3 — Character Name
The tiny person's default name is **Ade**. On first visit to World 3, the player is prompted with a small, unobtrusive input: *"What's his name?"* with `Ade` pre-filled. Whatever they type sticks for the session and is saved to `localStorage` for return visits.

The name appears in one small place in the UI — a tiny nameplate above his door, or a label on his desk. Subtle. Just enough to make it feel personal.

---

*Document version 1.1 — all design questions resolved. Ready to build.*
