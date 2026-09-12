const canvas = document.getElementById("twin-canvas");
const ctx = initTwinCanvas(canvas);

const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

function render(state) {
  drawTwin(ctx, state);
  renderVehicleTable(state);
  renderFog(state);
  renderRisk(state);
  renderFusion(state);
  renderV2VLog(state);
  renderFleet(state);
  renderEmergencies(state);
  renderDemo(state);

  document.getElementById("tick-info").textContent =
    `tick ${state.tick} · ${new Date(state.timestamp * 1000).toLocaleTimeString()}`;

  const autoBtn = document.getElementById("fog-auto-btn");
  autoBtn.textContent = `Auto-Deteriorate: ${state.fog.auto_mode ? "ON" : "OFF"}`;
}

function renderVehicleTable(state) {
  const tbody = document.getElementById("vehicle-rows");
  tbody.innerHTML = "";
  Object.values(state.vehicles).forEach((v) => {
    const rec = state.recommended_speed[v.id];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.speed_kmh} km/h</td>
      <td>${rec} km/h</td>
      <td>${v.zone_name}</td>
      <td><span class="badge ${v.hazard_status}">${v.hazard_status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFog(state) {
  document.getElementById("visibility-value").textContent = `${state.fog.visibility_m} m`;
  const statusEl = document.getElementById("fog-status-value");
  statusEl.textContent = state.fog.status;
  statusEl.className = `value fog-status-${state.fog.status}`;
}

function renderRisk(state) {
  const container = document.getElementById("risk-cards");
  container.innerHTML = "";
  Object.entries(state.risk).forEach(([vid, r]) => {
    if (!r.ahead_id) return;
    const div = document.createElement("div");
    div.className = "fusion-card";
    const ttcText = r.ttc_s !== null ? `${r.ttc_s} s` : "not closing";
    div.innerHTML = `
      <b>${vid} ↔ ${r.ahead_id}</b> &nbsp; <span class="badge ${r.level}">${r.level}</span>
      <div>Gap: ${r.gap_m} m &nbsp; TTC: ${ttcText}</div>
    `;
    container.appendChild(div);
  });
  if (!container.innerHTML) {
    container.innerHTML = '<div class="label">All vehicles clear — no vehicle within sensor range.</div>';
  }
}

function renderFusion(state) {
  const container = document.getElementById("fusion-cards");
  container.innerHTML = "";
  Object.entries(state.fusion).forEach(([vid, f]) => {
    const div = document.createElement("div");
    div.className = "fusion-card";
    const sensors = ["radar", "thermal", "v2v", "gps"];
    const tags = sensors
      .map((s) => `<span class="${f.contributing_sensors.includes(s) ? "on" : ""}">${s.toUpperCase()}</span>`)
      .join("");
    div.innerHTML = `
      <b>${vid}</b> ${f.detected ? `→ ${f.target_id} @ ${f.distance_m} m` : "(no detection)"}
      &nbsp; <span class="conf-${f.confidence}">${f.confidence}</span>
      <div class="sensor-tags">${tags}</div>
    `;
    container.appendChild(div);
  });
}

function renderV2VLog(state) {
  const log = document.getElementById("v2v-log");
  const msgs = state.v2v_messages || [];
  log.innerHTML = msgs
    .map((m) => `<div class="msg"><b>${m.sender} → ${m.receiver}</b><br>"${m.text}"</div>`)
    .join("") || '<div class="label">No V2V traffic in range.</div>';
}

function renderFleet(state) {
  const fleet = state.fleet;
  document.getElementById("fleet-recommendation").textContent = fleet.recommendation;
  document.getElementById("route-a-name").textContent = fleet.route_a.name;
  const a = document.getElementById("route-a-risk");
  a.textContent = fleet.route_a.risk;
  a.className = `route-risk-${fleet.route_a.risk}`;
  document.getElementById("route-b-name").textContent = fleet.route_b.name;
  const b = document.getElementById("route-b-risk");
  b.textContent = fleet.route_b.risk;
  b.className = `route-risk-${fleet.route_b.risk}`;
  document.getElementById("fleet-actions").innerHTML = fleet.actions.map((a) => `<li>${a}</li>`).join("");
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
    .map(
      (e) => `
      <div class="alert-banner">
        <b>${e.type.replace("_", " ")}</b> — ${e.vehicle_id}<br>
        ${e.status} @ ${e.location} (${fmtTime(e.timestamp)})
      </div>`
    )
    .join("");
}

function renderDemo(state) {
  const banner = document.getElementById("demo-banner");
  const demoBtn = document.getElementById("demo-btn");
  if (state.demo && state.demo.active) {
    banner.classList.add("show");
    document.getElementById("demo-step-title").textContent =
      `${state.demo.step_title} (${state.demo.step_index}/${state.demo.step_count})`;
    document.getElementById("demo-step-desc").textContent = state.demo.step_description;
    demoBtn.textContent = "■ STOP DEMO";
    demoBtn.classList.add("active");
  } else {
    banner.classList.remove("show");
    demoBtn.textContent = "▶ DEMO MODE";
    demoBtn.classList.remove("active");
  }
}

document.getElementById("fog-select").addEventListener("change", (e) => {
  fetch(`/api/fog/${e.target.value}`, { method: "POST" });
});

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
