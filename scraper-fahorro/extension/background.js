async function sendExtractMessage(tabId) {
  return chrome.tabs.sendMessage(tabId, { action: "extract" });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "extractors/utils.js",
      "extractors/default.js",
      "extractors/fahorro.js",
      "extractors/bodegaaurrera.js",
      "extractors/soriana.js",
      "extractors/merco.js",
      "content.js"
    ]
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) {
    console.error("No active tab found.");
    return;
  }

  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    console.error("Chrome does not allow content scripts on browser internal pages.");
    return;
  }

  console.log("Starting extraction for tab:", tab.id, tab.url);

  try {
    const response = await sendExtractMessage(tab.id);
    console.log("Extraction response:", response);
  } catch (firstError) {
    console.warn("Content script was not ready. Injecting content.js and retrying.", firstError);

    try {
      await injectContentScript(tab.id);
      const response = await sendExtractMessage(tab.id);
      console.log("Extraction response after injection:", response);
    } catch (secondError) {
      console.error("Extraction failed after retry:", secondError);
    }
  }
});
