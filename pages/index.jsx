import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";

// ====== App constants you probably won't need to change ======
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const USDC_DECIMALS = 6;
const HIGH_VALUE_USD = 10000; // flag threshold
const DEFAULTS = {
  BLOCK_WINDOW: 2400,     // ~80 minutes (Base ~2s blocks). Safer than 3600 for rate limits.
  CHUNK_SIZE: 400,        // smaller chunks = friendlier to providers
  CHUNK_DELAY_MS: 400,    // pause between chunk calls
  BLOCK_TS_DELAY_MS: 200, // pause between per-block timestamp calls
  MAX_RETRIES: 3,
  GENERIC_RETRY_DELAY_MS: 1500,
  RATE_LIMIT_DELAY_MS: 11000,
};
// Environment-provided RPCs (primary required, fallback optional)
const ENV_PRIMARY = process.env.NEXT_PUBLIC_ANKR_BASE_RPC || "";
const ENV_FALLBACK = process.env.NEXT_PUBLIC_FALLBACK_BASE_RPC || "";
// =============================================================

// --- Tiny helpers ---
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function isRateLimitError(e) {
  const msg = String(e?.message || e).toLowerCase();
  return msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("exhausted");
}
function isUrl(s) { return /^https?:\/\//i.test(s || ""); }
function toNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function saveLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
function loadLocal(k, fallback) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
}

// ERC-20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Build clients from a list of URLs (primary first, then fallback)
function makeClient(url) {
  if (!isUrl(url)) return null;
  return createPublicClient({
    chain: base,
    // No batching to avoid bursts that trigger provider rate limits
    transport: http(url, { batch: false }),
  });
}

// ---- Core fetch logic (uses provided settings) ----
async function withRetry(fn, opts, label = "rpc") {
  const { MAX_RETRIES, GENERIC_RETRY_DELAY_MS, RATE_LIMIT_DELAY_MS } = opts;
  let lastErr;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const is429 = isRateLimitError(e);
      const delay = is429 ? RATE_LIMIT_DELAY_MS : GENERIC_RETRY_DELAY_MS;
      if (i === MAX_RETRIES) break;
      // eslint-disable-next-line no-console
      console.warn(`[${label}] attempt ${i + 1} failed: ${e?.message || e}. Retrying in ${Math.round(delay/1000)}s…`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function withClients(urls, fn, opts, label) {
  const clients = urls.map(makeClient).filter(Boolean);
  if (!clients.length) {
    throw new Error(
      "No RPC configured. Set NEXT_PUBLIC_ANKR_BASE_RPC in Vercel (and optionally NEXT_PUBLIC_FALLBACK_BASE_RPC), or provide a fallback in Settings."
    );
  }

  let lastErr;
  for (let idx = 0; idx < clients.length; idx++) {
    try {
      return await withRetry(() => fn(clients[idx]), opts, label);
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(`[${label}] client ${idx + 1} failed: ${e?.message || e}`);
      if (idx < clients.length - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

async function getLogsChunked({ urls, address, event, fromBlock, toBlock, opts }) {
  const { CHUNK_SIZE, CHUNK_DELAY_MS } = opts;
  const all = [];
  let start = fromBlock < toBlock ? fromBlock : toBlock;
  let end = toBlock > fromBlock ? toBlock : fromBlock;
  const step = BigInt(CHUNK_SIZE);
  let cursor = start;

  while (cursor <= end) {
    const chunkFrom = cursor;
    const next = cursor + step - 1n;
    const chunkTo = next > end ? end : next;

    const part = await withClients(
      urls,
      (client) => client.getLogs({ address, event, fromBlock: chunkFrom, toBlock: chunkTo }),
      opts,
      `getLogs ${chunkFrom}-${chunkTo}`
    );
    if (part.length) all.push(...part);
    cursor = chunkTo + 1n;

    await sleep(CHUNK_DELAY_MS);
  }

  return all;
}

async function fetchRecentTransfers(urls, settings) {
  const {
    BLOCK_WINDOW, BLOCK_TS_DELAY_MS,
  } = settings;

  // Determine range
  const latest = await withClients(urls, (c) => c.getBlockNumber(), settings, "getBlockNumber");
  const fromBlock = latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

  // Logs (chunked)
  const logs = await getLogsChunked({
    urls,
    address: getAddress(USDC_CONTRACT),
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: latest,
    opts: settings,
  });

  if (!logs.length) return { rows: [], scannedBlocks: Number(latest - fromBlock) };

  // Unique block hashes → timestamps (serial, throttled)
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockHash))];
  const blockMap = new Map();
  for (const bh of uniqueBlocks) {
    const block = await withClients(urls, (c) => c.getBlock({ blockHash: bh }), settings, "getBlock");
    blockMap.set(bh, Number(block.timestamp) * 1000);
    await sleep(BLOCK_TS_DELAY_MS);
  }

  // Shape rows
  const rows = logs.map((l) => {
    const from = l.args.from;
    const to = l.args.to;
    const amount = Number(formatUnits(l.args.value, USDC_DECIMALS));
    const flaggedLarge = amount >= HIGH_VALUE_USD;
    const flaggedWatchlist = false; // simple for now; wire in a UI list later if you want
    const time = blockMap.get(l.blockHash) ?? Date.now();
    return { time, hash: l.transactionHash, from, to, amount, flaggedLarge, flaggedWatchlist };
  });

  rows.sort((a, b) => b.time - a.time);
  return { rows, scannedBlocks: Number(latest - fromBlock) };
}

// ---- UI: Settings Drawer (local-only; no backend) ----
function Settings({ open, onClose, settings, setSettings, urls, setUrls, onApply }) {
  const [local, setLocal] = useState(settings);
  const [localUrls, setLocalUrls] = useState(urls);

  useEffect(() => { setLocal(settings); }, [settings]);
  useEffect(() => { setLocalUrls(urls); }, [urls]);

  if (!open) return null;

  function updateField(k, v) { setLocal((s) => ({ ...s, [k]: v })); }
  function updateUrl(k, v) { setLocalUrls((u) => ({ ...u, [k]: v })); }

  function handleSave() {
    // sanitize numbers
    const cleaned = {
      ...local,
      BLOCK_WINDOW: toNumber(local.BLOCK_WINDOW, DEFAULTS.BLOCK_WINDOW),
      CHUNK_SIZE: toNumber(local.CHUNK_SIZE, DEFAULTS.CHUNK_SIZE),
      CHUNK_DELAY_MS: toNumber(local.CHUNK_DELAY_MS, DEFAULTS.CHUNK_DELAY_MS),
      BLOCK_TS_DELAY_MS: toNumber(local.BLOCK_TS_DELAY_MS, DEFAULTS.BLOCK_TS_DELAY_MS),
      MAX_RETRIES: toNumber(local.MAX_RETRIES, DEFAULTS.MAX_RETRIES),
      GENERIC_RETRY_DELAY_MS: toNumber(local.GENERIC_RETRY_DELAY_MS, DEFAULTS.GENERIC_RETRY_DELAY_MS),
      RATE_LIMIT_DELAY_MS: toNumber(local.RATE_LIMIT_DELAY_MS, DEFAULTS.RATE_LIMIT_DELAY_MS),
    };
    const urlsClean = {
      primary: localUrls.primary,
      fallback: localUrls.fallback,
    };
    saveLocal("cm_settings", cleaned);
    saveLocal("cm_urls", urlsClean);
    setSettings(cleaned);
    setUrls(urlsClean);
    onApply();
    onClose();
  }

  function handleReset() {
    const reset = { ...DEFAULTS };
    const urlsReset = { primary: ENV_PRIMARY, fallback: ENV_FALLBACK };
    saveLocal("cm_settings", reset);
    saveLocal("cm_urls", urlsReset);
    setSettings(reset);
    setUrls(urlsReset);
    onApply();
    onClose();
  }

  const inputStyle = {
    width: "100%", padding: 8, borderRadius: 8, border: "1px solid #e5e7eb", fontFamily: "inherit"
  };
  const labelStyle = { fontWeight: 600, marginTop: 10, marginBottom: 6, display: "block" };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div style={{ background: "#fff", borderRadius: 12, maxWidth: 700, width: "90%", padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <p style={{ color: "#6b7280", marginTop: 0 }}>
          Tweak these if you see timeouts or rate limits. Changes are saved to your browser only.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Primary RPC URL</label>
            <input
              style={inputStyle}
              value={localUrls.primary}
              onChange={(e) => updateUrl("primary", e.target.value)}
              placeholder="https://rpc.ankr.com/base/your_key"
            />
          </div>
          <div>
            <label style={labelStyle}>Fallback RPC URL (optional)</label>
            <input
              style={inputStyle}
              value={localUrls.fallback}
              onChange={(e) => updateUrl("fallback", e.target.value)}
              placeholder="https://developer-access-mainnet.base.org"
            />
          </div>

          <div>
            <label style={labelStyle}>Block Window (blocks)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.BLOCK_WINDOW}
              onChange={(e) => updateField("BLOCK_WINDOW", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Chunk Size (blocks per getLogs)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.CHUNK_SIZE}
              onChange={(e) => updateField("CHUNK_SIZE", e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Delay Between Chunks (ms)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.CHUNK_DELAY_MS}
              onChange={(e) => updateField("CHUNK_DELAY_MS", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Delay Between Block Timestamp Calls (ms)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.BLOCK_TS_DELAY_MS}
              onChange={(e) => updateField("BLOCK_TS_DELAY_MS", e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Max Retries</label>
            <input
              style={inputStyle}
              type="number"
              value={local.MAX_RETRIES}
              onChange={(e) => updateField("MAX_RETRIES", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Generic Retry Delay (ms)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.GENERIC_RETRY_DELAY_MS}
              onChange={(e) => updateField("GENERIC_RETRY_DELAY_MS", e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Rate Limit Retry Delay (ms)</label>
            <input
              style={inputStyle}
              type="number"
              value={local.RATE_LIMIT_DELAY_MS}
              onChange={(e) => updateField("RATE_LIMIT_DELAY_MS", e.target.value)}
            />
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

// ---- Page component ----
export default function Home() {
  // load settings/urls from localStorage or defaults/env
  const [settings, setSettings] = useState(() =>
    loadLocal("cm_settings", { ...DEFAULTS })
  );
  const [urls, setUrls] = useState(() =>
    loadLocal("cm_urls", { primary: ENV_PRIMARY, fallback: ENV_FALLBACK })
  );

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
      if (!isUrl(urls.primary)) {
        throw new Error(
          "Missing/invalid Primary RPC. In Vercel set NEXT_PUBLIC_ANKR_BASE_RPC, or open Settings and paste a valid URL."
        );
      }
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("RPC timeout after 60s")), 60000));
      const urlList = [urls.primary, urls.fallback].filter(isUrl);

      const { rows: data, scannedBlocks } = await Promise.race([
        fetchRecentTransfers(urlList, settings),
        timeout,
      ]);

      setRows(data);
      setDiag(
        `Scanned ~${scannedBlocks.toLocaleString()} blocks (chunk ${settings.CHUNK_SIZE}, delays ${settings.CHUNK_DELAY_MS}/${settings.BLOCK_TS_DELAY_MS} ms).`
      );
    } catch (e) {
      console.error("RPC error:", e);
      setErr(
        String(e?.message || e) +
          (!isUrl(urls.fallback) ? " | Tip: Add a fallback RPC in Settings." : "")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { runScan(); /* run on mount */ }, []); // eslint-disable-line

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Live on-chain scan of recent <b>USDC</b> transfers on <b>Base</b>. Flags high-value (≥{HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      {/* Controls */}
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
                    No transfers in the scanned window. Use ⚙️ Settings to widen the window,
                    or reduce chunk size / add a fallback RPC for reliability.
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
        urls={urls}
        setUrls={setUrls}
        onApply={runScan}
      />
    </div>
  );
}
