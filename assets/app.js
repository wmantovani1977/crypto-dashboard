// assets/app.js
// Dashboard Profissional — Spot (Gate/MEXC) vs Futures (MEXC) — moedas listadas <= 30 dias
// Best-effort: tenta várias variações de symbol e usa proxies públicos quando necessário.

const STATUS = document.getElementById('status');
const TBL = document.querySelector('#tbl tbody');
const Q = document.getElementById('q');
const MIN_SP = document.getElementById('minSpread');
const MIN_VOL = document.getElementById('minVolume');
const REFRESH = document.getElementById('refresh');
const EXPORT = document.getElementById('export');
const AUTO = document.getElementById('autorefresh');
const INTERVAL = document.getElementById('interval');

let timer = null;
const DAY30_MS = 30 * 24 * 60 * 60 * 1000;

// --- helper: fetch with simple CORS fallback (direct -> allorigins -> thingproxy)
async function fetchWithFallback(url, opts = {}) {
  // try direct
  try {
    const r = await fetch(url, opts);
    if (r.ok) return r;
  } catch (e) { /* continue */ }

  // try allorigins
  try {
    const prox = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    const r2 = await fetch(prox, opts);
    if (r2.ok) return r2;
  } catch (e) { /* continue */ }

  // try thingproxy
  try {
    const prox2 = 'https://thingproxy.freeboard.io/fetch/' + url;
    const r3 = await fetch(prox2, opts);
    if (r3.ok) return r3;
  } catch (e) { /* continue */ }

  // last try direct once more to surface any final error
  return fetch(url, opts);
}

// --- CoinGecko: fetch market coins, filter by last_updated <= 30 days
async function fetchRecentCoins(limit = 250) {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;
  const r = await fetchWithFallback(url);
  if (!r.ok) throw new Error('CoinGecko markets failed: ' + r.status);
  const data = await r.json();
  const now = Date.now();
  return data.filter(c => {
    if (!c.last_updated) return false;
    const diff = now - new Date(c.last_updated).getTime();
    return diff <= DAY30_MS;
  });
}

// --- CoinGecko tickers for a single coin (to get exchange tickers if needed)
async function fetchCoinTickers(coinId) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/tickers`;
  try {
    const r = await fetchWithFallback(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// --- try to get spot price from Gate.io
async function getGateSpotPrice(symbol) {
  // try formats: SYMBOL_USDT, SYMBOL-USDT? Gate uses underscore: BTC_USDT
  const tries = [
    symbol.toUpperCase() + '_USDT',
    symbol.toUpperCase() + '_USD',
    symbol.toUpperCase() + 'USDT',
  ];
  for (const sym of tries) {
    try {
      const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(sym)}`;
      const r = await fetchWithFallback(url);
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j.length>0) {
        const item = j[0];
        const price = parseFloat(item.last) || null;
        const vol = parseFloat(item.base_volume) || parseFloat(item.quote_volume) || null;
        if (price) return { pair: item.currency_pair || sym, price, vol };
      } else if (j && j.last) {
        const price = parseFloat(j.last) || null;
        const vol = parseFloat(j.base_volume)||null;
        if (price) return { pair: sym, price, vol };
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

// --- try to get spot price from MEXC spot (REST)
async function getMexcSpotPrice(symbol) {
  // try formats: SYMBOLUSDT, SYMBOL_USDT
  const tries = [
    symbol.toUpperCase() + 'USDT',
    symbol.toUpperCase() + '_USDT',
  ];
  for (const sym of tries) {
    try {
      const url = `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`;
      const r = await fetchWithFallback(url);
      if (!r.ok) continue;
      const j = await r.json();
      // mexc returns {symbol, price}
      if (j && (j.price || j.last)) {
        const price = parseFloat(j.price || j.last) || null;
        return { pair: sym, price, vol: null };
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

// --- try to get futures price from MEXC Contract API
async function getMexcFuturesPrice(symbol) {
  // try SYMBOL_USDT
  const sym = symbol.toUpperCase() + '_USDT';
  try {
    const url = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(sym)}`;
    const r = await fetchWithFallback(url);
    if (!r.ok) return null;
    const j = await r.json();
    // expected shape: {data: {ticker: {lastPrice:...}}} or [{symbol,...}]
    if (j && j.data && j.data.ticker && j.data.ticker.lastPrice) {
      const price = parseFloat(j.data.ticker.lastPrice);
      return { pair: sym, price, vol: null };
    }
    // sometimes API returns object with "price"
    if (j && j.price) {
      return { pair: sym, price: parseFloat(j.price), vol: null };
    }
    // fallback if array
    if (Array.isArray(j) && j.length>0 && j[0].lastPrice) {
      return { pair: sym, price: parseFloat(j[0].lastPrice), vol: null };
    }
  } catch (e) { /* ignore */ }
  return null;
}

// --- assemble for one coin: try coin tickers first for reliable mapping, else guess symbols
async function analyzeCoin(c) {
  const symbol = (c.symbol || '').toUpperCase();
  let gate = null, mexcSpot = null, mexcFut = null;

  // 1) try coin tickers from CoinGecko to find direct matching markets
  const tickers = await fetchCoinTickers(c.id).catch(()=>null);
  if (tickers && tickers.tickers) {
    // find market.identifier gate-io, mexc
    for (const t of tickers.tickers) {
      const id = (t.market && t.market.identifier) ? t.market.identifier.toLowerCase() : null;
      try {
        if (!gate && id === 'gate-io') {
          const price = t.converted_last && t.converted_last.usd ? t.converted_last.usd : t.last;
          const vol = t.converted_volume && t.converted_volume.usd ? t.converted_volume.usd : t.volume;
          if (price) gate = { pair: (t.base+'/'+t.target), price: parseFloat(price), vol: parseFloat(vol||0) };
        }
        if (!mexcSpot && id === 'mexc') {
          const price = t.converted_last && t.converted_last.usd ? t.converted_last.usd : t.last;
          const vol = t.converted_volume && t.converted_volume.usd ? t.converted_volume.usd : t.volume;
          if (price) mexcSpot = { pair: (t.base+'/'+t.target), price: parseFloat(price), vol: parseFloat(vol||0) };
        }
      } catch(e){}
    }
  }

  // 2) fallback: try direct exchange APIs (common symbols)
  if (!gate) gate = await getGateSpotPrice(symbol).catch(()=>null);
  if (!mexcSpot) mexcSpot = await getMexcSpotPrice(symbol).catch(()=>null);
  if (!mexcFut) mexcFut = await getMexcFuturesPrice(symbol).catch(()=>null);

  // compute spot price as average of available spot sources (prefers gate then mexc)
  const spotPrices = [];
  if (gate && gate.price) spotPrices.push(gate.price);
  if (mexcSpot && mexcSpot.price) spotPrices.push(mexcSpot.price);
  const spotAvg = spotPrices.length ? (spotPrices.reduce((a,b)=>a+b,0)/spotPrices.length) : null;
  const futPrice = mexcFut && mexcFut.price ? mexcFut.price : null;

  // spread between futures and spot average
  const spread_pct = (spotAvg && futPrice) ? ((futPrice - spotAvg) / spotAvg) * 100 : null;

  return {
    id: c.id,
    symbol,
    name: c.name,
    market_cap: c.market_cap,
    listed_at: c.last_updated,
    gate,
    mexcSpot,
    mexcFut,
    spotAvg,
    futPrice,
    spread_pct,
  };
}

// --- main scan loop
async function scan() {
  try {
    setStatus('Buscando moedas recentes (30 dias) via CoinGecko...');
    const coins = await fetchRecentCoins(100);
    if (!coins || !coins.length) {
      setStatus('Nenhuma moeda recente encontrada.');
      return;
    }

    setStatus(`Encontradas ${coins.length} moedas recentes. Verificando preços (isso pode demorar)...`);
    const results = [];

    // limit concurrency to avoid many parallel calls (map in batches)
    const BATCH = 6;
    for (let i = 0; i < coins.length; i += BATCH) {
      const batch = coins.slice(i, i+BATCH);
      const promises = batch.map(c => analyzeCoin(c));
      const outs = await Promise.all(promises);
      outs.forEach(o => { if (o) results.push(o); });
      setStatus(`Processado ${Math.min(i+BATCH, coins.length)}/${coins.length} moedas...`);
    }

    render(results);
  } catch (err) {
    console.error(err);
    setStatus('Erro no scan: ' + (err.message || err));
  }
}

// --- render results to table with filters
function render(data) {
  const q = Q.value.trim().toLowerCase();
  const minSp = parseFloat(MIN_SP.value) || 0;
  const minVol = parseFloat(MIN_VOL.value) || 0;

  let filtered = data.filter(d => {
    if (!d.spread_pct) return false;
    if (Math.abs(d.spread_pct) < Math.abs(minSp)) return false;
    const volGate = (d.gate && d.gate.vol) ? d.gate.vol : 0;
    const volMexc = (d.mexcSpot && d.mexcSpot.vol) ? d.mexcSpot.vol : 0;
    if (Math.max(volGate, volMexc) < minVol) return false;
    if (q === '') return true;
    return d.symbol.toLowerCase().includes(q) || (d.name && d.name.toLowerCase().includes(q)) || (d.id && d.id.toLowerCase().includes(q));
  });

  // sort by absolute spread desc
  filtered.sort((a,b) => Math.abs(b.spread_pct || 0) - Math.abs(a.spread_pct || 0));

  TBL.innerHTML = '';
  for (const r of filtered) {
    const tr = document.createElement('tr');
    const spreadClass = Math.abs(r.spread_pct || 0) >= 5 ? 'good' : Math.abs(r.spread_pct || 0) >= 2 ? 'small' : '';
    tr.innerHTML = `
      <td>
        <div class="coin">${r.symbol}</div>
        <div class="small">${r.name}</div>
      </td>
      <td>
        <div>${r.gate && r.gate.price ? Number(r.gate.price).toFixed(6) : '—'}</div>
        <div class="small">${r.gate && r.gate.pair ? r.gate.pair : '—'}</div>
      </td>
      <td>
        <div>${r.mexcSpot && r.mexcSpot.price ? Number(r.mexcSpot.price).toFixed(6) : '—'}</div>
        <div class="small">${r.mexcSpot && r.mexcSpot.pair ? r.mexcSpot.pair : '—'}</div>
      </td>
      <td class="r"><div class="${spreadClass}">${r.spread_pct ? Number(r.spread_pct).toFixed(4) + '%' : '—'}</div></td>
      <td class="r">${r.gate && r.gate.vol ? Number(r.gate.vol).toLocaleString() : '—'}</td>
      <td class="r">${r.mexcSpot && r.mexcSpot.vol ? Number(r.mexcSpot.vol).toLocaleString() : '—'}</td>
      <td class="small">${r.listed_at ? new Date(r.listed_at).toLocaleDateString() : '—'}</td>
    `;
    TBL.appendChild(tr);
  }

  setStatus(`Mostrando ${filtered.length} pares • Atualizado: ${new Date().toLocaleTimeString()}`);
}

// --- CSV export (current filtered table)
EXPORT.addEventListener('click', () => {
  const rows = [['symbol','name','gate_price','mexc_spot_price','mexc_fut_price','spread_pct','gate_vol','mexc_vol','listed_at']];
  document.querySelectorAll('#tbl tbody tr').forEach(tr => {
    const cols = tr.querySelectorAll('td');
    rows.push([
      cols[0].querySelector('.coin') ? cols[0].querySelector('.coin').textContent : '',
      cols[0].querySelector('.small') ? cols[0].querySelector('.small').textContent : '',
      cols[1].querySelector('div') ? cols[1].querySelector('div').textContent : '',
      cols[2].querySelector('div') ? cols[2].querySelector('div').textContent : '',
      '', // futures column not shown explicitly as number; could be added
      cols[3] ? cols[3].textContent : '',
      cols[4] ? cols[4].textContent : '',
      cols[5] ? cols[5].textContent : '',
      cols[6] ? cols[6].textContent : '',
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `crypto-arb-${Date.now()}.csv`; a.click(); a.remove();
});

// --- controls and auto-refresh
REFRESH.addEventListener('click', () => { if (timer) { stopLoop(); startLoop(); } else scan(); });
let auto = AUTO.checked;
AUTO.addEventListener('change', () => { auto = AUTO.checked; if (auto) startLoop(); else stopLoop(); });
let intervalSec = parseInt(INTERVAL.value) || 10;
INTERVAL.addEventListener('change', () => { intervalSec = parseInt(INTERVAL.value) || 10; if (auto) { stopLoop(); startLoop(); } });

function startLoop() {
  stopLoop();
  scan();
  timer = setInterval(scan, Math.max(2000, (intervalSec||10) * 1000));
}
function stopLoop() { if (timer) clearInterval(timer); timer = null; }

// initial
startLoop();
