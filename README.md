# Queue Log

A small web app for timing how long you wait in a queue, with weather and
temperature filled in automatically. Runs in the phone's browser — no app
store, no Flutter, no Docker, no build step. Just static files.

## Why a web app instead of the Flutter app from before

The old approach (Flutter + Android Studio + Gradle + emulators) needed a
heavy toolchain that has nothing to do with the actual app logic, and it's
exactly the kind of thing that breaks when you move to a new machine. This
version is HTML/CSS/JavaScript, using Firebase's web SDK loaded straight
from a CDN link — so there's nothing to install beyond a text editor and a
browser you already have. It still uses Firebase underneath (same free
database as before), just without the native build pipeline on top of it.

## What you need

- A text editor (anything — VS Code, Kate, even gedit)
- A browser (Firefox or Chromium, already on your Mint install)
- A free Google account, to create a Firebase project (5 minutes, one-time)
- Optionally, a free GitHub account, to put the app on the open internet
  with HTTPS so you can test it on your phone

Nothing else. No Flutter, no Docker, no npm, no Android Studio.

## 1. Set your place list

Open `app.js` and find `PRESET_LOCATIONS` near the top:

```js
const PRESET_LOCATIONS = [
  { name: "Place 1", lat: 0, lon: 0 },
  { name: "Place 2", lat: 0, lon: 0 },
  { name: "Place 3", lat: 0, lon: 0 },
];
```

Replace the names with the actual places, and fill in real coordinates
for each. Weather is looked up from these fixed coordinates rather than
the phone's live GPS — that's deliberate: it means no location-permission
prompt ever appears on anyone's phone, and it still gets the right
weather since these are specific known spots, not "wherever I am."

To find coordinates: open Google Maps, right-click the spot (long-press
on a phone), and tap the latitude/longitude numbers that pop up — that
copies them. Paste the first number as `lat`, the second as `lon`.

This is the only thing anyone needs to edit to add, rename, or move a
place — the dropdown is just this list, no server round-trip involved.

## 2. Create the Firebase project (free, one-time)

1. Go to <https://console.firebase.google.com>, sign in, click
   **Add project**, give it any name (e.g. `queue-log`), and finish the
   wizard (you can decline Google Analytics, it's not needed).
2. Inside the project, click the **</>** ("Web app") icon to register a
   web app (or, if you already registered one, click the **"1 app"**
   button on the Project Overview page to get back to it). Either way
   it'll show you a `firebaseConfig` object — copy it.
3. Open `app.js` and paste your six values into the `FIREBASE_CONFIG`
   block near the top, **keeping the name `FIREBASE_CONFIG` exactly as
   it is** — don't replace the whole line with Firebase's own
   `const firebaseConfig = {...}`, since the rest of the file refers to
   `FIREBASE_CONFIG` (all caps) specifically. Just swap in your values:

   ```js
   const FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

4. In the left sidebar, click **Security → Authentication → Get
   started → Sign-in method → Anonymous → Enable**. This is what lets
   the app remember "you" on your phone without a password. (Firebase's
   console has reorganized this menu a few times — if you don't see
   "Security" as a label, look for **Authentication** directly in the
   product list.)
5. In the left sidebar, click **Databases and storage → Firestore →
   Create database**. Pick a region close to you, start in **test
   mode** for now.
6. Once created, go to the **Rules** tab and replace the rules with:

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

   This means: anyone signed in (even anonymously) can read and write —
   fine for a small trusted group logging shared queue data. Publish the
   rule change.

That's it — the backend is done, and it's entirely on Firebase's free
Spark plan for this scale of usage.

## 3. Test it locally on your Linux Mint machine

No install needed — Python already includes a static file server:

```bash
cd queue-logger
python3 -m http.server 8000
```

(Any port works — `8000`, `8080`, whatever's free.) Then open
<http://localhost:8000> (or whichever port you used) in Firefox.
Geolocation and everything else works fine on `localhost`, even without
HTTPS. Pick a username when prompted, pick a place, tap the dial to
start/stop a timer, and confirm an entry saves (check the **Recent
entries** link, or look in the Firestore console under the
`queueEvents` collection).

If something looks wrong, open the browser's dev tools (F12) and check
the **Console** tab (not "Elements") for red error text — that's the
fastest way to see what's actually failing.

## 4. Put it on your phone

Browsers only allow geolocation over HTTPS (or `localhost`), so to use it
on your phone you need it hosted somewhere with HTTPS. The free, no-tool
way is **GitHub Pages**:

1. Create a free account at <https://github.com> if you don't have one.
2. Create a new **public** repository (e.g. `queue-log`).
3. On the repo page, use **Add file → Upload files** in the browser and
   drag in everything from this `queue-logger` folder (keep the `icons`
   folder structure).
4. Go to **Settings → Pages**, under "Build and deployment" choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`, Save.
5. After a minute, GitHub gives you a URL like
   `https://yourname.github.io/queue-log/`. Open that on your phone.
6. In the phone browser menu, choose **Add to Home Screen** (Chrome on
   Android) or **Add to Home Screen** (Safari on iOS). It now behaves
   like an installed app icon.

No git command line needed for this — it's all drag-and-drop on the
GitHub website. (If you're comfortable with git, pushing the folder works
the same way and is easier to update later.)

## Updating the app after you've already deployed it

Editing a file on your own computer does **not** change the live site —
GitHub only has whatever you last uploaded to it. Every time you change
`app.js` (or any other file) and want that live, you need to re-upload
that file to the same GitHub repo:

- **Web UI (no tools needed):** on the repo page, **Add file → Upload
  files**, drag in the changed file(s), and click **Commit changes**. If
  the filename matches an existing file, GitHub overwrites it.
- **Lower-friction option:** if you don't mind installing one thing,
  `git` turns this into a two-line update (`git add -A && git commit -m
  "update" && git push`) instead of a manual drag-and-drop each time.
  Either way is fine — the web UI is perfectly workable for a project
  this size.

The app also caches itself for offline use, so after uploading a change,
give it a few seconds and reload the page twice on your phone (the
service worker updates itself in the background on the first load, then
takes over on the next one).

If you ever turn Pages off (Settings → Pages → Source → "None") and want
it back: **Settings → Pages → Source: Deploy from a branch → main → /
(root) → Save**. It comes back at the same URL as before, as long as the
repo name hasn't changed.

## How it works day-to-day

- First time: pick a username. It's saved on that phone (`localStorage`),
  so nobody has to type it again — this is the "authenticate once" bit.
  Under the hood the app also signs in anonymously to Firebase so writes
  are attributed to a device, but that's invisible to the user.
- Pick a place from the dropdown — a fixed list (see step 1 above).
- Tap the dial to start timing, tap again to stop.
- Temperature and rain/snow/fog are auto-filled from that place's fixed
  coordinates via the free [Open-Meteo](https://open-meteo.com) API (no
  key, no location permission needed) — tap the temperature value any
  time to overwrite it manually, and tap a rain/snow/fog chip to correct
  it if the API got it wrong for your exact spot.
- Tap **Save entry**. Done — usually 2–3 taps per entry after the first
  time.
- **Recent entries** shows a shared ledger of everyone's logged waits,
  with an **Export CSV** button for pulling the data into
  Python/pandas for the statistics side of things later.

## Works with bad or no internet

Entries save to the phone first, always — Firestore's offline mode is
turned on (`enableIndexedDbPersistence`), so tapping **Save entry** writes
to the phone's local storage immediately, whether or not there's a
connection. When the phone gets signal again (even briefly), Firestore
sends anything queued up automatically — nothing to trigger by hand.

A couple of things follow from that:

- The **first time** the app is opened, it does need one moment of real
  connectivity to sign in and cache itself for offline use. After that,
  it keeps working through dead zones.
- While offline, a note appears under the header ("You're offline —
  entries save on this phone and upload once you're back online"), and
  the save confirmation says the same thing, so it's always clear
  whether something has actually reached the shared database yet or is
  still sitting locally.
- **Recent entries** and the CSV export only show what that phone
  already knows about — if several people logged entries offline, each
  will see the others' entries once everyone's phone has synced.

## Data model (Firestore collection `queueEvents`)

| field | meaning |
|---|---|
| `userId` | anonymous device ID (for de-duplication, not shown to anyone) |
| `username` | display name the person chose |
| `locationName` | which place (from `PRESET_LOCATIONS`) |
| `startTime` / `endTime` | ISO timestamps |
| `waitDurationSeconds` | computed |
| `temperatureC` | auto-fetched |
| `weather.rain` / `.snow` / `.fog` | auto-fetched, editable |
| `notes` | optional free text |
| `dayOfWeek` / `hourOfDay` | computed, for easy analysis later |

## If something breaks

- **A red banner near the top says "Not connected to Firebase yet" or
  "Sign-in failed"** — either Anonymous auth isn't enabled yet (step 4
  above), or a value in `FIREBASE_CONFIG` doesn't match your project.
- **Console shows `Uncaught ReferenceError: FIREBASE_CONFIG is not
  defined`** — you pasted Firebase's snippet as-is (`const
  firebaseConfig = {...}`, lowercase) instead of filling in the
  existing `FIREBASE_CONFIG` block. Rename it back to `FIREBASE_CONFIG`
  (see step 2.3 above).
- **Full-screen dark banner saying Firebase isn't configured** — you
  haven't replaced the placeholder values in `FIREBASE_CONFIG` at all
  yet.
- **Geolocation says "denied"** — no longer applicable: weather now comes
  from each place's fixed coordinates in `PRESET_LOCATIONS`, not the
  phone's GPS, so there's nothing to grant permission for. If the
  temperature shows "n/a", double-check that place has real `lat`/`lon`
  values (not the `0, 0` placeholders) and that the phone has an
  internet connection.
- **Entries not showing on another phone** — Firestore rules use `if
  request.auth != null`, so double check anonymous auth is enabled
  (step 4 above).
- **Something else** — open dev tools (F12) → **Console** tab → reload
  → read the red text. It nearly always names the exact problem.

## Files

```
queue-logger/
  index.html      structure + all styling
  app.js          all app logic (auth, timer, weather, Firestore)
  manifest.json   makes it installable as a home-screen app
  sw.js           lets it open offline once visited once
  icons/          app icon (192px, 512px)
  make_icons.py   optional: regenerates the icons if you want to restyle them
```
