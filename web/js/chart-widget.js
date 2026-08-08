// Widget harga live + grafik candlestick/garis multi-timeframe + indikator + alat gambar garis.
// Vanilla JS, no library luar. Live movement dari Binance WebSocket (bukan cuma polling).
// "All Time" pakai data historis 2014+ yang di-bundle statis (data/btc-history.json) --
// API gratis buat riwayat sepuluh tahunan udah pada minta API key berbayar sekarang.
// Garis gambar TERSIMPAN di localStorage browser (per timeframe, koordinat RELATIF 0-1 biar
// tahan resize) -- beda dari versi awal yang sengaja hilang pas refresh, sekarang direvisi
// sesuai permintaan biar analisa gak ilang tiap buka lagi.

(function () {
  const PRICE_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  const KLINES_URL = 'https://api.binance.com/api/v3/klines';
  const WS_BASE = 'wss://stream.binance.com:9443/ws/btcusdt@kline_';
  const LINES_STORAGE_KEY = 'kaela_chart_lines_v1';

  const RANGES = {
    '1m': { label: '1m', interval: '1m', limit: 180 },
    '15m': { label: '15m', interval: '15m', limit: 192 },
    '1h': { label: '1H', interval: '1h', limit: 168 },
    '4h': { label: '4H', interval: '4h', limit: 180 },
    '1d': { label: '1D', interval: '1d', limit: 365 },
    '1w': { label: '1W', interval: '1w', limit: 260 },
    'all': { label: 'ALL', interval: null, limit: null },
  };

  let currentRange = '1h';
  let chartMode = 'candle'; // 'candle' | 'line'
  let candles = []; // {time, open, high, low, close}
  let drawnLines = []; // {x1,y1,x2,y2} FRAKSI 0-1 relatif ke ukuran canvas -- tahan resize
  let showSMA = false;
  let showEMA = false;
  let ws = null;
  let historyCache = null; // cache data/btc-history.json biar gak fetch ulang tiap klik ALL

  const priceEl = document.getElementById('btc-price');
  const changeEl = document.getElementById('btc-change');
  const liveDot = document.getElementById('live-dot');
  const canvas = document.getElementById('btc-chart');
  const wrap = document.getElementById('btc-chart-wrap');
  if (!canvas) return; // widget gak ada di halaman ini, skip
  const ctx = canvas.getContext('2d');

  function fmtUsd(n) {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 1000 ? 2 : 0 });
  }

  async function updatePrice() {
    try {
      const res = await fetch(PRICE_URL);
      const data = await res.json();
      const price = parseFloat(data.lastPrice);
      const changePct = parseFloat(data.priceChangePercent);
      priceEl.textContent = fmtUsd(price);
      changeEl.textContent = (changePct >= 0 ? '📈 +' : '📉 ') + changePct.toFixed(2) + '% (24j)';
      changeEl.className = 'price-change ' + (changePct >= 0 ? 'up' : 'down');
    } catch (e) {
      priceEl.textContent = 'Gagal muat';
    }
  }

  // --- persist garis gambar per timeframe, koordinat RELATIF (0-1) biar tahan resize ---
  function loadAllSavedLines() {
    try {
      return JSON.parse(localStorage.getItem(LINES_STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }
  function saveLinesForCurrentRange() {
    const all = loadAllSavedLines();
    all[currentRange] = drawnLines;
    try { localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function loadLinesForCurrentRange() {
    const all = loadAllSavedLines();
    drawnLines = all[currentRange] || [];
  }

  // Kadang dipanggil SEBELUM browser sempat layout (lebar masih 0px) -- kalau kejadian,
  // coba lagi frame berikutnya daripada "kekunci" ke ukuran 0 selamanya.
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0) return false;
    canvas.width = rect.width * dpr;
    canvas.height = 320 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '320px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function renderFrame() {
    if (!resizeCanvas()) {
      requestAnimationFrame(renderFrame);
      return;
    }
    drawChart();
  }

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (i === period - 1) {
        prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      } else if (i >= period) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  // "harga rapi" buat label sumbu -- pembulatan ke satuan yang enak dibaca (1/2/5 x 10^n)
  function niceStep(range, targetTicks) {
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }

  function drawChart() {
    const w = canvas.clientWidth;
    const h = 320;
    ctx.clearRect(0, 0, w, h);
    if (candles.length < 2) return;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const yMax = Math.max(...highs), yMin = Math.min(...lows);
    const pad = (yMax - yMin) * 0.08 || yMax * 0.01;
    const top = yMax + pad, bottom = yMin - pad;
    const marginLeft = 8, marginRight = 62, marginTop = 10, marginBottom = 10;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;
    const n = candles.length;

    const y = (price) => marginTop + plotH - ((price - bottom) / (top - bottom)) * plotH;
    const xAt = (i) => marginLeft + (i / Math.max(1, n - 1)) * plotW;

    // --- gridline horizontal + label harga (kanan) ---
    const step = niceStep(top - bottom, 5);
    const firstTick = Math.ceil(bottom / step) * step;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let price = firstTick; price <= top; price += step) {
      const gy = y(price);
      ctx.strokeStyle = 'rgba(139,150,163,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marginLeft, gy);
      ctx.lineTo(w - marginRight, gy);
      ctx.stroke();
      ctx.fillStyle = '#8b96a3';
      const label = price >= 1000 ? (price / 1000).toFixed(price % 1000 === 0 ? 0 : 1) + 'k' : price.toFixed(0);
      ctx.fillText(label, w - marginRight + 6, gy);
    }

    if (chartMode === 'candle') {
      const candleWidth = Math.max(1, (plotW / n) * 0.7);
      candles.forEach((c, i) => {
        const cx = marginLeft + ((i + 0.5) / n) * plotW;
        const up = c.close >= c.open;
        const color = up ? '#3fb950' : '#f85149';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, y(c.high));
        ctx.lineTo(cx, y(c.low));
        ctx.stroke();
        ctx.fillStyle = color;
        const bodyTop = Math.min(y(c.open), y(c.close));
        const bodyH = Math.max(1, Math.abs(y(c.close) - y(c.open)));
        ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyH);
      });
    } else {
      const closes = candles.map((c) => c.close);
      const trendUp = closes[closes.length - 1] >= closes[0];
      const gradient = ctx.createLinearGradient(0, marginTop, 0, h);
      gradient.addColorStop(0, trendUp ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.moveTo(xAt(0), y(closes[0]));
      closes.forEach((c, i) => ctx.lineTo(xAt(i), y(c)));
      ctx.lineTo(xAt(n - 1), h);
      ctx.lineTo(xAt(0), h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(xAt(0), y(closes[0]));
      closes.forEach((c, i) => ctx.lineTo(xAt(i), y(c)));
      ctx.strokeStyle = trendUp ? '#3fb950' : '#f85149';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // --- indikator overlay: SMA20 / EMA50 ---
    function drawOverlay(values, color) {
      ctx.beginPath();
      let started = false;
      values.forEach((v, i) => {
        if (v === null) return;
        const px = xAt(i), py = y(v);
        if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const closesForIndicator = candles.map((c) => c.close);
    if (showSMA && n >= 20) drawOverlay(sma(closesForIndicator, 20), '#4f9dff');
    if (showEMA && n >= 50) drawOverlay(ema(closesForIndicator, 50), '#c77dff');

    // --- garis gambar user (fraksi 0-1 -> pixel canvas saat ini) ---
    ctx.strokeStyle = '#f7931a';
    ctx.lineWidth = 1.5;
    drawnLines.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(l.x1 * w, l.y1 * h);
      ctx.lineTo(l.x2 * w, l.y2 * h);
      ctx.stroke();
    });
  }

  function setLiveIndicator(isLive) {
    if (!liveDot) return;
    liveDot.style.display = isLive ? 'inline-block' : 'none';
  }

  function connectWebSocket(interval) {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    if (!interval) { setLiveIndicator(false); return; }
    try {
      ws = new WebSocket(WS_BASE + interval);
      ws.onopen = () => setLiveIndicator(true);
      ws.onclose = () => setLiveIndicator(false);
      ws.onerror = () => setLiveIndicator(false);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const k = msg.k;
        if (!k) return;
        const liveCandle = { time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c };
        const lastIdx = candles.length - 1;
        if (lastIdx >= 0 && candles[lastIdx].time === liveCandle.time) {
          candles[lastIdx] = liveCandle;
        } else {
          candles.push(liveCandle);
          const cfg = RANGES[currentRange];
          if (cfg.limit && candles.length > cfg.limit) candles.shift();
        }
        drawChart();
      };
    } catch (e) {
      setLiveIndicator(false);
    }
  }

  async function loadHistoryAll() {
    if (historyCache) return historyCache;
    const res = await fetch('data/btc-history.json');
    historyCache = await res.json();
    return historyCache;
  }

  async function loadChart(rangeKey) {
    currentRange = rangeKey;
    document.querySelectorAll('.tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === rangeKey));
    const cfg = RANGES[rangeKey];
    try {
      if (rangeKey === 'all') {
        const hist = await loadHistoryAll();
        candles = hist.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
        connectWebSocket(null); // data statis, gak ada live stream buat "All Time"
      } else {
        const res = await fetch(`${KLINES_URL}?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`);
        const raw = await res.json();
        candles = raw.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
        connectWebSocket(cfg.interval);
      }
      loadLinesForCurrentRange(); // ganti timeframe -> load garis yang PERNAH digambar di timeframe ini
      renderFrame();
    } catch (e) {
      console.error('Gagal muat grafik:', e.message);
    }
  }

  // --- gambar garis: mouse + touch (disimpan localStorage per timeframe) ---
  let drawing = null;

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }
  function startDraw(evt) { evt.preventDefault(); drawing = getPos(evt); }
  function moveDraw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    const pos = getPos(evt);
    drawChart();
    ctx.strokeStyle = '#f7931a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(drawing.x, drawing.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
  function endDraw(evt) {
    if (!drawing) return;
    const pos = getPos(evt.changedTouches ? { clientX: evt.changedTouches[0].clientX, clientY: evt.changedTouches[0].clientY } : evt);
    const w = canvas.clientWidth, h = 320;
    drawnLines.push({ x1: drawing.x / w, y1: drawing.y / h, x2: pos.x / w, y2: pos.y / h });
    drawing = null;
    saveLinesForCurrentRange();
    drawChart();
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  const clearBtn = document.getElementById('clear-draw');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      drawnLines = [];
      saveLinesForCurrentRange();
      drawChart();
    });
  }

  const modeBtn = document.getElementById('chart-mode-toggle');
  if (modeBtn) {
    modeBtn.addEventListener('click', () => {
      chartMode = chartMode === 'candle' ? 'line' : 'candle';
      modeBtn.textContent = chartMode === 'candle' ? '📊 Candle' : '📈 Garis';
      drawChart();
    });
  }

  const smaCheck = document.getElementById('indicator-sma');
  if (smaCheck) smaCheck.addEventListener('change', () => { showSMA = smaCheck.checked; drawChart(); });
  const emaCheck = document.getElementById('indicator-ema');
  if (emaCheck) emaCheck.addEventListener('change', () => { showEMA = emaCheck.checked; drawChart(); });

  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadChart(btn.dataset.tf));
  });

  window.addEventListener('resize', renderFrame);
  window.addEventListener('beforeunload', () => { if (ws) ws.close(); });

  updatePrice();
  setInterval(updatePrice, 15000);
  loadChart(currentRange);
})();
