const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");

// Finished jobs are kept this long so the frontend can still read the result.
const EXTRACTION_JOB_TTL_MS = Number(
  process.env.EXTRACTION_JOB_TTL_MS || 60 * 60 * 1000,
);

// A running job that has not reported progress for this long is dropped, so a
// hung extraction cannot block its user forever.
const EXTRACTION_STALE_JOB_MS = Number(
  process.env.EXTRACTION_STALE_JOB_MS || 30 * 60 * 1000,
);

const FINISHED_STATUSES = ["completed", "failed"];

// Jobs belong to the logged-in user (set by auth.verifyToken), so one user can
// never read another user's extracted data.
function getOwnerKey(req) {
  return `${req.clientId ?? ""}:${req.userId ?? ""}`;
}

// Per-upload reading status storage. Code running inside run(extractionId, fn)
// can call setStatus(patch) without passing the id; AsyncLocalStorage carries it
// through every await in the background extraction.
function createExtractionJobStore(createIdleStatus) {
  const jobs = new Map(); // extractionId -> { ownerKey, readingStatus }
  const context = new AsyncLocalStorage();

  function cleanup() {
    const now = Date.now();

    for (const [extractionId, job] of jobs.entries()) {
      const status = job.readingStatus;
      const age = now - new Date(status?.updatedAt || 0).getTime();
      const isFinished = FINISHED_STATUSES.includes(status?.status);

      if (
        (isFinished && age > EXTRACTION_JOB_TTL_MS) ||
        (!isFinished && age > EXTRACTION_STALE_JOB_MS)
      ) {
        jobs.delete(extractionId);
      }
    }
  }

  function createJob(ownerKey) {
    cleanup();

    const extractionId = crypto.randomUUID();

    jobs.set(extractionId, {
      ownerKey,
      readingStatus: {
        ...createIdleStatus(),
        extractionId,
        updatedAt: new Date().toISOString(),
      },
    });

    return extractionId;
  }

  function run(extractionId, fn) {
    return context.run(extractionId, fn);
  }

  function getStatus(extractionId = context.getStore()) {
    return jobs.get(extractionId)?.readingStatus || null;
  }

  function setStatus(patch = {}, extractionId = context.getStore()) {
    const job = jobs.get(extractionId);

    // A cancelled job keeps its "cancelled" status even if the background
    // work reports progress before it notices the cancellation.
    if (!job || job.cancelled) {
      return;
    }

    // While running, progress never moves backwards (parallel chunks can
    // report out of order).
    if (
      patch.status === "running" &&
      job.readingStatus.status === "running" &&
      typeof patch.progress === "number" &&
      patch.progress < Number(job.readingStatus.progress || 0)
    ) {
      patch = { ...patch, progress: job.readingStatus.progress };
    }

    job.readingStatus = {
      ...job.readingStatus,
      ...patch,
      extractionId,
      updatedAt: new Date().toISOString(),
    };
  }

  function getStatusForOwner(extractionId, ownerKey) {
    cleanup();

    const job = jobs.get(extractionId);
    return job && job.ownerKey === ownerKey ? job.readingStatus : null;
  }

  function findLatestForOwner(ownerKey, { runningOnly = false } = {}) {
    cleanup();

    let latest = null;

    for (const job of jobs.values()) {
      if (job.ownerKey !== ownerKey) continue;
      if (runningOnly && job.readingStatus.status !== "running") continue;

      if (
        !latest ||
        new Date(job.readingStatus.updatedAt) > new Date(latest.updatedAt)
      ) {
        latest = job.readingStatus;
      }
    }

    return latest;
  }

  // Background work checks this between steps and stops early.
  function isCancelled(extractionId = context.getStore()) {
    const job = jobs.get(extractionId);
    return !job || !!job.cancelled;
  }

  // Returns the cancelled status, or null if the job is not the owner's.
  function cancel(extractionId, ownerKey) {
    const job = jobs.get(extractionId);

    if (!job || job.ownerKey !== ownerKey) {
      return null;
    }

    if (job.readingStatus.status === "running") {
      setStatus(
        {
          status: "failed",
          stage: "cancelled",
          message: "PDF extraction cancelled",
          error: "PDF extraction cancelled",
          data: null,
        },
        extractionId,
      );
      job.cancelled = true;
    }

    return job.readingStatus;
  }

  return {
    createJob,
    run,
    getStatus,
    setStatus,
    getStatusForOwner,
    findLatestForOwner,
    isCancelled,
    cancel,
  };
}

module.exports = {
  getOwnerKey,
  createExtractionJobStore,
};
