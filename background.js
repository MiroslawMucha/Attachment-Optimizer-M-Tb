browser.composeScripts.register({
  js: [{ file: "compose_script.js" }],
  css: [{ file: "ui/toast.css" }],
});

pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("libs/pdf.worker.min.js");
const PDF_SCALE = 1.5;
const PDF_JPEG_QUALITY = 0.78;
const PDF_TEXT_THRESHOLD = 15;

browser.runtime.onMessage.addListener(async (message, sender) => {
  const tabId = sender.tab.id;

  if (message.type === "addAttachments") {
    const results = [];

    for (const f of message.files) {
      try {
        const res = await fetch(f.dataURL);
        const blob = await res.blob();
        const file = new File([blob], f.name, { type: f.mimeType });
        const attachment = await browser.compose.addAttachment(tabId, { file });
        results.push({
          id: attachment.id,
          name: f.name,
          originalSize: f.originalSize,
          newSize: f.newSize,
          success: true,
        });
      } catch (err) {
        results.push({ name: f.name, success: false, error: err.message });
      }
    }

    return { results };
  }

  if (message.type === "insertInline") {
    const details = await browser.compose.getComposeDetails(tabId);

    if (details.isPlainText) {
      // Tryb tekstowy — nie da się wstawić obrazu, fallback do załącznika
      return { fallback: true };
    }

    const imgs = message.files
      .map((f) => `<img src="${f.dataURL}" alt="${f.name}" style="max-width:100%;">`)
      .join("<br>");

    await browser.compose.setComposeDetails(tabId, {
      body: (details.body || "") + imgs,
    });

    return { ok: true };
  }

  if (message.type === "processPDF") {
    const { dataURL, name, originalSize } = message;

    try {
      const arrayBuffer = await (await fetch(dataURL)).arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Wykryj typ: skan vs wektorowy
      const firstPage = await pdfDoc.getPage(1);
      const text = await firstPage.getTextContent();
      const isScan = text.items.length < PDF_TEXT_THRESHOLD;

      if (!isScan || originalSize < 300 * 1024) {
        // Wektorowy lub już mały — dołącz bez kompresji
        const file = new File([arrayBuffer], name, { type: "application/pdf" });
        const att = await browser.compose.addAttachment(tabId, { file });
        return { id: att.id, name, originalSize, newSize: originalSize, success: true, skipped: true };
      }

      // Skan — renderuj strony jako JPEG, spakuj w nowy PDF
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
      const file = new File([compressed], name, { type: "application/pdf" });
      const att = await browser.compose.addAttachment(tabId, { file });
      return { id: att.id, name, originalSize, newSize: compressed.length, success: true, skipped: false };

    } catch (err) {
      // Fallback: oryginał
      const ab = await (await fetch(dataURL)).arrayBuffer();
      const file = new File([ab], name, { type: "application/pdf" });
      const att = await browser.compose.addAttachment(tabId, { file });
      return { id: att.id, name, originalSize, newSize: originalSize, success: true, skipped: true, error: err.message };
    }
  }

  if (message.type === "removeAttachment") {
    await browser.compose.removeAttachment(tabId, message.id);
    return { ok: true };
  }
});
