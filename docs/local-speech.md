# Edição de transcrição longa e fala local / Long transcripts and local speech

## Edição e retomada

- A transcrição local salva o resultado de forma atômica a cada janela de reconhecimento de 28 segundos concluída. Depois de parar, sair ou ser interrompida por um erro, começar de novo com o mesmo material e o mesmo motor reaproveita as janelas já concluídas. Mudança na versão do material, na configuração do modelo, no idioma ou no contrato de execução força o recálculo. O botão «transcrever do zero» descarta o progresso desta rodada.
- O PCM fica em um arquivo temporário no disco, e o reconhecimento lê uma janela por vez. Na retomada, só o áudio que falta é extraído; o cache do resultado completo continua guardado. Se o cache não puder ser escrito, a transcrição ainda termina, mas não há garantia de retomada da próxima vez. O ElevenLabs na nuvem não oferece retomada local por trecho.
- A transcrição frase a frase aceita busca atravessando as frases, ignorando maiúsculas, pontuação e espaço, e lida com acento combinante, caractere de largura dupla e várias escritas. Enter / Shift+Enter vão para o próximo e o anterior, e o trecho encontrado fica destacado. O alcance da busca pode ser tudo, só a fala ou só a imagem, o texto e a prova de imagem já varrida navegam juntos pela linha do tempo, e o primeiro Enter vai até o primeiro resultado. São mostrados no máximo 2.000 resultados de fala e 200 de imagem, com um + quando o limite é atingido; basta reduzir a palavra-chave para continuar.
- Quando o texto original, a ordem das palavras e o tempo batem, o cursor vai direto na palavra encontrada; o tempo estimado da palavra é marcado como «tempo estimado dentro da frase», e quando a ordem ou o tempo não são confiáveis a ida volta a ser por frase. Dá para «ouvir o contexto» (2 segundos de cada lado, no máximo 30 segundos) e depois clicar em «escolher este trecho» para abrir a janela de seleção com as frases inteiras do resultado já marcadas. Um resultado de imagem marca a fala mais próxima; sem fala por perto, sobram só a ida e a escuta. Depois de confirmar, o trecho entra na lista de candidatos e ainda dá para ajustar, desfazer e refazer.
- Tanto a transcrição quanto a janela de seleção só desenham as frases perto da área visível, e a altura da linha acompanha o conteúdo. A área de edição usa uma pré-visualização compacta, com a linha do tempo expansível; em janelas menores, ainda dá para rolar até todos os controles.
- Ao abrir «calibrar o tempo», marque as frases ou escolha a frase em revisão para gerar a pré-visualização da calibração. Dá para ouvir o tempo antigo e o novo e, depois de aplicar, desfazer ou refazer pelo workbench. Cada lote leva no máximo 20 frases e 5 minutos no total, com no máximo 2 minutos / 2.000 caracteres por frase. A calibração preserva o texto original e as bordas das frases.
- A calibração pelo Paraformer só serve para chinês e inglês; para os outros idiomas, escolha o Qwen3 e diga o idioma explicitamente. A frase cujo modelo não suporta, cuja correspondência é fraca ou cujo tempo é inválido mantém o tempo original e conta como pulada. Quando a detecção automática de idioma não fecha, indique o idioma à mão.
- A legenda exportada usa uma predefinição de velocidade de leitura conforme o tipo de escrita, une as linhas curtas que cabem e estica a exibição dentro do que a legenda vizinha, a troca de quem fala e a borda do corte permitem. O ASS, a legenda animada, o SRT e o controle de qualidade usam o mesmo plano de exibição; o tempo de fala do destaque palavra a palavra não muda quando a exibição é esticada. A legenda que continuar fora da velocidade de leitura segue aparecendo como aviso.

## Conexão com o modelo e pré-filtragem da transcrição longa

- A espera máxima de cada rodada da análise de texto é de 3 minutos na nuvem e 5 minutos na máquina local; a volta a parâmetros compatíveis e a nova tentativa por corpo vazio dividem esse prazo. O exame de imagem leva no máximo 1 minuto por vez, e a lista de modelos, 12 segundos. O prazo inclui receber o corpo da resposta, então uma interface que devolve só o cabeçalho e trava também encerra a espera.
- Quando a requisição de texto ou de imagem esbarra em limitação momentânea (HTTP 429) ou em serviço ocupado (HTTP 503), há no máximo uma nova tentativa; a instrução de espera do servidor é respeitada até 5 segundos, e sem instrução a espera é de 1 segundo. Na análise de texto, essa cota de retentativa também é dividida com a volta de parâmetros e a nova tentativa por corpo vazio. Saldo insuficiente, falha de autenticação, queda de rede e estouro de prazo declarados não são reenviados sozinhos; quando o servidor pede uma espera maior, a falha é avisada direto, e a análise de texto mostra quanto tempo convém esperar. Se a lista de modelos falhar, ainda dá para digitar o nome do modelo à mão.
- Uma resposta bem-sucedida é lida até 2 MiB, e a chave de API e a credencial Bearer em uso ficam escondidas no detalhe do erro. Parar a tarefa interrompe a resposta que está chegando e a espera da retentativa, mas se a inferência que o servidor já recebeu para na hora é decisão dele.
- Com a pré-filtragem local ligada, a transcrição longa processa no máximo 2 trechos ao mesmo tempo, dentro de um prazo de pré-filtragem de 2 minutos compartilhado; passado o prazo, os trechos na fila não são mais despachados. Os trechos que falharam ou que ainda não foram processados ficam preservados inteiros; quando a pré-filtragem toda não está disponível ou filtra pouco, vale a análise do texto completo. O reconhecimento de endereço aceita loopback IPv4 / IPv6 e localhost, e decide se é a máquina local só pelo nome de host de verdade.

## Serviço Qwen3 local opcional

O motor padrão continua sendo o SenseVoice. O Qwen3-ASR 0.6B / 1.7B é um serviço opcional administrado por você; o HotClip não instala Python sozinho, não sobe o serviço sozinho e não manda o material para nenhum endereço remoto. O modelo é baixado e guardado na sua máquina na primeira vez que o serviço o carrega. O protocolo só aceita `http://127.0.0.1:<porta>` ou `http://[::1]:<porta>`, e recusa redirecionamento.

No diretório do código-fonte, crie um ambiente Python 3.12 separado (já verificado com `qwen-asr==0.0.6` e `transformers==4.57.6`):

```sh
python3.12 -m venv .venv-qwen
.venv-qwen/bin/python -m pip install "qwen-asr==0.0.6"
.venv-qwen/bin/python tools/qwen-speech-server.py --model 0.6B --device cpu --aligner
```

No Windows, troque `.venv-qwen/bin/python` por `.venv-qwen\Scripts\python.exe`. O instalador também traz o `speech/qwen-speech-server.py` (na pasta Resources / resources do aplicativo), que dá para rodar direto em um ambiente separado. O caminho por CPU foi medido no macOS ARM64; `--device mps` / `--device cuda:0` e o Windows e o Linux precisam de verificação própria no aparelho de destino, e não representam ganho de velocidade já comprovado.

Depois de subir o serviço, escolha o Qwen3-ASR em «motor de transcrição», preencha `http://127.0.0.1:8766` e clique em «verificar conexão». A tela mostra o modelo, o dispositivo e o estado do alinhador que foram de fato carregados. O `--model 1.7B` escolhe o modelo maior, e o `--port` muda a porta. Omitir o `--aligner` reduz o carregamento de modelo, o tempo das palavras da transcrição passa a ser marcado claramente como estimado e a calibração pelo Qwen na edição fica indisponível. Parar a tarefa no cliente encerra a espera; o serviço pode continuar terminando a inferência atual, devolve um erro claro enquanto está ocupado e permite retomar quando termina.

O conjunto de idiomas que o Qwen3-ASR reconhece é diferente do que o ForcedAligner alinha. O alinhamento cobre zh / en / yue / fr / de / it / ja / ko / pt / ru / es, e os demais idiomas reconhecidos usam tempo estimado. A palavra de duração zero não vira âncora de tempo exato: o texto é preservado e marcado como interpolado ou estimado. O texto original reconhecido, com pontuação, é preservado inteiro. [Explicação do modelo e da interface de execução](https://github.com/QwenLM/Qwen3-ASR)

```sh
pnpm cli transcribe recording.mp4 --engine qwen3 --asr-url http://127.0.0.1:8766 --json
pnpm cli transcribe recording.mp4 --engine sensevoice --restart-transcription
```

O `transcribe`, o `highlights` e o `clip` aceitam `--engine` / `--asr-url` / `--restart-transcription`. As três ferramentas correspondentes do MCP aceitam `engineId` / `localServiceUrl` / `restart`. Quando um arquivo de legenda é passado explicitamente, a importação da legenda continua tendo prioridade e o ASR nem começa.

## Avaliação reproduzível

```json
[
  { "id": "limpo-pt", "audio": "speech.wav", "text": "o texto original conferido por uma pessoa" },
  { "id": "silence", "audio": "silence.wav", "text": "" }
]
```

Salve a lista acima como `fixtures.json`, com os caminhos de áudio relativos à lista, e escolha explicitamente os modelos locais que entram no teste:

```sh
pnpm quality:eval:asr fixtures.json sensevoice,qwen3
```

A saída traz a taxa de erro de caractere e de palavra, o fator de tempo real, o reconhecimento indevido de silêncio, a origem do tempo e a amostragem de memória do processo principal. O `HOTCLIP_MODELS_DIR` aponta o cache local de modelos e o `HOTCLIP_QWEN_URL` aponta o serviço. O primeiro teste pode incluir o tempo de preparo do modelo, então aqueça antes de comparar; o RSS do processo principal não inclui o serviço Qwen separado e não serve para ranquear a memória dos dois modelos. Para medir o erro de borda, acrescente à amostra um `boundaries: { firstSec, lastSec }` anotado por uma pessoa; sem anotação, a saída é null.

O teste de fumaça de 2026-09-05, na CPU de um macOS ARM64, cobriu 10,94 segundos de chinês sintetizado, 8,57 segundos de inglês e 5 segundos de silêncio. O Qwen3-ASR 0.6B + ForcedAligner e o SenseVoice tiveram taxa de erro de caractere zero nas duas amostras de fala, e nenhum dos dois reconheceu nada na amostra de puro silêncio; a saída de duração zero das palavras funcionais do inglês do Qwen já foi acomodada por interpolação. Os dois calibradores concluíram a calibração das 41 palavras da mesma frase em chinês, preservando o texto original. Uma amostra desse tamanho não diz nada sobre a qualidade geral em gravação real, em sotaque regional ou em ambiente com ruído; o 1.7B não foi medido nesta rodada.

## English

Local transcription checkpoints each completed 28-second decode window and resumes the same source/model configuration after interruption. PCM stays on disk; only one window is read at a time. Use **Start over** to discard that run's partial results. Cache faults lose reuse, not the ability to transcribe; cloud jobs do not support local window recovery.

The transcript supports Unicode-aware cross-sentence search and chronological navigation across speech and scanned visual evidence. Filter by All / Speech / Visuals. The first Enter seeks the first match; subsequent Enter / Shift+Enter move forward / backward. Limits are 2,000 speech matches and 200 visual matches, with + displayed at the cap. Matching word times are used only when the word sequence and timing are valid; estimated times are labeled and stale words fall back to sentence bounds.

**Play context** includes up to two seconds on either side, capped at 30 seconds. **Pick this moment** opens the picker with complete matched sentences selected; visual matches select nearby speech only. Review and confirm before adding a candidate, then undo or redo as needed. Both the transcript and picker virtualize long lists. Picker search spans sentences and preserves selections while filtering. The transcript workspace provides a compact player and an expandable timeline.

**Align timing** previews selected or uncertain sentences before an explicit apply. Listen before/after, apply, then undo or redo. Limits: 20 sentences / 5 minutes per batch, 2 minutes / 2,000 characters per sentence. Original text and cue boundaries remain intact. Unsupported languages, poor matches and invalid timings keep the originals with a skipped count. Paraformer is Chinese/English; choose Qwen3 and an explicit supported language for other scripts.

Exports share a language-aware caption display plan across ASS, web overlays, SRT and quality checks. Short lines merge only within width, speaker and splice constraints. Display duration extends into available space without moving speech/karaoke timestamps. Unresolved reading-speed issues remain visible in the report.

Qwen3 is optional and user-managed. Follow the Python commands above, then choose Qwen3-ASR and check the loopback URL in the engine settings. The service accepts `--model 0.6B|1.7B`, `--device cpu|mps|cuda:0`, `--port` and `--aligner`. First load downloads model weights locally. HotClip installs no Python runtime automatically and rejects remote service URLs and redirects. Without the aligner, word times are marked estimated. The ASR and alignment language sets differ; see the explicit list above. Client cancellation stops waiting; a service already inferring may finish that request before becoming available again.

Run `pnpm quality:eval:asr fixtures.json sensevoice,qwen3` against locally annotated fixtures to measure character/word errors, runtime, silence hallucinations and timing provenance. Paths are relative to the manifest. Memory is a host-process sample, not total service memory; boundary error requires manual `boundaries` labels. The small CPU smoke covered 0.6B, Chinese/English synthesized speech and silence; it does not establish general accuracy or GPU/cross-platform performance. The 1.7B path remains opt-in and was not benchmarked in this run.

**Model requests** have deadlines covering both response headers and body: text analysis gets 3 minutes for remote services or 5 minutes for loopback services, shared across parameter fallback and empty-content retries; visual calls get 1 minute and model lists 12 seconds. Text and vision requests retry HTTP 429/503 at most once, honoring a server wait of up to 5 seconds (1 second when absent). Text fallback attempts share that retry allowance. Recognized insufficient-quota errors, authentication failures, network failures and timeouts are not automatically resent. Longer waits return an error; text analysis includes the suggested delay. Model-list failure still permits manual model entry. Successful responses are limited to 2 MiB; error details redact the configured key and Bearer credentials. Cancellation stops the client request or retry wait; server-side inference may continue.

**Local screening** runs at most two chunks concurrently within a shared two-minute deadline. Failed or unprocessed chunks remain intact, and unavailable or ineffective screening falls back to the full transcript. Local model detection checks the URL hostname and supports localhost, IPv4 loopback and IPv6 loopback.
