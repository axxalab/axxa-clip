# Pôr o site e a prévia da interface no ar

Duas coisas do projeto são estáticas e dá para hospedar em qualquer lugar:

| | O que é | Onde mora |
|---|---|---|
| **Site** | a página inicial em pt-BR, a versão em inglês e a página de comparação | `docs/` |
| **Prévia da interface** | o HotClip rodando no navegador contra o provedor simulado — serve para conferir tradução, layout e fluxo sem instalar nada | build de `src/renderer` |

A prévia **não corta vídeo**: ela usa o `src/renderer/src/api/provider.ts`, que devolve uma
transcrição e candidatos de mentira. É para olhar a interface, não para produzir.

## Cloudflare Pages pelo painel (o caminho mais curto, sem CI)

Só para o site, sem a prévia — não precisa de build nenhum:

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Escolha o repositório e a branch
3. **Framework preset**: nenhum · **Build command**: deixe em branco · **Build output directory**: `docs`
4. Save and Deploy

Sai um `https://<projeto>.pages.dev`, e cada push republica.

## Cloudflare Pages com a prévia junto (pelo GitHub Actions)

O workflow [`pages-cloudflare.yml`](../.github/workflows/pages-cloudflare.yml) publica o site na
raiz e a prévia da interface em `/preview/`. Ele fica parado até você configurar, no repositório:

- **Settings → Secrets and variables → Actions → Variables**
  - `CLOUDFLARE_PAGES_PROJECT` = o nome do projeto no Pages
- **Settings → Secrets and variables → Actions → Secrets**
  - `CLOUDFLARE_API_TOKEN` = um token com a permissão **Cloudflare Pages: Edit**
  - `CLOUDFLARE_ACCOUNT_ID` = o id da conta (barra lateral do painel)

Depois disso ele roda a cada push que toque `docs/` ou `src/renderer/`, e também no botão
**Run workflow**.

## Rodar na sua máquina, sem publicar nada

```sh
pnpm dev:web                      # a prévia da interface, com recarga automática
python3 -m http.server -d docs 8080   # o site
```
