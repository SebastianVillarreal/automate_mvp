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

  async function autoScrollPage(options = {}) {
    const maxScrolls = Number(options.maxScrolls || 20);
    const scrollStepPx = Number(options.scrollStepPx || 900);
    const scrollDelayMs = Number(options.scrollDelayMs || 900);
    let lastScrollHeight = document.documentElement.scrollHeight;
    let stagnantScrolls = 0;

    for (let index = 0; index < maxScrolls; index += 1) {
      window.scrollBy({ top: scrollStepPx, left: 0, behavior: "smooth" });
      await sleep(scrollDelayMs);

      const currentScrollHeight = document.documentElement.scrollHeight;
      const nearBottom = window.innerHeight + window.scrollY >= currentScrollHeight - 50;

      if (currentScrollHeight === lastScrollHeight && nearBottom) {
        stagnantScrolls += 1;
      } else {
        stagnantScrolls = 0;
      }

      lastScrollHeight = currentScrollHeight;

      if (stagnantScrolls >= 2) {
        break;
      }
    }

    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    await sleep(1000);
  }

  function findLoadMoreButton(text) {
    const expected = (text || "Ver más productos").toLowerCase();
    const elements = Array.from(document.querySelectorAll("button, a, [role='button']"));

    return elements.find((element) => {
      const label = (element.innerText || element.textContent || element.getAttribute("aria-label") || "").trim().toLowerCase();
      const disabled = element.disabled || element.getAttribute("aria-disabled") === "true";
      const visible = element.offsetParent !== null;

      return visible && !disabled && label.includes(expected);
    });
  }

  async function clickLoadMoreButtons(options = {}) {
    const maxClicks = Number(options.maxLoadMoreClicks || 10);
    const delayMs = Number(options.loadMoreDelayMs || 1500);
    const text = options.loadMoreText || "Ver más productos";

    for (let index = 0; index < maxClicks; index += 1) {
      window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: "smooth" });
      await sleep(700);

      const button = findLoadMoreButton(text);
      if (!button) {
        break;
      }

      button.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      await sleep(300);
      button.click();
      await sleep(delayMs);
    }

    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    await sleep(1000);
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

      if (pending.job.autoScroll) {
        await autoScrollPage({
          maxScrolls: pending.job.maxScrolls,
          scrollStepPx: pending.job.scrollStepPx,
          scrollDelayMs: pending.job.scrollDelayMs
        });
      }

      if (pending.job.clickLoadMore) {
        await clickLoadMoreButtons({
          loadMoreText: pending.job.loadMoreText,
          maxLoadMoreClicks: pending.job.maxLoadMoreClicks,
          loadMoreDelayMs: pending.job.loadMoreDelayMs
        });
      }

      await waitForProductCandidates(15000, pending.job.extractor);

      const result = await captureCurrentPage({
        jobId: pending.job.id,
        captureMode: "auto",
        extractor: pending.job.extractor,
        autoScroll: Boolean(pending.job.autoScroll),
        clickLoadMore: Boolean(pending.job.clickLoadMore),
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
