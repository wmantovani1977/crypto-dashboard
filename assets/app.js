document.addEventListener("DOMContentLoaded", () => {

    const statusEl = document.getElementById("status");
    const tbody = document.querySelector("#tbl tbody");

    if (!statusEl || !tbody) {
        console.error("Erro crítico: elemento #status ou tabela não encontrado.");
        return;
    }

    async function carregarDados() {
        try {
            statusEl.innerHTML = "Carregando…";

            const resp = await fetch("https://api.coingecko.com/api/v3/exchanges");
            if (!resp.ok) throw new Error("Falha ao obter exchanges");

            const exchanges = await resp.json();

            tbody.innerHTML = "";

            exchanges.slice(0, 20).forEach(ex => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${ex.name}</td>
                    <td>${ex.year_established || "-"}</td>
                    <td>${ex.country || "-"}</td>
                    <td class="r">${ex.trade_volume_24h_btc ? ex.trade_volume_24h_btc.toFixed(2) : "-"}</td>
                    <td class="r">${ex.trust_score || "-"}</td>
                    <td class="r">${ex.trust_score_rank || "-"}</td>
                    <td class="small">${new Date().toLocaleTimeString()}</td>
                `;
                tbody.appendChild(tr);
            });

            statusEl.innerHTML = "Atualizado";

        } catch (e) {
            console.error(e);
            statusEl.innerHTML = "Erro ao carregar";
        }
    }

    // Botão atualizar
    document.getElementById("refresh").addEventListener("click", carregarDados);

    // Auto refresh
    setInterval(() => {
        const auto = document.getElementById("autorefresh").checked;
        if (auto) carregarDados();
    }, 10000);

    // Primeira carga
    carregarDados();
});
