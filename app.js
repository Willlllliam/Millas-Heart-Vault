// app.js
import { getAllEntries, getEntry, putEntry, getMeta, setMeta } from "./db.js";
import { renderMemoryCard, canvasToPngBlob } from "./card.js";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const META_LAST_SAVE_AT = "lastSaveAtMs";
const META_APP_VERSION = "appVersion";
const META_FREE_PASSES = "freePassesRemaining";

// Bump this whenever you deploy changes that may reset/wipe progress.
const APP_VERSION = "2026-02-20.1";
const FREE_PASSES_ON_UPDATE = 7;

const MOODS = [
  { key: "Loved", emoji: "💗" },
  { key: "Grateful", emoji: "🙏" },
  { key: "Joyful", emoji: "😊" },
  { key: "Peaceful", emoji: "🍃" },
  { key: "Excited", emoji: "✨" },
  { key: "Nostalgic", emoji: "🕰️" },
  { key: "Missing", emoji: "🌙" },
  { key: "Proud", emoji: "⭐" }
];

const views = {
  home: document.getElementById("view-home"),
  create: document.getElementById("view-create"),
  keep: document.getElementById("view-keep")
};

const el = {
  // home
  streakLine: document.getElementById("streakLine"),
  btnChooseMoment: document.getElementById("btnChooseMoment"),
  homeHint: document.getElementById("homeHint"),
  timeline: document.getElementById("timeline"),

  // create
  createForDateLine: document.getElementById("createForDateLine"),
  photoInput: document.getElementById("photoInput"),
  dateInput: document.getElementById("dateInput"),
  reflectionInput: document.getElementById("reflectionInput"),
  categoryInput: document.getElementById("categoryInput"),
  moodGrid: document.getElementById("moodGrid"),
  btnCancelCreate: document.getElementById("btnCancelCreate"),
  btnSaveMemory: document.getElementById("btnSaveMemory"),
  createError: document.getElementById("createError"),

  // keep
  cardCanvas: document.getElementById("cardCanvas"),
  btnShareCard: document.getElementById("btnShareCard"),
  btnDoneKeep: document.getElementById("btnDoneKeep")
};

let state = {
  entries: [],
  selectedMood: MOODS[0],
  pendingSavedEntry: null,
  cooldownTimer: null,
  lastSaveAtMs: null,
  freePassesRemaining: 0
};

init();

async function init() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  wireEvents();
  renderMoodGrid();

  await ensureFreePassesOnUpdate();

  // Load cooldown state
  state.lastSaveAtMs = await getMeta(META_LAST_SAVE_AT);
  state.freePassesRemaining = Number(await getMeta(META_FREE_PASSES)) || 0;

  // Default date picker to today
  el.dateInput.value = todayKey();
  el.createForDateLine.textContent = `For: ${prettyDateFromDayKey(el.dateInput.value)}`;

  // Keep the “For:” line in sync with date picker
  el.dateInput.addEventListener("change", () => {
    el.createForDateLine.textContent = `For: ${prettyDateFromDayKey(el.dateInput.value)}`;
  });

  await refreshHome();
  showView("home");

  // start live cooldown countdown UI
  startCooldownTicker();
}

function wireEvents() {
  // Single CTA: always go to Create screen
  el.btnChooseMoment.addEventListener("click", async () => {
    // If cooldown active and no free passes, do nothing (button is disabled anyway, but belt + suspenders)
    if (isCooldownBlocked()) return;

    // Open create for today by default, but user can pick any date in calendar input
    openCreateForDay(todayKey());
  });

  el.btnCancelCreate.addEventListener("click", () => showView("home"));
  el.btnSaveMemory.addEventListener("click", onSaveMemory);

  el.btnShareCard.addEventListener("click", onShareCard);
  el.btnDoneKeep.addEventListener("click", async () => {
    state.pendingSavedEntry = null;
    await refreshHome();
    showView("home");
  });
}

function showView(name) {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function prettyDateFromDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function monthYearLabel(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function prevDayKey(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return todayKey(dt);
}

function calcStreak(entries) {
  if (!entries || entries.length === 0) return 0;

  const keySet = new Set(entries.map(e => e.dayKey));
  const keys = Array.from(keySet).sort((a, b) => b.localeCompare(a)); // newest first
  const newest = keys[0];

  const t = todayKey();
  const y = prevDayKey(t);

  // If she missed a day (newest is before yesterday), streak breaks
  if (newest !== t && newest !== y) return 0;

  // Count backwards from newest saved day
  let streak = 0;
  let cursor = newest;
  while (keySet.has(cursor)) {
    streak++;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

// ---------- update + free-pass helpers ----------

async function ensureFreePassesOnUpdate() {
  const storedVersion = await getMeta(META_APP_VERSION);
  const free = await getMeta(META_FREE_PASSES);

  if (!storedVersion) {
    await setMeta(META_APP_VERSION, APP_VERSION);
    if (free == null) await setMeta(META_FREE_PASSES, FREE_PASSES_ON_UPDATE);
    state.freePassesRemaining = Number(await getMeta(META_FREE_PASSES)) || FREE_PASSES_ON_UPDATE;
    return;
  }

  if (storedVersion !== APP_VERSION) {
    await setMeta(META_APP_VERSION, APP_VERSION);
    await setMeta(META_FREE_PASSES, FREE_PASSES_ON_UPDATE);
    state.freePassesRemaining = FREE_PASSES_ON_UPDATE;
    return;
  }

  if (free == null) {
    await setMeta(META_FREE_PASSES, FREE_PASSES_ON_UPDATE);
    state.freePassesRemaining = FREE_PASSES_ON_UPDATE;
  }
}

function isCooldownBlocked(nowMs = Date.now()) {
  return isCooldownActive(nowMs) && (state.freePassesRemaining <= 0);
}

async function consumeFreePassIfNeeded() {
  if (!isCooldownActive() || state.freePassesRemaining <= 0) return false;
  state.freePassesRemaining = Math.max(0, state.freePassesRemaining - 1);
  await setMeta(META_FREE_PASSES, state.freePassesRemaining);
  return true;
}

// ---------- 24h cooldown helpers ----------

function isCooldownActive(nowMs = Date.now()) {
  if (!state.lastSaveAtMs) return false;
  return (nowMs - state.lastSaveAtMs) < COOLDOWN_MS;
}

function msUntilNextSave(nowMs = Date.now()) {
  if (!state.lastSaveAtMs) return 0;
  const remaining = COOLDOWN_MS - (nowMs - state.lastSaveAtMs);
  return Math.max(0, remaining);
}

function formatCountdown(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function startCooldownTicker() {
  if (state.cooldownTimer) clearInterval(state.cooldownTimer);
  state.cooldownTimer = setInterval(() => {
    // Update button state + hint without expensive DB reload
    updateCooldownUI();
  }, 1000);
  updateCooldownUI();
}

function updateCooldownUI() {
  const cooldownActive = isCooldownActive();
  const blocked = isCooldownBlocked();

  el.btnChooseMoment.disabled = blocked;
  el.btnChooseMoment.style.opacity = blocked ? "0.6" : "1.0";

  if (blocked) {
    const left = msUntilNextSave();
    el.homeHint.innerHTML = `<div class="cooldownTimer">${formatCountdown(left)}</div>`;
    return;
  }

  if (cooldownActive && state.freePassesRemaining > 0) {
    const left = msUntilNextSave();
    el.homeHint.innerHTML = `
      <div style="text-align:center;">
        <div class="subtle">${state.freePassesRemaining} free save${state.freePassesRemaining === 1 ? "" : "s"} left</div>
        <div class="subtle" style="margin-top:6px;">Next normal save in ${formatCountdown(left)}</div>
      </div>
    `;
    return;
  }

  el.homeHint.textContent = "One memory per 24 hours. Permanent once saved.";
}

// ---------- Main UI refresh ----------

async function refreshHome() {
  state.entries = await getAllEntries();
  state.entries.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

  const streak = calcStreak(state.entries);
  el.streakLine.textContent = `🔥 Streak: ${streak} day${streak === 1 ? "" : "s"}`;

  updateCooldownUI();
  renderTimeline(state.entries);
}

function openCreateForDay(dayKey) {
  state.selectedMood = MOODS[0];

  el.createError.textContent = "";
  el.photoInput.value = "";
  el.reflectionInput.value = "";
  el.categoryInput.value = "";

  el.dateInput.value = dayKey;
  el.createForDateLine.textContent = `For: ${prettyDateFromDayKey(dayKey)}`;

  renderMoodGrid();
  showView("create");
}

function renderMoodGrid() {
  el.moodGrid.innerHTML = "";
  MOODS.forEach(m => {
    const b = document.createElement("button");
    b.className = "moodBtn" + (m.key === state.selectedMood.key ? " active" : "");
    b.type = "button";
    b.innerHTML = `<div class="moodIcon">${m.emoji}</div><div class="moodLabel">${m.key}</div>`;
    b.addEventListener("click", () => {
      state.selectedMood = m;
      renderMoodGrid();
    });
    el.moodGrid.appendChild(b);
  });
}

// ---------- Save flow with enforcement ----------

async function onSaveMemory() {
  el.createError.textContent = "";

  // 24h cooldown enforcement (regardless of date chosen)
  if (isCooldownBlocked()) {
    const left = msUntilNextSave();
    el.createError.textContent = `You can save again in ${formatCountdown(left)}. (One memory per 24 hours.)`;
    return;
  }

  // If cooldown is active but she has free passes, consume one now
  await consumeFreePassIfNeeded();

  const file = el.photoInput.files?.[0];
  if (!file) return (el.createError.textContent = "Please choose a photo.");

  const reflection = el.reflectionInput.value.trim();
  if (!reflection) return (el.createError.textContent = "Please write a short reflection.");

  const chosenDayKey = el.dateInput.value || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDayKey)) {
    return (el.createError.textContent = "Invalid date.");
  }

  // one-per-day enforcement (no duplicates for same date)
  const existing = await getEntry(chosenDayKey);
  if (existing) {
    el.createError.textContent = "A memory already exists for that day.";
    return;
  }

  const category = el.categoryInput.value.trim() || null;

  // Store photo as Blob in IndexedDB (permanent inside app storage)
  const photoBlob = file.slice(0, file.size, file.type);

  const entry = {
    dayKey: chosenDayKey,
    momentDateISO: new Date().toISOString(),
    mood: state.selectedMood.key,
    moodEmoji: state.selectedMood.emoji,
    reflection,
    category,
    createdAtISO: new Date().toISOString(),
    photoBlob
  };

  try {
    await putEntry(entry);

    // set last save timestamp for 24h cooldown
    state.lastSaveAtMs = Date.now();
    await setMeta(META_LAST_SAVE_AT, state.lastSaveAtMs);

    await refreshHome(); // update streak/timeline/button immediately
  } catch (e) {
    el.createError.textContent = "Could not save. (Storage blocked?)";
    return;
  }

  state.pendingSavedEntry = { ...entry, prettyDate: prettyDateFromDayKey(entry.dayKey) };
  await renderMemoryCard(el.cardCanvas, state.pendingSavedEntry);

  showView("keep");
}

// ---------- Save/share card (Photos-friendly fallback) ----------

async function onShareCard() {
  if (!state.pendingSavedEntry) return;

  const blob = await canvasToPngBlob(el.cardCanvas);
  const filename = `Milla-Heart-Vault-${state.pendingSavedEntry.dayKey}.png`;

  // 1) Best: Web Share API (often shows "Save Image" on iOS Safari)
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Memory Card",
        text: "Save to Photos (Save Image) or Files (Vault folder)."
      });
      return;
    } catch {
      // user cancelled or share not available -> fallback below
    }
  }

  // 2) Photos-friendly fallback:
  // Open the PNG in a new tab. On iPhone Safari, user can long-press -> "Save Image".
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");

  // Also keep a standard download as backup (some browsers support it)
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {}

  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ---------- Timeline ----------

function renderTimeline(entries) {
  el.timeline.innerHTML = "";
  if (!entries.length) {
    el.timeline.innerHTML = `<div class="card"><div class="subtle">No memories yet. Choose a moment to begin.</div></div>`;
    return;
  }

  let currentMonth = "";
  for (const e of entries) {
    const monthLabel = monthYearLabel(e.dayKey);
    if (monthLabel !== currentMonth) {
      currentMonth = monthLabel;
      const mh = document.createElement("div");
      mh.className = "monthHeader";
      mh.textContent = monthLabel;
      el.timeline.appendChild(mh);
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = entryCardHTML(e);
    el.timeline.appendChild(wrap.firstElementChild);
  }
}

function entryCardHTML(e) {
  const img = card.querySelector("img");
  const url = URL.createObjectURL(e.photoBlob);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => URL.revokeObjectURL(url);
  return `
    <div class="entryCard">
      <div class="entryTop">
        <div class="entryDate">${date}</div>
        <div class="entryMood">${e.moodEmoji} ${e.mood}</div>
      </div>
      <img class="entryImg" src="${imgUrl}" alt="Memory photo" />
      <div class="entryText">${escapeHTML(e.reflection)}</div>
    </div>
  `;
}

function escapeHTML(s) {
  return s.replace(/[&<>"\']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}


