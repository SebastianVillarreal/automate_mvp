const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const { buildDescriptionEquivalenceSql, checkDbHealth, getActiveScrapeUrls, getComparativa, matchDescriptionEquivalences, saveCaptureToDb } = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3005);
const CAPTURES_DIR = path.join(__dirname, "captures");
const pendingScrapes = new Map();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

function ensureCapturesDir() {
  if (!fs.existsSync(CAPTURES_DIR)) {
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function captureFileName(date = new Date()) {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");

  return `capture-${stamp}.json`;
}

function validateCapture(payload) {
  const requiredFields = ["url", "title", "timestamp", "text", "html", "products"];
  const missing = requiredFields.filter((field) => !(field in payload));

  if (missing.length > 0) {
    return `Missing required field(s): ${missing.join(", ")}`;
  }

  if (!Array.isArray(payload.products)) {
    return "Field products must be an array.";
  }

  return null;
}

function validateTargetUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") {
    return { error: "Query parameter url is required." };
  }

  try {
    const parsedUrl = new URL(targetUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { error: "Only http and https URLs are allowed." };
    }

    return { parsedUrl };
  } catch (_error) {
    return { error: "Invalid URL." };
  }
}

function normalizeUrlForMatch(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  parsedUrl.hash = "";
  return parsedUrl.href;
}

function escapeWindowsArg(value) {
  return String(value || "").replace(/"/g, '\\"');
}

function isFarmaciasGuadalajaraUrl(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname === "farmaciasguadalajara.com" || hostname.endsWith(".farmaciasguadalajara.com");
  } catch (_error) {
    return false;
  }
}

function chromeProfileForUrl(targetUrl, explicitProfile = "") {
  if (explicitProfile) {
    return explicitProfile;
  }

  if (isFarmaciasGuadalajaraUrl(targetUrl)) {
    return process.env.FARMACIAS_GUADALAJARA_CHROME_PROFILE || process.env.CHROME_PROFILE_DIRECTORY || "Profile 4";
  }

  return process.env.CHROME_PROFILE_DIRECTORY || "";
}

function openChrome(targetUrl, options, callback) {
  const openOptions = typeof options === "function" ? {} : (options || {});
  const done = typeof options === "function" ? options : callback;
  const chromeProfile = chromeProfileForUrl(targetUrl, openOptions.chromeProfile);
  const escapedUrl = targetUrl.replace(/"/g, '\\"');
  const profileArg = chromeProfile ? ` --profile-directory="${escapeWindowsArg(chromeProfile)}"` : "";
  const command = `start "" chrome${profileArg} "${escapedUrl}"`;

  exec(command, { windowsHide: true }, done);
}

function openChromeAsync(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    openChrome(targetUrl, options, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMercoUrl(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname.includes("adomicilio.merco.mx");
  } catch (_error) {
    return false;
  }
}

function isSorianaUrl(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname === "soriana.com" || hostname.endsWith(".soriana.com");
  } catch (_error) {
    return false;
  }
}

function shouldWaitForActiveUrl(targetUrl) {
  return isMercoUrl(targetUrl) || isSorianaUrl(targetUrl);
}

function isTerminalJobStatus(status) {
  return ["completed", "failed", "open_failed", "timed_out"].includes(status);
}

async function waitForJobCompletion(jobId, timeoutMs = 180000, pollMs = 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = pendingScrapes.get(jobId);

    if (!job) {
      return {
        id: jobId,
        status: "missing",
        error: "Job not found."
      };
    }

    if (isTerminalJobStatus(job.status)) {
      return job;
    }

    await sleep(pollMs);
  }

  const job = pendingScrapes.get(jobId);
  const timedOutJob = {
    ...(job || { id: jobId }),
    status: "timed_out",
    error: `Job did not complete in ${timeoutMs}ms.`,
    timedOutAt: new Date().toISOString()
  };

  pendingScrapes.set(jobId, timedOutJob);
  return timedOutJob;
}

function queryBool(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
}

function queryNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function inferScrapeOptionsFromUrl(targetUrl) {
  const hostname = new URL(targetUrl).hostname.toLowerCase();

  if (hostname.includes("adomicilio.merco.mx")) {
    return {
      autoScroll: true,
      waitBeforeCaptureMs: 8000,
      maxScrolls: 120,
      scrollStepPx: 750,
      scrollDelayMs: 1400,
      scrollStagnantLimit: 10,
      postScrollWaitMs: 6000
    };
  }

  if (hostname.includes("farmaciasguadalajara.com")) {
    return {
      autoScroll: true,
      clickLoadMore: true,
      waitBeforeCaptureMs: 5000,
      maxLoadMoreClicks: 10,
      loadMoreDelayMs: 1500
    };
  }

  if (hostname.includes("bodegaaurrera.com.mx")) {
    return {
      autoPaginate: true,
      maxPages: 10,
      paginationDelayMs: 2500
    };
  }

  return {};
}

function scrapeOptionsFromQuery(req, targetUrl, defaults = {}) {
  const base = {
    ...inferScrapeOptionsFromUrl(targetUrl),
    ...defaults
  };

  return {
    extractor: typeof req.query.extractor === "string" ? req.query.extractor : (base.extractor || ""),
    waitBeforeCaptureMs: queryNumber(req.query.waitBeforeCaptureMs, base.waitBeforeCaptureMs || 4000),
    autoScroll: queryBool(req.query.autoScroll, Boolean(base.autoScroll)),
    autoPaginate: queryBool(req.query.autoPaginate, Boolean(base.autoPaginate)),
    clickLoadMore: queryBool(req.query.clickLoadMore, Boolean(base.clickLoadMore)),
    loadMoreText: typeof req.query.loadMoreText === "string" ? req.query.loadMoreText : (base.loadMoreText || "Ver mas productos"),
    maxLoadMoreClicks: queryNumber(req.query.maxLoadMoreClicks, base.maxLoadMoreClicks || 10),
    loadMoreDelayMs: queryNumber(req.query.loadMoreDelayMs, base.loadMoreDelayMs || 1500),
    maxPages: queryNumber(req.query.maxPages, base.maxPages || 10),
    paginationDelayMs: queryNumber(req.query.paginationDelayMs, base.paginationDelayMs || 2500),
    maxScrolls: queryNumber(req.query.maxScrolls, base.maxScrolls || 20),
    scrollStepPx: queryNumber(req.query.scrollStepPx, base.scrollStepPx || 900),
    scrollDelayMs: queryNumber(req.query.scrollDelayMs, base.scrollDelayMs || 900),
    scrollStagnantLimit: queryNumber(req.query.scrollStagnantLimit, base.scrollStagnantLimit || 2),
    postScrollWaitMs: queryNumber(req.query.postScrollWaitMs, base.postScrollWaitMs || 1000),
    closeTab: queryBool(req.query.closeTab, base.closeTab !== undefined ? Boolean(base.closeTab) : true),
    saveDb: queryBool(req.query.saveDb, Boolean(base.saveDb))
  };
}

function createScrapeJob(targetUrl, options = {}) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    action: options.action || "scrape",
    url: targetUrl,
    normalizedUrl: normalizeUrlForMatch(targetUrl),
    extractor: options.extractor || "",
    zipCode: options.zipCode || "",
    storeName: options.storeName || "",
    waitBeforeCaptureMs: options.waitBeforeCaptureMs || 4000,
    autoScroll: Boolean(options.autoScroll),
    autoPaginate: Boolean(options.autoPaginate),
    clickLoadMore: Boolean(options.clickLoadMore),
    loadMoreText: options.loadMoreText || "Ver más productos",
    maxLoadMoreClicks: options.maxLoadMoreClicks || 10,
    loadMoreDelayMs: options.loadMoreDelayMs || 1500,
    maxPages: options.maxPages || 10,
    paginationDelayMs: options.paginationDelayMs || 2500,
    scrollStepPx: options.scrollStepPx || 900,
    scrollDelayMs: options.scrollDelayMs || 900,
    scrollStagnantLimit: options.scrollStagnantLimit || 2,
    postScrollWaitMs: options.postScrollWaitMs || 1000,
    maxScrolls: options.maxScrolls || 20,
    closeTab: options.closeTab !== undefined ? Boolean(options.closeTab) : true,
    saveDb: Boolean(options.saveDb),
    status: "pending",
    createdAt: new Date().toISOString()
  };

  pendingScrapes.set(id, job);
  return job;
}

function findPendingScrapeByUrl(currentUrl) {
  const normalizedCurrentUrl = normalizeUrlForMatch(currentUrl);

  for (const job of pendingScrapes.values()) {
    if (job.status === "pending" && job.normalizedUrl === normalizedCurrentUrl) {
      return job;
    }
  }

  return null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/db/health", async (_req, res) => {
  try {
    await checkDbHealth();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/comparativa", async (_req, res) => {
  try {
    const data = await getComparativa();
    res.json({
      ok: true,
      count: data.length,
      data
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/match-description-equivalences/sql", (req, res) => {
  const sqlText = buildDescriptionEquivalenceSql({
    minScore: queryNumber(req.query.minScore, 70),
    limit: queryNumber(req.query.limit, 500),
    save: queryBool(req.query.save, false)
  });

  res.type("text/plain").send(sqlText);
});

app.get("/match-description-equivalences", async (req, res) => {
  try {
    if (queryBool(req.query.printSql, false)) {
      const sqlText = buildDescriptionEquivalenceSql({
        minScore: queryNumber(req.query.minScore, 70),
        limit: queryNumber(req.query.limit, 500),
        save: queryBool(req.query.save, false)
      });

      return res.json({
        ok: true,
        execute: false,
        sql: sqlText
      });
    }

    const result = await matchDescriptionEquivalences({
      minScore: queryNumber(req.query.minScore, 70),
      limit: queryNumber(req.query.limit, 500),
      requestTimeoutMs: queryNumber(req.query.requestTimeoutMs, 120000),
      save: queryBool(req.query.save, false)
    });

    res.json({
      ok: true,
      minScore: queryNumber(req.query.minScore, 70),
      limit: queryNumber(req.query.limit, 500),
      requestTimeoutMs: queryNumber(req.query.requestTimeoutMs, 120000),
      ...result
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/capture", async (req, res) => {
  const payload = req.body || {};
  const validationError = validateCapture(payload);

  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  ensureCapturesDir();

  const fileName = captureFileName();
  const filePath = path.join(CAPTURES_DIR, fileName);

  const capture = {
    receivedAt: new Date().toISOString(),
    ...payload,
    extractor: payload.extractor || (payload.debug && payload.debug.selectedExtractor) || ""
  };

  fs.writeFileSync(filePath, JSON.stringify(capture, null, 2), "utf8");

  let db = {
    requested: Boolean(payload.saveDb),
    saved: false
  };

  if (payload.saveDb) {
    try {
      const result = await saveCaptureToDb(capture, fileName);
      db = {
        requested: true,
        saved: true,
        ...result
      };
    } catch (error) {
      db = {
        requested: true,
        saved: false,
        error: error.message
      };
    }
  }

  if (payload.jobId && pendingScrapes.has(payload.jobId)) {
    const job = pendingScrapes.get(payload.jobId);
    pendingScrapes.set(payload.jobId, {
      ...job,
      status: "completed",
      completedAt: new Date().toISOString(),
      file: fileName,
      products: payload.products.length,
      db
    });
  }

  res.json({
    ok: true,
    file: fileName,
    path: filePath,
    products: payload.products.length,
    db
  });
});

app.get("/open", (req, res) => {
  const targetUrl = req.query.url;
  const validation = validateTargetUrl(targetUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const chromeProfile = chromeProfileForUrl(targetUrl, req.query.chromeProfile);

  openChrome(targetUrl, { chromeProfile }, (error) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        error: "Could not open Chrome. Verify Chrome is installed and available in PATH.",
        detail: error.message
      });
    }

    res.json({ ok: true, opened: targetUrl, chromeProfile });
  });
});

app.get("/scrape", (req, res) => {
  const targetUrl = req.query.url;
  const validation = validateTargetUrl(targetUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const job = createScrapeJob(targetUrl, scrapeOptionsFromQuery(req, targetUrl));
  const chromeProfile = chromeProfileForUrl(targetUrl, req.query.chromeProfile);

  openChrome(targetUrl, { chromeProfile }, (error) => {
    if (error) {
      pendingScrapes.set(job.id, {
        ...job,
        status: "open_failed",
        error: error.message
      });

      return res.status(500).json({
        ok: false,
        error: "Scrape job was created, but Chrome could not be opened. Verify Chrome is installed and available in PATH.",
        detail: error.message,
        jobId: job.id
      });
    }

    res.json({
      ok: true,
      jobId: job.id,
      opened: targetUrl,
      chromeProfile,
      saveDb: job.saveDb,
      message: "Chrome opened. The extension will capture the page automatically when the URL finishes loading."
    });
  });
});

app.get("/bodega/set-store", (req, res) => {
  const targetUrl = req.query.url;
  const validation = validateTargetUrl(targetUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const hostname = validation.parsedUrl.hostname.toLowerCase();
  if (!hostname.includes("bodegaaurrera.com.mx")) {
    return res.status(400).json({
      ok: false,
      error: "This endpoint is only intended for bodegaaurrera.com.mx URLs."
    });
  }

  const zipCode = typeof req.query.zipCode === "string" && req.query.zipCode.trim()
    ? req.query.zipCode.trim()
    : "67350";
  const storeName = typeof req.query.storeName === "string" && req.query.storeName.trim()
    ? req.query.storeName.trim()
    : "Allende Zuazua";

  const jobOptions = scrapeOptionsFromQuery(req, targetUrl, {
    action: "setStore",
    zipCode,
    storeName,
    waitBeforeCaptureMs: 2500,
    closeTab: false
  });

  const job = createScrapeJob(targetUrl, {
    ...jobOptions,
    action: "setStore",
    zipCode,
    storeName
  });
  const chromeProfile = chromeProfileForUrl(targetUrl, req.query.chromeProfile);

  openChrome(targetUrl, { chromeProfile }, (error) => {
    if (error) {
      pendingScrapes.set(job.id, {
        ...job,
        status: "open_failed",
        error: error.message
      });

      return res.status(500).json({
        ok: false,
        error: "Store setup job was created, but Chrome could not be opened. Verify Chrome is installed and available in PATH.",
        detail: error.message,
        jobId: job.id
      });
    }

    res.json({
      ok: true,
      jobId: job.id,
      action: job.action,
      opened: targetUrl,
      chromeProfile,
      zipCode: job.zipCode,
      storeName: job.storeName,
      closeTab: job.closeTab,
      message: "Chrome opened. The extension will set the Bodega Aurrera store automatically without scraping."
    });
  });
});

app.get("/scrape-active-urls", async (req, res) => {
  try {
    const urls = await getActiveScrapeUrls();
    const limit = Math.min(queryNumber(req.query.limit, urls.length || 1), urls.length);
    const openDelayMs = queryNumber(req.query.openDelayMs, 1500);
    const selectedUrls = urls.slice(0, limit);
    const jobs = [];

    for (const targetUrl of selectedUrls) {
      const validation = validateTargetUrl(targetUrl);

      if (validation.error) {
        jobs.push({
          ok: false,
          url: targetUrl,
          error: validation.error
        });
        continue;
      }

      const job = createScrapeJob(targetUrl, scrapeOptionsFromQuery(req, targetUrl, { saveDb: true }));
      const shouldWaitForCompletion = queryBool(req.query.waitForCompletion, shouldWaitForActiveUrl(targetUrl));
      const jobTimeoutMs = queryNumber(req.query.jobTimeoutMs, shouldWaitForActiveUrl(targetUrl) ? 180000 : 120000);
      const chromeProfile = chromeProfileForUrl(targetUrl, req.query.chromeProfile);

      try {
        await openChromeAsync(targetUrl, { chromeProfile });
        const jobSummary = {
          ok: true,
          jobId: job.id,
          url: targetUrl,
          chromeProfile,
          saveDb: job.saveDb,
          autoScroll: job.autoScroll,
          autoPaginate: job.autoPaginate,
          clickLoadMore: job.clickLoadMore,
          waitForCompletion: shouldWaitForCompletion
        };

        if (shouldWaitForCompletion) {
          const completedJob = await waitForJobCompletion(job.id, jobTimeoutMs);
          jobSummary.status = completedJob.status;
          jobSummary.products = completedJob.products || 0;
          jobSummary.file = completedJob.file || "";
          jobSummary.db = completedJob.db || null;
          jobSummary.ok = completedJob.status === "completed";

          if (!jobSummary.ok) {
            jobSummary.error = completedJob.error || `Job finished with status ${completedJob.status}.`;
          }
        }

        jobs.push(jobSummary);
      } catch (error) {
        pendingScrapes.set(job.id, {
          ...job,
          status: "open_failed",
          error: error.message
        });

        jobs.push({
          ok: false,
          jobId: job.id,
          url: targetUrl,
          error: error.message
        });
      }

      if (openDelayMs > 0) {
        await sleep(openDelayMs);
      }
    }

    res.json({
      ok: true,
      source: "Urls_Scrapp",
      totalActiveUrls: urls.length,
      launched: jobs.filter((job) => job.ok).length,
      failed: jobs.filter((job) => !job.ok).length,
      jobs
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/pending-scrape", (req, res) => {
  const currentUrl = req.query.url;
  const validation = validateTargetUrl(currentUrl);

  if (validation.error) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const job = findPendingScrapeByUrl(currentUrl);

  if (!job) {
    return res.json({ ok: true, pending: false });
  }

  pendingScrapes.set(job.id, {
    ...job,
    status: "claimed",
    claimedAt: new Date().toISOString()
  });

  res.json({
    ok: true,
    pending: true,
    job: {
      id: job.id,
      action: job.action,
      url: job.url,
      extractor: job.extractor,
      zipCode: job.zipCode,
      storeName: job.storeName,
      waitBeforeCaptureMs: job.waitBeforeCaptureMs,
      autoScroll: job.autoScroll,
      autoPaginate: job.autoPaginate,
      clickLoadMore: job.clickLoadMore,
      loadMoreText: job.loadMoreText,
      maxLoadMoreClicks: job.maxLoadMoreClicks,
      loadMoreDelayMs: job.loadMoreDelayMs,
      maxPages: job.maxPages,
      paginationDelayMs: job.paginationDelayMs,
      maxScrolls: job.maxScrolls,
      scrollStepPx: job.scrollStepPx,
      scrollDelayMs: job.scrollDelayMs,
      scrollStagnantLimit: job.scrollStagnantLimit,
      postScrollWaitMs: job.postScrollWaitMs,
      closeTab: job.closeTab,
      saveDb: job.saveDb
    }
  });
});

app.post("/scrape-job-status", (req, res) => {
  const { jobId, status, error } = req.body || {};

  if (!jobId || !pendingScrapes.has(jobId)) {
    return res.status(404).json({ ok: false, error: "Job not found." });
  }

  if (!["completed", "failed"].includes(status)) {
    return res.status(400).json({ ok: false, error: "Status must be completed or failed." });
  }

  const job = pendingScrapes.get(jobId);
  pendingScrapes.set(jobId, {
    ...job,
    status,
    error: error || "",
    completedAt: status === "completed" ? new Date().toISOString() : job.completedAt,
    failedAt: status === "failed" ? new Date().toISOString() : job.failedAt
  });

  res.json({ ok: true });
});

app.get("/scrape-jobs", (_req, res) => {
  res.json({
    ok: true,
    jobs: Array.from(pendingScrapes.values())
  });
});

app.listen(PORT, () => {
  ensureCapturesDir();
  console.log(`Fahorro capture backend running at http://localhost:${PORT}`);
});
