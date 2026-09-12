"""
Vehicle-to-Vehicle (V2V) communication simulation.

Every tick, each vehicle "broadcasts" its own state. Any other vehicle
within `comm_range_m` receives it — unless that vehicle's `comm_ok`
flag is False (simulated communication loss, used by the emergency
detector / demo mode).
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

    def broadcast(self, manager: VehicleManager) -> list[V2VMessage]:
        messages: list[V2VMessage] = []
        for sender_id, sender in manager.vehicles.items():
            if not sender.comm_ok:
                continue
            for receiver_id, receiver in manager.vehicles.items():
                if receiver_id == sender_id:
                    continue
                gap = self.road.gap_ahead(receiver.s, sender.s)
                if gap > self.comm_range_m:
                    continue
                text = (
                    f"Vehicle ahead at {gap:.0f} m, "
                    f"speed {sender.speed_kmh:.0f} km/h"
                )
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
                            "accel_mps2": sender.accel_mps2,
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
