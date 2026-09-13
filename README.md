# FOGNET

**Predictive & Cooperative Fog Intelligence System** — an SIH working
prototype for open-pit iron-ore haulage safety under low visibility.

FOGNET simulates a live **spiral open-pit mine**: a single continuous
haul road winding down from the surface rim to the pit floor through
five stepped benches, five autonomous dump trucks running an
independent haul cycle (load → haul out loaded → dump → return empty →
load...), and three demonstrated technical novelties:

1. **Multi-tier V2X** — V2V (truck ↔ truck), V2I (truck ↔ roadside
   infrastructure node), V2C (fleet ↔ control centre).
2. **Dynamic haul-ramp curve speed stabilization** — recommended speed
   is derived from the *actual local radius of curvature* of the
   spiral road, not a fixed mine-wide limit, plus named-zone caps
   (blind curve, intersection, ramp, loading, dumping) and a
   loaded/empty gradient factor.
3. **Low-cost IMU + wheel-speed kinematic dead reckoning** — when
   RTK-GNSS is lost (a deep-bench "GPS-denied" zone, or a manual
   toggle), position estimation falls back to integrating wheel-speed
   odometry along the IMU heading from the last known fix, and
   re-synchronizes the moment RTK returns.

Everything runs locally and offline, with fully simulated sensors —
no physical hardware required for this prototype.

## Project structure

```
SIH/
├── backend/
│   ├── main.py             FastAPI app: pages, REST API, WebSocket
│   ├── simulation.py       Orchestrates one tick across every module
│   ├── config.py / config.yaml   All thresholds/geometry — nothing hard-coded
│   ├── road_network.py     The spiral: theta -> (x,y,elevation,bench,zone)
│   ├── vehicle.py          Vehicle state + the autonomous haul-cycle state machine
│   ├── sensors/            radar.py (RANGE), thermal.py (HEAT + centroid ANGLE),
│   │                       rtk_gnss.py (ABSOLUTE POSITION), imu.py (HEADING + MOTION),
│   │                       wheel_speed.py (SPEED + ODOMETRY) — each mirrors one
│   │                       real physical sensor's actual output, nothing more
│   ├── dead_reckoning.py   Novelty 3: IMU + wheel-speed position estimation
│   ├── fusion.py           Combines radar + thermal + V2V into one detection
│   ├── risk_engine.py      TTC + GREEN/YELLOW/ORANGE/RED, head-on or following
│   ├── speed_advisor.py    Novelty 2: curvature-based recommended speed
│   ├── fog.py              Global + per-zone spatial visibility model
│   ├── v2v.py / v2i.py / v2c.py   Novelty 1: the three V2X tiers
│   ├── emergency.py        Sudden-stop / collision / breakdown / comm-loss / road-edge
│   ├── demo.py             Scripted DEMO MODE (the 6-phase judge walkthrough)
│   └── db.py               SQLite telemetry + event log
├── frontend/
│   ├── control_room.html   The dashboard (mine map is the hero element)
│   └── static/
│       ├── css/style.css
│       └── js/ (ws.js, twin.js — spiral digital-twin renderer, control_room.js)
├── data/fognet.db          created automatically on first run
├── requirements.txt
└── run.py
```

Layering:

```
Frontend  →  Backend API (FastAPI)  →  Vehicle Manager (haul cycle)
          →  Sensors  →  Positioning (RTK / Dead Reckoning)
          →  Sensor Fusion  →  Risk Engine  →  Speed Advisor  →  V2X (V2V/V2I/V2C)
```

Every stage is its own module with a narrow interface: a real ESP32 /
Raspberry Pi / mmWave radar can implement `sensors/base.py`'s
`SensorInterface` in place of the `*Sim` classes without touching
fusion, risk, or the dashboard.

## Setup

Requires Python 3.10+.

```bash
cd SIH
python -m venv venv
venv\Scripts\activate        # on Windows
# source venv/bin/activate   # on macOS/Linux

pip install -r requirements.txt
python run.py
```

Open the control-room dashboard at **http://localhost:8000/**. The
five trucks start their haul cycle automatically.

## Using it

* **Click any truck** (on the map or in the Fleet Status table) to
  open its **Vehicle Detail**, **Sensor Status**, and **Collision
  Risk** panels.
* **⏸ Pause / ⟲ Reset** — stop the simulation clock, or rebuild the
  mine and fleet from scratch.
* **Fog dropdown + Auto-Fog** — set visibility manually or let it
  deteriorate over time. Fog is *spatial*: the Fog & Visibility panel
  shows each zone's own visibility (the blind curve is always the
  foggiest spot, per its multiplier in `config.yaml`).
* **Speed** — run the simulation at 0.5x–4x for a faster or slower demo.
* **GPS-Denied** — force RTK-GNSS loss fleet-wide on demand, to show
  dead reckoning kick in without waiting for a truck to reach the
  static GPS-denied zone.
* **V2X** — toggle the whole V2V/V2I/V2C network off to show trucks
  losing cooperative awareness (radar/thermal keep working; V2V/V2I/V2C
  panels go dark).
* **Links** — show/hide the V2V and V2I connection lines on the map.
* **▶ DEMO MODE** — runs the full 6-phase scripted scenario
  (~58 seconds): normal haul operations → DUMPER-01 and DUMPER-02
  converge head-on at the blind curve → the curvature-based speed
  advisor smoothly brakes both trucks as risk escalates
  GREEN→YELLOW→ORANGE→RED → the V2X panel shows the V2V/V2I/V2C chain
  confirming the oncoming truck → DUMPER-03 enters the GPS-denied zone
  and switches to dead reckoning → DUMPER-03 clears it and RTK
  re-synchronizes. This is the fastest way to demonstrate all three
  novelties to judges in one pass.

## Configuration

Mine geometry (spiral radius/turns/elevations), all sensor ranges,
V2X ranges, fog zone multipliers, risk thresholds, and the curvature
speed-stabilization formula live in `backend/config.yaml` — edit and
restart the server to retune behaviour.

## Hardware → information mapping (kept consistent everywhere)

| Sensor | Provides | Never provides |
|---|---|---|
| 77 GHz mmWave Radar | Object detection, RANGE, closing speed | Bearing, absolute position |
| LWIR Thermal Array | Heat detection, centroid ANGLE, direction | Distance |
| RTK-GNSS | Absolute position (or LOST) | — |
| IMU | Heading, acceleration, motion | Absolute position |
| Wheel Speed | Speed, odometry | Absolute position |
| RTK + IMU + Wheel Speed | Position estimation (RTK, or dead reckoning when RTK is lost) | — |
| V2V | Vehicle-shared state (position/speed/heading/hazard) | — |
| V2I | Local road/hazard status from a roadside node | — |
| V2C | Fleet-wide status aggregated at the control centre | — |

## Notes on the current prototype

* All sensor data is simulated (see `backend/sensors/`); each class
  implements a small `SensorInterface` so real hardware can be dropped
  in later.
* Risk/fusion/speed logic is rule-based and geometry-driven per the
  brief; module boundaries are what would let an ML model be
  substituted later without touching the rest of the pipeline.
* The mine has one haul road (a real single-lane pit ramp): when two
  trucks converge head-on at the blind curve, FOGNET's job is to stop
  both safely before they collide — it does not implement a
  give-way/dispatch protocol for resuming afterward, which would be a
  natural next step.
* SQLite (`data/fognet.db`) logs periodic telemetry and every
  emergency event; query it directly or via `GET /api/events`.
