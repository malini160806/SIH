"""
V2X On-Board Unit (OBU).

The OBU is a communication device, not a sensor: it doesn't measure
anything about the world, it carries whatever V2V/V2I/V2C traffic the
rest of the system has already generated. This module never invents
new messages — it only summarizes the real V2VNetwork broadcasts,
V2INetwork connections, and V2C report that simulation.py already
computed for this tick, into one coherent per-vehicle OBU status plus
a human-readable communication log.
"""
from __future__ import annotations


class V2XOnBoardUnit:
    def build(self, vehicle_id: str, v2x_enabled: bool, comm_ok: bool,
              v2v_messages: list, v2i_info: dict, v2c_connected: bool) -> dict:
        ok = v2x_enabled and comm_ok
        state = "ACTIVE" if ok else "INACTIVE"

        log: list[str] = []
        if ok:
            for m in v2v_messages:
                if m.sender != vehicle_id:
                    continue
                log.append(
                    f"{vehicle_id} → {m.receiver}: position/speed/heading/hazard shared"
                )
            if v2i_info and v2i_info.get("connected") and v2i_info.get("node"):
                log.append(f"{vehicle_id} → {v2i_info['node']['name']}: hazard/road status shared")
            if v2c_connected:
                log.append(f"{vehicle_id} → CONTROL CENTRE: vehicle state transmitted")

        return {
            "status": "CONNECTED" if ok else "DISCONNECTED",
            "v2x_link": state,
            "v2v": state,
            "v2i": state,
            "v2c": state,
            "log": log,
        }
