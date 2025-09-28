import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";

// USDC on Base (official)
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

// ERC-20 Transfer(address,address,uint256) topic
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ==== Customize these ====
const HIGH_VALUE_USD = 10000; // flag transfers >= $10,000 (USDC ~ $1)
const WATCHLIST = [
  // Put full 0x addresses here (lower/upper case OK)
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222"
];
// =========================

const API_KEY = process.env.NEXT_PUBLIC_BASESCAN_KEY;

/**
 * Helper to call the BaseScan API
 */
async function basescan(pathAndQuery) {
  const res = await fetch(`https://api.basescan.org/api${pathAndQuery}`);
  const data = await res.json();
  // Etherscan-family APIs use { status: "1" | "0", message: "OK" | "NOTOK" }
  if (!data || data.status === "0") {
    const msg = data?.message || "NOTOK";
    throw new Error(msg);
  }
  return data.result;
}

/**
 * Get a block number near a timestamp (seconds) using Etherscan-style API.
 * closest: "before" | "after"
 */
async function getBlockNoByTime(tsSeconds, closest) {
  const q = `?module=block&action=getblocknobytime&timestamp=${tsSeconds}&closest=${closest}&apikey=${API_KEY}`;
  const result = await basescan(q);
  // result is a decimal string
  return Number(result);
}

/**
 * Fetch recent USDC Transfer logs over a time window (e.g., last 3 hours).
 * Returns array of logs with {time, hash, from, to, amount}
 */
async function fetchRecentTransfers(hours = 3) {
  const now = Math.floor(Date.now() / 1000);
  const startTs = now - hours * 3600;

  // 1) Resolve time window to block numbers
  const fromBlock = await getBlockNoByTime(startTs, "before");
  const toBlock = await getBlockNoByTime(now, "before");

  // 2) Query logs for USDC Transfer events within block range
  // Note: Etherscan-family expects decimal block numbers here.
  const logsQuery =
    `?module=logs&action=getLogs` +
    `&fromBlock=${fromBlock}` +
    `&toBlock=${toBlock}` +
    `&address=${USDC_CONTRACT}` +
    `&topic0=${TRANSFER_TOPIC}` +
    `&apikey=${API_KEY}`;

  const logs = await basescan(logsQuery);

  // 3) Parse logs. topics[1] and topics[2] are 32-byte indexed addresses.
  //    'data' is the 32-byte uint256 amount.
  const lowerWatch = WATCHLIST.map(a => a.toLowerCase());

  return logs.map((log) => {
    const from = "0x" + log.topics[1].slice(26);
    const to = "0x" + log.topics[2].slice(26);
    const amount = Number(formatUnits(BigInt(log.data), USDC_DECIMALS));

    const flaggedLarge = amount >= HIGH_VALUE_USD;
    const flaggedWatchlist =
      lowerWatch.includes(from.toLowerCase()) ||
      lowerWatch.includes(to.toLowerCase());

    return {
      time: Number(log.timeStamp) * 1000, // ms
      hash: log.transactionHash,
      from,
      to,
      amount,
      flaggedLarge,
      flaggedWatchlist
    };
  });
}

export default function Home() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!API_KEY) {
        setErr(
          "Missing NEXT_PUBLIC_BASESCAN_KEY. Add it in Vercel → Project → Settings → Environment Variables, then redeploy."
        );
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setErr("");
        const txs = await fetchRecentTransfers(3); // last 3 hours
        // Sort newest first
        txs.sort((a, b) => b.time - a.time);
        setRows(txs);
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const hasData = useMemo(() => rows && rows.length > 0, [rows]);

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Monitoring recent <b>USDC</b> transfers on <b>Base</b> over the past few hours. Flags high-value (&gt;=${HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      {err && (
        <div style={{ padding: 12, background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 8, marginBottom: 16 }}>
          {err}
        </div>
      )}

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
              {hasData ? rows.map((tx, i) => (
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
                    {tx.flaggedLarge && <span style={{ color: "#b91c1c", fontWeight: 700 }}>High&nbsp;Value&nbsp;</span>}
                    {tx.flaggedWatchlist && <span style={{ color: "#b45309", fontWeight: 700 }}>Watchlist</span>}
                    {!tx.flaggedLarge && !tx.flaggedWatchlist && <span style={{ color: "#6b7280" }}>—</span>}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} style={{ padding: 12, color: "#6b7280" }}>No recent transfers pulled for this time window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "24px 0", borderColor: "#e5e7eb" }} />
      <small style={{ color: "#6b7280" }}>
        Demo only. For real compliance, add vetted sanctions lists, case management, alert review, audit trails, and on-chain analytics.
      </small>
    </div>
  );
}
