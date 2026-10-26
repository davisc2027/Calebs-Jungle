# CALEB'S JUNGLE — "Battlefront Mode" Game Plan

**Goal:** Evolve the game into a smooth, Battlefront 2–style large-battle shooter (class-based combat, waves, objectives, battle points, hero moments, vehicle play) **without ever dropping below 60 FPS on a mid-range laptop.**

This plan is written so any model can execute it. Follow phases IN ORDER. Do not skip the verification step at the end of each phase. Do not "improve" things outside the current phase's scope.

---

## 0. ARCHITECTURE MAP (read first, do not rediscover)

Everything lives in ONE file: `C:\Users\davis\calebs-jungle\index.html` (~6,300 lines).
Three.js r158, no build tools, no modules. All globals.

| Thing | Where / What |
|---|---|
| Player state | global `P` — `P.pos` (Vector3), `P.vel`, `P.yaw`, `P.pitch`, `P.hp`, `P.shield`, `P.ammoArr[]`, `P.weapon`, `P.carried`, `P.onGround`, `P.swinging` |
| Main loop | `function animate()` — calls `updatePlayer(dt)`, `monkeys.forEach(m=>m.update(dt))`, `updateProjectiles(dt)`, `updateBlood(dt)`, `updateSparks(dt)`, `updateDayNight(dt)`, etc. `dt` is slow-mo scaled; `rawDt` is real |
| Enemies | `class Monkey` (~line 1850) — states `patrol/chase/attack`, `this.boss`, `this.isGranny`, `this.aggroed`, `_throw()` fires pooled bullets. `class Spider` (~line 1612) — `fixedY` non-null = cave spider |
| Enemy arrays | `monkeys[]`, `spiders[]`, `projectiles[]` |
| Terrain height | `th(x, z)` — ALWAYS use this for ground height. Terrain is 80×80-segment plane, `MAP` = world size constant |
| Collision (player) | `resolveCollisions()` — AABB push-out vs `CASTLE_WALLS`, `KEEP_WALLS`, `HUT_WALLS`, `FORT_WALLS`; radial vs mountain cone (bidirectional: outside pushes out, inside pushes in); `TUNNEL_WALLS`+`TUNNEL_ZONES` only when `inCave` |
| Collision (AI) | `resolveMonkeyWalls()` for monkeys; `Spider._resolveSpiderWalls()` for spiders. Any new AI MUST get the same treatment |
| Line of sight | `hasLOS(fromPos, toPos)` — 2D segment-vs-AABB slab test over all wall arrays. AI may only attack when this returns true. USE THIS, don't raycast |
| Underground | 5 standalone 16×16 chambers at `VENT_FLOOR = -20`, entered via hatches (`VENT_ENTRIES`), each with ladder + EXIT sign + chest + 1 spider. `inCave` flag gates fog/sky/walls |
| Zones | `STAIR_ZONES` (walkable elevated flats), `TUNNEL_ZONES` (cave containment w/ zone-snap) |
| Bosses | `spawnBird()` (flying boss), `spawnGranny()` (rocket-only damage), King monkey (`boss:true`) |
| Vehicles | F-22 plane (`inPlane`, `planeGroup`), ziplines, mountain elevator |
| Economy | `playerMoney`, weapon shop at `SHOP_POS` (`openShop()`), `HOME_BASE` safe zone at (-130,0,-130) |
| HUD | DOM elements, `showMessage()`, `announce()`, `updateStatsHUD()`, `updateAmmoHUD()`, kill feed `addKillFeed()` |
| Audio | WebAudio: `tone()`, `noise()`, `playFX(name)` |

### PERFORMANCE RULES (non-negotiable — every phase must obey)

These were hard-won fixes. Violating any of them reintroduces lag:

1. **NO allocations in per-frame code.** No `new THREE.Vector3/Mesh/Material/Color/Geometry` inside `animate()`, any `update*()`, or AI `update(dt)`. Use module-level scratch vectors (see `_throwStart`, `_throwDir`, `_skyScratch` for the pattern) and pooled static geometry/materials (see `Monkey._bulletGeo/_bulletMat`).
2. **PointLight budget: max ~8 active surface lights near the player.** Torch meshes (stick + glowing sphere) are nearly free — add as many as you like. Torch *PointLights* are not. Underground chambers use 1 light per room + emissive flame spheres.
3. **Shadows:** `PCFShadowMap` (never PCFSoft), 1024 shadow map, sun position updates gated to >0.002 rad change. New props: `castShadow = false` unless it's a large landmark.
4. **Terrain stays at 80×80 segments.**
5. **Pixel ratio capped at 1.5; antialias off on HiDPI** (already in `initThree()`).
6. **UI redraws:** minimap runs at 10 Hz via `animate._mmTick` counter. Any new HUD canvas must use the same throttle pattern. DOM text updates only when the value changed.
7. **No `setInterval`/`setTimeout` for game logic.** Everything ticks off `dt` inside `animate()`.
8. **Distance culling for AI:** any new per-entity work must early-out beyond ~80 units from `P.pos` (use squared distance, no `Math.sqrt` until needed).
9. **New AI obeys walls + LOS:** reuse `resolveMonkeyWalls()` / `hasLOS()`. Characters never see or shoot through walls.

### VERIFICATION PROTOCOL (run after EVERY phase)

1. Open `index.html` in the browser (it's a plain file — no server needed).
2. Check the console for errors (zero tolerance).
3. Add temporarily if not present: an FPS counter (`rawDt` EMA in the corner). Target: 60 solid, minimum 50 during the heaviest fight the phase adds.
4. Play 3 minutes: enter/exit a cave chamber, fight monkeys at the castle, fire every weapon, ride the plane once.
5. If FPS regressed, fix it BEFORE moving to the next phase. The usual suspects: per-frame allocation you added, a PointLight per entity, castShadow on new meshes.

---

## PHASE 1 — Combat Feel ("smoothness players can feel")

Battlefront feels good because of feedback, not graphics. Cheapest wins first.

0. **Third-person over-the-shoulder camera (THE Battlefront signature — do this first).**
   - Add a camera mode toggle on **V**: first-person (current) ↔ third-person over-right-shoulder.
   - Third-person target: camera sits behind and above the player — offset roughly `(+0.9 right, +1.7 up, -4.2 back)` in yaw space, looking at a point ~1.5 units above `P.pos` and slightly right. Compute with scratch vectors (module-level, no per-frame allocation).
   - **Camera collision:** raycast is NOT needed — reuse the existing wall AABBs: step the camera from the player outward along the offset in 4 samples; if a sample lands inside any wall AABB (same arrays `resolveCollisions` uses) or below `th(x,z)+0.3`, shorten the boom to the last clear sample. Cheap and glitch-free.
   - The player mesh (`buildPlayer` parts) must be visible in third-person and hidden in first-person — there is likely a `visible` flag pattern already; check how the player mesh is handled today before changing.
   - Aim stays crosshair-centered: bullets still originate from camera ray so aim feel is identical in both modes. Scope/sniper zoom forces first-person while zoomed, restores mode after.
   - While underground (`inCave`, low ceilings), clamp the boom shorter (~2.2) so the camera never exits the chamber ceiling.

1. **FPS counter + frame budget HUD (dev aid).** Small corner readout of FPS (EMA over 30 frames). Keep it behind a `DEBUG=true` const so it can ship off.
2. **Hit feedback pass:**
   - Directional damage indicator: when hit, flash a red arc on the screen edge pointing toward the attacker (compute angle from attacker pos vs `P.yaw`; one reusable DOM element, CSS transform rotation — no canvas).
   - Kill confirmation: distinct sound (`tone()` chirp) + kill-feed entry already exist; add small "+10" score popup (single reusable DOM element, retriggered).
3. **Weapon feel:** camera kick on fire (add small impulse to `P.pitch`, recover over 0.1 s in `updateCamera`), stronger for shotgun/bazooka. Tracer lines for bullets: ONE pooled `THREE.Line` per weapon slot, repositioned on fire, faded via material opacity — never created per shot.
4. **Sprint FOV:** lerp `camera.fov` 75→82 while sprinting, `camera.updateProjectionMatrix()` only when fov actually changed (>0.1 diff).
5. **Footstep/landing audio already exists** — add a soft landing thud scaled by fall speed.

Acceptance: every hit, kill, and shot has visible+audible feedback; FPS unchanged.

## PHASE 2 — Battle Points & Classes (the Battlefront economy)

1. **Battle Points (BP):** new global `battlePoints`. Earn: +10 kill, +25 headshot, +50 boss damage tick, +15 objective tick. Display next to money in the inventory panel. Persist across death (Battlefront style).
2. **Classes:** on spawn/respawn screen, pick one of 4 (DOM overlay reusing pause-panel styling):
   - **Assault** — rifle+shotgun, +15% move speed
   - **Heavy** — minigun (new weapon: fast fire, heavy spread, slow walk while firing) + 50 bonus shield
   - **Officer** — pistol+SMG, deployable shield-recharge totem (a torch-like prop that pulses `P.shield` +5/s within 10 units, 30 s lifetime, max 1 active — one pooled mesh)
   - **Sniper** — sniper+pistol, +50% headshot damage, thermal ping: pressing T highlights monkeys within 60 units through a brief emissive flash on their existing material (store original color, restore after 1.5 s; do NOT clone materials)
   - Implementation: a `CLASSES` config object; on selection set multipliers/loadout on `P`. Weapons reuse the existing 5-slot system — the minigun is a stats-variant of the rifle (fire rate, spread, damage), not a new mesh pipeline.
3. **BP spend menu (hold B):** small radial/list DOM menu: 500 BP = Hero moment (Phase 4), 200 BP = airstrike ping (3 pooled explosion effects along a line after 2 s), 150 BP = full shield + ammo refill.

Acceptance: class choice changes loadout/stats; BP accrues and spends; zero new per-frame allocations (grep your new code for `new THREE.` inside update paths).

## PHASE 3 — Waves & Objectives (the battle)

1. **Wave director:** replace ad-hoc monkey spawning with a `WaveDirector` object ticked in `animate()`:
   - Waves of 6→10→14 monkeys (cap ACTIVE monkeys at 16 — reuse dead monkeys' meshes via a pool: `mk.reset(x,z,boss)` instead of `new Monkey`, since each Monkey mesh build is expensive).
   - Spawn at map-edge points out of the player's view (check `hasLOS` from player, spawn where false).
   - Between waves: 20 s breather, announce next wave, spawn 2 supply chests (reuse `buildCaveChest` loot logic).
2. **Squad AI (cheap version):** assign each wave monkey to a squad of 3-4. One shared `squadTarget` per squad updated at 2 Hz (a counter, not per-frame): flank left, flank right, or push. Members steer toward `squadTarget` + their existing per-monkey behavior. This reads as coordinated movement for near-zero cost.
3. **Objective modes, rotating per wave:**
   - **Hold the fort** — stand in a fort zone (reuse `STAIR_ZONES` fort AABBs) to fill a capture bar while monkeys contest.
   - **Payload** — escort the girlfriend NPC walking a fixed waypoint path castle→home base; she stops when monkeys within 15 units and `hasLOS`.
   - **Classic banana raid** — existing steal-and-stash objective.
   - Objective HUD: reuse `#objective` element; capture bar is one DOM div width tween.

Acceptance: 3 full waves playable with objectives rotating; 16 monkeys + player fight ≥50 FPS; monkey pool confirmed (kill 30 monkeys, `monkeys.length` never exceeds cap).

## PHASE 4 — Hero Moment & Vehicles

1. **Hero moment (500 BP):** 30-second transform — 3× damage, +50% speed, golden emissive tint on weapon, screen vignette gold, unique music sting (`tone()` arpeggio). One timer, multipliers reset on expiry. This is the Battlefront "play as Vader" fantasy in cheap form.
2. **Vehicle pass:**
   - The F-22 already exists. Add: strafing-run objective during waves (a fort under attack marker), plane cannon damage vs ground monkeys (reuse projectile pipeline).
   - **New: rideable raft** on the big pond (70,70): simple box+logs mesh, WASD drive on water plane y=const, dismount with E. Reuse the plane's mount/dismount pattern (`inPlane` → `inRaft`).
3. **Killstreak audio/announcer:** at 5/10/15 wave kills, `announce()` + pitch-shifted sting. Track per-wave kills in WaveDirector.

Acceptance: hero moment triggers/expires cleanly; raft drives; FPS holds.

## PHASE 5 — Polish & Ship

1. **Performance re-audit:** search the whole file for `new THREE.` and confirm every hit inside `animate()`-reachable code is pooled or event-driven (shots, deaths — fine; per-frame — not fine). Count active PointLights near spawn; must be ≤8.
2. **Difficulty curve:** waves scale monkey HP +10%/wave (cap ×2), fire rate +5%/wave (cap ×1.5). Boss wave every 5th (King + Granny + bird together — they already exist).
3. **Sound mix:** duck music/ambient 30% while any gun fires (simple gain node envelope).
4. **Death/respawn loop:** on death show class-select overlay (Phase 2) with 5 s countdown, respawn at HOME_BASE. Remove any old instant-respawn.
5. **Final QA sweep** using the Verification Protocol, plus: cave chambers still work, ladder/EXIT signs visible, all 5 hatches functional, mountain no-glitch rule intact, keep door passable.

## PHASE 6 — Career Mode (story campaign)

Turns the sandbox into a progression. Everything reuses existing systems — no new engines.

1. **Persistence:** a single `career` object saved to `localStorage` (`calebs-jungle-career` key): rank, total BP earned, medals, mission completion flags, unlocked weapons/classes. Save on mission end and on stash events. Load at boot; "Continue Career" button on the title screen next to the existing start button.
2. **Mission structure — 8 missions built entirely from existing content, each with a briefing card (DOM overlay, reuse pause-panel styling), 1-3 objectives, and a debrief screen (BP earned, medals, rank progress):**
   - **M1 "Welcome to the Jungle"** — tutorial: move, shoot 3 target crates, grab 3 bananas, stash them. Unlocks: shop.
   - **M2 "The Vents"** — enter any 2 underground chambers, loot both chests, kill the spider guards. Unlocks: Officer class.
   - **M3 "Castle Run"** — classic banana raid (existing objective) with a 6-monkey garrison. Unlocks: Heavy class.
   - **M4 "Hold the Line"** — survive 3 waves defending home base (WaveDirector from Phase 3). Unlocks: Sniper class.
   - **M5 "Air Superiority"** — steal the F-22, destroy 4 marked fort targets from the air. Unlocks: airstrike BP purchase.
   - **M6 "The Mountain"** — fight to the mountain, ride the elevator, clear the interior. Unlocks: hero moment BP purchase.
   - **M7 "Granny's Revenge"** — bazooka duel vs Granny (existing boss, existing rocket-only rule). Unlocks: golden skin tint for hero moment.
   - **M8 "King of the Jungle"** — final siege: 5th-wave boss combo (King + bird + full garrison), steal the crown, stash it. Rolls credits (scrolling DOM overlay).
   - Missions are a data array (`MISSIONS = [{id, title, brief, objectives[], reward}]`) + one `MissionDirector` ticked from `animate()` that watches existing game state (banana count, kills, zones entered). Do NOT fork the game loop per mission.
   - **Ranks:** Private → Sergeant → Lieutenant → Captain → General at BP thresholds; rank shown by the money HUD; each rank grants +10 max shield (small, permanent, saved).
   - **Free Play stays:** title screen offers "Career" and "Free Play" (current sandbox with everything unlocked).
3. **Medals (saved, shown in debrief):** Marksman (10 headshots/mission), Untouchable (no deaths), Speedrunner (under par time), Exterminator (all spiders in a mission). Pure counters on existing events — zero per-frame cost.

Acceptance: career persists across a full browser restart; each mission completable in order; Free Play unaffected; FPS rules hold (MissionDirector is state-watching only — it must not scan arrays more than once per second; use a 1 Hz tick counter like the minimap pattern).

---

## GUARDRAILS FOR THE EXECUTING MODEL

- **Edit `index.html` only.** No new files, no frameworks, no module system, no CDN additions.
- **Read before writing:** locate the exact function with Grep before editing; the file is 6,300+ lines and line numbers WILL have drifted from this doc.
- **One phase per session/PR-sized chunk.** Verify, then proceed.
- **When adding an entity type, copy the Spider pattern:** class with `update(dt)`, wall resolution method, `hasLOS` gating, distance early-out, pooled mesh parts, and a global array ticked from `animate()`.
- **When unsure whether something allocates per frame — it does.** Hoist it.
- **Never trust "it looks fine on my run" — check the FPS counter during the biggest fight the phase enables.**
