# Endless Drive

Play it here https://project-magellan.pages.dev/

An endless driving playground through procedurally generated meadows, pine country, rough ridges, camps, lookout towers, and marked jump ramps. Drive in any direction; a fresh visit creates a fresh world. A `?seed=123456` link recreates the same landscape.

## Run

No build step or package installation required. From this folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://localhost:8000). Use HTTP rather than opening the HTML file directly. Three.js 0.160.0 is bundled in `vendor/` with its license. Google Fonts is optional and has system font fallbacks. Gameplay needs a browser with WebGL and module workers, but no external CDN connection. For development, `npm run dev` serves the game on port 8002 with caching disabled.

## Controls

| Input | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| **Space** | **Jump** — works while stopped or moving |
| **Shift** | **Handbrake / drift** |
| **F** | **Fly / land**: unfold the wings, or fold them to land |
| *In the air* | **W/S** throttle · **↑/↓** pitch (flight-stick style: ↓ pulls the nose up) or **Space/Shift** climb/dive · **A/D** or **←/→** roll · **Q/E** yaw |
| R | Recover onto nearby clear ground |
| C | Chase / wide / bonnet camera |
| L | Headlights |
| M | Sound on / off |
| Esc / P | Pause / resume |
| N | Generate a new world |

Touch devices and compact windows show a **steering slider** in the lower left, where the ← → buttons used to be: slide it left or right to steer. Its track stays put and the knob stops at either end, however far your finger travels. ↑ accelerates and ↓ brakes, then reverses; **Jump** and **Drift** sit in the middle. A steering sensitivity setting (50–150%) on the menu changes how quickly small slider movements turn; full deflection is always full lock. Camera selection and recovery are also available in the pause menu. The game pauses when the window loses focus. Trip records and sound preference are stored locally. Sound begins muted on the first visit.

**Graphics** (start and pause menus) offers Low, Medium, High and Auto. Each preset sets render resolution, sun shadow-map size, and grass density and range. Medium matches the previous fixed phone settings (1.35× resolution, 1024 shadows, half grass within 48 m); High matches the previous desktop settings (1.7×, 2048 shadows, full grass within 78 m), and uses up to 2× resolution on phones. **Auto** is the default: it starts phones at Medium and desktops at High, climbs one step (through an intermediate Medium+ level) after 6 seconds of smooth driving, and steps down after 2 seconds of sustained frames slower than about 48 fps. Single streaming hitches and pauses are ignored, and a level that fails twice is not retried during that visit. Auto remembers where it settled for the next visit. `?quality=low|medium|high|auto` overrides the setting; browser tests otherwise use fixed Medium (touch) or High (desktop).

## Current world and handling

- Mountains are continuous terrain with broad foothills. Random cone mountains, abrupt biome switches, terrain walls, and deep-water barriers are gone.
- Roads are painted directly onto the terrain, so there are no raised road ribbons or mismatched road collision surfaces.
- Water comes in two sizes. Small ponds sit on an 840 m grid; **inland seas** 1–1.6 km across, with irregular coasts and deep centres, sit on a sparse 4 km grid. The first sea lies about a kilometre from spawn. Seas claim their surroundings, so no pond overlaps one, and roads run straight down into them. Follow the blue lake/sea hint or minimap water to Mirror Lake near spawn, or preview the first sea from the air with `?seed=3&test=sea`.
- Water has sandy shores and a single-pass surface shader. Two drifting layers of a small wave texture (generated at startup, mipmapped so detail fades cleanly with distance) ride on a broad swell that calms with distance, so the surface reads as wind chop up close and open water from the air. The surface reflects the same sky gradient and clouds the sky dome draws, weighted by Schlick Fresnel: transparent looking down, mirror-like at grazing angles. The scene's sun puts a broad sheen and fine glitter on the waves. Light is absorbed with depth, from clear turquoise shallows (where the sandy bed shows through) to deep blue; foam broken up by noise laps in and out along the shore, and caustics ripple over the bed of the nearest lake within about 75 m of the camera. Boats leave a V of foam streaks that spread sideways from the bow (the Kelvin wake angle, about 19.5°), churned foam behind the stern and rings when idling, and a splash-down from a jump or a landing throws out a set of expanding rings. Low graphics draw one wave layer, with no reflected clouds, sparkle or caustics. Enter water deeper than **0.9 m** to automatically transform the ATLAS into a boat over **2.4 seconds**: its body halves spread on planing hulls, each wheel slides out of its arch, turns flat and sinks into a hull well, a raked bow fairing extends under the bumper, and water jets deploy. W/S and A/D control thrust and steering. Shift slows the boat; jumping is unavailable while floating. Return to water shallower than **0.4 m** to reverse the animation and drive onto shore. R recovers onto dry ground. Water crossing does not count as jump airtime.
- **Flying.** Press **F** (or **FLY** on touch) from a car, a boat, or mid-jump. Over **1.6 seconds**, three-segment wings telescope out of the doors (7.5 m span), twin tail booms extend with fins and a stabilizer, and a folding propeller pushes out through the grille. The wheels stay down as landing gear. On the ground or water the propeller taxis to **108 km/h** and the ATLAS lifts off; a jumping car with its wings half out starts to glide. In the air the ATLAS is a physics-based plane. Each fixed step sums gravity, propeller thrust along the nose (only while **W** is held; **S** opens air brakes; hands off it glides and slowly loses speed), drag that grows with speed squared, a side force against sideslip, and **lift** at right angles to the airflow toward the plane's own "up", proportional to speed² and the wing's angle of attack. Past about **16°** the wing stalls and loses lift; pulls are limited to about 5 g; thin air above about 450 m weakens lift, thrust and control, so climbs top out near **650 m** (a zoom on built-up speed goes a little higher). Controls are body-axis rates, with the attitude kept as a quaternion so loops and rolls work: ↑/↓ (or Space/Shift, **CLIMB/DIVE** on touch) pitch, A/D, ←/→ or the touch slider roll, Q/E yaw. The tail's stability trims the nose to the angle at which lift balances weight on the current path (and, upright, in the current bank), so hands off it holds its flight path; a bank alone turns gently and pulling in a bank turns hard; upside down the same lift points at the ground, so the plane dives unless you push. Slow down too far and the trim angle passes the stall and the nose drops; power and speed recover it. Released controls leave the attitude alone: a dive stays a dive and a bank stays a bank (there is no wing levelling or automatic pull-up), and only the aerodynamics act. The one exception is right after taking off from the ground or water: hands off, it climbs out to about 35 m and levels, until the first pitch input. Holding W levels out near **340 km/h**. At flying speed (115 km/h or more) any contact with ground or water is a bounce or a skim, so it flies on with some speed lost, knocked back toward level and righted if it was rolled over. Touching down below that speed lands it, as the car on the ground or the boat on deep water, and the wings fold away. LAND (F again) folds the wings at any time, to glide in. Pressing F on the ground still taxis up to lift-off speed: a take-off run is not a landing. The wingtips, tail fins and propeller have their own ground contact: if any of them touches the ground or water, the flight ends. The wings fold and it falls the rest of the way as the car (or into the water as the boat), so nothing passes through the terrain. The wings also collide with scenery, whenever they are out (flying or taxiing): each wing, from root to tip at its current span, is tested against trees and cacti (by canopy, not just trunk), rocks and boulders at the height it is flying. Trees, cacti and rocks shatter on contact (boulders above 94 km/h) with the usual debris, falling sections and sound. The struck wing is dragged back, so the plane yaws toward that side, drops that wing and loses speed: harder for a strike near the tip than near the root, and much harder for a boulder. An unbroken boulder shoves the plane away. Press F again (**LAND**) to fold the wings and glide in: touching down on ground lands as a car, on deep water as a boat. Taking off from water retracts the boat hulls. Preview flight with `?seed=3&test=fly`.
- Cloud banks drift at 230–350 m. They fade near the camera, so you can fly through them, and into the fog at distance.
- Denser seeded pine clusters, shrubs, small rocks, boulders, roadside markers, cabins and lookout towers give the world more places to explore. Road and ramp approach clearances keep the extra scenery from blocking the route. Small rocks and shrubs are forgiving details; trees collide at the trunk. Cacti, trees and small rocks break above a direct impact speed of **65 km/h**; boulders require **94 km/h**. The car keeps most of its momentum while fragments scatter, bounce, and shrink away. The Blender trees retain their branch silhouettes and colors at contact, then separate into six authored solid sections with a 20 ms onset. Highway-speed hits separate the sections visibly within 80 ms, with independent tumbling and stronger scatter at higher speeds. Up to eight breaking trees share twelve instanced batches across the two variants; unused batches draw nothing. Broken props stay gone for this world visit, including after chunk reloads; a new world or page reload restores them. Small debris uses one instanced draw call and a 192-piece cap.
- Jumping uses a real impulse, gravity, buffered input and a short grace period after leaving a crest. Quick taps are queued before the next physics tick. Holding Jump does not bounce the car repeatedly.
- Fixed 120 Hz physics handles acceleration, hill climbing, drift, airborne motion, landing and collision sliding. Top speed on level asphalt is approximately **301 km/h**, with stronger braking and speed-sensitive steering. Recovery finds clear nearby ground without erasing trip or best-jump distance.
- Steeper rolling hills, gullies and closely spaced off-road ridges demand more care at speed. Roads retain smoother profiles.
- Orange ramps have curved decks, chevrons, flags and approach markers. Drive up one to launch automatically; Space is optional. The first ramp is about **70 m ahead, just right of the starting road**. More ramps regenerate throughout the world. Their dirt embankments use the same heightfield as the visible ground.
- Purple banked ramps twist progressively and launch left- or right-handed barrel rolls. The first is about **225 m ahead on the opposite side of the road from the first orange ramp**; more are seeded throughout the world. Drive through the lip at speed, or jump from the upper deck, to roll. Landing and recovery restore stable driving.
- Orange and purple triangles distinguish ordinary and rolling ramps on the minimap; pale squares mark camps and lookouts. The HUD points toward the nearest ramp and measures airtime and best jump distance.
- The original **ATLAS Expedition 4×4**, modeled in Blender, has copper bodywork, an ivory roof, open wheel arches, inset glazing, detailed all-terrain tires, roof luggage, a winch, skid plates and a rear spare. Its independent wheels steer and rotate; body suspension, headlights and brake lights follow gameplay.
- Trees, cacti and rocks use an original Blender scenery library: alpine and windswept pines, two ribbed branching cacti, granite and shale rock clusters, and granite and sandstone boulders. Vertex colors add foliage shading, bark, cactus ribs and thorns, and stone mineral variation. Each variant is one instanced mesh per chunk, with deterministic placement and the existing distance fade.
- The compact HUD, compass, terrain map and three camera views keep the road visible. Landmarks are placed as recognizable destinations instead of scattered solid obstacles.
- Eighty-one nearby 96 m chunks stream around the car, with reusable 384 m coarse terrain tiles extending the horizon beyond them. A third tier of 1,536 m horizon tiles (96 m grid) reaches about 5 km for the view from the air. Each tier cuts holes only where the tier inside it has loaded, so there are no gaps while tiles stream in, and far tiles blend to the horizon tiles' exact surface over 1,150–1,450 m, so the tiers meet without cracks. As the camera climbs, fog recedes from 350–1,450 m to 1,250–4,350 m and the camera's near plane moves out to keep depth precision. The fog colour is the sky's tone-mapped horizon colour, so distant terrain disappears into the sky instead of leaving a darker band on the skyline. Far tiles also carry instanced pine stand-ins at the real trees' seeded positions, which fade in exactly as the real trees fade out (skipped on Low graphics), and every lake and sea out to 4.6 km (beyond the furthest fog) is drawn as one worker-built water mesh, with depth sampled from the real bed so it matches the detailed patches that replace it within about 1 km. All water rides just above whichever terrain tier is drawn beneath it and turns opaque beyond about 300 m, where the terrain under it is a coarse, sand-coloured stand-in, so coarse distant terrain never buries a pond or shows through it, and nothing fills in on approach. Tiles ahead of a fast car or plane load first, far and horizon tiles interleave with near chunks, and flight physics never waits for scenery to stream. Terrain detail, color and lighting gradually blend into the same coarse horizon over 220–360 m, avoiding a visible swap at chunk boundaries. Trees and landmarks use instanced geometry and a gradual multisample coverage fade (with alpha blending when MSAA is unavailable) over 220–350 m; their bases follow the terrain transition. A module worker prepares terrain, props and an extra hidden ring before they are needed. Results are installed within a 4 ms per-frame budget (one chunk can exceed that budget on a slow device). Far tiles reuse vertex buffers and update only the indices around arriving fine chunks. Initial loads show progress; changing worlds cancels old jobs. Discarded resources are disposed. Bounded height and feature caches reuse terrain samples as the car crosses chunks.

## Files

- `index.html` / `style.css`: menus, HUD and touch controls.
- `game.mjs`: rendering, vehicle animation, streaming, audio and input.
- `vehicle-model.mjs`: loads the bundled Blender/glTF vehicle, validates its animation rig and lights, and supplies paint/glass reflections.
- `assets/vehicles/`: editable Blender source, optimized `.glb`, studio preview and mesh statistics.
- `scripts/build-car.py`: reproducible Blender modeling, studio rendering and game export.
- `scripts/build-amphibious.py`: builds the playable car from the original expedition source, with its reversible boat and plane transformations as two Blender NLA tracks.
- `lakes.mjs` / `water-data.mjs` / `water.mjs` / `amphibious-motion.mjs`: deterministic pond and inland-sea basins with irregular sea coasts, worker-generated water meshes (coarser grids for seas), bounded wake rendering, buoyancy and boat controls.
- `nature-models.mjs` / `assets/nature/`: bundled Blender scenery, variant selection and matching tree fragments.
- `scripts/build-nature.py` / `scripts/export_nature.py`: build the editable nature library or export manually edited models.
- `terrain.mjs` / `world-worker.mjs` / `streaming-layout.mjs`: reusable terrain data, background generation and seam-free near/far coverage.
- `vehicle-presentation.mjs`: interpolates fixed-step poses for smooth car, wheel, camera and shadow motion across display refresh rates.
- `grass-data.mjs` / `grass.mjs`: background placement and batched near-field plains grass, with density and range set live by the graphics level.
- `quality.mjs`: Low/Medium/High levels and the Auto frame-time controller.
- `flight-motion.mjs`: deterministic fixed-step taxi, take-off, banked flight, stall, ceiling and landing for the plane form.
- `clouds.mjs`: one instanced draw of seeded, camera-facing cloud puffs at flying height.
- `controls.mjs`: steering slider response curve and analog axes shared by the car and boat physics.
- `shadow-fade.mjs`: fades directional shadows inside the moving shadow-map boundary, preserving nearby contrast at every graphics level's map resolution.
- `camera-motion.mjs`: integrates camera position, aim and field of view against moving targets without changing follow lag when frame intervals change.
- `tree-breakage.mjs`: immediate speed-dependent fracture using authored Blender sections, plus a geometry-cutting path for legacy geometry fixtures.
- `break-audio.mjs`: precomputed wood, cactus and stone effects with capped simultaneous voices.
- `debris.mjs`: bounded instanced breakage particles with terrain bounce and cleanup.
- `profiling.mjs`: opt-in, bounded CPU timing measurements.
- `scenery.mjs`: ramp decks and the instanced cabin/lookout models.
- `world.mjs`: deterministic terrain, road layout, landmark and prop placement, and vehicle simulation. Physics samples the same triangles as the visible ground.

## Verification

```sh
npm ci
npx playwright install chromium
npm test
```

On macOS, browser tests render with the GPU through ANGLE Metal: about 1.2 minutes for the suite on an Apple M2. CI and other platforms use SwiftShader software rendering, which runs the game at about 4 fps. Test mode lets the simulation catch up by up to 0.5 s per frame (normally 0.1 s), so driving still runs in real time at that frame rate, in the same fixed 1/120 s physics steps. The SwiftShader suite takes about 4 minutes locally. `PW_RENDERER=swiftshader npm run test:browser` reproduces CI locally; `PW_RENDERER=metal` forces the GPU.

The tests cover terrain continuity, seeded regeneration, scenery clearances, challenging slopes, jump buffering and landing, 300 km/h highway top speed, automatic ramp launches across three seeds, landmark regeneration, acceleration/reverse, drift, collision escape, recovery, frame-rate independence and 24 simulated one-minute drives across eight directions and three seeds.

Vehicle checks also parse the actual exported GLB to verify meter scale, wheel origins, ground contact, lamp materials, self-contained resources and geometry budgets. Browser checks exercise the imported rig's steering, wheel spin and lights, and confirm that an asset-load failure shows an error instead of starting an invisible car.

## Blender car source

The game now loads **`assets/vehicles/atlas-amphibious.glb`**. Its editable source is **`atlas-amphibious.blend`**, with two NLA tracks: **`Transform_To_Boat`** (frames 1–121 at 50 fps) and **`Transform_To_Plane`** (frames 1–81). Mute one track in the NLA editor to scrub the other on its own. The original expedition source below is retained as the modeling base. Rebuild the amphibious source and export with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-amphibious.py
```

Each track exports as its own glTF clip, and the two never animate the same node, so the game can apply both at once. The clips move the same meshes in both directions. `WheelFold_*` owns each axle's folding motion; `Wheel_*` and `Spinner_*` remain independent steering and rolling pivots. The plane clip leaves `Propeller` unanimated so the game can spin it. Boat-only and plane-only parts start inside the body and are hidden while stowed, so car mode still draws at most 72 meshes. Animated groups are batched separately, about 63,000 triangles in all; exact counts are in `atlas-amphibious.json`. The GLB embeds its animation and materials with no external textures. Tests check intermediate poses, exact reversal, buoyancy, shore exits, water landings, and dry recovery. Use `?seed=3&test=water` for a repeatable drive into the lake, `?seed=3&test=boat` to preview the deployed hull, or `?seed=3&test=fly` to start in the air.

Open `assets/vehicles/atlas-expedition.blend` in Blender to edit the 803 named parts, material assignments and bevel modifiers. The studio camera and lights are included for rendering and excluded from the game export. All geometry is original to this project; no downloaded models or texture services are required.

To rebuild the source, preview and game asset with Blender installed:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-car.py
```

On another platform, substitute the path to your Blender executable. The build was verified with Blender 5.2. The playable export uses approximately 50,000 triangles in 26 material batches and is about 1.5 MB. The export reduces small bevels and redundant surface detail while the `.blend` retains the editable geometry. The build and the export below also write this base car's standalone `atlas-expedition.glb` and `.json`. The game loads only the amphibious export, so those two outputs are not kept in the repository.

After manually editing the source in Blender, export your changes without rebuilding the car:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background assets/vehicles/atlas-expedition.blend --python scripts/export_car.py
```

The glTF rig uses X right, Y up and Z forward. `Body` responds to suspension; `Wheel_FL`, `Wheel_RL`, `Wheel_FR` and `Wheel_RR` own the axle pivots, and each contains a separate `Spinner_*`. Wheel radius is 0.57 m, wheelbase 2.74 m and track 2.08 m, matching the existing presentation. The car loads alongside the world before **Start exploring** becomes available. Three.js's pinned GLTF loader and reflection environment are bundled locally; `npm run vendor` refreshes them from the locked dependency.

## Blender scenery source

Open `assets/nature/endless-nature.blend` for the eight editable models and the studio lineup. `endless-nature.glb` bundles their geometry and opaque vertex colors without textures or external downloads. Trees contain about 1,600 triangles each, cacti 970–1,170, rock clusters 258 and boulders 172; exact export statistics are in `assets/nature/endless-nature.json`. Standing trees combine their six sections into one draw per variant, while impacts reuse the same geometry and colors in a shared eight-tree pool.

```sh
# Rebuild all models and the studio preview.
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-nature.py

# Export saved manual edits without rebuilding the models.
/Applications/Blender.app/Contents/MacOS/Blender --background assets/nature/endless-nature.blend --python scripts/export_nature.py
```

Keep the eight named asset roots and their `fragment` assignments when editing. The game removes the studio layout offsets and places every model by its ground origin. Variants are selected from seeded prop positions, so reloads and chunk streaming preserve their appearance. Existing collision rules, terrain clearances, and destruction thresholds still apply. The start button waits for scenery to load and exposes an error if the asset is unavailable.

Scenery tests check dimensions, color-buffer ownership, deterministic variants, triangle budgets, and actual ray intersections before and after tree impacts. `tests/effects.html` previews either imported pine at contact, fracture and settle stages.

For live browser integration checks, open [tests/play.html](http://localhost:8000/tests/play.html). **Run driving check** exercises the actual keyboard handlers and HUD while accelerating, jumping, leaving the road, crossing chunk boundaries, reversing, recovering, pausing and resuming. **Run ramp check** starts on a repeatable approach and tests a launch and landing using throttle alone. Keep the page focused during each check (about 23 and 7 seconds respectively). Test runs use isolated in-memory records. The `?test=ramp` launch position is reserved for this harness; ordinary visits always start at the crossroads.

**Run geometry check** verifies that chunk clones keep independent ownership metadata and instance buffers, and that disposing one chunk cannot dispose another. Asset revision URLs prevent a previously cached module from being mixed into this release.

Sandlands form broad, smoothly blended low-elevation regions alongside grass and snow. They use instanced branching cacti, clear road and ramp approaches, and matching minimap colors. Preview a desert spawn with `?seed=100003`.

The GitHub Actions workflow runs unit tests plus headless Chromium tests on pushes and pull requests. Browser tests block external resources and exercise WebGL output, stationary-frame stability, worker loading, streamed driving, jumping, recovery, camera resets, rapid world changes, compact touch controls, visible scenery destruction, debris cleanup, and airborne barrel rolls. Failure traces and screenshots are saved under `output/playwright/`. `npm run test:unit` runs the simulation/geometry suite alone; an installed Chrome can be used locally with `PW_CHANNEL=chrome npm run test:browser`.

## Performance checks

For land-driving frame spikes, run `PROFILE_GPU=1 PW_CHANNEL=chrome node scripts/profile-frame-timing.mjs output/timing/drive.json` with the development server running. It drives the seed-3 road for 20 seconds and reports frame intervals, CPU percentiles, streaming work and the actual graphics renderer. See [performance measurements](docs/performance.md) for the before/after comparison and Retina, water-entry and saved-revision options. Nearby lakes build in the worker even when driving on land, and distant terrain indices update only when their fine-chunk coverage changes.

Run `PROFILE_GPU=1 PW_CHANNEL=chrome node scripts/audit-frame-alignment.mjs` to check car/world synchronization over road, desert-turn and water drives. It inspects transforms immediately after each real render, raycasts the terrain under the car, and checks camera matrices, the terrain detail center, water time, interpolation delay and chunk coverage. The probe is injected into the test response only; it does not change the served game. Results go to `output/timing/frame-alignment.json`. These are alignment checks, not an FPS benchmark.

Run `npm run dev` in one terminal, then `npm run profile` in another (`PW_CHANNEL=chrome npm run profile` also works). The repeatable headless run uses seed 1, a 1280×720 viewport and software rendering. It reports CPU timings for worker generation, chunk installation, rendering submission and the minimap, plus draw counts and scene sizes. Software-renderer FPS is not representative of normal GPU gameplay. `?test=browser` exposes the same read-only diagnostic snapshot and isolates saved records; normal play does not collect profiling samples.

Recovery caches each chunk once per search. The minimap reuses its elevation when choosing the biome and updates less frequently on touch devices. Camera recovery/reset snaps both position and target, and world changes reset physics timing before resuming.

To update the pinned graphics dependency deliberately, run `npm run vendor` and commit the vendor files along with the lockfile. Hosting remains static: Cloudflare Pages can continue serving the repository root without a build step.

Stunt test approaches are available at `?seed=1&test=twist` and `?seed=1&test=smash`; these isolate trip records just like the other browser harness modes.

The rendered car interpolates the two latest physics poses (at most one 120 Hz tick of visual delay). Camera tracking, wheel rotation and shadows use that same pose. Camera position, aim and field of view integrate the target trajectory over each frame; endpoint-only smoothing changed follow distance when the display changed refresh rates. Tests cover 30–240 Hz camera tracking, abrupt 120→30→90 Hz transitions, uneven frame intervals, barrel-roll angle wrapping and teleport resets. These timing tests do not measure physical phone GPU or display performance.

When both physics poses are grounded and the car is fully in driving form, presentation samples terrain support at the interpolated position and preserves clearance above it. This removes the small height error from drawing a straight line between ticks across terrain creases. Launch, landing, airborne and transformation intervals keep their existing interpolation; simulation and collision state remain independent of display refresh rate.

Ramp backs and sides obey normal ballistic separation, so oblique and reverse approaches carry upward momentum into the air instead of sticking to the deck. The ground can push the car up but never pull it down: from the moment a surface falls away faster than gravity, a ballistic "shadow" follows the car's own momentum, and once that path clears the surface by 2.5 cm (5 cm just after a touchdown, so landings don't bounce) the car leaves with its full climbing speed. Rounded crests and embankment tops therefore launch like sharp edges, even when the car touched down on the rising slope a moment earlier, while ordinary road bumps never add up to a lift-off. Tests compare five rear/side directions against identical unmarked terrain, check oblique front approaches and slow traversal.

Breaking sounds share the engine’s sound toggle (M or the speaker button); muting silences all game audio. Highway power rises smoothly near the road, with level-road cruising around 301 km/h, off-road cruising around 236 km/h, and a downhill cap of 331 km/h. Preview tree impacts with `?seed=77&test=tree-smash`.

`tests/effects.html` provides a fixed-camera tree breakup preview at highway impact speed with contact, 80 ms fracture, 160 ms split and settle stages for visual regression checks.

Sun shadows fade across the outer 19 m of their moving 96 m map instead of appearing abruptly at its edge. The fade uses light-space coordinates, so it follows all sides of the shadow volume and applies equally to terrain and objects. Rendered-pixel regression tests compare the old hard cutoff with the new transition on all four edges at 1024 and 2048 shadow-map resolutions.

Plains have seeded patches of low grass. Placement reuses terrain triangles in the generation worker and avoids sand, snow, steep slopes, roads and reserved ramp/landmark areas. Three opaque triangles form each tuft; there are no grass colliders, transparent layers or shadow-casting blades. High grass fades from 38–78 m; Medium uses half the density and a 22–48 m fade, and Low 30% within 36 m. At most nine High or four Medium chunk batches are eligible to draw, capped at 43,200 or 9,600 grass triangles before view culling. Chunk buffers are independently owned and disposed during streaming. Preview meadow grass with `?seed=3`.

Run `PW_CHANNEL=chrome node scripts/profile-grass.mjs` for a same-scene grass-on/off render-cost comparison (requires the development server). The seed-3 meadow measured +4 draw calls and +10,326 triangles at 960×600 on desktop, and +4 calls / +5,160 triangles at 390×844 with touch emulation. This isolates geometry/render cost; software-renderer timing and touch emulation do not measure real phone FPS.
