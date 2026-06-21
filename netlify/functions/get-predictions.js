// Función de solo lectura: regresa las predicciones guardadas de los
// últimos 14 días (UTC) desde Netlify Blobs. No llama a la API de
// Anthropic ni a football-data.org — solo lee lo que `predict.js` ya
// generó y guardó. Por eso es segura de llamar tan seguido como se quiera
// (cada visita, cada refresh) sin gastar nada extra.

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  connectLambda(event);
  const store = getStore("predictions");

  const days = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const results = await Promise.all(
    days.map(d => store.get(d, { type: "json" }).catch(() => null))
  );

  const byDay = results.filter(Boolean).sort((a, b) => a.date < b.date ? 1 : -1);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ days: byDay })
  };
};
