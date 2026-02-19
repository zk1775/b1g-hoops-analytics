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
    <div className="space-y-2">
      <input
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="ADMIN_TOKEN (optional)"
        className="w-full rounded border border-black/20 px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={runIngest}
        disabled={loading}
        className="rounded border border-black/20 px-3 py-2 text-sm font-medium hover:bg-black/5 disabled:opacity-60"
      >
        {loading ? "Ingesting..." : "Run Ingest"}
      </button>
      {status ? <p className="text-sm text-black/70">{status}</p> : null}
    </div>
  );
}
