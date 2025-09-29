// pages/api/scan.js
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
  getAddress,
} from "viem";
import { base } from "viem/chains";

// ---- Server-only envs (no NEXT_PUBLIC_) ----
const PRIMARY_RPC = process.env.ANKR_BASE_RPC || "";
const FALLBACK_RPC = process.env.FALLBACK_BASE_RPC || "";

// Constants
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

// Helpers
const okUrl = (u) => /^https?:\/\//i.test(u || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
function isRateLimit(e) {
  const m = String(e?.message || e).toLowerCase();
  return m.includes("too many") || m.includes("rate limit") || m.includes("exhausted");
}
function makeClient(url) {
  if (!okUrl(url)) return null;
  return createPublicClient({ chain: base, transport: http(url, { batch: false }) });
}
async function withRetry(fn, { maxRetries, retryDelayMs, rateDelayMs }) {
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
async function withClients(fn, clients, opts) {
  let last;
  for (let i = 0; i < clients.length; i++) {
    try { return await withRetry(() => fn(clients[i]), opts); }
    catch (e) { last = e; if (i < clients.length - 1) await sleep(800); }
  }
  throw last;
}

async function getLogsChunked({ clients, address, event, fromBlock, toBlock, chunkSize, chunkDelayMs, hardStopAtMs, startedAt }) {
  const all = [];
  let start = fromBlock < toBlock ? fromBlock : toBlock;
  let end = toBlock > fromBlock ? toBlock : fromBlock;
  const step = BigInt(chunkSize);
  let cursor = start;

  while (cursor <= end) {
    // Soft time budget: return partial work if we’re running long
    if (Date.now() - startedAt > hardStopAtMs) break;

    const chunkFrom = cursor;
    const next = cursor + step - 1n;
    const chunkTo = next > end ? end : next;

    const part = await withClients(
      (c) => c.getLogs({ address, event, fromBlock: chunkFrom, toBlock: chunkTo }),
      clients,
      { maxRetries: 3, retryDelayMs: 1200, rateDelayMs: 11000 }
    );

    if (part.length) all.push(...part);
    cursor = chunkTo + 1n;
    if (chunkDelayMs) await sleep(chunkDelayMs);
  }

  // Return logs and the “cursor” to continue (if any)
  const nextFromBlock = cursor <= end ? cursor : null;
  return { logs: all, nextFromBlock };
}

export default async function handler(req, res) {
  try {
    // ---------- Query params ----------
    const {
      window = "1200",
      target = "50",
      chunk = "300",
      cdelay = "300",
      bdelay = "150",
      retries = "3",
      rdelay = "1200",
      ratedelay = "11000",
      maxms = "25000",
      cursorTo, // optional for paging older history
    } = req.query;

    const BLOCK_WINDOW = num(window, 1200);
    const TARGET_ROWS = num(target, 50);
    const CHUNK_SIZE = num(chunk, 300);
    const CHUNK_DELAY_MS = num(cdelay, 300);
    const BLOCK_TS_DELAY_MS = num(bdelay, 150);
    const MAX_RETRIES = num(retries, 3);
    const GENERIC_RETRY_DELAY_MS = num(rdelay, 1200);
    const RATE_LIMIT_DELAY_MS = num(ratedelay, 11000);
    const HARD_STOP_MS = num(maxms, 25000);

    const urls = [PRIMARY_RPC, FALLBACK_RPC].filter(okUrl);
    if (!urls.length) {
      res.status(400).json({ error: "No RPC configured. In Vercel set ANKR_BASE_RPC (and optional FALLBACK_BASE_RPC)." });
      return;
    }
    const clients = urls.map(makeClient).filter(Boolean);
    const startedAt = Date.now();

    // Latest block or continue from a provided cursor
    const toBlock = cursorTo
      ? BigInt(cursorTo) // "0x..." or decimal string both work with BigInt()
      : await withClients(
          (c) => c.getBlockNumber(),
          clients,
          { maxRetries: MAX_RETRIES, retryDelayMs: GENERIC_RETRY_DELAY_MS, rateDelayMs: RATE_LIMIT_DELAY_MS }
        );

    // Scan BACKWARD window
    const fromBlock = toBlock > BigInt(BLOCK_WINDOW - 1)
      ? toBlock - BigInt(BLOCK_WINDOW - 1)
      : 0n;

    // Logs (chunked, with soft time budget)
    const { logs, nextFromBlock } = await getLogsChunked({
      clients,
      address: getAddress(USDC_CONTRACT),
      event: TRANSFER_EVENT,
      fromBlock,
      toBlock,
      chunkSize: CHUNK_SIZE,
      chunkDelayMs: CHUNK_DELAY_MS,
      hardStopAtMs: HARD_STOP_MS,
      startedAt,
    });

    // If no logs (or time-boxed before getting any), still return cursors (as strings)
    if (!logs.length) {
      res.status(200).json({
        rows: [],
        scannedBlocks: Number(toBlock - fromBlock + 1n),
        nextCursorTo: nextFromBlock ? nextFromBlock.toString() : (fromBlock > 0n ? (fromBlock - 1n).toString() : null),
        info: { urls, BLOCK_WINDOW, CHUNK_SIZE, partial: true },
      });
      return;
    }

    // Timestamps for blocks we saw
    const blockSet = new Set(logs.map((l) => l.blockHash));
    const blockMap = new Map();
    for (const bh of blockSet) {
      if (Date.now() - startedAt > HARD_STOP_MS) break;
      const block = await withClients(
        (c) => c.getBlock({ blockHash: bh }),
        clients,
        { maxRetries: MAX_RETRIES, retryDelayMs: GENERIC_RETRY_DELAY_MS, rateDelayMs: RATE_LIMIT_DELAY_MS }
      );
      blockMap.set(bh, Number(block.timestamp) * 1000);
      if (BLOCK_TS_DELAY_MS) await sleep(BLOCK_TS_DELAY_MS);
    }

    // Rows (plain JSON-safe types only)
    const rows = logs
      .map((l) => ({
        time: blockMap.get(l.blockHash) ?? Date.now(),    // number
        hash: l.transactionHash,                           // string
        from: l.args.from,                                 // string
        to: l.args.to,                                     // string
        amount: Number(formatUnits(l.args.value, USDC_DECIMALS)), // number
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, TARGET_ROWS);

    res.status(200).json({
      rows,
      scannedBlocks: Number(toBlock - fromBlock + 1n),
      // IMPORTANT: Serialize BigInt cursor to string
      nextCursorTo: nextFromBlock
        ? nextFromBlock.toString()
        : (fromBlock > 0n ? (fromBlock - 1n).toString() : null),
      info: {
        urls,
        BLOCK_WINDOW,
        CHUNK_SIZE,
        TARGET_ROWS,
        partial: Date.now() - startedAt > HARD_STOP_MS,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
