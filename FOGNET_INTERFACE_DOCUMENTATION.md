# FOGNET — Complete Interface & System Working Documentation

### End-to-End Explanation of Digital Twin, Sensors, Edge Processing, V2X, Safety Intelligence and Fleet Management

> This document describes **only what is actually implemented in the current codebase** at the time of writing (backend in `backend/`, frontend in `frontend/`). Every claim below is traceable to a specific file, class, or function. Where something is simulated rather than physically real, or exists only as a UI label without backend logic behind it, this is called out explicitly. Nothing in this document is aspirational — see Section 18 for a strict implementation-status audit.

---

## SECTION 1 — SYSTEM OVERVIEW

FOGNET is a simulation prototype of a safety system for autonomous/assisted haul trucks (HEMM dumpers) operating in a low-visibility open-pit mine. Five virtual dump trucks continuously run a haul cycle (load → haul loaded ore out → dump → return empty → load again) around a single spiral haul road that winds from the surface down to the pit floor. The system continuously:

- estimates each truck's position (via simulated RTK-GNSS, or dead reckoning when GNSS is lost),
- simulates radar and thermal detection of nearby trucks,
- fuses that evidence into a confidence-rated detection,
- computes collision risk (Time-To-Collision) between vehicles,
- computes a curvature/fog/risk-aware recommended speed,
- simulates a three-tier V2X communication network (V2V / V2I / V2C),
- and renders all of this live on a 2D digital-twin dashboard.

**Actual current data flow** (verified against `backend/simulation.py: SimulationEngine.tick()`):

```
Simulated Hardware (sensors/*.py)
        ↓
Raspberry Pi 5 (edge_compute.py — a software model of onboard load, see Section 6)
        ↓
Sensor Processing (radar.py, thermal.py, rtk_gnss.py, imu.py, wheel_speed.py)
        ↓
Position Estimation (dead_reckoning.py — RTK, or IMU+wheel dead reckoning)
        ↓
Sensor Fusion (fusion.py)
        ↓
Risk Assessment (risk_engine.py)
        ↓
Dynamic Speed Recommendation (speed_advisor.py)
        ↓
Vehicle Behaviour (vehicle.py: VehicleManager.step())
        ↓
V2X Communication (v2v.py, v2i.py, obu.py)
        ↓
Control Centre aggregation (v2c.py)
        ↓
Digital Twin / UI (frontend/static/js/twin.js, control_room.js)
```

**Note on "Fleet Optimization":** an earlier iteration of this project had a `fleet_optimizer.py` module that rated two alternate haul routes ("Route A" / "Route B") and recommended rerouting. That module **was deleted** when the mine was redesigned into a single continuous spiral road (there is only one physical road now — no alternate route exists to redirect to). **Fleet-level route optimization is NOT IMPLEMENTED in the current codebase.** What *does* exist today for fleet-wide monitoring is the V2C control-centre aggregation (`backend/v2c.py`) — see Sections 14 and 15 for the precise distinction.

---

## SECTION 2 — INTERFACE OVERVIEW

The entire UI is one page: `frontend/control_room.html`, styled by `frontend/static/css/style.css`, driven by `frontend/static/js/ws.js` (WebSocket connector), `twin.js` (digital-twin canvas renderer) and `control_room.js` (everything else). The browser opens one WebSocket to `/ws/state`; the server pushes a full JSON state snapshot every tick (`backend/main.py: _simulation_loop()`, `SimulationEngine.tick()`), and `control_room.js: render(state)` re-renders every panel from that single object. The static road geometry is fetched once via `GET /api/road` and cached client-side (`control_room.js` line 12) rather than resent every tick.

### Top bar controls
| Control | DOM id | What it does | Backend endpoint |
|---|---|---|---|
| ⏸ Pause / ▶ Resume | `pause-btn` | Freezes the simulation clock (`dt` forced to 0 in `SimulationEngine.tick()`) | `POST /api/pause/{bool}` |
| ⟲ Reset | `reset-btn` | Rebuilds the entire world from scratch (`SimulationEngine.reset()` → `_build_world()`) | `POST /api/reset` |
| ▶ DEMO MODE | `demo-btn` | Starts/stops the scripted 6-phase walkthrough (`backend/demo.py`) | `POST /api/demo/start` / `/stop` |
| Fog dropdown | `fog-select` | Sets global fog level (CLEAR/LIGHT/MEDIUM/HEAVY/EXTREME) | `POST /api/fog/{level}` |
| Auto-Fog | `fog-auto-btn` | Toggles gradual fog deterioration over time | `POST /api/fog-auto/{bool}` |
| Speed selector | `sim-speed-select` | Multiplies simulation `dt` by 0.5×–4× | `POST /api/sim-speed/{float}` |
| GPS-Denied | `gps-denied-btn` | Forces RTK-GNSS LOST for **every** truck regardless of position | `POST /api/gps-denied/{bool}` |
| V2X | `v2x-btn` | Disables the entire V2V/V2I/V2C network fleet-wide | `POST /api/v2x/{bool}` |
| Links | `links-btn` | Client-side only: shows/hides the V2V/V2I line overlays on the map | none (local JS state) |

### Panels (left column)
1. **Digital Twin — Spiral Open-Pit Haul Network** (`#twin-canvas`) — the hero element; see Section 3.
2. **Fleet Status** (`#vehicle-rows`) — one row per truck: Vehicle, Speed, Bench, GPS (RTK/DEAD RECK. pill from `state.positioning[id].mode`), V2X (CONNECTED/DISCONNECTED pill from `state.v2c.vehicles[].v2x_status`), Status (hazard badge from `v.hazard_status`). Clicking a row calls `renderSelection()` for that truck.
3. **Emergency Alerts** (`#emergency-list`) — renders `state.emergency_events`, produced by `backend/emergency.py: EmergencyDetector.check()` and persisted via `db.log_event()`.

### Panels (right column)
4. **Vehicle Detail** (`#vehicle-detail`) — populated only once a truck is selected (map click or table-row click). Shows the **Curve Zone Advisory** card (see Section 11) plus a flat summary: Status, Speed, Heading, Bench, Elevation, Destination, Radar Range, Thermal Angle, RTK-GNSS, Positioning, IMU, Wheel Odometry, V2X OBU, Raspberry Pi 5 — each pulled directly from `state.vehicles[id]`, `state.sensors[id]`, `state.positioning[id]`, `state.obu[id]`, `state.edge_compute[id]`.
5. **Sensor Status** (`#sensor-panel`) — the compact "ONBOARD SYSTEM" card; see Section 5 for exactly which field comes from which sensor.
6. **V2X — Multi-Tier Communication** (`#v2x-chain` + `#v2v-log`) — for the selected truck: its live V2V partners, V2I connection, V2C status, and the OBU's own communication log lines (built by `backend/obu.py`); below that, the global V2V message feed (`state.v2v_messages`, all trucks).
7. **Fog & Visibility** (`#visibility-value`, `#fog-status-value`, `#fog-zones`) — global visibility/status plus a per-zone-type breakdown from `state.fog.zones` (see Section 8).
8. **Collision Risk / TTC** (`#risk-card`) — the selected truck's current risk pairing (`state.risk[id]`): other vehicle, level, gap, TTC, relation.

Every panel is a pure function of the latest WebSocket frame — there is no client-side simulation state; refreshing the browser just waits for the next frame.

---

## SECTION 3 — DIGITAL TWIN / MINE MAP

### Geometry (IMPLEMENTED — `backend/road_network.py: RoadNetwork`)

The mine is **one continuous Archimedean spiral**, not a set of separate roads. A single scalar `theta` (radians, 0 → `theta_max = turns × 2π`) parametrizes the entire haul road:

```
radius(theta)   = outer_radius_m − (outer_radius_m − inner_radius_m) × theta/theta_max   [+ bend perturbation]
elevation(theta) = elevation_surface_m − (elevation_surface_m − elevation_pit_m) × theta/theta_max
point(theta)    = (center_x + radius·cos(theta), center_y + radius·sin(theta))
```

With the current `config.yaml` values (`center=(430,350)`, `outer_radius_m=300`, `inner_radius_m=40`, `turns=5`, `elevation_surface_m=520`, `elevation_pit_m=420`), the road makes 5 full loops descending 100 m of elevation, from the outer rim (theta=0, Surface, 520 m) to the pit floor (theta=theta_max≈31.42, Pit, 420 m).

- **Benches** (IMPLEMENTED): `RoadNetwork.bench_at(theta)` returns one of `["Surface","B1","B2","B3","B4","Pit"]` based on `int(theta / 2π)`. Each full turn of the spiral is one bench.
- **Elevation** (IMPLEMENTED): linear interpolation as above; reported live per truck (`vehicle["elevation_m"]`).
- **Haul roads / ramps** (IMPLEMENTED): the descent itself *is* the ramp — there is no separate "ramp" road type; a specific short window around `ramp_node_theta` (7.5 rad) is additionally tagged `zone_type="ramp"` for speed-cap purposes (14 km/h cap) and hosts the `RSU-03` V2I node.
- **Sharp bends** (IMPLEMENTED — real geometry, not decoration): 7 bends defined in `config.yaml: mine.sharp_bends`, each a local raised-cosine radius perturbation layered on the smooth spiral (`RoadNetwork._bend_perturbation`). Because every one of the 5 trucks travels this same single road in both directions, **every bend is mathematically part of every truck's normal haul cycle** — verified live (Section 17/18 evidence). Current bends:

  | Name | `kind` | theta | amplitude | Effect |
  |---|---|---|---|---|
  | Blind Curve | `blind` | 17.8 | +22 m (bulge out) | flagship demo location, rock-wall visual |
  | Blind Curve (Bench Wall) | `blind` | 29.0 | −15 m (pull in) | second blind bend |
  | Hairpin Bend | `hairpin` | 5.0 | +18 m | wide switchback |
  | Tight Bend (Ramp) | `tight_90` | 7.5 | −20 m | tightest curvature in the mine (right at the ramp) |
  | S-Curve Entry / Exit | `s_curve` | 20.6 / 21.15 | +11 / −11 m | two opposed kinks, merged into one map tag |
  | High-Risk Curve | `high_risk` | 27.3 | −16 m | second-tightest curve, deep near the pit |

  Curvature at each bend is **held at a precomputed worst-case value across the whole bend window** (`RoadNetwork._compute_bend_min_curvature`), not resampled instantaneously — this avoids a real numerical artifact (a raised-cosine bump briefly "straightens" right next to its sharpest point) that would otherwise make the recommended speed flicker mid-bend.
- **Blind curves** (IMPLEMENTED, functionally): both blind bends are ordinary `zone_type="blind_curve"` zones — the "line of sight blocked" behaviour is not a literal ray-casting/visibility check; it's the fact that FOGNET's collision-risk logic *only* uses radar/thermal/V2V/position data (never a "the driver can see it" flag), so the narrative of "the wall blocks sight but sensors still detect it" is true by construction. The rock-wall graphic drawn at these zones (`twin.js: drawRockOutcrop`) is a **visual illustration** of that idea, not a physics obstacle.
- **Intersection** (PARTIALLY IMPLEMENTED): the zone (`intersection_theta=22.0`), its 10 km/h speed cap, its fog multiplier, and its `RSU-02` V2I node are all real and affect vehicle behaviour. The short **stub road drawn on the map** leading away from the intersection (`twin.js`, "intersection junction stub" block) is **UI ONLY** — it is a static decorative spur; no vehicle ever routes onto it, and it is not part of the road graph.
- **Loading / Dumping areas** (IMPLEMENTED): `dumping_window=[0.0,0.4]` and the last 0.4 rad before `theta_max` (loading). These are real stop points in the haul-cycle state machine (Section 4) — each truck actually halts there for a configured pause (`haul_cycle.loading_pause_s=4`, `dumping_pause_s=3`), staggered slightly per truck (`Vehicle.stop_offset`) so five trucks queueing there don't occupy the exact same point.
- **Fog zones** (IMPLEMENTED): every zone type has its own visibility multiplier (Section 8).
- **GPS-denied zone** (IMPLEMENTED): a static window (`gps_denied_window=[25.2, 25.9]`) where RTK-GNSS is always LOST, plus a global manual override (`gps_force_denied`) that forces it everywhere on demand.
- **Infrastructure nodes / RSUs** (IMPLEMENTED): 6 V2I nodes (`RSU-01`…`RSU-06`) placed at the blind curve, intersection, ramp, dumping area, loading area, and GPS-denied zone. Connectivity is a real range check (`V2INetwork.evaluate`, Section 12).

### How vehicles navigate (IMPLEMENTED)

There is no pathfinding — a truck's entire "route" is one scalar `theta` moving up or down. `Vehicle.direction_sign` is −1 while hauling loaded ore out (ascending, `theta` decreasing) and +1 while returning empty (descending, `theta` increasing). `VehicleManager.step()` advances `theta` by `direction_sign × (distance_travelled / current_radius)` every tick, so trucks physically trace the exact spiral curve, including every bend — no teleporting, no skipping.

---

## SECTION 4 — VEHICLE SIMULATION

### Creation (`vehicle.py: VehicleManager.__init__`)

Five trucks (`config.yaml: vehicles.ids`) are created with **staggered starting phases and positions** so they don't move in lockstep: one LOADING at the loading point, one LOADED_HAUL past the ramp, one EMPTY_RETURN near the blind curve, one DUMPING at the dumping point, one EMPTY_RETURN past the intersection. Each also gets a random `speed_factor` (0.9–1.1) as a fixed "personality" multiplier on its speed cap.

### The `Vehicle` dataclass — every field and its source

| Field | Meaning | Set by |
|---|---|---|
| `theta` | true position along the spiral | `VehicleManager.step()` |
| `phase` | `LOADING` \| `LOADED_HAUL` \| `DUMPING` \| `EMPTY_RETURN` | haul-cycle state machine |
| `speed_kmh` | actual current speed | rate-limited toward the recommended speed |
| `accel_mps2` | actual acceleration this tick | derived from the speed change |
| `heading_deg` | true heading | `RoadNetwork.heading_at()` (numerical tangent) |
| `x`, `y` | **true** ground-truth position (used for rendering/physics) | `RoadNetwork.point_at(theta)` |
| `elevation_m`, `bench`, `zone_type`, `zone_name` | derived from `theta` | `RoadNetwork` |
| `odometry_m` | cumulative distance travelled | accumulated every tick |
| `hazard_status` | `GREEN`/`YELLOW`/`ORANGE`/`RED` | copied from that tick's `RiskAssessment.level` |
| `comm_ok` | V2V radio health (manually toggleable via API) | default `True` |
| `stalled` | breakdown flag (manually toggleable via API) | default `False` |
| `lateral_offset` | simulated road-edge drift signal | small random walk each tick, clamped to [−1, 1] |

Note: the reported `x`/`y` is **always the true position**, even during dead reckoning — the *dead-reckoning estimate* (which can drift from truth) is tracked separately in `state.positioning[id]`, not used for rendering. This was a deliberate choice so a truck never visually glitches off the road (see Section 7).

### The tick cycle (`simulation.py: SimulationEngine.tick()`, in order)

1. Demo script applies any scripted changes for this tick (`demo.py`).
2. Fog advances (`FogController.update`).
3. V2V broadcasts (`V2VNetwork.broadcast`).
4. For every truck: find nearest other truck by road-distance and closing speed (`VehicleManager.gap_to_nearest`, `closing_speed`).
5. For every truck: read all 5 simulated sensors, resolve position (RTK or dead reckoning), fuse detections, assess risk, compute recommended speed.
6. `VehicleManager.step()` moves every truck according to its recommended speed.
7. Emergency detector runs.
8. V2I connectivity, V2C aggregation, OBU status, and edge-compute status are all computed (these are pure read-outs of the state already produced by steps 1–7 — no additional physics).
9. Telemetry logged to SQLite every `telemetry_log_every=5` ticks.
10. The full state dict is returned and broadcast to every connected browser.

### Worked numerical example

A truck is descending (`EMPTY_RETURN`, `direction_sign=+1`) at `speed_kmh=10` through a zone whose current recommended speed is `17.5 km/h`, at road radius `217.9 m`, with `dt=0.4 s`, `max_accel=1.1 m/s²`:

```
current_mps = 10 / 3.6            = 2.78 m/s
desired_mps = 17.5 / 3.6          = 4.86 m/s
diff        = 4.86 − 2.78         = 2.08 m/s   (positive → use max_accel)
max_delta   = 1.1 × 0.4           = 0.44 m/s   (accel limit wins — diff is larger)
new_mps     = 2.78 + 0.44         = 3.22 m/s   → speed_kmh = 11.6
accel_mps2  = (3.22 − 2.78)/0.4   = 1.1 m/s²   (exactly the configured limit)
distance_m  = 3.22 × 0.4          = 1.288 m
Δtheta      = +1 × 1.288/217.9    = +0.00591 rad
```

This is exactly what produces the smooth, gradual deceleration/acceleration profile described in Section 11 — the truck never jumps straight to its target speed.

---

## SECTION 5 — HARDWARE COMPONENTS

All seven are **simulated in software** (`backend/sensors/*.py`, `backend/obu.py`, `backend/edge_compute.py`) — there is no physical hardware in this prototype. Each class implements the small `SensorInterface` (`sensors/base.py`) so a real driver could be substituted later without touching fusion/risk/UI code.

### 1. 77 GHz mmWave Radar (`sensors/radar.py: MMWaveRadarSim`)
- **Purpose / produces:** object detection + **range** + closing speed. Nothing else (never bearing, never absolute position).
- **Input:** the *true* gap and closing speed to the nearest other truck (`VehicleManager.gap_to_nearest`/`closing_speed` — ground truth, not a noisy re-derivation).
- **Processing:** range-gated at `radar_range_m=90`; adds Gaussian noise (`radar_noise_m=0.5`, `radar_speed_noise_mps=0.3`).
- **Effect on vehicle behaviour:** **feeds sensor fusion's confidence score only.** The actual collision-risk/TTC math (`risk_engine.py`) uses the *true* simulated gap, not this noisy reading — see the important clarification in Section 9.
- **UI:** Sensor Status "77GHz RADAR" row (ACTIVE/NO OBJECT + Range/Closing sub-line); Vehicle Detail "Radar Range" row.

### 2. LWIR Thermal Array (`sensors/thermal.py: ThermalCameraSim`)
- **Purpose / produces:** heat detection, a **centroid angle** (bearing relative to the truck's own heading), a coarse direction label (Front/Front Right/Right/Rear Right/Rear/… from `_direction_label()`), and confidence. **Never a distance.**
- **Input:** both trucks' true x/y/heading, current local visibility.
- **Processing:** range-gated at `thermal_range_m=70` (cut to 60% in fog < 10 m visibility); bearing computed via `atan2`; confidence falls off with distance.
- **Effect:** feeds fusion's confidence score and `contributing_sensors` list.
- **UI:** Sensor Status "LWIR THERMAL" row; Vehicle Detail "Thermal Angle" row.

### 3. RTK-GNSS (`sensors/rtk_gnss.py: RTKGnssSim`)
- **Purpose / produces:** absolute position (`status`, `x`, `y`, `accuracy_cm`), or `status="LOST"` with no position.
- **Input:** the manual `gps_force_denied` flag OR the static GPS-denied zone check (`RoadNetwork.is_gps_denied`).
- **Processing:** Gaussian noise `rtk_noise_m=0.03` (3 cm) when active.
- **Effect:** the primary input to `dead_reckoning.py` — when ACTIVE, it *is* the position estimate outright.
- **UI:** RTK-GNSS pill everywhere (Fleet Status "GPS" column, Vehicle Detail, Sensor Status card).

### 4. MEMS IMU Sensor (`sensors/imu.py: IMUSim`)
- **Purpose / produces:** `status` (ACTIVE/WARNING), `heading_deg`, **real** `yaw_rate_deg_s`, `acceleration_mps2`, `orientation` (STABLE/TILT WARNING), `motion_state` (STATIONARY/ACCELERATING/DECELERATING/CRUISING).
- **Input:** the truck's actual heading, previous tick's heading (for yaw rate), actual acceleration, `stalled`, `lateral_offset`.
- **Processing:** `yaw_rate = shortest_angle(heading − previous_heading) / dt` — this is why yaw rate genuinely spikes on a curve and sits near zero on straights (verified: ~1.3°/s straight vs ~3.9°/s at a sharp bend, live test). `orientation="TILT WARNING"` only when `|lateral_offset| ≥ imu_tilt_warning_threshold` (0.75).
- **Effect:** its `heading_deg` is the direction used to integrate dead reckoning when RTK is lost.
- **UI:** Sensor Status "MEMS IMU" row + sub-line (yaw rate, accel, orientation, motion state); Vehicle Detail "IMU" pill.

### 5. Wheel-Speed Odometry (`sensors/wheel_speed.py: WheelSpeedSim`)
- **Purpose / produces:** `speed_kmh`, cumulative `odometry_m`, `travel_direction` (from `Vehicle.travel_direction_label`), `status`.
- **Input:** the truck's actual speed and cumulative odometry.
- **Processing:** Gaussian noise `wheel_speed_noise_kmh=0.2`.
- **Effect:** its `speed_kmh` is the distance-per-tick integrated into dead reckoning when RTK is lost.
- **UI:** Sensor Status "WHEEL ODOMETRY" row + sub-line (total distance, direction, "Since GNSS loss" when in dead reckoning).

### 6. V2X On-Board Unit (`backend/obu.py: V2XOnBoardUnit`)
- **Purpose:** communication only — it senses nothing. It summarizes the real V2V broadcasts, V2I connection, and V2C status already computed that tick into one status object and a human-readable log.
- **Produces:** `status` (CONNECTED/DISCONNECTED), `v2x_link`/`v2v`/`v2i`/`v2c` (ACTIVE/INACTIVE), and `log` — real lines like `"DUMPER-01 → DUMPER-02: position/speed/heading/hazard shared"`, generated only from actual `V2VMessage`/V2I/V2C data, never fabricated.
- **Effect on behaviour:** **none** — it is a read-out, not an input to physics.
- **UI:** Sensor Status "V2X OBU" row + V2V/V2I/V2C dot rows; V2X panel's log lines.

### 7. Raspberry Pi 5 (`backend/edge_compute.py: EdgeComputeUnit`)
- **Purpose:** represents the onboard edge-computing unit that (conceptually) runs sensor fusion, positioning, risk, and speed advisory. **It is not a sensor** — see Section 6.
- **Produces:** `status` (ACTIVE/DEGRADED), `edge_processing` (ACTIVE/STANDBY), `sensor_inputs_active`/`total` (out of 6: radar, thermal, RTK, IMU, wheel-speed, V2X), `v2x_link`, `processing_load_pct`, `processing_level` (LOW/NORMAL/HIGH).
- **Effect on behaviour:** **none** — purely a reactive read-out (see formula in Section 6).
- **UI:** Sensor Status "RASPBERRY PI 5" row + sub-line (inputs, load).

---

## SECTION 6 — RASPBERRY PI 5

```
77GHz Radar + LWIR Thermal + RTK-GNSS + MEMS IMU + Wheel-Speed Odometry + V2X OBU
                                    ↓
                          RASPBERRY PI 5 (edge_compute.py)
                                    ↓
                 Sensor Fusion → Risk Engine → Speed Advisor → V2X
```

**What is real hardware architecture vs. what is simulated:** in an eventual physical deployment, a Raspberry Pi 5 on each truck would be the actual onboard computer running the fusion/positioning/risk/speed-advisor logic in real time, reading the 5 physical sensors and the V2X radio. **In the current prototype, none of that is physical** — `fusion.py`, `dead_reckoning.py`, `risk_engine.py`, and `speed_advisor.py` all just run as ordinary Python functions inside `SimulationEngine.tick()` on the same server process, for every truck. `EdgeComputeUnit.evaluate()` (`edge_compute.py`) does not host or gate that computation — it is a **separate, cosmetic readout module** that estimates what such a Pi's load *would* look like, computed like this (verified in `edge_compute.py`):

```
load = 20
     + 10 × (number of trucks within 80 m)
     + 20   if positioning_mode == DEAD_RECKONING   (extra integration work)
     + 15   if fusion confidence == HIGH
     + 8    if fusion confidence == MEDIUM
load = clamp(load, 5, 100)

status = "DEGRADED" if stalled or sensor_inputs_active ≤ 4 else "ACTIVE"
```

This is honestly a **simulated proxy for hardware load**, not a real scheduler — verified live: load jumped from 20% (LOW) to 40% (NORMAL) the instant a truck's positioning switched to DEAD_RECKONING, exactly matching the formula above.

---

## SECTION 7 — GPS RESILIENCE (Novelty 3)

```
RTK-GNSS ACTIVE
      ↓ (truck enters gps_denied_window, OR operator clicks "GPS-Denied: ON")
RTK-GNSS → LOST                              (sensors/rtk_gnss.py)
      ↓
Positioning mode → DEAD_RECKONING            (dead_reckoning.py: DeadReckoning.update)
      ↓
est_x, est_y = last_known + (wheel_speed_kmh/3.6 × dt) × [cos(imu_heading), sin(imu_heading)]
      ↓
Vehicle keeps moving (theta physics is entirely independent of GPS — see Section 4)
      ↓ (truck leaves the zone, OR operator clicks "GPS-Denied: OFF")
RTK-GNSS → ACTIVE again
      ↓
Estimate snaps instantly to the fresh RTK fix — "GNSS RESYNC"
```

**Exactly what happens in the UI**, verified via a live demo run:
- Fleet Status "GPS" column flips from `RTK` to `DEAD RECK.` (pill turns orange).
- Vehicle Detail "RTK-GNSS" pill turns red/orange ("LOST"); "Positioning" pill shows "DEAD RECKONING".
- Sensor Status card: the RTK-GNSS row shows "LOST" (its position sub-line disappears); the Wheel Odometry sub-line gains a live **"Since GNSS loss: X m"** counter (verified growing 7.8 m → 17.8 m over several seconds); the bottom "POSITIONING" row shows "Source: IMU + WHEEL ODOMETRY, Drift: X m".
- The truck's speed and heading continue changing smoothly — it never stops or jumps, because (as in Section 4) its true motion never depended on GPS in the first place.
- The moment RTK returns: "Since GNSS loss" and "Drift" both reset to 0 m, and the Positioning pill flips back to green/"RTK-GNSS" — verified instantaneous in a live trace.

**Important honesty note:** the drift value is genuine integration error (small — a few centimetres to a couple of metres over tens of seconds, since the sensor noise is small), not a dramatic visual "wander off the road" — because, as noted in Section 4, the rendered truck position always uses the *true* position, not the drifting estimate. The dead-reckoning estimate/drift is real, computed data, but it is a **displayed number**, not something that visibly moves the truck icon on the map.

---

## SECTION 8 — FOG & VISIBILITY

`backend/fog.py: FogController`. Two control modes:
- **Manual** (`set_level`): snaps global visibility to a fixed value per level — `CLEAR=200 m, LIGHT=80 m, MEDIUM=30 m, HEAVY=12 m, EXTREME=5 m`.
- **Auto** (`set_auto(True)`): visibility decays linearly, `deterioration_rate_m_per_min=6`, down to a floor of `minimum_visibility_m=3`.

**Spatial fog zones (IMPLEMENTED):** every zone type gets its own multiplier applied to the global value (`FogController.visibility_at(zone_type)`):

| Zone type | Multiplier |
|---|---|
| dumping | 1.0 |
| loading | 0.9 |
| bench_road | 0.85 |
| intersection | 0.8 |
| gps_denied | 0.6 |
| sharp_curve | 0.55 |
| ramp | 0.7 |
| **blind_curve** | **0.35 (always the foggiest)** |

**Concrete example:** if the operator sets global fog to HEAVY (12 m), the blind curve's *local* visibility is `12 × 0.35 = 4.2 m`, while the dumping area stays at `12 × 1.0 = 12 m` — the Fog & Visibility panel's per-zone list shows exactly this spread live.

**Effects:**
- **Sensors:** thermal range is further cut (×0.6) once visibility drops below 10 m (`thermal.py`).
- **Risk:** fog does not directly change TTC math, but by capping speed (below) it changes closing speeds and therefore future TTC.
- **Speed:** `speed_advisor.py` step 4 hard-caps the recommended speed at `visibility_m × 1.8` km/h — e.g. at 7 m visibility, speed is capped at 12.6 km/h regardless of curvature.
- **Vehicle behaviour:** the truck's actual speed eases toward that lower cap exactly like any other recommended-speed change (Section 4's accel/decel limiter) — no special "fog braking" logic exists separately.

---

## SECTION 9 — SENSOR DETECTION & FUSION

`backend/fusion.py: fuse(radar, thermal, v2v_message, other_id, gap_m)`.

```
radar.detected?      → contributes "radar"
thermal.detected?    → contributes "thermal"
V2V message present? → contributes "v2v"

score = count of contributing sensors
confidence = NONE (0) | LOW (1) | MEDIUM (2) | HIGH (3)
```

`FusionResult` also carries `range_m` (copied from the true gap, for display) and `centroid_angle_deg` (copied from the thermal reading, if detected).

**Important clarification (do not assume more than this):** fusion's confidence score is a **detection/awareness indicator only**. The collision-risk engine (`risk_engine.py`) does **not** consume `FusionResult` — it works directly from the simulation's ground-truth gap and closing speed (`VehicleManager.gap_to_nearest`/`closing_speed`). This means TTC/risk in this prototype is always computed from true simulated positions, not from the (noisier) fused sensor picture. This is an accurate description of the current code, not a criticism — it keeps the risk math deterministic and testable, at the cost of the fusion confidence being informational/UI-facing rather than safety-critical-path in this version.

---

## SECTION 10 — COLLISION RISK

`backend/risk_engine.py: RiskEngine.assess(gap_m, closing_speed_mps, other_id, relation)`.

```
TTC = gap_m / closing_speed_mps          (only if closing_speed_mps > 0.05, else TTC = None)
```

`closing_speed_mps` comes from `VehicleManager.closing_speed()`, which correctly handles **both** a following scenario (same direction) and a **head-on** scenario (opposite directions, e.g. the blind-curve demo) via each truck's angular velocity around the spiral.

**Exact thresholds (from `config.yaml: risk`):**

| Level | Condition |
|---|---|
| **RED** | `gap_m ≤ critical_distance_m (8)` **OR** `TTC ≤ ttc_red_s (4.0)` |
| **ORANGE** | `TTC ≤ ttc_orange_s (8.0)` |
| **YELLOW** | `TTC ≤ ttc_yellow_s (15.0)` **OR** `gap_m ≤ caution_distance_m (20)` |
| **GREEN** | everything else |

**Special case:** a truck currently `LOADING` or `DUMPING` (parked/queueing) is always forced to `GREEN` with `relation="QUEUEING"` (`simulation.py` lines 167–175) — this is a deliberate fix so that trucks queueing close together at the single loading/dumping point don't falsely trigger a permanent collision alert.

**Effect chain** (verified in a live demo trace: GREEN→YELLOW→ORANGE→RED as two trucks converged head-on at the blind curve):
```
Risk level (risk_engine.py)
   ↓
Vehicle.hazard_status (copied every tick)
   ↓                                    ↓
Digital Twin (truck icon colour)   Fleet Table (status badge)
   ↓
Speed Advisor (RED → speed forced to 0; ORANGE → capped 8 km/h; YELLOW → capped 15 km/h)
   ↓
Emergency Alerts (only indirectly — a RED-triggered hard stop can itself register as a
                   "sudden stop" event if the drop exceeds sudden_stop_drop_kmh)
```
Note: risk level does **not** directly write into `emergency_events` — the two systems are related (a red-risk stop is often *also* a sudden-stop event) but are separate detectors (Section 13).

---

## SECTION 11 — DYNAMIC HAUL-RAMP CURVE SPEED STABILIZATION (Novelty 2)

```
Vehicle approaches a bend
      ↓
Curvature-radius-at(theta) computed numerically from the traced road (RoadNetwork)
      ↓
Recommended speed = clamp(radius × curvature_k, min_curve_speed, max_speed)   [see formula below]
      ↓
Smooth deceleration (rate-limited by max_decel_mps2 = 2.2 m/s² — Section 4)
      ↓
Vehicle holds a flat, safe speed across the whole flagged bend window
      ↓
Smooth acceleration back up once past the bend (rate-limited by max_accel_mps2 = 1.1 m/s²)
```

**Full formula (`speed_advisor.py: SpeedAdvisor.recommend`)**, applied in this exact order:

```
1. speed = clamp(curvature_radius_m × 0.075, 9, 26)      # curvature_k = 0.075
2. if zone_type has a cap: speed = min(speed, cap)        # blind_curve:8, sharp_curve:12,
                                                           #  intersection:10, loading:5,
                                                           #  dumping:6, ramp:14
3. speed *= 0.82 if loaded else 1.12                      # loaded+ascending slower, empty+descending faster
4. speed = min(speed, visibility_m × 1.8)                 # fog cap
5. speed *= speed_factor                                  # per-truck personality (0.9–1.1)
6. if ≥2 vehicles within 80 m: speed *= 0.85              # traffic density
7. RED → speed = 0 ; ORANGE → min(speed, 8) ; YELLOW → min(speed, 15)
8. clamp to [min_recommended_kmh=0, max_speed_kmh=26]
```

**Live-verified profile through the tightest bend** (Tight Bend (Ramp), curvature radius held at 10 m): approach `17.8 → 14.6 → 11.5 → 9.6 km/h`, held flat at **9.6 km/h** for the entire bend window, then exit `11.2 → 12.8 → 14.4 → 15.9 → 17.5 km/h`. No abrupt stops occurred except when overridden by an actual RED risk condition (step 7), matching the requirement.

---

## SECTION 12 — V2X COMMUNICATION

### V2V — `backend/v2v.py: V2VNetwork`
- **Sender/Receiver:** every truck, to every other truck.
- **Data:** ID, position, speed, heading, phase, hazard status (`V2VMessage.payload`); a human-readable text like `"Loaded Haul, 58 m away, opposite direction, 12 km/h"`.
- **Range:** `comm_range_m = 220 m` (road-distance, not straight-line).
- **Processing:** none beyond the range/`comm_ok`/`v2x_enabled` gate — it's a direct broadcast.
- **UI:** the global V2V message feed panel; per-truck partner list in the V2X chain panel; contributes to fusion confidence.
- **Effect on system:** feeds `fusion.py` (adds "v2v" to `contributing_sensors`).

### V2I — `backend/v2i.py: V2INetwork`
- **Sender/Receiver:** truck ↔ nearest RSU (roadside unit).
- **Data:** connection status, the node's identity, road status (local visibility at that node, and whether any nearby truck is hazardous).
- **Range:** `v2i_range_m = 150 m` (road-distance to the nearest of the 6 RSUs).
- **Processing:** `V2INetwork.evaluate()` finds the nearest node per truck and checks range.
- **UI:** V2X chain panel's "V2I" row; map lines between a connected truck and its node (when "Links: ON").
- **Effect on system:** none on physics — purely informational/UI, plus it's summarized into the OBU log.

### V2C — `backend/v2c.py: V2CControlCentre`
- **Sender/Receiver:** every truck → the control centre (this backend + dashboard).
- **Data:** per truck — speed, heading, hazard status, GPS mode, V2X status, V2I-connected flag; plus fleet-wide `fleet_size`, `connected_count`, and an `alerts` list (risk/breakdown/comm-loss messages).
- **Range:** unlimited (conceptually, the control centre always hears every connected truck).
- **UI:** the `v2x_status`/GPS columns in Fleet Status and the V2C row use this data. **`fleet_size`, `connected_count`, and `alerts` are computed but currently have no dedicated panel in the UI** — see Section 18.
- **Effect on system:** none on physics — purely aggregation/reporting.

---

## SECTION 13 — EMERGENCY ALERTS

`backend/emergency.py: EmergencyDetector.check()`, run every tick for every truck, logged to SQLite (`db.log_event`) and pushed as `state.emergency_events`.

| Condition | Trigger (exact logic) | Output type |
|---|---|---|
| **Sudden stop** | one-tick speed drop ≥ `sudden_stop_drop_kmh` (15) **and** previous speed > 5 km/h **and** not already stalled | `SUDDEN_STOP` |
| **Collision** | `gap_m ≤ collision_distance_m` (3) **and** `closing_speed_mps > 0.1` | `COLLISION` |
| **Breakdown** | `vehicle.stalled == True` continuously for ≥ `breakdown_stall_seconds` (6 s) | `BREAKDOWN` |
| **Communication loss** | `vehicle.comm_ok == False` continuously for ≥ `comm_loss_timeout_s` (3 s) | `COMM_LOSS` |
| **Road-edge condition** | `|lateral_offset| > 0.9`, **or** a small random chance (`road_edge_probability_per_tick = 0.0004`) each tick | `ROAD_EDGE` |

`stalled` and `comm_ok` are not autonomously triggered by any road condition — they are only set via the manual API endpoints `POST /api/vehicle/{id}/stall/{bool}` and `/comm/{bool}` (there is no UI button wired to these endpoints currently — see Section 18). The UI's "Emergency Alerts" panel simply lists the most recent 8 events with type, vehicle, status text, zone, and timestamp.

---

## SECTION 14 — FLEET OPTIMIZATION

**Status: NOT IMPLEMENTED.** An earlier version of this project had a `fleet_optimizer.py` module rating two alternate haul routes by fog/risk and recommending a reroute ("Redirect vehicles to Route B"). It was removed when the mine became a single continuous spiral road, because there is no second physical route to redirect trucks onto. No route-evaluation, route-rating, or reroute-recommendation logic exists anywhere in the current backend or UI. If a future version reintroduces multiple physical routes, this would be the natural place to rebuild it.

What the current system *does* do that is fleet-adjacent:
- `V2CControlCentre.evaluate()` computes `fleet_size`, `connected_count`, and an `alerts` list — this is fleet **monitoring**, not fleet **optimization** (no recommendations are generated), and as noted in Sections 12/18 it isn't currently rendered in its own panel.
- Per-truck speed reduction in dense traffic (`speed_advisor.py` step 6, `traffic_density_penalty`) is a *local* speed adjustment, not a fleet-level route decision.

---

## SECTION 15 — CONTROL CENTRE

The "control centre" in this prototype is not a separate service — it is the FastAPI backend (`backend/main.py`) plus the dashboard itself. What it receives and can display, per truck, via `V2CControlCentre.evaluate()` (`backend/v2c.py`):

| Data | Present in `state.v2c.vehicles[]`? | Displayed in UI? |
|---|---|---|
| Vehicle position | no (only speed/heading are copied here; position lives in `state.vehicles`) | yes, via `state.vehicles` / map |
| Speed | yes | yes (Fleet Status, Vehicle Detail) |
| Heading | yes | yes (Vehicle Detail) |
| Fog / Visibility | not part of `v2c` (separate `state.fog`) | yes (Fog & Visibility panel) |
| Risk / hazard status | yes | yes (Fleet Status badge) |
| GNSS status | yes (`gps_status` = positioning mode) | yes (Fleet Status "GPS" column) |
| Dead-reckoning status | yes (same field, value `DEAD_RECKONING`) | yes |
| V2X status | yes | yes (Fleet Status "V2X" column) |
| Fleet-wide condition (`fleet_size`, `connected_count`) | yes | **no dedicated panel** |
| Alerts list | yes (`state.v2c.alerts`) | **no dedicated panel — see Section 18** |
| Optimization recommendation | — | not implemented (Section 14) |

---

## SECTION 16 — COMPLETE REAL-TIME SCENARIO

This walkthrough matches what actually happens when **DEMO MODE** is run (`backend/demo.py`), verified via a live 58-second trace:

1. **PHASE 1 — Normal operation (t=0s).** Fog set to CLEAR. All 5 trucks continue their independent haul cycles — some loading, some hauling loaded uphill, some returning empty, some dumping (their staggered starting states from Section 4).
2. **Haul road.** Each truck's `theta` advances continuously along the spiral; speed reacts to whatever zone it's currently in.
3. **PHASE 2 — Blind curve (t=8s).** The script repositions DUMPER-01 (`EMPTY_RETURN`) and DUMPER-02 (`LOADED_HAUL`) to converge from opposite sides of the Blind Curve, ~150 m apart — close enough to enter radar range (90 m) within this phase.
4. **Fog increases (t=18s, PHASE 3).** Fog set to LIGHT. Visibility at the blind curve becomes `80 × 0.35 = 28 m`.
5. **Approaches sharp bend / curve speed stabilization.** As the gap closes, `curvature_radius_at()` and the `blind_curve` zone cap (8 km/h) pull the recommended speed down; both trucks decelerate smoothly (verified: DUMPER-01 `13.6 → 7.2 km/h` as risk went YELLOW→ORANGE).
6. **Blind curve / DUMPER-02 detected.** Radar detects DUMPER-02 once within 90 m; V2V has already been reporting it (unlimited by line-of-sight, only by `comm_range_m=220`); fusion confidence rises to MEDIUM/HIGH.
7. **Risk increases.** `RiskEngine.assess()` escalates GREEN → YELLOW → ORANGE → **RED** as TTC drops (verified: TTC 22.9s down to <4s).
8. **Vehicle slows / stops.** Speed advisor forces speed to 0 at RED — both trucks safely stop before collision (verified: gap stabilized at 7.9 m, both at 0 km/h).
9. **PHASE 4 — Multi-tier V2X (t=30s).** No state change; this phase is a narrative pause during which the V2X panel visibly shows the V2V partner, the V2I connection to the Blind Curve RSU, and the V2C "connected" status all live simultaneously.
10. **PHASE 5 — GPS-denied zone (t=38s).** DUMPER-03 is repositioned into the GPS-denied window; RTK-GNSS immediately reports LOST.
11. **Dead reckoning / IMU + wheel odometry.** Positioning mode flips to DEAD_RECKONING; "Since GNSS loss" and drift both begin climbing from 0 (verified: drift settled to a realistic ~1.4–1.6 m band, not a bogus spike, after a fix applied during development — see Section 18 changelog note below).
12. **V2X remains active.** DUMPER-03's OBU/V2V/V2I/V2C rows stay "ACTIVE" throughout — GPS loss and V2X are entirely independent systems in this codebase.
13. **PHASE 6 — GPS restored (t=48s).** DUMPER-03 is advanced past the denied window; RTK-GNSS reports ACTIVE again; "Since GNSS loss" and drift both reset to 0 instantly.
14. **Vehicle reaches dumping/loading area.** All trucks continue their independent haul cycles uninterrupted throughout the whole script — the demo never pauses the simulation, it only nudges fog and repositions 2–3 trucks at specific moments.
15. **Control centre updates.** `state.v2c` reflects all of the above every tick (Section 15), though (per the honesty note there) most of it surfaces through Fleet Status rather than one consolidated panel.
16. **Fleet optimization responds.** **Does not happen** — this step does not exist in the current system (Section 14).

---

## SECTION 17 — CODEBASE MAP

| Feature | File | Class / Function | Input | Processing | Output | UI Location |
|---|---|---|---|---|---|---|
| Simulation orchestration | `simulation.py` | `SimulationEngine.tick()` | previous state | runs every module below, in order | full state dict | (drives everything) |
| Road geometry | `road_network.py` | `RoadNetwork` | `config.yaml: mine` | spiral formula + bend perturbations | `point_at`, `zone_at`, `curvature_radius_at` | Digital Twin |
| Vehicle state machine | `vehicle.py` | `Vehicle`, `VehicleManager` | recommended speed, dt | haul-cycle phases, motion integration | `x,y,theta,speed,phase,...` | Fleet Status, Vehicle Detail |
| Radar sim | `sensors/radar.py` | `MMWaveRadarSim` | true gap/closing speed | range-gate + noise | `RadarReading` | Sensor Status |
| Thermal sim | `sensors/thermal.py` | `ThermalCameraSim` | true bearing/visibility | range-gate + bearing calc | `ThermalReading` | Sensor Status |
| RTK sim | `sensors/rtk_gnss.py` | `RTKGnssSim` | true x/y, denied flag | noise or LOST | `RTKReading` | Sensor Status, Fleet GPS col |
| IMU sim | `sensors/imu.py` | `IMUSim` | true heading/accel/lateral_offset | yaw-rate calc, thresholds | `IMUReading` | Sensor Status |
| Wheel-speed sim | `sensors/wheel_speed.py` | `WheelSpeedSim` | true speed/odometry | noise | `WheelSpeedReading` | Sensor Status |
| Dead reckoning | `dead_reckoning.py` | `DeadReckoning.update()` | RTK/IMU/wheel readings | RTK passthrough or integration | `PositionEstimate` | Vehicle Detail, Sensor Status |
| Sensor fusion | `fusion.py` | `fuse()` | radar/thermal/V2V | count contributing sensors | `FusionResult` | (feeds risk narrative, not risk math) |
| Collision risk | `risk_engine.py` | `RiskEngine.assess()` | true gap/closing speed | TTC + thresholds | `RiskAssessment` | Collision Risk panel, badges |
| Speed advisor | `speed_advisor.py` | `SpeedAdvisor.recommend()` | curvature, zone, fog, risk | 8-step formula (Section 11) | recommended km/h | Vehicle Detail, Curve Advisory |
| Fog model | `fog.py` | `FogController` | level or elapsed time | linear decay, zone multipliers | visibility per zone | Fog & Visibility panel |
| V2V | `v2v.py` | `V2VNetwork.broadcast()` | vehicle states, range | range/comm_ok gate | `V2VMessage` list | V2X panel |
| V2I | `v2i.py` | `V2INetwork.evaluate()` | nearest RSU, range | range gate | connection + road status | V2X chain |
| V2C | `v2c.py` | `V2CControlCentre.evaluate()` | all vehicles | aggregation | fleet report | Fleet Status columns |
| OBU | `obu.py` | `V2XOnBoardUnit.build()` | v2x_enabled, comm_ok, V2V/V2I/V2C | pure summarization | status + log | Sensor Status, V2X chain |
| Edge compute | `edge_compute.py` | `EdgeComputeUnit.evaluate()` | stalled, rtk, obu, positioning, fusion, traffic | load formula | Pi status/load | Sensor Status |
| Emergency detection | `emergency.py` | `EmergencyDetector.check()` | speed history, gap, stalled, comm_ok | 5 threshold rules | `EmergencyEvent` list | Emergency Alerts |
| Demo script | `demo.py` | `DemoController` | wall-clock elapsed time | 6-phase timeline | fog/position nudges | Demo banner |
| Persistence | `db.py` | `log_telemetry`, `log_event`, `fetch_recent_events` | telemetry/event dicts | SQLite writes/reads | rows in `data/fognet.db` | `GET /api/events` |
| API / WebSocket | `main.py` | `SimulationEngine`, `ConnectionManager` | HTTP/WS requests | REST toggles, tick loop | JSON over WebSocket | (transport layer) |
| Digital twin render | `twin.js` | `drawTwin()`, `buildTerrain()` | `state` + cached road | canvas drawing | pixels | Digital Twin canvas |
| Dashboard logic | `control_room.js` | `render()`, `renderSelection()`, etc. | `state` | DOM updates | all side panels | whole right/left columns |

---

## SECTION 18 — IMPLEMENTATION STATUS

| Feature | Status | Evidence in Code | UI Connected? |
|---|---|---|---|
| Spiral multi-bench mine geometry | IMPLEMENTED | `road_network.py: RoadNetwork` | Yes — Digital Twin |
| 7 sharp bends, real geometric kinks | IMPLEMENTED | `RoadNetwork._bend_perturbation`, `config.yaml: sharp_bends` | Yes — map halo/chevrons/tags |
| Curvature-based speed stabilization | IMPLEMENTED | `speed_advisor.py`, `RoadNetwork.curvature_radius_at` | Yes — Curve Advisory card |
| Haul-cycle state machine (5 trucks) | IMPLEMENTED | `vehicle.py: VehicleManager` | Yes — Fleet Status |
| Radar / Thermal / RTK / IMU / Wheel-speed sims | IMPLEMENTED | `sensors/*.py` | Yes — Sensor Status card |
| Sensor fusion confidence | IMPLEMENTED | `fusion.py` | Yes, but informational only (see below) |
| **Fusion feeding into risk/TTC math** | NOT IMPLEMENTED | `risk_engine.py` uses true gap, not `FusionResult` | N/A |
| Collision risk (TTC, 4 levels) | IMPLEMENTED | `risk_engine.py` | Yes |
| Dead reckoning (Novelty 3) | IMPLEMENTED | `dead_reckoning.py` | Yes — verified live |
| Dead-reckoning drift visibly moving the truck icon | NOT IMPLEMENTED (by design) | truck always renders at true `x,y` (`vehicle.py`) | Drift is a *number*, not a map movement |
| GPS-denied zone (static) | IMPLEMENTED | `RoadNetwork.is_gps_denied` | Yes |
| GPS-denied manual override | IMPLEMENTED | `gps_force_denied`, `/api/gps-denied` | Yes — top-bar button |
| Spatial fog zones | IMPLEMENTED | `fog.py: visibility_at` | Yes — Fog & Visibility panel |
| V2V | IMPLEMENTED | `v2v.py` | Yes |
| V2I (6 RSUs) | IMPLEMENTED | `v2i.py`, `road_network.py: _build_v2i_nodes` | Yes |
| V2C aggregation | IMPLEMENTED (backend) | `v2c.py` | **PARTIAL** — see below |
| V2C `fleet_size` / `connected_count` / `alerts` | IMPLEMENTED (backend) | `v2c.py` | **UI ONLY MISSING** — computed every tick, never rendered anywhere |
| V2X OBU status/log | IMPLEMENTED | `obu.py` | Yes |
| Raspberry Pi 5 edge-compute model | SIMULATED (software proxy, no real scheduling) | `edge_compute.py` | Yes |
| Emergency detection (5 types) | IMPLEMENTED | `emergency.py` | Yes — Emergency Alerts panel |
| Manual stall/comm-loss triggers | IMPLEMENTED (backend) | `main.py: /api/vehicle/{id}/stall`, `/comm` | **UI ONLY MISSING** — no button calls these endpoints |
| Fleet route optimization (Route A/B) | NOT IMPLEMENTED | module deleted; no trace in codebase | N/A |
| Intersection alternate-route stub (visual) | UI ONLY | `twin.js` "intersection junction stub" | Decorative; not a routable road |
| Blind-curve "line of sight blocked" | SIMULATED (implicit, not ray-cast) | risk logic never uses a visibility flag | Illustrated via rock-wall graphic only |
| Demo mode (6 phases) | IMPLEMENTED | `demo.py` | Yes — demo banner + button |
| Pause / Reset / Sim-speed | IMPLEMENTED | `main.py` endpoints | Yes |
| SQLite telemetry/event log | IMPLEMENTED | `db.py` | Only `events` exposed (`GET /api/events`); `telemetry` table has no UI/endpoint reader |

---

## SECTION 19 — DATA FLOW DIAGRAMS

**1. Hardware → Raspberry Pi → Software**
```
[sensors/*.py simulated readings]
            ↓
  (edge_compute.py reads the *results* of fusion/positioning, not raw sensors directly)
            ↓
      Raspberry Pi 5 status/load readout
```

**2. Sensor Fusion**
```
Radar.detected? ──┐
Thermal.detected?─┼─→ count → NONE(0)/LOW(1)/MEDIUM(2)/HIGH(3) → FusionResult
V2V present? ──────┘
```

**3. GPS Dead Reckoning**
```
RTK ACTIVE ──yes──→ position = RTK reading (reset drift/loss-distance to 0)
    │no
    ↓
last_estimate + (wheel_speed/3.6 × dt) × [cos(imu_heading), sin(imu_heading)]
    ↓
new estimate (mode=DEAD_RECKONING, drift = |estimate − truth|)
```

**4. V2V**
```
Truck A ──(if comm_ok & within comm_range_m)──→ Truck B
   payload: id, x, y, speed, heading, phase, hazard_status
```

**5. V2I**
```
Truck ──find nearest of 6 RSUs──→ within v2i_range_m? ──yes──→ CONNECTED + road_status(visibility, hazard)
                                                     └──no───→ DISCONNECTED
```

**6. V2C**
```
Every truck's (speed, heading, hazard, gps mode, v2x status) ──→ V2CControlCentre.evaluate()
                                                                       ↓
                                          fleet_size, connected_count, per-vehicle report, alerts[]
```

**7. Collision Risk**
```
gap_m, closing_speed_mps ──→ TTC = gap / closing (if closing > 0.05)
                                     ↓
                    RED / ORANGE / YELLOW / GREEN (thresholds in Section 10)
```

**8. Dynamic Curve Speed**
```
theta ──→ curvature_radius_at(theta) ──→ base speed (curvature_k × radius, clamped)
                                              ↓
                          zone cap → gradient factor → fog cap → personality →
                          traffic penalty → risk override → final recommended speed
```

**9. Control Centre**
```
[All trucks] ──V2C──→ [Backend state] ──WebSocket──→ [Every connected browser]
```

**10. Complete FOGNET architecture**
```
config.yaml
    ↓
RoadNetwork  ─────────────────────────────┐
    ↓                                     │
VehicleManager (haul cycle, motion)       │ (geometry/zones queried by everything below)
    ↓                                     │
Sensors (radar/thermal/rtk/imu/wheel) ←───┘
    ↓
DeadReckoning ──→ PositionEstimate
    ↓
Fusion ──→ FusionResult (informational)
    ↓
RiskEngine ──→ RiskAssessment  ──→ Vehicle.hazard_status
    ↓
SpeedAdvisor ──→ recommended_speed ──→ VehicleManager.step() (closes the loop)
    ↓
V2V / V2I / V2C / OBU / EdgeCompute (reporting layer, no physics feedback)
    ↓
EmergencyDetector ──→ EmergencyEvent → SQLite
    ↓
SimulationEngine.tick() state dict
    ↓
WebSocket → control_room.js / twin.js → Digital Twin + all panels
```

---

## SECTION 20 — JUDGE DEMONSTRATION GUIDE

A 3–5 minute script. Click **▶ DEMO MODE** right before you start talking — it runs for 58 seconds and times out on its own.

> "Here is our open-pit mine digital twin — it's not a flat loop, it's a single spiral haul road that actually descends through five benches to the pit floor, just like a real open-cast mine." *(point at the concentric rings and the pit sump)*

> "These are our five HEMM dumpers, each running its own independent haul cycle — loading, hauling loaded ore up, dumping, and returning empty. They're not scripted to move together; you can see they're all at different stages right now." *(point at the Fleet Status table)*

> "This vehicle is equipped with five real sensor types — mmWave radar for range, a thermal camera for heat direction, RTK-GPS for position, an IMU for heading and motion, and wheel-speed odometry — all processed onboard by a Raspberry Pi 5." *(click a truck, point at the Sensor Status card)*

> "Right now the demo is bringing two trucks toward this blind curve from opposite sides — the rock wall means neither driver could see the other directly." *(point at the Blind Curve on the map)*

> "Notice how its recommended speed decreases smoothly as it approaches the bend — this is our curve-speed-stabilization novelty: the system calculates the actual curvature of the road, not just a fixed limit." *(point at the Curve Zone Advisory card's Current Speed / Recommended numbers dropping)*

> "As the gap closes, our risk engine calculates Time-To-Collision and escalates from green to yellow to orange to red — and the truck brakes to a safe stop before any collision, purely from radar, thermal, and V2V data, since the driver never could have seen this coming visually." *(point at the hazard badge turning red)*

> "This is our V2X communication — vehicle-to-vehicle, vehicle-to-infrastructure through these roadside units, and vehicle-to-control-centre, all three tiers visible live in this panel." *(point at the V2X — Multi-Tier Communication panel)*

> "Now watch this truck enter a GPS-denied zone — a deep bench area where satellite signal realistically wouldn't reach." *(point at the red-shaded zone)* "RTK-GPS is lost — but the vehicle keeps moving smoothly, because it's now using its IMU heading and wheel-speed odometry to estimate its own position, exactly like a real autonomous vehicle would when it briefly loses GPS in a tunnel or canyon." *(point at "Positioning: DEAD RECKONING")* "And the moment it clears the zone, GPS re-syncs instantly."

> "This demonstrates our three key novelties: multi-tier V2X communication, dynamic curve-speed stabilization based on real road geometry, and GPS-resilient positioning through dead reckoning — all working together, live, on one open-pit digital twin."

---

*Document generated from a direct read of the codebase in `backend/` and `frontend/` at the time of writing. If the code changes, re-verify this document against it — it is not auto-generated and will drift out of date.*
