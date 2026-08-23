// Win rate ringkas buat pesan sinyal (23 Agu 2026, permintaan Olan: "di pesan sinyal sniper dan
// nyopet.. nanti taruh winrate dalam persen ya.. misal 30 trades winrate 50%") -- SATU fungsi
// dipakai Sniper (sniperOrders.js getClosedOrders) DAN Nyopet (nyopet-journal.json orders[], skema
// udah disamain persis) -- keduanya sama-sama pakai field `status` closed_tp/closed_sl.
function formatWinRateLine(closedOrders) {
  // 'cancelled' DIKECUALIKAN (bukan trade beneran, jangan ngotorin win rate) -- cuma closed_tp/closed_sl.
  const finished = closedOrders.filter((o) => o.status === 'closed_tp' || o.status === 'closed_sl');
  const total = finished.length;
  if (total === 0) return '📊 Win rate: belum ada trade selesai.';
  const wins = finished.filter((o) => o.status === 'closed_tp').length;
  const pct = (wins / total) * 100;
  return `📊 Win rate: ${total} trade, ${pct.toFixed(0)}% menang`;
}

module.exports = { formatWinRateLine };
