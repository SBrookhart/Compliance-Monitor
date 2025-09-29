import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";

// ====== Config you can tweak ======
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const USDC_DECIMALS = 6;
const HIGH_VALUE_USD = 10000; // flag threshold
const WATCHLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];
// History window: Base ~2s blocks → 3600 ≈ ~2 hours
const BLOCK_WINDOW = 3600;

// Provider limits: keep chunks modest to avoid "block range too large"
const CHUNK_SIZE = 600;

// Throttle between chunk calls (ms) to avoid 429s
const CHUNK_DELAY_MS = 250;

// Throttle between per-block timestamp requests (ms)
const BLOCK_TS_DELAY_MS = 120;

// Retry/backoff settings
const MAX_RETRIES = 3;
const GENERIC_RETRY_DELAY_MS = 1500; // for transient errors
const RATE_LIMIT_DELAY_MS = 11000;   // provider says "retry in 10s" → wait 11s
// ==================================

// Primary + optional fallback RPCs via Vercel env
// NEXT_PUBLIC_ANKR_BASE_RPC = https://rpc.ankr.com/base/<YOUR_KEY>
// NEXT_PUBLIC_FALLBACK_BASE_RPC = https://developer-access-mainnet.base.org
const PRIMARY_RPC = process.env.NEXT_PUBLIC_ANKR_BASE_RPC;
const FALLBACK_RPC = process.env.NEXT_PUBLIC_FALLBACK_BASE_RPC;

function makeClient(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return createPublicClient({
    chain: base,
    // Disable viem's http batching to avoid bundling multiple calls into one burst
    transport: http(url, { batch: false }),
  });
}

const clients = [makeClient(PRIMARY_RPC), makeClient(FALLBACK_RPC)].filter(Boolean);

// ERC-20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// ---- Utility helpers ----
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(e) {
  const msg = String(e?.message || e).toLowerCase();
  return (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("exhausted")
  );
}

async function withRetry(fn, { label = "rpc", retries = MAX_RETRIES } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const is429 = isRateLimitError(e);
      const delay = is429 ? RATE_LIMIT_DELAY_MS : GENERIC_RETRY_DELAY_MS;
      // On final attempt, break
      if (i === retries) break;
      // Wait, then retry
      // eslint-disable-next-line no-console
      console.warn(`[${label}] attempt ${i + 1} failed: ${e?.message || e}. Retrying in ${Math.round(delay/1000)}s…`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Try each client in order (primary → fallback) with per-client retries
async function withClient(fn, { label }) {
  if (clients.length === 0) {
    throw new Error(
      "No RPC configured. Set NEXT_PUBLIC_ANKR_BASE_RPC (and optional NEXT_PUBLIC_FALLBACK_BASE_RPC) in Vercel."
    );
  }

  let lastErr;
  for (let idx = 0; idx < clients.length; idx++) {
    const c = clients[idx];
    try {
      return await withRetry(() => fn(c), { label });
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(`[${label}] client ${idx + 1} failed: ${e?.message || e}`);
      // If not last client, try next after a short pause
      if (idx < clients.length - 1) await sleep(1000);
    }
  }
  throw lastErr;
}

// ---- Core fetchers ----

// Fetch logs in small chunks to satisfy provider limits and avoid 429s
async function getLogsChunked({ address, event, fromBlock, toBlock }) {
  const all = [];
  let start = fromBlock < toBlock ? fromBlock : toBlock;
  let end = toBlock > fromBlock ? toBlock : fromBlock;
  const step = BigInt(CHUNK_SIZE);
  let cursor = start;

  while (cursor <= end) {
    const chunkFrom = cursor;
    const chunkTo = (() => {
      const next = cursor + step - 1n;
      return next > end ? end : next;
    })();

    const part = await withClient(
      (client) =>
        client.getLogs({
          address,
          event,
          fromBlock: chunkFrom,
          toBlock: chunkTo,
        }),
      { label: `getLogs ${chunkFrom}-${chunkTo}` }
    );

    if (part.length) all.push(...part);
    cursor = chunkTo + 1n;

    // Gentle pacing between chunks
    await sleep(CHUNK_DELAY_MS);
  }

  return all;
}

async function fetchRecentTransfers() {
  // Determine range
  const latest = await withClient((client) => client.getBlockNumber(), {
    label: "getBlockNumber",
  });

  const fromBlock =
    latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

  // Logs (chunked)
  const logs = await getLogsChunked({
    address: getAddress(USDC_CONTRACT),
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: latest,
  });

  if (!logs.length) {
    return { rows: [], scannedBlocks: Number(latest - fromBlock) };
  }

  // Unique block hashes → timestamps (serial with gentle pacing to avoid 429)
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockHash))];
  const blockMap = new Map();

  for (const bh of uniqueBlocks) {
    const block = await withClient(
      (client) => client.getBlock({ blockHash: bh }),
      { label: "getBlock" }
    );
    blockMap.set(bh, Number(block.timestamp) * 1000);
    await sleep(BLOCK_TS_DELAY_MS);
  }

  // Shape rows
  const wl = WATCHLIST.map((a) => a.toLowerCase());
  const rows = logs.map((l) => {
    const from = l.args.from;
    const to = l.args.to;
    const amount = Number(formatUnits(l.args.value, USDC_DECIMALS));
    const flaggedLarge = amount >= HIGH_VALUE_USD;
    const flaggedWatchlist =
      wl.includes(from.toLowerCase()) || wl.includes(to.toLowerCase());
    const time = blockMap.get(l.blockHash) ?? Date.now();

    return {
      time,
      hash: l.transactionHash,
      from,
      to,
      amount,
      flaggedLarge,
      flaggedWatchlist,
    };
  });

  rows.sort((a, b) => b.time - a.time);
  return { rows, scannedBlocks: Number(latest - fromBlock) };
}

// ---- Page component ----

export default function Home() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr("");
      setDiag("");
      try {
        if (!PRIMARY_RPC) {
          throw new Error(
            "Missing NEXT_PUBLIC_ANKR_BASE_RPC. Set it in Vercel to your Ankr URL (e.g., https://rpc.ankr.com/base/XXXX)."
          );
        }
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error("RPC timeout after 45s")), 45000)
        );
        const { rows: data, scannedBlocks } = await Promise.race([
          fetchRecentTransfers(),
          timeout,
        ]);
        setRows(data);
        const which = clients
          .map((c, i) => (i === 0 ? "primary" : "fallback"))
          .join("→");
        setDiag(
          `Scanned ~${scannedBlocks.toLocaleString()} blocks on Base (chunks of ${CHUNK_SIZE}); clients: ${which}.`
        );
      } catch (e) {
        console.error("RPC error:", e);
        setErr(
          String(e?.message || e) +
            (!PRIMARY_RPC
              ? " | Hint: set NEXT_PUBLIC_ANKR_BASE_RPC in Vercel."
              : FALLBACK_RPC
              ? ""
              : " | Optional: set NEXT_PUBLIC_FALLBACK_BASE_RPC for failover.")
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <div
      style={{
        maxWidth: 980,
        margin: "40px auto",
        padding: 16,
        fontFamily: "ui-sans-serif, system-ui",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>
        Stablecoin Compliance Monitor
      </h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Live on-chain scan of recent <b>USDC</b> transfers on <b>Base</b>. Flags
        high-value (≥{HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      {err ? (
        <div
          style={{
            padding: 12,
            background: "#FEF2F2",
            color: "#991B1B",
            border: "1px solid #FECACA",
            borderRadius: 8,
            marginBottom: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {err}
        </div>
      ) : null}

      {!err && diag ? (
        <div
          style={{
            padding: 10,
            background: "#F0FDF4",
            color: "#166534",
            border: "1px solid #BBF7D0",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {diag}
        </div>
      ) : null}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
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
                      {new Date(tx.time)
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}
                    </td>
                    <td style={{ padding: 8 }}>
                      <a
                        href={`https://basescan.org/tx/${tx.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 600 }}
                      >
                        {tx.hash.slice(0, 10)}…
                      </a>
                    </td>
                    <td style={{ padding: 8 }}>{tx.from.slice(0, 10)}…</td>
                    <td style={{ padding: 8 }}>{tx.to.slice(0, 10)}…</td>
                    <td style={{ padding: 8 }}>
                      {tx.amount.toLocaleString()}
                    </td>
                    <td style={{ padding: 8 }}>
                      {tx.flaggedLarge ? (
                        <span style={{ color: "#b91c1c", fontWeight: 700 }}>
                          High&nbsp;Value&nbsp;
                        </span>
                      ) : null}
                      {tx.flaggedWatchlist ? (
                        <span style={{ color: "#b45309", fontWeight: 700 }}>
                          Watchlist
                        </span>
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
                    No transfers in the scanned window. Try widening it
                    (increase BLOCK_WINDOW) or lower CHUNK_SIZE to be extra
                    gentle with your provider.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "24px 0", borderColor: "#e5e7eb" }} />
      <small style={{ color: "#6b7280" }}>
        Demo only. For production compliance, add vetted lists, case management,
        and audit trails.
      </small>
    </div>
  );
}
