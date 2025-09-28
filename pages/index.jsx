import { useEffect, useMemo, useState } from 'react';

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const USDC_DECIMALS = 6;

// Put real addresses here (0x... full addresses). Example placeholders:
const WATCHLIST = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222"
];

const API_KEY = process.env.NEXT_PUBLIC_BASESCAN_KEY;

export default function Home() {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchTxs() {
      if (!API_KEY) {
        setError("Missing NEXT_PUBLIC_BASESCAN_KEY. Add it in Vercel → Project → Settings → Environment Variables.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        // Latest 40 token transfers for the USDC contract (global stream)
        const url = `https://api.basescan.org/api?module=account&action=tokentx&contractaddress=${USDC_CONTRACT}&page=1&offset=40&sort=desc&apikey=${API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status !== "1" || !Array.isArray(data.result)) {
          throw new Error(data.message || "Unexpected API response");
        }

        const parsed = data.result.map(tx => {
          const amount = Number(tx.value) / 10 ** USDC_DECIMALS;
          const flaggedLarge = amount >= 10000; // AML-style threshold example
          const fromWL = WATCHLIST.map(a => a.toLowerCase()).includes(tx.from.toLowerCase());
          const toWL = WATCHLIST.map(a => a.toLowerCase()).includes(tx.to.toLowerCase());
          const flaggedWatchlist = fromWL || toWL;

          return {
            time: Number(tx.timeStamp) * 1000,
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            amount,
            flaggedLarge,
            flaggedWatchlist
          };
        });

        setTxs(parsed);
      } catch (e) {
        console.error(e);
        setError(e.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchTxs();
  }, []);

  const rows = useMemo(() => {
    return txs.sort((a, b) => b.time - a.time);
  }, [txs]);

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'ui-sans-serif, system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Stablecoin Compliance Monitor</h1>
      <p style={{ color: '#6b7280', marginBottom: 16 }}>
        Monitoring recent <b>USDC</b> transfers on <b>Base</b>. Flags high-value (&gt;$10,000) and watchlist matches.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Time (UTC)</th>
                <th style={{ padding: 8 }}>Tx</th>
                <th style={{ padding: 8 }}>From</th>
                <th style={{ padding: 8 }}>To</th>
                <th style={{ padding: 8 }}>Amount (USDC)</th>
                <th style={{ padding: 8 }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 8 }}>
                    {new Date(tx.time).toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td style={{ padding: 8 }}>
                    <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>
                      {tx.hash.slice(0, 10)}…
                    </a>
                  </td>
                  <td style={{ padding: 8 }}>{tx.from.slice(0, 10)}…</td>
                  <td style={{ padding: 8 }}>{tx.to.slice(0, 10)}…</td>
                  <td style={{ padding: 8 }}>{tx.amount.toLocaleString()}</td>
                  <td style={{ padding: 8 }}>
                    {tx.flaggedLarge && <span style={{ color: '#b91c1c', fontWeight: 700 }}>High&nbsp;Value&nbsp; </span>}
                    {tx.flaggedWatchlist && <span style={{ color: '#b45309', fontWeight: 700 }}>Watchlist</span>}
                    {!tx.flaggedLarge && !tx.flaggedWatchlist && <span style={{ color: '#6b7280' }}>—</span>}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} style={{ padding: 12, color: '#6b7280' }}>No recent transfers pulled.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <hr style={{ margin: '24px 0', borderColor: '#e5e7eb' }} />
      <small style={{ color: '#6b7280' }}>
        Demo only. For real compliance, add vetted watchlists, case management, and human review.
      </small>
    </div>
  );
}
