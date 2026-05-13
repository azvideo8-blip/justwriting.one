# justwriting — тихий редактор

A calm, distraction-free writing app built around one idea: the best session is the one you actually finish.

---

## What it does

**justwriting** sits between a blank page and a productivity tool. You open it, start the timer, and write. While you write, the interface fades away. When you stop, it comes back — showing you exactly how far you went.

---

## Features

### The editor

A single textarea. No toolbars, no markdown preview, no buttons fighting for attention. The cursor blinks in your brand accent color. The font, size, and line width are yours to configure.

**Stream mode** — backspace is disabled. You can only move forward. A gentle nudge toward flow over perfection.

**Zen mode** — once you start writing, the header and stats fade out after a few seconds. Move the mouse, and they return. Writing in peace, stats on demand.

### Sessions

Each writing session is timed and counted from the moment you press play. The bottom bar tracks:

- **Total words** — everything you've ever written in this editor
- **Session words** — just this session, with an optional target
- **Session time** — elapsed time, or a countdown if you set a timer
- **WPM** — words per minute with a live color indicator (green → yellow → amber as you slow down)

Goal progress is shown as a thin animated bar beneath the word and time counters. When you hit your goal, both the number and the bar turn green.

### Goals

Click the session word count to set a word target (250 · 500 · 1000 · 1500 · 2000, or any number). Click the timer to set a duration (15 · 25 · 30 · 60 minutes, or any number). Both goals are optional and independent.

### Life log

A collapsible side panel that lists all sessions from today in a compact timeline. Useful when you write in multiple short bursts and want to see the full day at a glance.

### Archive

All past sessions in one place. Two views:

- **List view** — compact rows with date, title, snippet, tags, and per-row actions. Color-coded by label with a left-edge glow.
- **Grid view** — cards with title, excerpt, word count, and duration.

Both views support full-text search with highlighted matches.

### Labels & tags

**Labels** are color swatches — assign one to any session to group and visually distinguish your notes. The label color bleeds into the row as a subtle background tint and left-border glow.

**Tags** are freeform strings you type inline directly on the row. Autocomplete suggests tags you've already used. Up to 7 suggestions at a time.

### Statistics

- **WPM chart** — a line chart of your words-per-minute over the course of the session, with an animated draw effect on load and a highlighted peak
- **Session chart** — a bar chart of daily word counts over a date range, with a gradient fill
- **Streak** — a row of animated dots showing your consecutive writing days, with a spring pop on each dot

### Profile

Your lifetime numbers at a glance: total words, total sessions, current streak, total writing time, average WPM, and average session length.

### Calendar

A calendar view of your writing history — see which days had sessions at a glance.

### Export

From any session preview: export as **plain text (.txt)**, **PDF**, or **JSON** backup.

### Storage

Sessions live in the cloud (Firebase) and optionally offline (IndexedDB). Each note shows small icons indicating where it's stored — cloud, local, or both. You can promote a local note to the cloud or keep it offline-only.

---

## Tech

React 19 · TypeScript · Vite · Tailwind CSS v4 · Framer Motion · Firebase · Zustand · Vitest

---

## Local setup

**Prerequisites:** Node.js v20+

```bash
git clone <repo>
cd justwriting
npm install
```

Create `.env.local`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

```bash
npm run dev
```

For production: `npm run build` → `npm run preview`

For Firebase functions: `cd functions && npm install && firebase deploy --only functions`
