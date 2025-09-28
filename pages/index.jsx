import { useEffect, useState } from 'react';

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
const WATCHLIST = [
  "0x1234...abcd", // Example flagged address
  "0xbeef...cafe"
];
const USDC_DECIMALS = 6;
const API_KEY = process.env.NEXT_PUBLIC_BASESCAN_KEY; // Free API key from basescan.org

export default function Home() {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTxs() {
      setLoading(true);
      try {
        const res = await fetch(
          `https://api.basescan.org/api?module=account&action=tokentx&contractaddress=${USDC_CONTRACT}&page=1&offset=20&sort=desc&apikey=${API_KEY}`
        );
        const data = await res.json();
        if (data.result) {
          const parsed = data.result.map(tx => {
            const amount = Number(tx.value) / (10 ** USDC_DECIMALS);
            const flaggedLarge = amount >= 10000;
            const flaggedWatchlist = WATCHLIST.includes(tx.from) || WATCHLIST.includes(tx.to);
            return {
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              amount,
              flaggedLarge,
              flaggedWatchlist
            };
          });
          setTxs(parsed);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTxs();
  }, []);

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>Stablecoin Compliance Monitor</h1>
      <p>Monitoring USDC transfers on Base</p>
      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Tx Hash</th>
              <th>From</th>
              <th>To</th>
              <th>Amount (USDC)</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((tx, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
                <td>
                  <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                    {tx.hash.slice(0, 10)}...
                  </a>
                </td>
                <td>{tx.from.slice(0, 10)}...</td>
                <td>{tx.to.slice(0, 10)}...</td>
                <td>{tx.amount.toLocaleString()}</td>
                <td>
                  {tx.flaggedLarge && <span style={{ color: 'red' }}>High Value </span>}
                  {tx.flaggedWatchlist && <span style={{ color: 'orange' }}>Watchlist </span>}
                  {!tx.flaggedLarge && !tx.flaggedWatchlist && "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
