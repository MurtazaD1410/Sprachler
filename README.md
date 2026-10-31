# Lingopie DE

A Chrome extension for learning German from videos. It shows live German captions over the video, translates each line into English, and lets you click any word to see its article, meanings and examples. Words you want to keep go into a personal Wortschatz with spaced-repetition review. Built with TypeScript and Vite for Chrome Manifest V3.

It is an independent project inspired by language-learning-through-video tools and is not affiliated with Lingopie.

## ✨ Features

- **Live German captions**: Rolling captions over the video (1 to 4 lines, your choice). Older lines fade and scroll away as new ones arrive, so there is time to read and click
- **Works where captions exist**: Reads the captions YouTube already shows (including auto-generated German), has a best-effort Disney+ adapter, and falls back to the video's own text tracks on other sites
- **Subtitle import**: Load your own German `.srt` or `.vtt` file for videos that have none. It is remembered per video, with a timing offset (−1s, −0.1, +0.1, +1s) and drag-and-drop onto the page. German files saved in the old Windows encoding are decoded correctly
- **English translation**: Each line is translated under the German. Switch it off when you only want the word cards
- **Click-to-lookup word cards**: Article (der, die, das, coloured by gender), plural, IPA, numbered meanings, German and English example sentences and audio. Inflected forms are traced back to their dictionary form ("gegangen" becomes "gehen")
- **Pause while you look**: Hovering freezes the line under your cursor, clicking a word pauses the video, and it resumes when you move away or press Esc
- **Wortschatz**: Press ☆ Save on a word card to keep it. A review page schedules your cards with the FSRS algorithm and shows an example sentence with the word underlined
- **Export and backup**: Anki CSV export, JSON backup and import (the newer copy of each word wins)
- **Several translation engines**: Chrome's on-device translator first, then Google's web endpoint, then MyMemory. The popup shows a green or red dot for each and marks the one in use
- **Usage bar**: Shows how much of MyMemory's free daily allowance you have used
- **Master switch**: One big on and off switch in the popup, off by default, so it only runs on videos you choose
- **Nothing to sign up for**: No account, no server, no API key. Everything is stored in your browser

## 🚀 Tech Stack

- **Language**: TypeScript
- **Build Tool**: Vite 5 with `@crxjs/vite-plugin`
- **Spaced repetition**: `ts-fsrs` (FSRS scheduler)
- **Dictionary data**: German Wiktionary via kaikki.org
- **Translation**: Chrome built-in Translator API, Google Translate web endpoint, MyMemory
- **Extension Platform**: Chrome Manifest V3 with a service worker and an offscreen document
- **UI**: Plain DOM and CSS, with the caption overlay isolated in a Shadow DOM

## 📦 Installation

### Prerequisites

- Node.js 18 or newer
- npm
- Google Chrome 116 or newer. On-device translation needs Chrome 138 or newer on a device that supports it. Without it, the online engines are used

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Build the extension**

   ```bash
   npm run build
   ```

   This creates a `dist/` folder containing the extension.

3. **Load it into Chrome**

   - Open `chrome://extensions`
   - Turn on **Developer mode**
   - Click **Load unpacked** and select the `dist/` folder

4. **Pin it** (optional but handy)

   - Click the puzzle-piece icon in the toolbar and pin **Lingopie DE**

5. **Install the offline translator** (optional, recommended)

   - Open the popup and look at the **Translation engines** box
   - If the On-device row has a red dot and a **Download offline translation** button, click it and keep the popup open until it finishes. It is a one-time download shared by the whole browser

### Usage

1. Open a German video and press the extension icon, then switch it **on**
2. **Captions**: they appear over the video. Hover to hold a line still, then click a word to open its card
3. **Save words**: press **☆ Save** on a card. Open the **Wortschatz** from the popup to review them
4. **No German captions?** Download a German `.srt` or `.vtt` for that video, then press **Load .srt / .vtt file…** in the popup, or drag the file onto the video page. Use the timing buttons if the lines run early or late
5. **Settings** in the popup: turn English translation on or off, and choose how many caption lines stay on screen

### Development

```bash
npm run dev      # start the Vite dev server
npm run build    # type-check, then production build into dist/
```

After rebuilding, click the reload icon on the extension in `chrome://extensions`, then **refresh any open video tabs**. A tab that was open before the reload keeps the old script, which can no longer reach the extension. It shows a notice asking for a refresh.

## 🧠 How It Works

1. A **content script** finds the video, including inside shadow DOM, and picks a caption source: your imported file if there is one, otherwise a site adapter (YouTube, Disney+), otherwise the video's own text tracks.
2. Captions arrive as snapshots. A small log turns them into separate lines, handling auto-captions that grow word by word and then scroll, so lines are not repeated.
3. Each finished line is sent to the **background service worker** for translation, which tries three engines in order:
   - **On-device**: Chrome's Translator API, run in a hidden extension page, because extension pages see the installed model while a video page may not
   - **Google**: the free web endpoint. It is unofficial, so after a failure it is skipped for ten minutes
   - **MyMemory**: free without a key, about 5,000 characters per day
4. Clicking a word asks the background for a dictionary lookup. It fetches that word's page from kaikki.org (Wiktionary data), follows form-of links to the lemma, and for words with no page of their own tries the stem ("schönen" to "schön").
5. Saved words are stored one per key in `chrome.storage.local`, each with an id and an updated-at time. Review cards are scheduled by FSRS and kept as ISO dates so they survive storage.

### Project structure

```
src/
  background.ts          service worker: lookup, translate, tab URL, badge
  background/            dictionary lookup and translation engines
  content/               overlay, caption log, word card, site adapters
  content/adapters/      youtube, disney, text tracks, imported subtitles
  offscreen/             hidden page that runs the on-device translator
  popup/                 on/off switch, settings, engines, subtitles
  wortschatz/            saved words list and review page
  shared/                settings, usage, subtitles parser, word storage
```

### Permissions

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Settings, saved words, imported subtitles, the usage count |
| `offscreen` | Hosts the on-device translator in a hidden page |
| Access to all sites | Reads captions on whichever site you watch, and fetches dictionary and translation data |

## 🔒 Privacy

- **Caption text may leave your device**: With the Google or MyMemory engine, each caption line is sent to that service to be translated. With on-device translation nothing is sent. The popup shows which engine is in use
- **Dictionary lookups**: Clicking a word requests that word's page from kaikki.org
- **Saved words and subtitles**: Stored only in your browser. There is no backend and no account
- **Subtitle files**: Read locally and stored locally. They are never uploaded

## ⚠️ Good to Know

- **Disney+ is best effort**: Its player draws captions in a way I could not fully check. If captions do not appear, the extension logs what it found in the console (filter by `lingopie`). Importing a German subtitle file is the dependable way there
- **Google's endpoint is unofficial**: It can answer with a captcha page or stop working. The extension then falls back to MyMemory automatically
- **MyMemory's allowance is an estimate**: The usage bar counts the characters this extension sends. It cannot see other apps on the same network that share the allowance
- **Translation quality varies**: Short fragments of live captions are hard to translate. Use the word cards for exact meanings
- **Dictionary data is imperfect**: Ambiguous forms list every match without ranking them by the sentence. Separable verbs and some compounds can be incomplete
- **Subtitle timing**: A file made for a different version of the video can drift. A fixed offset is fixable with the timing buttons, a growing drift usually means the wrong file
- **Not on tablets or phones**: Chrome there does not support extensions, so capturing words works on a computer only
- **No live speech recognition yet**: Videos with no captions and no subtitle file have nothing to show

## 🗺️ Roadmap

- Live German captions from the audio (speech-to-text) for videos with none
- An article drill (der, die or das) in the review
- Sync across devices, and a small web page for reviewing words on a tablet
- Highlighting words you already know in the captions

## 📚 Credits

- Dictionary data: [Wiktionary](https://www.wiktionary.org/) (CC BY-SA), extracted by [kaikki.org](https://kaikki.org/)
- Translation: Chrome's built-in Translator API, Google Translate, [MyMemory](https://mymemory.translated.net/)
- Spaced repetition: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- Pronunciation audio: Wikimedia Commons recordings listed on Wiktionary
#   S p r a c h l e r  
 