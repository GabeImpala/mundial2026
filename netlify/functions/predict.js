// Función programada (1 vez al día, ver netlify.toml) que genera las
// predicciones de la IA para los partidos del día. Combina dos fuentes:
//
// 1) Un "piso estructural" por país al estilo del modelo de Joachim Klement
//    (PIB per cápita, población, tradición futbolística, ranking FIFA) —
//    cifras de referencia aproximadas, no estadísticas auditadas.
// 2) La forma real del torneo hasta este momento (resultados, goles), que
//    es justo lo que el modelo original de Klement NO usa, ya que es
//    estático y se calcula antes de que arranque el Mundial.
//
// El resultado se guarda en Netlify Blobs bajo la llave `predictions:YYYY-MM-DD`
// (fecha UTC) para que TODOS los visitantes vean la misma predicción del día,
// y se pueda evaluar después contra el resultado real. Es idempotente: si ya
// existe una entrada para hoy, no se vuelve a llamar a la API de Anthropic.

const { getStore, connectLambda } = require("@netlify/blobs");

// --- Datos estructurales estilo Klement, por equipo (llave = nombre en
// inglés tal como lo regresa football-data.org, en minúsculas) ---
// gdp = PIB per cápita aprox. (USD) · pop = población aprox. (millones)
// trad = tradición futbolística (1-10, subjetivo, basado en historia del
// equipo en Mundiales) · rank = ranking FIFA oficial (11 jun 2026)
const KLEMENT_DATA = {
  "mexico": { gdp: 13000, pop: 130, trad: 9, rank: 14 },
  "korea republic": { gdp: 35000, pop: 52, trad: 6, rank: 25 },
  "czechia": { gdp: 30000, pop: 10.5, trad: 6, rank: 40 },
  "south africa": { gdp: 6500, pop: 60, trad: 5, rank: 60 },
  "canada": { gdp: 53000, pop: 39, trad: 3, rank: 30 },
  "switzerland": { gdp: 95000, pop: 8.8, trad: 6, rank: 19 },
  "bosnia and herzegovina": { gdp: 8000, pop: 3.2, trad: 5, rank: 64 },
  "qatar": { gdp: 85000, pop: 2.9, trad: 4, rank: 56 },
  "brazil": { gdp: 10000, pop: 216, trad: 10, rank: 6 },
  "morocco": { gdp: 3800, pop: 37, trad: 8, rank: 7 },
  "scotland": { gdp: 52000, pop: 5.5, trad: 6, rank: 42 },
  "haiti": { gdp: 1800, pop: 11.5, trad: 5, rank: 83 },
  "usa": { gdp: 82000, pop: 335, trad: 5, rank: 17 },
  "australia": { gdp: 65000, pop: 26, trad: 4, rank: 27 },
  "paraguay": { gdp: 6500, pop: 6.8, trad: 6, rank: 41 },
  "turkiye": { gdp: 13000, pop: 86, trad: 6, rank: 22 },
  "germany": { gdp: 54000, pop: 84, trad: 10, rank: 10 },
  "ivory coast": { gdp: 2800, pop: 29, trad: 7, rank: 33 },
  "ecuador": { gdp: 6500, pop: 18, trad: 5, rank: 23 },
  "curacao": { gdp: 20000, pop: 0.15, trad: 3, rank: 82 },
  "sweden": { gdp: 58000, pop: 10.5, trad: 6, rank: 38 },
  "japan": { gdp: 34000, pop: 123, trad: 6, rank: 18 },
  "netherlands": { gdp: 63000, pop: 18, trad: 9, rank: 8 },
  "tunisia": { gdp: 4200, pop: 12, trad: 6, rank: 45 },
  "new zealand": { gdp: 48000, pop: 5.2, trad: 3, rank: 85 },
  "ir iran": { gdp: 5000, pop: 89, trad: 6, rank: 20 },
  "belgium": { gdp: 54000, pop: 11.7, trad: 7, rank: 9 },
  "egypt": { gdp: 4300, pop: 112, trad: 6, rank: 29 },
  "uruguay": { gdp: 22000, pop: 3.4, trad: 9, rank: 16 },
  "saudi arabia": { gdp: 32000, pop: 36, trad: 5, rank: 61 },
  "spain": { gdp: 33000, pop: 48, trad: 9, rank: 2 },
  "cape verde": { gdp: 4200, pop: 0.6, trad: 4, rank: 67 },
  "norway": { gdp: 90000, pop: 5.5, trad: 4, rank: 31 },
  "france": { gdp: 44000, pop: 68, trad: 10, rank: 3 },
  "senegal": { gdp: 1700, pop: 18, trad: 6, rank: 15 },
  "iraq": { gdp: 5900, pop: 45, trad: 4, rank: 57 },
  "argentina": { gdp: 13500, pop: 46, trad: 10, rank: 1 },
  "austria": { gdp: 53000, pop: 9.1, trad: 5, rank: 24 },
  "jordan": { gdp: 4500, pop: 11.3, trad: 3, rank: 63 },
  "algeria": { gdp: 4900, pop: 46, trad: 6, rank: 28 },
  "colombia": { gdp: 6600, pop: 52, trad: 7, rank: 13 },
  "congo dr": { gdp: 650, pop: 102, trad: 4, rank: 46 },
  "portugal": { gdp: 28000, pop: 10.3, trad: 7, rank: 5 },
  "uzbekistan": { gdp: 2500, pop: 36, trad: 3, rank: 50 },
  "england": { gdp: 49000, pop: 57, trad: 8, rank: 4 },
  "ghana": { gdp: 2400, pop: 34, trad: 6, rank: 73 },
  "panama": { gdp: 17000, pop: 4.4, trad: 4, rank: 34 },
  "croatia": { gdp: 21000, pop: 3.9, trad: 7, rank: 11 }
};

function klementLine(teamName) {
  const k = KLEMENT_DATA[(teamName || "").trim().toLowerCase()];
  if (!k) return "sin datos estructurales";
  return `PIB/cápita ~$${k.gdp.toLocaleString("en-US")}, población ~${k.pop}M, tradición futbolística ${k.trad}/10, ranking FIFA #${k.rank}`;
}

function formLine(teamId, matches) {
  // Resume la forma real del torneo para este equipo hasta ahora: PJ, G-E-P,
  // goles a favor/contra, a partir de los partidos ya jugados/en vivo.
  const played = matches.filter(m =>
    (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId) &&
    (m.status === "FINISHED" || m.status === "IN_PLAY" || m.status === "PAUSED") &&
    m.score?.fullTime?.home != null
  );
  if (played.length === 0) return "todavía sin partidos jugados en este Mundial";
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const m of played) {
    const isHome = m.homeTeam.id === teamId;
    const gFor = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const gAgainst = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    gf += gFor; ga += gAgainst;
    if (gFor > gAgainst) w++; else if (gFor < gAgainst) l++; else d++;
  }
  return `${played.length} jugados (${w}G-${d}E-${l}P), goles ${gf}-${ga} en el torneo`;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  connectLambda(event);

  const apiKey = process.env.FOOTBALL_DATA_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !anthropicKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Faltan FOOTBALL_DATA_KEY o ANTHROPIC_API_KEY en las variables de entorno." }) };
  }

  const dateKey = todayUTC();
  const store = getStore("predictions");

  // Idempotencia: si ya generamos las predicciones de hoy, no gastamos otra
  // llamada a la API de Anthropic ni la re-disparamos por accidente.
  const existing = await store.get(dateKey, { type: "json" }).catch(() => null);
  if (existing) {
    console.log(`Ya existían predicciones para ${dateKey} (${existing.predictions?.length ?? 0}), no se vuelve a llamar a la IA.`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "ya existían predicciones para " + dateKey }) };
  }

  try {
    // 1) Partidos de hoy (UTC) que todavía no arrancan.
    const matchesRes = await fetch(`https://api.football-data.org/v4/competitions/WC/matches`, {
      headers: { "X-Auth-Token": apiKey }
    });
    if (!matchesRes.ok) throw new Error(`football-data.org respondió ${matchesRes.status}`);
    const matchesData = await matchesRes.json();
    const allMatches = matchesData.matches || [];

    // En vez de comparar "misma fecha de calendario UTC que hoy" (lo cual
    // se rompe con partidos que arrancan tarde en EUA/México y cruzan a la
    // madrugada UTC del día siguiente), buscamos cualquier partido que
    // arranque dentro de las próximas 24h — sin importar en qué día
    // calendario UTC caiga. También aceptamos status "TIMED" además de
    // "SCHEDULED", ya que football-data.org usa "TIMED" una vez que la
    // hora de inicio está confirmada (que es el caso normal del Mundial).
    const NOW = Date.now();
    const WINDOW_MS = 24 * 60 * 60 * 1000;
    const todays = allMatches.filter(m => {
      if (m.status !== "SCHEDULED" && m.status !== "TIMED") return false;
      if (!m.utcDate) return false;
      const kickoff = new Date(m.utcDate).getTime();
      return kickoff >= NOW && kickoff <= NOW + WINDOW_MS;
    });
    console.log(`Partidos totales en el feed: ${allMatches.length}. Pendientes en las próximas 24h: ${todays.length}.`);

    if (todays.length === 0) {
      console.log("No hay partidos SCHEDULED/TIMED en las próximas 24h. No se llamó a la IA, y no se guarda nada (así un reintento más tarde hoy sí vuelve a checar).");
      return { statusCode: 200, body: JSON.stringify({ ok: true, count: 0, note: "no hay partidos en las próximas 24h" }) };
    }

    // 2) Construir el contexto de cada partido: piso estructural (Klement) +
    //    forma real del torneo hasta ahora.
    const matchBlocks = todays.map(m => {
      const home = m.homeTeam, away = m.awayTeam;
      return `Partido: ${home.name} vs ${away.name} (${m.stage}${m.group ? ", " + m.group : ""})
- ${home.name} — estructural: ${klementLine(home.name)}; forma en el torneo: ${formLine(home.id, allMatches)}
- ${away.name} — estructural: ${klementLine(away.name)}; forma en el torneo: ${formLine(away.id, allMatches)}
- id_partido: ${m.id}`;
    }).join("\n\n");

    const systemPrompt = `Eres parte de una app de seguimiento del Mundial 2026 hecha para uso personal/entre amigos. Tu trabajo es predecir el marcador de los partidos de hoy.

Tienes dos tipos de información para cada partido: (1) un "piso estructural" inspirado en el modelo del economista Joachim Klement (PIB per cápita, población, tradición futbolística, ranking FIFA) — esto es solo un punto de partida, NO una fórmula que debas seguir mecánicamente; y (2) la forma real de cada equipo en lo que va del torneo.

Tienes total libertad para no basarte solo en las estadísticas: puedes meter intuición, narrativa, "cosas raras" (rachas, paridad de apellidos, lo que se te ocurra que sea divertido), igual que haría un amigo que sabe de fútbol prediciendo entre cervezas. No tienes que ser conservador ni "razonable" — está bien predecir una sorpresa si tu instinto te lo dice.

Responde ÚNICAMENTE con un array JSON válido, sin texto antes ni después, con este formato exacto:
[{"matchId": 12345, "homeGoals": 2, "awayGoals": 1, "reasoning": "una o dos frases en español, con personalidad, máximo ~30 palabras"}]`;

    const userPrompt = `Predice el marcador de estos partidos de hoy:\n\n${matchBlocks}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Anthropic API respondió ${aiRes.status}: ${errText}`);
    }
    const aiData = await aiRes.json();
    const text = (aiData.content || []).map(b => b.text || "").join("").trim();

    let predictions;
    try {
      const clean = text.replace(/^```json\s*|```\s*$/g, "").trim();
      predictions = JSON.parse(clean);
    } catch (parseErr) {
      throw new Error("No se pudo interpretar la respuesta de la IA como JSON: " + text.slice(0, 300));
    }

    // Enriquecemos cada predicción con los nombres de equipo (para no
    // depender de que el frontend tenga que re-cruzar todo por id).
    const enriched = predictions.map(p => {
      const m = todays.find(mm => mm.id === p.matchId);
      return {
        ...p,
        homeTeamName: m ? m.homeTeam.name : null,
        awayTeamName: m ? m.awayTeam.name : null,
        homeTeamId: m ? m.homeTeam.id : null,
        awayTeamId: m ? m.awayTeam.id : null
      };
    });

    await store.setJSON(dateKey, {
      date: dateKey,
      generatedAt: new Date().toISOString(),
      predictions: enriched
    });

    console.log(`Listo: ${enriched.length} predicciones generadas y guardadas para ${dateKey}.`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, count: enriched.length }) };
  } catch (err) {
    console.log("ERROR en predict.js: " + String(err));
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
