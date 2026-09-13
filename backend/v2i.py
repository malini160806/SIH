"""
V2I — Vehicle to Infrastructure (tier 2 of the V2X topology).

Roadside V2I nodes sit at the mine's meaningful locations (blind
curve, intersection, ramp, loading, dumping — see RoadNetwork.v2i_nodes).
A truck within `v2i_range_m` of a node is considered connected to it,
and the node relays local road information (local visibility/fog
status, and whether any nearby truck is currently hazardous) back to
the truck and up to the control centre.
"""
from __future__ import annotations

from .fog import FogController
from .road_network import RoadNetwork
from .vehicle import VehicleManager


class V2INetwork:
    def __init__(self, road: RoadNetwork, v2i_range_m: float):
        self.road = road
        self.v2i_range_m = v2i_range_m

    def evaluate(self, manager: VehicleManager, fog: FogController, v2x_enabled: bool, risks: dict) -> dict:
        result = {}
        for vid, v in manager.vehicles.items():
            if not v2x_enabled:
                result[vid] = {"connected": False, "node": None, "gap_m": None, "road_status": None}
                continue

            node, gap = self.road.nearest_v2i_node(v.theta)
            connected = gap is not None and gap <= self.v2i_range_m
            road_status = None
            if connected:
                any_hazard = any(
                    r.other_id == vid and r.level in ("ORANGE", "RED") for r in risks.values()
                ) or v.hazard_status in ("ORANGE", "RED")
                road_status = {
                    "visibility_m": round(fog.visibility_at(node.zone_type), 1),
                    "hazard": any_hazard,
                }
            result[vid] = {
                "connected": connected,
                "node": {"id": node.node_id, "name": node.name} if node else None,
                "gap_m": round(gap, 1) if gap is not None else None,
                "road_status": road_status,
            }
        return result
