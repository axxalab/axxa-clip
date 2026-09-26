# Planejamento de produto do HotClip (segundo semestre de 2026)

> Consolidado a partir das quatro frentes de pesquisa de 2026-07: cenário dos concorrentes comerciais e abertos, dores reais de quem usa, viabilidade das tecnologias de fronteira de 2025-2026 e desmontagem repositório por repositório dos principais projetos do gênero no GitHub. Todas as afirmações têm fonte nos relatórios citados no fim.

---

## 1. Posicionamento (uma frase, repetida igual em todo canto)

> **Seu vídeo não sai do seu computador — a bancada local de cortes com IA, aberta e gratuita: a IA acha o pico, você fecha em 10 segundos, e sai pronto para publicar em tudo com um clique.**
>
> Versão em inglês (sinal de consenso para os buscadores de IA, mesma redação em todos os canais):
> **HotClip — free, open-source, local-first Opus Clip alternative. Desktop app, no uploads, no credits, no watermark.**

Três pés:
1. **O avesso da confiança**: o episódio dos termos abusivos do CapCut em 2025.6 + o desenho hostil do SaaS («o crédito zera todo mês, cancelou, apagou o projeto») dão terreno emocional real para «local, não envia nada, grátis de verdade».
2. **Posição no cenário**: vídeo longo e gravação de live (de 2 a 8 horas) é justamente onde a cobrança por minuto de origem dói mais.
3. **Forma exclusiva**: o campo aberto é todo CLI, Gradio ou auto-hospedado, **não existe um segundo aplicativo de desktop que funcione na hora**; e ninguém mais tem ao mesmo tempo a cadeia completa de «enquadramento + legenda animada + corte seco + vício de linguagem + volume + recibo».

## 2. Cenário competitivo em resumo

| Campo | Fato-chave | O que significa para o HotClip |
|---|---|---|
| OpusClip | aporte do SoftBank, virando «plataforma de agente de crescimento com IA»; ClipAnything acha trecho com multimodal; já tem MCP e Claude Skill oficiais | bússola do setor: agente + multimodal é a linha principal; a distância de quem escolhe só por texto vai aumentar |
| Vizard / Klap | faixa grátis generosa para captar (60 min por mês), mas com marca-d'água e projeto expirando em 3 dias | «sem prazo, sem marca-d'água» precisa ser gritado sem parar |
| Munch | **desistiu do SaaS self-service e virou edição feita à mão** | a posição do meio sem diferencial morre; o HotClip se firma fora dos dois extremos pelo código aberto e pelo local |
| CapCut | o corte automático de longo para curto é grátis, mas é na nuvem, com crise de confiança nos termos e as funções centrais indo para a assinatura | o maior rival do lado chinês também é o melhor material de contraste |
| Ferramentas de corte rápido do mercado chinês | corte rápido (respiração e vício de linguagem) já é padrão; mixagem em rede é necessidade corporativa | função isolada não é fosso; o fosso é a combinação «local + transparente + grátis» |
| Código aberto (FunClip 5,9k / ShortGPT 7,7k / bilive 3,2k / autoclip 6k) | nenhum tem aplicativo de desktop; o bilive prova que o ciclo «gravar → cortar → publicar sozinho» é necessidade real | a forma de desktop é exclusiva; o ciclo de publicação é o maior vazio do lado aberto |

**O que já foi alcançado e não é mais argumento de venda** (no README, rebaixado para «linha de aprovação»): 9:16 seguindo o rosto, legenda animada, gancho de abertura, remoção de palavra de preenchimento.
**Fosso de verdade**: local + aberto + desktop, sem a angústia dos créditos, cadeia de produção completa, ponto de corte auditável (cadeia de provas + recibo no clips.json).

## 3. Prioridade das dores de quem usa (com a resposta do produto)

| Nível | Dor | Resposta |
|---|---|---|
| P0 | não dá para confiar na escolha da IA («de 20 cortes, só 2 ou 3 dá para publicar», e consertar a saída da IA demora mais do que editar à mão) | **mesa de revisão dos candidatos**: arrastar para ajustar a borda, esticar até a frase semântica, regerar com um clique — transformando «tudo automático» em «tudo automático + intervenção rápida» |
| P1 | hostilidade da cobrança (crédito descontado por minuto de origem, crédito que zera, cancelou e o projeto some) | resolvido; o marketing continua amplificando |
| P2 | pânico com privacidade e direitos (material de cliente ou sob NDA que ninguém ousa enviar) | resolvido; o site e o README usam o episódio dos termos do CapCut como contraste |
| P3 | publicação e agendamento em várias plataformas | publicação por automação de navegador (o Chromium embutido no Electron é vantagem natural) + APIs oficiais do TikTok e do YouTube |
| P4 | gravação de live 24 horas por dia sem ninguém olhando | pasta monitorada / integração com o ecossistema de gravadores + sinal de calor dos comentários ao vivo |
| P5-P8 | legenda traduzida, B-roll, modelo de marca, vazão em rede | ver o roteiro |

## 4. Roteiro do produto

### v0.5 — «escolher certo, rodar em lote com firmeza» (tapando buracos)
- **Mesa de revisão dos cortes candidatos** (dor P0, impacto altíssimo e custo baixo, a base do clips.json já existe)
- **Detecção de borda de plano TransNetV2/AutoShot (ONNX)**: o ponto de corte encaixa na borda do plano + o ritmo dos planos entra na nota do pico (3 a 4 dias de trabalho, ganho imediato)
- **Modelo de estilo / predefinição de marca**: estilo de legenda, gancho, logo e área segura configurados uma vez e reaproveitados em tudo (função atrás do paywall nos concorrentes)
- **Funil de dois níveis com um LLM pequeno na máquina**: Qwen3-4B (Ollama) na triagem → refino na nuvem, custo de LLM uma ordem de grandeza menor, reforçando a narrativa local

### v0.6 — «enxergar a imagem, falar outra língua» (alcançando a fronteira)
- **Sinal de pico visual**: Qwen3-VL 4B/8B na máquina com extração de quadros (Apache 2.0) + Gemini Flash opcional na nuvem para o julgamento fino (na casa de US$ 0,0155 por minuto de vídeo)
- **Sinal de pico de expressão facial** (reaproveitando o pipeline de rastreio de rosto que já existe; ⚠️ evitando os pesos não comerciais do InsightFace e o YOLO-face sob AGPL, usando YuNet/emotion-ferplus)
- **Legenda traduzida em vários idiomas** (começando pela queima do par principal, já que a localização bilíngue combina naturalmente)
- **Atualização do ASR em inglês**: Parakeet TDT 0.6B v3 em ONNX (mais rápido que o whisper-turbo em CPU, CC-BY-4.0); acompanhar o Qwen3-ASR + ForcedAligner para melhorar o alinhamento palavra a palavra

### v0.7 — «cortou, publicou» (o ciclo de publicação, o maior vazio do lado aberto)
- **Publicação em várias plataformas**: automação de navegador embutida no Electron (as principais redes de vídeo curto, com referência no social-auto-upload; deixando claro o risco de banimento) + TikTok Content Posting API / YouTube Data API
- **Predefinição por plataforma + geração de título e hashtag por plataforma** (o clips.json já tem o insumo)
- Exportar rascunho para o CapCut (mantido do plano original)

### v0.8 — «ser chamado por agente, engolir a live» (segunda curva)
- **Servidor MCP do HotClip (stdio local)**: «pega essa gravação de 4 horas e tira 10 picos» → o Claude dirige o pipeline local direto. O OpusClip já abriu o caminho, e o «cortador MCP local» é uma vaga vazia, com a maior alavanca de divulgação entre desenvolvedores
- **Modo de monitoramento de gravação**: pasta monitorada, e assim que a gravação cai no disco, tudo roda sozinho (integrando com o ecossistema de gravadores)
- **Sinal de pico pelo calor dos comentários ao vivo**: importar os comentários e fundir com a análise semântica na nota (ninguém faz isso bem no cenário de live em chinês, é a ponta de lança da diferenciação)

### Adiado
B-roll de imagem para vídeo (custo e controle ruins), sincronia labial (esperar o cenário de dublagem se firmar e então escolher o MuseTalk, que é MIT), corte em tempo real durante a live (o streaming do sherpa-onnx já se mostrou viável, mas é o trecho final da segunda curva).
Barato e dá para fazer de passagem: superresolução com Real-ESRGAN-ncnn-vulkan (executável portátil oficial, é só dar spawn, 2 a 3 dias), B-roll do Pexels (API grátis para uso comercial).

## 5. Planejamento de crescimento (SEO / buscadores de IA / canais)

### 5.1 Já executado (2026-07-08)
- ✅ a descrição do repositório virou um texto em inglês mirando os concorrentes (306 caracteres, com «Opus Clip alternative / local / no watermark»)
- ✅ a homepage aponta para `releases/latest`
- ✅ os tópicos foram ajustados para 20: entraram `ai`, `video-editing`, `subtitles`, `speech-recognition`, `local-first` e `desktop-app`, e saíram termos de plataforma de baixo tráfego

### 5.2 A executar à mão (depende de quem administra o repositório)
- **Apagar os 5 rascunhos de release que sobraram da CI** (criados automaticamente pelo electron-builder, com anexos repetidos da versão oficial):
  `for id in 349290690 349161774 349150406 349080462 348953914; do gh api -X DELETE repos/xixihhhh/hotclip/releases/$id; done`
- **Subir a imagem de pré-visualização social** (Settings → Social preview, 1280×640, menos de 1 MB): à esquerda a captura de um corte vertical, à direita «local e grátis · sem marca-d'água · vídeo longo → vertical viral». **Nenhum dos concorrentes desmontados (nem o MoneyPrinterTurbo, com 96 mil estrelas) fez isso**, então são 10 minutos para ficar sozinho nessa.

### 5.3 Lista de reforma do README

**P0 (nesta semana, afeta a conversão direto)**
1. **Demo de 30 a 60 segundos em mp4** antes da «prévia da interface» (é só arrastar o mp4 na caixa de edição do README e ele toca na página). É a maior alavanca isolada do README de uma ferramenta de vídeo: sem «um corte se mexendo» nas três primeiras telas, nenhuma promessa em texto é crível.
2. **Tabela com o resultado dos cortes**: uma `<table>` com 2 ou 3 `<video>` verticais lado a lado (frase de efeito de podcast, momento forte de live de venda, fala misturando idiomas), porque quem chega compra «como fica o corte», não a interface.
3. **Linha de selos** (hoje não tem nenhum): release + downloads + plataforma + licença + estrelas, logo abaixo do título; sem exagerar.
4. **Seção do que há de novo**: uma frase por versão nas últimas 3, com link para a release — a atividade de 7 versões em 4 dias não está sendo vista por ninguém.

**P1 (em duas semanas, descoberta e comunidade)**
5. **Separar os idiomas em arquivos**: README.md em pt-BR e README.en.md em inglês, com `Português | English` na segunda linha (como fazem o FunClip e o MPT; hoje o arquivo único misturado estica as três primeiras telas para seis, e a troca de idioma está escondida na linha 11).
6. Citar nominalmente no texto em inglês «alternative to OpusClip, Klap, Vizard» (o SamurAIGPT viveu dois anos de tráfego passivo só com os nomes dos concorrentes na descrição e no corpo).
7. **Abrir as Discussions + fixar issues**: ① ajuda de instalação direto ② votação do roteiro (mudar o «planejado» para lá e deixar as pessoas votarem; na fase de arranque, cada voto é alguém que fica); com modelos de issue de bug e de funcionalidade.
8. Porta de entrada da comunidade: QR code do grupo de mensagens (o público de cortes em chinês está no mensageiro, não no Discord) + e-mail; gráfico de Star History + um pedido de estrela logo depois do demo.

**P2 (em um mês)**
9. **Página de destino no GitHub Pages**: uma página só (vídeo de demo + fluxo em três passos + botão de download), com a homepage apontando para lá; acrescentar JSON-LD de SoftwareApplication + schema de FAQ; e, de passagem, o llms.txt (sem esperar efeito).
10. Duas páginas de comparação no site: `/alternatives/opus-clip` (em inglês) + «comparação de ferramentas de corte com IA» (em português) — os concorrentes todos fizeram página de alternativas, e a identidade aberta atropela na cauda longa dos qualificadores «free / open source / local».
11. **Espelho em serviço de nuvem local**: a conexão direta com o GitHub Releases falha bastante em alguns países, e essa é a maior perda invisível de uma ferramenta de desktop (aprendendo com o MPT).
12. Ligação cruzada com o ecossistema de origem: tabela de agradecimento a sherpa-onnx, SenseVoice, FireRedASR e pyannote; abrir PR de «who's using» nos repositórios de origem para trazer tráfego de volta.
13. Pacote de material de exemplo: um vídeo de 5 minutos sob licença CC + um guia de «seu primeiro corte em 3 minutos» (o ClipsAI morreu por exigir que a pessoa arrumasse material antes de ver o resultado).
14. Acrescentar no FAQ os itens «HotClip vs OpusClip?» e «precisa de internet?», e, nos de erro, colar **o texto completo do erro** (para bater direto na busca).

**Ciladas a evitar (o sangue dos concorrentes)**: não colocar patrocínio nem afiliado na primeira tela; não inchar o README até virar manual de operação (o autoclip tem 868 linhas e nenhuma imagem); usar selos dinâmicos do shields, nunca número fixo; e o ritmo dos commits é, em si, o sinal de marketing mais forte — melhor devagar do que interrompido.

### 5.4 Plano de ação para os buscadores de IA (ser recomendado pela IA = o novo primeiro lugar)

O mecanismo central é o **sinal de consenso**: só quando o mesmo posicionamento aparece repetido em várias fontes independentes é que a IA se arrisca a recomendar. O llms.txt não funcionou na prática (0,1% de acerto dos rastreadores de IA), então não investimos nele.

| Ação | Prazo | Observação |
|---|---|---|
| Submeter a opensourcealternative.to / alternativeto.net / openalternative.co | esta semana | as páginas de diretório são fonte muito citada quando a IA responde perguntas do tipo «alternativa a» |
| PR nas listas awesome | esta semana | `awesome-free-opusclip-alternatives` (já existe!), awesome-electron, awesome-ai-video e mais 3 |
| Presença em formato de resposta no Reddit | contínuo | r/NewTubers, r/podcasting, r/videoediting, r/selfhosted, r/opensource; regra 90/10 + declarar o interesse; o Perplexity cita um post novo do Reddit em até 24 h |
| 3 a 5 respostas + 1 artigo em fórum de perguntas e respostas | em 2 semanas | é o principal corpus dos buscadores de IA em chinês; colocar-se dentro de uma comparação objetiva |
| Medir o indicador dos buscadores de IA todo mês | contínuo | perguntar «best free opus clip alternative» e o equivalente em português ao ChatGPT, Perplexity e assistentes locais, e anotar a taxa de aparição |

### 5.5 Ritmo de lançamento por canal (arrancada para o Trending)

O Trending do GitHub olha a **aceleração das estrelas**, não o total → então o pulso de tráfego é espremido na mesma janela de 48 a 72 horas:

**Janela de arrancada (sugestão: no lançamento da v0.5)**: Show HN (terça a quinta, 8 às 10 da manhã no Pacífico, título «Show HN: HotClip – open-source local alternative to OpusClip», com um comentário do autor em tom de engenheiro em até 5 minutos) + Product Hunt + fóruns de desenvolvedores + vídeo de teste em plataforma de vídeo + redes sociais, tudo nas mesmas 48 h.
**Longo prazo em português**: vídeo de teste de 3 a 5 minutos «a versão de graça do OpusClip» → artigo em blog de produtividade → indicação em sites de software → tutorial «corte com IA sem precisar assinar nada» nas redes de conteúdo (público que corta como renda extra).
**Longo prazo em inglês**: artigo técnico longo no dev.to e no daily.dev (por exemplo «por que um LLM não deveria adivinhar marca de tempo — a arquitetura de alinhamento reverso palavra a palavra», material para uma segunda onda no HN); demo leve em um Hugging Face Space (cola a transcrição → sai o pico com nota) linkando de volta para o GitHub.

### 5.6 Palavras-chave alvo (com a página que as sustenta)

- Centrais em inglês: `opus clip alternative free`, `open source opus clip alternative` (página de alternativas e tópico), `ai clip generator free no watermark` (página inicial), `long video to shorts ai` (já ocupada pelo H1 do README), `local video transcription no upload` (**oceano azul**: nenhum concorrente ocupa o ângulo local/privacidade/sem upload)
- Centrais em português: «ferramenta de corte com IA grátis», «ferramenta para cortar live», «alternativa grátis ao OpusClip», «vídeo longo para vídeo curto com IA», «edição com IA local sem upload», «ferramenta grátis de corte para vender»

## 6. Ritmo e indicadores

| Prazo | Marco | Indicador |
|---|---|---|
| esta semana | os quatro itens P0 do README + imagem social + submissão aos diretórios e às listas awesome + apagar os rascunhos de release | metadados todos no lugar |
| 2 semanas | README separado por idioma + Discussions e modelos + primeiro conteúdo nos canais | 5 ou mais links externos iniciais |
| 1 mês | v0.5 (mesa de revisão + detecção de plano + modelos) + site no GitHub Pages | 500 estrelas (janela de arrancada no Trending) |
| 3 meses | v0.6 (pico visual + legenda traduzida) + páginas de comparação indexadas | 2 mil estrelas; aparecer em pelo menos 2 dos 4 buscadores de IA medidos |
| 6 meses | v0.7, o ciclo de publicação, + v0.8, MCP e live | 5 mil estrelas (mesma ordem do FunClip e do autoclip); ocupar a mente como «o cortador MCP local» |

---

## 7. Retrospectiva de 2026-08: alinhar com o fluxo real de quem corta (esta seção é a conclusão mais recente; onde houver conflito com o que vem antes, vale esta)

### 7.1 Atualização da pesquisa (2026-08-05)

**Lado internacional (10 lançamentos do OpusClip em um mês, 2026-07)**: limpeza de tomadas ruins (já alcançado), colocação automática de efeito sonoro, B-roll gerado por IA, clonagem de voz em 25 idiomas, predefinição de acabamento viral (locução → corte embalado com fundo animado e efeitos), modelo de marca com selo de título automático, versão para Android e agentificação via MCP/Skill. A direção é clara: **a «embalagem do corte final», depois da escolha, e a agentificação**. A Submagic vai no mesmo sentido: legenda com emoji e palavra-chave, sete movimentos de zoom, efeitos sonoros e remoção de silêncio com um clique. E a reputação do OpusClip em 2026 continua sendo «**de 20 cortes, só 2 ou 3 dá para publicar**» + processamento pendurado + hostilidade aos créditos (22% de uma estrela no Trustpilot) — ou seja, as duas cartas em que apostamos, escolha confiável e local, seguem sendo validadas.

**Lado nacional (a jornada completa de quem corta de verdade)**: conseguir a licença (divisão meio a meio, ficando com uns 30% depois da comissão da agência; a comissão mínima nos programas de afiliados caiu para 5% a partir de 2026-04) → pegar a gravação ou gravar a tela → cortar → **várias versões** → **distribuir em várias contas e plataformas** (30 contas × 5 plataformas à mão dá de 2 a 3 horas por dia, e a ferramenta de «disparo para mais de 40 plataformas» virou um setor de necessidade real; o consenso do mercado saiu de «conteúdo é rei» para «**eficiência é rei**») → monetizar com o link de venda. E, do lado das plataformas, a partir de 2026-07 **a revisão de licença para corte e recriação apertou**: exige guardar a gravação original (pelo menos 3 minutos antes e depois do trecho), os cinco elementos do contrato de licença (quem licencia, qual conta é licenciada, se pode editar, permissão de impulsionamento e alcance de plataformas) e um livro-caixa de distribuição item a item; o julgamento de originalidade olha «**mudança de entropia de informação / autoria da expressão**» — extração de quadros, espelhamento e mudança de velocidade já são classificados claramente como reaproveitamento.

### 7.2 Diagnóstico: o começo não saiu torto, mas o fim foi desenhado cedo demais

O posicionamento (local + escolha auditável) continua certo; mas o projeto gastou toda a força em «cortar bem», enquanto o grosso do tempo de quem usa em 2026 está **depois do corte**: várias versões, distribuição em várias contas, prova de conformidade. O que a pessoa quer comprar é «da gravação até publicado», e nós entregamos até «tem um mp4 na pasta» — a metade final está inteira faltando.

### 7.3 Roteiro revisado (substitui a prioridade da parte ainda não iniciada da seção 4)

No fundo são só duas coisas: **o resultado do material** (o corte ser apresentável) e **o fluxo** (cortou, dá para publicar).

- **P0, ciclo de preparo da publicação** (fluxo — montar o que já existe até o último quilômetro): ① **pacote de publicação por plataforma** — uma pasta por plataforma, adaptada automaticamente às especificações (capa 3:4 em 1080×1440, tamanho do título, teto de hashtags), com vídeo, capa e texto no lugar; ② **várias versões de um corte** — gerar variantes diferentes do mesmo corte (gancho de abertura, título, quadro de capa e ângulo do texto diferentes), pelo caminho do «valor acrescentado» e não da fuga de duplicata por pixel, o que já serve naturalmente para várias contas
- **P1, alcançar na embalagem do corte** (resultado do material): colocação automática de efeito sonoro (piada, virada), trilha abaixando sozinha na voz, B-roll grátis do Pexels, título grande na capa
- **P2, exportar rascunho para o CapCut** (pegando carona no acabamento e no ecossistema de publicação dele) → depois avaliar a automação de publicação direta pelo navegador (risco de banimento, declarado)
- **Claramente fora**: falsa originalidade no nível do pixel (extrair quadro, espelhar, mexer em parâmetro para enganar a detecção) — a plataforma já classifica como infração e isso não ajuda ninguém a longo prazo; livro-caixa de licença e pacote de prova — não tem relação com a linha principal de «resultado do material + fluxo», fica adiado

---

## 8. Segunda rodada da pesquisa dedicada a resultado, 2026-08: roteiro revisado (onde houver conflito com a seção 7, vale esta)

> A pesquisa completa está em [RESEARCH-2026-08-CLIP-QUALITY.md](./RESEARCH-2026-08-CLIP-QUALITY.md) (quatro frentes em paralelo: concorrentes internacionais / ecossistema em chinês / levantamento de IA paga / ofício da edição e fronteira).

### 8.1 Correção do diagnóstico

O posicionamento (local + grátis + auditável + mesa de revisão) está certo e é validado pelo avesso pela reputação dos concorrentes; **o desvio está na distribuição de esforço**: oito trilhas de sinal empilhadas, mas pouco investimento na «camada de embalagem do corte» (desenho de som, ritmo, estética padrão da legenda) e na «metade final do fluxo» (acabamento → distribuição → conformidade) — a primeira é a principal fonte da «sensação de pronto para publicar» em 2026, e a segunda são as duas últimas etapas do fluxo de três passos que já se firmou entre quem corta em chinês (corte inicial com IA → acabamento no CapCut → distribuição em rede).

Calibragem de expectativa: o teto do setor para viralização totalmente automática é de uns 20%; uma pessoa falando sozinha acerta de 85% a 92%, conversa entre várias pessoas de 52% a 74%. A meta não é «100% automático e publicável», é **taxa de publicáveis bem acima da dos concorrentes + custo de revisão abaixo de 2 minutos por corte**.

Princípios de estrela-guia: ① «poucos e inteiros» — a taxa de publicáveis vem antes da quantidade; ② a faixa local e grátis roda a cadeia inteira, e a faixa paga na nuvem melhora o resultado (uma chave do Atlas cobre tudo, e a interface mostra o custo por corte); ③ a nota de viralização só ordena, nunca promete em termos absolutos; ④ estética e parâmetros em milissegundo entram como configuração + A/B, nunca fixos no código.

### 8.2 Ritmo das versões

**v0.11 «o corte respira» — desenho de som + ritmo + estética da legenda (P0 de resultado, tudo local e sem custo) ✅ entregue em 2026-08-05** (sound-design.ts com síntese e colocação de efeito e abaixamento da trilha / guarda de proibição de remoção em emoção no gaps / faixas de pausa por categoria no genre / «minimalismo animado» no subtitle / sinal de ritmo no qa / ponto de ênfase do autozoom ligado ao evento de pico; a trilha é mixada a partir de um arquivo da própria pessoa, sem biblioteca embutida, para evitar problema de licença)
1. Motor de colocação de efeito: pacote CC0 selecionado embutido, colocado por regra (whoosh no quadro do corte seco, pop no quadro em que a legenda sobe, riser de 1 a 2 s antes da entrega, ding na piada), no máximo 3 por corte, com chave para desligar — a apuração confirmou que «em que quadro colocar» não tem solução acadêmica nem API madura, então fazer bem a regra já é vantagem competitiva
2. Trilha: biblioteca CC0 embutida de loops sem emenda + ducking por sidechain (15 a 20 dB abaixo da voz), com a faixa MiniMax Music opcional na nuvem
3. Limiar de silêncio e de pausa por categoria (0,3 a 1,2 s) + proibição de remover 1 s antes e depois de um evento de emoção ou de risada (ligado aos sinais de emoção na voz e de pico de áudio que já existem)
4. Estética padrão da legenda atualizada para o «minimalismo animado»: bloco de 2 a 4 palavras no tempo, palavra-chave na cor da marca (no máximo 1 por frase), área segura dos 60% centrais + desvio das áreas cobertas pela plataforma
5. Novo sinal de ritmo no controle de qualidade: aviso quando o intervalo entre eventos visuais passa de 5 s → sugerir um zoom automático para reforçar

**v0.12 «escolhe certo, abre explodindo» — evolução da seleção (P0 de resultado, primeira entrada da faixa opcional na nuvem)**
> Progresso em 2026-08-05: ✅ flash do pico (flash-forward, inclusive a ordem de prioridade com o gancho na frente) / ✅ conferência de gancho honrado no controle de qualidade / ✅ **ponto de corte preciso** (item novo que veio da desmontagem do FunClip: segunda passada de alinhamento do trecho candidato com o Paraformer para corrigir a marca de tempo por palavra, teste de fumaça com modelo real aprovado) / ✅ **revisão do trecho candidato por VLM** (highlight/review-vision.ts: uma folha de contato e uma chamada por candidato, a nota da imagem volta para a ordenação, o ponto de interesse entra no motivo e a divergência vira aviso; reaproveita o mesmo endpoint compatível com OpenAI do sinal visual, é grátis com o Ollama local, e basta preencher o campo de chave de API nas configurações de visão para usar a faixa do Atlas na nuvem — a «faixa paga na nuvem» que estava planejada saiu sem nenhuma infraestrutura nova) / ✅ de passagem, corrigidas quatro chaves mortas no aplicativo (denoise, coldOpen, compilation e alsoLandscape, que nunca tinham sido ligadas ao handler de exportação). Falta: escolha independente do começo e do fim (HIVE) e a faixa de transcrição de precisão do Seed-ASR na nuvem; o fim em loop fica adiado (é difícil garantir que o áudio feche em loop, e o ganho é duvidoso).
> Complemento em 2026-08-05: ✅ **modernização da legenda** (o usuário comentou que «karaokê é um argumento brega» e pediu a pesquisa sobre o Remotion; as três frentes estão na seção 5.6 da pesquisa): o estilo padrão sai de karaoke para keyword (o padrão do chinês é frase curta + palavra-chave trocando de cor); o pop virou «entrada amortecida + acendimento da palavra atual na cor da marca dentro do bloco» (a forma predominante da legenda palavra a palavra em 2026, verificada quadro a quadro no libass); o karaokê antigo desceu para penúltima opção; todo o texto público passou a dizer «legenda animada»; **o Remotion não entra** (a partir de 4 pessoas é cobrado pelo volume de render do usuário final + telemetria obrigatória, e a renderização por captura de tela é uma ordem de grandeza mais lenta que o libass) — o nosso motor de Chromium fora da tela já é o Remotion local, e daqui em diante só copiamos modelos.
1. Revisão do trecho candidato por VLM: quadros de 30 a 90 s do candidato alimentam o MiMo V2.5 ou o Qwen3-VL-Plus (alguns centavos por corte), com julgamento de categoria e descrição de imagem voltando para a seleção — fechando o buraco das categorias de fala fraca (dança, bichos, ar livre, jogo)
2. Variante de abertura fria com flash-forward: 0,3 a 1 s do momento mais explosivo → volta (extensão do coldopen; só 0,04% dos cortes na internet têm gancho visual, é uma chance de diferenciação)
3. Escolha independente do começo e do fim (padrão HIVE): abertura e fecho entram como sinais próprios no prompt e no pipeline
4. Conferência de gancho honrado no controle de qualidade: a coisa ou o número que o gancho promete tem de aparecer na transcrição
5. Faixa de transcrição de precisão na nuvem (Seed-ASR 2.0, US$ 0,002 por requisição; o alinhamento por palavra fica com o local)
6. Fim em loop opcional para cortes de menos de 30 s

**v0.13 «cortou, publicou; publicou, em conformidade» — a metade final do fluxo**
1. Terminar o pacote de publicação + várias versões de um corte (o espaço de trabalho está em andamento; acrescentar a dimensão de variante «versão com flash-forward vs versão direta»)
2. Ligar ao cover a faixa de capa Seedream 5.0 na nuvem (US$ 0,032 por imagem, sai pronta com letra grande)
3. Alinhar o texto ao algoritmo de 2026: a chamada para ação vira «salva / vê a coletânea», título e legenda enterram palavras-chave de busca, e o limite de 90 s de uma das plataformas entra no platform-specs
4. Organização em coletânea e série: os cortes da mesma transmissão se agrupam por tema automaticamente (aproveitando o bônus do peso de busca dobrado)
5. Pacote leve de conformidade (corrigindo o «não fazer» da seção 7: guardar prova sai de graça e nenhuma ferramenta cobre): lembrete de rotular conteúdo de IA (ao usar narração ou capa de IA), o clips.json registrando o intervalo de origem com exportação opcional de ±3 min e um CSV de livro-caixa de distribuição
6. Exportar rascunho para o CapCut (sai da observação e entra como direção, em um ramo por versão) — o fluxo de dois passos «corte inicial com IA → acabamento no CapCut» faz o valor disso só subir
7. Avaliar: vaga de comentário falado (a pessoa grava 5 s de comentário em vídeo e o sistema emenda sozinho, alinhando direto com o critério de «autoria da expressão»)

### 8.3 Claramente fora (validado pelo avesso por reputação e por linha vermelha)
B-roll de IA (a função de investimento pesado com pior reputação do setor), exibir nota absoluta de viralização (só ordenação e faixas), mixagem para fugir de duplicata, fundo verde fingindo presença, remoção do selo de IA (linha vermelha de banimento), Sora 2 (a API vai sair do ar) e jogar a live inteira no VLM.

### 8.4 Concorrentes a acompanhar
WhaleClip (longo para curto em chinês + CLI/MCP batendo nos mesmos argumentos, 128 por mês); Captions/Mirage (o único que transformou ritmo, movimento de câmera e atenção em modelo dedicado, serve de bússola); Reap (US$ 9,99 com servidor MCP incluído e métricas de resultado públicas).

---

## 9. Terceira rodada de 2026-08-09: calibragem do fluxo do usuário e revisão da técnica de seleção (onde houver conflito com a seção 8, vale esta)

> O texto completo está em [RESEARCH-2026-08-ROUND3.md](./RESEARCH-2026-08-ROUND3.md) (quatro frentes em paralelo: jornada do usuário / novidades dos concorrentes internacionais / IA paga de vídeo / ofício da viralização e algoritmo das plataformas).

### 9.1 Diagnóstico (em três frases)

1. **O posicionamento não está torto e a tendência o reforça**: o setor se apertou nas duas pontas (o Smart Split grátis do TikTok leva o usuário leve, e as plataformas de agente tipo Mosaic ficam com o corporativo), e os três pontos do HotClip — grátis e sem medição, local e a live em chinês — escapam exatamente disso; os dados duros da «fadiga de lixo de IA» confirmam o vento a favor da narrativa de «mesa de revisão + controle humano».
2. **Calibragem do perfil**: o cortador avulso de vídeo de venda está sumindo (licenciamento apertando, desintermediação, renda mensal abaixo de mil), e a zona doce de verdade é **quem tem o material** (equipe do apresentador, comerciante que transmite, criador de locução, autor de cortes de jogo) — só eles têm razão econômica para pagar por qualidade. A narrativa pública passa a ser «**ajudar quem apresenta e quem faz locução a cortar a si mesmo**».
3. **Revisão da técnica de seleção**: «entregar a transmissão inteira ao modelo de vídeo» saiu de inviável para **R$ 0,7 a 12 por transmissão** com os preços de 2026-08 (qwen3-vl-flash de R$ 0,3 a 0,7, doubao-seed-1.6 a R$ 1,6, Gemini 3.5 Flash a US$ 1,6, em partes de 10 min, baixa resolução, 0,5 a 1 fps, preservando a trilha de áudio), então a conclusão de «inviável» da segunda rodada está revogada. O nível de prova sustenta «colocar no ar e fazer A/B», não «derrubar e recomeçar»: entra como **nona trilha de sinal** na camada de fusão, e na faixa paga absorve a revisão em folha de nove quadros do VLM; as oito trilhas + o LLM de texto continuam sendo a base da faixa grátis.

### 9.2 Ritmo das versões (substitui a parte não iniciada da v0.13 em 8.2)

**v0.13 «viu tudo, tem coragem de descartar» — salto na seleção + portão de qualidade (linha principal de resultado, primeira vez em que a faixa paga é protagonista)**
1. Nona trilha de sinal pela seleção sobre o vídeo inteiro: ffmpeg corta em partes de 10 min → baixa resolução, 0,5 a 1 fps, preservando a trilha de áudio → alimenta em paralelo um modelo nativo de vídeo → a camada de texto funde com os comentários ao vivo e a transcrição e ordena. Faixas: nacional com qwen3-vl-flash ou doubao-seed-1.6, internacional com Gemini 3.5 Flash, e GLM-4.6V-Flash (grátis) para experimentar sem custo; a interface mostra o custo por transmissão; **o A/B é obrigatório** (regra de ferro)
2. Portão de qualidade em três faixas: camada de regras (integridade da borda da frase — a abertura não fica solta em conectivo, o fim fecha a frase; sobreposição de locutores acima do limiar perde peso) → segunda leitura de compreensibilidade sem contexto por LLM («dá para entender sem ter visto a live? o final parece um final?») → **recomendar publicar / precisa de olho humano / descartar**, exportando por padrão só as duas primeiras; alinhado à realidade de 2026 de que «de 30 a 45% do que a IA entrega é refugo, e publicar refugo custa no nível da conta»
3. Seleção por prompt e exclusão de temas: injetar na seleção, em linguagem natural, «o que eu quero / o que eu não quero» (alinhado ao Contextual Prompting do OpusClip, que é lacuna real — as tomadas ruins nós já temos no retakes.ts, e o erro do relatório sobre concorrentes já foi conferido)
4. Comando falado de quem apresenta: detectar na gravação frases do tipo «corta esse trecho aqui» como sinal forte de seleção (clipping ativado por voz, tendência nova de 2026)
5. Modelo narrativo de três etapas da venda: um modelo de junção de pieces no formato dor → demonstração → preço, trocando a narrativa padrão conforme a categoria

**v0.14 «consegue publicar e sobreviver» — sobrevivência na distribuição + conformidade (absorve a metade final do fluxo da antiga v0.13)**
1. Nota de transformação: somar a capacidade de transformação que já temos (recomposição vertical, legenda, zoom automático, flash-forward, efeitos) em uma nota, com cartão amarelo abaixo do limiar avisando «risco de ser classificado como reaproveitamento» (limiar de 70% da impressão digital visual do Reels, três strikes do «inautêntico» do YouTube); e perturbação controlada do modelo dentro da conta (posição da legenda, paleta e efeitos diferentes entre os cortes da mesma conta, contra a impressão digital da produção em massa)
2. Chave de rotulagem de IA: gerar o texto de conformidade conforme a plataforma (a norma de 2026-07 bane a conta na terceira infração, é necessidade real)
3. Orientação a salvar e a buscar: sinal de densidade prática (passo a passo, lista, número, frase de efeito somam pontos), título no formato de termo de busca, chamada para ação de salvar e ver a coletânea (mantido do plano, com o peso atualizado para a taxa de salvos acima de 40% + alcance lento de 7 dias)
4. Várias versões de um texto + pacote de publicação concluído (mantido; acrescentar a dimensão «versão com flash-forward vs versão direta»)
5. Pacote leve de conformidade: prova de ±3 min + CSV de livro-caixa de distribuição (mantido)
6. Aviso de limite de produção por transmissão (3 a 5 cortes por padrão, contra a autocanibalização) + lembrete de revisar os dados em 7 dias (reforçar o convite a salvar entre o 4º e o 7º dia)
7. Faixa de embalagem na nuvem: capa em duas faixas (Seedream a US$ 0,032 para volume + Nano Banana Pro a US$ 0,134 para letra grande), trilha segura em direitos (ElevenLabs Music, de R$ 1 a 2 por corte, elimina o risco de o vídeo sair do ar)
8. Legenda com rótulo de quem fala (compreensão de conversa assistida sem som) + opção de «preservar a respiração» na remoção de silêncio (contendo o cheiro de IA)
9. Exportar rascunho para o CapCut (mantido em observação, escrito como direção, em ramo por versão)

**v0.15 «linha de produção sem supervisão, chamada por agente» — segunda curva**
1. Pasta monitorada: a gravação cai no disco e entra sozinha na fila de cortes (a versão local do pipeline com S3 do Descript, casa de uma ferramenta local)
2. Integração por webhook com os gravadores de live (item P0 que ficou pendente; as bibliotecas LGPL de ferramentas de gravação dão para depender) — a cadeia completa «monitorar a live → gravar sozinho → sair o candidato sozinho»
3. Servidor MCP local: a porta de entrada de edição por agente que seja «grátis + local + privado» é a vaga vazia do mercado hoje (o MCP já virou padrão do setor)
4. Resultado realimentando a versão local: a pessoa marca «publiquei / viralizou» e isso volta para calibrar o peso dos sinais (a ideia de resultado da Reap, feita localmente)
5. Vaga de piada (em avaliação): marcar o «ponto onde dá para brincar» no pico de emoção, no contraste e no pico dos comentários + uma biblioteca de piadas cuidada pela pessoa; o que brincar fica com ela
6. Faixa opcional de ASR na nuvem com Seed-ASR 2.0 (R$ 0,8 por hora, comprando separação de locutores e robustez a sotaque, opção de melhoria para transmissões com convidados)

### 9.3 Claramente fora (acréscimo da terceira rodada)

Vale a 8.3, e acrescentamos: construir nosso próprio disparo em massa e administração de rede de contas (mercado saturado + zona cinza + banimento em conjunto), falsa originalidade no nível do pixel (fazemos variação na camada da expressão, não fuga da detecção), entrar na disputa de correção de cor de cinema, intermediação de licenças, TwelveLabs (de 6 a 10 vezes mais caro e sem pagamento nacional), GPT-5.x para escolher trechos (sem API nativa), faixa de áudio do Qwen-Omni (10 vezes o custo do ASR) e SaaS de movimento de câmera de terceiros (a visão computacional local já basta).

---

## 10. Reforma da interface em 2026-08-19: do assistente de três passos à bancada de projeto (o desenho está fechado)

O usuário concluiu que a interface de então «não serve para uma ferramenta profissional» (o assistente em estilo de página de destino nasceu sem desenho nenhum). As três pranchas do desenho já confirmaram a direção (bancada / opções de exportação / central de configurações), com a base visual sendo o cartaz principal do README: palco preto puro + brilho laranja de chama, e o **brilho só nos elementos-chave** (trecho candidato na linha do tempo, cartão do corte vertical, botão principal, curva de sinal, linha selecionada), com os slogans de marketing saindo da área de trabalho.

### 10.1 Diagnóstico da situação (seis problemas estruturais)

① coluna única de 672px centralizada + cartão de marketing = gene de página de destino; ② o fluxo principal não mostra a imagem do vídeo nem a linha do tempo; ③ assistente linear contra trabalho não linear (voltar perde os candidatos, o motor trava depois da transcrição, a entrada do monitoramento de gravação some depois de escolher o arquivo); ④ a HighlightsView tem 1485 linhas com quatro responsabilidades misturadas + 33 chaves de exportação ocupando um terço da tela (e entre as chaves se misturam três semânticas: faixa de loop, seletor de arquivo e abertura de caixa de diálogo); ⑤ mexer em 6 controles refaz a detecção em silêncio; ⑥ não há sistema de design (9 tokens de cor, corpos de letra de 10 a 17px espalhados sem escala, três visuais de chave convivendo).

### 10.2 Caminho de migração (gradual, com release a cada passo, sem derrubar tudo) — **M1 a M4 entregues de uma vez em 2026-08-19** (o usuário pediu «começa tudo junto»; as capturas do README já foram trocadas)

**M1, esqueleto e base de estado**
1. `stores/session-store.ts`: arquivo, transcrição, candidatos, parâmetros de detecção e estado de exportação saem do App.tsx — os candidatos vão para o store e voltar não perde mais nada
2. Layout de três colunas no AppShell (chips de estado do pipeline na barra superior no lugar da barra de três passos + coluna esquerda fixa com projeto, material e monitoramento de gravação + encaixes no centro e na coluna direita); o estado de vista vira `import | workbench | settings` no lugar de passo e fase
3. Tokens de design em dia: escala de letra 11/12/13/15/18, cores semânticas dentro do @theme, e o trio unificado Switch/Chip/Segmented (acabando com as três linguagens de chave)

**M2, linha do tempo e pré-visualização (o componente novo central, o maior volume de trabalho)**
4. `Timeline.tsx`: régua + tira de filme com miniaturas (quadros pelo ffmpeg, reaproveitando o pipeline da folha de contato) + forma de onda (reaproveitando o caminho em canvas da mesa de revisão) + curva de calor dos comentários e do volume (a coleta de sinais já tem os dados, e o IPC precisa passar a «curva janela a janela» além do «intervalo de pico») + trecho candidato brilhando + cabeça de reprodução
5. Pré-visualização da imagem de origem com `<video>` (tocando direto por file://, e clicar no candidato dá seek) + cartão de pré-visualização do corte vertical; o cartão gordo do candidato vira linha de tabela densa, com o detalhe indo para o Inspector na coluna direita; a caixa de diálogo da mesa de revisão fica (o arraste palavra a palavra se funde à linha do tempo depois)

**M3, opções de exportação e redetecção explícita**
6. Predefinições de exportação: o render-prefs ganha conjuntos nomeados {id, name, prefs}, com os embutidos «padrão», «kit completo de vendas» e «mínimo e rápido»; as 33 chaves se recolhem em seis gavetas (imagem, edição, áudio, legenda, material de publicação, distribuição em várias versões) e a faixa de loop vira Segmented
7. Os parâmetros de detecção (categoria, tema, palavra de produto, faixa de duração, conversa, referência) vão para a área «parâmetros de detecção» na coluna direita + um botão explícito de «detectar de novo» — acabando com a repetição silenciosa
8. Central de configurações: o SettingsModal + LLM, pré-filtragem e portão de visão + motor de ASR + marca + glossário + monitoramento de gravação viram uma página de configurações com navegação à esquerda (os componentes de conteúdo são movidos mecanicamente)

**M4, acabamento de consistência**
9. Modais unificados com portal + Esc + armadilha de foco; o `window.location.reload()` da ExportView vira uma fila de exportação com estado; o espaço de nomes highlights da i18n (225 chaves) é dividido conforme as vistas novas; a área de trabalho tira o brilho de palco e o hero (o estado vazio da importação pode ficar)

### 10.3 Riscos e regras de ferro

- o provedor simulado (api/provider.ts) mantém a pré-visualização no navegador funcionando em cada etapa; o caminho automático e a CLI e o MCP não são afetados (é só a camada de renderização)
- a lição de layout da issue #3 continua valendo: nowrap no OptChip, fundo sólido na barra de ações, rise-in com backwards
- Artifact do desenho: claude.ai/code/artifact/bb63f48b-5261-45d8-b612-17b0f4c31e22

---

*Fontes da pesquisa: quatro relatórios completos (concorrentes e necessidades do usuário / tecnologia de fronteira / crescimento por SEO e buscadores de IA / desmontagem dos repositórios concorrentes no GitHub) produzidos em 2026-07-08, com as fontes principais citadas ao longo do texto; em 2026-08-05 foram acrescentadas a seção 7 (changelog do OpusClip, jornada nacional dos cortes e busca pelas novas regras das plataformas) e a seção 8 (segunda rodada dedicada a resultado, texto completo em RESEARCH-2026-08-CLIP-QUALITY.md); em 2026-08-09 foi acrescentada a seção 9 (terceira rodada: calibragem do fluxo do usuário + revisão da técnica de seleção, texto completo em RESEARCH-2026-08-ROUND3.md); em 2026-08-19 foi acrescentada a seção 10 (roteiro da reforma da interface).*
