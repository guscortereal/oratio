# Oratio — Centelha diária sobre o Evangelho

Uma página estática que, **todos os dias**, publica uma reflexão para a oração mental
sobre o **Evangelho do dia**, no espírito de São Josemaría Escrivá, acompanhada de uma
obra de **arte sacra do Wikimedia Commons** ligada ao tema do Evangelho.

O texto é gerado pela **variante pública** do agente *Comes Orationis* (`prompts/comes_orationis_public.md`):
mesmo método do agente pessoal (primazia do Evangelho, uma só ideia, uma só âncora,
teste da subtração, fecho na filiação divina), mas dirigido a um leitor genérico e
**sem minerar dados pessoais** — seguro para uma página pública.

## Como funciona

```
┌─ GitHub Actions (cron 05:30 America/Sao_Paulo) ─────────────┐
│ 1. scripts/generate.mjs busca a liturgia do dia             │
│    (Evangelho + 1ª leitura) em liturgia.up.railway.app      │
│ 2. chama a API da Anthropic com o prompt do agente          │
│    → reflexão em JSON (título, corpo, silêncio, propósito)   │
│ 3. busca no Wikimedia Commons uma imagem do tema            │
│    (com autoria + licença para atribuição)                  │
│ 4. grava reflections/<data>.json + latest.json + index.json │
│ 5. faz commit e push                                        │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
  GitHub Pages serve index.html (estático), que carrega
  reflections/latest.json e renderiza a centelha do dia.
```

## Estrutura

| Caminho | O quê |
|---|---|
| `index.html`, `assets/` | a página (HTML/CSS/JS, sem build) |
| `prompts/comes_orationis_public.md` | o agente (variante pública) |
| `scripts/generate.mjs` | gerador diário (Node 18+) |
| `reflections/` | `latest.json`, um `AAAA-MM-DD.json` por dia, e `index.json` |
| `.github/workflows/daily.yml` | o cron diário |

## Passo a passo para publicar (grátis)

### 1. Subir para o GitHub
Crie um repositório (ex.: `oratio`) e envie estes arquivos. Se tiver o Git instalado:

```bash
cd "C:/Users/Gustavo/OneDrive/Desktop/oratio"
git init
git add .
git commit -m "Oratio: centelha diária"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/oratio.git
git push -u origin main
```

Sem Git na linha de comando? Use o **GitHub Desktop** (interface gráfica) e arraste a
pasta.

### 2. Obter uma chave de API da Anthropic
1. Entre em <https://console.anthropic.com> → **API Keys** → **Create Key**.
2. Copie a chave (começa com `sk-ant-...`). Guarde bem: só aparece uma vez.
3. A geração diária custa **centavos por dia** (um único texto curto por dia).

### 3. Configurar o segredo no repositório
No GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- Nome: `ANTHROPIC_API_KEY`
- Valor: a sua chave `sk-ant-...`

(Opcional) Para trocar o modelo, crie uma **variável** (aba *Variables*) chamada
`ANTHROPIC_MODEL` com, por exemplo, `claude-opus-4-8` (mais fiel, um pouco mais caro)
ou `claude-sonnet-5` (padrão, ótimo custo-benefício).

### 4. Ativar o GitHub Pages
**Settings → Pages → Build and deployment → Source: Deploy from a branch**
→ Branch: `main`, pasta `/ (root)` → **Save**.
Em ~1 minuto a página estará em `https://<seu-usuario>.github.io/oratio/`.

### 5. Testar agora (sem esperar o cron)
**Actions → Centelha diária → Run workflow**. Ele gera a reflexão de hoje, comita e a
página se atualiza. A partir daí roda sozinho todo dia às **05:30** (horário de Brasília).

> O horário do cron do GitHub pode atrasar alguns minutos em picos — normal.
> Para mudar o horário, edite a linha `cron:` em `.github/workflows/daily.yml`
> (o valor está em UTC; 05:30 BRT = 08:30 UTC).

## Rodar o gerador localmente (opcional)
Requer Node 18+ instalado.
```bash
setx ANTHROPIC_API_KEY "sk-ant-..."   # ou export no bash/mac
node scripts/generate.mjs
```

## Créditos e limites
- **Liturgia**: API pública `liturgia.up.railway.app` (liturgia diária brasileira).
- **Imagens**: Wikimedia Commons, com atribuição de autor e licença exibida na página.
- Este é um **auxílio à oração** — não substitui direção espiritual, confissão nem o
  texto litúrgico oficial.
