// app.js
import { getAllEntries, getEntry, putEntry, getMeta, setMeta } from "./db.js";
import { renderMemoryCard, canvasToPngBlob } from "./card.js";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const META_LAST_SAVE_AT = "lastSaveAtMs";
const META_STREAK_COUNT = "streakCount";
const META_STREAK_LAST_AT = "streakLastAtMs";
const META_STREAK_LAST_DAYKEY = "streakLastDayKey";
const META_LAST_RUN_STREAK = "lastRunStreak";
const META_BEST_STREAK = "bestStreak";
const META_BACKFILL_USED = "backfillUsed";
const BACKFILL_FREE = 10;

function isBackfillDay(dayKey) {
  return dayKey && dayKey < todayKey();
}

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
  btnBackKeep: document.getElementById("btnBackKeep"),
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
  streakCount: 0,
  streakLastAtMs: 0,
  lastRunStreak: 0,
  bestStreak: 0,
  backfillUsed: 0
};

init();

async function init() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  wireEvents();
  renderMoodGrid();

  // Load cooldown state
try {
  state.lastSaveAtMs = await getMeta(META_LAST_SAVE_AT);
  state.streakCount = (await getMeta(META_STREAK_COUNT)) || 0;
  state.streakLastAtMs = (await getMeta(META_STREAK_LAST_AT)) || 0;
  state.lastRunStreak = (await getMeta(META_LAST_RUN_STREAK)) || 0;
  state.bestStreak = (await getMeta(META_BEST_STREAK)) || 0;
  state.backfillUsed = (await getMeta(META_BACKFILL_USED)) || 0;
} catch (e) {
  console.warn("getMeta failed, will fallback to entries", e);
  state.lastSaveAtMs = null;
}
  // Default date picker to today
  el.dateInput.value = todayKey();
  el.createForDateLine.textContent = `For: ${prettyDateFromDayKey(el.dateInput.value)}`;

  // Keep the “For:” line in sync with date picker
  el.dateInput.addEventListener("change", () => {
    el.createForDateLine.textContent = `For: ${prettyDateFromDayKey(el.dateInput.value)}`;
  });

  await refreshHome();

  // If meta missing/broken, derive lastSaveAt from entries so cooldown works on every device
  if (!state.lastSaveAtMs) {
    const derived = lastSaveAtFromEntries(state.entries);
    if (derived) state.lastSaveAtMs = derived;
  }

  if (state.entries.length) {
  const newest = state.entries[0].dayKey;
  const t = todayKey();
  const y = prevDayKey(t);
  console.log("STREAK_DEBUG", { newest, today: t, yesterday: y, entries: state.entries.length });
  }

  showView("home");

  // start live cooldown countdown UI
  startCooldownTicker();
}

function wireEvents() {
  el.btnBackKeep.addEventListener("click", () => {
  showView("create");
  });
  // Single CTA: always go to Create screen
el.btnChooseMoment.addEventListener("click", () => {
  // Always allow opening Create so she can pick a backfill date even during cooldown.
  openCreateForDay(todayKey());
  updateCooldownUI(); // show cooldown/backfill status immediately
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

function calcChainStreak(entries) {
  if (!entries || entries.length === 0) return 0;

  const keySet = new Set(entries.map(e => e.dayKey));
  const newest = Array.from(keySet).sort((a, b) => b.localeCompare(a))[0];

  let streak = 0;
  let cursor = newest;
  while (keySet.has(cursor)) {
    streak++;
    cursor = prevDayKey(cursor);
  }
  return streak;
}

function calcActiveStreak(entries) {
  if (!entries || entries.length === 0) return 0;

  const keySet = new Set(entries.map(e => e.dayKey));
  const newest = Array.from(keySet).sort((a, b) => b.localeCompare(a))[0];

  const t = todayKey();
  const y = prevDayKey(t);

  if (newest !== t && newest !== y) return 0;
  return calcChainStreak(entries);
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

async function updateCooldownUI() {
  const now = Date.now();
  const last = state.lastSaveAtMs || 0;

  const selectedDayKey = el.dateInput.value || todayKey();
  const backfill = isBackfillDay(selectedDayKey);
  const backfillLeft = BACKFILL_FREE - (state.backfillUsed || 0);

  const cooldownLeft = Math.max(0, COOLDOWN_MS - (now - last));
  const canToday = cooldownLeft === 0;

  const canCreate = backfill ? backfillLeft > 0 : canToday;

  el.btnSaveMemory.disabled = !canCreate;

  // show status in createError (since you don't have cooldownLine)
  if (backfill) {
    el.createError.textContent =
      backfillLeft > 0 ? `Backfill credits left: ${backfillLeft}` : `No backfill credits left.`;
  } else {
    el.createError.textContent =
      canToday ? "" : `You can save again in ${formatCountdown(cooldownLeft)}. (One memory per 24 hours.)`;
  }
}


// ---------- Main UI refresh ----------

async function refreshHome() {
  state.entries = await getAllEntries();
  state.entries.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

  // ✅ self-heal cooldown if meta missing/broken
const now = Date.now();
const active =
  state.streakLastAtMs && now - state.streakLastAtMs <= COOLDOWN_MS
    ? state.streakCount
    : 0;

const lastRun = state.lastRunStreak || 0;
const best = state.bestStreak || 0;

el.streakLine.textContent =
  active > 0
    ? `🔥 Streak: ${active} days (best: ${best})`
    : `🔥 Streak: 0 days (last run: ${lastRun}, best: ${best})`;  
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

  const file = el.photoInput.files?.[0];
  if (!file) return (el.createError.textContent = "Please choose a photo.");

  const reflection = el.reflectionInput.value.trim();
  if (!reflection) return (el.createError.textContent = "Please write a short reflection.");

  const chosenDayKey = el.dateInput.value || todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDayKey)) {
    return (el.createError.textContent = "Invalid date.");
  }

  const backfill = isBackfillDay(chosenDayKey);

  // ✅ cooldown only for "today" saves (non-backfill)
  if (!backfill && isCooldownActive()) {
    const left = msUntilNextSave();
    el.createError.textContent = `You can save again in ${formatCountdown(left)}. (One memory per 24 hours.)`;
    return;
  }

  // ✅ backfill credit gate
  if (backfill) {
    const used = state.backfillUsed || 0;
    if (used >= BACKFILL_FREE) {
      el.createError.textContent = "Backfill limit reached (10).";
      return;
    }
  }

  // one-per-day enforcement
  const existing = await getEntry(chosenDayKey);
  if (existing) {
    el.createError.textContent = "A memory already exists for that day.";
    return;
  }

  const category = el.categoryInput.value.trim() || null;
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

    const now = Date.now();

    if (backfill) {
      state.backfillUsed = (state.backfillUsed || 0) + 1;
      try { await setMeta(META_BACKFILL_USED, state.backfillUsed); } catch {}
      // backfills do NOT touch streak or cooldown
    } else {
      // ✅ update streak (24h-based) + cooldown
      const lastAt = state.streakLastAtMs || 0;
      const lastDayKey = (await getMeta(META_STREAK_LAST_DAYKEY)) || null;

      if (lastDayKey !== todayKey()) {
        if (lastAt && now - lastAt > COOLDOWN_MS) {
          state.lastRunStreak = state.streakCount || 0;
          try { await setMeta(META_LAST_RUN_STREAK, state.lastRunStreak); } catch {}
          state.streakCount = 1;
        } else {
          state.streakCount = (state.streakCount || 0) + 1;
        }

        state.bestStreak = Math.max(state.bestStreak || 0, state.streakCount);
        try {
          await setMeta(META_BEST_STREAK, state.bestStreak);
          await setMeta(META_STREAK_COUNT, state.streakCount);
          await setMeta(META_STREAK_LAST_DAYKEY, todayKey());
        } catch {}
      }

      state.streakLastAtMs = now;
      state.lastSaveAtMs = now;

      try {
        await setMeta(META_STREAK_LAST_AT, now);
        await setMeta(META_LAST_SAVE_AT, now);
      } catch {}
    }

    await refreshHome();
    showView("keep");
  } catch (e) {
    console.error("SAVE_FAILED", e);
    el.createError.textContent = `Could not save: ${e?.name || "Error"}${e?.message ? " — " + e.message : ""}`;
  }
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

    const cardEl = wrap.firstElementChild;
    el.timeline.appendChild(cardEl);

    // ✅ after appending: set image src + revoke URL to avoid memory leaks
    const imgEl = cardEl.querySelector(".entryImg");
    const url = URL.createObjectURL(e.photoBlob);
    imgEl.src = url;
    imgEl.onload = () => URL.revokeObjectURL(url);
    imgEl.onerror = () => URL.revokeObjectURL(url);
  }
}

function entryCardHTML(e) {
  const date = prettyDateFromDayKey(e.dayKey);
  return `
    <div class="entryCard">
      <div class="entryTop">
        <div class="entryDate">${date}</div>
        <div class="entryMood">${e.moodEmoji} ${e.mood}</div>
      </div>
      <img class="entryImg" alt="Memory photo" />
      <div class="entryText">${escapeHTML(e.reflection)}</div>
    </div>
  `;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function lastSaveAtFromEntries(entries) {
  let max = null;

  for (const e of (entries || [])) {
    // Prefer createdAtISO (your newer entries)
    if (e.createdAtISO) {
      const t = Date.parse(e.createdAtISO);
      if (!Number.isNaN(t)) max = max == null ? t : Math.max(max, t);
      continue;
    }

    // Fallback: momentDateISO if present
    if (e.momentDateISO) {
      const t = Date.parse(e.momentDateISO);
      if (!Number.isNaN(t)) max = max == null ? t : Math.max(max, t);
    }
  }

  return max; // ms or null
}
