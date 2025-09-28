import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient, http, parseAbiItem, formatUnits, getAddress
} from "viem";
import { base } from "viem/chains";

// ====== Config ======
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const USDC_DECIMALS = 6;
const HIGH_VALUE_USD = 10000; // flag threshold
const WATCHLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222"
];
// How many recent blocks to scan. Base ~2s blocks → 3600 blocks ≈ ~2 hours.
const BLOCK_WINDOW = 3600; // increase if you want a wider window
// =====================

// Public RPC (no API key)
const client = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org")
});

// ERC-20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

async function fetchRecentTransfers() {
  const latest = await client.getBlockNumber();

  // Protect against underflow
  const fromBlock =
    latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

  // 1) Fetch logs for Transfer events
  const logs = await client.getLogs({
    address: getAddress(USDC_CONTRACT),
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: latest
  });

  if (!logs.length) return [];

  // 2) Fetch timestamps per unique block (batch)
  const uniqueBlocks = [...new Set(logs.map(l => l.blockHash))];
  const blockMap = new Map();
  await Promise.all(
    uniqueBlocks.map(async (bh) => {
      const block = await client.getBlock({ blockHash: bh });
      blockMap.set(bh, Number(block.timestamp) * 1000); // ms
    })
  );

  // 3) Shape rows
  const wl = WATCHLIST.map(a => a.toLowerCase());
  const rows = logs.map(l => {
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
      flaggedWatchlist
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
        const data = await fetchRecentTransfers();
        setRows(data);
        setDiag(
          `Scanned last ~${BLOCK_WINDOW.toLocaleString()} blocks on Base (≈ ${(BLOCK_WINDOW*2/60).toFixed(1)} minutes).`
        );
      } catch (e) {
        setErr(e.message || String(e));
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
        Live on-chain scan of recent
