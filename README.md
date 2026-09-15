# Queue Log

A tiny installable web app for timing how long a queue took — start the
timer when you join, stop it when you're done, and it logs the wait time
along with the weather at that moment, automatically. Built for a small
group logging CROUS dining-hall queues, but the code has nothing
CROUS-specific baked in beyond the configurable lists below.

No app store, no native build tools, no backend server to run — it's
static HTML/CSS/JS talking directly to Firebase, and it installs to a
phone's home screen like a regular app.

*The app was written entirely by AI!* Claude Sonnet 5 (medium effort)
free version was used, starting from a sketch made by ChatGPT.

## What it does

- **Two taps, nothing else.** Tap the dial to start, tap again to stop.
  There's no form to fill in and no Save button — the entry (place,
  start/stop time) is written the instant you stop, and a green
  confirmation toast shows the wait time.
- **Weather is automatic.** Temperature and rain/snow/fog are fetched
  from [Open-Meteo](https://open-meteo.com) (free, no API key) using
  each place's fixed coordinates — no GPS permission prompt on anyone's
  phone.
- **Works with no connection.** Entries save to the phone instantly
  either way (Firestore's offline queue) and sync once back online. If
  the weather fetch can't complete right away, the entry is saved with
  the timing only and the weather is filled in automatically later,
  using historical hourly weather for the *exact* time the entry was
  logged — not whatever the weather happens to be whenever the phone
  reconnects.
- **Registers once per phone.** First launch asks for a full name and an
  institution (picked from a fixed list); both are remembered locally
  from then on — no accounts, no passwords.
- **Shared history + CSV export.** A "Recent entries" view lists
  everyone's logged waits, with a one-tap CSV export for further
  analysis (pandas, Excel, whatever).
- **Leaderboard.** Top 5 contributors by number of entries, with a
  configurable exclude-list for test accounts.
- **Rules page.** A short, editable list of house rules for how/when to
  time a queue, kept out of the way until someone taps to view it.
- **Installable (PWA).** "Add to Home Screen" gives it a real app icon
  and lets it open without a browser address bar.

## Why a web app instead of a native app

The obvious alternative — a native Android/iOS app via Flutter or
similar — needs a real build toolchain (Android Studio, Gradle, SDKs,
emulators) that's fragile, slow to set up, and unrelated to what the app
actually does. This is plain static files instead: open `index.html` in
a browser and it works, with Firebase's web SDK loaded straight from a
CDN link. Anyone can read, edit, and redeploy it with nothing more than
a text editor.

## Tech stack

- **Frontend:** plain HTML/CSS/JavaScript (ES modules), no framework, no
  build step
- **Backend:** [Firebase](https://firebase.google.com) — Authentication
  (anonymous) + Firestore, on the free Spark plan
- **Weather:** [Open-Meteo](https://open-meteo.com) — current weather at
  save time, historical hourly weather for offline backfill
- **Offline/installable:** a small service worker (`sw.js`) for the app
  shell, plus Firestore's built-in offline persistence for data

## Getting started

### 1. Configure the lists

Everything specific to a deployment lives as plain arrays at the top of
`app.js` — no other code changes needed to adapt this for a different
group or location:

```js
const PRESET_LOCATIONS = [
  { name: "Place 1", lat: 0, lon: 0, note: "near the supermarket" },
  // ...
];
const PRESET_INSTITUTIONS = ["Institution 1", /* ... */];
const RULES = ["Start the timer when you join the queue...", /* ... */];
const EXCLUDED_FROM_LEADERBOARD = ["Test account name"];
```

For each place's coordinates: open Google Maps, right-click (or
long-press on a phone) the spot, and tap the lat/lon numbers shown.

### 2. Create a Firebase project (free)

1. At [console.firebase.google.com](https://console.firebase.google.com),
   create a project and register a **Web app** (the `</>` icon) to get a
   `firebaseConfig` object.
2. Paste those six values into `FIREBASE_CONFIG` near the top of
   `app.js` — keep the constant named `FIREBASE_CONFIG` exactly (not
   Firebase's own `firebaseConfig`).
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Enable **Firestore Database**, then set its rules to:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

   (Any signed-in — even anonymous — user can read/write. Fine for a
   small trusted group; tighten if opening this up more broadly.)

### 3. Run it locally

No install needed beyond Python (already on most systems):

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` — geolocation isn't used, but `localhost`
plays nicely with everything else regardless.

### 4. Deploy

Any static host works. The simplest free option is **GitHub Pages**:
push this repo, then enable Pages under **Settings → Pages → Deploy from
a branch → main → / (root)**. HTTPS is required for the PWA install
prompt to show up, which GitHub Pages provides by default.

## Data model

Firestore collection `queueEvents`, one document per logged entry:

| field | meaning |
|---|---|
| `userId` | anonymous device ID |
| `username` | full name entered at registration |
| `institution` | picked from `PRESET_INSTITUTIONS` |
| `locationName` | which place (from `PRESET_LOCATIONS`) |
| `startTime` / `endTime` | ISO timestamps |
| `waitDurationSeconds` | computed |
| `temperatureC` | auto-fetched, `null` until weather arrives |
| `weather.rain` / `.snow` / `.fog` | auto-fetched, `null` until weather arrives |
| `weatherPending` | `true` until the weather step completes |
| `dayOfWeek` / `hourOfDay` | computed, for easy analysis |

## Project structure

```
queue-logger/
  index.html      markup + all styling
  app.js          all app logic (auth, timer, weather, Firestore)
  manifest.json   PWA manifest (installable home-screen app)
  sw.js           service worker for the offline app shell
  icons/          app icon, 192px and 512px
  make_icons.py   optional script to regenerate the icons
```

## Known trade-offs

- **No manual weather correction.** Since there's no review step before
  saving, an occasional wrong reading from the weather API can't be
  fixed in the moment — a deliberate choice to keep logging to two taps.
- **Offline weather backfill depends on that same device.** If a phone
  logs an entry offline and never reopens the app while online again,
  that entry's weather fields stay blank (`weatherPending: true`
  forever). Everything else about the entry (time, place) is unaffected.
- **Single-timezone assumption.** The offline weather backfill builds
  its historical-lookup timestamp from the phone's local clock, assuming
  the phone and the logged place share a timezone — true for any
  single-city deployment like this one.

## Troubleshooting

- **`Uncaught ReferenceError: FIREBASE_CONFIG is not defined`** — you
  pasted Firebase's own snippet (`const firebaseConfig = {...}`,
  lowercase) instead of filling in the existing `FIREBASE_CONFIG` block.
- **Full-screen dark banner on load** — `FIREBASE_CONFIG` still has its
  placeholder values.
- **Red banner: "Not connected to Firebase" / "Sign-in failed"** —
  Anonymous auth isn't enabled, or a config value doesn't match the
  Firebase project.
- **Entries not syncing across phones** — check the Firestore rules
  above are published, and that Anonymous auth is enabled.
- **Anything else** — open the browser's dev tools (F12) → Console tab →
  reload. The error shown there almost always names the exact problem.
