// pages/api/scan.js
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";

// ---- Server-only env (do NOT prefix with NEXT_PUBLIC_) ----
const PRIMARY_RPC = process.env.ANKR_BASE_RPC || "";
const FALLBACK_RPC = process.env.FALLBACK_BASE_RPC || "";

// Constants
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// Helpers
function okUrl(u) { return /^https?:\/\//i.test(u || ""); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; }
function isRateLimit(e) {
  const m = String(e?.message || e).toLowerCase();
  return m.includes("too many") || m.includes("rate limit") || m.includes("exhausted");
}
function makeClient(url) {
  if (!okUrl(url)) return null;
  return createPublicClient({ chain: base, transport: http(url, { batch: false }) });
}
async function withRetry(fn, { maxRetries, retryDelayMs, rateDelayMs, label }) {
  let last;
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i === maxRetries) break;
      await sleep(isRateLimit(e) ? rateDelayMs : retryDelayMs);
    }
  }
  throw last;
}
async function withClients(fn, clients, opts, label) {
  let last;
  for (let i = 0; i < clients.length; i++) {
    try { return await withRetry(() => fn(clients[i]), { ...opts, label }); }
    catch (e) { last = e; if (i < clients.length - 1) await sleep(800); }
  }
  throw last;
}

async function getLogsChunked({ clients, address, event, fromBlock, toBlock, chunkSize, chunkDelayMs }) {
  const all = [];
  let start = fromBlock < toBlock ? fromBlock : toBlock;
  let end = toBlock > fromBlock ? toBlock : fromBlock;
  const step = BigInt(chunkSize);
  let cursor = start;

  while (cursor <= end) {
    const chunkFrom = cursor;
    const next = cursor + step - 1n;
    const chunkTo = next > end ? end : next;

    const part = await withClients(
      (c) => c.getLogs({ address, event, fromBlock: chunkFrom, toBlock: chunkTo }),
      clients,
      { maxRetries: 3, retryDelayMs: 1200, rateDelayMs: 11000 },
      `getLogs ${chunkFrom}-${chunkTo}`
    );
    if (part.length) all.push(...part);
    cursor = chunkTo + 1n;
    if (chunkDelayMs) await sleep(chunkDelayMs);
  }
  return all;
}

export default async function handler(req, res) {
  try {
    const {
      window = "2400",
      chunk = "400",
      cdelay = "400",
      bdelay = "200",
      retries = "3",
      rdelay = "1500",
      ratedelay = "11000",
    } = req.query;

    const BLOCK_WINDOW = num(window, 2400);
    const CHUNK_SIZE = num(chunk, 400);
    const CHUNK_DELAY_MS = num(cdelay, 400);
    const BLOCK_TS_DELAY_MS = num(bdelay, 200);
    const MAX_RETRIES = num(retries, 3);
    const GENERIC_RETRY_DELAY_MS = num(rdelay, 1500);
    const RATE_LIMIT_DELAY_MS = num(ratedelay, 11000);

    const urls = [PRIMARY_RPC, FALLBACK_RPC].filter(okUrl);
    if (!urls.length) {
      res.status(400).json({ error: "No RPC configured. Set ANKR_BASE_RPC (and optional FALLBACK_BASE_RPC) in Vercel." });
      return;
    }
    const clients = urls.map(makeClient).filter(Boolean);

    const latest = await withClients(
      (c) => c.getBlockNumber(),
      clients,
      { maxRetries: MAX_RETRIES, retryDelayMs: GENERIC_RETRY_DELAY_MS, rateDelayMs: RATE_LIMIT_DELAY_MS },
      "getBlockNumber"
    );

    const fromBlock = latest > BigInt(BLOCK_WINDOW) ? latest - BigInt(BLOCK_WINDOW) : 0n;

    const logs = await getLogsChunked({
      clients,
      address: getAddress(USDC_CONTRACT),
      event: TRANSFER_EVENT,
      fromBlock,
      toBlock: latest,
      chunkSize: CHUNK_SIZE,
      chunkDelayMs: CHUNK_DELAY_MS,
    });

    if (!logs.length) {
      res.status(200).json({
        rows: [],
        scannedBlocks: Number(latest - fromBlock),
        info: { urls, BLOCK_WINDOW, CHUNK_SIZE },
      });
      return;
    }

    const uniqueBlocks = [...new Set(logs.map((l) => l.blockHash))];
    const blockMap = new Map();
    for (const bh of uniqueBlocks) {
      const block = await withClients(
        (c) => c.getBlock({ blockHash: bh }),
        clients,
        { maxRetries: MAX_RETRIES, retryDelayMs: GENERIC_RETRY_DELAY_MS, rateDelayMs: RATE_LIMIT_DELAY_MS },
        "getBlock"
      );
      blockMap.set(bh, Number(block.timestamp) * 1000);
      if (BLOCK_TS_DELAY_MS) await sleep(BLOCK_TS_DELAY_MS);
    }

    const rows = logs.map((l) => {
      const from = l.args.from;
      const to = l.args.to;
      const amount = Number(formatUnits(l.args.value, USDC_DECIMALS));
      const time = blockMap.get(l.blockHash) ?? Date.now();
      return { time, hash: l.transactionHash, from, to, amount };
    }).sort((a, b) => b.time - a.time);

    res.status(200).json({
      rows,
      scannedBlocks: Number(latest - fromBlock),
      info: { urls, BLOCK_WINDOW, CHUNK_SIZE },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
