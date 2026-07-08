const sql = require("mssql");

let poolPromise;

function envForProfile(key) {
  const profile = (process.env.SQLSERVER_PROFILE || "").toUpperCase();
  return (profile && process.env[`SQLSERVER_${profile}_${key}`]) || process.env[`SQLSERVER_${key}`];
}

function boolFromEnv(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function parseSqlServerHost(value) {
  const [host, instanceName] = String(value || "").split("\\");

  return {
    server: host,
    instanceName
  };
}

function getDbConfig() {
  const hostValue = envForProfile("HOST");
  const database = envForProfile("DATABASE");
  const portValue = envForProfile("PORT");
  const parsedHost = parseSqlServerHost(hostValue);
  const encrypt = boolFromEnv(envForProfile("ENCRYPT"), false);
  const trustServerCertificate = boolFromEnv(envForProfile("TRUST_CERT"), true);
  const missing = [];

  if (!hostValue) missing.push("SQLSERVER_HOST");
  if (!database) missing.push("SQLSERVER_DATABASE");
  if (!envForProfile("USER")) missing.push("SQLSERVER_USER");
  if (!envForProfile("PASSWORD")) missing.push("SQLSERVER_PASSWORD");

  if (missing.length > 0) {
    const profile = process.env.SQLSERVER_PROFILE ? ` for profile ${process.env.SQLSERVER_PROFILE}` : "";
    throw new Error(`Missing SQL Server environment variable(s)${profile}: ${missing.join(", ")}`);
  }

  const config = {
    server: parsedHost.server,
    database,
    user: envForProfile("USER"),
    password: envForProfile("PASSWORD"),
    requestTimeout: Number(envForProfile("REQUEST_TIMEOUT_MS") || 120000),
    connectionTimeout: Number(envForProfile("CONNECTION_TIMEOUT_MS") || 30000),
    options: {
      encrypt,
      trustServerCertificate,
      ...(parsedHost.instanceName ? { instanceName: parsedHost.instanceName } : {})
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };

  if (!parsedHost.instanceName) {
    config.port = Number(portValue || 1433);
  }

  return config;
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(getDbConfig());
  }

  return poolPromise;
}

async function ensureSchema(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.ScrapeProducts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScrapeProducts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    captureId INT NOT NULL,
    name NVARCHAR(1000) NULL,
    price NVARCHAR(255) NULL,
    oldPrice NVARCHAR(255) NULL,
    image NVARCHAR(2000) NULL,
    link NVARCHAR(2000) NULL,
    sku NVARCHAR(255) NULL,
    rawText NVARCHAR(MAX) NULL,
    rawJson NVARCHAR(MAX) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID('dbo.ScrapeCaptures', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ScrapeCaptures (
    id INT IDENTITY(1,1) PRIMARY KEY,
    jobId NVARCHAR(255) NULL,
    captureMode NVARCHAR(50) NULL,
    domain NVARCHAR(255) NULL,
    extractor NVARCHAR(255) NULL,
    url NVARCHAR(2000) NOT NULL,
    title NVARCHAR(1000) NULL,
    pageTimestamp DATETIME2 NULL,
    receivedAt DATETIME2 NOT NULL,
    fileName NVARCHAR(255) NULL,
    productCount INT NOT NULL DEFAULT 0,
    debugJson NVARCHAR(MAX) NULL,
    text NVARCHAR(MAX) NULL,
    html NVARCHAR(MAX) NULL,
    rawJson NVARCHAR(MAX) NULL
  );
END;

IF COL_LENGTH('dbo.ScrapeCaptures', 'Tienda') IS NULL
BEGIN
  ALTER TABLE dbo.ScrapeCaptures
    ADD Tienda NVARCHAR(255) NULL;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_ScrapeProducts_ScrapeCaptures'
)
BEGIN
  ALTER TABLE dbo.ScrapeProducts
    ADD CONSTRAINT FK_ScrapeProducts_ScrapeCaptures
    FOREIGN KEY (captureId) REFERENCES dbo.ScrapeCaptures(id);
END;
`);
}

function inputNullable(request, name, type, value) {
  request.input(name, type, value === undefined ? null : value);
}

function toSqlLocalDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;

  // mssql/tedious serializes JS Date components as UTC for DateTime2.
  // Shift the instant so SQL stores the local wall-clock time.
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
}

async function saveCaptureToDb(capture, fileName) {
  const pool = await getPool();
  await ensureSchema(pool);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const captureRequest = new sql.Request(transaction);
    inputNullable(captureRequest, "jobId", sql.NVarChar(255), capture.jobId);
    inputNullable(captureRequest, "captureMode", sql.NVarChar(50), capture.captureMode);
    inputNullable(captureRequest, "domain", sql.NVarChar(255), capture.domain);
    inputNullable(captureRequest, "extractor", sql.NVarChar(255), capture.extractor);
    inputNullable(captureRequest, "Tienda", sql.NVarChar(255), capture.Tienda);
    inputNullable(captureRequest, "url", sql.NVarChar(2000), capture.url);
    inputNullable(captureRequest, "title", sql.NVarChar(1000), capture.title);
    inputNullable(captureRequest, "pageTimestamp", sql.DateTime2, capture.timestamp ? toSqlLocalDate(capture.timestamp) : null);
    inputNullable(captureRequest, "receivedAt", sql.DateTime2, toSqlLocalDate(capture.receivedAt));
    inputNullable(captureRequest, "fileName", sql.NVarChar(255), fileName);
    inputNullable(captureRequest, "productCount", sql.Int, capture.products.length);
    inputNullable(captureRequest, "debugJson", sql.NVarChar(sql.MAX), JSON.stringify(capture.debug || null));
    inputNullable(captureRequest, "text", sql.NVarChar(sql.MAX), capture.text);
    inputNullable(captureRequest, "html", sql.NVarChar(sql.MAX), capture.html);
    inputNullable(captureRequest, "rawJson", sql.NVarChar(sql.MAX), JSON.stringify(capture));

    const captureResult = await captureRequest.query(`
INSERT INTO dbo.ScrapeCaptures (
  jobId, captureMode, domain, extractor, Tienda, url, title, pageTimestamp, receivedAt,
  fileName, productCount, debugJson, text, html, rawJson
)
OUTPUT INSERTED.id
VALUES (
  @jobId, @captureMode, @domain, @extractor, @Tienda, @url, @title, @pageTimestamp, @receivedAt,
  @fileName, @productCount, @debugJson, @text, @html, @rawJson
);
`);

    const captureId = captureResult.recordset[0].id;

    for (const product of capture.products) {
      const productRequest = new sql.Request(transaction);
      inputNullable(productRequest, "captureId", sql.Int, captureId);
      inputNullable(productRequest, "name", sql.NVarChar(1000), product.name);
      inputNullable(productRequest, "price", sql.NVarChar(255), product.price);
      inputNullable(productRequest, "oldPrice", sql.NVarChar(255), product.oldPrice);
      inputNullable(productRequest, "image", sql.NVarChar(2000), product.image);
      inputNullable(productRequest, "link", sql.NVarChar(2000), product.link);
      inputNullable(productRequest, "sku", sql.NVarChar(255), product.sku);
      inputNullable(productRequest, "rawText", sql.NVarChar(sql.MAX), product.rawText);
      inputNullable(productRequest, "rawJson", sql.NVarChar(sql.MAX), JSON.stringify(product));

      await productRequest.query(`
INSERT INTO dbo.ScrapeProducts (
  captureId, name, price, oldPrice, image, link, sku, rawText, rawJson
)
VALUES (
  @captureId, @name, @price, @oldPrice, @image, @link, @sku, @rawText, @rawJson
);
`);
    }

    await transaction.commit();
    return { captureId, productsInserted: capture.products.length };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function checkDbHealth() {
  const pool = await getPool();
  const result = await pool.request().query("SELECT 1 AS ok;");
  return result.recordset[0];
}

async function getComparativa() {
  const pool = await getPool();
  const result = await pool.request().execute("GetComparativa");
  return result.recordset || [];
}

async function getActiveScrapeUrls() {
  const pool = await getPool();
  const result = await pool.request().query(`
SELECT strUrl
FROM Urls_Scrapp
WHERE estatus = 1;
`);

  return (result.recordset || [])
    .map((row) => row.strUrl)
    .filter(Boolean);
}

function descriptionMatchCte() {
  return `
WITH InternalBase AS (
  SELECT
    CAST(a.codigo AS NVARCHAR(255)) AS codigo,
    CAST(a.descripcion AS NVARCHAR(1000)) AS descripcion,
    UPPER(LTRIM(RTRIM(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        CAST(a.descripcion AS NVARCHAR(1000)),
        '.', ' '), ',', ' '), '-', ' '), '/', ' '), '\\', ' '),
        '(', ' '), ')', ' '), ':', ' '), ';', ' '), '"', ' ')
    ))) AS normalizedDescription
  FROM dbo.com_articulos a
  WHERE a.codigo IS NOT NULL
    AND a.descripcion IS NOT NULL
),
ScrapedBase AS (
  SELECT
    p.id AS scrapeProductId,
    CAST(p.sku AS NVARCHAR(255)) AS scrapeSku,
    CAST(p.name AS NVARCHAR(1000)) AS scrapeName,
    CAST(p.link AS NVARCHAR(2000)) AS scrapeLink,
    CAST(c.domain AS NVARCHAR(255)) AS scrapeDomain,
    UPPER(LTRIM(RTRIM(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        CAST(p.name AS NVARCHAR(1000)),
        '.', ' '), ',', ' '), '-', ' '), '/', ' '), '\\', ' '),
        '(', ' '), ')', ' '), ':', ' '), ';', ' '), '"', ' ')
    ))) AS normalizedName,
    ROW_NUMBER() OVER (
      PARTITION BY CAST(p.sku AS NVARCHAR(255)), CAST(p.name AS NVARCHAR(1000))
      ORDER BY p.createdAt DESC, p.id DESC
    ) AS rn
  FROM dbo.ScrapeProducts p
  LEFT JOIN dbo.ScrapeCaptures c
    ON c.id = p.captureId
  WHERE p.sku IS NOT NULL
    AND LTRIM(RTRIM(CAST(p.sku AS NVARCHAR(255)))) <> ''
    AND p.name IS NOT NULL
    AND LTRIM(RTRIM(CAST(p.name AS NVARCHAR(1000)))) <> ''
),
ScrapedLatest AS (
  SELECT *
  FROM ScrapedBase
  WHERE rn = 1
),
InternalTokens AS (
  SELECT
    i.codigo,
    token = LTRIM(RTRIM(s.value))
  FROM InternalBase i
  CROSS APPLY STRING_SPLIT(i.normalizedDescription, ' ') s
  WHERE LEN(LTRIM(RTRIM(s.value))) >= 4
    AND LTRIM(RTRIM(s.value)) NOT IN (
      'PARA', 'CON', 'LOS', 'LAS', 'DEL', 'DE', 'POR', 'UNA', 'UNO',
      'PZA', 'PZAS', 'PIEZA', 'PIEZAS', 'PACK'
    )
),
ScrapedTokens AS (
  SELECT
    s.scrapeProductId,
    token = LTRIM(RTRIM(t.value))
  FROM ScrapedLatest s
  CROSS APPLY STRING_SPLIT(s.normalizedName, ' ') t
  WHERE LEN(LTRIM(RTRIM(t.value))) >= 4
    AND LTRIM(RTRIM(t.value)) NOT IN (
      'PARA', 'CON', 'LOS', 'LAS', 'DEL', 'DE', 'POR', 'UNA', 'UNO',
      'PZA', 'PZAS', 'PIEZA', 'PIEZAS', 'PACK'
    )
),
InternalTokenCounts AS (
  SELECT codigo, COUNT(DISTINCT token) AS tokenCount
  FROM InternalTokens
  GROUP BY codigo
),
ScrapedTokenCounts AS (
  SELECT scrapeProductId, COUNT(DISTINCT token) AS tokenCount
  FROM ScrapedTokens
  GROUP BY scrapeProductId
),
UsefulScrapedTokens AS (
  SELECT token
  FROM ScrapedTokens
  GROUP BY token
  HAVING COUNT(DISTINCT scrapeProductId) <= 200
),
TokenMatches AS (
  SELECT
    it.codigo,
    st.scrapeProductId,
    COUNT(DISTINCT it.token) AS commonTokens
  FROM InternalTokens it
  INNER JOIN ScrapedTokens st
    ON st.token = it.token
  INNER JOIN UsefulScrapedTokens ust
    ON ust.token = st.token
  GROUP BY it.codigo, st.scrapeProductId
),
Candidates AS (
  SELECT
    i.codigo,
    i.descripcion,
    s.scrapeProductId,
    s.scrapeSku,
    s.scrapeName,
    s.scrapeLink,
    s.scrapeDomain,
    CAST(
      CASE
        WHEN i.normalizedDescription = s.normalizedName THEN 100.00
        WHEN i.normalizedDescription LIKE '%' + s.normalizedName + '%'
          OR s.normalizedName LIKE '%' + i.normalizedDescription + '%' THEN 90.00
        ELSE 100.0 * tm.commonTokens / NULLIF(
          CASE
            WHEN ISNULL(itc.tokenCount, 0) > ISNULL(stc.tokenCount, 0)
              THEN ISNULL(itc.tokenCount, 0)
            ELSE ISNULL(stc.tokenCount, 0)
          END,
          0
        )
      END AS DECIMAL(5,2)
    ) AS matchScore,
    CASE
      WHEN i.normalizedDescription = s.normalizedName THEN 'exact'
      WHEN i.normalizedDescription LIKE '%' + s.normalizedName + '%'
        OR s.normalizedName LIKE '%' + i.normalizedDescription + '%' THEN 'contains'
      ELSE 'token_overlap'
    END AS matchMethod,
    ROW_NUMBER() OVER (
      PARTITION BY i.codigo, s.scrapeSku
      ORDER BY
        CASE
          WHEN i.normalizedDescription = s.normalizedName THEN 100.00
          WHEN i.normalizedDescription LIKE '%' + s.normalizedName + '%'
            OR s.normalizedName LIKE '%' + i.normalizedDescription + '%' THEN 90.00
          ELSE 100.0 * tm.commonTokens / NULLIF(
            CASE
              WHEN ISNULL(itc.tokenCount, 0) > ISNULL(stc.tokenCount, 0)
                THEN ISNULL(itc.tokenCount, 0)
              ELSE ISNULL(stc.tokenCount, 0)
            END,
            0
          )
        END DESC,
        s.scrapeProductId DESC
    ) AS rn
  FROM TokenMatches tm
  INNER JOIN InternalBase i
    ON i.codigo = tm.codigo
  INNER JOIN ScrapedLatest s
    ON s.scrapeProductId = tm.scrapeProductId
  LEFT JOIN InternalTokenCounts itc
    ON itc.codigo = i.codigo
  LEFT JOIN ScrapedTokenCounts stc
    ON stc.scrapeProductId = s.scrapeProductId
),
BestCandidates AS (
  SELECT TOP (@limit)
    codigo,
    descripcion,
    scrapeProductId,
    scrapeSku,
    scrapeName,
    scrapeLink,
    scrapeDomain,
    matchScore,
    matchMethod
  FROM Candidates
  WHERE rn = 1
    AND matchScore >= @minScore
  ORDER BY matchScore DESC, codigo, scrapeSku
)
`;
}

async function matchDescriptionEquivalences(options = {}) {
  const minScore = Number(options.minScore || 70);
  const limit = Number(options.limit || 500);
  const requestTimeoutMs = Number(options.requestTimeoutMs || 120000);
  const save = Boolean(options.save);
  const pool = await getPool();
  const cte = descriptionMatchCte();

  if (!save) {
    const request = pool.request();
    request.timeout = requestTimeoutMs;

    const result = await request
      .input("minScore", sql.Decimal(5, 2), minScore)
      .input("limit", sql.Int, limit)
      .query(`${cte}
SELECT
  codigo,
  descripcion,
  scrapeProductId,
  scrapeSku,
  scrapeName,
  scrapeLink,
  scrapeDomain,
  matchScore,
  matchMethod
FROM BestCandidates;`);

    return {
      saved: false,
      rowsAffected: 0,
      rows: result.recordset || []
    };
  }

  const request = pool.request();
  request.timeout = requestTimeoutMs;

  const result = await request
    .input("minScore", sql.Decimal(5, 2), minScore)
    .input("limit", sql.Int, limit)
    .query(`${cte}
MERGE dbo.ScrapeProductEquivalences AS target
USING BestCandidates AS source
  ON target.artc_articulo = source.codigo
 AND target.scrapeSku = source.scrapeSku
WHEN MATCHED THEN
  UPDATE SET
    target.artc_descripcion = source.descripcion,
    target.scrapeProductId = source.scrapeProductId,
    target.scrapeName = source.scrapeName,
    target.scrapeLink = source.scrapeLink,
    target.scrapeDomain = source.scrapeDomain,
    target.matchScore = source.matchScore,
    target.matchMethod = source.matchMethod,
    target.updatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (
    artc_articulo,
    artc_descripcion,
    scrapeProductId,
    scrapeSku,
    scrapeName,
    scrapeLink,
    scrapeDomain,
    matchScore,
    matchMethod,
    status,
    createdAt
  )
  VALUES (
    source.codigo,
    source.descripcion,
    source.scrapeProductId,
    source.scrapeSku,
    source.scrapeName,
    source.scrapeLink,
    source.scrapeDomain,
    source.matchScore,
    source.matchMethod,
    'pending',
    SYSUTCDATETIME()
  )
OUTPUT
  $action AS action,
  inserted.artc_articulo AS codigo,
  inserted.scrapeSku,
  inserted.matchScore,
  inserted.matchMethod;`);

  return {
    saved: true,
    rowsAffected: result.recordset ? result.recordset.length : 0,
    rows: result.recordset || []
  };
}

function descriptionPreviewSql() {
  return `SELECT
  codigo,
  descripcion,
  scrapeProductId,
  scrapeSku,
  scrapeName,
  scrapeLink,
  scrapeDomain,
  matchScore,
  matchMethod
FROM BestCandidates;`;
}

function descriptionMergeSql() {
  return `MERGE dbo.ScrapeProductEquivalences AS target
USING BestCandidates AS source
  ON target.artc_articulo = source.codigo
 AND target.scrapeSku = source.scrapeSku
WHEN MATCHED THEN
  UPDATE SET
    target.artc_descripcion = source.descripcion,
    target.scrapeProductId = source.scrapeProductId,
    target.scrapeName = source.scrapeName,
    target.scrapeLink = source.scrapeLink,
    target.scrapeDomain = source.scrapeDomain,
    target.matchScore = source.matchScore,
    target.matchMethod = source.matchMethod,
    target.updatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (
    artc_articulo,
    artc_descripcion,
    scrapeProductId,
    scrapeSku,
    scrapeName,
    scrapeLink,
    scrapeDomain,
    matchScore,
    matchMethod,
    status,
    createdAt
  )
  VALUES (
    source.codigo,
    source.descripcion,
    source.scrapeProductId,
    source.scrapeSku,
    source.scrapeName,
    source.scrapeLink,
    source.scrapeDomain,
    source.matchScore,
    source.matchMethod,
    'pending',
    SYSUTCDATETIME()
  )
OUTPUT
  $action AS action,
  inserted.artc_articulo AS codigo,
  inserted.scrapeSku,
  inserted.matchScore,
  inserted.matchMethod;`;
}

function buildDescriptionEquivalenceSql(options = {}) {
  const minScore = Number(options.minScore || 70).toFixed(2);
  const limit = Number(options.limit || 500);
  const save = Boolean(options.save);

  return [
    `DECLARE @minScore DECIMAL(5,2) = ${minScore};`,
    `DECLARE @limit INT = ${limit};`,
    "",
    descriptionMatchCte(),
    save ? descriptionMergeSql() : descriptionPreviewSql()
  ].join("\n");
}

module.exports = {
  buildDescriptionEquivalenceSql,
  checkDbHealth,
  getActiveScrapeUrls,
  getComparativa,
  matchDescriptionEquivalences,
  saveCaptureToDb
};
