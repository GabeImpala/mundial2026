// Sirve los momios guardados en Netlify Blobs a todos los visitantes.

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  connectLambda(event);

  try {
    const store = getStore("odds");
    const data = await store.get("current", { type: "json" }).catch(() => null);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data || { odds: [] })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
