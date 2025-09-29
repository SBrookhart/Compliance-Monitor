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
  // Put full 0x addresses you want to monitor
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];
// Base ~2s blocks → 3600 blocks ≈ ~2 hours. Increase for a wider window.
const BLOCK_WINDOW = 3600;

// Some RPCs limit eth_getLogs range. Keep chunks small to avoid errors.
// If you still see "Block range is too large", reduce CHUNK_SIZE further (e.g., 500).
const CHUNK_SIZE = 800;
// ==================================

// Your Ankr RPC URL comes from Vercel env:
// NEXT_PUBLIC_ANKR_BASE_RPC = https://rpc.ankr.com/base/<YOUR_KEY>
const ANKR_RPC = process.env.NEXT_PUBLIC_ANKR_BASE_RPC;

// Build a client lazily so we can show nice errors if env var is missing
function getClient() {
  if (!ANKR_RPC || !/^https?:\/\//i.test(ANKR_RPC)) {
    throw new Error(
      "Missing NEXT_PUBLIC_ANKR_BASE_RPC. In Vercel, set it to your Ankr URL (e.g., https://rpc.ankr.com/base/XXXX)."
    );
  }
  return createPublicClient({
    chain: base,
    transport: http(ANKR_RPC, { batch: true }),
  });
}

// ERC-20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

/**
 * Fetch logs in small chunks to satisfy provider limits.
 * Returns an array of viem log objects.
 */
async function getLogsChunked({ client, address, event, fromBlock, toBlock }) {
  const logs = [];
  // Guard: if from > to (weird clock skew), swap
  let start = fromBlock < toBlock ? fromBlock : toBlock;
  let end = toBlock > fromBlock ? toBlock : fromBlock;

  const step = BigInt(CHUNK_SIZE);
  let cursor = start;

  while (cursor <= end) {
    const chunkFrom = cursor;
    // inclusive range; subtract 1 then add 1 is messy—keep inclusive and clamp.
    const next = cursor + step - 1n;
    const chunkTo = next > end ? end : next;

    // Call provider for this chunk
    // If provider still complains, reduce CHUNK_SIZE above.
    const part = await client.getLogs({
      address,
      event,
      fromBlock: chunkFrom,
      toBlock: chunkTo,
    });

    if (part.length) logs.push(...part);

    // Move to next block after this chunk
    cursor = chunkTo + 1n;
  }

  return logs;
}

async function fetchRecentTransfers() {
  const client = getClient();

  // 1) Figure out the recent block range
  const latest = await client.getBlockNumber();
  const fromBlock =
    latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

  // 2) Get Transfer logs for USDC in that range (chunked to avoid provider limits)
  const logs = await getLogsChunked({
    client,
    address: getAddress(USDC_CONTRACT),
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: latest,
  });

  if (!logs.length) return { rows: [], scannedBlocks: Number(latest - fromBlock) };

  // 3) Fetch timestamps for unique blocks (batch by block hash)
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockHash))];
  const blockMap = new Map();
  await Promise.all(
    uniqueBlocks.map(async (bh) => {
      const block = await client.getBlock({ blockHash: bh });
      blockMap.set(bh, Number(block.timestamp) * 1000); // ms
    })
  );

  // 4) Shape rows
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
        // Soft timeout guard (if your RPC is unreachable)
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error("RPC timeout after 20s")), 20000)
        );
        const { rows: data, scannedBlocks } = await Promise.race([
          fetchRecentTransfers(),
          timeout,
        ]);
        setRows(data);
        setDiag(
          `Scanned ~${scannedBlocks.toLocaleString()} blocks on Base (chunks of ${CHUNK_SIZE}).`
        );
      } catch (e) {
        console.error("RPC error:", e);
        setErr(
          String(e?.message || e) +
            (ANKR_RPC
              ? ""
              : " | Hint: set NEXT_PUBLIC_ANKR_BASE_RPC in Vercel to your Ankr URL.")
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
                    No transfers in the scanned window. Try widening it (increase
                    BLOCK_WINDOW) or reduce CHUNK_SIZE if your provider limits
                    ranges further.
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
