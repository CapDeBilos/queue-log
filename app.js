// ============================================================================
// Queue Log — app logic
//
// This is a plain static web app (no build step). It talks to Firebase
// (Auth + Firestore) using the modular SDK loaded straight from Google's
// CDN, so there is nothing to install locally beyond a text editor and a
// browser.
//
// SETUP: paste your own Firebase project's config into FIREBASE_CONFIG
// below. See README.md for how to create the (free) Firebase project.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, orderBy, limit,
  serverTimestamp, enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// The fixed list of places this is used for, with coordinates so the
// weather lookup works without ever asking the phone for GPS access.
//
// To find coordinates: open Google Maps, right-click the spot (or
// long-press on a phone) and tap the lat/lon numbers shown — that copies
// them. Paste the first number as lat, the second as lon.
const PRESET_LOCATIONS = [
  { name: "CROUS Versailles", lat: 48.713591, lon: 2.201872 },
  { name: "CROUS l'Experimental", lat: 48.714001, lon: 2.195787 },
];

// The list offered in the institution dropdown at registration. Edit this
// to match your actual list — it's the only thing to change.
const PRESET_INSTITUTIONS = [
  "Ecole Polytechnique",
  "ENSTA",
  "ENSAE",
  "Telecom Paris",
  "Telecom SudParis",
];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzWaEr2plOZNazeMBTaP0QX3FmJ18mST8",
  authDomain: "queue-log.firebaseapp.com",
  projectId: "queue-log",
  storageBucket: "queue-log.firebasestorage.app",
  messagingSenderId: "984373761196",
  appId: "1:984373761196:web:658177c6bc7320f6243b09"
};

const LS_USERNAME = "ql_username";
const LS_INSTITUTION = "ql_institution";
const LS_LAST_PLACE = "ql_last_place";

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------

let db = null;
let auth = null;
let currentUid = null;
let firebaseReady = false;

function initFirebase() {
  if (FIREBASE_CONFIG.apiKey === "REPLACE_ME") {
    showConfigWarning();
    return;
  }
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);

  enableIndexedDbPersistence(db).catch(() => {
    // Fails silently if multiple tabs are open, or the browser doesn't
    // support it — the app still works online, it just won't queue
    // writes made while offline.
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUid = user.uid;
      firebaseReady = true;
      connStatus.hidden = true;
      delete connStatus.dataset.kind;
      onAuthReady();
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error("Firebase anonymous sign-in failed:", err);
        showConnError("Sign-in failed: " + err.message + " — check Anonymous auth is enabled in Firebase.");
      });
    }
  });

  // If we still haven't connected after a few seconds, say so on-screen
  // instead of failing silently later at save time.
  setTimeout(() => {
    if (!firebaseReady) {
      showConnError("Not connected to Firebase yet — entries won't save until this is fixed (see README).");
    }
  }, 6000);
}

function showConnError(msg) {
  connStatus.textContent = msg;
  connStatus.className = "status-line err";
  connStatus.dataset.kind = "error";
  connStatus.hidden = false;
}

function showConfigWarning() {
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;inset:0;background:#22303C;color:#EDE7DA;" +
    "font-family:system-ui,sans-serif;padding:24px;font-size:15px;" +
    "line-height:1.5;z-index:999;overflow:auto;";
  banner.innerHTML =
    "<h2 style='margin-top:0;'>Firebase isn't configured yet</h2>" +
    "<p>Open <code>app.js</code> and replace the <code>FIREBASE_CONFIG</code> " +
    "placeholder values with your own Firebase project's config " +
    "(see README.md — it takes about 5 minutes and stays on the free plan).</p>";
  document.body.appendChild(banner);
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const whoName = document.getElementById("whoName");
const whoInstitution = document.getElementById("whoInstitution");
const changeNameBtn = document.getElementById("changeNameBtn");
const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const institutionSelect = document.getElementById("institutionSelect");
const nameError = document.getElementById("nameError");
const nameSaveBtn = document.getElementById("nameSaveBtn");

const locationSelect = document.getElementById("locationSelect");
const connStatus = document.getElementById("connStatus");

const dialBtn = document.getElementById("dialBtn");
const dialTime = document.getElementById("dialTime");
const dialLabel = document.getElementById("dialLabel");
const dialHint = document.getElementById("dialHint");

const details = document.getElementById("details");
const waitedValue = document.getElementById("waitedValue");
const tempValue = document.getElementById("tempValue");
const rainChips = document.getElementById("rainChips");
const snowChip = document.getElementById("snowChip");
const fogChip = document.getElementById("fogChip");
const noteToggle = document.getElementById("noteToggle");
const notesInput = document.getElementById("notesInput");
const saveBtn = document.getElementById("saveBtn");
const discardBtn = document.getElementById("discardBtn");
const statusLine = document.getElementById("statusLine");

const historyLink = document.getElementById("historyLink");
const viewLog = document.getElementById("view-log");
const viewHistory = document.getElementById("view-history");
const backBtn = document.getElementById("backBtn");
const ledgerList = document.getElementById("ledgerList");
const exportBtn = document.getElementById("exportBtn");

// ---------------------------------------------------------------------------
// Registration: full name + institution (persisted on-device; no password,
// no repeated login)
// ---------------------------------------------------------------------------

function getUsername() {
  return localStorage.getItem(LS_USERNAME) || "";
}

function getInstitution() {
  return localStorage.getItem(LS_INSTITUTION) || "";
}

function initInstitutions() {
  institutionSelect.innerHTML = "";
  PRESET_INSTITUTIONS.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    institutionSelect.appendChild(opt);
  });
}

function ensureProfile() {
  const existingName = getUsername();
  const existingInst = getInstitution();

  if (existingName && existingInst) {
    whoName.textContent = existingName;
    whoInstitution.textContent = "· " + existingInst;
    nameModal.hidden = true;
  } else {
    nameInput.value = existingName;
    if (existingInst) institutionSelect.value = existingInst;
    nameError.hidden = true;
    nameModal.hidden = false;
    nameInput.focus();
  }
}

nameSaveBtn.addEventListener("click", () => {
  const val = nameInput.value.trim();
  const inst = institutionSelect.value;

  if (!val || !inst) {
    nameError.textContent = "Please enter your name and pick an institution.";
    nameError.hidden = false;
    return;
  }

  localStorage.setItem(LS_USERNAME, val);
  localStorage.setItem(LS_INSTITUTION, inst);
  whoName.textContent = val;
  whoInstitution.textContent = "· " + inst;
  nameError.hidden = true;
  nameModal.hidden = true;
});

changeNameBtn.addEventListener("click", () => {
  nameInput.value = getUsername();
  institutionSelect.value = getInstitution();
  nameError.hidden = true;
  nameModal.hidden = false;
  nameInput.focus();
});

// ---------------------------------------------------------------------------
// Places — a fixed preset list (see PRESET_LOCATIONS above). No network or
// auth dependency, so the dropdown always works even before Firebase is
// connected.
// ---------------------------------------------------------------------------

function initLocations() {
  const lastPlace = localStorage.getItem(LS_LAST_PLACE);
  locationSelect.innerHTML = "";

  PRESET_LOCATIONS.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    locationSelect.appendChild(opt);
  });

  if (lastPlace && PRESET_LOCATIONS.some((p) => p.name === lastPlace)) {
    locationSelect.value = lastPlace;
  }
}

function getSelectedLocation() {
  return PRESET_LOCATIONS.find((p) => p.name === locationSelect.value);
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

let running = false;
let startTime = null;
let endTime = null;
let tickHandle = null;

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tick() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  dialTime.textContent = formatDuration(elapsed);
}

function startTimer() {
  if (!locationSelect.value) {
    setStatus(connStatus, "Pick a place first", "err");
    connStatus.hidden = false;
    return;
  }
  running = true;
  startTime = Date.now();
  dialBtn.classList.add("running");
  dialLabel.textContent = "Stop";
  dialHint.textContent = "Tap when you're done";
  details.hidden = true;
  tickHandle = setInterval(tick, 250);
}

function stopTimer() {
  running = false;
  endTime = Date.now();
  clearInterval(tickHandle);
  dialBtn.classList.remove("running");
  dialLabel.textContent = "Start";
  dialHint.textContent = "Tap when you join the queue";
  dialTime.textContent = "0:00";

  const waitSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  waitedValue.textContent = formatDuration(waitSeconds);
  waitedValue.dataset.seconds = String(waitSeconds);

  resetDetailsForm();
  details.hidden = false;
  fetchWeather();
}

dialBtn.addEventListener("click", () => (running ? stopTimer() : startTimer()));

// ---------------------------------------------------------------------------
// Weather automation (Open-Meteo — free, no API key)
// ---------------------------------------------------------------------------

function weatherCodeToConditions(code) {
  // https://open-meteo.com/en/docs — WMO weather codes
  if ([45, 48].includes(code)) return { rain: "none", snow: false, fog: true };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { rain: "none", snow: true, fog: false };
  if ([51, 53, 56, 61, 80].includes(code)) return { rain: "mild", snow: false, fog: false };
  if ([55, 57, 63, 65, 66, 67, 81, 82, 95, 96, 99].includes(code)) return { rain: "heavy", snow: false, fog: false };
  return { rain: "none", snow: false, fog: false }; // clear / cloudy
}

function selectRain(val) {
  [...rainChips.children].forEach((c) => c.classList.toggle("on", c.dataset.val === val));
}

function setChipOn(chip, on) {
  chip.classList.toggle("on", on);
}

async function fetchWeather() {
  tempValue.innerHTML = '…<span class="auto-tag">auto</span>';

  const loc = getSelectedLocation();
  if (!loc) {
    tempValue.innerHTML = 'n/a<span class="auto-tag">unknown place</span>';
    return;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current_weather=true`;
    const res = await fetch(url);
    const data = await res.json();
    const cw = data.current_weather;
    setTemperature(cw.temperature, "auto");

    const cond = weatherCodeToConditions(cw.weathercode);
    selectRain(cond.rain);
    setChipOn(snowChip, cond.snow);
    setChipOn(fogChip, cond.fog);
  } catch (e) {
    tempValue.innerHTML = 'n/a<span class="auto-tag">fetch failed \u2014 tap to enter</span>';
  }
}

function setTemperature(value, tag) {
  tempValue.innerHTML = `${Math.round(value)}\u00B0C<span class="auto-tag">${tag}</span>`;
  tempValue.dataset.value = value;
}

tempValue.addEventListener("click", () => {
  const current = tempValue.dataset.value !== undefined ? Math.round(tempValue.dataset.value) : "";
  const entered = window.prompt("Temperature in \u00B0C:", current);
  if (entered === null || entered.trim() === "") return;
  const num = Number(entered);
  if (Number.isNaN(num)) return;
  setTemperature(num, "manual");
});

rainChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  selectRain(chip.dataset.val);
});
snowChip.addEventListener("click", () => setChipOn(snowChip, !snowChip.classList.contains("on")));
fogChip.addEventListener("click", () => setChipOn(fogChip, !fogChip.classList.contains("on")));

noteToggle.addEventListener("click", () => {
  notesInput.hidden = false;
  noteToggle.hidden = true;
  notesInput.focus();
});

function resetDetailsForm() {
  selectRain("none");
  setChipOn(snowChip, false);
  setChipOn(fogChip, false);
  notesInput.value = "";
  notesInput.hidden = true;
  noteToggle.hidden = false;
  tempValue.innerHTML = '—<span class="auto-tag">auto</span>';
  delete tempValue.dataset.value;
  setStatus(statusLine, "");
}

// ---------------------------------------------------------------------------
// Save entry
// ---------------------------------------------------------------------------

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "status-line" + (kind ? " " + kind : "");
}

discardBtn.addEventListener("click", () => {
  details.hidden = true;
  resetDetailsForm();
});

saveBtn.addEventListener("click", async () => {
  if (!firebaseReady) {
    setStatus(statusLine, "Firebase not configured — see README.md", "err");
    return;
  }

  const place = locationSelect.value;
  const rainChip = rainChips.querySelector(".chip.on");
  const start = new Date(startTime);

  const payload = {
    userId: currentUid,
    username: getUsername(),
    institution: getInstitution(),
    locationName: place,
    startTime: start.toISOString(),
    endTime: new Date(endTime).toISOString(),
    waitDurationSeconds: Number(waitedValue.dataset.seconds || 0),
    temperatureC: tempValue.dataset.value !== undefined ? Number(tempValue.dataset.value) : null,
    weather: {
      rain: rainChip ? rainChip.dataset.val : "none",
      snow: snowChip.classList.contains("on"),
      fog: fogChip.classList.contains("on"),
    },
    notes: notesInput.value.trim(),
    dayOfWeek: start.getDay(),
    hourOfDay: start.getHours(),
    createdAt: serverTimestamp(),
  };

  saveBtn.disabled = true;
  setStatus(statusLine, "Saving…");

  try {
    await addDoc(collection(db, "queueEvents"), payload);
    localStorage.setItem(LS_LAST_PLACE, place);
    // With offline persistence on, this resolves immediately even with no
    // signal — the write just sits queued in the phone's local storage
    // until a connection shows up, then Firestore syncs it automatically.
    // navigator.onLine tells us which case we're actually in, so the
    // message reflects reality instead of always saying the same thing.
    if (navigator.onLine) {
      setStatus(statusLine, "Saved", "ok");
    } else {
      setStatus(statusLine, "Saved on this phone — will upload once you're back online", "ok");
    }
    setTimeout(() => {
      details.hidden = true;
      setStatus(statusLine, "");
    }, navigator.onLine ? 900 : 2400);
  } catch (e) {
    // A real error (not just "offline") — e.g. permission rules rejecting
    // the write, or persistence itself failing to initialize.
    console.error("Failed to save entry:", e);
    setStatus(statusLine, "Could not save: " + e.message, "err");
  } finally {
    saveBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// History (ledger) view + CSV export
// ---------------------------------------------------------------------------

let lastLoadedEntries = [];

async function loadHistory() {
  ledgerList.innerHTML = '<p class="empty-state">Loading…</p>';
  if (!firebaseReady) {
    ledgerList.innerHTML = '<p class="empty-state">Firebase not configured yet.</p>';
    return;
  }
  try {
    const q = query(collection(db, "queueEvents"), orderBy("startTime", "desc"));
    const snap = await getDocs(q);
    lastLoadedEntries = snap.docs.map((d) => d.data());
    renderLedger(lastLoadedEntries);
  } catch (e) {
    ledgerList.innerHTML = '<p class="empty-state">Could not load entries (offline?).</p>';
  }
}

function renderLedger(entries) {
  if (entries.length === 0) {
    ledgerList.innerHTML = '<p class="empty-state">No entries yet — go log a queue.</p>';
    return;
  }
  ledgerList.innerHTML = "";
  entries.forEach((e) => {
    const row = document.createElement("div");
    row.className = "ledger-row";
    const d = new Date(e.startTime);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `
      <div class="ledger-main">
        <span class="ledger-place">${escapeHtml(e.locationName || "—")}</span>
        <span class="ledger-meta">${dateStr}, ${timeStr} · ${escapeHtml(e.username || "")}${e.institution ? " · " + escapeHtml(e.institution) : ""}</span>
      </div>
      <span class="ledger-duration">${formatDuration(e.waitDurationSeconds || 0)}</span>
    `;
    ledgerList.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

exportBtn.addEventListener("click", () => {
  if (lastLoadedEntries.length === 0) return;
  const cols = [
    "username", "institution", "locationName", "startTime", "endTime", "waitDurationSeconds",
    "temperatureC", "rain", "snow", "fog", "dayOfWeek", "hourOfDay", "notes",
  ];
  const rows = lastLoadedEntries.map((e) => [
    e.username, e.institution, e.locationName, e.startTime, e.endTime, e.waitDurationSeconds,
    e.temperatureC, e.weather?.rain, e.weather?.snow, e.weather?.fog,
    e.dayOfWeek, e.hourOfDay, (e.notes || "").replace(/[\r\n]+/g, " "),
  ]);
  const csv = [cols.join(",")]
    .concat(rows.map((r) => r.map(csvCell).join(",")))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "queue-log-export.csv";
  a.click();
  URL.revokeObjectURL(url);
});

function csvCell(val) {
  const s = val === null || val === undefined ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

historyLink.addEventListener("click", () => {
  viewLog.hidden = true;
  viewHistory.hidden = false;
  loadHistory();
});

backBtn.addEventListener("click", () => {
  viewHistory.hidden = true;
  viewLog.hidden = false;
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function onAuthReady() {
  // Places are a fixed local list now, nothing to load from the network.
}

function updateOfflineNote() {
  // Don't stomp on a real Firebase error banner if one's showing.
  if (connStatus.dataset.kind === "error") return;
  if (!navigator.onLine) {
    connStatus.textContent = "You're offline — entries save on this phone and upload once you're back online.";
    connStatus.className = "status-line";
    connStatus.hidden = false;
  } else {
    connStatus.hidden = true;
  }
}

window.addEventListener("online", updateOfflineNote);
window.addEventListener("offline", updateOfflineNote);

initInstitutions();
ensureProfile();
initLocations();
initFirebase();
updateOfflineNote();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
