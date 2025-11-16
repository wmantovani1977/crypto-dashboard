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

function setStatus(t){ STATUS.textContent = t; }

async function fetchTopCoins(per_page=100){
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${per_page}&page=1&price_change_percentage=1h`;
  const r = await fetch(url);
  if(!r.ok) throw new Error('Erro CoinGecko markets');
  return await r.json();
}

async function fetchTickers(coinId){
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/tickers`;
  const r = await fetch(url);
  if(!r.ok) return null;
  return await r.json();
}

function extractExchangeTicker(tickers, exchangeIds){
  if(!tickers || !tickers.tickers) return null;
  const found = {};
  for(const ex of exchangeIds){
    const t = tickers.tickers.find(x => x.market && x.market.identifier === ex);
    if(t){
      found[ex] = {
        price: t.converted_last ? (t.converted_last.usd || t.last) : t.last,
        volume: t.converted_volume ? (t.converted_volume.usd || t.volume) : t.volume,
        pair: t.base + '/' + t.target
      };
    }
  }
  return found;
}

function formatNum(v){ 
  if(v==null) return '—';
  if(Math.abs(v)>=1000) return Number(v).toLocaleString();
  return Number(v).toFixed(6).replace(/\.?0+$/,''); 
}

async function scan(){
  try{
    setStatus('Buscando mercado...');
    const coins = await fetchTopCoins(100);

    setStatus('Buscando tickers por moeda...');
    const results = [];

    for(const c of coins){
      const tickers = await fetchTickers(c.id);
      const ex = extractExchangeTicker(tickers, ['gate-io','mexc']);

      if(ex && ex['gate-io'] && ex['mexc']){
        const pg = ex['gate-io'].price;
        const pm = ex['mexc'].price;

        if(pg && pm){
          const spread = (pm - pg) / pg * 100;

          results.push({
            id: c.id,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            gate: ex['gate-io'],
            mexc: ex['mexc'],
            spread_pct: spread,
            market_cap: c.market_cap,
            last_updated: c.last_updated
          });
        }
      }
    }
    render(results);

  }catch(err){
    console.error(err);
    setStatus('Erro: ' + err.message);
  }
}

function render(data){
  const q = Q.value.trim().toLowerCase();
  const minSp = parseFloat(MIN_SP.value) || 0;
  const minVol = parseFloat(MIN_VOL.value) || 0;

  const filtered = data.filter(d=>{
    if(Math.abs(d.spread_pct) < Math.abs(minSp)) return false;
    const volGate = d.gate.volume || 0;
    const volMexc = d.mexc.volume || 0;
    if(Math.max(volGate, volMexc) < minVol) return false;

    if(q === '') return true;
    return (
      d.symbol.toLowerCase().includes(q) || 
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q)
    );
  });

  filtered.sort((a,b)=> Math.abs(b.spread_pct) - Math.abs(a.spread_pct));

  TBL.innerHTML = '';

  for(const r of filtered){
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <div class="coin">${r.symbol}</div>
        <div class="small">${r.name}</div>
      </td>
      <td>
        <div>${formatNum(r.gate.price)}</div>
        <div class="small">${r.gate.pair}</div>
      </td>
      <td>
        <div>${formatNum(r.mexc.price)}</div>
        <div class="small">${r.mexc.pair}</div>
      </td>
      <td class="r"><div>${r.spread_pct.toFixed(4)}%</div></td>
      <td class="r">${formatNum(r.gate.volume)}</td>
      <td class="r">${formatNum(r.mexc.volume)}</td>
      <td class="small">${new Date(r.last_updated).toLocaleString()}</td>
    `;

    TBL.appendChild(tr);
  }

  setStatus(`Mostrando ${filtered.length} pares • Atualizado: ${new Date().toLocaleTimeString()}`);
}

REFRESH.addEventListener('click', scan);

EXPORT.addEventListener('click', ()=>{
  const rows = [['id','symbol','name','gate_price','mexc_price','spread_pct','gate_vol','mexc_vol','last_updated']];

  document.querySelectorAll('#tbl tbody tr').forEach(tr=>{
    const cols = tr.querySelectorAll('td');
    rows.push([
      cols[0].querySelector('.small').textContent,
      cols[0].querySelector('.coin').textContent,
      cols[0].querySelector('.small').textContent,
      cols[1].querySelector('div').textContent,
      cols[2].querySelector('div').textContent,
      cols[3].textContent,
      cols[4].textContent,
      cols[5].textContent,
      cols[6].textContent
    ]);
  });

  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url; 
  a.download = `crypto-arb-${Date.now()}.csv`; 
  a.click();
});

let auto = AUTO.checked;

AUTO.addEventListener('change', ()=>{
  auto = AUTO.checked;
  if(auto) startLoop();
  else stopLoop();
});

let intervalSec = parseInt(INTERVAL.value) || 10;

INTERVAL.addEventListener('change', ()=>{
  intervalSec = parseInt(INTERVAL.value) || 10;
  if(auto){ stopLoop(); startLoop(); }
});

function startLoop(){
  stopLoop();
  scan();
  timer = setInterval(scan, Math.max(2000, intervalSec*1000));
}

function stopLoop(){ 
  if(timer) clearInterval(timer); 
  timer = null; 
}

startLoop();
