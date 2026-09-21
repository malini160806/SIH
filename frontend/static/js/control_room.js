const canvas = document.getElementById("twin-canvas");
const ctx = initTwinCanvas(canvas);

const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

let cachedRoad = null;
let latestState = null;
let selectedId = null;
let showLinks = true;

const dumperSelect = document.getElementById("dumper-select");

function selectVehicle(id) {
  selectedId = id || null;
  dumperSelect.value = selectedId || "";
  renderSelection(latestState);
}

dumperSelect.addEventListener("change", (e) => selectVehicle(e.target.value));

fetch("/api/road")
  .then((r) => r.json())
  .then((road) => (cachedRoad = road));

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

function animateTwin() {
  if (latestState && cachedRoad) {
    latestState.road = cachedRoad;
    drawTwin(ctx, latestState, { selectedId, showLinks });
  }
  requestAnimationFrame(animateTwin);
}
requestAnimationFrame(animateTwin);

// ---- click-to-select a truck on the map
canvas.addEventListener("click", (evt) => {
  if (!latestState) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (evt.clientX - rect.left) * scaleX;
  const cy = (evt.clientY - rect.top) * scaleY;

  let best = null,
    bestDist = 26;
  Object.values(latestState.vehicles).forEach((v) => {
    const d = Math.hypot(v.x - cx, v.y - cy);
    if (d < bestDist) {
      bestDist = d;
      best = v.id;
    }
  });
  if (best) selectVehicle(best);
});

function render(state) {
  latestState = state;
  renderFleetTable(state);
  renderFog(state);
  renderV2X(state);
  renderEmergencies(state);
  renderDemo(state);
  renderSelection(state);

  document.getElementById("tick-info").textContent =
    `tick ${state.tick} · ${new Date(state.timestamp * 1000).toLocaleTimeString()}` +
    (state.paused ? " · PAUSED" : "");

  document.getElementById("fog-auto-btn").textContent = `Auto-Fog: ${state.fog.auto_mode ? "ON" : "OFF"}`;
  document.getElementById("gps-denied-btn").textContent = `GPS-Denied: ${state.gps_force_denied ? "ON" : "OFF"}`;
  document.getElementById("gps-denied-btn").classList.toggle("active", state.gps_force_denied);
  document.getElementById("v2x-btn").textContent = `V2X: ${state.v2x_enabled ? "ON" : "OFF"}`;
  document.getElementById("pause-btn").textContent = state.paused ? "▶ Resume" : "⏸ Pause";
}

function v2cLookup(state, vid) {
  return (state.v2c.vehicles || []).find((v) => v.id === vid) || {};
}

function renderFleetTable(state) {
  const tbody = document.getElementById("vehicle-rows");
  tbody.innerHTML = "";
  Object.values(state.vehicles).forEach((v) => {
    const pos = state.positioning[v.id] || {};
    const c = v2cLookup(state, v.id);
    const gpsLabel = pos.mode === "DEAD_RECKONING" ? "DEAD RECK." : "RTK";
    const tr = document.createElement("tr");
    tr.className = v.id === selectedId ? "row-selected" : "";
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.speed_kmh} km/h</td>
      <td>${v.bench}</td>
      <td><span class="pill ${pos.mode === "DEAD_RECKONING" ? "pill-warn" : "pill-ok"}">${gpsLabel}</span></td>
      <td><span class="pill ${c.v2x_status === "CONNECTED" ? "pill-ok" : "pill-warn"}">${c.v2x_status || "--"}</span></td>
      <td><span class="badge ${v.hazard_status}">${v.hazard_status}</span></td>
    `;
    tr.addEventListener("click", () => selectVehicle(v.id));
    tbody.appendChild(tr);
  });
}

function renderFog(state) {
  document.getElementById("visibility-value").textContent = `${state.fog.visibility_m} m`;
  const statusEl = document.getElementById("fog-status-value");
  statusEl.textContent = state.fog.status;
  statusEl.className = `value fog-status-${state.fog.status}`;

  const zonesEl = document.getElementById("fog-zones");
  const labels = { dumping: "Dumping", bench_road: "Bench Road", ramp: "Ramp", blind_curve: "Blind Curve", sharp_curve: "Sharp Curve", intersection: "Intersection", loading: "Loading" };
  zonesEl.innerHTML = Object.entries(state.fog.zones || {})
    .map(([type, z]) => `<div class="zone-row"><span>${labels[type] || type}</span><span class="fog-status-${z.status}">${z.visibility_m} m · ${z.status}</span></div>`)
    .join("");
}

function renderV2X(state) {
  document.getElementById("v2v-log").innerHTML =
    (state.v2v_messages || []).map((m) => `<div class="msg"><b>${m.sender} → ${m.receiver}</b><br>"${m.text}"</div>`).join("") ||
    '<div class="label">No V2V traffic in range.</div>';
}

function renderEmergencies(state) {
  const list = document.getElementById("emergency-list");
  const events = state.emergency_events || [];
  if (!events.length) {
    list.innerHTML = '<div class="label">No active emergencies</div>';
    return;
  }
  list.innerHTML = events
    .slice(0, 8)
    .map((e) => `<div class="alert-banner"><b>${e.type.replace("_", " ")}</b> — ${e.vehicle_id}<br>${e.status} @ ${e.location} (${fmtTime(e.timestamp)})</div>`)
    .join("");
}

function renderDemo(state) {
  const banner = document.getElementById("demo-banner");
  const demoBtn = document.getElementById("demo-btn");
  if (state.demo && state.demo.active) {
    banner.classList.add("show");
    document.getElementById("demo-step-title").textContent = `${state.demo.step_title} (${state.demo.step_index}/${state.demo.step_count})`;
    document.getElementById("demo-step-desc").textContent = state.demo.step_description;
    demoBtn.textContent = "■ STOP DEMO";
    demoBtn.classList.add("active");
  } else {
    banner.classList.remove("show");
    demoBtn.textContent = "▶ DEMO MODE";
    demoBtn.classList.remove("active");
  }
}

function row(label, value) {
  return `<div class="detail-row"><span class="dl">${label}</span><span class="dv">${value}</span></div>`;
}

// Live "approaching/in/through a bend" advisory — every field here comes
// straight from the existing zone/speed-advisor/risk/fusion state, never
// a separate fake curve system.
function curveAdvisoryHtml(v, recommendedSpeed, risk, fusion) {
  const isBlind = v.zone_type === "blind_curve";
  const isCurve = isBlind || v.zone_type === "sharp_curve";
  if (!isCurve) return "";

  const hazard = isBlind && !!risk.other_id;
  const sawV2V = hazard && (fusion.contributing_sensors || []).includes("v2v");

  return `
    <div class="curve-advisory ${isBlind ? "curve-blind" : "curve-sharp"}">
      <div class="curve-advisory-title">${isBlind ? "⚠️ BLIND CURVE" : "↩️ SHARP BEND"} — ${v.zone_name.toUpperCase()}</div>
      <div class="detail-row"><span class="dl">Curve Zone</span><span class="dv">${isBlind ? "BLIND" : "SHARP"}</span></div>
      <div class="detail-row"><span class="dl">Current Speed</span><span class="dv">${v.speed_kmh} km/h</span></div>
      <div class="detail-row"><span class="dl">Recommended</span><span class="dv">${recommendedSpeed} km/h</span></div>
      <div class="detail-row"><span class="dl">Curve Stabilization</span><span class="dv pill pill-ok">ACTIVE</span></div>
      ${hazard ? `
        <div class="curve-hazard">
          HAZARD DETECTED — ${risk.level} (${risk.other_id}, ${risk.relation || ""})
          ${sawV2V ? `<br>V2V: VEHICLE AHEAD` : ""}
        </div>` : ""}
    </div>`;
}

function renderSelection(state) {
  if (!state) return;
  const title = document.getElementById("detail-title");
  const detail = document.getElementById("vehicle-detail");
  const sensorPanel = document.getElementById("sensor-panel");
  const riskCard = document.getElementById("risk-card");
  const chain = document.getElementById("v2x-chain");

  if (!selectedId || !state.vehicles[selectedId]) {
    title.textContent = "Vehicle Detail — select a truck";
    detail.innerHTML = '<div class="label">Click any truck on the map, or a fleet-status row.</div>';
    sensorPanel.innerHTML = '<div class="label">No vehicle selected.</div>';
    riskCard.innerHTML = '<div class="label">No vehicle selected.</div>';
    chain.innerHTML = '<div class="label">No vehicle selected.</div>';
    return;
  }

  const v = state.vehicles[selectedId];
  const pos = state.positioning[selectedId] || {};
  const sensors = state.sensors[selectedId] || {};
  const risk = state.risk[selectedId] || {};
  const fusion = state.fusion[selectedId] || {};
  const v2i = state.v2i[selectedId] || {};
  const obu = state.obu[selectedId] || {};
  const edge = state.edge_compute[selectedId] || {};
  const c = v2cLookup(state, selectedId);
  const status = v.stalled ? "BREAKDOWN" : v.phase.replace("_", " ");
  const dr = pos.mode === "DEAD_RECKONING";

  title.textContent = `Vehicle Detail — ${selectedId}`;
  detail.innerHTML =
    curveAdvisoryHtml(v, state.recommended_speed[selectedId], risk, fusion) +
    row("Status", status) +
    row("Speed", `${v.speed_kmh} km/h`) +
    row("Heading", `${v.heading_deg}°`) +
    row("Bench", v.bench) +
    row("Elevation", `${v.elevation_m} m`) +
    row("Destination", v.destination) +
    row("Radar Range", sensors.radar && sensors.radar.detected ? `${sensors.radar.distance_m} m` : "no object") +
    row("Thermal Angle", sensors.thermal && sensors.thermal.detected ? `${sensors.thermal.centroid_angle_deg}°` : "no heat source") +
    row("RTK-GNSS", `<span class="pill ${pos.rtk_status === "ACTIVE" ? "pill-ok" : "pill-warn"}">${pos.rtk_status || "--"}</span>`) +
    row("Positioning", `<span class="pill ${dr ? "pill-warn" : "pill-ok"}">${dr ? "DEAD RECKONING" : "RTK-GNSS"}</span>`) +
    row("IMU", `<span class="pill ${sensors.imu && sensors.imu.status === "ACTIVE" ? "pill-ok" : "pill-warn"}">${sensors.imu ? sensors.imu.status : "--"}</span>`) +
    row("Wheel Odometry", `<span class="pill pill-ok">${sensors.wheel_speed ? sensors.wheel_speed.status : "--"}</span>`) +
    row("V2X OBU", `<span class="pill ${obu.status === "CONNECTED" ? "pill-ok" : "pill-warn"}">${obu.status || "--"}</span>`) +
    row("Raspberry Pi 5", `<span class="pill ${edge.status === "ACTIVE" ? "pill-ok" : "pill-warn"}">${edge.status || "--"}</span>`);

  const dot = (ok) => `<span class="pill ${ok ? "pill-ok" : "pill-warn"}">● ${ok ? "ACTIVE" : "INACTIVE"}</span>`;

  sensorPanel.innerHTML = `
    <div class="onboard-card">
      <div class="onboard-header">${selectedId} ONBOARD SYSTEM</div>

      <div class="onboard-row">
        <span>77GHz RADAR</span>
        <span class="${sensors.radar && sensors.radar.detected ? "ok" : "muted"}">${sensors.radar && sensors.radar.detected ? "ACTIVE" : "NO OBJECT"}</span>
      </div>
      ${sensors.radar && sensors.radar.detected ? `<div class="onboard-sub">Range: ${sensors.radar.distance_m} m &nbsp; Closing: ${sensors.radar.relative_speed_mps} m/s</div>` : ""}

      <div class="onboard-row">
        <span>LWIR THERMAL</span>
        <span class="${sensors.thermal && sensors.thermal.detected ? "ok" : "muted"}">${sensors.thermal && sensors.thermal.detected ? "ACTIVE" : "NO OBJECT"}</span>
      </div>
      ${sensors.thermal && sensors.thermal.detected ? `<div class="onboard-sub">Centroid: ${sensors.thermal.centroid_angle_deg}° (${sensors.thermal.direction}) &nbsp; Confidence: ${sensors.thermal.confidence}%</div>` : ""}

      <div class="onboard-row">
        <span>RTK-GNSS</span>
        <span class="${pos.rtk_status === "ACTIVE" ? "ok" : "warn"}">${pos.rtk_status || "--"}</span>
      </div>
      ${pos.rtk_status === "ACTIVE" ? `<div class="onboard-sub">X: ${sensors.rtk.x}, Y: ${sensors.rtk.y} &nbsp; Accuracy: ${sensors.rtk.accuracy_cm} cm</div>` : ""}

      <div class="onboard-row">
        <span>MEMS IMU</span>
        <span class="${sensors.imu.status === "ACTIVE" ? "ok" : "warn"}">${sensors.imu.status} &nbsp; ${sensors.imu.heading_deg}°</span>
      </div>
      <div class="onboard-sub">Yaw rate: ${sensors.imu.yaw_rate_deg_s}°/s &nbsp; Accel: ${sensors.imu.acceleration_mps2} m/s² &nbsp; ${sensors.imu.orientation} &nbsp; ${sensors.imu.motion_state}</div>

      <div class="onboard-row">
        <span>WHEEL ODOMETRY</span>
        <span class="ok">ACTIVE &nbsp; ${sensors.wheel_speed.speed_kmh} km/h</span>
      </div>
      <div class="onboard-sub">Total: ${sensors.wheel_speed.odometry_m} m &nbsp; ${sensors.wheel_speed.travel_direction}${dr ? ` &nbsp; Since GNSS loss: ${pos.distance_since_loss_m} m` : ""}</div>

      <div class="onboard-row">
        <span>V2X OBU</span>
        <span class="${obu.status === "CONNECTED" ? "ok" : "warn"}">${obu.status}</span>
      </div>

      <div class="onboard-row">
        <span>RASPBERRY PI 5</span>
        <span class="${edge.status === "ACTIVE" ? "ok" : "warn"}">${edge.status} &nbsp; ${edge.edge_processing}</span>
      </div>
      <div class="onboard-sub">Inputs: ${edge.sensor_inputs_active}/${edge.sensor_inputs_total} &nbsp; Load: ${edge.processing_load_pct}% (${edge.processing_level})</div>

      <div class="onboard-divider"></div>

      <div class="onboard-row">
        <span>POSITIONING</span>
        <span class="${dr ? "warn" : "ok"}">${dr ? "DEAD RECKONING" : "RTK-GNSS"}</span>
      </div>
      ${dr ? `<div class="onboard-sub">Source: IMU + WHEEL ODOMETRY &nbsp; Drift: ${pos.drift_m} m</div>` : `<div class="onboard-sub">Source: RTK-GNSS + IMU + WHEEL ODOMETRY</div>`}

      <div class="onboard-row"><span>V2V</span>${dot(obu.v2v === "ACTIVE")}</div>
      <div class="onboard-row"><span>V2I</span>${dot(obu.v2i === "ACTIVE")}</div>
      <div class="onboard-row"><span>V2C</span>${dot(obu.v2c === "ACTIVE")}</div>
    </div>
  `;

  if (risk.other_id) {
    const ttcText = risk.ttc_s !== null ? `${risk.ttc_s} s` : "not closing";
    riskCard.innerHTML = `
      <div class="fusion-card">
        <b>${selectedId} ↔ ${risk.other_id}</b> &nbsp; <span class="badge ${risk.level}">${risk.level}</span>
        <div>Gap: ${risk.gap_m} m &nbsp; TTC: ${ttcText} &nbsp; ${risk.relation || ""}</div>
      </div>`;
  } else {
    riskCard.innerHTML = '<div class="label">No other vehicle within sensor range.</div>';
  }

  const v2vPartners = (state.v2v_messages || [])
    .filter((m) => m.sender === selectedId || m.receiver === selectedId)
    .map((m) => (m.sender === selectedId ? m.receiver : m.sender));
  chain.innerHTML = `
    <div class="chain-row"><span class="chain-label">V2V</span><span>${v2vPartners.length ? "↔ " + [...new Set(v2vPartners)].join(", ") : "no vehicles in range"}</span></div>
    <div class="chain-row"><span class="chain-label">V2I</span><span>${v2i.connected ? `↔ ${v2i.node.name} (${v2i.gap_m} m)` : "not connected"}</span></div>
    <div class="chain-row"><span class="chain-label">V2C</span><span>${c.v2x_status === "CONNECTED" ? "↔ Control Centre" : "disconnected"}</span></div>
    ${(obu.log || []).map((line) => `<div class="chain-row obu-log">${line}</div>`).join("")}
  `;
}

document.getElementById("fog-select").addEventListener("change", (e) => fetch(`/api/fog/${e.target.value}`, { method: "POST" }));

let autoOn = false;
document.getElementById("fog-auto-btn").addEventListener("click", () => {
  autoOn = !autoOn;
  fetch(`/api/fog-auto/${autoOn}`, { method: "POST" });
});

let demoActive = false;
document.getElementById("demo-btn").addEventListener("click", () => {
  demoActive = !demoActive;
  fetch(`/api/demo/${demoActive ? "start" : "stop"}`, { method: "POST" });
});

let paused = false;
document.getElementById("pause-btn").addEventListener("click", () => {
  paused = !paused;
  fetch(`/api/pause/${paused}`, { method: "POST" });
});

document.getElementById("reset-btn").addEventListener("click", () => {
  fetch("/api/reset", { method: "POST" });
  selectVehicle(null);
});

document.getElementById("sim-speed-select").addEventListener("change", (e) => {
  fetch(`/api/sim-speed/${e.target.value}`, { method: "POST" });
});

let gpsDenied = false;
document.getElementById("gps-denied-btn").addEventListener("click", () => {
  gpsDenied = !gpsDenied;
  fetch(`/api/gps-denied/${gpsDenied}`, { method: "POST" });
});

let v2xOn = true;
document.getElementById("v2x-btn").addEventListener("click", () => {
  v2xOn = !v2xOn;
  fetch(`/api/v2x/${v2xOn}`, { method: "POST" });
});

document.getElementById("links-btn").addEventListener("click", (e) => {
  showLinks = !showLinks;
  e.target.textContent = `Links: ${showLinks ? "ON" : "OFF"}`;
});

connectFognetSocket(
  render,
  () => {
    connDot.classList.add("connected");
    connText.textContent = "connected";
  },
  () => {
    connDot.classList.remove("connected");
    connText.textContent = "reconnecting...";
  }
);
