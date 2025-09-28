# Stablecoin Compliance Monitor (USDC on Base)

Cloud Next.js app on Vercel that fetches recent **USDC** transfers on **Base** and flags:
- High-value transfers (default: >= $10,000)
- Watchlist hits (addresses you supply)

## Setup (GitHub → Vercel)
1. Create a GitHub repo (e.g., `compliance-monitor`) and upload this entire folder.
2. On [basescan.org](https://basescan.org) create an API key.
3. In Vercel: Import the repo → Project Settings → Environment Variables:
   - `NEXT_PUBLIC_BASESCAN_KEY` = **your BaseScan API key**
4. Redeploy. Open the Production URL.

## Customize
- Edit `HIGH_VALUE_USD` and `WATCHLIST` in `pages/index.jsx`.
- Change the time window by adjusting `fetchRecentTransfers(3)` (hours).
- This uses:
  - `block.getblocknobytime` (to map time → blocks)
  - `logs.getLogs` with `topic0` = ERC-20 Transfer

> Demo only. Not a substitute for regulated compliance tooling.
