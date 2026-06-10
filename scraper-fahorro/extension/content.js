(function () {
  const CAPTURE_API_URL = "http://localhost:3005/capture";
  const PENDING_SCRAPE_API_URL = "http://localhost:3005/pending-scrape";
  const AUTO_CAPTURE_FLAG = "__domExtractorAutoCaptureStarted";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getHostname() {
    return window.location.hostname.toLowerCase();
  }

  function getExtractor(preferredExtractorId) {
    const registry = window.DomExtractor && window.DomExtractor.extractors;
    if (!registry) {
      throw new Error("Extractor registry is not loaded.");
    }

    if (preferredExtractorId && registry[preferredExtractorId]) {
      return registry[preferredExtractorId];
    }

    const hostname = getHostname();
    const extractors = Object.values(registry);
    const matched = extractors.find((extractor) => {
      return (extractor.domains || []).some((domain) => {
        return domain !== "*" && (hostname === domain || hostname.endsWith(`.${domain}`));
      });
    });

    return matched || registry.default;
  }

  function extractPageData(options = {}) {
    const selectedExtractor = getExtractor(options.extractor);
    const extraction = selectedExtractor.extract();

    return {
      domain: getHostname(),
      extractor: extraction.extractor || selectedExtractor.id,
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      text: document.body ? document.body.innerText : "",
      html: document.documentElement ? document.documentElement.outerHTML : "",
      products: extraction.products || [],
      debug: {
        selectedExtractor: selectedExtractor.id,
        ...(extraction.debug || {})
      }
    };
  }

  async function captureCurrentPage(extraFields = {}) {
    const data = {
      ...extractPageData({ extractor: extraFields.extractor }),
      ...extraFields
    };

    const response = await fetch(CAPTURE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Capture failed with HTTP ${response.status}`);
    }

    return result;
  }

  async function waitForProductCandidates(maxWaitMs, preferredExtractorId) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      const extractor = getExtractor(preferredExtractorId);
      if (extractor.collectCandidates && extractor.collectCandidates().length > 0) {
        return true;
      }

      await sleep(1000);
    }

    return false;
  }

  async function getPendingScrape() {
    const url = `${PENDING_SCRAPE_API_URL}?url=${encodeURIComponent(window.location.href)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function autoCapturePendingScrape() {
    if (window[AUTO_CAPTURE_FLAG]) {
      return;
    }

    window[AUTO_CAPTURE_FLAG] = true;

    try {
      await sleep(1500);

      const pending = await getPendingScrape();
      if (!pending || !pending.pending || !pending.job) {
        return;
      }

      console.log("Pending scrape job found:", pending.job);

      await sleep(pending.job.waitBeforeCaptureMs || 4000);
      await waitForProductCandidates(15000, pending.job.extractor);

      const result = await captureCurrentPage({
        jobId: pending.job.id,
        captureMode: "auto",
        extractor: pending.job.extractor,
        saveDb: Boolean(pending.job.saveDb)
      });

      console.log("Automatic capture saved:", result);
    } catch (error) {
      console.warn("Automatic capture did not run:", error.message);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== "extract") {
      return false;
    }

    captureCurrentPage({ captureMode: "manual", extractor: message.extractor })
      .then((result) => {
        console.log("Capture saved:", result);
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        console.error("Capture failed:", error);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  });

  window.extractPageData = extractPageData;
  autoCapturePendingScrape();
})();
