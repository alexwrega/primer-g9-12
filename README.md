# Reading Primer 9–12 — static viewer

A static, dependency-free web app for the Grades 9–12 Reading Strategies course:
an interactive lesson viewer plus a learning-science **Quality Grid**.

**Live site:** https://alexwrega.github.io/primer-g9-12/

## Run it locally
This is plain HTML/CSS/JS + JSON — **no build, no install**. But the viewer loads its
data with `fetch()`, which browsers block over `file://`, so you must serve it over HTTP
(don't just double-click the HTML):

```bash
git clone https://github.com/alexwrega/primer-g9-12.git
cd primer-g9-12
python3 -m http.server 8000
```
Then open **http://localhost:8000/primer-g9-12.html** (any static server works).

## What's here
- `primer-g9-12.html` + `strategies.js` + `style.css` — the lesson viewer (grade tabs → lessons → video transcript + quiz).
- `primer-quality-grid.html` — QC grid: 160 lessons × 11 learning-science qualifiers, KC type, and 🚩 flags.
- `data/strategies-grade9–12.json` — lessons/objectives/quizzes.
- `data/media-grade9–12.json` — per-lesson video transcript + quiz.
- `data/judge-flags.json` — items flagged by an independent LLM-as-judge QC pass (🚩 in the UI).

## Notes
- 🚩 marks items an independent QC judge flagged for review (not necessarily wrong).
- Three reading excerpts are redacted here for copyright (shown in the classroom version).
