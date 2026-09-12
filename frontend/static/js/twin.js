/**
 * 2D digital-twin renderer for the mine haul-road loop.
 * Pure canvas — no external mapping library — so it stays fully offline.
 */
const TWIN_W = 860;
const TWIN_H = 680;

const ZONE_COLORS = {
  straight: "#22344a",
  curve: "#4a2f5c",
  intersection: "#5c4a1f",
  loading: "#1f5c3a",
  dumping: "#5c331f",
};

const VEHICLE_COLORS = {
  GREEN: "#2ecc71",
  YELLOW: "#f1c40f",
  ORANGE: "#e67e22",
  RED: "#e74c3c",
};

function initTwinCanvas(canvas) {
  canvas.width = TWIN_W;
  canvas.height = TWIN_H;
  return canvas.getContext("2d");
}

function drawTwin(ctx, state) {
  ctx.clearRect(0, 0, TWIN_W, TWIN_H);
  ctx.fillStyle = "#0e1520";
  ctx.fillRect(0, 0, TWIN_W, TWIN_H);

  const road = state.road;
  if (!road) return;
  const pts = road.points;
  const zones = road.zones;
  const fogStatus = state.fog ? state.fog.status : "CLEAR";
  const visibility = state.fog ? state.fog.visibility_m : 200;

  // ---- road segments, colored by zone type
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const zone = zones[i];
    ctx.strokeStyle = ZONE_COLORS[zone.type] || "#22344a";
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (zone.is_fog_zone) {
      const intensity = { CLEAR: 0.05, LIGHT: 0.15, MEDIUM: 0.3, HEAVY: 0.5, EXTREME: 0.7 }[fogStatus] || 0.1;
      ctx.strokeStyle = `rgba(200,220,255,${intensity})`;
      ctx.lineWidth = 46;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  // ---- zone labels (loading / dumping / curve / intersection), once each
  const labeled = new Set();
  for (let i = 0; i < pts.length; i++) {
    const zone = zones[i];
    if (["loading", "dumping", "curve", "intersection"].includes(zone.type) && !labeled.has(zone.type)) {
      labeled.add(zone.type);
      const p = pts[i];
      ctx.fillStyle = "#9fb3c8";
      ctx.font = "12px Segoe UI";
      ctx.fillText(zone.name.toUpperCase(), p[0] - 30, p[1] - 18);
    }
  }

  // ---- V2V comm lines
  (state.v2v_messages || []).forEach((m) => {
    const s = state.vehicles[m.sender];
    const r = state.vehicles[m.receiver];
    if (!s || !r) return;
    ctx.strokeStyle = "rgba(63,169,245,0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // ---- vehicles
  Object.values(state.vehicles || {}).forEach((v) => {
    const color = VEHICLE_COLORS[v.hazard_status] || "#3fa9f5";
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate((v.heading_deg * Math.PI) / 180);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-9, 7);
    ctx.lineTo(-9, -7);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#e6edf3";
    ctx.font = "bold 11px Segoe UI";
    ctx.fillText(v.id, v.x - 24, v.y - 22);
    ctx.fillStyle = "#8a9bb0";
    ctx.font = "10px Segoe UI";
    ctx.fillText(`${v.speed_kmh} km/h`, v.x - 20, v.y + 30);
  });

  // ---- global fog overlay
  const fogOpacity = Math.max(0, Math.min(0.6, 1 - visibility / 180));
  if (fogOpacity > 0.02) {
    ctx.fillStyle = `rgba(210,220,235,${fogOpacity})`;
    ctx.fillRect(0, 0, TWIN_W, TWIN_H);
  }
}
