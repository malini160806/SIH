"""
V2V — Vehicle to Vehicle (tier 1 of the V2X topology).

Every tick, each truck broadcasts its own ID/position/speed/heading/
phase/hazard status. Any other truck within `comm_range_m` receives it
— unless that truck's `comm_ok` flag is down (simulated comm loss) or
V2X has been globally disabled for a demo.
"""
from __future__ import annotations

from .models import V2VMessage
from .road_network import RoadNetwork
from .vehicle import VehicleManager


class V2VNetwork:
    def __init__(self, road: RoadNetwork, comm_range_m: float):
        self.road = road
        self.comm_range_m = comm_range_m
        self.last_messages: list[V2VMessage] = []

    def broadcast(self, manager: VehicleManager, v2x_enabled: bool) -> list[V2VMessage]:
        messages: list[V2VMessage] = []
        if not v2x_enabled:
            self.last_messages = messages
            return messages

        for sender_id, sender in manager.vehicles.items():
            if not sender.comm_ok:
                continue
            for receiver_id, receiver in manager.vehicles.items():
                if receiver_id == sender_id:
                    continue
                gap = self.road.road_distance(receiver.theta, sender.theta)
                if gap > self.comm_range_m:
                    continue
                relation = "opposite direction" if sender.direction_sign * receiver.direction_sign < 0 else "same direction"
                text = f"{sender.phase.replace('_', ' ').title()}, {gap:.0f} m away, {relation}, {sender.speed_kmh:.0f} km/h"
                messages.append(
                    V2VMessage(
                        sender=sender_id,
                        receiver=receiver_id,
                        text=text,
                        payload={
                            "x": sender.x,
                            "y": sender.y,
                            "speed_kmh": sender.speed_kmh,
                            "heading_deg": sender.heading_deg,
                            "phase": sender.phase,
                            "hazard_status": sender.hazard_status,
                        },
                    )
                )
        self.last_messages = messages
        return messages

    def message_from_to(self, sender_id: str, receiver_id: str) -> V2VMessage | None:
        for m in self.last_messages:
            if m.sender == sender_id and m.receiver == receiver_id:
                return m
        return None
