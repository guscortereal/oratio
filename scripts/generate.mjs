// Oratio — gerador diário da centelha sobre o Evangelho do dia.
//
// Fluxo:
//   1. Busca a liturgia do dia (Evangelho + 1ª leitura) numa API pública brasileira.
//   2. Chama a API da Anthropic com a variante pública do agente comes_orationis,
//      passando o texto integral do Evangelho, e recebe a reflexão em JSON.
//   3. Busca no Wikimedia Commons uma imagem de arte sacra ligada ao tema do Evangelho,
//      com metadados de autoria e licença (atribuição obrigatória).
//   4. Grava reflections/<AAAA-MM-DD>.json, reflections/latest.json e atualiza o índice.
//
// Requisitos: Node 18+ (fetch nativo). Variáveis de ambiente:
//   ANTHROPIC_API_KEY  (obrigatória)
//   ANTHROPIC_MODEL    (opcional, padrão claude-sonnet-5)
//   TZ                 (recomendado America/Sao_Paulo, definido no workflow)

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REFLECTIONS_DIR = join(ROOT, 'reflections');
const PROMPT_PATH = join(ROOT, 'prompts', 'comes_orationis_public.md');

const LITURGY_URL = 'https://liturgia.up.railway.app/v2/';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const COMMONS_URL = 'https://commons.wikimedia.org/w/api.php';
const UA = 'OratioDaily/1.0 (https://github.com/) reflexao-diaria';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

function isoDateSaoPaulo() {
  // Usa o fuso definido em TZ (America/Sao_Paulo no workflow) para carimbar o dia.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA => AAAA-MM-DD
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// APIs externas oscilam; uma falha transitória não pode desperdiçar a janela
// de execução do dia. Tenta de novo com espera crescente antes de desistir.
async function withRetry(fn, label, attempts = 3, delayMs = 30000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`  ${label}: tentativa ${i}/${attempts} falhou — ${err.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}

async function fetchLiturgy() {
  const res = await fetch(LITURGY_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Liturgia API ${res.status}`);
  const j = await res.json();
  const ev = (j?.leituras?.evangelho || [])[0];
  if (!ev?.texto) throw new Error('Evangelho não encontrado na resposta da liturgia');
  const primeira = (j?.leituras?.primeiraLeitura || [])[0];
  return {
    data: j?.data || '',
    liturgia: j?.liturgia || '',
    cor: j?.cor || '',
    evangelho: { referencia: ev.referencia || '', titulo: ev.titulo || '', texto: ev.texto || '' },
    primeiraLeitura: primeira
      ? { referencia: primeira.referencia || '', texto: primeira.texto || '' }
      : null,
  };
}

async function generateReflection(prompt, liturgy) {
  const primeira = liturgy.primeiraLeitura
    ? `\n\n1ª leitura do dia (${liturgy.primeiraLeitura.referencia}) — lente OPCIONAL, nunca o assunto:\n${liturgy.primeiraLeitura.texto}`
    : '';
  const userMsg =
    `Dia litúrgico: ${liturgy.liturgia} (cor ${liturgy.cor}), data ${liturgy.data}.\n\n` +
    `EVANGELHO DO DIA — ${liturgy.evangelho.referencia}\n${liturgy.evangelho.texto}` +
    primeira +
    `\n\nRedija a centelha seguindo estritamente o seu protocolo e devolva APENAS o JSON especificado em <#OUTPUT>.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: prompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Resposta truncada pelo limite de tokens; aumente max_tokens.');
  }
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseJsonLoose(text);
}

function parseJsonLoose(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* tenta o próximo */ }
    // Modelos às vezes emitem quebras de linha literais dentro das strings JSON,
    // o que o JSON.parse rejeita; troca controles por espaço e tenta de novo.
    try { return JSON.parse(Array.from(c, (ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("")); } catch { /* idem */ }
  }
  throw new Error('Resposta do modelo não é JSON válido:\n' + text.slice(0, 400));
}

async function searchCommonsImage(queries) {
  for (const q of queries || []) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: `filetype:bitmap ${q}`,
        gsrnamespace: '6',
        gsrlimit: '10',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '1600',
        format: 'json',
      });
      const res = await fetch(`${COMMONS_URL}?${params}`, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const j = await res.json();
      const pages = Object.values(j?.query?.pages || {}).sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      );
      for (const p of pages) {
        const ii = (p.imageinfo || [])[0];
        if (!ii?.thumburl) continue;
        const title = (p.title || '').toLowerCase();
        // Evita logotipos, ícones, bandeiras, mapas e afins.
        if (/(logo|icon|flag|map|coat of arms|diagram|chart)/.test(title)) continue;
        const m = ii.extmetadata || {};
        return {
          query: q,
          title: (p.title || '').replace(/^File:/, ''),
          src: ii.thumburl,
          fullSrc: ii.url,
          descriptionUrl: ii.descriptionurl || '',
          artist: stripHtml(m.Artist?.value) || 'Autor desconhecido',
          credit: stripHtml(m.Credit?.value),
          license: stripHtml(m.LicenseShortName?.value) || '',
          licenseUrl: (m.LicenseUrl?.value || '').trim(),
        };
      }
    } catch (e) {
      console.warn(`Busca de imagem falhou para "${q}": ${e.message}`);
    }
  }
  return null;
}

function countChars(s) {
  return (s || '').length;
}

// Modelos às vezes escapam demais e a string já parseada ainda carrega
// sequências literais \" e \n; converte de volta para os caracteres reais.
function unescapeStray(s) {
  return (s || '').split('\\n').join('\n').split('\\"').join('"');
}

async function main() {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não definida.');

  // O workflow roda várias vezes por dia (o agendador do GitHub atrasa);
  // se a centelha de hoje já existe, não há nada a fazer.
  const today = isoDateSaoPaulo();
  if (existsSync(join(REFLECTIONS_DIR, `${today}.json`)) && process.env.FORCE_REGEN !== '1') {
    console.log(`✓ Centelha de ${today} já existe; nada a fazer.`);
    return;
  }

  const prompt = await readFile(PROMPT_PATH, 'utf8');
  console.log('→ Buscando liturgia do dia…');
  const liturgy = await withRetry(fetchLiturgy, 'liturgia');
  console.log(`  Evangelho: ${liturgy.evangelho.referencia} — ${liturgy.liturgia}`);

  console.log(`→ Gerando centelha com ${MODEL}…`);
  const r = await withRetry(() => generateReflection(prompt, liturgy), 'geração');

  console.log('→ Buscando imagem no Wikimedia Commons…');
  const image = await searchCommonsImage(r.imageQueries);
  if (image) console.log(`  Imagem: ${image.title} (${image.license})`);
  else console.warn('  Nenhuma imagem encontrada; seguindo sem imagem.');

  const date = isoDateSaoPaulo();
  const record = {
    date,
    liturgia: liturgy.liturgia,
    cor: liturgy.cor,
    evangelho: liturgy.evangelho,
    primeiraLeitura: liturgy.primeiraLeitura,
    reflexao: {
      tituloBreve: unescapeStray(r.tituloBreve),
      corpo: unescapeStray(r.corpo),
      paraSilencio: unescapeStray(r.paraSilencio),
      proposito: unescapeStray(r.proposito),
      ancora: unescapeStray(r.ancora),
      imageTheme: r.imageTheme || '',
    },
    image,
    meta: {
      model: MODEL,
      geradoEm: new Date().toISOString(),
      caracteres: countChars(r.corpo),
    },
  };

  if (!existsSync(REFLECTIONS_DIR)) await mkdir(REFLECTIONS_DIR, { recursive: true });
  const dayPath = join(REFLECTIONS_DIR, `${date}.json`);
  await writeFile(dayPath, JSON.stringify(record, null, 2), 'utf8');
  await writeFile(join(REFLECTIONS_DIR, 'latest.json'), JSON.stringify(record, null, 2), 'utf8');

  // Atualiza o índice (lista de dias, mais recente primeiro).
  const indexPath = join(REFLECTIONS_DIR, 'index.json');
  let index = [];
  if (existsSync(indexPath)) {
    try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch { index = []; }
  }
  const entry = { date, referencia: liturgy.evangelho.referencia, titulo: r.tituloBreve || '' };
  index = index.filter((e) => e.date !== date);
  index.unshift(entry);
  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');

  console.log(`✓ Centelha de ${date} gravada (${record.meta.caracteres} caracteres).`);
}

main().catch((err) => {
  console.error('✗ Falha na geração:', err.message);
  process.exit(1);
});
