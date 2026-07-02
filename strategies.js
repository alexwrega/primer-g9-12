/**
 * Reading Primer Viewer
 * Loads the per-grade strategy courses (data/strategies-gradeN.json) plus the
 * companion media (data/media-gradeN.json: 3-min video transcripts + quizzes with
 * embedded placemarker questions) and renders modules → lessons.
 */

const GRADES = [9, 10, 11, 12];
const dataCache = {};
const mediaCache = {};
let currentGrade = null;
let currentMedia = {};     // media map for the current grade, keyed by lesson id
let flatLessons = [];      // flattened [{lesson, module}] for current grade, in order
let allLessonItems = [];   // sidebar DOM refs for search filtering
let player = null;         // active video player state ({ timer, ... })

// DOM references
const gradeTabs = document.getElementById('gradeTabs');
const lessonList = document.getElementById('lessonList');
const searchInput = document.getElementById('searchInput');
const content = document.getElementById('content');
const contentPlaceholder = document.getElementById('contentPlaceholder');
const lessonView = document.getElementById('lessonView');

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Build grade tabs
function initTabs() {
    GRADES.forEach(grade => {
        const btn = document.createElement('button');
        btn.className = 'grade-tab';
        btn.textContent = `Grade ${grade}`;
        btn.dataset.grade = grade;
        btn.addEventListener('click', () => selectGrade(grade));
        gradeTabs.appendChild(btn);
    });
}

async function loadGrade(grade) {
    if (dataCache[grade]) return dataCache[grade];
    const resp = await fetch(`data/strategies-grade${grade}.json`);
    if (!resp.ok) throw new Error(`Failed to load grade ${grade} strategies`);
    const data = await resp.json();
    dataCache[grade] = data;
    return data;
}

async function loadMedia(grade) {
    if (mediaCache[grade]) return mediaCache[grade];
    try {
        const resp = await fetch(`data/media-grade${grade}.json`);
        if (!resp.ok) return {};
        const data = await resp.json();
        mediaCache[grade] = data;
        return data;
    } catch (e) {
        return {};
    }
}

async function selectGrade(grade, lessonNumber) {
    document.querySelectorAll('.grade-tab').forEach(tab => {
        tab.classList.toggle('active', parseInt(tab.dataset.grade) === grade);
    });

    currentGrade = grade;
    flatLessons = [];
    stopPlayer();
    lessonList.innerHTML = '<div class="loading">Loading</div>';
    hideLesson();

    try {
        const [data, media] = await Promise.all([loadGrade(grade), loadMedia(grade)]);
        currentMedia = media || {};
        renderLessonList(data);
        const idx = lessonNumber
            ? flatLessons.findIndex(({ lesson }) => lesson.number === lessonNumber)
            : -1;
        if (idx !== -1) {
            selectLesson(idx);
        } else {
            renderCourseOverview(data);
            window.location.hash = `grade=${grade}`;
        }
    } catch (e) {
        const viaFile = window.location.protocol === 'file:';
        lessonList.innerHTML = `<p class="placeholder-text">Could not load Grade ${grade} strategies.${
            viaFile
                ? ' This page was opened directly from a file. Browsers block data loading over <code>file://</code> — please run a local web server instead (see below).'
                : ' Make sure data/strategies-grade' + grade + '.json exists and the server is running from the project folder.'
        }<br><br>From the project folder, run:<br><code>python3 -m http.server 8003</code><br>then open <code>http://localhost:8003/primer-g9-12.html</code></p>`;
    }
}

// Sidebar: modules as headers, lessons as items
function renderLessonList(data) {
    allLessonItems = [];
    flatLessons = [];
    lessonList.innerHTML = '';

    (data.modules || []).forEach(module => {
        const header = document.createElement('div');
        header.className = 'module-group-header';
        header.innerHTML = `${escapeHtml(module.title)}
            <span class="module-meta">${(module.lessons || []).length} lessons · ~${module.duration_minutes} min</span>`;
        lessonList.appendChild(header);

        (module.lessons || []).forEach(lesson => {
            const index = flatLessons.length;
            flatLessons.push({ lesson, module });

            const div = document.createElement('div');
            div.className = 'article-item lesson-item';
            div.innerHTML = `
                <div>${lesson.number}. ${escapeHtml(lesson.title)}</div>
                <div class="lesson-item-meta">video + quiz</div>
            `;
            div.addEventListener('click', () => selectLesson(index));
            lessonList.appendChild(div);

            allLessonItems.push({
                el: div,
                moduleEl: header,
                title: lesson.title.toLowerCase(),
                moduleTitle: module.title.toLowerCase(),
                index
            });
        });
    });

    if (flatLessons.length === 0) {
        lessonList.innerHTML = '<p class="placeholder-text">No lessons found for this grade.</p>';
    }
}

// Search filter
searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    const visibleModules = new Map();

    allLessonItems.forEach(({ el, moduleEl, title, moduleTitle }) => {
        const match = !query || title.includes(query) || moduleTitle.includes(query);
        el.style.display = match ? '' : 'none';
        if (match) visibleModules.set(moduleEl, true);
    });

    document.querySelectorAll('.module-group-header').forEach(header => {
        header.style.display = visibleModules.has(header) ? '' : 'none';
    });
});

function selectLesson(index) {
    allLessonItems.forEach(({ el, index: i }) => {
        el.classList.toggle('active', i === index);
    });
    renderLesson(index);
    content.scrollTop = 0;
    const { lesson } = flatLessons[index];
    window.location.hash = `grade=${currentGrade}&lesson=${lesson.number}`;
}

function hideLesson() {
    lessonView.style.display = 'none';
    contentPlaceholder.style.display = '';
}

// Course overview shown when a grade is first selected
function renderCourseOverview(data) {
    stopPlayer();
    contentPlaceholder.style.display = 'none';
    lessonView.style.display = '';

    const modulesHtml = (data.modules || []).map(m => `
        <li>
            <strong>${escapeHtml(m.title)}</strong>
            <span class="lesson-item-meta">${(m.lessons || []).length} lessons · ~${m.duration_minutes} min</span>
        </li>
    `).join('');

    lessonView.innerHTML = `
        <div class="course-banner">
            <div class="course-sequence">${escapeHtml(data.sequence || '')}</div>
            <h2>${escapeHtml(data.course_title)}</h2>
            <div class="course-desc">${escapeHtml(data.subtitle || '')}</div>
            <p class="course-desc">${escapeHtml(data.description || '')}</p>
            ${data.paired_grade_note ? `<div class="course-paired">${escapeHtml(data.paired_grade_note)}</div>` : ''}
            <div class="course-stats">
                <span>${data.total_lessons} lessons</span>
                <span>${data.total_duration_minutes} minutes (${(data.total_duration_minutes / 60).toFixed(1)} hrs)</span>
                <span>${(data.modules || []).length} modules</span>
                <span>each lesson: 3-min video + 7-question quiz</span>
            </div>
        </div>
        <h3 class="section-heading">Modules</h3>
        <ul class="concepts-list">${modulesHtml}</ul>
        <p class="placeholder-text" style="text-align:left;padding:8px 0">Choose a lesson from the sidebar to begin.</p>
    `;
}

function renderLesson(index) {
    stopPlayer();
    const { lesson, module } = flatLessons[index];
    const media = currentMedia[lesson.id];
    contentPlaceholder.style.display = 'none';
    lessonView.style.display = '';

    const ccssHtml = (lesson.ccss_standards || [])
        .map(s => `<span class="ccss-tag">${escapeHtml(s)}</span>`).join('');
    const conceptsHtml = (lesson.key_concepts || [])
        .map(c => `<li>${escapeHtml(c)}</li>`).join('');

    let mediaHtml = '';
    if (media && media.video) {
        mediaHtml = `
            <h3 class="section-heading">Video Lesson (3 min)</h3>
            ${renderVideoPlayer(media)}
            <h3 class="section-heading">Lesson Quiz</h3>
            <p class="quiz-q-meta">${(media.quiz || []).length} questions — ${(media.quiz || []).filter(q => q.embedded).length} appear as checkpoints in the video (marked on the timeline); the rest are below.</p>
            <div id="finalQuiz">${(media.quiz || []).filter(q => !q.embedded)
                .map((q, i) => renderMCQ(q, `Quiz Question ${i + 1}`)).join('')}</div>
        `;
    } else {
        // Fallback: show the lesson's own check-for-understanding
        mediaHtml = `
            <h3 class="section-heading">Check for Understanding</h3>
            ${(lesson.check_for_understanding || []).map(q => renderMCQ(q, 'Question')).join('')}
        `;
    }

    lessonView.innerHTML = `
        <div class="article-meta" style="margin-bottom:8px">
            <span class="meta-tag">${escapeHtml(module.title)}</span>
            <span class="meta-tag">${lesson.duration_minutes} min</span>
        </div>
        <h2 class="article-title">Lesson ${lesson.number}: ${escapeHtml(lesson.title)}</h2>
        <div class="ccss-tags" style="margin-bottom:18px">${ccssHtml}</div>

        <div class="lesson-objective">
            <span class="label">Learning Objective</span>
            ${escapeHtml(lesson.learning_objective)}
        </div>

        <h3 class="section-heading">Key Concepts</h3>
        <ul class="concepts-list">${conceptsHtml}</ul>

        <h3 class="section-heading">Instruction</h3>
        <p class="instruction-text">${escapeHtml(lesson.instruction)}</p>

        ${lesson.curriculum_connection ? `
        <div class="connection-box">
            <span class="label">Prepares you for</span>
            ${escapeHtml(lesson.curriculum_connection)}
        </div>` : ''}

        ${mediaHtml}

        <div class="lesson-nav">
            <button id="prevBtn" ${index === 0 ? 'disabled' : ''}>← Previous lesson</button>
            <button id="nextBtn" ${index === flatLessons.length - 1 ? 'disabled' : ''}>Next lesson →</button>
        </div>
    `;

    // Wire all static MCQs (final quiz / fallback CFU)
    lessonView.querySelectorAll('#finalQuiz .cfu-choices, .cfu-card .cfu-choices').forEach(list => {
        if (!list.closest('.video-overlay')) wireChoices(list);
    });

    // Initialize the video player if media exists
    if (media && media.video) initPlayer(media);

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => selectLesson(index - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => selectLesson(index + 1));
}

/* ---------- Video player (transcript-driven, with embedded placemarkers) ---------- */

function renderVideoPlayer(media) {
    const dur = media.video.duration_seconds || 180;
    const embedded = (media.quiz || []).filter(q => q.embedded)
        .slice().sort((a, b) => a.timestamp - b.timestamp);

    const markersHtml = embedded.map((q, i) =>
        `<div class="placemarker" data-q="${i}" style="left:${(q.timestamp / dur) * 100}%" title="Checkpoint at ${fmtTime(q.timestamp)}"></div>`
    ).join('');

    // Transcript lines, with checkpoint markers inserted after the relevant segment
    const segs = media.video.transcript;
    let linesHtml = '';
    segs.forEach((seg, si) => {
        linesHtml += `<div class="transcript-line" data-t="${seg.t}"><span class="ts">${fmtTime(seg.t)}</span><span>${escapeHtml(seg.text)}</span></div>`;
        const nextT = si + 1 < segs.length ? segs[si + 1].t : dur + 1;
        embedded.forEach((q, qi) => {
            if (q.timestamp >= seg.t && q.timestamp < nextT) {
                linesHtml += `<div class="transcript-marker" data-q="${qi}">Checkpoint question at ${fmtTime(q.timestamp)} — click to answer</div>`;
            }
        });
    });

    return `
        <div class="video-stage" id="videoStage">
            <span class="video-badge">▶ Video Lesson</span>
            <div class="video-subtitle" id="videoSubtitle">Press play to begin the lesson.</div>
            <div class="video-overlay" id="videoOverlay"></div>
        </div>
        <div class="video-controls">
            <button class="play-btn" id="playBtn" aria-label="Play">▶</button>
            <span class="video-time" id="videoTime">0:00 / ${fmtTime(dur)}</span>
            <div class="video-progress" id="videoProgress">
                <div class="video-progress-fill" id="videoFill"></div>
                ${markersHtml}
            </div>
        </div>
        <div class="transcript-list" id="transcriptList">${linesHtml}</div>
    `;
}

function initPlayer(media) {
    const dur = media.video.duration_seconds || 180;
    const embedded = (media.quiz || []).filter(q => q.embedded)
        .slice().sort((a, b) => a.timestamp - b.timestamp)
        .map(q => ({ ...q, answered: false }));

    player = {
        timer: null,
        time: 0,
        dur,
        segs: media.video.transcript,
        embedded,
        playing: false,
        paused_for_q: false
    };

    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('videoProgress').addEventListener('click', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        seek(Math.round(pct * dur));
    });
    document.querySelectorAll('#transcriptList .transcript-line').forEach(line => {
        line.addEventListener('click', () => seek(parseInt(line.dataset.t)));
    });
    document.querySelectorAll('.placemarker, #transcriptList .transcript-marker').forEach(m => {
        m.addEventListener('click', () => {
            const qi = parseInt(m.dataset.q);
            if (player.embedded[qi]) { pause(); showCheckpoint(qi); }
        });
    });

    updatePlayerUI();
}

function togglePlay() {
    if (!player) return;
    if (player.paused_for_q) return;
    player.playing ? pause() : play();
}

function play() {
    if (!player || player.playing) return;
    if (player.time >= player.dur) player.time = 0;
    player.playing = true;
    document.getElementById('playBtn').textContent = '❚❚';
    player.timer = setInterval(() => {
        player.time++;
        // Trigger an embedded checkpoint when we reach it
        const due = player.embedded.findIndex(q => !q.answered && q.timestamp <= player.time);
        if (due !== -1) {
            player.time = player.embedded[due].timestamp;
            pause();
            showCheckpoint(due);
        }
        if (player.time >= player.dur) { player.time = player.dur; pause(); }
        updatePlayerUI();
    }, 1000);
    updatePlayerUI();
}

function pause() {
    if (!player) return;
    player.playing = false;
    clearInterval(player.timer);
    player.timer = null;
    const btn = document.getElementById('playBtn');
    if (btn) btn.textContent = '▶';
}

function stopPlayer() {
    if (player && player.timer) clearInterval(player.timer);
    player = null;
}

function seek(t) {
    if (!player) return;
    player.time = Math.max(0, Math.min(t, player.dur));
    updatePlayerUI();
}

function updatePlayerUI() {
    if (!player) return;
    const fill = document.getElementById('videoFill');
    const timeEl = document.getElementById('videoTime');
    const sub = document.getElementById('videoSubtitle');
    if (!fill) return;
    fill.style.width = `${(player.time / player.dur) * 100}%`;
    timeEl.textContent = `${fmtTime(player.time)} / ${fmtTime(player.dur)}`;

    // Current transcript segment = last seg with t <= time
    let cur = player.segs[0];
    player.segs.forEach(s => { if (s.t <= player.time) cur = s; });
    if (sub && !player.paused_for_q) sub.textContent = cur ? cur.text : '';

    document.querySelectorAll('#transcriptList .transcript-line').forEach(line => {
        line.classList.toggle('active', parseInt(line.dataset.t) === (cur ? cur.t : -1));
    });
    document.querySelectorAll('.placemarker').forEach((m, i) => {
        if (player.embedded[i]) m.classList.toggle('answered', player.embedded[i].answered);
    });
}

function showCheckpoint(qi) {
    const q = player.embedded[qi];
    if (!q) return;
    player.paused_for_q = true;
    const overlay = document.getElementById('videoOverlay');
    overlay.innerHTML = `
        <div class="checkpoint-tag">⏸ Checkpoint · ${fmtTime(q.timestamp)}</div>
        ${renderMCQ(q, null, true)}
        <button class="continue-btn" id="continueBtn">Continue video →</button>
    `;
    overlay.classList.add('show');

    const list = overlay.querySelector('.cfu-choices');
    wireChoices(list, () => {
        document.getElementById('continueBtn').classList.add('show');
    });
    document.getElementById('continueBtn').addEventListener('click', () => {
        q.answered = true;
        player.paused_for_q = false;
        overlay.classList.remove('show');
        overlay.innerHTML = '';
        updatePlayerUI();
        play();
    });
}

/* ---------- Generic multiple-choice rendering ---------- */

function renderMCQ(q, label, bare) {
    const choicesHtml = (q.choices || []).map((c, ci) => `
        <li class="cfu-choice ${c.is_correct ? 'correct' : ''}" data-correct="${c.is_correct ? 'true' : 'false'}">
            <span class="cfu-letter">${LETTERS[ci] || ci + 1}</span>
            <span>${escapeHtml(c.text)}</span>
        </li>
    `).join('');

    const correctIdx = (q.choices || []).findIndex(c => c.is_correct);
    const correctLetter = LETTERS[correctIdx] || '?';
    const feedback = q.explanation
        ? `Correct answer: <strong>${correctLetter}</strong>. ${escapeHtml(q.explanation)}`
        : `Correct answer: <strong>${correctLetter}</strong>.`;

    const passageHtml = q.passage
        ? `<blockquote class="cfu-passage" style="white-space:pre-line;border-left:3px solid #888;margin:0 0 10px;padding:8px 12px;background:rgba(0,0,0,0.04);font-style:italic">${escapeHtml(q.passage)}</blockquote>`
        : '';

    const inner = `
        ${label ? `<div class="cfu-label">${escapeHtml(label)}</div>` : ''}
        ${passageHtml}
        <div class="cfu-prompt">${escapeHtml(q.prompt)}</div>
        <ul class="cfu-choices">${choicesHtml}</ul>
        <div class="cfu-feedback">${feedback}</div>
    `;
    return bare ? inner : `<div class="cfu-card">${inner}</div>`;
}

function wireChoices(list, afterReveal) {
    if (!list) return;
    list.querySelectorAll('.cfu-choice').forEach(choice => {
        choice.addEventListener('click', () => {
            if (list.classList.contains('revealed')) return;
            list.classList.add('revealed');
            if (choice.dataset.correct !== 'true') choice.classList.add('chosen-wrong');
            const card = list.parentElement;
            const fb = card.querySelector('.cfu-feedback');
            if (fb) fb.classList.add('show');
            if (afterReveal) afterReveal();
        });
    });
}

function escapeHtml(str) {
    if (str === 0) return '0';
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Deep-link support: #grade=10  or  #grade=10&lesson=3
function handleHash() {
    const hash = window.location.hash;
    const gMatch = hash.match(/grade=(\d+)/);
    if (gMatch) {
        const grade = parseInt(gMatch[1]);
        if (GRADES.includes(grade)) {
            const lMatch = hash.match(/lesson=(\d+)/);
            selectGrade(grade, lMatch ? parseInt(lMatch[1]) : undefined);
            return true;
        }
    }
    return false;
}

initTabs();
if (!handleHash()) selectGrade(GRADES[0]);
