-- One row per AI PDF extraction (purchase invoice, BL, Form 32AS).
-- Written by src/helper/aiUsageLogger.js. Safe to run more than once.

IF OBJECT_ID(N'dbo.tblAiExtractionUsage', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.tblAiExtractionUsage (
    id             BIGINT IDENTITY(1, 1) NOT NULL PRIMARY KEY,
    extractionId   VARCHAR(64)    NOT NULL,
    documentType   VARCHAR(30)    NOT NULL,  -- purchaseInvoice | bl | form32AS
    clientId       INT            NULL,
    userId         INT            NULL,
    fileName       NVARCHAR(500)  NULL,
    pageCount      INT            NULL,
    status         VARCHAR(20)    NOT NULL,  -- completed | failed | cancelled
    durationMs     INT            NULL,
    models         VARCHAR(200)   NULL,
    promptTokens   INT            NULL,
    outputTokens   INT            NULL,      -- includes thinking tokens
    thoughtsTokens INT            NULL,
    totalTokens    INT            NULL,
    costUSD        DECIMAL(12, 6) NULL,      -- estimate at list price
    errorMessage   NVARCHAR(1000) NULL,
    createdAt      DATETIME2      NOT NULL
      CONSTRAINT DF_tblAiExtractionUsage_createdAt DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_tblAiExtractionUsage_client_createdAt
    ON dbo.tblAiExtractionUsage (clientId, createdAt);
END
GO

-- Example: monthly cost and speed by client and document type
-- (set @clientId to one client, or leave it NULL for all clients)
-- DECLARE @clientId INT = NULL;
--
-- SELECT clientId,
--        documentType,
--        FORMAT(createdAt, 'yyyy-MM') AS month,
--        COUNT(*)                     AS extractions,
--        SUM(costUSD)                 AS costUSD,
--        AVG(durationMs) / 1000.0     AS avgSeconds,
--        SUM(thoughtsTokens) * 1.0 / NULLIF(SUM(outputTokens), 0) AS thinkingShare
-- FROM dbo.tblAiExtractionUsage
-- WHERE status = 'completed'
--   AND (@clientId IS NULL OR clientId = @clientId)
-- GROUP BY clientId, documentType, FORMAT(createdAt, 'yyyy-MM')
-- ORDER BY month DESC, clientId, documentType;
