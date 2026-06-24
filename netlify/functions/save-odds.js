// Guarda los momios capturados por el admin en Netlify Blobs bajo la
// llave "odds:current" para que todos los visitantes los puedan leer.

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const adminKey = process.env.ANTHROPIC_API_KEY ? "Hasl3tEngin33ring" : null;
  // Verificación simple del header de autenticación
  const auth = event.headers["x-admin-key"] || "";
  if (auth !== "Hasl3tEngin33ring") {
    return { statusCode: 401, body: JSON.stringify({ error: "No autorizado" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const odds = body.odds;
    if (!Array.isArray(odds)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Formato inválido — se esperaba un array de momios" }) };
    }

    const store = getStore("odds");
    await store.setJSON("current", {
      updatedAt: new Date().toISOString(),
      odds
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, count: odds.length })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
