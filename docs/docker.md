# Rodar o HotClip em contêiner

Dá, mas com uma divisão que vale entender antes de começar: **a interface continua sendo o
aplicativo de desktop**, e o contêiner serve o caminho sem ninguém olhando.

| | Desktop (.exe / .dmg / .AppImage) | Docker |
|---|---|---|
| Mesa de revisão, linha do tempo, pré-visualização | sim | não (é uma janela do Electron) |
| Transcrever, buscar picos, cortar, enquadrar, exportar | sim | **sim** |
| Legenda ASS queimada | sim | **sim** |
| Legenda animada em Web | sim | não (é desenhada por um Chromium fora da tela; o caminho cai sozinho na ASS) |
| CLI e servidor MCP | sim | **sim** |
| Fila de arquivos / automação / agente | sim | **sim, é para isto** |

Nada no caminho sem interface depende do Electron — `src/cli`, `src/mcp`, `src/core` e
`src/shared` não importam `electron` em lugar nenhum, e é por isso que o contêiner é honesto em
vez de gambiarra com X11.

## Começar

```sh
docker compose build

mkdir -p media out
cp ~/Downloads/live.mp4 media/

# um corte de ponta a ponta
docker compose run --rm hotclip clip /media/live.mp4 --max-clips 5 --vertical --out /out

# só a transcrição, com o motor de português
docker compose run --rm hotclip transcribe /media/live.mp4 --engine parakeet --json
```

A primeira execução baixa os modelos (uns 500MB a 1GB, conforme os motores que você usar). Eles
ficam no volume `hotclip-data`, montado em `/data` — **não remova esse volume**, ou o download
recomeça. É a razão de o compose já vir com ele.

## Tudo local, sem nuvem nenhuma

A busca de picos precisa de um LLM. Para não mandar nem o texto para fora, suba o Ollama junto:

```sh
docker compose --profile local-llm up -d ollama
docker compose --profile local-llm exec ollama ollama pull qwen3:8b

docker compose run --rm hotclip clip /media/live.mp4 --max-clips 5 --vertical --out /out
```

O `HOTCLIP_LLM_BASE_URL` já aponta para `http://ollama:11434/v1` por padrão no compose. Para usar
um provedor de nuvem, sobrescreva as três variáveis:

```sh
HOTCLIP_LLM_BASE_URL=https://api.deepseek.com/v1 \
HOTCLIP_LLM_MODEL=deepseek-v4-flash \
HOTCLIP_LLM_API_KEY=sk-... \
docker compose run --rm hotclip highlights /media/live.mp4 --json
```

## O servidor MCP

O MCP fala por stdin/stdout, então ele é **chamado pelo cliente**, e não deixado de pé com `up`.
No Claude Desktop e afins:

```json
{
  "mcpServers": {
    "hotclip": {
      "command": "docker",
      "args": ["compose", "-f", "/caminho/para/axxa-clip/docker-compose.yml", "run", "--rm", "-T", "mcp"]
    }
  }
}
```

O `-T` é obrigatório: sem ele o compose aloca um TTY e o protocolo, que é JSON por linha, quebra.

## Detalhes que economizam tempo

- **Debian, não Alpine.** Os dois addons nativos (`sherpa-onnx-node` e `onnxruntime-node`) são
  publicados compilados contra glibc; em musl eles nem carregam. Se for trocar a imagem base,
  continue em glibc.
- **O arquivo que sai pertence ao root.** No Linux, descomente o `user:` no compose
  (`user: "${UID:-1000}:${GID:-1000}"`) para `/out` nascer com o seu usuário.
- **GPU não ajuda aqui.** O `onnxruntime-node` do npm traz a DirectML só no pacote de Windows, e
  não traz provider de CUDA em plataforma nenhuma; o `sherpa-onnx-node` só tem pacotes de CPU.
  Dentro do contêiner, tudo roda em CPU. A aceleração por `HOTCLIP_ONNX_PROVIDER=dml` é do
  Windows nativo, fora do Docker.
- **O contêiner não escreve no seu material.** `/media` é montado `:ro` de propósito.
- **`docker run` sem argumento** mostra a ajuda da CLI e sai com código 1 — é o comportamento da
  própria CLI diante de um comando que ela não conhece, não algo que o contêiner introduz.
