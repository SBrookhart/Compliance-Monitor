import { useEffect, useMemo, useState } from "react";

const HIGH_VALUE_USD = 10000;

// UI defaults — tweak live in Settings (saved to your browser)
const DEFAULTS = {
  BLOCK_WINDOW: 1200,     // blocks per call (~40–45 min on Base)
  TARGET_ROWS: 50,        // stop early when we have this many rows
  CHUNK_SIZE: 300,        // blocks per getLogs
  CHUNK_DELAY_MS: 300,    // pause between log chunks
  BLOCK_TS_DELAY_MS: 150, // pause between block timestamp lookups
  MAX_RETRIES: 3,
  GENERIC_RETRY_DELAY_MS: 1200,
  RATE_LIMIT_DELAY_MS: 11000,
  CLIENT_TIMEOUT_MS: 120000, // 120s browser timeout
};

const getN = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const loadLocal = (k, fb) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; }
};
const saveLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- Settings modal ----------
function Settings({ open, onClose, settings, setSettings, onApply }) {
  const [local, setLocal] = useState(settings);
  useEffect(() => { setLocal(settings); }, [settings]);
  if (!open) return null;

  const label = { fontWeight: 600, marginTop: 10, marginBottom: 6, display: "block" };
  const input = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid #e5e7eb", fontFamily: "inherit" };
  const update = (k, v) => setLocal((s) => ({ ...s, [k]: v }));

  const handleSave = () => {
    const cleaned = {
      BLOCK_WINDOW: getN(local.BLOCK_WINDOW, DEFAULTS.BLOCK_WINDOW),
      TARGET_ROWS: getN(local.TARGET_ROWS, DEFAULTS.TARGET_ROWS),
      CHUNK_SIZE: getN(local.CHUNK_SIZE, DEFAULTS.CHUNK_SIZE),
      CHUNK_DELAY_MS: getN(local.CHUNK_DELAY_MS, DEFAULTS.CHUNK_DELAY_MS),
      BLOCK_TS_DELAY_MS: getN(local.BLOCK_TS_DELAY_MS, DEFAULTS.BLOCK_TS_DELAY_MS),
      MAX_RETRIES: getN(local.MAX_RETRIES, DEFAULTS.MAX_RETRIES),
      GENERIC_RETRY_DELAY_MS: getN(local.GENERIC_RETRY_DELAY_MS, DEFAULTS.GENERIC_RETRY_DELAY_MS),
      RATE_LIMIT_DELAY_MS: getN(local.RATE_LIMIT_DELAY_MS, DEFAULTS.RATE_LIMIT_DELAY_MS),
      CLIENT_TIMEOUT_MS: getN(local.CLIENT_TIMEOUT_MS, DEFAULTS.CLIENT_TIMEOUT_MS),
    };
    saveLocal("cm_settings", cleaned);
    setSettings(cleaned);
    onApply({ reset: true });
    onClose();
  };

  const handleReset = () => {
    saveLocal("cm_settings", DEFAULTS);
    setSettings({ ...DEFAULTS });
    onApply({ reset: true });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "#fff", borderRadius: 12, maxWidth: 720, width: "90%", padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <p style={{ color: "#6B7280", marginTop: 0 }}>Tune these if you see timeouts or rate limits. Saved to your browser only.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>Blocks per Call (window)</label>
            <input style={input} type="number" value={local.BLOCK_WINDOW} onChange={(e) => update("BLOCK_WINDOW", e.target.value)} />
          </div>
          <div>
            <label style={label}>Target Rows per Call</label>
            <input style={input} type="number" value={local.TARGET_ROWS} onChange={(e) => update("TARGET_ROWS", e.target.value)} />
          </div>
          <div>
            <label style={label}>Chunk Size (blocks per getLogs)</label>
            <input style={input} type="number" value={local.CHUNK_SIZE} onChange={(e) => update("CHUNK_SIZE", e.target.value)} />
          </div>
          <div>
            <label style={label}>Delay Between Chunks (ms)</label>
            <input style={input} type="number" value={local.CHUNK_DELAY_MS} onChange={(e) => update("CHUNK_DELAY_MS", e.target.value)} />
          </div>
          <div>
            <label style={label}>Delay Between Block Timestamps (ms)</label>
            <input style={input} type="number" value={local.BLOCK_TS_DELAY_MS} onChange={(e) => update("BLOCK_TS_DELAY_MS", e.target.value)} />
          </div>
          <div>
            <label style={label}>Max Retries</label>
            <input style={input} type="number" value={local.MAX_RETRIES} onChange={(e) => update("MAX_RETRIES", e.target.value)} />
          </div>
          <div>
            <label style={label}>Generic Retry Delay (ms)</label>
            <input style={input} type="number" value={local.GENERIC_RETRY_DELAY_MS} onChange={(e) => update("GENERIC_RETRY_DELAY_MS", e.target.value)} />
          </div>
          <div>
            <label style={label}>Rate-Limit Retry Delay (ms)</label>
            <input style={input} type="number" value={local.RATE_LIMIT_DELAY_MS} onChange={(e) => update("RATE_LIMIT_DELAY_MS", e.target.value)} />
          </div>
          <div>
            <label style={label}>Browser Request Timeout (ms)</label>
            <input style={input} type="number" value={local.CLIENT_TIMEOUT_MS} onChange={(e) => update("CLIENT_TIMEOUT_MS", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={handleReset} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
            Reset Defaults
          </button>
          <button onClick={onClose} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            Save & Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Watchlist modal ----------
function normalizeAddr(s) {
  if (!s) return "";
  const v = String(s).trim();
  if (v.startsWith("0x") && v.length === 42) return v.toLowerCase();
  return "";
}
function isAddr(s) { return /^0x[a-fA-F0-9]{40}$/.test(s || ""); }

function WatchlistEditor({ open, onClose, watchlist, setWatchlist, onApply }) {
  const [local, setLocal] = useState(watchlist.join("\n"));
  useEffect(() => { setLocal(watchlist.join("\n")); }, [watchlist]);
  if (!open) return null;

  const sample = "0x1111111111111111111111111111111111111111\n0x2222222222222222222222222222222222222222";
  const textarea = {
    width: "100%", minHeight: 180, padding: 8, borderRadius: 8,
    border: "1px solid #e5e7eb", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  };

  function handleSave() {
    const lines = local.split(/\r?\n/).map(normalizeAddr).filter(Boolean);
    const unique = Array.from(new Set(lines));
    saveLocal("cm_watchlist", unique);
    setWatchlist(unique);
    onApply(); // refresh scan (client flags are applied immediately)
    onClose();
  }

  function handleClear() {
    saveLocal("cm_watchlist", []);
    setWatchlist([]);
    onApply();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "#fff", borderRadius: 12, maxWidth: 720, width: "90%", padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        <h2 style={{ marginTop: 0 }}>Watchlist</h2>
        <p style={{ color: "#6B7280", marginTop: 0 }}>
          Paste one Ethereum/Base address per line (exact 0x…40 hex). We flag transfers where <b>From</b> or <b>To</b> matches.
        </p>
        <textarea
          style={textarea}
          value={local}
          placeholder={sample}
          onChange={(e) => setLocal(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={handleClear} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #fecaca", background: "#fff5f5", color: "#991b1b", cursor: "pointer" }}>
            Clear
          </button>
          <button onClick={onClose} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- CSV export ----------
function toCsv(rows, opts = {}) {
  const { includeFlags = true, watchlistSet = new Set() } = opts;
  const esc = (s) => {
    const v = String(s ?? "");
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const header = ["TimeUTC", "TxHash", "From", "To", "AmountUSDC", ...(includeFlags ? ["Flags"] : [])];
  const lines = [header.join(",")];
  for (const r of rows) {
    const flags = [];
    if (r.amount >= HIGH_VALUE_USD) flags.push("HighValue");
    const isWL = watchlistSet.has((r.from || "").toLowerCase()) || watchlistSet.has((r.to || "").toLowerCase());
    if (isWL) flags.push("Watchlist");
    const line = [
      esc(new Date(r.time).toISOString().replace("T", " ").slice(0, 19)),
      esc(r.hash),
      esc(r.from),
      esc(r.to),
      esc(r.amount),
      ...(includeFlags ? [esc(flags.join("|"))] : []),
    ].join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Main page ----------
export default function Home() {
  const [settings, setSettings] = useState(() => loadLocal("cm_settings", { ...DEFAULTS }));
  const [rows, setRows] = useState([]);
  const [nextCursorTo, setNextCursorTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState("");
  const [openSettings, setOpenSettings] = useState(false);

  // watchlist (client-side only)
  const [watchlist, setWatchlist] = useState(() => loadLocal("cm_watchlist", []));
  const watchlistSet = useMemo(() => new Set((watchlist || []).map((s) => s.toLowerCase())), [watchlist]);

  // Scan logic (talks to /api/scan)
  async function scan({ reset = false } = {}) {
    setLoading(true);
    setErr("");
    setDiag("");
    try {
      const cursorParam = !reset && nextCursorTo != null ? `&cursorTo=${encodeURIComponent(String(nextCursorTo))}` : "";
      const qs =
        `window=${encodeURIComponent(String(settings.BLOCK_WINDOW))}` +
        `&target=${encodeURIComponent(String(settings.TARGET_ROWS))}` +
        `&chunk=${encodeURIComponent(String(settings.CHUNK_SIZE))}` +
        `&cdelay=${encodeURIComponent(String(settings.CHUNK_DELAY_MS))}` +
        `&bdelay=${encodeURIComponent(String(settings.BLOCK_TS_DELAY_MS))}` +
        `&retries=${encodeURIComponent(String(settings.MAX_RETRIES))}` +
        `&rdelay=${encodeURIComponent(String(settings.GENERIC_RETRY_DELAY_MS))}` +
        `&ratedelay=${encodeURIComponent(String(settings.RATE_LIMIT_DELAY_MS))}` +
        `&maxms=${encodeURIComponent(String(Math.max(15000, settings.CLIENT_TIMEOUT_MS - 3000)))}` +
        cursorParam;

      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), Math.max(15000, settings.CLIENT_TIMEOUT_MS));
      const resp = await fetch(`/api/scan?${qs}`, { signal: controller.signal });
      clearTimeout(to);

      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || `Scan failed with ${resp.status}`);
      }
      const data = await resp.json();
      setNextCursorTo(data.nextCursorTo ?? null);
      setDiag(
        `Fetched ${data.rows?.length ?? 0} rows; scanned ~${(data.scannedBlocks || 0).toLocaleString()} blocks. ` +
        (data.info?.partial ? "Partial (time-boxed)." : "Complete window.")
      );
      setRows((prev) => (reset ? (data.rows || []) : [...prev, ...(data.rows || [])]));
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { scan({ reset: true }); /* on first load */ }, []); // eslint-disable-line

  const hasData = useMemo(() => rows.length > 0, [rows]);

  // Derive flagged rows (client-side flags)
  const flaggedRows = useMemo(() => {
    return rows.map((r) => {
      const isWL =
        watchlistSet.has((r.from || "").toLowerCase()) ||
        watchlistSet.has((r.to || "").toLowerCase());
      return {
        ...r,
        flaggedLarge: r.amount >= HIGH_VALUE_USD,
        flaggedWatchlist: isWL,
      };
    });
  }, [rows, watchlistSet]);

  // Export current visible rows to CSV
  function handleExportCsv() {
    const csv = toCsv(flaggedRows, { includeFlags: true, watchlistSet });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadCsv(`compliance-monitor_${ts}.csv`, csv);
  }

  // Modal toggles
  const [openWatchlist, setOpenWatchlist] = useState(false);

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Live on-chain scan of recent <b>USDC</b> transfers on <b>Base</b>. Flags high-value (≥{HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setOpenSettings(true)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
          ⚙️ Settings
        </button>
        <button onClick={() => scan({ reset: true })} disabled={loading} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
          {loading ? "Scanning…" : "Refresh (newest)"}
        </button>
        <button onClick={() => scan({ reset: false })} disabled={loading || nextCursorTo == null} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: nextCursorTo == null ? "not-allowed" : "pointer" }}>
          Load more (older)
        </button>
        <button onClick={() => setOpenWatchlist(true)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
          👁️ Watchlist
        </button>
        <button onClick={handleExportCsv} disabled={!hasData} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: hasData ? "#0f766e" : "#94a3b8", color: "#fff", cursor: hasData ? "pointer" : "not-allowed", fontWeight: 600 }}>
          ⬇️ Export CSV
        </button>
      </div>

      {watchlist.length > 0 ? (
        <div style={{ marginBottom: 12, color: "#374151", fontSize: 14 }}>
          <b>Watchlist:</b> {watchlist.map((a) => a.slice(0, 8) + "…" + a.slice(-6)).join(", ")}
        </div>
      ) : (
        <div style={{ marginBottom: 12, color: "#6b7280", fontSize: 14 }}>
          No watchlist set. Click <b>👁️ Watchlist</b> to add addresses to monitor.
        </div>
      )}

      {err ? (
        <div style={{ padding: 12, background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 8, marginBottom: 12, whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      ) : null}

      {!err && diag ? (
        <div style={{ padding: 10, background: "#F0FDF4", color: "#166534", border: "1px solid #BBF7D0", borderRadius: 8, marginBottom: 12 }}>
          {diag}
        </div>
      ) : null}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 8 }}>Time (UTC)</th>
                <th style={{ padding: 8 }}>Tx</th>
                <th style={{ padding: 8 }}>From</th>
                <th style={{ padding: 8 }}>To</th>
                <th style={{ padding: 8 }}>Amount (USDC)</th>
                <th style={{ padding: 8 }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {hasData ? (
                flaggedRows.map((tx, i) => (
                  <tr key={`${tx.hash}-${i}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 8 }}>
                      {new Date(tx.time).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td style={{ padding: 8 }}>
                      <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontWeight: 600 }}>
                        {tx.hash.slice(0, 10)}…
                      </a>
                    </td>
                    <td style={{ padding: 8 }}>{tx.from.slice(0, 10)}…</td>
                    <td style={{ padding: 8 }}>{tx.to.slice(0, 10)}…</td>
                    <td style={{ padding: 8 }}>{tx.amount.toLocaleString()}</td>
                    <td style={{ padding: 8 }}>
                      {tx.flaggedLarge ? (
                        <span style={{ color: "#b91c1c", fontWeight: 700 }}>High&nbsp;Value&nbsp;</span>
                      ) : null}
                      {tx.flaggedWatchlist ? (
                        <span style={{ color: "#b45309", fontWeight: 700 }}>Watchlist</span>
                      ) : null}
                      {!tx.flaggedLarge && !tx.flaggedWatchlist ? (
                        <span style={{ color: "#6b7280" }}>—</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "#6b7280" }}>
                    No transfers returned in this slice. Use ⚙️ Settings to widen the window or “Load more (older)”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "24px 0", borderColor: "#e5e7eb" }} />
      <small style={{ color: "#6b7280" }}>
        Demo only. For production compliance, add vetted lists, case management, and audit trails.
      </small>

      {/* Modals */}
      <Settings
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        settings={settings}
        setSettings={setSettings}
        onApply={scan}
      />
      <WatchlistEditor
        open={openWatchlist}
        onClose={() => setOpenWatchlist(false)}
        watchlist={watchlist}
        setWatchlist={setWatchlist}
        onApply={() => { /* no re-scan necessary; flags update immediately */ }}
      />
    </div>
  );
}
