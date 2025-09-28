import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";

// === Constants ===
const API_KEY = process.env.NEXT_PUBLIC_BASESCAN_KEY;

// USDC on Base (official)
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

// ERC-20 Transfer(address,address,uint256) topic
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Flags
const HIGH_VALUE_USD = 10000;
const WATCHLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222"
];

// === Helpers ===
function toHexDec(n) {
  // Etherscan-family getLogs accepts hex; safer than decimal.
  const hex = Number(n).toString(16);
  return "0x" + hex;
}

async function callBaseScan(query) {
  const url = `https://api.basescan.org/api${query}`;
  const res = await fetch(url);
  let data;
  try { data = await res.json(); } catch {
    throw new Error("Unable to parse API response");
  }
  // Etherscan-family: status "1" = OK, "0" = NOTOK
  if (!data || data.status === "0") {
    throw new Error(data?.message || "NOTOK");
  }
  return data.result;
}

async function getBlockNoByTime(tsSeconds, closest) {
  const q = `?module=block&action=getblocknobytime&timestamp=${tsSeconds}&closest=${closest}&apikey=${API_KEY}`;
  const result = await callBaseScan(q);
  return Number(result); // decimal block number as string -> number
}

async function fetchLogsInWindow(hours) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - hours * 3600;

  // Map time -> blocks; tolerate equal/out-of-order results by nudging
  const fromBlockNum = await getBlockNoByTime(startSec, "before");
  const toBlockNum = await getBlockNoByTime(nowSec, "before");
  const fromBlock = Math.min(fromBlockNum, toBlockNum);
  const toBlock = Math.max(fromBlockNum, toBlockNum);

  const q =
    `?module=logs&action=getLogs` +
    `&fromBlock=${toHexDec(fromBlock)}` +
    `&toBlock=${toHexDec(toBlock)}` +
    `&address=${USDC_CONTRACT}` +
    `&topic0=${TRANSFER_TOPIC}` +
    `&apikey=${API_KEY}`;

  const logs = await callBaseScan(q);
  const lw = WATCHLIST.map(a => a.toLowerCase());

  const rows = logs.map((log) => {
    // topics[1] and topics[2] are 32-byte addresses (left-padded); last 40 chars = address
    const from = "0x" + log.topics[1].slice(26);
    const to = "0x" + log.topics[2].slice(26);
    const amount = Number(formatUnits(BigInt(log.data), USDC_DECIMALS));
    const flaggedLarge = amount >= HIGH_VALUE_USD;
    const flaggedWatchlist =
      lw.includes(from.toLowerCase()) || lw.includes(to.toLowerCase());

    return {
      time: Number(log.timeStamp) * 1000,
      hash: log.transactionHash,
      from, to, amount,
      flaggedLarge, flaggedWatchlist
    };
  });

  // Newest first
  rows.sort((a, b) => b.time - a.time);
  return { rows, meta: { fromBlock, toBlock, hours } };
}

// Try 3h, then 6h, then 12h if needed (errors or empty)
async function fetchWithFallbacks() {
  const attempts = [3, 6, 12];
  const errors = [];
  for (const h of attempts) {
    try {
      const result = await fetchLogsInWindow(h);
      if (result.rows.length > 0) return { ...result, errors };
      errors.push(`No logs in last ${h}h (from ${result.meta.fromBlock} to ${result.meta.toBlock})`);
    } catch (e) {
      errors.push(`(${h}h) ${e.message || String(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

// === Component ===
export default function Home() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState(""); // extra diagnostics

  useEffect(() => {
    (async () => {
      if (!API_KEY) {
        setErr("Missing NEXT_PUBLIC_BASESCAN_KEY (set it in Vercel → Project → Settings → Environment Variables) and redeploy.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr("");
      setDiag("");
      try {
        const { rows: r, meta, errors } = await fetchWithFallbacks();
        setRows(r);
        if (errors && errors.length) {
          setDiag(`Recovered after: ${errors.join(" | ")}`);
        } else {
          setDiag(`Fetched window ~${meta.hours}h (blocks ${meta.fromBlock} → ${meta.toBlock}).`);
        }
      } catch (e) {
        setErr(e.message || "NOTOK");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const hasData = useMemo(() => rows.length > 0, [rows]);

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: "#6b7280", marginBottom: 16 }}>
        Monitoring recent <b>USDC</b> transfers on <b>Base</b>. Flags high-value (≥{HIGH_VALUE_USD.toLocaleString()}) and watchlist matches.
      </p>

      {err && (
        <div style={{ padding: 12, background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA", borderRadius: 8, marginBottom: 12 }}>
          {err}
        </div>
      )}
      {!err && diag && (
        <div style={{ padding: 10, background: "#F0FDF4", color: "#166534", border: "1px solid #BBF7D0", borderRadius: 8, marginBottom: 12 }}>
          {diag}
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
                <tr><td colSpan={6} style={{ padding: 12, color: "#6b7280" }}>No transfers found for the scanned window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: "24px 0", borderColor: "#e5e7eb" }} />
      <small style={{ color: "#6b7280" }}>
        Demo only. For production compliance, add vetted sanctions lists, case management, human review, and audit trails.
      </small>
    </div>
  );
}
