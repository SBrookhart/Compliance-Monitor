# Stablecoin Compliance Monitor (USDC on Base)

- Next.js app that fetches recent USDC transfers from BaseScan and flags:
  - Amounts >= $10,000
  - Matches against a simple watchlist you define in `pages/index.jsx`

## Quick Start
1) Get a BaseScan API key and set it in Vercel as `NEXT_PUBLIC_BASESCAN_KEY`.
2) Deploy with Vercel (import this GitHub repo).
3) Open the URL. You should see a table of recent transfers with flags.

> Demo only. Not a substitute for regulated compliance tooling.
