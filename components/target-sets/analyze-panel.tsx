"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Starts an analysis (POST /api/target-sets/:id/analyze) and polls the same
// URL for progress while it runs. When it finishes, the page is refreshed so
// the server-rendered parts (JD details, results) update.

export interface PanelStatus {
  status: "draft" | "analyzing" | "ready" | "failed";
  progress: {
    stage: "extracting" | "embedding" | "saving";
    extracted: number;
    total: number;
  } | null;
  error: string | null;
}

const POLL_MS = 1000;

function progressLabel(progress: PanelStatus["progress"]): string {
  if (!progress) return "Starting…";
  switch (progress.stage) {
    case "extracting":
      return `Reading job descriptions: ${progress.extracted} of ${progress.total}`;
    case "embedding":
      return "Comparing requirements with your resume…";
    case "saving":
      return "Saving results…";
  }
}

/** Extraction is most of the work; the last two stages share the final 10%. */
function progressValue(progress: PanelStatus["progress"]): number {
  if (!progress) return 0;
  if (progress.stage === "extracting") {
    return progress.total === 0 ? 0 : (progress.extracted / progress.total) * 90;
  }
  return progress.stage === "embedding" ? 92 : 97;
}

export function AnalyzePanel({
  targetSetId,
  initial,
  canAnalyze,
  analyzedBefore,
}: {
  targetSetId: string;
  initial: PanelStatus;
  /** False while the set has fewer JDs than the minimum. */
  canAnalyze: boolean;
  analyzedBefore: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const url = `/api/target-sets/${targetSetId}/analyze`;
  const analyzing = status.status === "analyzing";

  useEffect(() => {
    if (!analyzing) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const next = (await response.json()) as PanelStatus;
        if (cancelled) return;
        setStatus(next);
        if (next.status !== "analyzing") router.refresh();
      } catch {
        // Network blip: the next render schedules another poll.
        if (!cancelled) setStatus((s) => ({ ...s }));
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [analyzing, status, url, router]);

  async function start() {
    setStarting(true);
    setRequestError(null);
    try {
      const response = await fetch(url, { method: "POST" });
      const body = (await response.json()) as PanelStatus & { error?: string };
      if (!response.ok) {
        setRequestError(body.error ?? "Couldn't start the analysis. Try again.");
        return;
      }
      setStatus(body);
      // Re-render the page so adding and removing JDs is locked while it runs.
      router.refresh();
    } catch {
      setRequestError("Couldn't reach the app. Is it still running?");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      {analyzing ? (
        <div className="space-y-2">
          <p className="text-sm" aria-live="polite">
            {progressLabel(status.progress)}
          </p>
          <progress
            max={100}
            value={progressValue(status.progress)}
            aria-label="Analysis progress"
            className="h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent"
          />
          <p className="text-xs text-muted">
            Each new job description takes about 10–20 seconds; ones read before are instant. You
            can leave this page and come back.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={!canAnalyze || starting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
          >
            {starting ? "Starting…" : analyzedBefore ? "Analyze again" : "Analyze"}
          </button>
          <p className="text-xs text-muted">
            {canAnalyze
              ? "Each new job description is sent to the AI provider once to pull out its skills."
              : "Add at least 2 job descriptions to analyze."}
          </p>
        </div>
      )}
      {status.status === "failed" && status.error && !analyzing && (
        <p role="alert" className="text-sm text-danger">
          {status.error}
        </p>
      )}
      {requestError && (
        <p role="alert" className="text-sm text-danger">
          {requestError}
        </p>
      )}
    </div>
  );
}
