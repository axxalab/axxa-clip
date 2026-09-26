# HotClip sem interface, em contêiner: a CLI e o servidor MCP.
#
# O que roda aqui: importar, transcrever (todos os motores locais), buscar os picos, cortar,
# enquadrar em 9:16, queimar legenda ASS, exportar, e o servidor MCP.
# O que NÃO roda: a janela do Electron. A interface é um aplicativo de desktop e continua sendo
# o .exe / .dmg / .AppImage — contêiner é para o caminho sem ninguém olhando (fila de arquivos,
# automação, agente por MCP), que é justamente o que não precisa de tela. A legenda animada em
# Web também fica de fora: ela é desenhada por uma janela do Chromium fora da tela, e sem ela o
# caminho cai sozinho na legenda ASS, que é a mesma que o desktop usa por padrão.
#
# Por que Debian e não Alpine: os dois addons nativos (sherpa-onnx-node e onnxruntime-node) são
# publicados compilados contra glibc. Em musl eles nem carregam.
FROM node:22-bookworm-slim

# libgomp1: o onnxruntime abre libgomp.so.1 ao criar a sessão.
# fontconfig + uma fonte: o libass exige fontconfig presente mesmo recebendo o fontsdir do próprio
# HotClip, e sem nenhuma fonte instalada a queima da legenda sai vazia.
# ca-certificates: os modelos e o yt-dlp são baixados por HTTPS na primeira execução.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      fontconfig \
      fonts-dejavu-core \
      libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# O binário do Electron tem centenas de MB e nunca é executado aqui; o pacote npm continua
# instalado porque o build do desktop depende dele, mas o download é pulado.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_update_notifier=false

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

# As dependências primeiro, em camada própria: mexer no código-fonte não refaz a instalação
# (que baixa o ffmpeg-static, uns 80MB).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig*.json ./
COPY src ./src
COPY resources ./resources
COPY tools ./tools

# XDG_CONFIG_HOME manda em userDataDir(): com isto os modelos, o cache de transcrição, o de
# renderização e o índice de evidências ficam todos sob /data — monte um volume aí e o download
# de ~500MB do primeiro uso não se repete a cada contêiner.
ENV XDG_CONFIG_HOME=/data
# 0777 para que a linha `user:` do compose funcione de verdade: sem isto, rodar com o uid do host
# (que é o jeito de o arquivo em /out não nascer como root) esbarra na pasta criada pelo root.
RUN mkdir -p /data /media /out && chmod 0777 /data /out
VOLUME ["/data"]

# tsx direto, e não `pnpm cli`: uma camada a menos de repasse de argumentos entre o docker run e o
# programa. /media é o que entra (só leitura serve) e /out é o que sai.
ENTRYPOINT ["./node_modules/.bin/tsx", "src/cli/index.ts"]
CMD ["--help"]
