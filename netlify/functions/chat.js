// Função do Netlify: recebe a pergunta do Drakus e responde usando a Groq.
// A chave fica na variável de ambiente GROQ_API_KEY (nunca no index.html).
// Os modelos da Groq mudam com frequência: a função pergunta à Groq quais existem
// e usa o primeiro disponível da lista de preferência abaixo.
const BASE =
  "Você é o Drakus, um mini robô assistente pessoal com rosto de dragão. " +
  "Responda sempre em português do Brasil, de forma natural. " +
  "As perguntas chegam por reconhecimento de voz ou digitadas e podem ter palavras erradas, sem pontuação ou estar um pouco cortadas: " +
  "interprete pelo contexto e responda direto, do melhor jeito possível. " +
  "Só peça para repetir se for realmente impossível entender.";

const CANAL = {
  voz: "Sua resposta será falada em voz alta, então não use markdown, listas, símbolos nem emojis.",
  texto:
    "Sua resposta será lida na tela: pode usar quebras de linha e listas curtas com hífen, mas não use markdown (nada de asteriscos ou #) nem emojis. " +
    "A única exceção é código: sempre que mostrar código, coloque-o dentro de um bloco com três crases e o nome da linguagem.",
};

const TAMANHO = {
  curta: { texto: "Responda com no máximo 3 frases.", tokens: 500 },
  media: { texto: "Responda com no máximo 6 frases; se pedirem mais detalhes, pode usar até 12.", tokens: 1400 },
  longa: {
    texto:
      "Responda com no máximo 1000 palavras. Perguntas simples merecem respostas curtas; quando o assunto pedir explicação, história ou detalhes, pode se alongar.",
    tokens: 4096,
  },
};

const IDIOMAS = {
  ingles: "inglês",
  espanhol: "espanhol",
  frances: "francês",
  alemao: "alemão",
  italiano: "italiano",
  japones: "japonês",
  portugues: "português do Brasil",
};

const TONS = {
  formal: "Reescreva o texto enviado em um tom mais formal e profissional, mantendo o sentido. Devolva só o texto reescrito.",
  informal: "Reescreva o texto enviado em um tom mais informal e descontraído, mantendo o sentido. Devolva só o texto reescrito.",
  curto: "Reescreva o texto enviado de forma bem mais curta, mantendo as ideias principais. Devolva só o texto reescrito.",
};

const LINGUAGENS = {
  auto: null,
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  sql: "SQL",
  html: "HTML e CSS",
  bash: "Bash (shell)",
};

const REGRA_CODIGO =
  " Esta tarefa é exceção à regra de não usar markdown: coloque TODO código dentro de blocos com três crases e o nome da linguagem " +
  "(por exemplo ```python), e fora dos blocos escreva texto simples em português do Brasil. Os comentários dentro do código também em português.";

const TAREFAS_CODIGO = {
  criar: (L) =>
    "Escreva o código " + (L ? "em " + L : "na linguagem mais adequada ao pedido (use Python se o usuário não indicar uma)") +
    " que atenda ao pedido. Entregue o código completo e funcionando em um único bloco, com comentários curtos nos pontos importantes. " +
    "Depois do bloco, explique em até 5 linhas como executar e usar." + REGRA_CODIGO,
  explicar: (L) =>
    "Explique o código enviado" + (L ? " (" + L + ")" : "") + " por partes, em português simples, para quem está aprendendo. " +
    "Não reescreva o código inteiro; cite só os trechos necessários, cada um em um bloco." + REGRA_CODIGO,
  corrigir: (L) =>
    "Encontre e corrija os erros no código enviado" + (L ? " (" + L + ")" : "") + " (e na mensagem de erro, se vier junto). " +
    "Mostre primeiro o código corrigido completo em um bloco e depois explique em até 5 itens o que estava errado." + REGRA_CODIGO,
  converter: (L) =>
    "Converta o código enviado para " + (L || "Python") + ", mantendo o mesmo comportamento. " +
    "Mostre o código convertido completo em um bloco e depois liste em até 4 itens as diferenças importantes." + REGRA_CODIGO,
  melhorar: (L) =>
    "Melhore o código enviado" + (L ? " (" + L + ")" : "") + ": deixe-o mais limpo, legível e eficiente, com comentários. " +
    "Mostre o código melhorado completo em um bloco e liste em até 5 itens o que mudou." + REGRA_CODIGO,
};

const MODOS = {
  professor:
    "Você é um professor paciente. Explique o assunto passo a passo, em linguagem simples e com exemplos. " +
    "Ao final de cada explicação, faça UMA pergunta curta para verificar se o aluno entendeu e espere a resposta. Corrija com gentileza.",
  resumir:
    "Resuma o texto enviado em tópicos curtos (no máximo 8, cada um começando com hífen) e termine com uma frase com a ideia principal.",
  cartoes:
    "Crie 6 cartões de revisão sobre o assunto ou texto enviado. Use exatamente o formato: " +
    "Cartão 1\nPergunta: ...\nResposta: ...\n(e assim por diante), com uma linha em branco entre os cartões.",
  quiz:
    "Conduza um quiz sobre o assunto enviado. Faça UMA pergunta de múltipla escolha por vez, com alternativas A, B, C e D, e espere a resposta. " +
    "Depois diga se acertou, explique em uma ou duas frases e faça a próxima pergunta.",
  corrigir:
    "Corrija a ortografia, a gramática e a pontuação do texto enviado, sem mudar o sentido. " +
    "Devolva primeiro o texto corrigido e depois, em até 5 itens, as principais correções feitas.",
};

// Só aceita modos conhecidos (o navegador não consegue enviar instruções livres)
function instrucaoDoModo(modo) {
  if (typeof modo !== "string" || !modo) return null;
  const [base, arg, arg2] = modo.split(":");
  if (base === "codigo") {
    const ok = Object.prototype.hasOwnProperty;
    if (ok.call(TAREFAS_CODIGO, arg) && ok.call(LINGUAGENS, arg2)) return TAREFAS_CODIGO[arg](LINGUAGENS[arg2]);
    return null;
  }
  if (base === "traduzir" && IDIOMAS[arg]) {
    return "Traduza o texto enviado para " + IDIOMAS[arg] + ". Devolva apenas a tradução, sem comentários.";
  }
  if (base === "reescrever" && TONS[arg]) return TONS[arg];
  if (!arg && MODOS[base]) return MODOS[base];
  return null;
}

function montarPrompt(body) {
  const perfil = body && typeof body.perfil === "object" && body.perfil ? body.perfil : {};
  const canal = CANAL[body && body.canal] ? body.canal : "voz";
  const tam = TAMANHO[perfil.tamanho] ? perfil.tamanho : "longa";
  const nome = String(perfil.nome || "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 30);
  const instrucao = instrucaoDoModo(body && body.modo);

  let system = BASE + " " + CANAL[canal];
  if (nome) system += " O nome do usuário é " + nome + "; chame-o pelo nome de vez em quando, sem exagero.";
  if (instrucao) {
    system += " TAREFA ESPECIAL (tem prioridade sobre qualquer limite de frases; no máximo 1000 palavras): " + instrucao;
  } else {
    system += " " + TAMANHO[tam].texto;
  }
  const ehCodigo = instrucao && String((body && body.modo) || "").startsWith("codigo:");
  return { system, maxTokens: ehCodigo ? 4096 : instrucao ? 3000 : TAMANHO[tam].tokens };
}

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
    const dados = JSON.parse(event.body || "{}");
    const history = Array.isArray(dados.history) ? dados.history : [];
    const message = typeof dados.message === "string" ? dados.message.slice(0, 12000) : "";
    const { system, maxTokens } = montarPrompt(dados);
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Mensagem vazia" }) };
    }
    const past = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10);
    while (past.length && past[0].role !== "user") past.shift();
    const messages = [{ role: "system", content: system }, ...past, { role: "user", content: message }];

    // ordem de tentativa: modelo escolhido por você, preferidos que existem, e qualquer modelo de chat
    const existentes = await modelosDisponiveis(key);
    const pedido = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL] : [];
    const preferidos = existentes.length ? PREFERIDOS.filter((m) => existentes.includes(m)) : PREFERIDOS;
    const outros = existentes.filter((m) => !NAO_CHAT.test(m) && !PREFERIDOS.includes(m));
    const fila = [...new Set([...pedido, ...preferidos, ...outros])].slice(0, 6);
    if (!fila.length) fila.push(...PREFERIDOS);

    let lastError = "Erro na API";
    for (const model of fila) {
      const body = { model, messages, max_tokens: maxTokens, temperature: 0.7 };
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
