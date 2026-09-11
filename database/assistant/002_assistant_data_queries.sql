/*
  Artin assistant: approved read-only data queries.

  "What's our total outstanding this month?" is answered by running one of
  the stored procedures listed here, without opening a report. Only rows in
  this table can be run, only with the parameters they declare, and only by
  signed-in users of the matching client. The DBA controls the list.

  Safe to run more than once. Requires SQL Server 2016 SP1 or later.
*/

IF OBJECT_ID(N'dbo.tblAssistantDataQuery', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.tblAssistantDataQuery (
    id                 INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_tblAssistantDataQuery PRIMARY KEY,
    clientId           INT            NULL,      -- NULL = available to every client
    queryKey           NVARCHAR(64)   NOT NULL,  -- e.g. N'outstanding_by_party'
    title              NVARCHAR(200)  NOT NULL,  -- spoken in answers, e.g. N'Outstanding by party'
    description        NVARCHAR(1000) NOT NULL,  -- tells the AI when to use it
    procedureName      NVARCHAR(128)  NOT NULL,  -- e.g. N'dbo.assistantOutstandingByParty'
    /* JSON array of user parameters, e.g.
       [{"name":"partyName","type":"string","description":"Party name or part of it"},
        {"name":"fromDate","type":"date","description":"Start date"}]
       Types: string, number, date. */
    parameters         NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_tblAssistantDataQuery_parameters DEFAULT N'[]',
    /* Comma list of values taken from the signed-in session, passed only if
       listed: clientId, userId, companyId, branchId, finYearId */
    contextParameters  NVARCHAR(200)  NOT NULL CONSTRAINT DF_tblAssistantDataQuery_context DEFAULT N'clientId',
    isActive           BIT            NOT NULL CONSTRAINT DF_tblAssistantDataQuery_isActive DEFAULT 1,
    createdAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_tblAssistantDataQuery_createdAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_tblAssistantDataQuery_client_key UNIQUE (clientId, queryKey),
    CONSTRAINT CK_tblAssistantDataQuery_parameters CHECK (ISJSON(parameters) = 1)
  );
END
GO

/*
  EXAMPLE (commented out). Replace the table and columns with your own, keep
  the procedure read-only, and grant EXECUTE to the application login.

  CREATE OR ALTER PROCEDURE dbo.assistantOutstandingByParty
    @clientId  INT,
    @companyId INT = NULL,
    @partyName NVARCHAR(200) = NULL
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT TOP (200) p.name AS partyName, SUM(i.balanceAmount) AS outstanding
    FROM dbo.tblInvoice AS i
    JOIN dbo.tblParty AS p ON p.id = i.partyId
    WHERE i.clientId = @clientId
      AND (@companyId IS NULL OR i.companyId = @companyId)
      AND (@partyName IS NULL OR p.name LIKE N'%' + @partyName + N'%')
      AND i.balanceAmount > 0
    GROUP BY p.name
    ORDER BY outstanding DESC;
  END
  GO

  INSERT INTO dbo.tblAssistantDataQuery
    (clientId, queryKey, title, description, procedureName, parameters, contextParameters)
  VALUES
    (NULL, N'outstanding_by_party', N'Outstanding by party',
     N'Amounts still due from customers, per party. Use for questions about outstanding, receivables, or dues.',
     N'dbo.assistantOutstandingByParty',
     N'[{"name":"partyName","type":"string","description":"Party name or part of it; omit for all parties"}]',
     N'clientId,companyId');
*/
