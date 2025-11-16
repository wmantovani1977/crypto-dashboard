// ======================
// CONFIGURAÇÕES
// ======================
const SPREAD_MINIMO = 0.00;     // Spread mínimo em %
const VOLUME_MINIMO = 0;        // Volume mínimo em USD
const DIAS_NOVAS = 30;          // Moedas lançadas nos últimos X dias

// ======================
// FUNÇÃO FETCH VIA PROXY (SEM CORS)
// ======================
async function fetchProxy(url) {
    const proxy = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
    try {
        const resp = await fetch(proxy);
        return await resp.json();
    } catch (e) {
        console.error("Erro no fetch via proxy:", url, e);
        return null;
    }
}

// ======================
// BUSCAR MOEDAS NOVAS (COINGECKO)
// ======================
async function buscarMoedasNovas() {
    const url = "https://api.coingecko.com/api/v3/coins/list?include_platform=false";
    const moedas = await fetchProxy(url);

    if (!moedas) return [];

    const hoje = new Date();
    return moedas.filter(m => {
        if (!m.id) return false;

        const tempo = new Date(m.id * 1000);
        const diff = (hoje - tempo) / (1000 * 60 * 60 * 24);

        return diff <= DIAS_NOVAS;
    }).slice(0, 50); // limitar a 50 moedas para performance
}

// ======================
// PREÇOS EM CADA CORRETORA
// ======================
async function precoGateSpot(simbolo) {
    const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${simbolo}_USDT`;
    const data = await fetchProxy(url);
    return data && data[0] ? parseFloat(data[0].last) : null;
}

async function precoMexcFutures(simbolo) {
    const url = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${simbolo}_USDT`;
    const data = await fetchProxy(url);
    return data && data.data ? parseFloat(data.data.lastPrice) : null;
}

// ======================
// ATUALIZAR DASHBOARD
// ======================
async function atualizarDashboard() {
    const tabela = document.getElementById("tabela-moedas");
    tabela.innerHTML = `<tr><td colspan="5">Carregando...</td></tr>`;

    const moedas = await buscarMoedasNovas();

    if (!moedas.length) {
        tabela.innerHTML = `<tr><td colspan="5">Nenhuma moeda encontrada</td></tr>`;
        return;
    }

    tabela.innerHTML = "";

    for (const m of moedas) {
        const simbolo = (m.symbol || "").toUpperCase();

        // Buscar preços
        const precoGate = await precoGateSpot(simbolo);
        const precoMexc = await precoMexcFutures(simbolo);

        if (!precoGate || !precoMexc) continue;

        // Calcular spread
        const spread = ((precoMexc - precoGate) / precoGate) * 100;

        if (spread < SPREAD_MINIMO) continue;

        // Inserir no HTML
        tabela.innerHTML += `
            <tr>
                <td>${simbolo}</td>
                <td>$${precoGate.toFixed(4)}</td>
                <td>$${precoMexc.toFixed(4)}</td>
                <td>${spread.toFixed(2)}%</td>
            </tr>
        `;
    }

    if (tabela.innerHTML.trim() === "") {
        tabela.innerHTML = `<tr><td colspan="5">Nenhuma oportunidade encontrada</td></tr>`;
    }
}

// ======================
// LOOP A CADA 10s
// ======================
setInterval(atualizarDashboard, 10000);
atualizarDashboard();
