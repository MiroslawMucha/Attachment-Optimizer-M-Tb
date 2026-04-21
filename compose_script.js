const IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif",
  "image/webp", "image/bmp", "image/tiff", "image/avif",
]);
const PDF_TYPE = "application/pdf";
const MAX_SIDE = 1920;
const WEBP_QUALITY = 0.82;

let overlay = null;
let currentZone = "attach"; // "attach" | "inline"
let extensionEnabled = true;

// Pobierz aktualny stan przy starcie
browser.runtime.sendMessage({ type: "getEnabled" }).then((r) => {
  if (r) extensionEnabled = r.enabled;
});

// Reaguj na toggle z przycisku
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "setEnabled") {
    extensionEnabled = message.enabled;
    if (!extensionEnabled) hideOverlay();
  }
});

// --- Banner "Zoptymalizuj istniejące załączniki" ---

async function initOptimizeBanner(retriesLeft = 4) {
  try {
    const { attachments } = await browser.runtime.sendMessage({ type: "listAttachments" });
    // Filtrujemy po rozszerzeniu nazwy — listAttachments nie zwraca mimeType
    const OPTIMIZABLE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|pdf)$/i;
    const eligible = attachments.filter((a) => a.size > 80 * 1024 && OPTIMIZABLE_EXT.test(a.name));

    if (eligible.length === 0) {
      if (retriesLeft > 0) setTimeout(() => initOptimizeBanner(retriesLeft - 1), 600);
      return;
    }

    if (document.getElementById("ao-banner")) return; // już pokazany

    const totalSize = eligible.reduce((s, a) => s + a.size, 0);
    const n = eligible.length;

    const banner = document.createElement("div");
    banner.id = "ao-banner";
    banner.innerHTML = `
      <span>📎 ${n} załącznik${n === 1 ? "" : n < 5 ? "i" : "ów"} (${fmtSize(totalSize)}) — zoptymalizować?</span>
      <div class="ao-banner-btns">
        <button id="ao-banner-yes">Zoptymalizuj</button>
        <button id="ao-banner-no">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("ao-banner-no").addEventListener("click", () => banner.remove());
    document.getElementById("ao-banner-yes").addEventListener("click", async () => {
      banner.remove();
      showProgressToast(`Optymalizuję ${n} plik${n === 1 ? "" : "i"}…`);
      const result = await browser.runtime.sendMessage({ type: "optimizeAttachments", ids: eligible.map((a) => a.id) });
      if (result?.results) showToast(result.results, {});
    });
  } catch {
    if (retriesLeft > 0) setTimeout(() => initOptimizeBanner(retriesLeft - 1), 600);
  }
}

// Startuj z opóźnieniem — dajemy czas Thunderbirdowi na załadowanie załączników
setTimeout(() => initOptimizeBanner(), 800);

// --- Overlay ---

function showOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "ao-overlay";
  overlay.innerHTML = `
    <div class="ao-zone" id="ao-z-attach">
      <span>📎</span>
      <b>Jako załącznik</b>
      <small>skompresowany</small>
    </div>
    <div class="ao-zone" id="ao-z-inline">
      <span>📄</span>
      <b>Wstaw do treści</b>
      <small>skompresowany</small>
    </div>
  `;
  document.body.appendChild(overlay);
  updateZoneHighlight("attach");
}

function hideOverlay() {
  overlay?.remove();
  overlay = null;
  currentZone = "attach";
}

function updateZoneHighlight(zone) {
  if (!overlay) return;
  overlay.querySelector("#ao-z-attach").classList.toggle("ao-active", zone === "attach");
  overlay.querySelector("#ao-z-inline").classList.toggle("ao-active", zone === "inline");
}

// --- Drag events ---

document.addEventListener("dragenter", (e) => {
  if (extensionEnabled && [...e.dataTransfer.types].includes("Files")) showOverlay();
}, true);

document.addEventListener("dragover", (e) => {
  if (!overlay) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  e.dataTransfer.dropEffect = "copy";

  const zone = e.clientX < window.innerWidth / 2 ? "attach" : "inline";
  if (zone !== currentZone) {
    currentZone = zone;
    updateZoneHighlight(zone);
  }
}, true);

document.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null || e.relatedTarget === document.documentElement) {
    hideOverlay();
  }
}, true);

document.addEventListener("drop", async (e) => {
  if (!overlay || !extensionEnabled) return;
  e.preventDefault();
  e.stopImmediatePropagation();

  const zone = currentZone;
  hideOverlay();

  const allFiles = [...e.dataTransfer.files];
  const imageFiles = allFiles.filter((f) => IMAGE_TYPES.has(f.type));
  const pdfFiles  = allFiles.filter((f) => f.type === PDF_TYPE);
  const otherFiles = allFiles.filter((f) => !IMAGE_TYPES.has(f.type) && f.type !== PDF_TYPE);

  // Inne pliki (docx, xlsx…) → załącznik bez zmian
  if (otherFiles.length > 0) {
    const pass = await Promise.all(
      otherFiles.map(async (f) => ({
        dataURL: await blobToDataURL(f),
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        originalSize: f.size,
        newSize: f.size,
      }))
    );
    await browser.runtime.sendMessage({ type: "addAttachments", files: pass });
  }

  // PDF-y → kompresja w background
  if (pdfFiles.length > 0) {
    showProgressToast("PDF: przetwarzam" + (pdfFiles.length > 1 ? ` (${pdfFiles.length} pliki)` : "") + "…");
    for (const f of pdfFiles) {
      try {
        // Limit 25MB dla drag-and-drop (dataURL przez message)
        if (f.size > 25 * 1024 * 1024) {
          const dataURL = await blobToDataURL(f);
          await browser.runtime.sendMessage({ type: "addAttachments", files: [{ dataURL, name: f.name, mimeType: PDF_TYPE, originalSize: f.size, newSize: f.size, skipped: true }] });
          showToast([{ name: f.name, originalSize: f.size, newSize: f.size, success: true, skipped: true }], { pdf: true, skipped: [true] });
          continue;
        }
        const dataURL = await blobToDataURL(f);
        const result = await browser.runtime.sendMessage({
          type: "processPDF",
          dataURL,
          name: f.name,
          originalSize: f.size,
        });
        showToast([result], { pdf: true, skipped: [result.skipped] });
      } catch (err) {
        showErrorToast("PDF błąd: " + (err.message || String(err)));
      }
    }
  }

  if (imageFiles.length === 0) return;

  const processed = await Promise.all(imageFiles.map(compressImage));

  if (zone === "inline") {
    insertInlineImages(processed);
  } else {
    const response = await browser.runtime.sendMessage({ type: "addAttachments", files: processed });
    if (response?.results) showToast(response.results, {});
  }
}, true);

// --- Kompresja obrazu ---

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > MAX_SIDE || height > MAX_SIDE) {
    const ratio = Math.min(MAX_SIDE / width, MAX_SIDE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const keepPNG = file.type === "image/png" && hasAlpha(ctx, width, height);
  const mimeType = keepPNG ? "image/png" : "image/webp";
  const quality = keepPNG ? undefined : WEBP_QUALITY;

  const blob = await new Promise((r) => canvas.toBlob(r, mimeType, quality));

  // Jeśli kompresja nie dała min. 5% oszczędności — zostaw oryginał
  if (file.size < 100 * 1024 || blob.size >= file.size * 0.95) {
    const dataURL = await blobToDataURL(file);
    return { dataURL, name: file.name, mimeType: file.type, originalSize: file.size, newSize: file.size, skipped: true };
  }

  const ext = keepPNG ? "png" : "webp";
  const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
  const dataURL = await blobToDataURL(blob);

  return { dataURL, name, mimeType, originalSize: file.size, newSize: blob.size, skipped: false };
}

function hasAlpha(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

// --- Wstaw do treści maila (przez compose API w tle) ---

async function insertInlineImages(files) {
  const response = await browser.runtime.sendMessage({ type: "insertInline", files });

  if (response?.fallback) {
    // Tryb tekstowy — fallback do załącznika
    const r = await browser.runtime.sendMessage({ type: "addAttachments", files });
    if (r?.results) showToast(r.results, { fallback: true });
  } else {
    showToast(files.map((f) => ({ ...f, id: null, success: true })), { inline: true });
  }
}

// --- Toast ---

function showToast(results, opts) {
  document.getElementById("ao-toast")?.remove();

  const attachIds = results.filter((r) => r.success && r.id).map((r) => r.id);
  const isInline = !!opts.inline;
  const isFallback = !!opts.fallback;

  const rows = results.map((r, i) => {
    let icon, nameHtml, statsHtml, rowClass;

    if (!r.success) {
      icon = "✕";
      rowClass = "ao-row-err";
      nameHtml = escHtml(r.name);
      statsHtml = `<span class="ao-err-text">${escHtml(r.error || "błąd")}</span>`;
    } else if (opts.skipped?.[i] || r.skipped) {
      const reason = opts.pdf ? "PDF wektorowy" : "już zoptymalizowany";
      icon = "−";
      rowClass = "ao-row-skip";
      nameHtml = escHtml(r.name);
      statsHtml = `<span class="ao-warn-text">${reason} — bez zmian</span>`;
    } else {
      const saved = Math.round((1 - r.newSize / r.originalSize) * 100);
      const dest = isInline ? "treść" : isFallback ? "załącznik*" : "załącznik";
      icon = "✓";
      rowClass = "ao-row-ok";
      nameHtml = escHtml(r.name);
      statsHtml = `${fmtSize(r.originalSize)} → ${fmtSize(r.newSize)} · <span class="ao-saved">−${saved}%</span> → ${dest}`;
    }

    return `<div class="ao-file-row ${rowClass}">
      <span class="ao-file-icon">${icon}</span>
      <div class="ao-file-info">
        <span class="ao-file-name">${nameHtml}</span>
        <span class="ao-file-stats">${statsHtml}</span>
      </div>
    </div>`;
  }).join("");

  const footer = attachIds.length
    ? `<div class="ao-toast-footer"><button class="ao-btn ao-btn-primary" id="ao-undo">Cofnij</button></div>`
    : "";

  const toast = document.createElement("div");
  toast.id = "ao-toast";
  toast.innerHTML = `
    <div class="ao-toast-header">
      <span class="ao-toast-title">Attachment Optimizer</span>
      <button class="ao-toast-close" id="ao-close">✕</button>
    </div>
    <div class="ao-toast-files">${rows}</div>
    ${footer}
  `;
  document.body.appendChild(toast);

  document.getElementById("ao-close").addEventListener("click", () => toast.remove());

  if (attachIds.length) {
    document.getElementById("ao-undo").addEventListener("click", async () => {
      for (const id of attachIds) {
        await browser.runtime.sendMessage({ type: "removeAttachment", id });
      }
      toast.remove();
    });
  }

  const timer = setTimeout(() => toast.remove(), 30000);
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
}

// --- Utils ---

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showErrorToast(msg) {
  showSimpleToast(msg, "ao-err-text");
  setTimeout(() => document.getElementById("ao-toast")?.remove(), 10000);
}

function showProgressToast(msg) {
  showSimpleToast(msg, "ao-warn-text");
}

function showSimpleToast(msg, cls) {
  document.getElementById("ao-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "ao-toast";
  toast.innerHTML = `
    <div class="ao-toast-header">
      <span class="ao-toast-title">Attachment Optimizer</span>
      <button class="ao-toast-close" id="ao-close">✕</button>
    </div>
    <div class="ao-toast-files">
      <div class="ao-file-row ${cls === "ao-err-text" ? "ao-row-err" : "ao-row-info"}">
        <span class="ao-file-icon">${cls === "ao-err-text" ? "✕" : "◌"}</span>
        <div class="ao-file-info"><span class="ao-file-name ${cls}">${escHtml(msg)}</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(toast);
  document.getElementById("ao-close").addEventListener("click", () => toast.remove());
}
