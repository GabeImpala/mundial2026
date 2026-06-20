// Función serverless de Netlify: agrega la clave de football-data.org
// (guardada como variable de entorno, nunca en este código) y reenvía
// la llamada. El navegador de cualquier visitante nunca ve la clave.
//
// Se llama desde el navegador como /api/<lo-que-sea>, y netlify.toml
// redirige eso hacia esta función pasando el resto de la ruta en
// el parámetro "path".

exports.handler = async (event) => {
  const apiKey = process.env.FOOTBALL_DATA_KEY;
  const path = event.queryStringParameters && event.queryStringParameters.path;

  if (!path) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Falta el parámetro path." })
    };
  }
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Falta configurar la variable de entorno FOOTBALL_DATA_KEY en Netlify (Site settings → Environment variables)."
      })
    };
  }

  try {
    const upstream = await fetch(`https://api.football-data.org/v4/${path}`, {
      headers: { "X-Auth-Token": apiKey }
    });
    const body = await upstream.text();

    return {
      statusCode: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: String(err) })
    };
  }
};
