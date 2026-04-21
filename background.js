browser.composeScripts.register({
  js: [{ file: "compose_script.js" }],
  css: [{ file: "ui/toast.css" }],
});

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

  if (message.type === "removeAttachment") {
    await browser.compose.removeAttachment(tabId, message.id);
    return { ok: true };
  }
});
