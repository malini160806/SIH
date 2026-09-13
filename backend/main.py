"""
FastAPI application entry point.

Serves the control-room dashboard as static files, exposes a REST API
for configuration/demo/simulation control, and streams live simulation
state to every connected browser over a single WebSocket endpoint
(/ws/state). The static road geometry is served once via /api/road
rather than repeated on every tick, to keep the per-tick payload small.
"""
from __future__ import annotations

import asyncio
import json
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .config import load_config
from .demo import DemoController
from .simulation import SimulationEngine

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

app = FastAPI(title="FOGNET")
app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")

engine = SimulationEngine()
engine.demo = DemoController()


class ConnectionManager:
    def __init__(self):
        self.active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def broadcast(self, message: str):
        dead = []
        # snapshot the set: connect()/disconnect() can mutate self.active
        # from other tasks while we're awaiting send_text() below
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@app.on_event("startup")
async def start_simulation_loop():
    asyncio.create_task(_simulation_loop())


async def _simulation_loop():
    while True:
        try:
            state = engine.tick()
            await manager.broadcast(json.dumps(state))
        except Exception:
            import traceback
            traceback.print_exc()
        await asyncio.sleep(engine.dt)


# ---------------------------------------------------------------- pages
@app.get("/")
async def control_room_page():
    return FileResponse(os.path.join(FRONTEND_DIR, "control_room.html"))


# ---------------------------------------------------------------- API
@app.get("/api/config")
async def get_config():
    return load_config()


@app.get("/api/road")
async def get_road():
    return engine.road.to_dict()


@app.post("/api/fog/{level}")
async def set_fog_level(level: str):
    engine.fog.set_level(level)
    return {"ok": True, "fog": engine.fog.state()}


@app.post("/api/fog-auto/{enabled}")
async def set_fog_auto(enabled: bool):
    engine.fog.set_auto(enabled)
    return {"ok": True, "fog": engine.fog.state()}


@app.post("/api/demo/start")
async def demo_start():
    engine.demo.start(engine)
    return {"ok": True}


@app.post("/api/demo/stop")
async def demo_stop():
    engine.demo.stop(engine)
    return {"ok": True}


@app.post("/api/pause/{paused}")
async def set_paused(paused: bool):
    engine.paused = paused
    return {"ok": True, "paused": engine.paused}


@app.post("/api/reset")
async def reset_sim():
    engine.reset()
    return {"ok": True}


@app.post("/api/sim-speed/{multiplier}")
async def set_sim_speed(multiplier: float):
    engine.sim_speed = max(0.25, min(4.0, multiplier))
    return {"ok": True, "sim_speed": engine.sim_speed}


@app.post("/api/gps-denied/{enabled}")
async def set_gps_denied(enabled: bool):
    engine.gps_force_denied = enabled
    return {"ok": True, "gps_force_denied": engine.gps_force_denied}


@app.post("/api/v2x/{enabled}")
async def set_v2x(enabled: bool):
    engine.v2x_enabled = enabled
    return {"ok": True, "v2x_enabled": engine.v2x_enabled}


@app.post("/api/vehicle/{vehicle_id}/stall/{enabled}")
async def set_stall(vehicle_id: str, enabled: bool):
    v = engine.manager.vehicles.get(vehicle_id)
    if v:
        v.stalled = enabled
    return {"ok": True}


@app.post("/api/vehicle/{vehicle_id}/comm/{enabled}")
async def set_comm(vehicle_id: str, enabled: bool):
    v = engine.manager.vehicles.get(vehicle_id)
    if v:
        v.comm_ok = enabled
    return {"ok": True}


@app.get("/api/events")
async def get_events(limit: int = 50):
    return db.fetch_recent_events(limit)


# ---------------------------------------------------------------- WebSocket
@app.websocket("/ws/state")
async def ws_state(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
