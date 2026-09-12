"""
Abstract sensor interface.

Every sensor (radar, thermal camera, GPS, IMU) implements `read(context)`.
The simulated classes in this package generate synthetic data; a future
hardware-backed subclass (talking to an ESP32 / Raspberry Pi over serial
or MQTT) only needs to implement the same `read()` contract and can be
swapped in without touching the fusion, risk or dashboard code at all.

    class MMWaveRadarHardware(SensorInterface):
        def read(self, context: dict) -> dict:
            # pull the latest frame from the real radar module here
            ...

See sensors/radar.py etc. for the simulated implementations used today.
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class SensorInterface(ABC):
    #: Set to a connection string / device path once real hardware is wired
    #: up (e.g. "COM5", "mqtt://broker/fognet/radar/DUMPER-01"). None means
    #: "running in simulation mode".
    HARDWARE_BACKEND: str | None = None

    @abstractmethod
    def read(self, context: dict) -> dict:
        """Return a plain dict describing the current sensor reading."""
        raise NotImplementedError
