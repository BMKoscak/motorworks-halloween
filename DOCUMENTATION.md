# MOTORWORKS — Halloween Edition

**Play locally:** http://localhost:3000 · **LAN:** http://192.168.1.89:3000 (Vite binds `0.0.0.0:3000`) · **In-game docs viewer:** http://localhost:3000/docs.html

```bash
npm install
npm run dev
```

A third-person 3D open-town car factory, customization and action game in the browser: order a car at the lobby kiosk, watch it get built across five animated assembly stations, then drive it through an autumn small town at Halloween, up a foggy hill to the Old Town Cemetery. You can also steal cars, run from the police, and find a handful of easter eggs. Built with **Three.js r170** for rendering, **cannon-es** for physics (raycast vehicle), **Blender 5.2** headless Python for every 3D model, and WebAudio for all sound.

![Title screen](public/docs/screenshots/01_title_screen.png)

---

## 1. Architecture

| Layer | Files | Notes |
|---|---|---|
| Boot / game loop | `src/main.js` | Game states: `title → play ⇄ kiosk ⇄ paused`, `busted`. Fixed-step physics (1/60 s, up to 12 sub-steps, frame-rate independent), post-processing (bloom), automatic quality fallback on slow GPUs. Exposes `window.__MW` QA hooks. |
| Core | `src/core/*` | `input.js` (keys, pointer lock, **key clearing on unlock/blur**), `assets.js` (GLB loader + stats), `physics.js` (cannon world, heightfield, COL_ colliders), `batcher.js` (static batching per material per 64 m cell), `bake.js` (vertex-colour baking of rigid parts), `cameraRig.js` (orbit / chase / cockpit / scripted cams). |
| World | `src/world/*` | `terrain.js` (one height function shared by physics heightfield, visual mesh and road ribbons), `town.js`, `cemetery.js`, `factory.js`, `atmosphere.js` (dusk sky shader, harvest moon, stars, fog, falling leaves, ground fog). |
| Vehicles | `src/vehicle/*` | `carVisual.js` (hinged Blender car + paint/livery shader + bolt-on parts + lights), `livery.js` (canvas-drawn decals projected in car space), `vehicle.js` (cannon `RaycastVehicle`), `effects.js` (skid marks, smoke, sparks, mist). |
| Actors | `src/actors/*` | `character.js` (articulated joint rig: walk / run / wave / operate / talk / sit / panic / reach), `player.js`. |
| Systems | `src/systems/*` | `assembly.js`, `kiosk.js`, `traffic.js`, `police.js`, `npcs.js`, `missions.js`, `audio.js` (dialogue FX chains, engine synth, sirens, procedural radio). |
| UI | `index.html`, `src/style.css`, `src/ui/hud.js` | HUD, rotating minimap, wanted skulls, speedometer, order tracker, subtitles and speech bubbles, pause/settings, kiosk panel, telemetry badge. |
| Build scripts | `scripts/*`, `blender/*`, `tests/*` | `npm run assets` (Blender), `npm run dialogue` (ElevenLabs / local TTS), `npm test` (Playwright QA), `node scripts/build-docs.mjs`. |

**Performance work.** The first build ran about 2,600 draw calls at 19 fps on the dev machine's AMD Radeon R5 M330. Three changes brought that down:
- **Static batching.** Thousands of Blender prop meshes are merged per material and per 64 m cell, so frustum culling still works.
- **Vertex-colour baking.** Civilian and police cars, and every character, are baked into one mesh per rigid part (body, door, rim, limb). Hinges and joints stay animatable.
- **Pooled lights.** Ten real `PointLight`s are reassigned to the nearest emissive sources (streetlights, lanterns, porch pumpkins) every 0.3 s.

If the frame rate stays under 26 fps, the game steps Graphics Quality down automatically. Setting the quality by hand turns this off.

## 2. Blender asset pipeline

The models are generated procedurally by `blender -b --factory-startup -P blender/build_*.py` (`npm run assets`). `blender/mwlib.py` writes the geometry in game coordinates (x, y-up, z-forward) and converts it to Blender space, so the glTF `+Y up` export puts every node exactly where the game expects it.

- **Pivots and hinges.** Every moving part is its own object, with its origin on the hinge or joint and its geometry offset around it. It carries glTF extras `{hinge, open}` or `{joint}`:
  - Doors hinge at the front pillar.
  - Hoods hinge at the cowl.
  - Trunks hinge at the rear deck. The pickup's tailgate hinges at the bottom and the hearse's liftgate at the top.
  - Wheels hang from `Knuckle_*` (steer and camber) → `Axle_*` (spin).
  - The steering wheel sits under a tilted `SteeringColumn`.
  - Robot arms chain `Base → Shoulder → Elbow → Wrist → Tool`.
  - The press `Ram`, crane `Trolley → Hoist`, lift `Platform`, scanner `Laser_Bar`, sliding lobby `Panel_L/R`, 8 roll-up garage `Slat_*`, barrier `Arm`, cemetery `Gate_L/R`, crypt `CryptDoor`, and the character joints (head, jaw, upper/lower arms and legs) are all separate pivoted nodes.
- **No Z-fighting.** Panels overlap their body volumes instead of sharing planes. Ground overlays (roads, lots, skid marks) use graded `polygonOffset` priorities. Text meshes are low-resolution with no bevel.
- **Collision.** Buildings, machines and props export invisible `COL_*` boxes, which become cannon static boxes. The gate and garage-door colliders follow their hinged nodes. Tombstones, curbs and the conveyor get explicit boxes.
- **UVs.** World-scale box-projection UVs are written in `bmesh`, so bricks and siding tile at a constant size.
- **Preview renders.** Every GLB is also rendered with Workbench for this document. Cars are rendered with their doors, hood and trunk opened, which shows the hinges.

| | | |
|---|---|---|
| ![](public/docs/screenshots/blender_car_muscle.png) | ![](public/docs/screenshots/blender_car_pickup.png) | ![](public/docs/screenshots/blender_car_coupe.png) |
| ![](public/docs/screenshots/blender_car_hearse.png) | ![](public/docs/screenshots/blender_car_sedan.png) | ![](public/docs/screenshots/blender_parts.png) |
| ![](public/docs/screenshots/blender_wheels.png) | ![](public/docs/screenshots/blender_robot_arm.png) | ![](public/docs/screenshots/blender_press.png) |
| ![](public/docs/screenshots/blender_crane.png) | ![](public/docs/screenshots/blender_lift.png) | ![](public/docs/screenshots/blender_scanner.png) |
| ![](public/docs/screenshots/blender_garage_door.png) | ![](public/docs/screenshots/blender_sliding_door.png) | ![](public/docs/screenshots/blender_barrier.png) |
| ![](public/docs/screenshots/blender_forklift.png) | ![](public/docs/screenshots/blender_cemetery_gate.png) | ![](public/docs/screenshots/blender_props.png) |
| ![](public/docs/screenshots/blender_plant.png) | ![](public/docs/screenshots/blender_diner.png) | ![](public/docs/screenshots/blender_gas_station.png) |
| ![](public/docs/screenshots/blender_hardware.png) | ![](public/docs/screenshots/blender_police_station.png) | ![](public/docs/screenshots/blender_house_a.png) |
| ![](public/docs/screenshots/blender_house_b.png) | ![](public/docs/screenshots/blender_character.png) | ![](public/docs/screenshots/blender_skeleton.png) |

<!-- AUTO:ASSETS -->
| GLB | Objects | Meshes | Triangles | Hinged / jointed nodes | Size |
|---|---|---|---|---|---|
| `car_muscle.glb` | 62 | 44 | 2,080 | Axle_FL, Axle_FR, Axle_RL, Axle_RR, Door_L, Door_R, Hood, Knuckle_FL, Knuckle_FR … (+4) | 160 KB |
| `car_pickup.glb` | 59 | 41 | 1,864 | Axle_FL, Axle_FR, Axle_RL, Axle_RR, Door_L, Door_R, Hood, Knuckle_FL, Knuckle_FR … (+4) | 147 KB |
| `car_coupe.glb` | 53 | 35 | 1,552 | Axle_FL, Axle_FR, Axle_RL, Axle_RR, Door_L, Door_R, Hood, Knuckle_FL, Knuckle_FR … (+4) | 126 KB |
| `car_hearse.glb` | 63 | 45 | 2,032 | Axle_FL, Axle_FR, Axle_RL, Axle_RR, Door_L, Door_R, Hood, Knuckle_FL, Knuckle_FR … (+4) | 162 KB |
| `car_sedan.glb` | 58 | 40 | 1,684 | Axle_FL, Axle_FR, Axle_RL, Axle_RR, Door_L, Door_R, DoorRear_L, DoorRear_R, Hood … (+6) | 137 KB |
| `parts.glb` | 109 | 87 | 2,612 | Blower_Pulley | 218 KB |
| `wheels.glb` | 36 | 27 | 5,460 | — | 243 KB |
| `robot_arm.glb` | 19 | 12 | 536 | Base, Elbow, Shoulder, Wrist | 42 KB |
| `press.glb` | 9 | 8 | 300 | Ram | 28 KB |
| `crane.glb` | 9 | 6 | 128 | Bridge, Hoist, Trolley | 14 KB |
| `garage_door.glb` | 20 | 19 | 288 | Slat_0, Slat_1, Slat_2, Slat_3, Slat_4, Slat_5, Slat_6, Slat_7 | 32 KB |
| `sliding_door.glb` | 8 | 7 | 180 | Panel_L, Panel_R | 18 KB |
| `barrier.glb` | 4 | 3 | 84 | Arm | 9 KB |
| `cemetery_gate.glb` | 26 | 23 | 4,476 | Gate_L, Gate_R | 278 KB |
| `forklift.glb` | 12 | 10 | 412 | Forks, ForkWheel_FL, ForkWheel_FR, ForkWheel_RL, ForkWheel_RR | 33 KB |
| `lift.glb` | 4 | 3 | 108 | Platform | 10 KB |
| `scanner.glb` | 4 | 3 | 72 | Laser_Bar | 8 KB |
| `plant.glb` | 78 | 76 | 6,960 | GiantSpider | 441 KB |
| `diner.glb` | 16 | 14 | 1,596 | — | 95 KB |
| `gas_station.glb` | 26 | 25 | 1,392 | — | 94 KB |
| `hardware.glb` | 11 | 10 | 844 | — | 55 KB |
| `police_station.glb` | 21 | 20 | 1,028 | — | 78 KB |
| `house_a.glb` | 28 | 26 | 1,116 | — | 93 KB |
| `house_b.glb` | 22 | 20 | 636 | — | 57 KB |
| `props.glb` | 103 | 75 | 5,818 | CryptDoor, Turntable_Top | 399 KB |
| `character.glb` | 67 | 49 | 1,676 | Foot_L, Foot_R, Hand_L, Hand_R, Head, Hips, Jaw, LowerArm_L, LowerArm_R … (+7) | 124 KB |
| `skeleton.glb` | 72 | 54 | 2,180 | Foot_L, Foot_R, Hand_L, Hand_R, Head, Hips, Jaw, LowerArm_L, LowerArm_R … (+7) | 161 KB |
<!-- /AUTO:ASSETS -->

## 3. Physics engine

- **cannon-es `RaycastVehicle`.** Rear-wheel drive with soft suspension (stiffness 32, rest length 0.34 m adjusted by ride height), so you get visible body roll and compression over the 16 cm curbs.
- **Steering.** Speed-sensitive (0.62 → 0.17 rad) with smoothing, so steering and throttle work together at any speed.
- **Handbrake drift.** `Space` drops rear grip and brakes the rear axle, which leaves skid marks and tire smoke.
- **Extras.** Downforce applied at the centre of mass, adaptive angular damping, and self-righting (`Backspace` resets the car).
- **Tuning.** Engine stage, transmission ratio and tire compound (grip or drift) set the drive force, top speed and front/rear friction.
- **Other bodies.** Parked cars are dynamic and pushable. Civilian traffic uses kinematic bodies on lane loops. Police cruisers are full AI raycast vehicles. Breakable props (mailboxes, hydrants, barrels, hay bales) are sensors until a car smashes them.
- **Two bugs found by QA and fixed** (details in §7):
  - cannon-es drives this axis convention backwards, so the engine sign is flipped.
  - The downforce was first applied at a world-space point, which produced a huge roll torque and killed turning at speed.

## 4. Audio and dialogue pipeline (ElevenLabs)

All 54 spoken lines are **ElevenLabs** takes, one per line, generated with the `eleven_v4` model through the ElevenLabs connector.
- **Delivery tags.** Some lines use inline tags such as `[whispering]`, `[panicked]`, `[menacing]` and `[laughs]`.
- **Cost.** A single-line estimate came first (145 credits, about $0.03). The full run cost **4,447 credits** for 4,267 characters.
- **Import.** `scripts/import-elevenlabs.mjs` downloads each take to `public/audio/dialogue/<line>.mp3` and records the voice ID, generation ID and credits in `manifest.json`. Re-imports skip generations they already have.
- **No overwrites.** `npm run dialogue` never replaces an ElevenLabs take unless you pass `--force`.

| Character | ElevenLabs voice | Voice ID | In-game FX chain |
|---|---|---|---|
| Big Sal (foreman) | Grits Oxley – Gritty Grandpa | `8vYCG1Q6bAbJWXdRuCIr` | room |
| Bones McGee (skeleton welder) | Dr. Quibble – Nerdy Cartoon | `RDSy0QN68yhrjuOgqzQ4` | rattle (tremolo) |
| Old Mortimer (groundskeeper) | Romulus II – Deep, Mysterious | `7lJ2JuXZKHyck5zlS7XQ` | ghost (long reverb + delay) |
| The Phantom | Final Boss – Evil Villain | `d3qrd1ge6zWDvUxIeXiH` | ghost |
| Dolores (diner) | Latrice – Down-to-Earth Southern | `tmHt9OXLAa0z2IPF4k0Y` | room |
| Panicked car owner | Ayla – Bubbly & Expressive | `b8JMPeNuVrqqWExQc8e9` | dry |
| Townsperson | Olivia – Storytelling | `MJw0jtAmgm4D71m0HUJU` | dry |
| Police dispatch | Claire – Crisp & Clear | `umwdC76NumBsGtudno3p` | radio (band-pass, saturation, static) |
| Officer on foot | Johnny – Strong American | `R3brgFoQWI6vjwB1A4aP` | dry |
| Wolfman Jack-O (radio DJ) | Johnny Dynamite – Vintage Radio DJ | `CeNX9CMwmxDxUF5Q2Inm` | radio |
| Kiosk assistant | MegaBot | `DXav2Iq8VRhoGarNlWcx` | robot (ring modulation) |
| Plant PA | Clara – PA Clear Voice | `no52gq1ZwK7Lmejv1EHz` | radio |
| Line workers | K. V. Hagen · Shay | `t1yzxMpe9zK42bXmI1T2` · `ZQF62XTHtHemfMB0pp0G` | room |

**Fallbacks.** For new or changed lines without a take, `npm run dialogue` either calls the ElevenLabs REST API (when `ELEVENLABS_API_KEY` is set) or synthesises locally with Windows SAPI. At runtime, a missing file falls back to the browser's `speechSynthesis`. Every line also shows a subtitle and a speech bubble.

The rest of the sound is synthesised in WebAudio:
- the V6/V8 engine note, with blower whine and turbo whistle
- tire screech, horn, car alarm and a positional siren for each cruiser
- stamping thumps, weld crackle, paint hiss, garage-door rattle and gate creak
- ambience: wind, owls and crows
- **WHOO 66.6 FM** (synthwave) and **KRYP 13.13** (graveyard rock), both generated by a step sequencer, with DJ breaks between songs

## 5. Town, factory and cemetery layout

- **Motorworks Plant** (120 × 50 m, brick and steel). It has a sawtooth roof, chimneys, a neon **MOTORWORKS** sign with a giant spider web and a bobbing spider, a parking lot, sliding glass lobby doors, and a lobby with the configurator kiosk and turntable. A roll-up exit door at the east end leads onto the exit road. The Custom Bay / Paint Shop has its own roll-up door.
- **Main Street:** the 1950s Moonlite Diner, gas station, hardware store, police station, Halloween banners, benches, hydrants, flickering streetlights and leaf piles.
- **Elm Avenue:** a suburb of 10 houses plus 12 along Main Street. Each yard is decorated: glowing jack-o'-lanterns on porches, tombstones, ghosts, skeletons, scarecrows and hay bales, with cobwebs on the porches.
- **Trees:** about 250 autumn trees in four foliage tints.
- **The hill road** winds up a 10 m grade into thick fog.
- **Old Town Cemetery** (124 × 118 m):
  - wrought-iron gates that creak open as you approach, and an iron perimeter fence
  - 6 crypts plus the grand *Family Vlad* crypt with a hinged door
  - about 150 crooked tombstones, each with a collider
  - dead trees, green lanterns, floating ghosts
  - the gravel **Graveyard Shift** drift loop

| | |
|---|---|
| ![](public/docs/screenshots/11_main_street.png) | ![](public/docs/screenshots/11_diner.png) |
| ![](public/docs/screenshots/11_gas_station.png) | ![](public/docs/screenshots/11_police_station.png) |
| ![](public/docs/screenshots/11_halloween_yard.png) | ![](public/docs/screenshots/11_elm_avenue.png) |
| ![](public/docs/screenshots/11_motorworks_plant.png) | ![](public/docs/screenshots/11_hill_road.png) |
| ![](public/docs/screenshots/12_cemetery_gates.png) | ![](public/docs/screenshots/12_cemetery_crypts.png) |

## 6. Gameplay systems

### A. Configuration kiosk

The kiosk has nine tabs:
1. **Body:** Muscle, V8 Pickup, Street Coupe or Hot-Rod Hearse.
2. **Paint:** primary and secondary colour (swatches or a picker) and finish. The finishes are Gloss, Matte, Metallic, Midnight Pearlescent (iridescence and sheen) and Haunted Rust Patina (procedural FBM rust in the shader).
3. **Livery:** stripes, flames, ribcage, jack-o'-lantern rally, plus the locked Monster Mash lightning.
4. **Wheels:** 6 rims including the locked pumpkin rim, tire lettering (white letters, redline, whitewall) and caliper colour.
5. **Stance:** ride height (slammed to lifted) and camber.
6. **Body Kit:** splitter, bullbar or push bumper; cowl, twin-scoop or animated blower hood; rack, light bar, siren or taxi roof; lip, GT or ducktail spoiler; side, quad or flame exhaust.
7. **Lighting:** underglow in four colours.
8. **Performance:** engine stage, gearing and tire compound, with projected stat bars.
9. **Monster Mash:** the unlockable pack (see the easter eggs).

Every change updates the car on the turntable live. Changing the hood or engine pops the hood open so you can see the engine, and changing the body opens the doors. Liveries are drawn on canvases and projected in the car's rest space, so they move with the doors and hood.

![](public/docs/screenshots/06_kiosk_open.png)
![](public/docs/screenshots/06_kiosk_bodykit.png)

### B. Assembly line

Each order gets an order number such as `MW-1031-xxxx` and a live progress panel. `V` cycles the station cameras, `F` follows the car, and holding `T` runs the line at 5× speed. There is an `E` info panel at every station.
1. **Stamping:** the press ram stamps glowing sheets, with sparks, screen shake and a growing panel stack.
2. **Body Shop:** four welding robots spark while the doors, hood and trunk are hung **on their hinges** and swing shut one by one.
3. **Paint:** spray robots fill the booth with paint mist while the shader blends from raw steel to your finish and livery.
4. **Powertrain:** the hood opens, the crane lowers your engine from its hook, the lift rises, and the wheels slide onto their axles.
5. **Final QC:** the laser scanner sweeps, the lights and underglow flicker, every hinge cycles, the roll-up door opens, and the car rolls out onto the apron.

Workers in Halloween costumes animate at each station, including **Bones the skeleton welder**. A forklift (with a driver) does laps of the aisle.

| | |
|---|---|
| ![](public/docs/screenshots/07_station_1_stamping.png) | ![](public/docs/screenshots/07_station_2_bodyshop.png) |
| ![](public/docs/screenshots/07_station_3_paint.png) | ![](public/docs/screenshots/07_station_4_powertrain.png) |
| ![](public/docs/screenshots/07_station_5_final_qc.png) | ![](public/docs/screenshots/08_hinges_open.png) |

### C. Driving

- **Cameras:** a third-person chase camera with mouse orbit, and a first-person cockpit (`C`) where the hands follow the animated steering wheel.
- **Waypoint guide:** a green beacon, a HUD arrow and a minimap target guide you from the factory to the cemetery. `N` toggles it.
- **Graveyard Shift:** a timed, checkpointed drift trial that starts at the cemetery arch and scores drift points.

| | |
|---|---|
| ![](public/docs/screenshots/09_driving_turn.png) | ![](public/docs/screenshots/09b_handbrake_drift.png) |
| ![](public/docs/screenshots/10_cockpit_view.png) | ![](public/docs/screenshots/15_graveyard_shift_trial.png) |

### D. Car theft and police

- **Stealing a car.** Press `E` at any parked or stopped car. The player walks to the door, the hinged door swings open, and you either hotwire it (some cars have an alarm with flashing hazards) or pull the driver out. The driver runs off screaming. Stolen cars are swapped for a fully articulated, repaintable model.
- **Wanted level (1–5 skulls).** Crimes that raise it:
  - a theft that civilians or police witness (line of sight)
  - speeding past a patrol car
  - three smashed props within 30 s
  - ramming a cruiser
- **Pursuit.** Police cruisers (lightbar, siren and push bumper) pursue you with intercept prediction, whisker raycasts, ramming and unsticking. One extra unit spawns per skull, out of your view.
- **Escaping.** You can:
  - break line of sight
  - hide in the cemetery fog (detection range drops from 62 m to 26 m and the heat decays faster)
  - get a respray in the Custom Bay, which clears both your stolen status and your heat
- **Busted.** If you are boxed in or stopped next to a cruiser for 5 s, you are **BUSTED**: you pay a fine and respawn outside the police station.

| | |
|---|---|
| ![](public/docs/screenshots/13_stealing_car.png) | ![](public/docs/screenshots/13_police_pursuit.png) |
| ![](public/docs/screenshots/13_police_chase_overview.png) | ![](public/docs/screenshots/14_busted.png) |

### E. Halloween easter eggs

1. **The Phantom Hearse.** Drive to the Vlad crypt and honk 3 times (`H`). The crypt door opens and a translucent, green-burning hearse races you down the hill to the gas station.
2. **Bones the Skeleton Welder** at Station 2 tells five bone puns. His jaw moves while he talks.
3. **Golden Pumpkins.** Five glowing pumpkins are hidden around the map: behind the diner, in an Elm Avenue backyard, behind the Vlad crypt, on the plant's loading dock, and in a south-west field. Collecting all five unlocks the **Monster Mash** pack: glowing jack-o'-lantern rims, a green-glowing Frankenstein blower, green lightning exhaust and a lightning livery.
4. **Haunted car radio.** Press `R` in any car to cycle WHOO 66.6 FM and KRYP 13.13, with DJ breaks.

| | |
|---|---|
| ![](public/docs/screenshots/15_phantom_hearse.png) | ![](public/docs/screenshots/15_monster_mash_kiosk.png) |
| ![](public/docs/screenshots/05_dialogue_foreman.png) | ![](public/docs/screenshots/04_pause_menu.png) |

## 7. Automated QA self-test loop

`npm test` (`tests/qa.mjs`) drives the real game in Playwright Chromium on the local GPU. It presses real keys, measures the results through `window.__MW`, captures every screenshot in this document, and writes `tests/qa-results.json` plus the `qa` section of `TELEMETRY.json`.

<!-- AUTO:QA -->
Last run: 2026-10-23T11:38:03.952Z — **20/20 checks passed** in 179s (Playwright, Chromium + ANGLE/D3D11 on the local GPU).

- [x] **boot** — Page loads, Blender assets stream in, zero console errors / uncaught exceptions
- [x] **assets** — All Blender .glb assets load with valid bounding boxes and hinged/jointed child nodes
- [x] **walk** — Player walks with WASD and collides with walls and cars (no clipping)
- [x] **escape** — Escape/pointer-lock release clears held movement keys (no auto-walking after menu)
- [x] **dialogue** — Talking to an NPC (E) plays spoken dialogue audio with subtitles/speech bubble
- [x] **kiosk** — Kiosk opens; every customization category changes the live 3D car; order is placed
- [x] **assembly** — Car progresses through all 5 assembly stations with hinge + robot animation sync, then rolls out
- [x] **hinges** — Finished car: doors, hood, trunk rotate about their Blender pivots (no floating parts)
- [x] **physics** — Vehicle physics: W accelerates; W+A turns left and W+D turns right simultaneously (heading change)
- [x] **cockpit** — First-person cockpit camera shows hands on the animated steering wheel; R toggles the haunted radio
- [x] **town** — Town, autumn/Halloween decorations, Main Street businesses render (screenshots)
- [x] **cemetery** — Cemetery gate hinges open as the player approaches; crypts, tombstones, fog
- [x] **theft** — Car theft (E on a town car) opens the hinged door, triggers wanted level and police pursuit
- [x] **busted** — Boxed in by police for 5 s => BUSTED, fine, respawn at the Police Station
- [x] **pumpkins** — Golden Pumpkins: collecting all 5 unlocks the Monster Mash kiosk pack
- [x] **phantom** — Phantom Hearse: honking 3x at the Vlad crypt summons a ghost hearse race
- [x] **trial** — Graveyard Shift: driving through the start arch starts the timed drift trial
- [x] **radio_audio** — Spoken dialogue audio + radio DJ use the cached local audio files (no TTS fallback needed)
- [x] **perf** — Performance snapshot (draw calls, triangles, FPS on this GPU)
- [x] **final_errors** — Zero console errors or uncaught exceptions during the whole QA run

<details><summary>Key measurements</summary>

```json
{
 "boot": {
  "loadMs": 9407,
  "gpu": "ANGLE (AMD, AMD Radeon (TM) R5 M330 (0x00006660) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "consoleErrors": []
 },
 "escape": {
  "heldBefore": [
   "KeyW"
  ],
  "mode": "paused",
  "keysAfterEscape": [],
  "driftAfterResume": 0,
  "clearReason": "unlock"
 },
 "assembly": {
  "events": [
   "order",
   "s1_body",
   "close_Door_L",
   "close_Door_R",
   "close_Hood",
   "close_Trunk",
   "s2_paint",
   "s3_open",
   "engine_in",
   "wheel_0",
   "wheel_1",
   "wheel_2",
   "wheel_3",
   "s3_close",
   "s4_final",
   "qc_open",
   "qc_close",
   "exit_open",
   "complete"
  ]
 },
 "physics": {
  "inCar": true,
  "fpsDuringDrive": 18.5,
  "speedAfterW": 9.71,
  "leftHeadingDelta": 0.577,
  "rightHeadingDelta": -0.372,
  "braking": {
   "before": 16.51,
   "after": 8.7
  },
  "highSpeed": {
   "speed": 12.95,
   "dHeading": -0.144
  },
  "highSpeedTurn": {
   "speed": 12.95,
   "dHeading": -0.144
  },
  "skidMarks": 349
 },
 "theft": {
  "inStolenCar": true,
  "doorSwungOpen": 1,
  "markedStolen": true,
  "wantedLevel": 1,
  "pursuit": [
   {
    "mode": "pursuit",
    "pos": [
     187.4,
     -4
    ],
    "siren": true
   },
   {
    "mode": "pursuit",
    "pos": [
     -193.3,
     2.6
    ],
    "siren": true
   }
  ],
  "police": {
   "level": 1,
   "cars": [
    {
     "mode": "pursuit",
     "pos": [
      187.4,
      -4
     ],
     "siren": true
    },
    {
     "mode": "pursuit",
     "pos": [
      -193.3,
      2.6
     ],
     "siren": true
    }
   ],
   "stats": {
    "crimes": [
     {
      "kind": "theft",
      "at": 131216,
      "level": 1
     }
    ],
    "maxLevel": 1,
    "busts": 0,
    "escapes": 0
   }
  }
 },
 "perf": {
  "fps": 19,
  "drawCalls": 1352,
  "triangles": 418798,
  "vehicles": 4
 }
}
```
</details>
<!-- /AUTO:QA -->

**Problems found by the QA loop, and their fixes:**
- **Engine force sign.** It was reversed for cannon-es with this axis convention: `W` drove the car backwards.
- **Downforce torque.** The downforce was applied at a world-space point, which made a large roll torque and stopped the car turning at speed.
- **Car dimensions.** They were read from the glTF scene instead of the `Car_*` node's extras, so the wheels came out with NaN scale.
- **Accessory names.** GLTFLoader strips the `.` from Blender's `.001` suffixes, so props held in the right hand showed up on every character.
- **Mirrored text.** The cemetery sign and the banners read backwards.
- **Kiosk.** It was over-exposed by bloom, and its camera could orbit through the lobby walls.
- **Slow-motion physics.** The dt clamp made physics run slowly at low frame rates. The clamp was raised, and automatic quality fallback was added.
- **Lost wheel contact.** cannon-es heightfield raycasts miss on some grid cells, so wheels lost contact (seen on the exit road). The flat town and the cemetery plateau are now backed by exact static collision slabs.

## 8. Controls

| Key | Action |
|---|---|
| W A S D | Walk / drive and steer (throttle and steering work at the same time) |
| Mouse | Orbit the camera (click the game to capture the mouse) |
| Shift / Space | Sprint / jump on foot · handbrake drift in a car |
| E | Interact, talk, use the kiosk, read info panels, enter, steal or exit a car, use the Custom Bay |
| C · H · R · L | Cockpit cam · horn · haunted radio · headlights |
| V · F · T | Station cam · follow car · fast-forward the build |
| N · Backspace | Toggle the waypoint guide · reset the car upright |
| Esc | Pause and settings: Master, Voice, SFX and Music volume, Graphics Quality and units. **All held keys are cleared.** |

## 9. Telemetry

`TELEMETRY.json` holds the machine-readable data. The title screen shows the same numbers on the toggleable **Build Telemetry** badge.

<!-- AUTO:TELEMETRY -->
| Metric | Value |
|---|---|
| Build started → finished | 2026-10-23T06:41:18Z → 2026-10-23T11:38:13.196Z (**4h 57m**) |
| LLM API calls (agent turns) | ~210 — approx. agent turns / tool round-trips, counted from the session |
| LLM input tokens | ~60M processed (est.; overwhelmingly prompt-cache reads of a context that grew to ~620k) |
| LLM output tokens | ~210k (est.; ~8.5k lines of code, scripts, HTML/CSS and docs, plus reasoning) |
| Estimated LLM cost |  metered - Claude Pro subscription (session used ~60% of the 5-hour window, ~40% weekly at last check) |
| Context window at finish | ~620k / 1M tokens (measured via session usage API) |
| ElevenLabs API key present | no |
| ElevenLabs API calls / characters | 54 calls / 4267 chars |
| ElevenLabs voice IDs (planned per character) | foreman: `8vYCG1Q6bAbJWXdRuCIr`, skeleton: `RDSy0QN68yhrjuOgqzQ4`, groundskeeper: `7lJ2JuXZKHyck5zlS7XQ`, waitress: `tmHt9OXLAa0z2IPF4k0Y`, panic: `b8JMPeNuVrqqWExQc8e9`, civilian: `MJw0jtAmgm4D71m0HUJU`, dispatch: `umwdC76NumBsGtudno3p`, cop: `R3brgFoQWI6vjwB1A4aP`, dj: `CeNX9CMwmxDxUF5Q2Inm`, kiosk: `DXav2Iq8VRhoGarNlWcx`, phantom: `d3qrd1ge6zWDvUxIeXiH`, worker: `t1yzxMpe9zK42bXmI1T2`, worker2: `ZQF62XTHtHemfMB0pp0G`, pa: `no52gq1ZwK7Lmejv1EHz` |
| Dialogue lines synthesised / characters | 54 lines / 4267 chars (elevenlabs: 54) |
| Audio caching | 54 ElevenLabs MP3s cached in public/audio/dialogue (re-imports skip known generations; 54 cache hits this run) |
| Blender GLB assets | 27 files, 47,114 triangles, 3.2 MB |
| QA self-check runs / last result | 10 full runs · last 20/20 · 189 individual check passes in total |

**Per-phase timestamps** (from artifact modification times)

| Phase | Start | End | Minutes |
|---|---|---|---|
| Environment survey & scaffold | 2026-10-23T06:41:18Z | 2026-10-23T06:41:29.483Z | 1 |
| Blender asset pipeline (27 GLBs) | 2026-10-23T07:40:06.597Z | 2026-10-23T08:14:54.883Z | 35 |
| Dialogue synthesis (54 lines) | 2026-10-23T08:49:51.473Z | 2026-10-23T08:50:45.217Z | 1 |
| Engine, world & gameplay code | 2026-10-23T07:50:54.739Z | 2026-10-23T08:13:06.170Z | 22 |
| Automated QA loop | 2026-10-23T08:22:41.589Z | 2026-10-23T11:38:03.955Z | 195 |
| Documentation | 2026-10-23T09:24:15.862Z | 2026-10-23T11:38:13.196Z | 134 |
<!-- /AUTO:TELEMETRY -->

## 10. Screenshot gallery

<!-- AUTO:GALLERY -->
![01_title_screen](public/docs/screenshots/01_title_screen.png)
![01b_title_telemetry_badge](public/docs/screenshots/01b_title_telemetry_badge.png)
![03_player_at_plant_wall](public/docs/screenshots/03_player_at_plant_wall.png)
![04_pause_menu](public/docs/screenshots/04_pause_menu.png)
![05_dialogue_foreman](public/docs/screenshots/05_dialogue_foreman.png)
![06_kiosk_body](public/docs/screenshots/06_kiosk_body.png)
![06_kiosk_bodykit](public/docs/screenshots/06_kiosk_bodykit.png)
![06_kiosk_lighting](public/docs/screenshots/06_kiosk_lighting.png)
![06_kiosk_livery](public/docs/screenshots/06_kiosk_livery.png)
![06_kiosk_open](public/docs/screenshots/06_kiosk_open.png)
![06_kiosk_paint](public/docs/screenshots/06_kiosk_paint.png)
![06_kiosk_performance](public/docs/screenshots/06_kiosk_performance.png)
![06_kiosk_wheels](public/docs/screenshots/06_kiosk_wheels.png)
![07_rollout_finished_car](public/docs/screenshots/07_rollout_finished_car.png)
![07_station_1_stamping](public/docs/screenshots/07_station_1_stamping.png)
![07_station_2_bodyshop](public/docs/screenshots/07_station_2_bodyshop.png)
![07_station_3_paint](public/docs/screenshots/07_station_3_paint.png)
![07_station_4_powertrain](public/docs/screenshots/07_station_4_powertrain.png)
![07_station_5_final_qc](public/docs/screenshots/07_station_5_final_qc.png)
![08_hinges_open](public/docs/screenshots/08_hinges_open.png)
![09_driving_turn](public/docs/screenshots/09_driving_turn.png)
![09b_handbrake_drift](public/docs/screenshots/09b_handbrake_drift.png)
![10_cockpit_view](public/docs/screenshots/10_cockpit_view.png)
![11_diner](public/docs/screenshots/11_diner.png)
![11_elm_avenue](public/docs/screenshots/11_elm_avenue.png)
![11_gas_station](public/docs/screenshots/11_gas_station.png)
![11_halloween_yard](public/docs/screenshots/11_halloween_yard.png)
![11_hardware_store](public/docs/screenshots/11_hardware_store.png)
![11_hill_road](public/docs/screenshots/11_hill_road.png)
![11_leaf_piles_trees](public/docs/screenshots/11_leaf_piles_trees.png)
![11_main_street](public/docs/screenshots/11_main_street.png)
![11_motorworks_plant](public/docs/screenshots/11_motorworks_plant.png)
![11_police_station](public/docs/screenshots/11_police_station.png)
![12_cemetery_crypts](public/docs/screenshots/12_cemetery_crypts.png)
![12_cemetery_gates](public/docs/screenshots/12_cemetery_gates.png)
![12_vlad_crypt](public/docs/screenshots/12_vlad_crypt.png)
![13_police_chase_overview](public/docs/screenshots/13_police_chase_overview.png)
![13_police_pursuit](public/docs/screenshots/13_police_pursuit.png)
![13_stealing_car](public/docs/screenshots/13_stealing_car.png)
![14_busted](public/docs/screenshots/14_busted.png)
![15_graveyard_shift_trial](public/docs/screenshots/15_graveyard_shift_trial.png)
![15_monster_mash_kiosk](public/docs/screenshots/15_monster_mash_kiosk.png)
![15_phantom_hearse](public/docs/screenshots/15_phantom_hearse.png)
![blender_barrier](public/docs/screenshots/blender_barrier.png)
![blender_car_coupe](public/docs/screenshots/blender_car_coupe.png)
![blender_car_hearse](public/docs/screenshots/blender_car_hearse.png)
![blender_car_muscle](public/docs/screenshots/blender_car_muscle.png)
![blender_car_pickup](public/docs/screenshots/blender_car_pickup.png)
![blender_car_sedan](public/docs/screenshots/blender_car_sedan.png)
![blender_cemetery_gate](public/docs/screenshots/blender_cemetery_gate.png)
![blender_character](public/docs/screenshots/blender_character.png)
![blender_crane](public/docs/screenshots/blender_crane.png)
![blender_diner](public/docs/screenshots/blender_diner.png)
![blender_forklift](public/docs/screenshots/blender_forklift.png)
![blender_garage_door](public/docs/screenshots/blender_garage_door.png)
![blender_gas_station](public/docs/screenshots/blender_gas_station.png)
![blender_hardware](public/docs/screenshots/blender_hardware.png)
![blender_house_a](public/docs/screenshots/blender_house_a.png)
![blender_house_b](public/docs/screenshots/blender_house_b.png)
![blender_lift](public/docs/screenshots/blender_lift.png)
![blender_parts](public/docs/screenshots/blender_parts.png)
![blender_plant](public/docs/screenshots/blender_plant.png)
![blender_police_station](public/docs/screenshots/blender_police_station.png)
![blender_press](public/docs/screenshots/blender_press.png)
![blender_props](public/docs/screenshots/blender_props.png)
![blender_robot_arm](public/docs/screenshots/blender_robot_arm.png)
![blender_scanner](public/docs/screenshots/blender_scanner.png)
![blender_skeleton](public/docs/screenshots/blender_skeleton.png)
![blender_sliding_door](public/docs/screenshots/blender_sliding_door.png)
![blender_wheels](public/docs/screenshots/blender_wheels.png)
<!-- /AUTO:GALLERY -->
