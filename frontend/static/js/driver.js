/**
 * Driver interface — deliberately minimal: one big status word, one icon,
 * one short sub-line, and four plain number tiles. No map, no clutter.
 */
const params = new URLSearchParams(location.search);
const select = document.getElementById("vehicle-select");
if (params.get("vehicle")) select.value = params.get("vehicle");

const body = document.getElementById("driver-body");

const STATUS_MAP = {
  GREEN: { text: "SAFE", icon: "✅" },
  YELLOW: { text: "CAUTION", icon: "⚠️" },
  ORANGE: { text: "HIGH RISK", icon: "🚨" },
  RED: { text: "CRITICAL", icon: "🛑" },
};

let currentLevel = "GREEN";
let audioCtx = null;

function beep(freq, duration) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  gain.gain.value = 0.06;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

document.addEventListener(
  "click",
  () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  { once: true }
);

function buzzerLoop() {
  if (currentLevel === "RED") beep(880, 0.18);
  else if (currentLevel === "ORANGE") beep(660, 0.12);
  const nextDelay = currentLevel === "RED" ? 700 : 1400;
  setTimeout(buzzerLoop, nextDelay);
}
buzzerLoop();

function render(state) {
  const vid = select.value;
  const v = state.vehicles[vid];
  const risk = state.risk[vid];
  const rec = state.recommended_speed[vid];
  if (!v || !risk) return;

  currentLevel = v.hazard_status;
  const info = STATUS_MAP[currentLevel] || STATUS_MAP.GREEN;

  body.className = `driver-body status-${currentLevel}`;
  document.getElementById("driver-icon").textContent = info.icon;
  document.getElementById("driver-status").textContent = info.text;

  let sub = `Visibility: ${state.fog.visibility_m} m`;
  if (currentLevel === "YELLOW" && risk.ahead_id) sub = `Vehicle ahead – ${risk.gap_m} m`;
  if (currentLevel === "ORANGE" && risk.ttc_s) sub = `Vehicle approaching – TTC ${risk.ttc_s} s`;
  if (currentLevel === "RED") sub = "STOP / BRAKE — Collision risk";
  document.getElementById("driver-sub").textContent = sub;

  document.getElementById("tile-speed").textContent = v.speed_kmh;
  document.getElementById("tile-recommended").textContent = rec;
  document.getElementById("tile-distance").textContent = risk.gap_m !== null ? risk.gap_m : "--";
  document.getElementById("tile-ttc").textContent = risk.ttc_s !== null ? risk.ttc_s : "--";
}

connectFognetSocket(render);
