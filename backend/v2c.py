"""
V2C — Vehicle (and Infrastructure) to Control Centre (tier 3 of the
V2X topology).

Every truck (and, transitively, every V2I node) reports up to a
central control centre: position, speed, heading, hazard status, GPS
status, positioning mode, and V2X connectivity. This module just
aggregates that view — the FastAPI backend + dashboard together *are*
the control centre in this prototype.
"""
from __future__ import annotations

from .vehicle import VehicleManager


class V2CControlCentre:
    def evaluate(self, manager: VehicleManager, v2x_enabled: bool, positioning: dict, v2i_status: dict) -> dict:
        vehicles_report = []
        alerts = []
        connected_count = 0

        for vid, v in manager.vehicles.items():
            v2x_status = "CONNECTED" if (v2x_enabled and v.comm_ok) else "DISCONNECTED"
            if v2x_status == "CONNECTED":
                connected_count += 1
            pos = positioning.get(vid, {})
            vehicles_report.append({
                "id": vid,
                "speed_kmh": v.speed_kmh,
                "heading_deg": v.heading_deg,
                "hazard_status": v.hazard_status,
                "gps_status": pos.get("mode"),
                "v2x_status": v2x_status,
                "v2i_connected": v2i_status.get(vid, {}).get("connected", False),
            })
            if v.hazard_status in ("ORANGE", "RED"):
                alerts.append(f"{vid}: {v.hazard_status} risk")
            if v.stalled:
                alerts.append(f"{vid}: possible breakdown")
            if not v.comm_ok:
                alerts.append(f"{vid}: V2V communication lost")

        return {
            "fleet_size": len(manager.vehicles),
            "connected_count": connected_count,
            "vehicles": vehicles_report,
            "alerts": alerts,
        }
