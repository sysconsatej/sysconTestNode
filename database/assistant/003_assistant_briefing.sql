/*
  Artin assistant: the daily briefing figures.

  001 installs dbo.assistantDailySummary as a template that returns no rows,
  so the briefing says nothing. This fills it in with figures that are true by
  definition: how much was raised or opened in a period. Each row is one
  figure, and rows whose value is 0 are dropped so the briefing stays short.

  Safe to run more than once. Requires SQL Server 2016 SP1 or later.

  WHAT THIS DELIBERATELY DOES NOT COUNT
  -------------------------------------
  "Pending approvals" and "overdue invoices" are the obvious things to want
  here, and both were left out because this database cannot answer them
  without a rule only your team can supply:

    * approvedFlag is NULL on 137,641 of 187,722 invoices (73%), so NULL
      plainly does not mean "waiting for approval"; counting it would report
      six figures of pending work every morning.
    * dueDate alone says nothing about settlement: 176,245 invoices are past
      their due date, which is all but the newest of them. Overdue needs the
      receipts in tblVoucherLedger, and which voucher types settle an invoice
      is a business rule.
    * deletedNo holds arbitrary numbers (555, 115823, ...) rather than a 0/1
      flag, and cancelStatus is NULL on every row, so neither can be used to
      exclude dead records.

  Tell the assistant's maintainer what "pending" and "overdue" mean in your
  process and these become two more UNION ALL branches.

  Note on `status`: tblInvoice.status is a bit, true on 187,122 rows and false
  on 600. Its meaning was not confirmed, so nothing is filtered on it. If
  false means void, uncomment the two marked lines.
*/

CREATE OR ALTER PROCEDURE dbo.assistantDailySummary
  @clientId  INT,
  @userId    INT,
  @companyId INT = NULL,
  @branchId  INT = NULL,
  @finYearId INT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @today DATE = CAST(GETDATE() AS DATE);
  DECLARE @weekStart DATE = DATEADD(DAY, -6, @today);

  /*
    The label is read out as written, and nothing downstream makes it plural,
    so each figure carries both wordings.
  */
  SELECT label, value
  FROM (
    SELECT
      CASE WHEN COUNT(*) = 1
        THEN N'invoice raised today'
        ELSE N'invoices raised today' END AS label,
      COUNT(*) AS value,
      1 AS ord
    FROM dbo.tblInvoice
    WHERE clientId = @clientId
      AND (@companyId IS NULL OR companyId = @companyId)
      AND (@branchId IS NULL OR companyBranchId = @branchId)
      AND (@finYearId IS NULL OR financialYearId = @finYearId)
      AND CAST(invoiceDate AS DATE) = @today
      -- AND status = 1

    UNION ALL

    SELECT
      CASE WHEN COUNT(*) = 1
        THEN N'job opened today'
        ELSE N'jobs opened today' END,
      COUNT(*),
      2
    FROM dbo.tblJob
    WHERE clientId = @clientId
      AND (@companyId IS NULL OR companyId = @companyId)
      AND (@branchId IS NULL OR companyBranchId = @branchId)
      AND (@finYearId IS NULL OR financialYearId = @finYearId)
      AND jobDate = @today
      -- AND status = 1

    UNION ALL

    SELECT
      CASE WHEN COUNT(*) = 1
        THEN N'invoice raised in the last seven days'
        ELSE N'invoices raised in the last seven days' END,
      COUNT(*),
      3
    FROM dbo.tblInvoice
    WHERE clientId = @clientId
      AND (@companyId IS NULL OR companyId = @companyId)
      AND (@branchId IS NULL OR companyBranchId = @branchId)
      AND (@finYearId IS NULL OR financialYearId = @finYearId)
      AND CAST(invoiceDate AS DATE) BETWEEN @weekStart AND @today
  ) AS figures
  WHERE value > 0
  ORDER BY ord;
END
GO
