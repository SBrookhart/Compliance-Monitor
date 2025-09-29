import { useEffect, useMemo, useState } from "react";

// Flags (client display only)
const HIGH_VALUE_USD = 10000;

// Defaults for UI Settings (sent to API as query params)
const DEFAULTS = {
  BLOCK_WINDOW: 2400,     // ~80 min
  CHUNK_SIZE: 400,
  CHUNK_DELAY_MS: 400,
  BLOCK_TS_DELAY_MS: 200,
  MAX_RETRIES: 3,
  GENERIC_RETRY_DELAY_MS: 1500,
  RATE_LIMIT_DELAY_MS: 11000,
};

function loadLocal(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } }
function saveLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
function toNumber(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; }

function Settings({ open, onClose, settings, setSettings, onApply }) {
  const [local, setLocal] = useState(settings);
  useEffect(() => { setLocal(settings); }, [settings]);
  if (!open) return null;

  const label = { fontWeight: 600, marginTop: 10, marginBottom: 6, display: "block" };
  const input = { width: "100%", padding: 8, borderRadius: 8, border: "1px solid #e5e7eb", fontFamily: "inherit" };

  function update(k, v) { setLocal((s) => ({ ...s, [k]: v })); }
  function handleSave() {
    const cleaned = {
      BLOCK_WINDOW: toNumber(local.BLOCK_WINDOW, DEFAULTS.BLOCK_WINDOW),
      CHUNK_SIZE: toNumber(local.CHUNK_SIZE, DEFAULTS.CHUNK_SIZE),
      CHUNK_DELAY_MS: toNumber(local.CHUNK_DELAY_MS, DEFAULTS.CHUNK_DELAY_MS),
      BLOCK_TS_DELAY_MS: toNumber(local.BLOCK_TS_DELAY_MS, DEFAULTS.BLOCK_TS_DELAY_MS),
      MAX_RETRIES: toNumber(local.MAX_RETRIES, DEFAULTS.MAX_RETRIES),
      GENERIC_RETRY_DELAY_MS: toNumber(local.GENERIC_RETRY_DELAY_MS, DEFAULTS.GENERIC_RETRY_DELAY_MS),
      RATE_LIMIT_DELAY_MS: toNumber(local.RATE_LIMIT_DELAY_MS, DEFAULTS.RATE_LIMIT_DELAY_MS),
    };
    saveLocal("cm_settings", cleaned);
    setSettings(cleaned);
    onApply();
    onClose();
  }
  function handleReset() {
    saveLocal("cm_settings", DEFAULTS);
    setSettings({ ...DEFAULTS });
    onApply();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "#fff", borderRadius: 12, maxWidth: 700, width: "90%", padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <p style={{ color: "#6b7280", marginTop: 0 }}>Tune these if you see timeouts or rate limits. Saved only in your browser.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={label}>Block Window (blocks)</label>
            <input style={input} type="number" value={local.BLOCK_WINDOW} onChange={(e) => update("BLOCK_WINDOW", e.target.value)} />
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
            <label style={label}>Delay Between Block Timestamp Calls (ms)</label>
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
            <label style={label}>Rate Limit Retry Delay (ms)</label>
            <input style={input} type="number" value={local.RATE_LIMIT_DELAY_MS} onChange={(e) => update("RATE_LIMIT_DELAY_MS", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={handleReset} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>Reset Defaults</button>
          <button onClick={onClose} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Save & Refresh</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [settings, setSettings] = useState(() => loadLocal("cm_settings", { ...DEFAULTS }));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState("");
  const [openSettings, setOpenSettings] = useState(false);

  async function runScan() {
    setLoading(true);
    setErr("");
    setDiag("");
    try {
      const params = new URLSearchParams({
        window: String(settings.BLOCK_WINDOW),
        chunk: String(settings.CHUNK_SIZE),
        cdelay: String(settings.CHUNK_DELAY_MS),
        bdelay: String(settings.BLOCK_TS_DELAY_MS),
        retries: String(settings.MAX_RETRIES),
        rdelay: String(settings.GENERIC_RETRY_DELAY_MS),
        ratedelay: String(settings.RATE_LIMIT_DELAY_MS),
      });
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 60000); // 60s client cap
      const resp = await fetch(`/api/scan?${params.toString()}`, { signal: controller.signal });
      clearTimeout(to);

      if (!resp.ok) {
        const problem = await resp.json().catch(() => ({}));
        throw new Error(problem?.error || `Scan failed with ${resp.status}`);
      }
      const data = await resp.json();
      setRows(data.rows || []);
      setDiag(`Scanned ~${(data.scannedBlocks || 0).toLocaleString()} blocks (chunk ${settings.CHUNK_SIZE}).`);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runScan(); /* on mount */ }, []); // eslint-disable-line

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Live on-chain scan of recent <b>USDC</b> transfers on <b>Base</b>. Flags high-value (≥{HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setOpenSettings(true)} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
          ⚙️ Settings
        </button>
        <button onClick={runScan} disabled={loading} style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </div>

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
                rows.map((tx, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
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
                      {tx.amount >= HIGH_VALUE_USD ? (
                        <span style={{ color: "#b91c1c", fontWeight: 700 }}>High&nbsp;Value&nbsp;</span>
                      ) : null}
                      {/* Watchlist UI not wired yet on client (server returns from/to) */}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "#6b7280" }}>
                    No transfers in the scanned window. Use ⚙️ Settings to widen the window or adjust chunking.
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

      <Settings
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        settings={settings}
        setSettings={setSettings}
        onApply={runScan}
      />
    </div>
  );
}
