const DEFAULT_PHRASES = [
  { keywords: ["जोड़", "तीन आम", "दो आम"], olChiki: "ᱛᱮᱦᱮᱧ ᱟᱵᱚ ᱥᱮᱞᱮᱫ ᱵᱚ ᱥᱮᱪᱮᱫᱟ। ᱯᱮ ᱟᱢ ᱟᱨ ᱵᱟᱨ ᱟᱢ ᱥᱮᱞᱮᱫ ᱠᱟᱛᱮ ᱛᱤᱱᱟᱹᱠ ᱟᱢ ᱦᱩᱭᱩᱜᱼᱟ?", roman: "Tehen abo seled bo secheda. Pe am ar bar am selet kate tinak am huyuk'a?" },
  { keywords: ["समझ", "समझ गए"], olChiki: "ᱪᱮᱫ ᱟᱢ ᱵᱩᱡᱷᱟᱹᱣ ᱠᱮᱫᱟ?", roman: "Ched am bujhau keda?" },
  { keywords: ["उत्तर", "बोलकर"], olChiki: "ᱨᱚᱲ ᱠᱟᱛᱮ ᱛᱮᱞᱟ ᱢᱮ।", roman: "Roṛ kate tela me." },
  { keywords: ["नमस्ते", "बच्चों"], olChiki: "ᱡᱚᱦᱟᱨ ᱜᱤᱫᱨᱟᱹ ᱠᱚ।", roman: "Johar gidra ko." }
];

const DEFAULT_LESSONS = [
  { id: "lesson-addition", subject: "Mathematics", topic: "Addition", className: "Class 3", desc: "Add numbers using familiar objects and short oral questions.", createdAt: "2026-09-20T09:00:00.000Z" },
  { id: "lesson-subtraction", subject: "Mathematics", topic: "Subtraction", className: "Class 3", desc: "Understand taking away with everyday classroom examples.", createdAt: "2026-09-20T09:10:00.000Z" },
  { id: "lesson-plants", subject: "Environmental Studies", topic: "Our Plants", className: "Class 2", desc: "Identify common plants and learn what they need to grow.", createdAt: "2026-09-20T09:20:00.000Z" },
  { id: "lesson-words", subject: "Hindi", topic: "Simple Words", className: "Class 1", desc: "Listen to and repeat simple everyday Hindi words.", createdAt: "2026-09-20T09:30:00.000Z" },
  { id: "lesson-shapes", subject: "Mathematics", topic: "Shapes", className: "Class 2", desc: "Recognise circles, squares, triangles and rectangles.", createdAt: "2026-09-20T09:40:00.000Z" },
  { id: "lesson-family", subject: "Environmental Studies", topic: "My Family", className: "Class 1", desc: "Talk about family members in both languages.", createdAt: "2026-09-20T09:50:00.000Z" }
];
const DEFAULT_SETTINGS = { teacherName: "Anita Soren", schoolName: "Government Primary School", defaultClass: "Class 3", autoSpeak: false, showScript: true, offlineOnly: false, speechRate: 0.88, responseCount: 0 };
const STORE_KEY = "voicemate-state-v1";
const legacyHistory = JSON.parse(localStorage.getItem("voicemate-history") || "[]");
const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
const state = saved || { lessons: DEFAULT_LESSONS, history: legacyHistory.map((item, index) => ({ id: `legacy-${index}`, ...item })), worksheets: [], settings: DEFAULT_SETTINGS, pendingSync: 0 };
state.lessons ||= DEFAULT_LESSONS; state.history ||= []; state.worksheets ||= [];
state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) }; state.pendingSync ||= 0;

let phrases = DEFAULT_PHRASES, deferredInstallPrompt = null, backendOnline = false, confirmCallback = null, sessionTranslations = 0, currentTranslation = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function persist({ queue = false } = {}) {
  if (queue) state.pendingSync += 1;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  updateStorageUsed(); updateConnection();
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}
function setView(name) {
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === name));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `${name}View`));
  $(".sidebar").classList.remove("open");
  if (name === "lessons") renderLessons(); if (name === "worksheets") renderWorksheet();
  if (name === "history") renderHistory(); if (name === "progress") renderProgress(); if (name === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateConnection() {
  const label = $("#connectionText"), pill = $("#connectionPill");
  if (!navigator.onLine || state.settings.offlineOnly) { label.textContent = state.pendingSync ? `Offline · ${state.pendingSync} pending` : "Offline mode"; pill.title = "Saved on this device; sync will resume later"; }
  else if (backendOnline) { label.textContent = state.pendingSync ? `${state.pendingSync} pending · tap to sync` : "Online · synced"; pill.title = "Tap to sync now"; }
  else { label.textContent = state.pendingSync ? `Local · ${state.pendingSync} pending` : "Local mode"; pill.title = "Start server.py to enable SQLite sync"; }
  $("#pendingSync").textContent = `${state.pendingSync} item${state.pendingSync === 1 ? "" : "s"}`;
}
async function checkBackend() {
  if (location.protocol === "file:" || state.settings.offlineOnly || !navigator.onLine) { backendOnline = false; updateConnection(); return false; }
  try { backendOnline = (await fetch("/api/health", { cache: "no-store" })).ok; } catch { backendOnline = false; }
  updateConnection(); return backendOnline;
}
async function syncNow({ quiet = false } = {}) {
  if (!(await checkBackend())) { if (!quiet) showToast(state.settings.offlineOnly ? "Offline-only mode is enabled." : "Server unavailable. Changes remain safely on this device."); return false; }
  try {
    const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessons: state.lessons, history: state.history, worksheets: state.worksheets, settings: state.settings }) });
    if (!response.ok) throw new Error("Sync failed"); state.pendingSync = 0; persist(); if (!quiet) showToast("All classroom data synced to SQLite."); return true;
  } catch { backendOnline = false; updateConnection(); if (!quiet) showToast("Sync paused. Local data is unchanged."); return false; }
}
async function loadPhrasebook() {
  try { const response = await fetch("data/phrasebook.json"); if (response.ok) { const data = await response.json(); phrases = data.phrases.map(item => ({ hindi: item.hindi, keywords: item.keywords, olChiki: item.olChiki, roman: item.roman })); } } catch { phrases = DEFAULT_PHRASES; }
}
function normalizeHindi(text) { return text.replace(/[।.?!,\s]+$/g, "").replace(/\s+/g, " ").trim(); }
// 1) exact phrasebook match (curated), 2) machine translation via /api/translate, 3) old keyword hint as last resort.
async function selectTranslation(text) {
  const clean = normalizeHindi(text);
  const exact = phrases.find(item => item.hindi && normalizeHindi(item.hindi) === clean);
  if (exact) return { olChiki: exact.olChiki, roman: exact.roman, confidence: null, label: "Phrasebook match (curated)", source: "phrasebook" };
  let failure = "";
  try {
    const response = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const data = await response.json();
    if (data.ok && data.olChiki) return { olChiki: data.olChiki, roman: data.roman || "", confidence: null, label: `Machine translation${data.cached ? " (cached)" : ""} · review before classroom use`, source: "model" };
    failure = data.error || "Translation service error";
  } catch { failure = "Server not reachable (offline)"; }
  const hinted = phrases.filter(item => item.keywords && item.keywords.some(keyword => text.includes(keyword)));
  if (hinted.length) { const item = hinted[0]; return { olChiki: item.olChiki, roman: item.roman, confidence: null, label: `Closest phrasebook hint only, may not match your sentence. ${failure}`, source: "hint" }; }
  return { olChiki: "", roman: `Translation unavailable: ${failure}`, confidence: null, label: failure, source: "none" };
}
function speakCurrent() {
  if (!("speechSynthesis" in window) || !currentTranslation) return showToast("Audio playback is not supported here.");
  if (!currentTranslation.roman || currentTranslation.source === "none") return showToast("No Romanized text to read aloud (browsers have no Santhali voice).");
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(currentTranslation.roman); utterance.lang = "hi-IN"; utterance.rate = Number(state.settings.speechRate);
  utterance.onstart = () => $("#listenButton").classList.add("playing"); utterance.onend = () => $("#listenButton").classList.remove("playing"); speechSynthesis.speak(utterance);
}
async function translate() {
  const hindi = $("#teacherInput").value.trim(); if (!hindi) return showToast("Type, paste, or transcribe a Hindi sentence first.");
  const button = $("#translateButton"), output = $("#translationOutput"); button.disabled = true; button.textContent = "Translating…"; output.style.opacity = ".35";
  try {
    currentTranslation = await selectTranslation(hindi);
    output.innerHTML = `${state.settings.showScript && currentTranslation.olChiki ? `<p class="ol-chiki">${escapeHtml(currentTranslation.olChiki)}</p>` : ""}${currentTranslation.roman ? `<p>${escapeHtml(currentTranslation.roman)}</p>` : ""}`;
    $("#confidenceText").textContent = currentTranslation.label;
    state.history.unshift({ id: uid("translation"), hindi, santhali: currentTranslation.roman || currentTranslation.olChiki, olChiki: currentTranslation.olChiki, lesson: $("#lessonSummary").textContent, at: new Date().toISOString() }); state.history = state.history.slice(0, 200);
    sessionTranslations += 1; $("#phraseCount").textContent = String(sessionTranslations).padStart(2, "0"); persist({ queue: true }); output.style.opacity = "1"; button.disabled = false;
    button.innerHTML = 'Translate <svg viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"></path></svg>'; showToast(currentTranslation.source === "none" ? "Could not translate. See message." : "Translation ready and saved offline."); if (state.settings.autoSpeak) speakCurrent();
  } catch (error) { output.style.opacity = "1"; button.disabled = false; button.innerHTML = 'Translate <svg viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"></path></svg>'; showToast("Translation failed: " + error.message); }
}
function updateLessonSummary() { $("#lessonSummary").textContent = [$("#classSelect").value, $("#subjectSelect").value, $("#topicSelect").value].join(" · "); }

function renderLessons() {
  const query = $("#lessonSearch").value.trim().toLowerCase(), filter = $("#lessonFilter").value;
  const lessons = state.lessons.filter(item => `${item.topic} ${item.subject} ${item.className} ${item.desc}`.toLowerCase().includes(query) && (filter === "All subjects" || item.subject === filter));
  $("#lessonList").innerHTML = lessons.length ? lessons.map(lesson => `<article class="lesson-item"><span class="subject-badge">${escapeHtml(lesson.className)} · ${escapeHtml(lesson.subject)}</span><h3>${escapeHtml(lesson.topic)}</h3><p>${escapeHtml(lesson.desc)}</p><button data-lesson="${escapeHtml(lesson.id)}">Open in classroom →</button></article>`).join("") : '<div class="empty-state">No lessons match your search.</div>';
}
function openLesson(id) {
  const lesson = state.lessons.find(item => item.id === id); if (!lesson) return;
  $("#classSelect").value = lesson.className; $("#subjectSelect").value = lesson.subject;
  if (![...$("#topicSelect").options].some(option => option.value === lesson.topic)) $("#topicSelect").add(new Option(lesson.topic, lesson.topic));
  $("#topicSelect").value = lesson.topic; updateLessonSummary(); setView("classroom"); showToast(`${lesson.topic} lesson opened.`);
}
function worksheetQuestions(total, difficulty) {
  const banks = {
    Easy: ["1 + 2 = ____ / ᱢᱤᱫ + ᱵᱟᱨ = ____", "2 + 3 = ____ / ᱵᱟᱨ + ᱯᱮ = ____", "4 + 1 = ____ / ᱯᱩᱱ + ᱢᱤᱫ = ____", "Count 5 mangoes. / 5 आम गिनो।", "Say the answer aloud. / उत्तर बोलकर बताओ।"],
    Mixed: ["2 + 3 = ____ / ᱵᱟᱨ + ᱯᱮ = ____", "4 + 1 = ____ / ᱯᱩᱱ + ᱢᱤᱫ = ____", "Count 5 mangoes, add 2. / 5 आम में 2 आम जोड़ो।", "3 birds + 3 birds = ____ / 3 चिड़िया + 3 चिड़िया = ____", "Draw 4 circles and add 1 more. / 4 गोले बनाओ और 1 जोड़ो।", "6 + 2 = ____ / ᱛᱩᱨᱩᱭ + ᱵᱟᱨ = ____", "Say the answer aloud. / उत्तर बोलकर बताओ।", "Make your own addition example. / अपना जोड़ का उदाहरण बनाओ।"],
    Practice: ["7 + 2 = ____", "5 + 4 = ____", "8 + 1 = ____", "6 + 3 = ____", "4 + 4 = ____", "Draw and solve: 3 + 5", "Explain one answer aloud.", "Create two addition questions."]
  }; const source = banks[difficulty] || banks.Mixed; return Array.from({ length: total }, (_, index) => source[index % source.length]);
}
function renderWorksheet() {
  const total = Number($("#questionCount").value), difficulty = $("#difficulty").value, lesson = $("#lessonSummary").textContent;
  $("#worksheetPreview").innerHTML = `<article class="worksheet-sheet"><header><span>VoiceMate</span><h2>Bilingual Practice Sheet</h2><p>${escapeHtml(lesson)} · ${escapeHtml(difficulty)}</p><p>Name: ____________________ &nbsp; Date: __________</p></header><ol>${worksheetQuestions(total, difficulty).map(question => `<li>${escapeHtml(question)}</li>`).join("")}</ol></article>`;
  $("#savedWorksheetCount").textContent = state.worksheets.length;
}
function saveWorksheet() { state.worksheets.unshift({ id: uid("worksheet"), lesson: $("#lessonSummary").textContent, questionCount: Number($("#questionCount").value), difficulty: $("#difficulty").value, createdAt: new Date().toISOString() }); persist({ queue: true }); renderWorksheet(); showToast("Worksheet saved on this device."); }
function renderHistory() {
  const query = $("#historySearch").value.trim().toLowerCase(); const history = state.history.filter(item => `${item.hindi} ${item.santhali} ${item.lesson}`.toLowerCase().includes(query));
  $("#historyCount").textContent = `${history.length} translation${history.length === 1 ? "" : "s"}`;
  $("#historyList").innerHTML = history.length ? history.map(item => `<article class="history-item"><div><small>HINDI</small><p>${escapeHtml(item.hindi)}</p></div><svg viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"></path></svg><div><small>SANTHALI</small><p>${escapeHtml(item.santhali)}</p></div><time>${new Date(item.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>`).join("") : '<div class="empty-state">No saved translations match this search.</div>';
}
function downloadFile(name, content, type) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function exportHistory() {
  const rows = [["Time", "Lesson", "Hindi", "Santhali"], ...state.history.map(item => [item.at, item.lesson, item.hindi, item.santhali])];
  const csv = rows.map(row => row.map(value => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\n"); downloadFile("voicemate-translations.csv", `\uFEFF${csv}`, "text/csv;charset=utf-8"); showToast("Translation history exported.");
}
function renderProgress() {
  $("#progressTranslations").textContent = state.history.length; $("#progressLessons").textContent = state.lessons.length; $("#progressWorksheets").textContent = state.worksheets.length;
  $("#progressResponses").textContent = state.history.length ? `${Math.min(100, Math.round((state.settings.responseCount / state.history.length) * 100))}%` : "0%";
  const today = new Date(), activity = Array.from({ length: 7 }, (_, index) => { const date = new Date(today); date.setDate(today.getDate() - (6 - index)); return { label: date.toLocaleDateString([], { weekday: "short" }), value: state.history.filter(item => new Date(item.at).toDateString() === date.toDateString()).length }; });
  const max = Math.max(1, ...activity.map(item => item.value)); $("#activityChart").innerHTML = activity.map(item => `<div class="bar-column"><strong>${item.value || ""}</strong><i style="height:${Math.max(4, item.value / max * 165)}px"></i><span>${item.label}</span></div>`).join("");
  const events = [...state.history.slice(0, 4).map(item => ({ text: `Translated “${item.hindi.slice(0, 42)}${item.hindi.length > 42 ? "…" : ""}”`, at: item.at })), ...state.worksheets.slice(0, 2).map(item => ({ text: `Saved a ${item.difficulty.toLowerCase()} worksheet`, at: item.createdAt }))].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  $("#activityFeed").innerHTML = events.length ? events.map(event => `<div class="activity-event"><i></i><p>${escapeHtml(event.text)}</p><time>${new Date(event.at).toLocaleDateString([], { month: "short", day: "numeric" })}</time></div>`).join("") : '<div class="empty-state">Classroom activity will appear here.</div>'; updateConnection();
}
function updateStorageUsed() { const element = $("#storageUsed"); if (element) element.textContent = `${(new Blob([JSON.stringify(state)]).size / 1024).toFixed(1)} KB`; }
function renderSettings() {
  $("#teacherName").value = state.settings.teacherName; $("#schoolName").value = state.settings.schoolName; $("#defaultClass").value = state.settings.defaultClass;
  $("#autoSpeak").checked = state.settings.autoSpeak; $("#showScript").checked = state.settings.showScript; $("#offlineOnly").checked = state.settings.offlineOnly;
  $("#speechRate").value = state.settings.speechRate; $("#speechRateOutput").textContent = `${Number(state.settings.speechRate).toFixed(2)}×`; updateStorageUsed();
}
function saveProfile() {
  state.settings.teacherName = $("#teacherName").value.trim() || "Teacher"; state.settings.schoolName = $("#schoolName").value.trim(); state.settings.defaultClass = $("#defaultClass").value;
  $(".profile strong").textContent = state.settings.teacherName; $(".avatar").textContent = state.settings.teacherName.split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase(); persist({ queue: true }); showToast("Teacher profile saved.");
}
function savePreference(key, value) { state.settings[key] = value; persist({ queue: true }); $("#settingsState").textContent = "All changes saved"; if (key === "offlineOnly") checkBackend(); }
function confirmAction(title, message, action) { $("#confirmTitle").textContent = title; $("#confirmMessage").textContent = message; confirmCallback = action; $("#confirmDialog").showModal(); }
function resetAllData() { localStorage.removeItem(STORE_KEY); localStorage.removeItem("voicemate-history"); location.reload(); }

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#teacherMic");
  if (!Recognition) { mic.addEventListener("click", () => showToast("Speech recognition is unavailable here. Use transcription typing instead.")); $("#startTranscriptionButton").disabled = true; $("#startTranscriptionButton").textContent = "Speech input unavailable"; $("#transcriptionStatus").textContent = "Speech recognition is unavailable. You can type or paste a transcript below."; return; }
  const quick = new Recognition(); quick.lang = "hi-IN"; quick.interimResults = false;
  quick.onstart = () => { mic.classList.add("listening"); $("#micHint").textContent = "Listening in Hindi…"; };
  quick.onresult = event => { $("#teacherInput").value = event.results[0][0].transcript; translate(); };
  quick.onerror = () => showToast("Voice input stopped. You can type instead."); quick.onend = () => { mic.classList.remove("listening"); $("#micHint").textContent = "Tap mic or type your sentence"; };
  mic.addEventListener("click", () => quick.start());
  const live = new Recognition(); live.lang = "hi-IN"; live.continuous = true; live.interimResults = true; let committed = "";
  live.onstart = () => { $("#transcriptionDialog").classList.add("listening"); $("#transcriptionStatus").textContent = "Listening… speak in Hindi."; $("#startTranscriptionButton").textContent = "Stop listening"; };
  live.onresult = event => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { if (event.results[i].isFinal) committed += `${event.results[i][0].transcript} `; else interim += event.results[i][0].transcript; } $("#transcriptionText").value = `${committed}${interim}`.trim(); };
  live.onend = () => { $("#transcriptionDialog").classList.remove("listening"); $("#transcriptionStatus").textContent = "Transcription paused. Edit the text or send it to the translator."; $("#startTranscriptionButton").textContent = "Start listening"; };
  live.onerror = () => showToast("Live recognition stopped. Manual transcription still works.");
  $("#startTranscriptionButton").addEventListener("click", event => { event.preventDefault(); if ($("#transcriptionDialog").classList.contains("listening")) live.stop(); else { committed = $("#transcriptionText").value ? `${$("#transcriptionText").value.trim()} ` : ""; live.start(); } });
  $("#transcriptionDialog").addEventListener("close", () => { if ($("#transcriptionDialog").classList.contains("listening")) live.stop(); });
}

function bindEvents() {
  $$(".nav-item[data-view]").forEach(item => item.addEventListener("click", () => setView(item.dataset.view))); $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open")); $("#connectionPill").addEventListener("click", () => syncNow());
  $("#translateButton").addEventListener("click", translate); $$("[data-prompt]").forEach(button => button.addEventListener("click", () => { $("#teacherInput").value = button.dataset.prompt; $("#teacherInput").focus(); })); $("#listenButton").addEventListener("click", speakCurrent);
  $("#editTranslationButton").addEventListener("click", event => { const editing = $("#translationOutput").contentEditable === "true"; $("#translationOutput").contentEditable = String(!editing); event.currentTarget.textContent = editing ? "Edit translation" : "Save translation"; if (!editing) $("#translationOutput").focus(); else showToast("Correction saved for this session."); });
  [$("#classSelect"), $("#subjectSelect"), $("#topicSelect")].forEach(field => field.addEventListener("change", updateLessonSummary));
  $("#newSessionButton").addEventListener("click", () => { sessionTranslations = 0; $("#phraseCount").textContent = "00"; $("#teacherInput").value = ""; $("#translationOutput").innerHTML = '<p class="ol-chiki">ᱡᱚᱦᱟᱨ!</p><p>Your translation will appear here.</p>'; $("#teacherInput").focus(); showToast("New classroom session started."); });
  $("#studentResponseButton").addEventListener("click", () => { $("#teacherResult").hidden = true; $("#responseDialog").showModal(); });
  $("#convertResponseButton").addEventListener("click", event => { event.preventDefault(); const value = $("#studentInput").value.toLowerCase(); $("#teacherResult strong").textContent = value.includes("moṛe") || value.includes("more") ? "पाँच आम।" : "विद्यार्थी ने उत्तर दिया।"; $("#teacherResult").hidden = false; state.settings.responseCount += 1; persist({ queue: true }); });
  $("#lessonSearch").addEventListener("input", renderLessons); $("#lessonFilter").addEventListener("change", renderLessons); $("#lessonList").addEventListener("click", event => { const button = event.target.closest("[data-lesson]"); if (button) openLesson(button.dataset.lesson); }); $("#addLessonButton").addEventListener("click", () => $("#lessonDialog").showModal());
  $("#createLessonButton").addEventListener("click", event => { event.preventDefault(); const topic = $("#newLessonTopic").value.trim(); if (!topic) return $("#newLessonTopic").focus(); state.lessons.unshift({ id: uid("lesson"), topic, className: $("#newLessonClass").value, subject: $("#newLessonSubject").value, desc: $("#newLessonDescription").value.trim() || "Teacher-created offline lesson.", createdAt: new Date().toISOString() }); persist({ queue: true }); renderLessons(); $("#lessonDialog").close(); $("#lessonForm").reset(); showToast("Lesson saved for offline use."); });
  $("#questionCount").addEventListener("change", renderWorksheet); $("#difficulty").addEventListener("change", renderWorksheet); $("#generateWorksheetButton").addEventListener("click", () => { renderWorksheet(); showToast("Bilingual worksheet generated."); }); $("#saveWorksheetButton").addEventListener("click", saveWorksheet); $("#printWorksheetButton").addEventListener("click", () => window.print());
  $("#historySearch").addEventListener("input", renderHistory); $("#exportHistoryButton").addEventListener("click", exportHistory); $("#clearHistoryButton").addEventListener("click", () => confirmAction("Clear translation history?", "All saved translations will be removed from this device.", () => { state.history = []; persist({ queue: true }); renderHistory(); showToast("Translation history cleared."); }));
  $("#confirmAction").addEventListener("click", () => { if (confirmCallback) confirmCallback(); confirmCallback = null; }); $("#saveProfileButton").addEventListener("click", saveProfile);
  $("#autoSpeak").addEventListener("change", event => savePreference("autoSpeak", event.target.checked)); $("#showScript").addEventListener("change", event => savePreference("showScript", event.target.checked)); $("#offlineOnly").addEventListener("change", event => savePreference("offlineOnly", event.target.checked)); $("#speechRate").addEventListener("input", event => { $("#speechRateOutput").textContent = `${Number(event.target.value).toFixed(2)}×`; savePreference("speechRate", Number(event.target.value)); });
  $("#exportDataButton").addEventListener("click", () => downloadFile("voicemate-backup.json", JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2), "application/json"));
  $("#importDataInput").addEventListener("change", async event => { try { const data = JSON.parse(await event.target.files[0].text()); Object.assign(state, { lessons: data.lessons || state.lessons, history: data.history || [], worksheets: data.worksheets || [], settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }, pendingSync: 1 }); persist(); renderSettings(); showToast("Backup imported successfully."); } catch { showToast("That backup could not be imported."); } event.target.value = ""; }); $("#resetDataButton").addEventListener("click", () => confirmAction("Reset VoiceMate?", "All local data will return to defaults.", resetAllData));
  $("#openTranscriptionButton").addEventListener("click", () => $("#transcriptionDialog").showModal()); $("#clearTranscriptionButton").addEventListener("click", event => { event.preventDefault(); $("#transcriptionText").value = ""; });
  $("#copyTranscriptionButton").addEventListener("click", async event => { event.preventDefault(); try { await navigator.clipboard.writeText($("#transcriptionText").value); showToast("Transcript copied."); } catch { showToast("Copy unavailable; select it manually."); } });
  $("#useTranscriptionButton").addEventListener("click", event => { event.preventDefault(); const text = $("#transcriptionText").value.trim(); if (!text) return showToast("Add a transcript first."); $("#teacherInput").value = text; $("#transcriptionDialog").close(); setView("classroom"); $("#teacherInput").focus(); showToast("Transcript moved to the translator."); });
  $("#installButton").addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $("#installButton").hidden = true; });
}

async function initialize() {
  bindEvents(); setupSpeechRecognition(); await loadPhrasebook(); renderLessons(); renderWorksheet(); renderSettings(); $("#phraseCount").textContent = "00"; $("#classSelect").value = state.settings.defaultClass;
  $(".profile strong").textContent = state.settings.teacherName; $(".avatar").textContent = state.settings.teacherName.split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase(); updateLessonSummary(); await checkBackend(); if (backendOnline && state.pendingSync) syncNow({ quiet: true });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt = event; $("#installButton").hidden = false; });
window.addEventListener("online", () => { showToast("Connection restored. Syncing saved work…"); syncNow({ quiet: true }); });
window.addEventListener("offline", () => { backendOnline = false; updateConnection(); showToast("You are offline. VoiceMate keeps saving locally."); });
initialize();