// Função do Netlify: recebe um áudio (WAV em base64) e devolve o texto, usando o Whisper da Groq.
// Usa a mesma variável GROQ_API_KEY do chat.js.
const PREFERIDOS = ["whisper-large-v3-turbo", "whisper-large-v3"];
let cache = { quando: 0, lista: [] };

async function modelosWhisper(key) {
  if (Date.now() - cache.quando < 10 * 60 * 1000 && cache.lista.length) return cache.lista;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: "Bearer " + key } });
    const d = await r.json();
    const ids = ((d && d.data) || []).map((m) => m.id).filter((id) => id && /whisper/i.test(id));
    if (ids.length) cache = { quando: Date.now(), lista: ids };
    return ids;
  } catch (e) {
    return [];
  }
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  const key = process.env.GROQ_API_KEY;
  if (event.httpMethod === "GET") {
    const ids = key ? await modelosWhisper(key) : [];
    return resp(200, { funcao: "ok", tipo: "transcricao", chaveConfigurada: !!key, modelosWhisper: ids });
  }
  if (event.httpMethod !== "POST") return resp(405, { error: "Método não permitido" });
  try {
    if (!key) return resp(502, { error: "API key not configured" });
    const { audio } = JSON.parse(event.body || "{}");
    if (!audio) return resp(400, { error: "Áudio vazio" });
    if (audio.length > 5.5 * 1024 * 1024) return resp(413, { error: "Áudio muito longo" });
    const bytes = Buffer.from(audio, "base64");

    const existentes = await modelosWhisper(key);
    const pedido = process.env.GROQ_STT_MODEL ? [process.env.GROQ_STT_MODEL] : [];
    const preferidos = existentes.length ? PREFERIDOS.filter((m) => existentes.includes(m)) : PREFERIDOS;
    const outros = existentes.filter((m) => !PREFERIDOS.includes(m) && !/distil|\.en$/i.test(m));
    const fila = [...new Set([...pedido, ...preferidos, ...outros])].slice(0, 3);
    if (!fila.length) fila.push(...PREFERIDOS);

    let lastError = "Erro na API";
    for (const model of fila) {
      const fd = new FormData();
      fd.append("file", new Blob([bytes], { type: "audio/wav" }), "fala.wav");
      fd.append("model", model);
      fd.append("language", "pt");
      fd.append("temperature", "0");
      fd.append("response_format", "verbose_json");
      const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: "Bearer " + key },
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = String(data.text || "").trim();
        const segs = Array.isArray(data.segments) ? data.segments : [];
        const semFala = segs.length > 0 && segs.every((s) => typeof s.no_speech_prob === "number" && s.no_speech_prob > 0.6);
        const alucinacao = /amara\.org|legendas? (pela|por|de)|www\.|inscreva-se/i.test(text);
        if (!text || semFala || alucinacao) return resp(200, { text: "", ruido: true });
        return resp(200, { text });
      }
      lastError = (data.error && data.error.message) || "Erro na API";
      const erroDeModelo = r.status === 404 || r.status === 429 || (r.status === 400 && /model/i.test(lastError));
      if (!erroDeModelo) break;
    }
    return resp(502, { error: lastError });
  } catch (e) {
    return resp(500, { error: "Falha ao transcrever o áudio" });
  }
};
