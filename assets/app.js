// =======================
// CONFIGURAÇÕES INICIAIS
// =======================
const DIAS_NOVAS = 30;   // moedas com até 30 dias
const API_PROXY = url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

// elementos do DOM
const tabela = document.querySelector("#tbl tbody");
const statusBox = document.getElementById("status");
const inputSpread = document.getElementById("minSpread");
const inputVolume = document.getElementById("minVolume");
const inputFiltro = document.getElementById("q");
const chkAuto = document.getElementById("autorefresh");
const intervalInput = document.getElementById("interval");

// =======================
// FETCH VIA PROXY SEM CORS
// =======================
async function fetchProxy(url) {
    try {
        const r = await fetch(API_PROXY(url));
        return await r.json();
    } catch (e) {
        console.error("Erro:", url, e);
        return null;
    }
}

// =======================
// BUSCAR MOEDAS NOVAS (COINGECKO)
// =======================
async function buscarMoedasNovas() {
    let url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=false";
    let data = await fetchProxy(url);

    if (!data) return [];

    const hoje = Date.now();
    return data.filter(m => {
        if (!m.atl_date) return false;
        const lanc = new Date(m.atl_date).getTime();
        const dias = (hoje - lanc) / (1000 * 60 * 60 * 24);
        return dias <= DIAS_NOVAS;
    });
}

// =======================
// PREÇOS DAS CORRETORAS
// =======================
async function precoGate(simbolo) {
    const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${simbolo}_USDT`;
    const r = await fetchProxy(url);
    return r && r[0] ? {
        price: parseFloat(r[0].last || 0),
        vol: parseFloat(r[0].base_volume || 0)
    } : null;
}

async function precoMexc(simbolo) {
    const url = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${simbolo}_USDT`;
    const r = await fetchProxy(url);
    return r && r.data ? {
        price: parseFloat(r.data.lastPrice || 0),
        vol: parseFloat(r.data.volume24 || 0)
    } : null;
}

// =======================
// ATUALIZAR DASHBOARD
// =======================
async function atualizar() {
    tabela.innerHTML = "";
    statusBox.textContent = "Carregando…";

    const minSpread = parseFloat(inputSpread.value) || 0;
    const minVolume = parseFloat(inputVolume.value) || 0;
    const filtro = inputFiltro.value.toLowerCase();

    const moedas = await buscarMoedasNovas();
    if (!moedas.length) {
        statusBox.textContent = "Nenhuma moeda encontrada.";
        return;
    }

    let count = 0;

    for (let m of moedas) {
        const simbolo = m.symbol.toUpperCase();

        if (filtro && !simbolo.toLowerCase().includes(filtro) && !m.name.toLowerCase().includes(filtro))
            continue;

        const gate = await precoGate(simbolo);
        const mexc = await precoMexc(simbolo);

        if (!gate || !mexc) continue;

        const spread = ((mexc.price - gate.price) / gate.price) * 100;

        if (spread < minSpread) continue;
        if (gate.vol < minVolume && mexc.vol < minVolume) continue;

        tabela.innerHTML += `
            <tr>
                <td>${simbolo}</td>
                <td>$${gate.price.toFixed(4)}</td>
                <td>$${mexc.price.toFixed(4)}</td>
                <td class="r">${spread.toFixed(2)}%</td>
                <td class="r">${gate.vol.toFixed(0)}</td>
                <td class="r">${mexc.vol.toFixed(0)}</td>
                <td class="small">${new Date().toLocaleTimeString()}</td>
            </tr>
        `;

        count++;
    }

    statusBox.textContent = count ? `${count} oportunidades encontradas.` : "Nenhuma oportunidade dentro dos filtros.";
}

// =======================
// AUTOREFRESH
// =======================
setInterval(() => {
    if (chkAuto.checked) atualizar();
}, 1000);


// =======================
// EVENTOS
// =======================
document.getElementById("refresh").onclick = atualizar;


// inicia
atualizar();
