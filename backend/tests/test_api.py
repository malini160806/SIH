import os
import pytest
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from fastapi.testclient import TestClient

# Import the FastAPI app and engine from the project
from backend.main import app, engine

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_and_teardown(tmp_path):
    # Use a temporary SQLite DB for isolation
    from backend import db
    original_path = db._DB_PATH
    test_db_path = os.path.join(tmp_path, "test_fognet.db")
    db._DB_PATH = test_db_path
    db.init_db()
    # Insert dummy telemetry rows
    telemetry_rows = [
        {
            "timestamp": 1.0,
            "vehicle_id": "v1",
            "x": 0.0,
            "y": 0.0,
            "speed_kmh": 10.0,
            "heading_deg": 0.0,
            "hazard_status": "none",
            "visibility_m": 100.0,
        }
        for _ in range(10)
    ]
    db.log_telemetry(telemetry_rows)
    # Insert dummy event rows
    event_rows = [
        {
            "timestamp": 2.0,
            "type": "hazard",
            "vehicle_id": "v1",
            "location": "zone1",
            "status": "active",
        }
        for _ in range(5)
    ]
    for ev in event_rows:
        db.log_event(ev)
    yield
    # Restore original DB path after test
    db._DB_PATH = original_path

def test_export_logs_pagination():
    response = client.get("/api/export-logs?limit=3&offset=0")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.strip().splitlines()
    # Expect telemetry header + 3 rows + empty line + events header + 3 rows
    assert len(lines) == 1 + 3 + 1 + 1 + 3
    assert "timestamp" in lines[0]
    assert "timestamp" in lines[5]

def test_tick_rate_endpoint():
    new_rate = 0.05
    response = client.post(f"/api/simulation/tick_rate?rate={new_rate}")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["tick_rate"] == new_rate
    assert engine.dt == new_rate
