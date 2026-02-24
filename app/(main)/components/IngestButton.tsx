"use client";

import { useState } from "react";

export default function IngestButton() {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");

  async function runIngest() {
    setLoading(true);
    setStatus("");

    try {
      const headers: HeadersInit = { "content-type": "application/json" };
      if (token.trim()) {
        headers.authorization = `Bearer ${token.trim()}`;
      }

      const response = await fetch("/api/ingest", {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "all", includeBoxscore: false }),
      });

      const payload = (await response.json()) as {
        status?: string;
        gamesUpserted?: number;
        statsUpserted?: number;
        message?: string;
      };

      if (!response.ok || payload.status !== "ok") {
        setStatus(payload.message ?? "Ingest failed");
        return;
      }

      setStatus(
        `Ingest complete: ${payload.gamesUpserted ?? 0} games upserted, ${
          payload.statsUpserted ?? 0
        } stats upserted.`,
      );
    } catch {
      setStatus("Ingest failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="data-panel rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="stat-label">Admin Ingest</p>
          <p className="text-xs text-foreground/90">Pull latest schedule/results from ESPN</p>
        </div>
        <span className="rounded-full border border-line bg-panel-2 px-2 py-1 text-xs text-muted">
          D1 Upsert
        </span>
      </div>

      <div className="grid gap-2.5 md:grid-cols-[1fr_auto]">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="ADMIN_TOKEN (optional if set in env)"
          className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-foreground outline-none ring-0 placeholder:text-muted focus:border-accent/50"
        />
        <button
          type="button"
          onClick={runIngest}
          disabled={loading}
          className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-semibold tracking-wide text-accent hover:bg-accent/15 disabled:opacity-60"
        >
          {loading ? "Ingesting..." : "Run Ingest"}
        </button>
      </div>

      {status ? (
        <p className="mt-2.5 rounded-lg border border-line bg-panel/60 px-3 py-2 text-xs text-muted">
          {status}
        </p>
      ) : null}
    </div>
  );
}
