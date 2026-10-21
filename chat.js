// Função do Netlify: recebe a pergunta do Drakus e responde usando a Groq.
// A chave fica na variável de ambiente GROQ_API_KEY (nunca no index.html).
// Os modelos da Groq mudam com frequência: a função pergunta à Groq quais existem
// e usa o primeiro disponível da lista de preferência abaixo.
const SYSTEM =
  "Você é o Drakus, um mini robô assistente pessoal com rosto de dragão. " +
  "Responda sempre em português do Brasil, de forma natural e curta (no máximo 2 ou 3 frases). " +
  "Suas respostas serão faladas em voz alta, então não use markdown, listas, símbolos nem emojis. " +
  "As perguntas chegam por reconhecimento de voz e podem ter palavras erradas, sem pontuação ou estar um pouco cortadas: " +
  "interprete pelo contexto e responda direto, do melhor jeito possível. " +
  "Só peça para repetir se for realmente impossível entender.";

const PREFERIDOS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"];
const NAO_CHAT = /whisper|guard|tts|orpheus|compound|embed|vision-only|safeguard/i;

let cache = { quando: 0, lista: [] };

async function modelosDisponiveis(key) {
  if (Date.now() - cache.quando < 10 * 60 * 1000 && cache.lista.length) return cache.lista;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: "Bearer " + key },
    });
    const d = await r.json();
    const ids = ((d && d.data) || []).map((m) => m.id).filter(Boolean);
    if (ids.length) cache = { quando: Date.now(), lista: ids };
    return ids;
  } catch (e) {
    return [];
  }
}

exports.handler = async (event) => {
  // Abrir /.netlify/functions/chat no navegador mostra se a chave foi configurada (sem revelar a chave)
  if (event.httpMethod === "GET") {
    const k = process.env.GROQ_API_KEY || "";
    const ids = k ? await modelosDisponiveis(k) : [];
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        funcao: "ok",
        provedor: "groq",
        chaveConfigurada: !!k,
        comecaComGsk: k.startsWith("gsk_"),
        modelosEncontrados: ids.length,
      }),
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

    // ordem de tentativa: modelo escolhido por você, preferidos que existem, e qualquer modelo de chat
    const existentes = await modelosDisponiveis(key);
    const pedido = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : [];
    const preferidos = existentes.length ? PREFERIDOS.filter((m) => existentes.includes(m)) : PREFERIDOS;
    const outros = existentes.filter((m) => !NAO_CHAT.test(m) && !PREFERIDOS.includes(m));
    const fila = [...new Set([...pedido, ...preferidos, ...outros])].slice(0, 6);
    if (!fila.length) fila.push(...PREFERIDOS);

    let lastError = "Erro na API";
    for (const model of fila) {
      const body = { model, messages, max_tokens: 1024, temperature: 0.7 };
      if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        let reply = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "")
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .trim();
        if (reply) {
          return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ reply }) };
        }
        lastError = "A IA respondeu vazio";
        continue;
      }
      lastError = (data.error && data.error.message) || "Erro na API";
      // modelo sumiu, desativado ou no limite: tenta o próximo; chave inválida etc. para aqui
      const erroDeModelo = r.status === 404 || r.status === 429 || (r.status === 400 && /model/i.test(lastError));
      if (!erroDeModelo) break;
    }
    return { statusCode: 502, body: JSON.stringify({ error: lastError }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Falha ao falar com a IA" }) };
  }
};
