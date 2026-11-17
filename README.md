# Within: a retreat journal

An offline journal for the Christmas retreat on the angels and inner awareness.
You read the topic notes (drawn from the Retreat Guidebook, the Cooperation with the
Angels master document, and Dora van Gelder Kunz's *The Christmas of the Angels*),
write entries, and the words you use link each entry into the map of topics.

It is a web app installed to the Home Screen. Once installed and opened online one time,
it works with no internet at all. Journal entries and PDFs are stored only on the phone.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `data.js` | The topic map: 61 topics, keywords, practices, questions, page references |
| `sw.js` | Service worker that keeps the app on the phone for offline use |
| `manifest.webmanifest`, `icons/` | Home Screen name and icon |

No PDFs and no journal entries are in this folder.

## Put it on the iPhone (one time)

The app has to be opened once from an `https://` address so the iPhone can store it.

**GitHub Pages (free):**
1. Sign in at github.com and create a new repository, e.g. `within-journal`.
2. Choose **Add file → Upload files** and drag in everything in this folder, including the `icons` folder. Commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then `main` and `/ (root)`. Save.
4. After about a minute the address is `https://<your-username>.github.io/within-journal/`.

**Netlify Drop** (alternative): drag this folder onto app.netlify.com/drop, then sign in to keep the site.

The site holds only the app and the paraphrased topic notes. Anyone with the link could
read those notes, but never your journal or PDFs.

**On the iPhone:**
1. Open the address in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open **Within** from the Home Screen while online and wait a few seconds.
   The **More** tab should say the app and the PDF page viewer are stored on this phone.
4. In **Sources**, tap **Add PDF…** for each document and pick it from the Files app.
   Page links such as "Guidebook p.17" then open inside the app, offline.

The Home Screen app keeps its own storage, separate from Safari. Write and add PDFs in the
Home Screen app, not in a Safari tab.

## Using it

- **Write**: words such as *tree*, *sylph*, *witness*, *group lotus* or *silver bells*
  link automatically. Use `[[Topic name]]` to link anything on purpose, and
  `Guidebook p.17`, `Master Document p.10` or `Christmas of the Angels p.5` to point at a page.
- **Photos & sounds**: in an entry, tap **Photo** (photo library or camera) or **Sound**
  (record right there, or choose a sound file; from Voice Memos, share → Save to Files first).
  Tap an attachment to give it a caption. Topic words in captions link too. Photos are stored at
  up to 2048 px to save space; sounds are kept as they are.
- **Topics**: each topic page shows a summary, practice steps, questions to write on,
  source pages, and every journal entry that touches it. You can add your own linking
  words, notes (for example the text of an invocation) and topics of your own.
- **Backup**: More → Save backup → Save to Files. Restore from the same screen. Once you have
  photos or sounds, the backup is a `.zip` holding everything: `backup.json`, the media files,
  and a `journal.md` you can open on a computer with the photos in place.

## Updating later

Upload the changed files to the same place. The app picks up the new version the next time it
is opened online. For larger changes, also raise `VERSION` in `sw.js` (e.g. `within-v2`).
