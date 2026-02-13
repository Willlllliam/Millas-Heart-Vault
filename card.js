// card.js
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;

  for (let n = 0; n < words.length; n++) {
    const test = line ? line + " " + words[n] : words[n];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = words[n];
      y += lineHeight;
      lines++;
      if (lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (lines < maxLines) ctx.fillText(line, x, y);
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export async function renderMemoryCard(canvas, entry) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // background
  ctx.fillStyle = "#FFF3F6";
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = "#2f1f25";
  ctx.font = "700 54px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("Milla’s Heart Vault", 70, 110);

  ctx.fillStyle = "#6d5962";
  ctx.font = "500 32px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText(entry.prettyDate, 70, 160);

  // photo container
  const img = await blobToImage(entry.photoBlob);
  const photoX = 70,
    photoY = 210,
    photoW = W - 140,
    photoH = 650;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.10)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, photoX, photoY, photoW, photoH, 40);
  ctx.fill();
  ctx.restore();

  // clip and draw photo (cover crop)
  ctx.save();
  roundRect(ctx, photoX, photoY, photoW, photoH, 40);
  ctx.clip();

  const scale = Math.max(photoW / img.width, photoH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = photoX + (photoW - dw) / 2;
  const dy = photoY + (photoH - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // mood pill
  const pillText = `${entry.moodEmoji}  ${entry.mood}`;
  ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Roboto";
  const padX = 28,
    padY = 18;
  const textW = ctx.measureText(pillText).width;
  const pillW = textW + padX * 2;
  const pillH = 64;
  const pillX = 70;
  const pillY = 900;

  ctx.fillStyle = "rgba(240,106,143,0.14)";
  roundRect(ctx, pillX, pillY, pillW, pillH, 999);
  ctx.fill();

  ctx.fillStyle = "#2f1f25";
  ctx.fillText(pillText, pillX + padX, pillY + 46);

  // reflection
  ctx.fillStyle = "#2f1f25";
  ctx.font = "600 38px system-ui, -apple-system, Segoe UI, Roboto";
  wrapText(ctx, entry.reflection, 70, 1030, W - 140, 52, 5);

  // footer
  ctx.fillStyle = "#6d5962";
  ctx.font = "500 26px system-ui, -apple-system, Segoe UI, Roboto";
  const footer = entry.category ? `Category: ${entry.category}` : "One moment worth keeping forever.";
  ctx.fillText(footer, 70, 1290);
}

export async function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1.0);
  });
}
