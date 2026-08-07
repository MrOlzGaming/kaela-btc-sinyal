// Widget harga live + grafik multi-timeframe + alat gambar garis -- vanilla JS, no library luar.
// Semua data dari Binance public API (gratis, no key), jalan langsung di browser pengunjung.
// Garis gambar TIDAK disimpan (memang sengaja) -- refresh halaman = garis hilang, murni analisa sementara.

(function () {
  const PRICE_URL = 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT';
  const KLINES_URL = 'https://api.binance.com/api/v3/klines';

  const RANGES = {
    '24j': { label: '24 Jam', interval: '15m', limit: 96 },
    '7h': { label: '7 Hari', interval: '1h', limit: 168 },
    '30h': { label: '30 Hari', interval: '4h', limit: 180 },
    '1t': { label: '1 Tahun', interval: '1w', limit: 52 },
  };

  let currentRange = '7h';
  let candles = [];
  let drawnLines = []; // {x1,y1,x2,y2} dalam koordinat canvas -- memori doang, gak disimpan

  const priceEl = document.getElementById('btc-price');
  const changeEl = document.getElementById('btc-change');
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

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 260 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '260px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawChart() {
    const w = canvas.clientWidth;
    const h = 260;
    ctx.clearRect(0, 0, w, h);
    if (candles.length < 2) return;

    const closes = candles.map((c) => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const pad = (max - min) * 0.08 || max * 0.01;
    const yMin = min - pad, yMax = max + pad;
    const marginLeft = 8, marginRight = 8, marginTop = 10, marginBottom = 10;
    const plotW = w - marginLeft - marginRight;
    const plotH = h - marginTop - marginBottom;

    const x = (i) => marginLeft + (i / (candles.length - 1)) * plotW;
    const y = (price) => marginTop + plotH - ((price - yMin) / (yMax - yMin)) * plotH;

    const trendUp = closes[closes.length - 1] >= closes[0];
    const lineColor = trendUp ? '#3fb950' : '#f85149';

    // area fill (gradient turun ke transparan)
    const gradient = ctx.createLinearGradient(0, marginTop, 0, h);
    gradient.addColorStop(0, trendUp ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(x(0), y(closes[0]));
    closes.forEach((c, i) => ctx.lineTo(x(i), y(c)));
    ctx.lineTo(x(closes.length - 1), h);
    ctx.lineTo(x(0), h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // garis harga
    ctx.beginPath();
    ctx.moveTo(x(0), y(closes[0]));
    closes.forEach((c, i) => ctx.lineTo(x(i), y(c)));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // garis gambar user (di atas chart)
    ctx.strokeStyle = '#f7931a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    drawnLines.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
    });
  }

  async function loadChart(rangeKey) {
    currentRange = rangeKey;
    document.querySelectorAll('.tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === rangeKey));
    const cfg = RANGES[rangeKey];
    try {
      const res = await fetch(`${KLINES_URL}?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`);
      const raw = await res.json();
      candles = raw.map((r) => ({ close: parseFloat(r[4]) }));
      drawnLines = []; // ganti timeframe = koordinat lama gak relevan lagi, bersihin
      resizeCanvas();
      drawChart();
    } catch (e) {
      console.error('Gagal muat grafik:', e.message);
    }
  }

  // --- gambar garis: mouse + touch ---
  let drawing = null; // {x1,y1} titik awal

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const point = evt.touches ? evt.touches[0] : evt;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function startDraw(evt) {
    evt.preventDefault();
    drawing = getPos(evt);
  }
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
    drawnLines.push({ x1: drawing.x, y1: drawing.y, x2: pos.x, y2: pos.y });
    drawing = null;
    drawChart();
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  const clearBtn = document.getElementById('clear-draw');
  if (clearBtn) clearBtn.addEventListener('click', () => { drawnLines = []; drawChart(); });

  document.querySelectorAll('.tf-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadChart(btn.dataset.tf));
  });

  window.addEventListener('resize', () => { resizeCanvas(); drawChart(); });

  updatePrice();
  setInterval(updatePrice, 15000);
  loadChart(currentRange);
})();
