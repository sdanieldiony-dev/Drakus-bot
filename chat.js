// Função do Netlify: recebe a pergunta do Drakus e responde usando a Groq.
// A chave fica na variável de ambiente GROQ_API_KEY (nunca no index.html).
const SYSTEM =
  "Você é o Drakus, um mini robô assistente pessoal com rosto de dragão. " +
  "Responda sempre em português do Brasil, de forma natural e curta (no máximo 2 ou 3 frases). " +
  "Suas respostas serão faladas em voz alta, então não use markdown, listas, símbolos nem emojis.";

exports.handler = async (event) => {
  // Abrir /.netlify/functions/chat no navegador mostra se a chave foi configurada (sem revelar a chave)
  if (event.httpMethod === "GET") {
    const k = process.env.GROQ_API_KEY || "";
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ funcao: "ok", provedor: "groq", chaveConfigurada: !!k, comecaComGsk: k.startsWith("gsk_") }),
    };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método não permitido" }) };
  }
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      return { statusCode: 502, body: JSON.stringify({ error: "API key not configured" }) };
    }
    const { message, history = [] } = JSON.parse(event.body || "{}");
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mensagem vazia" }) };
    }
    const past = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10);
    while (past.length && past[0].role !== "user") past.shift();
    const messages = [{ role: "system", content: SYSTEM }, ...past, { role: "user", content: message }];

    const models = [process.env.GROQ_MODEL, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"].filter(Boolean);
    let lastError = "Erro na API";
    for (const model of models) {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({ model, messages, max_tokens: 400, temperature: 0.7 }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const reply = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
        if (reply) {
          return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ reply }) };
        }
        lastError = "A IA respondeu vazio";
        break;
      }
      lastError = (data.error && data.error.message) || "Erro na API";
      // modelo inexistente ou limite desse modelo: tenta o próximo; outro erro (ex.: chave inválida), para
      if (r.status !== 404 && r.status !== 429) break;
    }
    return { statusCode: 502, body: JSON.stringify({ error: lastError }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Falha ao falar com a IA" }) };
  }
};
