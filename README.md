# Wishwell

Wish lists for family and friends. Everyone keeps one list; the people linked to you can
claim things ("I'll get this") without you ever seeing it, and add secret gift ideas for
you that only their circle can see.

- **Site:** GitHub Pages (plain HTML/CSS/JS) — https://glaynebrown.github.io/wishwell/
- **Data:** Firebase project `wishwell-l4a0z` (Firestore + email/password sign-in, free Spark plan)
- **Reminders:** a free daily GitHub Action sends phone notifications (no Blaze plan)
- **Link auto-fill:** Microlink free tier (~25 lookups/day per network; never charges)

If `firebase-config.js` says `apiKey: 'PASTE'`, the app runs in **sample mode** with a
pretend family (Settings → "View sample as" lets you check what each person can see).

## Files

| File | What it does |
|---|---|
| index.html, styles.css | Page + the three color palettes |
| app.js | All the screens |
| store.js | Firebase reads/writes (layout described at the top) |
| demo.js | Sample mode stand-in for store.js |
| dates.js | Birthdays/holidays → "coming up" (shared with the reminder script) |
| lookup.js | Paste a link → name/photo/store |
| sw.js | Offline cache + shows notifications |
| firestore.rules | Who can see what (deployed with the Firebase CLI, not uploaded) |
| reminders/ | Daily reminder script (run by GitHub Actions) |
| .github/workflows/reminders.yml | The daily schedule |

## One-time setup for phone reminders

1. Firebase console → ⚙️ Project settings → **Service accounts** → **Generate new private key**.
2. Open the downloaded file in TextEdit and copy everything.
3. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `FIREBASE_SERVICE_ACCOUNT`, paste, save. Then delete the downloaded file.
4. Repo → **Actions** tab → **Daily reminders** → **Run workflow** to test it.

The `.github` folder is hidden in Finder, so add the workflow on GitHub with
**Add file → Create new file**, name it `.github/workflows/reminders.yml`, and paste the contents.

## How it keeps surprises

- Claims live in `users/{you}/claims` — the rules let everyone linked to you read them, except you.
- Ideas live in `users/{you}/circles/{groupCode}/ideas` — only that group (minus you) can read them.
  "Just me" ideas live under `circles/u_{adder}` — only the person who added them.
- "Given" moves the wish to your Received list (owner-only) as "From …".
