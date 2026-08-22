// Kill switch eksekusi live (22 Agu 2026) -- SATU file gampang diubah, Olan pegang kendali penuh
// kapanpun. Defaultnya OFF total (`enabled:false`) -- gak ada satupun order real kekirim sampai
// Olan SENGAJA nyalain. Mode testnet/mainnet juga di sini, terpisah dari enabled/disabled,
// biar transisi testnet->mainnet nanti eksplisit (2 saklar beda, gak ketuker gak sengaja).

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'live-trading-config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { enabled: false, testnet: true };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function isLiveTradingEnabled() {
  return loadConfig().enabled === true;
}

function isTestnet() {
  return loadConfig().testnet !== false; // default AMAN: testnet kalau field gak ada/ambigu
}

module.exports = { loadConfig, isLiveTradingEnabled, isTestnet };
