// Uruchamiane w kontekście compose window — ma dostęp do pdfjsLib i PDFLib

const PDF_RENDER_SCALE = 1.5;   // ~150 DPI dla A4
const PDF_JPEG_QUALITY = 0.78;
const PDF_SCAN_TEXT_THRESHOLD = 15; // mniej niż tyle items tekstu = skan

async function initPdfJs() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("libs/pdf.worker.min.js");
}

async function detectAndCompressPDF(file) {
  await initPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const firstPage = await pdfDoc.getPage(1);

  // Wykryj typ: skan vs wektorowy
  const textContent = await firstPage.getTextContent();
  const isScan = textContent.items.length < PDF_SCAN_TEXT_THRESHOLD;

  if (!isScan) {
    // Wektorowy — pomijamy kompresję
    const dataURL = await blobToDataURL(file);
    return {
      dataURL,
      name: file.name,
      mimeType: "application/pdf",
      originalSize: file.size,
      newSize: file.size,
      skipped: true,
      reason: "wektorowy",
    };
  }

  // Skan → renderuj każdą stronę jako JPEG → spakuj w nowy PDF
  const { PDFDocument } = PDFLib;
  const newPdfDoc = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpegBlob = await new Promise((r) =>
      canvas.toBlob(r, "image/jpeg", PDF_JPEG_QUALITY)
    );
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

    const jpegImage = await newPdfDoc.embedJpg(jpegBytes);
    const pdfPage = newPdfDoc.addPage([viewport.width, viewport.height]);
    pdfPage.drawImage(jpegImage, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
  }

  const compressedBytes = await newPdfDoc.save();
  const compressedBlob = new Blob([compressedBytes], { type: "application/pdf" });
  const dataURL = await blobToDataURL(compressedBlob);

  return {
    dataURL,
    name: file.name,
    mimeType: "application/pdf",
    originalSize: file.size,
    newSize: compressedBlob.size,
    skipped: false,
  };
}
