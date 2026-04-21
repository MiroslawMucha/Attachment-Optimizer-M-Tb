browser.composeScripts.register({
  js: [{ file: "compose_script.js" }],
  css: [{ file: "ui/toast.css" }],
});

pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("libs/pdf.worker.min.js");

const PDF_SCALE = 1.5;
const PDF_JPEG_QUALITY = 0.78;
const PDF_TEXT_THRESHOLD = 15;
const MAX_SIDE = 1920;
const WEBP_QUALITY = 0.82;
const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/gif","image/webp","image/bmp","image/tiff","image/avif"]);
const PDF_TYPE = "application/pdf";

// --- Pomocnicze ---

async function compressPDFBuffer(arrayBuffer, name, originalSize, tabId) {
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const firstPage = await pdfDoc.getPage(1);
  const text = await firstPage.getTextContent();
  const isScan = text.items.length < PDF_TEXT_THRESHOLD;

  if (!isScan || originalSize < 300 * 1024) {
    const file = new File([arrayBuffer], name, { type: PDF_TYPE });
    const att = await browser.compose.addAttachment(tabId, { file });
    return { id: att.id, name, originalSize, newSize: originalSize, success: true, skipped: true };
  }

  const { PDFDocument } = PDFLib;
  const newPdf = await PDFDocument.create();

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: PDF_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const jpegBytes = new Uint8Array(
      await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", PDF_JPEG_QUALITY))).arrayBuffer()
    );
    const img = await newPdf.embedJpg(jpegBytes);
    newPdf.addPage([viewport.width, viewport.height])
          .drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
  }

  const compressed = await newPdf.save();
  const file = new File([compressed], name, { type: PDF_TYPE });
  const att = await browser.compose.addAttachment(tabId, { file });
  return { id: att.id, name, originalSize, newSize: compressed.length, success: true, skipped: false };
}

async function compressImageFile(file, tabId, removeId) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });

    let { width, height } = img;
    if (width > MAX_SIDE || height > MAX_SIDE) {
      const ratio = Math.min(MAX_SIDE / width, MAX_SIDE / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const keepPNG = file.type === "image/png" && checkAlpha(ctx, width, height);
    const mimeType = keepPNG ? "image/png" : "image/webp";
    const blob = await new Promise((r) => canvas.toBlob(r, mimeType, keepPNG ? undefined : WEBP_QUALITY));

    if (file.size < 100 * 1024 || blob.size >= file.size * 0.95) {
      return { name: file.name, originalSize: file.size, newSize: file.size, success: true, skipped: true };
    }

    const ext = keepPNG ? "png" : "webp";
    const newName = file.name.replace(/\.[^.]+$/, `.${ext}`);
    const newFile = new File([blob], newName, { type: mimeType });

    if (removeId != null) await browser.compose.removeAttachment(tabId, removeId);
    const att = await browser.compose.addAttachment(tabId, { file: newFile });
    return { id: att.id, name: newName, originalSize: file.size, newSize: blob.size, success: true, skipped: false };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mimeFromName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
    tiff: "image/tiff", tif: "image/tiff", avif: "image/avif",
    pdf: "application/pdf",
  };
  return map[ext] || "";
}

function checkAlpha(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

// --- Message handler ---

browser.runtime.onMessage.addListener(async (message, sender) => {
  const tabId = sender.tab.id;

  if (message.type === "addAttachments") {
    const results = [];
    for (const f of message.files) {
      try {
        const blob = await (await fetch(f.dataURL)).blob();
        const file = new File([blob], f.name, { type: f.mimeType });
        const att = await browser.compose.addAttachment(tabId, { file });
        results.push({ id: att.id, name: f.name, originalSize: f.originalSize, newSize: f.newSize, success: true, skipped: f.skipped });
      } catch (err) {
        results.push({ name: f.name, success: false, error: err.message });
      }
    }
    return { results };
  }

  if (message.type === "insertInline") {
    const details = await browser.compose.getComposeDetails(tabId);
    if (details.isPlainText) return { fallback: true };
    const imgs = message.files.map((f) => `<img src="${f.dataURL}" alt="${f.name}" style="max-width:100%;">`).join("<br>");
    await browser.compose.setComposeDetails(tabId, { body: (details.body || "") + imgs });
    return { ok: true };
  }

  if (message.type === "processPDF") {
    const { dataURL, name, originalSize } = message;
    try {
      const arrayBuffer = await (await fetch(dataURL)).arrayBuffer();
      return await compressPDFBuffer(arrayBuffer, name, originalSize, tabId);
    } catch (err) {
      const ab = await (await fetch(dataURL)).arrayBuffer();
      const file = new File([ab], name, { type: PDF_TYPE });
      const att = await browser.compose.addAttachment(tabId, { file });
      return { id: att.id, name, originalSize, newSize: originalSize, success: true, skipped: true, error: err.message };
    }
  }

  if (message.type === "listAttachments") {
    const attachments = await browser.compose.listAttachments(tabId);
    return { attachments };
  }

  if (message.type === "optimizeAttachments") {
    const results = [];
    for (const id of message.ids) {
      try {
        const file = await browser.compose.getAttachmentFile(id);
        const type = file.type || mimeFromName(file.name);
        let result;

        if (IMAGE_TYPES.has(type)) {
          const typed = type !== file.type ? new File([file], file.name, { type }) : file;
          result = await compressImageFile(typed, tabId, id);
        } else if (type === PDF_TYPE) {
          const ab = await file.arrayBuffer();
          result = await compressPDFBuffer(ab, file.name, file.size, tabId);
          if (result.success && !result.skipped) {
            await browser.compose.removeAttachment(tabId, id);
          }
        } else {
          results.push({ name: file.name, originalSize: file.size, newSize: file.size, success: true, skipped: true });
          continue;
        }

        if (result) results.push(result);
      } catch (err) {
        results.push({ name: file?.name || String(id), success: false, error: err.message });
      }
    }
    return { results };
  }

  if (message.type === "removeAttachment") {
    await browser.compose.removeAttachment(tabId, message.id);
    return { ok: true };
  }
});
