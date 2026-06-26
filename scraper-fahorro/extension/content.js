(function () {
  const CAPTURE_API_URL = "http://localhost:3005/capture";
  const PENDING_SCRAPE_API_URL = "http://localhost:3005/pending-scrape";
  const AUTO_CAPTURE_FLAG = "__domExtractorAutoCaptureStarted";
  const PAGINATION_JOB_KEY = "__domExtractorPaginationJob";

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
    const cleanExtraFields = { ...extraFields };
    if (!cleanExtraFields.extractor) {
      delete cleanExtraFields.extractor;
    }

    const data = {
      ...extractPageData({ extractor: cleanExtraFields.extractor }),
      ...cleanExtraFields
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
    const normalizeLabel = (value) => {
      return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    };
    const expected = normalizeLabel(text || "Ver mas productos");
    const elements = Array.from(document.querySelectorAll("button, a, [role='button']"));

    return elements.find((element) => {
      const label = normalizeLabel(element.innerText || element.textContent || element.getAttribute("aria-label"));
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

  function getCurrentPageNumber() {
    const value = new URL(window.location.href).searchParams.get("page");
    const page = Number(value || 1);
    return Number.isFinite(page) && page > 0 ? page : 1;
  }

  function buildPageUrl(pageNumber) {
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(pageNumber));
    return url.href;
  }

  function getPaginationJobFromSession() {
    const raw = sessionStorage.getItem(PAGINATION_JOB_KEY);
    if (!raw) return null;

    try {
      const job = JSON.parse(raw);
      if (!job || !job.autoPaginate) return null;
      return job;
    } catch (_error) {
      sessionStorage.removeItem(PAGINATION_JOB_KEY);
      return null;
    }
  }

  function savePaginationJobToSession(job, pageNumber) {
    sessionStorage.setItem(PAGINATION_JOB_KEY, JSON.stringify({
      ...job,
      paginationPageNumber: pageNumber
    }));
  }

  function clearPaginationJobFromSession() {
    sessionStorage.removeItem(PAGINATION_JOB_KEY);
  }

  async function closeCurrentTab() {
    try {
      await sleep(500);
      chrome.runtime.sendMessage({ action: "closeTab" });
    } catch (error) {
      console.warn("Could not request tab close:", error.message);
    }
  }

  function hasPaginationEvidence() {
    const hasNumberedPageControl = Boolean(Array.from(document.querySelectorAll("a[href], button, [role='button']")).find((element) => {
      const label = (element.innerText || element.textContent || "").trim();
      const href = element.getAttribute && element.getAttribute("href");
      const pageFromHref = href && href.match(/[?&]page=(\d+)/i);

      return (Number(label) > 1) || (pageFromHref && Number(pageFromHref[1]) > 1);
    }));

    return hasNumberedPageControl || getMaxVisiblePageNumber() > 1;
  }

  function getMaxVisiblePageNumber() {
    const numbers = Array.from(document.querySelectorAll("a[href], button, [role='button']"))
      .map((element) => Number((element.innerText || element.textContent || "").trim()))
      .filter((value) => Number.isFinite(value) && value > 0);

    return numbers.length > 0 ? Math.max(...numbers) : 0;
  }

  async function getNextPaginatedUrl(job) {
    if (!job || !job.autoPaginate) return "";

    window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: "smooth" });
    await sleep(900);

    const currentPage = getCurrentPageNumber();
    const maxPages = Number(job.maxPages || 10);
    const maxVisiblePage = getMaxVisiblePageNumber();
    const hasNext = maxVisiblePage > 1 && currentPage < maxVisiblePage;

    if (!hasPaginationEvidence() || currentPage >= maxPages || !hasNext) {
      clearPaginationJobFromSession();
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return "";
    }

    return buildPageUrl(currentPage + 1);
  }

  async function getPendingScrape() {
    const url = `${PENDING_SCRAPE_API_URL}?url=${encodeURIComponent(window.location.href)}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  async function getCurrentJob() {
    const pending = await getPendingScrape();
    if (pending && pending.pending && pending.job) {
      return pending.job;
    }

    return getPaginationJobFromSession();
  }

  async function autoCapturePendingScrape() {
    if (window[AUTO_CAPTURE_FLAG]) {
      return;
    }

    window[AUTO_CAPTURE_FLAG] = true;

    try {
      await sleep(1500);

      const job = await getCurrentJob();
      if (!job) {
        return;
      }

      console.log("Scrape job found:", job);

      await sleep(job.waitBeforeCaptureMs || 4000);

      if (job.autoScroll) {
        await autoScrollPage({
          maxScrolls: job.maxScrolls,
          scrollStepPx: job.scrollStepPx,
          scrollDelayMs: job.scrollDelayMs
        });
      }

      if (job.clickLoadMore) {
        await clickLoadMoreButtons({
          loadMoreText: job.loadMoreText,
          maxLoadMoreClicks: job.maxLoadMoreClicks,
          loadMoreDelayMs: job.loadMoreDelayMs
        });
      }

      await waitForProductCandidates(15000, job.extractor);

      const result = await captureCurrentPage({
        jobId: job.id,
        captureMode: "auto",
        extractor: job.extractor,
        autoScroll: Boolean(job.autoScroll),
        autoPaginate: Boolean(job.autoPaginate),
        pageNumber: getCurrentPageNumber(),
        clickLoadMore: Boolean(job.clickLoadMore),
        saveDb: Boolean(job.saveDb)
      });

      console.log("Automatic capture saved:", result);

      const nextUrl = await getNextPaginatedUrl(job);
      if (nextUrl) {
        savePaginationJobToSession(job, getCurrentPageNumber() + 1);
        await sleep(job.paginationDelayMs || 2500);
        window.location.href = nextUrl;
        return;
      }

      if (job.closeTab) {
        await closeCurrentTab();
      }
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
