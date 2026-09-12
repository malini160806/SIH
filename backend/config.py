"""
Loads config.yaml once and exposes it as a plain nested dict.

Keeping configuration in one YAML file (instead of scattering constants
through the codebase) means every threshold used by the risk engine, fog
model and speed advisor can be retuned without editing Python.
"""
from __future__ import annotations

import os
import yaml

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.yaml")

_cache: dict | None = None


def load_config() -> dict:
    global _cache
    if _cache is None:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
            _cache = yaml.safe_load(f)
    return _cache


def reload_config() -> dict:
    """Force a re-read from disk (useful if a demo wants a fresh copy)."""
    global _cache
    _cache = None
    return load_config()
