// Función serverless de Netlify: agrega la clave de football-data.org
// (guardada como variable de entorno, nunca en este código) y reenvía
// la llamada. El navegador de cualquier visitante nunca ve la clave.
//
// Se llama desde el navegador como /api/<lo-que-sea>, y netlify.toml
// redirige eso hacia /.netlify/functions/proxy/<lo-que-sea>. Esta función
// reconstruye <lo-que-sea> a partir de la URL, sin depender de un solo
// formato (soporta tanto el path como, por compatibilidad, ?path=...).

exports.handler = async (event) => {
  const apiKey = process.env.FOOTBALL_DATA_KEY;

  let upstreamPath = "";
  const rawPath = event.path || "";
  const marker = "/proxy/";
  const idx = rawPath.indexOf(marker);

  if (idx !== -1) {
    upstreamPath = rawPath.slice(idx + marker.length);
  } else if (event.queryStringParameters && event.queryStringParameters.path) {
    upstreamPath = event.queryStringParameters.path;
  }

  if (!upstreamPath) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No se pudo determinar la ruta de la API.", debugPath: rawPath })
    };
  }
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Falta configurar la variable de entorno FOOTBALL_DATA_KEY en Netlify (Site/Project configuration → Environment variables)."
      })
    };
  }

  try {
    const upstream = await fetch(`https://api.football-data.org/v4/${upstreamPath}`, {
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
