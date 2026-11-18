const relays = [
  { id: 1, label: "CH1: Bohlam 1 (Heat)", type: "heat", on: false },
  { id: 2, label: "CH2: Bohlam 2 (Heat)", type: "heat", on: false },
  { id: 3, label: "CH3: Kipas 1 (Cool)", type: "fan", on: false },
  { id: 4, label: "CH4: Kipas 2 (Cool)", type: "fan", on: false }
];

let autoMode = true;
let targetTemp = 33.0;
let currentTemp = 32.2;
let espBaseUrl = localStorage.getItem("esp32_url") || "";

const relayGrid = document.getElementById("relay-grid");
const tempDisplay = document.getElementById("temp-display");
const humDisplay = document.getElementById("hum-display");
const targetInput = document.getElementById("target-temp");
const modeBtn = document.getElementById("mode-toggle");
const statusBadge = document.getElementById("status-badge");
const espIpInput = document.getElementById("esp-ip");
const camImg = document.getElementById("cam-stream");

espIpInput.value = espBaseUrl;

function renderRelays() {
  relayGrid.innerHTML = "";
  relays.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "relay-btn" + (r.on ? " on" : "");
    btn.innerHTML = `<span class="name">${r.label}</span><span class="state">${r.on ? "AKTIF (ON)" : "MATI (OFF)"}</span>`;
    btn.onclick = () => {
      autoMode = false;
      modeBtn.textContent = "Auto: OFF (Manual)";
      r.on = !r.on;
      renderRelays();
      sendRelayState(r.id, r.on);
    };
    relayGrid.appendChild(btn);
  });
}

function applyHysteresis(temp) {
  if (!autoMode) return;
  const low = targetTemp - 0.5;
  const high = targetTemp + 0.5;
  if (temp < low) {
    relays.forEach((r) => { r.on = r.type === "heat"; });
  } else if (temp > high) {
    relays.forEach((r) => { r.on = r.type === "fan"; });
  } else {
    relays.forEach((r) => { r.on = false; });
  }
  renderRelays();
}

async function sendRelayState(id, state) {
  if (!espBaseUrl) return;
  try {
    await fetch(`${espBaseUrl}/relay?ch=${id}&state=${state ? 1 : 0}`);
  } catch (_) {}
}

async function pollTelemetry() {
  if (espBaseUrl) {
    try {
      const res = await fetch(`${espBaseUrl}/telemetry`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        currentTemp = Number(data.temp);
        tempDisplay.textContent = `${currentTemp.toFixed(1)} °C`;
        humDisplay.textContent = `Kelembapan: ${data.hum ?? "--"}% | Hysteresis: ±0.5 °C`;
        statusBadge.textContent = `Terhubung: ${espBaseUrl}`;
        applyHysteresis(currentTemp);
        return;
      }
    } catch (_) {}
  }
  currentTemp = Number((currentTemp + (Math.random() - 0.48) * 0.25).toFixed(1));
  tempDisplay.textContent = `${currentTemp.toFixed(1)} °C`;
  humDisplay.textContent = `Kelembapan: 62% | Hysteresis: ±0.5 °C`;
  statusBadge.textContent = "Mode Simulasi (Masukkan IP ESP32-S3)";
  applyHysteresis(currentTemp);
}

document.getElementById("save-target").onclick = () => {
  const val = parseFloat(targetInput.value);
  if (!Number.isNaN(val)) {
    targetTemp = val;
    applyHysteresis(currentTemp);
  }
};

modeBtn.onclick = () => {
  autoMode = !autoMode;
  modeBtn.textContent = autoMode ? "Auto: ON" : "Auto: OFF (Manual)";
  if (autoMode) applyHysteresis(currentTemp);
};

document.getElementById("connect-esp").onclick = () => {
  espBaseUrl = espIpInput.value.trim().replace(/\/+$/, "");
  localStorage.setItem("esp32_url", espBaseUrl);
  if (espBaseUrl) {
    camImg.src = `${espBaseUrl}/stream`;
    pollTelemetry();
  } else {
    camImg.removeAttribute("src");
  }
};

if (espBaseUrl) {
  camImg.src = `${espBaseUrl}/stream`;
}
renderRelays();
pollTelemetry();
setInterval(pollTelemetry, 2500);
