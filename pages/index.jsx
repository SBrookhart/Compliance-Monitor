import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";

// ====== Config ======
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const USDC_DECIMALS = 6;
const HIGH_VALUE_USD = 10000; // flag threshold
const WATCHLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];
// Base ~2s blocks → 3600 blocks ≈ ~2 hours
const BLOCK_WINDOW = 3600;
// =====================

// Public RPC (reliable endpoint)
const client = createPublicClient({
  chain: base,
  transport: http("https://rpc.ankr.com/base"),
});

// ERC-20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

async function fetchRecentTransfers() {
  const latest = await client.getBlockNumber();
  const fromBlock =
    latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

  // 1) Fetch logs for Transfer events
  const logs = await client.getLogs({
    address: getAddress(USDC_CONTRACT),
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: latest,
  });

  if (!logs.length) return [];

  // 2) Fetch timestamps per unique block (batch fetch by hash)
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockHash))];
  const blockMap = new Map();
  await Promise.all(
    uniqueBlocks.map(async (bh) => {
      const block = await client.getBlock({ blockHash: bh });
      blockMap.set(bh, Number(block.timestamp) * 1000); // ms
    })
  );

  // 3) Shape rows
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
  return rows;
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
        // Add a 10s timeout so we don’t hang forever
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const data = await fetchRecentTransfers();
        clearTimeout(timeout);

        setRows(data);
        setDiag(
          `Scanned ~${BLOCK_WINDOW.toLocaleString()} recent blocks on Base (≈ ${(
            (BLOCK_WINDOW * 2) /
            60
          ).toFixed(1)} minutes).`
        );
      } catch (e) {
        console.error("RPC error:", e);
        setErr(e.message || "Failed to fetch logs.");
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
                    No transfers in the scanned window. Try widening it.
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
