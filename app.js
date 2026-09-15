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
//
// FLOW: this is fully automatic — Start, Stop, done. There is no Save
// button and no editable weather. The entry (place + times) is written to
// Firestore the instant you Stop, and the weather is filled in right
// after, automatically. If there's no connection at that moment, the
// entry still saves immediately (Firestore's offline queue handles that),
// and the weather reading is deferred: this device keeps a small local
// list of "weather still needed" entries and retries them — using
// Open-Meteo's historical hourly data for the exact time the entry was
// logged, not "right now" — every time the app finds itself online again.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, getDocs, query, orderBy, limit,
  serverTimestamp, enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// The fixed list of places this is used for, with coordinates so the
// weather lookup works without ever asking the phone for GPS access.
//
// To find coordinates: open Google Maps, right-click the spot (or
// long-press on a phone) and tap the lat/lon numbers shown — that copies
// them. Paste the first number as lat, the second as lon.
const PRESET_LOCATIONS = [  // ###########################################################################################################
  { name: "CROUS Escoffier",       lat: 48.713591, lon: 2.201872, note: "near Franprix" },
  { name: "CROUS l'Experimental",   lat: 48.714001, lon: 2.195787, note: "near AgroParisTech - INRAE" },
];

// The list offered in the institution dropdown at registration. Edit this
// to match your actual list — it's the only thing to change.
const PRESET_INSTITUTIONS = [  // ###########################################################################################################
  "Ecole Polytechnique",
  "ENSTA",
  "ENSAE",
  "Telecom Paris",
  "Telecom SudParis",
];

// Shown in the collapsible "Rules" panel on the main page, in order.
// Add, remove, or reword lines here — no other change needed.
const RULES = [     // ###########################################################################################################
  "Start the timer when you join the queue — or when you pick up your first tray, if there's no line.",
  "Stop the timer right after you pay.",
  "If the CROUS hasn't opened yet, start the timer anyway, when you arrive.",
  "Start the timer even if you are with other active users. This will increase data accuracy in your timeslot."
];

// Names to leave out of the Leaderboard (e.g. test accounts). Matching
// ignores case and extra spaces, so "Test " and "test" both match "test".
const EXCLUDED_FROM_LEADERBOARD = [     // ###########################################################################################################
  "Teofil Voicu testing",
  "Teofil Voicu",
];

const FIREBASE_CONFIG = {  // ###########################################################################################################
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
const LS_PENDING_WEATHER = "ql_pending_weather";

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
const locationNote = document.getElementById("locationNote");
const connStatus = document.getElementById("connStatus");

const dialBtn = document.getElementById("dialBtn");
const dialTime = document.getElementById("dialTime");
const dialLabel = document.getElementById("dialLabel");
const dialHint = document.getElementById("dialHint");
const discardBtn = document.getElementById("discardBtn");
const saveToast = document.getElementById("saveToast");

const historyLink = document.getElementById("historyLink");
const viewLog = document.getElementById("view-log");
const viewRules = document.getElementById("view-rules");
const rulesBackBtn = document.getElementById("rulesBackBtn");
const viewHistory = document.getElementById("view-history");
const backBtn = document.getElementById("backBtn");
const ledgerList = document.getElementById("ledgerList");
const exportBtn = document.getElementById("exportBtn");

const rulesToggle = document.getElementById("rulesToggle");
const rulesPanel = document.getElementById("rulesPanel");

const leaderboardLink = document.getElementById("leaderboardLink");
const viewLeaderboard = document.getElementById("view-leaderboard");
const leaderboardBackBtn = document.getElementById("leaderboardBackBtn");
const leaderboardList = document.getElementById("leaderboardList");

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
  updateLocationNote();
}

function getSelectedLocation() {
  return PRESET_LOCATIONS.find((p) => p.name === locationSelect.value);
}

function updateLocationNote() {
  const loc = getSelectedLocation();
  locationNote.textContent = loc && loc.note ? loc.note : "";
}

locationSelect.addEventListener("change", updateLocationNote);

// ---------------------------------------------------------------------------
// Rules page (plain list — see RULES above)
// ---------------------------------------------------------------------------

function initRules() {
  rulesPanel.innerHTML = RULES.map((r) => `<p class="page-note">${escapeHtml(r)}</p>`).join("");
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
  discardBtn.hidden = false;
  saveToast.hidden = true;
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
  // The entry is committed the instant Stop is pressed — there's no
  // "review before saving" step anymore, so Cancel only makes sense
  // while the timer is still running.
  discardBtn.hidden = true;

  finalizeEntry(startTime, endTime, locationSelect.value);
}

dialBtn.addEventListener("click", () => (running ? stopTimer() : startTimer()));

discardBtn.addEventListener("click", () => {
  if (!running) return;
  running = false;
  clearInterval(tickHandle);
  dialBtn.classList.remove("running");
  dialLabel.textContent = "Start";
  dialHint.textContent = "Tap when you join the queue";
  dialTime.textContent = "0:00";
  discardBtn.hidden = true;
});

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

// Right-now weather, used at the moment Stop is pressed (works when online).
async function fetchLiveWeather(loc) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current_weather=true`;
    const res = await fetch(url);
    const data = await res.json();
    const cw = data.current_weather;
    return { temperature: cw.temperature, ...weatherCodeToConditions(cw.weathercode) };
  } catch (e) {
    return null;
  }
}

// Weather for a specific past hour, used to backfill entries that were
// saved while offline. Assumes the phone's local clock and the place's
// timezone match (fine for a single-city deployment like this one).
async function fetchHistoricalWeather(loc, isoStart) {
  try {
    const d = new Date(isoStart);
    const pad = (n) => String(n).padStart(2, "0");
    const hourStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&hourly=temperature_2m,weathercode&start_hour=${hourStr}&end_hour=${hourStr}&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const temp = data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m[0];
    const code = data.hourly && data.hourly.weathercode && data.hourly.weathercode[0];
    if (temp === undefined || code === undefined) return null;
    return { temperature: temp, ...weatherCodeToConditions(code) };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pending weather queue — for entries saved while offline (or while the
// live weather fetch failed for any reason). Retried automatically every
// time the app finds itself online.
// ---------------------------------------------------------------------------

function getPendingWeather() {
  try {
    return JSON.parse(localStorage.getItem(LS_PENDING_WEATHER) || "[]");
  } catch (e) {
    return [];
  }
}

function addPendingWeather(docId, loc, isoStart) {
  const list = getPendingWeather();
  list.push({ docId, lat: loc.lat, lon: loc.lon, isoStart });
  localStorage.setItem(LS_PENDING_WEATHER, JSON.stringify(list));
}

function removePendingWeather(docId) {
  const list = getPendingWeather().filter((p) => p.docId !== docId);
  localStorage.setItem(LS_PENDING_WEATHER, JSON.stringify(list));
}

async function processPendingWeather() {
  if (!firebaseReady || !navigator.onLine) return;
  for (const p of getPendingWeather()) {
    const weather = await fetchHistoricalWeather({ lat: p.lat, lon: p.lon }, p.isoStart);
    if (!weather) continue; // still no luck — leave it queued, try again later
    try {
      await updateDoc(doc(db, "queueEvents", p.docId), {
        temperatureC: weather.temperature,
        weather: { rain: weather.rain, snow: weather.snow, fog: weather.fog },
        weatherPending: false,
      });
      removePendingWeather(p.docId);
    } catch (e) {
      // leave it queued, try again next time
    }
  }
}

// ---------------------------------------------------------------------------
// Save entry — fully automatic: the timing is written immediately, weather
// is filled in right after (or deferred if offline).
// ---------------------------------------------------------------------------

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "status-line" + (kind ? " " + kind : "");
}

let toastTimeout = null;

function showToast(headline, detail, kind) {
  clearTimeout(toastTimeout);
  saveToast.innerHTML = `${escapeHtml(headline)}${detail ? `<span class="toast-detail">${escapeHtml(detail)}</span>` : ""}`;
  saveToast.className = "toast" + (kind === "warn" ? " warn" : "");
  saveToast.hidden = false;
  toastTimeout = setTimeout(() => { saveToast.hidden = true; }, 4000);
}

async function finalizeEntry(startMs, endMs, place) {
  const loc = PRESET_LOCATIONS.find((p) => p.name === place);
  const start = new Date(startMs);
  const waitSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

  if (!firebaseReady) {
    showToast("Could not save this entry.", "Not connected to Firebase — see README.md.", "warn");
    return;
  }

  const payload = {
    userId: currentUid,
    username: getUsername(),
    institution: getInstitution(),
    locationName: place,
    startTime: start.toISOString(),
    endTime: new Date(endMs).toISOString(),
    waitDurationSeconds: waitSeconds,
    temperatureC: null,
    weather: { rain: null, snow: null, fog: null },
    weatherPending: true,
    dayOfWeek: start.getDay(),
    hourOfDay: start.getHours(),
    createdAt: serverTimestamp(),
  };

  let docRef;
  try {
    docRef = await addDoc(collection(db, "queueEvents"), payload);
    localStorage.setItem(LS_LAST_PLACE, place);
  } catch (e) {
    console.error("Failed to save entry:", e);
    showToast("Could not save this entry.", e.message, "warn");
    return;
  }

  if (!loc) {
    showToast("✓ Entry saved!", `Waited ${formatDuration(waitSeconds)}`, "ok");
    return;
  }

  const weather = await fetchLiveWeather(loc);

  if (weather) {
    try {
      await updateDoc(docRef, {
        temperatureC: weather.temperature,
        weather: { rain: weather.rain, snow: weather.snow, fog: weather.fog },
        weatherPending: false,
      });
    } catch (e) {
      addPendingWeather(docRef.id, loc, start.toISOString());
    }
    showToast("✓ Entry saved!", `Waited ${formatDuration(waitSeconds)} · ${Math.round(weather.temperature)}°C`, "ok");
  } else {
    addPendingWeather(docRef.id, loc, start.toISOString());
    showToast("✓ Entry saved!", "Weather will fill in once you're back online.", "ok");
  }
}

// ---------------------------------------------------------------------------
// History (ledger) view, Leaderboard, + CSV export
// ---------------------------------------------------------------------------

let lastLoadedEntries = [];

async function fetchAllEntries() {
  const q = query(collection(db, "queueEvents"), orderBy("startTime", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

async function loadHistory() {
  ledgerList.innerHTML = '<p class="empty-state">Loading…</p>';
  if (!firebaseReady) {
    ledgerList.innerHTML = '<p class="empty-state">Firebase not configured yet.</p>';
    return;
  }
  try {
    lastLoadedEntries = await fetchAllEntries();
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

function normalizeName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadLeaderboard() {
  leaderboardList.innerHTML = '<p class="empty-state">Loading…</p>';
  if (!firebaseReady) {
    leaderboardList.innerHTML = '<p class="empty-state">Firebase not configured yet.</p>';
    return;
  }
  try {
    const entries = await fetchAllEntries();
    const excluded = new Set(EXCLUDED_FROM_LEADERBOARD.map(normalizeName));

    // Group by normalized name so "John Doe" / "john doe" / "John Doe "
    // all count as the same person, while still showing a real name.
    const counts = new Map();
    entries.forEach((e) => {
      const norm = normalizeName(e.username);
      if (!norm || excluded.has(norm)) return;
      const existing = counts.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(norm, { displayName: (e.username || "").trim(), count: 1 });
      }
    });

    const ranked = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    renderLeaderboard(ranked);
  } catch (e) {
    leaderboardList.innerHTML = '<p class="empty-state">Could not load leaderboard (offline?).</p>';
  }
}

function renderLeaderboard(ranked) {
  if (ranked.length === 0) {
    leaderboardList.innerHTML = '<p class="empty-state">No entries yet.</p>';
    return;
  }
  leaderboardList.innerHTML = "";
  ranked.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "ledger-row";
    row.innerHTML = `
      <div class="ledger-main">
        <span class="ledger-place">#${i + 1} ${escapeHtml(r.displayName)}</span>
      </div>
      <span class="ledger-duration">${r.count}</span>
    `;
    leaderboardList.appendChild(row);
  });
}

exportBtn.addEventListener("click", () => {
  if (lastLoadedEntries.length === 0) return;
  const cols = [
    "username", "institution", "locationName", "startTime", "endTime", "waitDurationSeconds",
    "temperatureC", "rain", "snow", "fog", "dayOfWeek", "hourOfDay",
  ];
  const rows = lastLoadedEntries.map((e) => [
    e.username, e.institution, e.locationName, e.startTime, e.endTime, e.waitDurationSeconds,
    e.temperatureC, e.weather?.rain, e.weather?.snow, e.weather?.fog,
    e.dayOfWeek, e.hourOfDay,
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

// ---------------------------------------------------------------------------
// Panel switching — Rules, Recent entries, and Leaderboard are treated as
// one mutually-exclusive group: opening one closes whichever of the others
// was open, and tapping the button for the one that's already open closes
// it instead of doing nothing.
// ---------------------------------------------------------------------------

let activePanel = null; // null | "rules" | "history" | "leaderboard"

function setActivePanel(name) {
  if (activePanel === name) name = null; // tapping the open one closes it

  viewRules.hidden = name !== "rules";
  viewHistory.hidden = name !== "history";
  viewLeaderboard.hidden = name !== "leaderboard";
  viewLog.hidden = name === "rules" || name === "history" || name === "leaderboard";

  activePanel = name;

  if (name === "history") loadHistory();
  if (name === "leaderboard") loadLeaderboard();
}

rulesToggle.addEventListener("click", () => setActivePanel("rules"));
historyLink.addEventListener("click", () => setActivePanel("history"));
leaderboardLink.addEventListener("click", () => setActivePanel("leaderboard"));
rulesBackBtn.addEventListener("click", () => setActivePanel(null));
backBtn.addEventListener("click", () => setActivePanel(null));
leaderboardBackBtn.addEventListener("click", () => setActivePanel(null));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function onAuthReady() {
  processPendingWeather();
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
window.addEventListener("online", processPendingWeather);

initInstitutions();
ensureProfile();
initLocations();
initRules();
initFirebase();
updateOfflineNote();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
