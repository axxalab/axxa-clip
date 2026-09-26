<div align="center">

<a href="https://github.com/xixihhhh/hotclip/releases/latest">
  <img src="docs/readme-hero-en.png" alt="HotClip — transforme vídeos longos e gravações de live em cortes verticais virais, tudo na sua máquina" width="100%">
</a>

# HotClip — cortador de vídeo com IA, livre e de código aberto: vídeo longo vira corte vertical viral

**Uma alternativa gratuita e local ao Opus Clip — sem créditos, sem marca d'água, sem envio para a nuvem**

**Português (BR)** | [English](README.en.md) | [Site](https://xixihhhh.github.io/hotclip/) | [Download](https://github.com/xixihhhh/hotclip/releases/latest) | [Perguntas frequentes](#perguntas-frequentes) | [Problemas](https://github.com/xixihhhh/hotclip/issues)

<p>
  <a href="https://github.com/xixihhhh/hotclip/releases/latest"><img src="https://img.shields.io/github/v/release/xixihhhh/hotclip?label=vers%C3%A3o&color=ff5722" alt="Versão mais recente"></a>
  <a href="https://github.com/xixihhhh/hotclip/releases"><img src="https://img.shields.io/github/downloads/xixihhhh/hotclip/total?label=downloads&color=ff9800" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/plataformas-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Plataformas">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/xixihhhh/hotclip?label=licen%C3%A7a" alt="Licença"></a>
  <a href="https://github.com/xixihhhh/hotclip/stargazers"><img src="https://img.shields.io/github/stars/xixihhhh/hotclip?style=social" alt="Estrelas no GitHub"></a>
</p>

**Detecção de destaques por IA (com justificativa) · reenquadramento automático 9:16 que preserva o enquadramento · legendas dinâmicas palavra a palavra · remoção de vícios de linguagem e silêncios**

100% local · sem marca d'água · sem créditos · sem limite de duração · sem cadastro

</div>

A transcrição local agora salva as janelas já concluídas e retoma depois de uma interrupção. A edição da transcrição ganhou busca que atravessa frases, lista virtualizada para textos longos e calibração de tempo com ouvir, aplicar e desfazer. Depois de uma varredura visual completa, a mesma busca também encontra descrições de cena confirmadas e texto que aparece na tela, com um clique para saltar até cada momento. As exportações melhoram o ritmo de leitura das legendas conforme o idioma. O [guia de fala e transcrições longas](docs/local-speech.md) explica a configuração opcional do Qwen3-ASR local e a avaliação reproduzível dos modelos.

Quando a busca exata não encontra nada, a bancada de transcrição pode ativar a **fala parecida** para achar resultados de reconhecimento que diferem por um caractere. Os resultados vêm marcados como aproximados e podem ser ouvidos antes de virar um corte.

**Buscar já é escolher o trecho**: as ocorrências de fala e de imagem são percorridas juntas em ordem de tempo, dá para filtrar por origem, saltar até a palavra encontrada, ouvir o contexto e então revisar as frases inteiras já pré-selecionadas no seletor. O tempo estimado continua sinalizado; a escolha em transcrições longas é virtualizada, e os candidatos adicionados aceitam desfazer e refazer.

Com a identificação de falantes ligada numa conversa, a bancada de transcrição filtra por S1 / S2, e a busca, as ocorrências de fala parecida e a prévia do corte acompanham o filtro.

## Progresso e cancelamento da exportação

A exportação identifica as etapas de preparação, tradução, texto de publicação, versões, codificação e finalização. Dá para cancelar durante a preparação, esperar a limpeza e tentar de novo sem perder a seleção de candidatos. Uma segunda exportação no desktop não substitui um trabalho em andamento. O progresso fica abaixo de 100% até a entrega terminar. A exportação só de SRT preserva o tempo por palavra mesmo com as legendas queimadas desligadas.

Cortes, cortes secos, vídeos de onda sonora, compilados e legendas renderizadas pelo navegador são escritos numa pasta reservada ao lado do destino e só substituem o arquivo final depois que a codificação termina bem. Uma codificação que falha ou é cancelada preserva o arquivo anterior, e os clipes já concluídos continuam disponíveis. O cancelamento normal limpa os arquivos temporários. Um encerramento forçado do processo pode deixar pastas ocultas `.hotclip-write-*`; remova-as só depois de confirmar que nenhuma exportação está rodando. A proteção vale para cada operação de codificação, e não como um desfazer de lote inteiro.

## Por que o HotClip

- **Gratuito de verdade, não é teste**: código aberto sob AGPL-3.0 — sem marca d'água, sem créditos, sem limite de duração, sem cadastro. Não existe camada gratuita capada nem cota que zera no fim do mês
- **Suas imagens nunca saem da sua máquina**: transcrição, legendas, corte e exportação rodam localmente — material ainda não publicado e conteúdo de cliente continuam seus
- **Todo corte vem com comprovante**: nota de potencial viral + gancho de abertura + justificativa + avaliação em quatro dimensões, mais a origem visível da marcação de tempo das legendas e os trechos que precisam de revisão — a IA nunca chuta horário nem fabrica confiança
- **O corte automático escuta a fala antes**: um detector local de menos de 1 MB confere a linha do tempo das palavras de forma independente; um intervalo entre palavras que ainda tem fala fica intacto, o movimento nas pontas tem teto rígido e, com evidência duvidosa, o corte original é mantido exatamente
- **Redução de ruído só quando precisa, no nível que você escolhe**: o Básico mantém o filtro fixo e conservador; o Inteligente baixa sob demanda um modelo local de diálogo de ~10 MB em 48 kHz, processa a edição já montada antes dos efeitos e da trilha, e volta honestamente ao Básico quando não está disponível
- **O chat ao vivo alimenta a busca de destaques**: o arquivo de chat ao lado da gravação é descoberto sozinho (funciona tanto com o .xml do BililiveRecorder quanto com o .jsonl do gravador do Douyin), presentes e mensagens pagas entram com peso próprio e há proteção contra spam — é o público votando segundo a segundo, uma evidência que a maioria das ferramentas nem olha
- **Pronto para publicar, não só cortado**: clipes verticais + legendas dinâmicas + capas + texto de publicação + pacotes por plataforma, tudo de uma vez
- **Trabalho interrompido volta em segurança**: origem, transcrição, candidatos, seleção e cortes ajustados à mão se recuperam depois de reiniciar; o monitoramento de pasta e os webhooks compartilham uma fila persistente com repetição e cancelamento
- **Projetos de verdade, não tarefas descartáveis**: a área de projetos administra várias edições, com revinculação de origem offline ou alterada; seleção, textos, limites e correções de transcrição aceitam desfazer e refazer, inclusive depois de reabrir
- **Análise e renderização sempre veem a mesma imagem**: movimento e planos, miniaturas da linha do tempo, emoção facial e a revisão visual opcional ficam todos presos à trilha de vídeo selecionada; caminhos PQ/HLG executáveis ganham uma prévia segura em SDR para análise, e o cache de evidências isola a imagem junto da decisão de cor
- **Vídeo longo fica mais rápido a cada repetição**: uma renderização base idêntica vem direto de um cache local limitado; o vídeo H.264 só é copiado sem recodificar em cortes únicos alinhados a quadro-chave e sem mudança de pixel, o processamento de áudio continua igual, e qualquer caso duvidoso volta para a codificação precisa
- **Correção de imagem apenas quando a evidência pede**: em origens que não foram detectadas como HDR, o acabamento adaptativo opcional mede os quadros que ficaram e faz uma correção contida só quando a imagem está claramente escura, sem contraste ou saturada demais; qualquer PQ/HLG detectado pula essa etapa no domínio SDR, imagem saudável fica intacta e material em preto e branco nunca é colorido à força
- **HDR entra, SDR previsível sai**: a conversão automática exige uma curva PQ/HLG explícita mais primárias, matriz de cor e faixa completas e com suporte; o que se qualifica é mapeado em luz linear para SDR BT.709 devidamente marcado, enquanto SDR e curvas desconhecidas seguem pelo caminho de sempre
- **Publicar ensina o próximo corte**: toda exportação recebe um identificador de conteúdo estável; exportações com várias versões formam grupos de teste A/B locais e só recebem uma indicação de direção quando plataforma, janela de publicação e amostra são comparáveis
- **Corta enquanto você dorme**: uma pasta monitorada 24 horas por dia transforma gravações prontas em cortes; o diagnóstico de um clique pega ferramentas e modelos faltando antes de começar, e a CLI e o MCP transformam tudo isso numa entrega de uma frase para um agente

<!-- TODO(P0): colocar aqui um mp4 de demonstração de 30 a 60 segundos (arrastar para o editor web do README gera o player de user-attachments):
     soltar uma gravação de live → os cartões de candidatos aparecem → exportar com um clique → clipe vertical com legendas dinâmicas -->

<!-- TODO(P0): colocar aqui a tabela de "exemplos de saída": 2 ou 3 clipes verticais lado a lado numa <table> com <video> -->

## Como transformar um vídeo longo em cortes, em três passos

<p align="center">
  <img src="docs/readme-story.png" alt="Um vídeo longo vira vários cortes virais: a IA encontra os melhores momentos e gera clipes verticais com um clique" width="100%">
</p>

1. **Importar**: solte aqui um podcast, uma gravação de live, uma aula ou um vlog (MP4 / MKV / MOV / FLV / TS, e só áudio também vale), ou cole um link público de vídeo, do tipo Bilibili ou YouTube. A ferramenta oficial de download é baixada e verificada no primeiro uso; o arquivo vai para a sua máquina e entra no mesmo fluxo offline
2. **Escolher os destaques**: transcrição local com marcação por palavra → a IA lê a transcrição inteira e indica as melhores frases, os embates e os momentos de pico, cada um com **nota de potencial viral, gancho de abertura e justificativa**, com pontos de corte precisos na palavra; é só desmarcar o que você não quiser
3. **Exportar**: um clique produz clipes verticais 9:16 — reenquadramento que preserva o enquadramento, legendas dinâmicas sincronizadas por palavra, cartelas de título e volume normalizado em -14 LUFS. PQ/HLG vira SDR BT.709 marcado apenas quando primárias, matriz de cor e faixa estão completas e com suporte; fora disso o vídeo fica sem conversão e o resultado diz isso — mais a imagem de capa e o texto de publicação, prontos para **TikTok / Reels / Shorts / Douyin / Bilibili**

## Telas do programa

<p align="center">
  <img src="docs/screenshots/04-highlights.png" width="840" alt="Bancada profissional: prévia, linha do tempo de sinais, lista de candidatos e painel de detalhes numa tela só">
</p>
<p align="center"><sub><b>Uma bancada de verdade</b> — prévia, linha do tempo, tabela de candidatos e painel de detalhes na mesma tela: as curvas de euforia do chat e de volume são desenhadas direto na linha do tempo, e os trechos candidatos ficam em cima dos picos, então "por que este trecho" se vê de relance. Todo candidato traz nota de potencial viral, as quatro dimensões detalhadas e pontos de corte precisos na palavra; as escolhas fracas são marcadas sozinhas, e a palavra final é sua.</sub></p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/01-import.png" alt="Importar um vídeo longo"><br/><sub>① <b>Importe</b> um podcast, uma gravação de live ou uma aula — tudo é processado localmente e nada é enviado para a internet</sub></td>
    <td width="50%"><img src="docs/screenshots/02-engines.png" alt="Escolher o motor de transcrição"><br/><sub>② <b>Escolha o motor de transcrição</b> — a origem fica ancorada na bancada; três níveis locais (SenseVoice / Paraformer / FireRedASR2) mais um nível opcional na nuvem</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/03-transcript.png" alt="Transcrição com marcação por palavra"><br/><sub>③ <b>Aba de transcrição</b> — com marcação de tempo, corrigível no clique, e clicar num horário salta a prévia; é a base dos destaques e das legendas</sub></td>
    <td width="50%"><img src="docs/screenshots/05-export.png" alt="Exportação em um clique"><br/><sub>④ <b>Exportação em um clique</b> — conjuntos de exportação reutilizáveis, clipes verticais prontos para publicar, com imagens de capa e metadados no clips.json</sub></td>
  </tr>
</table>

> Interface real, operada sobre uma gravação de live de vendas usada como exemplo. **Se os cortes te parecerem certos, uma ⭐ ajuda mais criadores a escapar das ferramentas que cobram por crédito — e Star + Watch avisa você dos lançamentos.**

## ⬇️ Download e instalação

**[Baixar a versão mais recente »](https://github.com/xixihhhh/hotclip/releases/latest)**

| Plataforma | Arquivo | Observações |
|---|---|---|
| Instalador Windows | `HotClip-x.y.z-win-x64.exe` | Clique duas vezes para instalar |
| Windows portátil | `HotClip-x.y.z-win-x64.zip` | Descompacte e execute |
| macOS (Apple Silicon) | `HotClip-x.y.z-mac-arm64.dmg` | Arraste para a pasta Aplicativos |
| Linux (experimental) | `HotClip-x.y.z-linux-x64.AppImage` | Rode `chmod +x` e execute; acrescente `--no-sandbox` se não abrir por causa de um erro de sandbox |

> ⚠️ Por enquanto os pacotes não são assinados: no SmartScreen do Windows escolha "Mais informações → Executar assim mesmo"; no macOS, clique com o botão direito → Abrir na primeira vez (ou libere em Ajustes do Sistema → Privacidade e Segurança). A assinatura de código está no planejamento.
>
> Sem Python, sem Docker, sem linha de comando e sem cadastro — é um aplicativo de desktop de verdade, que se abre com dois cliques.

## Para quem é

- **Quem transmite ao vivo e quem faz cortes**: transforme suas próprias gravações em cortes logo depois da live; a **pasta monitorada** 24 horas por dia converte gravações prontas em cortes enquanto você dorme; a densidade do chat entra direto na busca de destaques (funciona tanto com o .xml de chat do Bilibili quanto com o .jsonl do gravador do Douyin)
- **Quem faz podcast**: episódios só de áudio também viram vídeo — uma **onda sonora animada** mais legendas com as melhores frases transformam o podcast em cortes verticais
- **Quem ensina e quem faz marketing**: aulas, webinários e demonstrações viram clipes fáceis de consumir, com capas, títulos e metadados — e com uma checagem de palavras proibidas antes de publicar
- **Quem grava falando para a câmera**: silêncios, "é…" e gaguejos são removidos automaticamente; a transcrição corrigível no clique e o glossário de termos mantêm os nomes certos, episódio após episódio

## Como se compara (alternativa gratuita ao Opus Clip)

As ferramentas comerciais cobram **créditos por minuto de material** (um podcast de 2 horas queima a cota do mês, e os créditos expiram todo mês), exigem **envio para a nuvem**, entregam **pontuação de caixa-preta** ou cobram pelas legendas. As alternativas de código aberto são ferramentas de linha de comando ou Docker que a maioria dos criadores não consegue instalar. O HotClip resolve os dois lados:

| | HotClip | OpusClip / Klap / Vizard (SaaS) | Corte inteligente do CapCut | FunClip / autoclip (código aberto) |
|---|---|---|---|---|
| Preço | **Gratuito e de código aberto** | US$ 15 a 29+/mês, créditos por minuto de material, expiram todo mês | Recursos principais são pagos | Gratuito |
| Suas imagens | **Ficam na sua máquina** | Envio obrigatório para a nuvem | Quase tudo na nuvem | Local |
| Marca d'água / limites | **Nenhum** | Camada gratuita: marca d'água, limites, projetos expiram em 3 dias | Alguns bloqueios | Nenhum |
| Cadastro | **Não precisa** | Conta obrigatória, projetos apagados ao cancelar | Exige login | Nenhum |
| Fácil para iniciante | **Instalador de dois cliques** | Aplicativo web, fácil | Fácil | Linha de comando / Docker / auto-hospedado |
| Qualidade do corte | **Alinhado à palavra, com justificativa, e você veta o que quiser** | Pontuação de caixa-preta | Caixa-preta | No nível da frase, sem ordenação |
| Legendas verticais | **Reenquadramento 9:16 + legendas dinâmicas já inclusos** | Sim (nos planos pagos) | Legenda automática é paga | Em geral não fazem reenquadramento vertical |

<sub>Informações dos concorrentes conferidas em julho de 2026. Comparação detalhada: [HotClip vs OpusClip](https://xixihhhh.github.io/hotclip/alternatives/opus-clip.html)</sub>

## Recursos

> A esteira completa — importar → destaques com IA → clipes verticais com legendas — já está pronta hoje. Abra cada grupo para os detalhes; tudo ali é recurso de verdade, não adjetivo.

### 🎙️ Transcrição local: três motores, marcação por palavra

Já tem uma transcrição? Escolha **Importar legendas** na tela de transcrição e selecione um SRT / WebVTT em UTF-8 alinhado com a origem atual. Dá para revisar, corrigir e escolher frases na hora, e disparar a detecção por IA quando quiser. A importação roda sem reconhecimento de fala e deixa o cache de transcrição intacto. Os limites originais das legendas são preservados; o tempo por palavra dentro de cada legenda é marcado como estimado e aparece no filtro de revisão de tempo. As costuras manuais respeitam estritamente os limites que você escolheu.

Os comandos `transcribe`, `highlights` e `clip` da CLI aceitam `--subtitles "/caminho/original.srt"`, e as três ferramentas do MCP aceitam `subtitlePath`. Para uma saída estruturada com a origem da marcação de tempo, rode `pnpm cli transcribe "/caminho/video.mp4" --subtitles "/caminho/original.vtt" --json`. Use uma única trilha de transcrição no idioma original, de até 5 MB, 20.000 legendas e 100.000 palavras. Legendas sobrepostas, fora de ordem, fora do intervalo ou mapeadas a um relógio de streaming produzem um erro com o que fazer, em vez de descartar falas em silêncio.

SenseVoice rápido (5 idiomas, 170 MB) / Paraformer equilibrado / FireRedASR2 mais preciso (mandarim, sotaques, alternância de idioma) — todos locais, leves para a CPU, baixados sozinhos e com retomada de download; mais um nível opcional na nuvem (ElevenLabs, com a sua chave, enviando só a trilha de áudio).

<details>
<summary><b>Detalhes</b>: cache de transcrição · correção no clique · glossário de termos · separação de falantes</summary>

- **Cache local de transcrição**: reabra o mesmo arquivo e vá direto para a escolha dos destaques; o cache é invalidado quando o arquivo ou o motor muda
- **Correção na própria transcrição**: passe o mouse em qualquer frase e corrija ali mesmo; legendas, tradução e texto de publicação usam o texto corrigido, enquanto o tempo recalculado fica explicitamente marcado e filtrável para revisão
- **Glossário de termos**: corrija um nome uma vez, aplique em todas as frases correspondentes e toda transcrição futura se corrige sozinha (combinação por palavra inteira, com o termo errado mais longo tendo prioridade); atualizar o glossário reaproveita o cache — sem reconhecer de novo
- **Separação de falantes**: uma única opção (pyannote local + 3D-Speaker, sem envio nenhum) identifica quem está falando; a IA escolhe trechos por falante e nunca junta duas pessoas fora de contexto, e as legendas em balão podem receber uma cor por falante
</details>

### 🔥 Destaques por IA: nove caminhos de evidência, todo corte com comprovante

O LLM só escolhe *qual trecho* e precisa citar a transcrição; os horários vêm da **busca reversa na transcrição com marcação por palavra** — a IA nunca chuta tempo. Todo candidato traz nota de potencial viral, gancho, justificativa e avaliação em quatro dimensões, e as escolhas fracas são marcadas como "não recomendado".

<details>
<summary><b>Detalhes</b>: porta de qualidade · sinais de chat, emoção e imagem · clipes de referência · funil de custo · modo produto</summary>

- **Porta de qualidade com revisão por IA**: uma segunda passagem cega e rigorosa dá nota a gancho, estrutura, valor e tendência, com uma linha de justificativa em cada, mais uma frase de chamada pronta para imprimir
- **Nota de potencial viral é ordenação, não horóscopo**: o total ponderado pelas dimensões é normalizado pela posição relativa dentro do lote (76 a 99), imune à variação de nota do LLM — e é honestamente chamado de ordenador, não de adivinho de visualizações
- **Evidência de imagem e som**: picos de volume, densidade de troca de plano e picos leves de movimento são coletados localmente e entram no julgamento; a bancada desenha o movimento como uma curva visível na linha do tempo
- **Sinal de densidade do chat ao vivo (Bilibili e Douyin)**: o arquivo de chat ao lado da gravação é descoberto sozinho — funciona com o .xml do BililiveRecorder e com o .jsonl do gravador do Douyin; a densidade em janela deslizante pesa as palavras de euforia, e os eventos de interação (mensagens pagas, assinaturas, presentes, novos seguidores, rajadas de curtida) têm peso próprio, porque voto com dinheiro e com ação vale mais que mensagem solta. Um teto por remetente impede que um único spammer finja um momento quente, e as subidas repentinas valem pontos extras — é o público votando segundo a segundo, a evidência mais forte que existe
- **Ressonância entre sinais e esforço bem gasto**: um momento só é confiável quando vários sinais disparam juntos — volume sozinho pode ser a trilha, chat sozinho pode ser spam; volume + chat + riso acendendo ao mesmo tempo é a coisa de verdade. Os picos de movimento guiam a amostragem de quadros, mas uma reserva uniforme explícita ainda cobre o material inteiro, para que um espetáculo no começo não esconda uma cena silenciosa e importante lá na frente
- **Evidência multimodal local reaproveitável**: os sinais de nível 0, os limites do TransNetV2 e o resultado opcional da varredura visual são indexados de forma atômica pela impressão digital da origem, pela versão de capacidade e pelo modelo. Desktop, CLI, MCP, pasta monitorada e webhooks reaproveitam o mesmo resultado; o índice LRU de 64 MB reconstrói sozinho as entradas corrompidas ou velhas e nunca guarda uma chave de API de visão
- **Picos de expressão facial (sem configurar nada)**: YuNet + FER+ (licença MIT, poucos MB) encontram os picos de riso, surpresa e empolgação — evidência visual sem instalar nada
- **Sinal de pico visual (opcional)**: uma instalação nova já vem com o Ollama local `qwen3.5:4b` preenchido, usando um único modelo multimodal para texto e para mosaicos de nove quadros, e encontrando momentos visuais que a transcrição não enxerga; um endpoint indisponível é pulado sem travar a detecção baseada só na transcrição
- **Revisão visual por IA (opcional)**: depois da detecção, os melhores candidatos passam por uma olhada do modelo de visão nos mosaicos de quadros — imagem marcante sobe a nota, imagem sem vida rebaixa os candidatos vindos de sinal, incoerência entre título e imagem é sinalizada e a observação da cena entra na justificativa; sai de graça com o Ollama local, ou coloque uma chave de API nas configurações de visão para usar um modelo na nuvem
- **Detecção guiada por clipe de referência**: entregue um corte viral para servir de espelho — o ritmo dele é medido localmente e conduz a escolha (`--reference` na CLI)
- **Ciclo de retorno da revisão**: os candidatos aprovados e descartados vão para um arquivo local de preferências que conduz a próxima rodada — o sistema aprende o seu gosto, e esses dados nunca saem da sua máquina
- **Ciclo de retorno do desempenho real**: importe as métricas em CSV/JSON exportadas das plataformas com `pnpm cli feedback`; o HotClip aprende localmente os padrões de tema, gancho e duração por trás do que foi bem e do que foi mal. Desktop, CLI, MCP e a detecção da pasta monitorada usam essa evidência do público sem copiar títulos antigos nem enviar dados de conta
- **Funil de dois níveis na própria máquina**: um modelo pequeno local faz a lista curta primeiro, e só então o modelo de nuvem lê essa lista. Transcrições longas usam no máximo duas requisições de triagem ao mesmo tempo, e os blocos que falharam ou não foram processados são mantidos por inteiro quando o prazo da triagem termina
- **Requisições de modelo com limite de tempo**: a análise de texto, a revisão visual e o carregamento da lista de modelos param de esperar quando o prazo expira. As chamadas de texto e de visão repetem no máximo uma vez um erro temporário de limite ou de ocupação, o cancelamento interrompe a espera, e as mensagens de erro escondem a chave de API que tenha vindo ecoada
- **Pontos de corte encaixados na troca de plano**: o TransNetV2 (31 MB em ONNX, local) encontra as trocas de plano reais, e os limites se encaixam nelas com uma proteção de limite de palavra que nunca corta a fala
- **Modo produto (venda ao vivo)**: informe os produtos e a escolha passa a seguir a lógica de conversão (demonstração > apresentação de diferenciais > mecânica de preço); os trechos de enrolação para gerar engajamento ficam de fora
- **Faixas de duração do clipe**: curta de 10 a 30s / padrão de 8 a 40s / longa de 40 a 90s — a duração alvo é uma restrição rígida dentro do prompt de seleção
</details>

### 📝 Legendas e textos: legenda automática e texto de publicação, cada um numa opção

Legendas dinâmicas em vários estilos — destaque de palavra-chave, palavra saltando, balão, minimalista — queimadas automaticamente, movidas pela marcação por palavra e com quebra de linha por sentido (nunca cortada no meio de uma expressão); **exportação de SRT** e legendas bilíngues inclusas; títulos da IA queimados como cartelas no topo; texto de publicação gerado para cada clipe.

<details>
<summary><b>Detalhes</b>: legenda em balão · gancho de abertura · bilíngue · estilo Hormozi · checagem de palavras proibidas · selo de conteúdo por IA</summary>

- **Quebra de linha por sentido (sem chave de API)**: as linhas quebram nos limites reais das orações, a partir da pontuação do reconhecimento de fala — o resultado que as ferramentas comerciais obtêm com `[br]` via LLM, aqui a partir de sinais locais e sem nenhuma chamada extra
- **Motor de legenda em balão**: o Chromium embutido renderiza legendas em CSS fora da tela, quadro a quadro — balões arredondados, palavras-chave em gradiente, entradas com elasticidade; é determinístico, então a mesma entrada dá a mesma saída
- **Gancho de abertura (os 3 primeiros segundos de ouro)**: a chamada escrita pela IA é queimada em letras grandes sobre os ~2 segundos iniciais, desviando do assunto principal e da cartela de título; sem uma boa chamada, o recurso é pulado
- **Abertura fria (o desfecho primeiro)**: a frase de gancho mais forte é emendada bem no começo e depois vem o clipe inteiro — o truque padrão de retenção, cobrado como recurso pago em outras ferramentas; é pulado quando o gancho não pode ser localizado (melhor não fazer do que fazer mal)
- **Antecipação do pico na abertura**: mostra de 0,3 a 1 segundo do momento mais explosivo antes de a história começar e depois volta — só 0,04% dos clipes trazem algum gancho visual; se coordena sozinha com a abertura fria (uma ou outra) e é pulada quando não existe um pico seguro
- **Legendas de impacto no estilo Hormozi**: blocos grandes e pesados, sombra dura, acendendo palavra por palavra
- **Legendas com marca de falante**: em material com várias pessoas, cada troca de falante abre com um prefixo colorido "A:" / "B:" (a mesma paleta por falante das legendas em balão), para que quem assiste nunca perca quem está falando
- **Legendas bilíngues**: a tradução da frase inteira é queimada como uma segunda faixa, remapeada pela compressão do corte seco; os concorrentes vendem isso como plano pago
- **Exportação de SRT**: as marcações de tempo já refletem a saída com corte seco e vícios de linguagem removidos, e as quebras de linha batem exatamente com as legendas queimadas
- **Geração de texto de publicação**: título com gancho + de 3 a 6 hashtags de nicho + descrição por clipe (8 ângulos de gancho × 5 tipos de chamada final), salvo como `.post.txt` e dentro do clips.json
- **Checagem de palavras proibidas pelas plataformas**: mais de 120 regras locais sobre títulos, textos e legendas — afirmações absolutas, alegações médicas e desvio de público para fora da plataforma são sinalizados antes de publicar
- **Selo de conteúdo gerado por IA (conformidade embutida)**: uma única opção acrescenta o selo visível na imagem mais os metadados implícitos no arquivo, conforme as regras de rotulagem de conteúdo gerado por IA
</details>

### 🎬 Acabamento: edição com cara de feita à mão

Reenquadramento 9:16 que preserva o enquadramento, corte seco dos silêncios, remoção de vícios de linguagem, volume em -14 LUFS e corte preciso no quadro — com verificação de qualidade e autocorreção depois de cada exportação.

<details>
<summary><b>Detalhes</b>: reenquadramento · corte de silêncio · redução de ruído · efeitos · trilha · verificação e autocorreção · capas inteligentes</summary>

- **Reenquadramento inteligente que preserva o enquadramento**: cada plano considera todos os rostos visíveis; se uma pessoa em movimento ou um grupo couber com folga, a câmera virtual fica parada. Ela só acompanha quando a pessoa realmente sai do recorte, segura durante uma falha breve do detector, volta ao centro depois de uma perda prolongada e recua com segurança quando as detecções são esparsas
- **Comprovante de enquadramento**: o `clips.json` registra quantos planos ficaram no total, travados, travados em grupo, acompanhados, em recuperação e com o centro como padrão; o enquadramento travado agora se mantém até o plano seguinte, e o corte seco nunca faz a câmera atravessar um trecho descartado
- **Acabamento de imagem adaptativo (opcional, desligado por padrão)**: reaproveita a evidência local de nível 0 para medir luminância, contraste e saturação apenas nos intervalos que sobraram em cada clipe; a correção, com teto rígido, só é aplicada com amostra suficiente e um sinal claro de escuro, sem contraste, estourado ou saturado demais. Imagem saudável fica intacta e preto e branco nunca é colorido à força, enquanto cortes secos, trechos costurados e aberturas frias usam as janelas realmente preservadas e registram as medições e os ajustes exatos no `clips.json`
- **Esteira de cor segura com HDR**: a conversão automática exige PQ (SMPTE ST 2084) ou HLG mais primárias, matriz de cor e faixa completas e com suporte do FFmpeg. Quando existe metadado de MaxCLL ou de pico do monitor de masterização, ele limita as altas luzes; fora isso, o FFmpeg mantém sua estimativa automática segura. O que se qualifica é convertido em luz linear, com um mapeamento de tons Mobius contido, e marcado como SDR BT.709 antes de qualquer recorte, reenquadramento, zoom ou legenda. Se há uma curva HDR mas as demais marcações estão incompletas ou sem suporte, o HotClip mantém o caminho de renderização existente, pula o acabamento adaptativo no domínio SDR e marca o resultado como não convertido. Se a própria inspeção de cor falhar, o acabamento também fica desligado e o resultado diz que a inspeção falhou; SDR e curvas desconhecidas seguem pelo caminho de sempre. Cortes secos, trechos costurados, sobreposição de legendas, aberturas frias e correções seguras da verificação de qualidade preservam a decisão — sem nenhum modelo, download ou envio
- **Remoção da interface em gravação de tela**: barras de status e tarjas pretas são detectadas por variação ao longo do tempo e recortadas
- **Corte seco de silêncio que respeita a fala**: as pausas só são removidas quando o trecho *não tem palavra, tem pico acústico baixo e não tem fala detectada localmente*; palavras baixinhas que o reconhecimento perdeu, caudas de fonema, riso e aplauso sobrevivem. Os 0,25 segundo opcionais de respiro mantêm o ritmo apertado sem sufocar; os limites externos de cortes manuais e costurados ficam fixos, e evidência duvidosa preserva o corte exatamente
- **Remoção de vícios de linguagem**: hesitações do tipo "é…" e gaguejos são cortados (de forma deliberadamente conservadora) e listados item a item no clips.json
- **Normalização de volume**: -14 LUFS (EBU R128) por clipe, medido no áudio já emendado depois dos cortes secos
- **Dois níveis explícitos de limpeza de diálogo**: o Básico mantém a cadeia de duplo passa-alta mais subtração espectral conservadora. O Inteligente em 48k baixa sob demanda um modelo DPDFNet2 de ~10 MB verificado por SHA-256, realça os canais mono ou estéreo em blocos limitados para clipes de até 180 segundos e copia o vídeo sem recodificar. Falha de modelo, de download, de decodificação ou de inferência volta para o Básico; a tela de conclusão e o `clips.json` distinguem aprendido, retorno ao básico e pulado, sem alterar as legendas nem o texto da transcrição
- **Acentos sonoros**: um "whoosh" nos cortes secos de costura e de abertura fria, um "ding" no pico emocional do clipe e um estalo suave quando o gancho de abertura entra — a colocação segue regras, com no máximo 3 por clipe; os efeitos são sintetizados localmente (sem arquivos e sem licenciamento), e basta colocar seus próprios .wav com o mesmo nome para substituí-los
- **Música de fundo (com abaixamento automático)**: escolha qualquer arquivo de áudio local — ele entra em laço para caber no clipe, fica bem abaixo da voz, abaixa sozinho enquanto alguém fala e desaparece no final; a mixagem acontece numa passagem separada, com o vídeo copiado sem ser tocado
- **Verificação de qualidade + autocorreção**: quadros pretos, silêncios longos, vídeo congelado, cobertura do recorte sobre o assunto, volume, duração e cortes no meio de palavra vão para o `clips.json`; os avisos de enquadramento pedem revisão humana, e só as falhas seguras de corrigir são reparadas e mantidas depois de uma nova checagem melhor
- **Capa inteligente ordenada por qualidade**: os picos de áudio propõem os momentos relevantes, e então o clipe pronto é avaliado localmente em nitidez, informação, exposição, faixa tonal e estabilidade da transição; quadros pretos, brancos ou borrados de transição são recusados, as versões pegam a colocação seguinte, e qualquer falha de leitura devolve exatamente a escolha anterior vinda do pico de áudio
- **Corte preciso no quadro**: busca rápida mais recodificação; gravações FLV/TS de horas entram direto
- **Exportação com aceleração por hardware**: usa VideoToolbox, NVENC ou QSV automaticamente quando o ffmpeg embutido tem suporte; um dispositivo ou driver indisponível tenta de novo com x264 de forma transparente, sem perder confiabilidade
- **Pontos de corte precisos (segunda passagem do Paraformer)**: os clipes selecionados são redecodificados antes de exportar para acertar legendas, cortes secos e limites; palavras casadas e interpoladas, cobertura e trechos incertos entram no comprovante, e um alinhamento fraco ou que falhou ainda assim recua com segurança
- **Porta de qualidade da sincronia das legendas**: valida a linha do tempo final, já emendada, quanto a tempos inválidos ou sobrepostos, velocidade de leitura, piscadas, blocos grandes demais e trechos estimados; cada clipe registra um relatório legível por máquina no `clips.json`
- **Exportação cancelável com progresso em tempo real**: o progresso do ffmpeg é transmitido ao vivo; o cancelamento encerra o codificador na hora e os clipes já prontos ficam
</details>

### 🧰 Revisão e fluxo de trabalho: corte bruto da IA, corte final humano

Uma bancada de revisão de clipes (reproduz dentro do app e permite arrastar os pontos de corte palavra a palavra sobre a onda sonora), máscaras de zona segura de legenda fiéis a cada plataforma, predefinições de estilo de marca e memória das preferências de exportação.

<details>
<summary><b>Detalhes</b>: área de projetos · edição reversível · recuperação ao reiniciar · bancada · zonas seguras · pacotes de publicação · séries por tema · versões · templates de marca · duas proporções · compilado · EDL · configurações</summary>

- **Área de projetos**: administre várias edições sem que o estado de uma vaze para a outra; troque, renomeie, feche ou exclua documentos de projeto, mantenha intactos os projetos com origem offline ou alterada e revincule a mídia com segurança — excluir um projeto nunca apaga o arquivo de origem
- **Edição reversível + atalhos profissionais**: seleção, textos e limites, mudanças em vários trechos, clipes manuais e correções de transcrição aceitam desfazer e refazer, com histórico limitado e guardado no projeto; `Espaço/K` reproduz, `J/L` andam ±5s, `I/O` definem entrada e saída e `[/]` navegam entre candidatos, cedendo o teclado automaticamente dentro de campos e janelas
- **Recuperação segura ao reiniciar**: a origem atual, a transcrição, os candidatos, a seleção e os limites ajustados à mão são salvos em pontos de controle; ao reabrir, a origem é validada e o último estado estável é restaurado, nunca um estado transitório de detecção ou exportação
- **Bancada de revisão de clipes**: reproduza os candidatos dentro do app, arraste as alças sobre a onda sonora para ajustar palavra a palavra (encaixando nos limites das palavras) e restaure os cortes da IA com um clique; clipes ajustados à mão pulam o encaixe na troca de plano — a máquina nunca passa por cima de uma decisão humana
- **Prévia da zona segura das legendas**: sobreponha as áreas reais em que a interface de cada plataforma cobre a tela — nove predefinições a partir de medições (Douyin / Kuaishou / Bilibili / WeChat Channels / RedNote / TikTok / Reels / Shorts + a união genérica)
- **Pacotes por plataforma (publique logo depois de cortar)**: pastas por plataforma com o vídeo em link físico, a capa recortada de novo na proporção daquela plataforma (RedNote 3:4, Bilibili 16:10, Channels 6:7) e o texto de publicação cortado nos limites de cada uma, mais um manifesto do que foi adaptado — abra a pasta e suba plataforma por plataforma
- **Pacotes de série por tema (opcional)**: quando dois ou mais clipes originais compartilham uma palavra-chave relevante, eles são agrupados e numerados na ordem de tempo da origem, com manifesto geral e por tema; as versões nunca viram episódios falsos, e os links físicos evitam ocupar disco em dobro
- **Várias versões (diferenciação real para publicar em várias contas)**: de 2 a 3 embalagens de cada clipe numa passagem só — cartelas de título com ângulos de gancho diferentes, chamadas de abertura, textos de publicação e capas tiradas de picos de volume diferentes; construídas sobre valor acrescentado, e não sobre os truques de derrubar quadros ou espelhar que as plataformas hoje marcam como repostagem
- **Templates de estilo de marca**: uma cor de destaque, o tamanho e a posição da legenda e a marca d'água com logo — predefinições com nome, aplicadas a todos os clipes e registradas no comprovante
- **Duas proporções num clique**: o vertical 9:16 mais um conjunto horizontal na mesma passagem (sem cartela de título, com as legendas trocando de layout) — os concorrentes exportam uma proporção por vez
- **Compilado em um clique**: o lote emendado num vídeo de melhores momentos por cópia direta do fluxo (milissegundos, sem perda de qualidade), com um arquivo `.chapters.txt` de capítulos
- **Exportação de linha do tempo EDL**: um `timeline.edl` (CMX3600) com todos os cortes, inclusive as emendas do corte seco — importe no DaVinci ou no Premiere e continue refinando
- **Renderização de onda sonora**: origens só de áudio montam sozinhas um fundo escuro com onda sonora animada na cor da marca, e as legendas são queimadas normalmente
- **Memória das preferências de exportação + edição de título ali mesmo**: as combinações de opções são lembradas entre vídeos, e os títulos podem ser editados no lugar, com os nomes de arquivo e os textos acompanhando
- **Página de configurações**: o local de armazenamento dos modelos fica visível e pode ser movido (entre discos o processo é copiar → verificar → só então apagar), três níveis de qualidade de exportação (o Compacto mediu 66% a menos), estilo padrão de legenda e local de exportação
- **Aviso de atualização**: uma verificação silenciosa ao abrir e um selo discreto quando existe uma versão nova; sem internet, a verificação falha em silêncio
</details>

### 🛡️ Publicar e sobreviver: conformidade pensada para 2026

Cortar bem é metade do jogo — a outra metade é sobreviver à distribuição: detecção de repostagem no nível do pixel, rotulagem obrigatória de conteúdo por IA, algoritmos que pesam a taxa de salvamento. Este grupo cuida dessa metade.

<details>
<summary><b>Detalhes</b>: nota de transformação · capas por IA · trilha por IA · rascunhos do JianYing · registro e evidências · selo de IA · versões contra impressão digital</summary>

- **Nota de transformação**: tudo o que uma exportação realmente mudou (reenquadramento, cortes secos, legendas, cartelas, efeitos…) vira uma única nota, mostrada ao vivo antes de exportar, com cartão amarelo abaixo de 40 — repostagem no nível do pixel é a causa número 1 de remoção em 2026
- **Capas por IA em dois níveis (opcional)**: capas verticais de manchete grande geradas a partir dos títulos dos clipes — nível econômico a cerca de US$ 0,04 e premium a cerca de US$ 0,14 por capa (reaproveitando a sua chave Atlas); ficam salvas ao lado da capa tirada de um quadro, e você usa a que preferir
- **Trilha por IA (opcional)**: instrumental livre de direitos gerado conforme o gênero da transmissão, já ligado à cadeia de mixagem com abaixamento sob a voz — risco zero de licenciamento de biblioteca comercial
- **Exportação de rascunho do JianYing**: cada clipe vira uma pasta de rascunho do JianYing (CapCut CN) com todos os cortes da IA na linha do tempo — o corte bruto sai do HotClip e vai para o editor de acabamento sem recomeçar do zero
- **Registro de retorno das publicações**: toda exportação registra um identificador de conteúdo estável e o status de publicação; um CSV de métricas já preenchido volta por correspondência conservadora de identificador ou de título único, enquanto as linhas sem correspondência ou ambíguas ficam visíveis e os padrões medidos alimentam a próxima rodada de seleção
- **Central local de testes A/B**: exportações com várias versões se agrupam sozinhas por candidato de origem, lote de exportação e plataforma; as comparações exigem uma única plataforma, publicações dentro de 72 horas, métricas completas e pelo menos 500 visualizações por versão, e informam os estados aguardando, insuficiente, inconclusivo ou indicativo, sem afirmar causa a partir de uma variável só
- **Pacote de evidências de distribuição**: o intervalo de origem de cada clipe é registrado em CSV, e opcionalmente com um arquivo de ±3 minutos da origem — quando um corte autorizado é questionado como repostagem, você tem o comprovante
- **Silenciamento de áudio no tempo da transcrição (opcional)**: silencie uma lista local e editável de termos sensíveis preservando a transcrição e as legendas originais; a marcação continua correta mesmo com cortes de silêncio e clipes de vários trechos
- **Assistente de rotulagem de conteúdo por IA**: o texto do selo e os caminhos de cada plataforma, com um clique para copiar; mais um aviso suave acima de 5 clipes por transmissão (os algoritmos de 2026 premiam qualidade, não volume)
- **Versões contra impressão digital**: a última das suas versões troca a abertura por uma antecipação do pico mais uma variação determinística do template (pequenas diferenças de tamanho de fonte, linha de base e margem) — publicar em várias contas sem colidir na impressão digital visual, tudo por diferenciação real e não por truque de pixel
</details>

### 🤖 Lote e ecossistema: CLI / MCP / Agent Skill

Modo automático de um clique + pasta monitorada 24 horas por dia + CLI sem interface + servidor MCP local — **a única cadeia de corte local e sem envio para a nuvem feita para agentes de programação**.

<details>
<summary><b>Detalhes</b>: fila de tarefas persistente · pasta monitorada · diagnóstico · CLI · MCP · skill do Claude Code</summary>

- **Central de tarefas persistente**: a pasta monitorada e os webhooks compartilham uma fila de execução única, com etapas, histórico e contagem de tentativas guardados; as tarefas podem ser canceladas ou repetidas explicitamente, o que estava em andamento vira "interrompido" depois de reiniciar, e credenciais nunca ficam no histórico
- **Camada de desempenho para vídeo longo**: exportações repetidas com a mesma origem, os mesmos cortes e os mesmos efeitos base restauram exatamente a renderização base local; o vídeo H.264 só é copiado num corte contínuo cujo início se prova alinhado a quadro-chave e cujos pixels não mudaram. O áudio ainda recebe as transições, a redução de ruído, o volume e o silenciamento de termos sensíveis, e qualquer falha volta de forma transparente para a codificação precisa. O armazenamento LRU tem teto de 1 GB e pode ser inspecionado ou limpo separadamente
- **Pasta monitorada de gravações (24 horas por dia)**: aponte para a pasta de saída do seu OBS ou gravador; as gravações são transcritas, garimpadas e exportadas no instante em que terminam de ser escritas ("duas rodadas de tamanho estável" — arquivo ainda sendo gravado nunca é cortado)
- **Diagnóstico de ambiente no desktop**: um clique confere FFmpeg e FFprobe, a integridade do baixador, onze papéis de modelo, a conexão, a autenticação e o roteamento do LLM, o disco, o cache de transcrição, o cache de renderização e o índice multimodal de evidências; os modelos principais que faltam podem ser preparados com cancelamento e retomada, e o cache de renderização de 1 GB e o índice de evidências de 64 MB são limpos de forma independente
- **CLI sem interface** (com as mesmas saídas do aplicativo de desktop):

  ```bash
  pnpm cli transcribe live.mp4                 # reconhecimento local com marcação por palavra (com cache)
  pnpm cli highlights live.mp4 --json          # candidatos a destaque da IA, para revisar antes
  pnpm cli clip live.mp4 --max-clips 10 --smart-denoise  # exportação completa + diálogo inteligente em 48k
  pnpm cli feedback metricas.csv               # importa as visualizações e o engajamento reais
  pnpm cli feedback-report                     # mostra os padrões de alto e baixo desempenho aprendidos
  pnpm cli doctor --download                   # autodiagnóstico do ambiente + download prévio dos modelos
  ```

- **Servidor MCP local** (para registrar no Claude Code ou no Claude Desktop) — três ferramentas: `clip_video`, `detect_highlights` e `transcribe_video`:

  ```json
  {
    "mcpServers": {
      "hotclip": {
        "command": "npx",
        "args": ["-y", "tsx", "src/mcp/server.ts"],
        "cwd": "/caminho/para/hotclip",
        "env": {
          "HOTCLIP_LLM_BASE_URL": "http://localhost:11434/v1",
          "HOTCLIP_LLM_MODEL": "qwen3:8b"
        }
      }
    }
  }
  ```

- **Skill oficial para agentes** — cole isto no Claude Code ou no Codex e o agente instala tudo sozinho:

  > Instale o HotClip como minha skill local de cortes: `git clone https://github.com/xixihhhh/hotclip.git && cd hotclip && pnpm install`, depois copie `skills/hotclip/` para o meu diretório de skills do agente (`~/.claude/skills/hotclip/` no Claude Code) e configure as variáveis de ambiente do LLM conforme `skills/hotclip/SKILL.md`. Verifique rodando `pnpm cli highlights` num vídeo de teste.

- **Comprovante de processamento no clips.json**: o que a esteira fez com cada clipe (estilo de legenda, modo de reenquadramento, proporção de corte seco, cobertura da evidência de fala e intervalos protegidos, cobertura do alinhamento, checagem das legendas, modo e nota da escolha de capa, vícios de linguagem removidos e a decisão de cor da origem, incluindo a marca de HDR não convertido) — auditável de ponta a ponta e pronto para entrar num fluxo automatizado
- **Avaliação de qualidade de referência**: `pnpm quality:eval [fixture.json]` informa CER/WER, o erro mediano e P95 no limite das palavras e o recall@3/@5 dos destaques, tudo localmente, para que mudanças de modelo e de limiar sejam comparadas sobre a mesma evidência
- **Comparação local de modelos de visão**: `HOTCLIP_VISION_MODELS=qwen3-vl:4b,qwen3.5:4b pnpm quality:eval:vision` passa os mesmos clipes de demonstração pelos mosaicos de quadros e pelo leitor estruturado exatos do HotClip, informando taxa de sucesso, latência e evidência visual. Quem administra os modelos é o Ollama; o HotClip não embute pesos de vários gigabytes
- **Traga a sua IA (ou nenhuma)**: modelos locais gratuitos por padrão; conecte o [Atlas Cloud](https://www.atlascloud.ai), o fal.ai ou qualquer endpoint compatível com OpenAI — ou o Ollama local para uma esteira totalmente offline
</details>

## Novidades

**[v0.32.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.32.0)**: corrige a tela preta permanente e a falha ao saltar na bancada de revisão no Windows quando vários vídeos compartilham o mesmo fluxo de mídia; os erros de prévia agora mostram o código real; a lista de modelos buscados ganhou uma seleção clicável explícita, e a digitação manual continua disponível.

**[v0.31.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.31.0)**: a bancada de transcrição pode filtrar conversas com várias pessoas por S1 / S2, com a busca, as ocorrências de fala parecida e a prévia do corte acompanhando o filtro.

**[v0.30.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.30.0)**: a busca opcional por fala parecida encontra resultados de reconhecimento que diferem por um caractere quando a busca exata não traz nada, com marcação explícita de correspondência aproximada e audição antes de escolher.

**[v0.29.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.29.0)** (16/09/2026): busca unificada de fala e imagem, salto até a palavra, reprodução do contexto e clipes pré-selecionados; seletor virtualizado para transcrições longas, requisições de modelo com limite de tempo e recuperação cancelável de erros temporários, e concorrência limitada na triagem local com preservação dos blocos que falharam. [Notas da versão](docs/releases/v0.29.0.md).

**[v0.28.1](https://github.com/xixihhhh/hotclip/releases/tag/v0.28.1)** (12/09/2026): corrige as respostas vazias dos modelos de raciocínio híbrido Qwen3/QwQ, reduz o tamanho Pequeno da legenda dinâmica para 0,68 e permite que a reprodução de revisão no Windows tente de novo depois de uma falha ao carregar a mídia. [Notas da versão](docs/releases/v0.28.1.md).

**[v0.28.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.28.0)** (05/09/2026): **importação de legendas e transcrições longas** (SRT / WebVTT, busca entre frases, prévia de alinhamento seletivo e desfazer); **fala local retomável** com Qwen3-ASR opcional; **ritmo de legenda conforme o idioma** e **exportações mais seguras**, com cancelamento na etapa de preparação, substituição segura da saída, repetição direta e saída só de SRT. [Notas da versão](docs/releases/v0.28.0.md).

**[v0.27.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.27.0)** (31/08/2026) "Deixe a voz clara antes de dar o polimento": **realce inteligente de diálogo em 48 kHz** (um nível Inteligente explícito baixa sob demanda um modelo DPDFNet2 de ~10 MB verificado por SHA-256, processa os canais em blocos limitados e copia o vídeo pronto sem recodificar); **ordem correta do áudio de publicação** (roda depois da montagem de costuras e aberturas frias, mas antes dos efeitos e da trilha, com o volume medido depois do realce); **recuo pela disponibilidade** (falha de modelo, download, decodificação ou inferência reaproveita de forma transparente a cadeia Básica exata, o comportamento de Desligado e Básico não muda, e a tela de conclusão mais o `clips.json` informam com honestidade se foi aprendido, recuado ou pulado); **predefinição multimodal local atualizada** (instalações novas usam `qwen3.5:4b` como endpoint de visão opcional do Ollama, compartilhando um modelo entre texto e mosaicos de quadros, com um comando reproduzível de comparação de modelos de visão). Desktop, CLI e MCP compartilham a mesma semântica de níveis; o teste de fumaça oficial do modelo de 48k e as regressões de integração com o FFmpeg passam.

**[v0.26.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.26.0)** (31/08/2026) "Cortes mais justos, sem apostar num fonema só": **evidência local de atividade de fala** (reaproveita o runtime nativo do sherpa-onnx já embutido com um único modelo de 629 KB verificado por SHA-256 — sem Python e sem enviar áudio); **bordas automáticas seguras** (só evidência corroborada de detecção de fala e de palavras pode proteger a fala externa, dentro de um teto rígido de 0,6s de movimento, e restringir o encaixe posterior na troca de plano; os limites externos manuais e costurados nunca se movem); **corte seco com três portas** (um trecho só é removido quando não tem palavra, está com pico baixo e a detecção de fala é negativa, preservando as palavras baixinhas que o reconhecimento perdeu); **paridade com o áudio selecionado** (a evidência de fala e de pico mapeia explicitamente a mesma trilha de áudio da renderização final); **recuo exato e auditável** (o `clips.json` registra cobertura, variação nas bordas e intervalos protegidos, enquanto janelas longas, cobertura baixa, falha de modelo ou de decodificação preservam o comportamento anterior). Verificado com um teste de fumaça de fala sintetizada real e uma regressão de FFmpeg com várias trilhas.

**[v0.25.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.25.0)** (30/08/2026) "Analise a imagem certa, publique o quadro certo": **paridade da imagem selecionada em toda a análise** (estatísticas de movimento, plano e visual, TransNetV2, quadros de emoção facial, mosaicos para o modelo de visão, revisão dos candidatos, tiras de miniaturas da linha do tempo, detecção de faixas de interface e reenquadramento por rosto ficam todos presos à mesma trilha de vídeo global da renderização final); **prévia HDR para análise** (só caminhos PQ/HLG completos e executáveis recebem a prévia SDR verificada antes de redimensionar ou medir; SDR e HDR incompleto mantêm o comportamento de fail-open); **isolamento de cache** (a identidade das evidências de nível 0, de plano e de visão inclui a trilha selecionada e a versão do plano de cor); **capas ordenadas por qualidade** (picos de áudio mais uma reserva uniforme propõem os momentos, e então o FFmpeg embutido avalia o clipe final pós-verificação em nitidez, informação, exposição, faixa tonal e estabilidade da vizinhança curta; quadros inseguros são recusados, as versões usam a colocação seguinte e as falhas preservam o horário antigo exato). Sem novo modelo, dependência, download, envio ou custo de nuvem; um material real com dois vídeos PQ e um conjunto de referência de capas com quatro cenas ficam na regressão.

**[v0.24.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.24.0)** (30/08/2026) "HDR entra, cor previsível sai": **porta rígida de metadados** (a conversão automática exige uma curva PQ/SMPTE ST 2084 ou HLG/ARIB STD-B67 explícita mais primárias, matriz de cor e faixa completas e com suporte; o metadado de MaxCLL ou de pico de masterização, quando existe, guia o limite das altas luzes, enquanto SDR e curvas desconhecidas mantêm o tratamento de pixel existente); **tratamento seguro de ambiguidade e de falha** (HDR incompleto ou sem suporte fica sem conversão, e uma falha de leitura é rotulada à parte; os dois mantêm o acabamento adaptativo no domínio SDR desligado, e desktop, CLI, MCP e `clips.json` concordam sobre o estado); **seleção determinística entre várias trilhas** (leitura, metadado de pico, renderização e cache ficam presos à mesma imagem selecionada; vídeo único em SDR mantém seu tratamento de pixel e a decisão de copiar o fluxo); **entrega SDR em luz linear** (a entrada que se qualifica é convertida com marcações de origem explícitas e um mapeamento de tons Mobius contido para BT.709/yuv420p marcado, antes de recorte, reenquadramento, zoom, legendas ou marca d'água); **paridade completa do caminho de renderização sem peso novo** (cortes contínuos, cortes secos de silêncio, costuras de vários trechos, aberturas frias, sobreposições de legenda do Chromium e correções mantidas da verificação de qualidade preservam a mesma decisão, sem novo modelo, download de arquivo, chamada de API ou envio de material).

**[v0.23.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.23.0)** (30/08/2026) "O que a imagem diz também deve valer como evidência": **evidência de texto na tela** (reaproveita a varredura completa e a revisão de candidatos já ativadas — sem instalar OCR e sem chamada extra de modelo; só o texto que pode ser transcrito com confiança é mantido, como nome de produto, preço, placar, títulos e dados de slide, deixando o resto em branco); **conteúdo estático deixou de ser invisível** (cartelas de preço de baixa energia e slides com texto claro ganham espaços reservados de evidência, melhorando clipes de produto, de curso e de análise); **revisão visual estruturada** (a cena observada, a nota visual, a correspondência com o título e o texto visível atravessam os candidatos, a saída da CLI e do MCP e o `clips.json`, com um comprovante bilíngue na bancada); **capas mais bem fundamentadas** (as capas por IA preferem a cena realmente observada na revisão dos candidatos a um chute feito só a partir da transcrição). A opção de visão continua sendo a fronteira: custo zero quando desligada e fail-open quando indisponível.

**[v0.22.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.22.0)** (30/08/2026) "Corrija a imagem só quando a evidência mandar": **acabamento de imagem adaptativo** (uma opção explícita e desligada por padrão, compartilhada pelos conjuntos do desktop, pelo `--auto-enhance` da CLI e pelo MCP); **medição local ao clipe** (a decodificação de nível 0 a 4 fps que já existia agora guarda luminância baixa, média e alta e a saturação, e então avalia apenas os intervalos realmente preservados depois dos cortes secos ou da costura — sem novo modelo e sem decodificação completa); **tetos rígidos e contidos** (mudanças sutis de brilho, contraste, saturação e gama só para material com amostra suficiente que esteja claramente escuro, sem contraste, estourado ou saturado demais; imagem saudável não recebe filtro nenhum e preto e branco nunca é colorido à força); **paridade do caminho de renderização** (cortes contínuos, cortes secos e janelas de abertura fria recebem o plano correspondente depois do recorte e da escala e antes das legendas e da marca d'água); **auditável e seguro para o cache** (o `clips.json` registra as medições, os motivos e os ajustes exatos, a identidade do cache de renderização inclui o plano derivado, e gravações extremas mantêm uma cobertura da origem uniformemente limitada)

**[v0.21.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.21.0)** (30/08/2026) "Não basta exportar — prove que a imagem sobreviveu": **verificação de quadro congelado** (a passagem de FFmpeg que já existia sinaliza trechos quase estáticos de 3 segundos ou mais, incluindo um congelamento que vai até o fim do arquivo); **comprovante de cobertura do assunto** (reaproveita as amostras do YuNet que já existiam para medir rostos parcial e gravemente cortados em relação à trajetória vertical final, sem nenhuma passagem extra de modelo); **travas de plano de verdade** (o enquadramento travado se mantém até o plano seguinte em vez de derivar na direção dele); **movimento de câmera seguro no corte seco** (as trajetórias de recorte trocam nas emendas preservadas em vez de interpolar por um tempo de origem descartado). Os achados de congelamento e de enquadramento são avisos semânticos, só para revisão, e nunca recortes automáticos arriscados.

**[v0.20.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.20.0)** (30/08/2026) "Mantenha o assunto em quadro e a câmera calma": **composição vertical que preserva o enquadramento** (todos os rostos visíveis são fundidos por plano; a câmera fica travada sempre que uma pessoa em movimento ou um grupo cabe com folga, e só acompanha quando o enquadramento realmente exige); **encaixe no centro** (uma composição de origem quase centralizada continua centralizada em vez de ganhar uma deriva artificial); **recuperação de assunto perdido** (segura durante uma falha breve do detector e volta suavemente ao centro depois de 1,25 segundo; um plano novo sem rostos confiáveis centraliza na hora); **comprovante de ponta a ponta** (o `clips.json` registra quantos planos ficaram no total, travados, travados em grupo, acompanhados, em recuperação e com o centro como padrão, somados entre os trechos costurados). Sem novo modelo nem peso extra no instalador; detecção esparsa continua recuando com segurança para o recorte central.

**[v0.19.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.19.0)** (28/08/2026) "Analise uma vez, deixe todo corte seguinte mais rápido e mais afiado": **índice local de evidências multimodais** (impressão digital da origem + versão de capacidade + identidade do modelo, escrita atômica, invalidação de entrada corrompida e teto LRU de 64 MB); **cadeia de evidência em nove caminhos** (os picos de movimento, que não usam modelo, se juntam à transcrição, ao volume, aos planos, à emoção facial, à visão, ao chat ao vivo, ao tom de voz e ao riso/aplauso); **evidência de movimento visível** (uma curva na linha do tempo da bancada mais quadros representativos, com cobertura reservada da origem inteira); **reúso entre entradas** (os sinais de nível 0, os limites do TransNetV2 e as varreduras opcionais de visão são compartilhados por desktop, CLI, MCP, pasta monitorada e webhooks, com reconstrução automática depois de mudanças de modelo ou detector e sem guardar chave de API); **diagnóstico e limpeza independentes** (a evidência de análise nunca apaga o cache de renderização ou de transcrição, e pode sempre ser gerada de novo)

**[v0.18.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.18.0)** (28/08/2026) "Qualidade que dá para inspecionar, melhorias que dá para medir": **origem da marcação por palavra** (nativa, alinhada em segunda passagem, interpolada, editada ou estimada, sem quebrar projetos antigos); **revisão focada** (selo de tempo estimado e filtro na transcrição, mais o comprovante de tempo nos detalhes do candidato); **relatórios de alinhamento traduzidos** (cobertura, contagem de palavras alinhadas e interpoladas e trechos incertos no `clips.json`); **porta de qualidade das legendas** (tempo inválido, sobreposição, velocidade de leitura, piscadas, blocos grandes demais e trechos estimados conferidos na linha do tempo renderizada final); **avaliação de referência repetível** (CER/WER local, erro de limite e recall@K dos destaques, sem baixar novos modelos); mais uma prévia `dev:web` independente no navegador, para regressão de interface sem o runtime do Electron

**[v0.17.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.17.0)** (25/08/2026) "Vídeo longo fica mais rápido a cada repetição": **cache limitado da renderização base** (reúso exato quando origem, cortes, legendas, reenquadramento, áudio e marca coincidem, com escrita atômica, invalidação de entrada corrompida e poda LRU com teto de 1 GB); **cópia inteligente e segura** (cópia do fluxo de vídeo H.264 apenas em cortes contínuos alinhados a quadro-chave e sem mudança de pixel; AAC, transições nas bordas, redução de ruído, volume e silenciamento de termos sensíveis continuam ativos, e qualquer incerteza ou falha volta para a codificação precisa); **compartilhado em todo lugar** (exportações do desktop, pasta monitorada, webhooks, CLI e MCP usam o mesmo cache); **diagnóstico e limpeza delimitada** (tamanho visível nos dois idiomas e limpeza em duas etapas que nunca toca em projetos, mídia de origem, modelos ou cache de transcrição)

**[v0.16.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.16.0)** (25/08/2026) "Projetos permanecem, toda edição pode voltar atrás": **área de projetos** (lista com vários projetos, troca, renomear, fechar, excluir e revincular mídia; origens offline ou alteradas mantêm o projeto, e sessões antigas migram sozinhas); **histórico de edição reversível** (seleção, textos e limites, clipes manuais e correções de transcrição compartilham o desfazer e refazer, com teto de 60 comandos ou 4 MB, restaurados junto com o projeto); **controles profissionais de teclado** (reprodução, salto, entrada e saída e navegação entre candidatos, com proteção segura dentro de campos e janelas); **central local de testes A/B** (exportações com várias versões se agrupam por plataforma, as métricas entram por identificadores de conteúdo estáveis, com portas de mesma plataforma, 72 horas e amostra mínima, e só evidência de direção)

**[v0.15.1](https://github.com/xixihhhh/hotclip/releases/tag/v0.15.1)** (24/08/2026) "O trabalho sobrevive e a publicação ensina": **exportação com aceleração por hardware** (VideoToolbox / NVENC / QSV com recuo transparente para x264); **central de desempenho das publicações** (importa as métricas das plataformas e devolve os padrões de acerto e de erro para a seleção); **importação verificada de link público de vídeo** (links do tipo Bilibili ou YouTube, com a ferramenta de download conferida e retomada de download); **edição segura a reinícios** (origem, transcrição, candidatos, seleção e cortes manuais se recuperam); **central de tarefas automáticas persistente** (uma fila de pasta monitorada e webhooks, com histórico, cancelamento, repetição e estado interrompido, sem guardar credenciais); **silenciamento de termos sensíveis no tempo da transcrição** (correto mesmo com cortes secos e clipes de vários trechos, preservando as legendas originais); **registro de retorno das publicações** (identificadores de conteúdo estáveis, CSV de métricas já preenchido, correspondência conservadora e status de aguardando); **diagnóstico de saúde no desktop** (ferramentas, nove papéis de modelo, LLM, disco e cache, e preparação dos modelos principais cancelável e retomável); **pacotes de série por tema** (palavras-chave repetidas e relevantes viram episódios ordenados, sem as versões e com manifesto)

**[v0.15.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.15.0)** (20/08/2026) "O assistente se aposenta, a bancada bate o ponto": **bancada de três painéis** (o assistente de 3 passos se aposenta — origens e monitoramento de gravações à esquerda; visão da origem, recorte 9:16 ao vivo, linha do tempo e uma tabela densa de candidatos no centro; detalhes do candidato e ajuste da detecção à direita, tudo numa tela só); **a linha do tempo chegou** (curva de volume da transmissão inteira + curva de euforia do chat + tira de miniaturas, com os trechos candidatos desenhados em cima das curvas — onde estão os destaques se vê de relance); **candidatos sobrevivem à navegação** (um armazenamento de sessão mantém os candidatos e o estado da revisão entre as telas); **detectar de novo é explícito** (ajustar os parâmetros de detecção não refaz mais a passagem inteira em silêncio — você clica em "Detectar de novo" quando quiser); **conjuntos de exportação** (33 opções dobradas em seis grupos, com três conjuntos de um clique: Padrão, Kit de vendas e Mínimo e rápido); **central de configurações** (sete pontos de configuração espalhados — modelo de IA, motor de transcrição, exportação e armazenamento, estilo de marca, glossário, monitoramento de gravações e idioma — reunidos numa página); **os votos do chat, contados direito** — suporte ao registro de chat do gravador do Douyin (.jsonl descoberto ao lado do .xml do BililiveRecorder, para que as gravações de quem transmite no Douyin finalmente tenham a evidência do chat), peso por evento de interação (mensagens pagas, assinaturas, presentes, novos seguidores e curtidas em faixas próprias, porque voto com dinheiro e com ação vale mais que mensagem solta), teto contra spam (a contribuição de um mesmo remetente por janela é limitada), bônus de subida (um salto sobre a janela anterior vale pontos extras, porque destaque explode, não ferve devagar), melhorias na fusão (bônus de ressonância entre sinais + janelas adaptadas ao conteúdo) e amostragem guiada pelo chat (os modelos caros gastam o orçamento onde o chat explode); além disso, corrige a tela preta da prévia em máquina real (vários elementos de vídeo carregando uma mesma URL de fluxo local colidem no Chromium) e as miniaturas da tira bloqueadas pela política de segurança de conteúdo

<details>
<summary><b>Histórico de versões</b> (v0.4.3 → v0.14.1) e marcos</summary>

- **[v0.14.1](https://github.com/xixihhhh/hotclip/releases/tag/v0.14.1)** (11/08/2026) "Pense fundo, mas entregue": corrige a "resposta vazia do LLM" ([#8](https://github.com/xixihhhh/hotclip/issues/8)) — modelos de raciocínio gastam o orçamento inteiro de 4.000 tokens de saída pensando e não devolvem conteúdo; respostas que são só raciocínio agora tentam de novo automaticamente com 16.000 tokens, o conteúdo que foi parar no campo `reasoning` é recuperado, e as falhas restantes são atribuídas com um próximo passo (orçamento gasto, filtro de conteúdo ou resposta vazia temporária)
- **[v0.14.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.14.0)** (09/08/2026) "Publique e sobreviva": **nota de transformação** (tudo o que uma exportação realmente mudou vira uma nota, mostrada ao vivo, com cartão amarelo abaixo de 40 — repostagem no nível do pixel é a causa número 1 de remoção em 2026); **capas por IA em dois níveis** (capas verticais de manchete grande a partir dos títulos: Seedream econômico a ~US$ 0,04 e Nano Banana Pro premium a US$ 0,14, reaproveitando a chave Atlas); **trilha por IA** (instrumental livre de direitos por gênero de transmissão, já ligado à cadeia de mixagem); **exportação de rascunho do JianYing** (pastas de rascunho por clipe com todos os cortes da IA na linha do tempo); **legendas com marca de falante** (prefixos coloridos "A:" e "B:"); **impulso por densidade útil** (clipes cheios de passos, listas e números são marcados como "vale salvar" para pegar o impulso lento de 7 dias); **registro de distribuição e pacote de evidências** (CSV com o intervalo de origem + arquivo de ±3 min da origem); **assistente de rotulagem de conteúdo por IA** (texto do selo por plataforma e aviso de teto acima de 5 clipes por transmissão); **versões contra impressão digital** (antecipação do pico na abertura da última versão + variação determinística do template); **manter as respiradas** (pausas opcionais de 0,25s nos cortes secos); **AppImage de Linux** experimental ([#7](https://github.com/xixihhhh/hotclip/issues/7))
- **[v0.13.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.13.0)** (09/08/2026) "Assista tudo e tenha coragem de descartar": **porta de qualidade em três níveis** (julgamento sem contexto entre publicar, revisar e descartar + camada de regras para os defeitos evidentes; os descartes ficam recolhidos mas resgatáveis, e o modo automático entrega só o nível publicar); **varredura visual da transmissão inteira** (1 quadro a cada 30s ao longo de tudo, levando os acontecimentos em tela para a evidência; sai de graça localmente e custa centavos por transmissão na nuvem); **briefing do usuário** (em linguagem simples, o que procurar e o que evitar); **pedido de corte de quem transmite** ("corta esse pedaço" é a evidência mais forte); **costura em três atos para venda** (dor → demonstração → preço, costurados sozinhos); **escolher na transcrição** (clicar frases para montar clipes: busca, filtro por falante, atravessando trechos); **verificação prévia do LLM** (configurações fadadas ao fracasso são bloqueadas com o próximo passo, [#6](https://github.com/xixihhhh/hotclip/issues/6))
- **[v0.12.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.12.0)** (05/08/2026) "Escolha melhor, abra mais alto": **antecipação do pico na abertura fria** (mostra de 0,3 a 1s do momento mais explosivo e depois volta, coordenando-se sozinha com a abertura pelo desfecho); **revisão visual por IA** (uma olhada nos mosaicos de quadros dos melhores candidatos: a nota visual entra na ordenação e as incoerências são sinalizadas; de graça localmente, e uma chave de API troca para a nuvem); **pontos de corte precisos** (a marcação por palavra da segunda passagem do Paraformer, a ±50 ms, acerta legendas, cortes secos e limites, com recuo seguro); **checagem do desfecho do gancho** (os números prometidos precisam aparecer no clipe); **modernização das legendas** (destaque de palavra-chave como padrão e palavra saltando com aceso palavra a palavra e entrada amortecida); além da correção de quatro opções de exportação que nunca tinham sido ligadas
- **[v0.11.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.11.0)** (05/08/2026) "Pronto para publicar": **pacotes por plataforma** (pastas por plataforma depois da exportação: vídeo em link físico + capas recortadas na proporção de cada uma + textos cortados nos limites de cada plataforma, com um manifesto de adaptação); **várias versões** (de 2 a 3 embalagens realmente diferentes por clipe: cartelas de título com ângulos de gancho diferentes, chamadas, textos e capas; marcadas com `variantOf`, e os compilados e o EDL incluem só os originais); **acentos sonoros e trilha** (whoosh nos cortes secos, ding no pico emocional e estalo suave sob o gancho, no máximo 3 por clipe; a trilha entra em laço com abaixamento sob a voz e desaparece no fim, mixada numa passagem separada sem perda de qualidade); além do estilo de legenda **minimalista dinâmico**
- **[v0.10.1](https://github.com/xixihhhh/hotclip/releases/tag/v0.10.1)** (05/08/2026) "Modelos trocáveis, tolerantes a soluços": **o seletor de modelo agora é sempre alcançável** — antes, uma vez configurado, não havia como trocar de provedor ou de modelo (o painel só reaparecia num erro de detecção), então os sete provedores novos da v0.10.0 eram inalcançáveis para quem já usava; agora um botão na barra mostra o modelo atual e reabre o painel, e confirmar depois de uma troca refaz a detecção; **JSON malformado do LLM é repetido uma vez** (endpoints conhecidos emitem tokens sujos no meio do JSON de vez em quando, matando a rodada inteira); **o caminho por sinal indica menos momentos** (12 candidatos faziam o modelo devolver um template não preenchido; o teto passou para 8)
- **[v0.10.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.10.0)** (05/08/2026) "Escolha melhor": uma reformulação **do que é escolhido** — os clipes agora podem ser **costurados a partir de vários trechos** (colocar lado a lado dois momentos separados por dez minutos é o que faz um corte de "se contradisse" funcionar); os **critérios por gênero de transmissão** foram refeitos sobre as **categorias reais** do Bilibili e do Douyin (acrescentando VTuber, rádio, pets, comida, esports, artesanato e assistir junto, que estavam faltando por completo — e assistir junto agora proíbe explicitamente cortar o conteúdo protegido que está na tela); um novo **caminho de candidatos guiado por sinal**, para que transmissões de dança, de pets e de rua, cujas transcrições são vazias e que antes não rendiam nada, sejam localizadas por sinais de áudio e de imagem; o riso deixou de ser tratado como o destaque em si (ele vem depois da piada que o causou). Além disso: **tom de voz e riso/aplauso** como dois novos caminhos de evidência, **zoom automático**, **corte de repetições**, **webhooks de gravador** (BililiveRecorder/blrec), **predefinições de vários provedores de LLM** (DeepSeek, Model Studio, GLM, Kimi, SiliconFlow, OpenRouter, OpenAI) e **busca da lista de modelos em um clique** (os identificadores de modelo envelhecem conforme os fornecedores lançam gerações novas, então melhor perguntar ao endpoint)
- **[v0.9.4](https://github.com/xixihhhh/hotclip/releases/tag/v0.9.4)** (31/07/2026) "Nome de usuário com acento deixou de ser problema": corrige a falha garantida de transcrição em nomes de usuário do Windows fora do ASCII ([#4](https://github.com/xixihhhh/hotclip/issues/4)) — os caminhos de modelo são convertidos sozinhos para o formato curto 8.3 e as amostras de áudio são lidas pelo lado do app; a transferência de modelos entre discos foi desbloqueada, e as falhas ao carregar modelo agora dizem o que de fato fazer
- **[v0.9.3](https://github.com/xixihhhh/hotclip/releases/tag/v0.9.3)** (28/07/2026) "Você decide onde as coisas ficam": página de configurações ([#3](https://github.com/xixihhhh/hotclip/issues/3)) — armazenamento de modelos visível e movível, três níveis de qualidade de exportação (Compacto 66% menor), estilo padrão de legenda e local de exportação
- **[v0.9.2](https://github.com/xixihhhh/hotclip/releases/tag/v0.9.2)** (27/07/2026) "Erros honestos, interface sem amassar": as falhas de transcrição passam a ser atribuídas corretamente ([#2](https://github.com/xixihhhh/hotclip/issues/2)); a barra de opções de exportação quebra linha em vez de estourar o layout; pasta de saída configurável
- **[v0.9.1](https://github.com/xixihhhh/hotclip/releases/tag/v0.9.1)** (24/07/2026) "Correção do primeiro uso no Windows": o laço de download de modelo que chegava a 100% e recomeçava foi corrigido (descompactador em JavaScript puro como alternativa para bzip2); etapa de progresso da descompactação; gravação atômica
- **[v0.9.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.9.0)** (24/07/2026) "Aprende o seu gosto": ciclo de retorno da revisão + autodiagnóstico `doctor` + download de modelo com retomada + modelos estruturados de texto de publicação (8 ângulos × 5 chamadas finais) + entrada de clipe de referência concluída
- **[v0.8.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.8.0)** (20/07/2026) "Corte como o que viralizou": detecção guiada por clipe de referência + ciclo de verificação com autocorreção + checagem de palavras proibidas (mais de 120 regras) + legendas Hormozi + avaliação de quadros por mosaico
- **[v0.7.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.7.0)** (16/07/2026) "Confira cada corte": verificação de qualidade da renderização + CLI sem interface e skill para agente + compilado + abertura fria + duas proporções + modo produto
- **[v0.6.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.6.0)** (10/07/2026) "Veja a imagem": cadeia de evidência com seis sinais + legendas bilíngues + servidor MCP local + pasta monitorada + kit de publicação
- **[v0.5.0](https://github.com/xixihhhh/hotclip/releases/tag/v0.5.0)** (09/07/2026) "Escolha certo, entregue firme": bancada de revisão + encaixe na troca de plano + templates de marca + funil de dois níveis
- **[v0.4.3](https://github.com/xixihhhh/hotclip/releases/tag/v0.4.3)** (06/07/2026) Base de engenharia: cache de transcrição + comprovante no clips.json

| Marco | Situação |
|---|---|
| Aplicativo de desktop · três níveis locais de transcrição · destaques por IA · clipes verticais com legendas · composição que preserva o enquadramento | ✅ Concluído |
| Separação de falantes · legendas em balão · cortes secos · modo automático · instaladores | ✅ Concluído |
| v0.5 – v0.9 (bancada · MCP · pasta monitorada · verificação e correção · ciclo de retorno · configurações) | ✅ Entregue |
| v0.10 – v0.14 (costura de vários trechos · critérios por gênero · porta de qualidade · pacotes de publicação · versões · rascunhos do JianYing · nota de transformação · capas e trilha por IA) | ✅ Entregue |
| v0.15 (bancada de três painéis · curvas na linha do tempo · peso das interações do chat) | ✅ Entregue |
| v0.15.1 (exportação por hardware · importação por link · recuperação · fila persistente · retorno das publicações · diagnóstico · séries por tema) | ✅ Entregue |
| v0.16 (área de projetos · edição reversível · atalhos profissionais · testes A/B locais) | ✅ Entregue |
| v0.17 (cache limitado de renderização · cópia segura por quadro-chave · compartilhado entre entradas · limpeza delimitada) | ✅ Entregue |
| v0.18 – v0.27 (avaliação de qualidade · porta de qualidade das legendas · reúso de evidência multimodal e de texto na tela · reenquadramento que preserva o enquadramento · verificação da renderização · acabamento de imagem adaptativo · exportação SDR segura com HDR · paridade da trilha selecionada · capas por qualidade · cortes que respeitam a fala · realce inteligente de diálogo em 48k) | ✅ Entregue |
| Melhoria do reconhecimento em inglês (Parakeet) · assinatura de código · modo automático mais profundo | 🗺️ [Planejado](docs/PRODUCT-PLAN.md) |

</details>

Histórico completo em [Releases](https://github.com/xixihhhh/hotclip/releases) · Quer opinar sobre o que vem primeiro? [Discussions](https://github.com/xixihhhh/hotclip/discussions)

## Perguntas frequentes

**Qual é a melhor alternativa gratuita ao Opus Clip, sem marca d'água?**
O HotClip — gratuito, de código aberto (AGPL-3.0), roda localmente em Windows, macOS e Linux (experimental), sem marca d'água, sem créditos e sem limite de duração. Os LLMs opcionais na nuvem cobram na sua própria chave; com um modelo local no Ollama, fica totalmente gratuito e offline.

**Existe um cortador com IA que rode localmente, sem enviar meu vídeo?**
Sim — transcrição, legendas, corte e exportação rodam todos na sua máquina. Só a etapa de busca de destaques chama um LLM na nuvem por padrão (com a sua chave e só o texto da transcrição); aponte para o Ollama local e a esteira fica 100% offline.

**Como transformo um podcast ou uma gravação de live em cortes?**
Importe o arquivo → a IA transcreve e marca os destaques (tudo editável) → exporte clipes verticais 9:16 com legendas, capas e texto de publicação.

**Como coloco legendas animadas, palavra a palavra, no vídeo?**
Elas são automáticas — a marcação por palavra move as legendas dinâmicas queimadas em todo clipe (destaque de palavra-chave, palavra saltando, balão e outras, com uma opção para trocar); a exportação de SRT e as legendas bilíngues estão a uma opção de distância.

**Ele remove vícios de linguagem e silêncios?**
Sim — corte seco dos silêncios mais uma passagem sobre "é…" e "ãh", com a sincronia das legendas remapeada e cada edição registrada no clips.json.

**Como o HotClip lida com vídeo HDR?**
PQ/HLG é mapeado para SDR BT.709 marcado apenas quando primárias, matriz de cor e faixa estão completas e com suporte. Marcações HDR incompletas ou sem suporte mantêm o caminho de renderização existente, pulam o acabamento adaptativo no domínio SDR e marcam o resultado como não convertido, em vez de adivinhar; SDR e curvas desconhecidas seguem pelo caminho de sempre. Nenhum modelo, download ou envio é acrescentado.

**Os dados do chat ao vivo ajudam a escolher os destaques?**
Sim — e é a evidência mais forte que existe. O HotClip descobre sozinho o arquivo de chat que está ao lado da gravação (funciona com o .xml do BililiveRecorder e com o .jsonl do gravador do Douyin); a densidade do chat mais mensagens pagas, assinaturas, presentes, novos seguidores e rajadas de curtida entram direto na busca de destaques, com teto contra spam por remetente e bônus de subida. Sem arquivo de chat, os sinais de volume, troca de plano, movimento, emoção facial, tom de voz e riso cobrem a falta.

**Funciona para vídeo em português?**
Sim. A interface, as legendas e os prompts são roteados por idioma, e as transcrições em português passam a receber prompts em português, com os títulos, ganchos e justificativas saindo no mesmo idioma do material. Para material em mandarim, cantonês ou com alternância de idioma, os motores dedicados (SenseVoice / Paraformer / FireRedASR2) continuam disponíveis.

**Preciso de GPU?**
Não. Os modelos locais de reconhecimento são quantizados em int8 e rodam bem em CPU; o LLM dos destaques roda na nuvem (ou no seu Ollama local).

**No primeiro uso, o download do modelo de fala chega a 100%, recomeça do zero e fica baixando para sempre?**
Atualize para a [v0.9.1](https://github.com/xixihhhh/hotclip/releases) ou mais nova — o problema de descompactação no Windows foi corrigido, e os bytes já baixados são retomados automaticamente.

## Para quem desenvolve

```bash
git clone https://github.com/xixihhhh/hotclip.git
cd hotclip
pnpm install
pnpm dev        # roda o aplicativo de desktop em modo de desenvolvimento
pnpm test       # roda os testes unitários
```

**Pilha técnica**: Electron + React 19 + TypeScript + Tailwind 4 · ffmpeg (embutido) · reconhecimento local e separação de falantes com sherpa-onnx · legendas dinâmicas com libass + motor de legenda em balão com Chromium fora da tela · detecção de destaques por LLM (Atlas Cloud, Ollama ou qualquer endpoint compatível com OpenAI, com a sua própria chave)

<details>
<summary><b>De pé sobre os ombros de</b></summary>

| Projeto | Papel no HotClip |
|---|---|
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Runtime local de reconhecimento de fala (leve para CPU) |
| [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) / [FunASR](https://github.com/modelscope/FunASR) | Reconhecimento rápido em 5 idiomas / reconhecimento e pontuação do Paraformer |
| [FireRedASR](https://github.com/FireRedTeam/FireRedASR) | Nível de maior precisão: mandarim, sotaques e alternância de idioma |
| [pyannote-audio](https://github.com/pyannote/pyannote-audio) + [3D-Speaker](https://github.com/modelscope/3D-Speaker) | Separação de falantes (local, sem envio nenhum) |
| [FFmpeg](https://ffmpeg.org/) + [libass](https://github.com/libass/libass) | Corte preciso no quadro e queima das legendas |
| [onnxruntime](https://github.com/microsoft/onnxruntime) | Inferência dos modelos na própria máquina |

</details>

## Licença e limites de uso

- Código: **AGPL-3.0-only**
- O HotClip é para **o seu próprio conteúdo** ou para **cortes que você tem autorização de fazer** (por exemplo, programas oficiais de cortes de quem transmite). Reenviar filmes ou transmissões sem autorização não tem suporte e não é bem-vindo.

## Comunidade e projetos do mesmo autor

- 🐛 [Relatar um problema / ajuda na instalação](https://github.com/xixihhhh/hotclip/issues) · 💡 [Ideias de recursos e planejamento](https://github.com/xixihhhh/hotclip/discussions)
- 🔨 **[ClipForge](https://github.com/xixihhhh/clipforge)** — gerador de vídeo curto para e-commerce com IA, de código aberto: entra uma foto do produto, sai um vídeo pronto para publicar e vender. **O HotClip tira os destaques de dentro de vídeos longos; o ClipForge monta vídeos curtos a partir de uma única imagem** — os dois se completam.

[![Gráfico do histórico de estrelas](https://api.star-history.com/svg?repos=xixihhhh/hotclip&type=Date)](https://star-history.com/#xixihhhh/hotclip&Date)

<div align="center">

**⭐ Star + Watch para saber dos lançamentos primeiro.**

</div>
