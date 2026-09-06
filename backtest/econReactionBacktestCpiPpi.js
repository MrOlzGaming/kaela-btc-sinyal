// backtest/econReactionBacktestCpiPpi.js -- (6 Sep 2026, permintaan Olan: "bisa di backtest juga
// 2 itu?" -- soal CPI+PPI) -- SAMA PERSIS metodologi econReactionBacktest.js (yang udah dites buat
// NFP dan dipakai live buat econ_reaction), cuma event-nya ganti CPI/PPI. REUSE analyzeEvent/
// summarize dari situ (SATU logic, gak ditulis ulang -- biar hasilnya beneran comparable apple-to-
// apple sama backtest NFP yang udah jadi acuan).
//
// KENAPA INI DIBUTUHIN: econ_reaction (live) SEMPAT jalan di SEMUA event high-impact (termasuk
// CPI/PPI) padahal CUMA NFP yang di-backtest -- ketauan 6 Sep 2026, econ_reaction udah dibatasin
// balik ke NFP+FOMC doang buat sementara (lihat econCalendarLiveMonitor.js). Backtest ini nentuin
// APA CPI/PPI layak ditambahin balik ke scope trading econ_reaction atau enggak.

const { generateCpiEvents, generatePpiEvents } = require('../fedEvents');
const { analyzeEvent, summarize, REACTION_THRESHOLD_PCT } = require('./econReactionBacktest.js');

async function runFor(label, events) {
  console.log(`\n########## ${label}: ${events.length} event dicoba ##########`);
  const results = [];
  for (const ev of events) {
    const r = await analyzeEvent(ev);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 200)); // jaga rate-limit Binance
  }
  const signaled = results.filter((r) => r.direction !== 'NETRAL');
  console.log(`Event berhasil dianalisa: ${results.length} | Ada sinyal (>${REACTION_THRESHOLD_PCT}%): ${signaled.length} | Netral: ${results.length - signaled.length}`);

  console.log(`\n=== ${label}: SEMUA SINYAL (LONG+SHORT digabung) ===`);
  summarize(signaled, 'ALL', { showNetOfCost: true });
  console.log(`\n=== ${label}: LONG signal doang ===`);
  summarize(signaled.filter((r) => r.direction === 'LONG'), 'LONG', { showNetOfCost: true });
  console.log(`\n=== ${label}: SHORT signal doang ===`);
  summarize(signaled.filter((r) => r.direction === 'SHORT'), 'SHORT', { showNetOfCost: true });

  console.log(`\n=== ${label}: BREAKDOWN PER TAHUN ===`);
  const byYear = {};
  for (const r of signaled) { const y = new Date(r.ev.timeMs).getUTCFullYear(); (byYear[y] = byYear[y] || []).push(r); }
  for (const y of Object.keys(byYear).sort()) summarize(byYear[y], `${y} (n_event=${byYear[y].length})`);

  console.log(`\n=== ${label}: SPLIT ERA (before/after 2023-01-01) ===`);
  const era1 = signaled.filter((r) => r.ev.timeMs < Date.UTC(2023, 0, 1));
  const era2 = signaled.filter((r) => r.ev.timeMs >= Date.UTC(2023, 0, 1));
  summarize(era1, `Era1 <2023 (n_event=${era1.length})`);
  summarize(era2, `Era2 >=2023 (n_event=${era2.length})`);

  return { results, signaled };
}

async function main() {
  await runFor('CPI', generateCpiEvents());
  await runFor('PPI', generatePpiEvents());
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR econReactionBacktestCpiPpi.js:', e.message); process.exit(1); });
}

module.exports = { runFor };
