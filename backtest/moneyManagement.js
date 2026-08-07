// OLZ Exposure System: Exposure = 12 / 2^floor(log10(capital)), capital in USD, >= 1.
// Verified against agreed brackets: $1-9=12x, $10-99=6x, $100-999=3x, $1k-9,999=1.5x, $10k-99,999=0.75x.
function getExposure(capitalUsd) {
  if (capitalUsd < 1) capitalUsd = 1;
  const magnitude = Math.floor(Math.log10(capitalUsd));
  return 12 / Math.pow(2, magnitude);
}

// FLOOR, bukan round — kalau dibulatkan ke atas, leverage x riskDistance bisa > 1,
// artinya rugi di 1 trade bisa lewat 100% modal yang dialokasikan. Floor menjamin itu gak pernah kejadian.
function computeLeverage(riskDistancePct) {
  const lev = Math.floor(1 / riskDistancePct);
  return Math.min(150, Math.max(1, lev));
}

// Safety cap: Required Margin (Volume/Leverage) must never exceed Capital.
// Volume = Capital x Exposure; Margin = Volume / Leverage = Capital x (Exposure/Leverage).
// If Exposure > Leverage, Margin > Capital -> impossible in real trading. Clamp Exposure to Leverage in that case.
function getEffectiveExposure(baseExposure, leverage) {
  return Math.min(baseExposure, leverage);
}

// Sama filosofi Exposure System: agresif waktu kecil (ada jaring pengaman top-up),
// hati-hati begitu udah gede (gak ada top-up lagi, jaga yang udah dibangun).
function getDynamicRiskPerTrade(balanceUsd, opts = {}) {
  const threshold = opts.threshold ?? 1000;
  const aggressive = opts.aggressive ?? 1.0;
  const conservative = opts.conservative ?? 0.5;
  return balanceUsd < threshold ? aggressive : conservative;
}

module.exports = { getExposure, computeLeverage, getEffectiveExposure, getDynamicRiskPerTrade };
