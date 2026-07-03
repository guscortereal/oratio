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
      max_tokens: 2000,
      temperature: 0.7,
      system: prompt,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseJsonLoose(text);
}

function parseJsonLoose(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Resposta do modelo não é JSON válido:\n' + text.slice(0, 400));
  }
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

async function main() {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY não definida.');

  const prompt = await readFile(PROMPT_PATH, 'utf8');
  console.log('→ Buscando liturgia do dia…');
  const liturgy = await fetchLiturgy();
  console.log(`  Evangelho: ${liturgy.evangelho.referencia} — ${liturgy.liturgia}`);

  console.log(`→ Gerando centelha com ${MODEL}…`);
  const r = await generateReflection(prompt, liturgy);

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
      tituloBreve: r.tituloBreve || '',
      corpo: r.corpo || '',
      paraSilencio: r.paraSilencio || '',
      proposito: r.proposito || '',
      ancora: r.ancora || '',
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
