# FOGNET

**AI-Based Cooperative Perception and Intelligent Haulage Safety Network
for Low-Visibility Open-Cast Mining** — SIH working prototype.

FOGNET simulates three mining dumpers on a miniature haul-road loop
(straight roads, a blind curve, an intersection, a loading area and a
dumping area), gives each of them simulated mmWave radar / thermal
camera / RTK-GPS / IMU sensors and a V2V link, fuses that evidence,
computes Time-To-Collision, and drives both a control-room dashboard
and a minimal driver-warning screen in real time over WebSocket — all
running locally, offline, with no physical sensors required.

## Project structure

```
SIH/
├── backend/
│   ├── main.py            FastAPI app: pages, REST API, WebSocket
│   ├── simulation.py       Orchestrates one tick across every module
│   ├── config.py / config.yaml   All thresholds — nothing hard-coded
│   ├── road_network.py     The mine loop: waypoints + zones (curve, fog zone, etc.)
│   ├── vehicle.py          Vehicle state + motion model
│   ├── sensors/            radar.py, thermal.py, gps.py, imu.py (+ base.py interface)
│   ├── fusion.py           Combines radar + thermal + V2V + GPS into one detection
│   ├── risk_engine.py      TTC + GREEN/YELLOW/ORANGE/RED classification
│   ├── fog.py              Manual + auto-deteriorating fog model
│   ├── speed_advisor.py    Dynamic recommended safe speed
│   ├── fleet_optimizer.py  Route A/B risk + reroute/hold/slow-down recommendations
│   ├── emergency.py        Sudden-stop / collision / breakdown / comm-loss / road-edge
│   ├── v2v.py              Vehicle-to-vehicle broadcast simulation
│   ├── demo.py             Scripted DEMO MODE (the 12-step judge walkthrough)
│   └── db.py               SQLite telemetry + event log
├── frontend/
│   ├── control_room.html   Central control-room dashboard
│   ├── driver.html         Minimal in-cab driver warning screen
│   └── static/
│       ├── css/style.css
│       └── js/ (ws.js, twin.js, control_room.js, driver.js)
├── data/fognet.db          created automatically on first run
├── requirements.txt
└── run.py
```

Software layering (as specified):

```
Frontend  →  Backend API (FastAPI)  →  Vehicle Manager  →  Sensor Fusion
          →  Risk Engine  →  Fog Model  →  Fleet Optimization
```

Every stage above is its own module with a narrow interface, so a
learned model can later replace the rule-based fusion/risk logic
without touching anything else, and a real ESP32/Raspberry Pi/mmWave
radar can implement `sensors/base.py`'s `SensorInterface` in place of
the `*Sim` classes without touching fusion, risk, or the dashboard.

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

Then open:

* **Control Room Dashboard:** http://localhost:8000/
* **Driver View:** http://localhost:8000/driver (pick a vehicle from the dropdown; you can also open `http://localhost:8000/driver?vehicle=DUMPER-02` directly, e.g. in a second window per truck)

The three trucks start moving automatically — no manual setup needed.

## Using it

* **Fog dropdown** — manually set visibility (CLEAR → EXTREME).
* **Auto-Deteriorate** — turns on gradual fog worsening over time
  (rate configurable in `backend/config.yaml`).
* **DEMO MODE** — runs the full scripted scenario from the brief
  end-to-end (~52 seconds): normal visibility → fog forms → DUMPER-02
  enters the blind curve → DUMPER-01 loses visual contact → V2V →
  radar → sensor fusion confirm the hidden vehicle → TTC collapses →
  HIGH COLLISION RISK → driver STOP/BRAKE warning → EXTREME fog →
  fleet reroute recommendation. Click it once, then just watch the
  dashboard (and the driver view in a second window) — this is the
  fastest way to demonstrate the whole system to judges.
* The digital twin (left panel) shows live vehicle positions, the
  road/zones, V2V communication lines, and a fog overlay.

## Configuration

All collision thresholds, sensor ranges, fog visibility mapping and
speed-advisory weights live in `backend/config.yaml` — edit and
restart the server to retune behaviour.

## Notes on the current prototype

* All sensor data is simulated (see `backend/sensors/`); each class
  implements a small `SensorInterface` so real hardware can be dropped
  in later.
* Risk/fusion logic is intentionally simple and rule-based per the
  brief; the module boundaries are what would let an ML model be
  substituted later.
* SQLite (`data/fognet.db`) logs periodic telemetry and every
  emergency event; query it directly or via `GET /api/events`.
