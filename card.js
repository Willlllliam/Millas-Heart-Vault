// card.js

const CARD_W = 1080;
const PAD = 72;

const TITLE_FONT = "700 48px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
const SUB_FONT = "500 34px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
const LABEL_FONT = "700 34px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
const BODY_FONT = "400 38px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
const SMALL_FONT = "500 30px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

const LINE_H = 52;

function wrapLines(ctx, text, maxWidth) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let line = "";

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);

  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;

  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function parseDayKey(dayKey) {
  const [y, m, d] = (dayKey || "").split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt;
}

function prettyDate(dayKey) {
  const dt = parseDayKey(dayKey);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export async function renderMemoryCard(canvas, entry) {
  const ctx = canvas.getContext("2d");

  const appTitle = "Milla’s Heart Vault";
  const dateStr = entry?.prettyDate || prettyDate(entry?.dayKey);
  const moodStr = entry?.moodEmoji ? `${entry.moodEmoji} ${entry.mood || ""}`.trim() : (entry?.mood || "");
  const category = (entry?.category || "").trim();
  const reflection = (entry?.reflection || "").trim();

  // Prepare reflection lines (for dynamic height)
  ctx.font = BODY_FONT;
  const maxTextW = CARD_W - PAD * 2;
  const reflectionLines = wrapLines(ctx, reflection, maxTextW);

  // Layout constants
  const topY = PAD;
  const headerH = 170;
  const photoH = 720;
  const gapAfterPhoto = 54;
  const labelGap = 22;
  const sectionTopGap = 26;

  const reflectionLabelH = 44;
  const reflectionH = reflectionLines.length ? (reflectionLines.length * LINE_H) : LINE_H;

  const footerH = category ? 110 : 70;

  const totalH =
    PAD +
    headerH +
    photoH +
    gapAfterPhoto +
    reflectionLabelH +
    labelGap +
    reflectionH +
    sectionTopGap +
    footerH +
    PAD;

  canvas.width = CARD_W;
  canvas.height = Math.ceil(totalH);

  // Background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff5f8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Card surface (subtle)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, 28, 28, canvas.width - 56, canvas.height - 56, 44);
  ctx.fill();
  ctx.restore();

  // Header
  let y = topY;

  ctx.fillStyle = "#2b2b2b";
  ctx.font = TITLE_FONT;
  ctx.fillText(appTitle, PAD, y + 54);

  ctx.fillStyle = "#5a5a5a";
  ctx.font = SUB_FONT;
  ctx.fillText(dateStr, PAD, y + 110);

  if (moodStr) {
    const moodX = PAD;
    const moodY = y + 155;
    ctx.fillStyle = "#2b2b2b";
    ctx.font = SUB_FONT;
    ctx.fillText(moodStr, moodX, moodY);
  }

  y += headerH;

  // Photo
  const photoX = PAD;
  const photoY = y;
  const photoW = CARD_W - PAD * 2;
  const photoR = 44;

  // Photo shadow-ish
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#000000";
  roundRectPath(ctx, photoX + 8, photoY + 10, photoW, photoH, photoR);
  ctx.fill();
  ctx.restore();

  // Photo clip + draw
  ctx.save();
  roundRectPath(ctx, photoX, photoY, photoW, photoH, photoR);
  ctx.clip();

  if (entry?.photoBlob) {
    try {
      const img = await blobToImage(entry.photoBlob);
      drawImageCover(ctx, img, photoX, photoY, photoW, photoH);
    } catch {
      ctx.fillStyle = "#ffe2ea";
      ctx.fillRect(photoX, photoY, photoW, photoH);
      ctx.fillStyle = "#8a8a8a";
      ctx.font = SUB_FONT;
      ctx.fillText("Photo unavailable", photoX + 40, photoY + 80);
    }
  } else {
    ctx.fillStyle = "#ffe2ea";
    ctx.fillRect(photoX, photoY, photoW, photoH);
  }

  ctx.restore();

  y += photoH + gapAfterPhoto;

  // Reflection label
  ctx.fillStyle = "#2b2b2b";
  ctx.font = LABEL_FONT;
  ctx.fillText("Reflection", PAD, y + 36);
  y += reflectionLabelH + labelGap;

  // Reflection text
  ctx.fillStyle = "#2b2b2b";
  ctx.font = BODY_FONT;

  if (reflectionLines.length === 0) {
    ctx.fillText("—", PAD, y + 10);
    y += LINE_H;
  } else {
    for (const line of reflectionLines) {
      ctx.fillText(line, PAD, y + 10);
      y += LINE_H;
    }
  }

  y += sectionTopGap;

  // Footer / Category
  ctx.fillStyle = "#5a5a5a";
  ctx.font = SMALL_FONT;

  if (category) {
    ctx.fillText(`Category: ${category}`, PAD, y + 40);
    y += 56;
  }

  ctx.fillStyle = "#8a8a8a";
  ctx.font = SMALL_FONT;
  ctx.fillText("Choose one moment worth keeping forever.", PAD, y + 40);
}

export async function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}
