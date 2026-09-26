# Pesquisa da terceira rodada, 2026-08: calibragem do fluxo do usuário + revisão da escolha de trechos a partir do vídeo inteiro

> Concluída em 2026-08-09. Motivo: o usuário concluiu que «o ponto de partida do projeto já saiu torto desde o começo» e pediu uma calibragem completa do projeto pelas características mais recentes dos métodos de corte de 2026 e pelo fluxo real de quem usa, deixando claro que «dá para contratar IA paga de terceiros, desde que o resultado seja bom e a experiência amigável».
> Quatro frentes em paralelo (① a jornada completa de quem corta em chinês ② o que os concorrentes internacionais lançaram depois de 2026-06 ③ levantamento das IAs pagas de compreensão de vídeo ④ o ofício da viralização e o algoritmo das plataformas), somando cerca de 110 buscas e capturas, com documentação oficial e avaliação de terceiros se cruzando. Onde houver conflito com a segunda rodada ([RESEARCH-2026-08-CLIP-QUALITY.md](./RESEARCH-2026-08-CLIP-QUALITY.md)), **vale este texto**.
> A marcação de confiança é a mesma: [várias fontes] = duas ou mais fontes independentes se cruzam; [fonte única] = aceitar com cuidado; o que vem do fabricante é anotado à parte.

---

## 1. Diagnóstico geral: o ponto de partida está torto? — a resposta em três frases

1. **O posicionamento não está torto, e a tendência do segundo semestre de 2026 o reforça pelo avesso.** O setor se moldou apertado nas duas pontas: em cima, o Smart Split do TikTok (grátis + nativo da plataforma + apoiado no Vidi2 aberto pela ByteDance) leva embora o usuário leve; embaixo, plataformas de orquestração de agentes como a Mosaic tomam o mercado corporativo (TubeScience e News Corp já compraram); quem fica espremido no meio é o SaaS de cortes por assinatura (a Submagic foi obrigada a se reinventar, e a Captions/Mirage simplesmente saiu para fazer modelo generativo). Os três pés do HotClip — grátis e sem medição (bate de frente com a hostilidade à cobrança do OpusClip, principal motivo dos 22% de uma estrela no Trustpilot), local (bate de frente com a queixa número um da nuvem, «processamento pendurado por horas») e o cenário de live em chinês (que o Smart Split não cobre) — escapam todos da pressão. E a «fadiga de lixo de IA» ganhou dados duros (59% do feed de uma conta nova no TikTok é lixo de IA; 90% dos ouvintes querem conteúdo feito por gente), então a narrativa de «mesa de revisão + controle humano» está com o vento a favor. [várias fontes]
2. **Mas metade do perfil do público-alvo está errada.** O «cortador avulso de vídeo de venda» está desaparecendo: o aperto no licenciamento, a repressão ao conteúdo de IA e a desintermediação de quem apresenta espremem dos três lados, a renda mensal do avulso é majoritariamente abaixo de mil (entre os 11 mil licenciados de um grande apresentador, a média anual é de só 17 mil), e o dinheiro está se concentrando nos «estúdios que têm o material». A zona doce de verdade é **quem tem o material**: a equipe do próprio apresentador, o comerciante que transmite sozinho, o criador de locução de conteúdo e quem faz cortes de jogo — o licenciamento deles já nasce limpo, e só eles têm razão econômica para pagar por «qualidade do corte» (a disposição do avulso a pagar por qualidade é ≈ 0; o que ele quer é variação em massa que passe na moderação). A narrativa pública deve sair de «ajudar quem corta» para «**ajudar quem apresenta e quem faz locução a cortar a si mesmo**». [várias fontes]
3. **A escolha técnica na seleção de trechos precisa ser revista.** A segunda rodada julgou que «jogar a live inteira no VLM é inviável» — com os preços de 2026-08 isso está **formalmente revogado**: o preço de tokenizar vídeo despencou (baixa resolução a 1 fps ≈ 100 tok/s) e o contexto chegou a 1M, então «entregar 3 horas de live inteiras ao modelo de vídeo» já custa **de R$ 0,7 a 12 por transmissão** (menos de 1 nas faixas Flash nacionais). É a única oportunidade desta rodada no nível de «pagar e ganhar salto de qualidade», e é a resposta certa para os três pontos cegos do pipeline de escolha só por texto (piada visual, pico de ação e o motivo na imagem por trás da risada). [várias fontes; a conta está na seção 3]

---

## 2. Perfil de quem usa e calibragem do fluxo (primeira frente)

### 2.1 Como está a jornada completa em 2026

- **Licenciamento**: o normal é ser grátis, e cobrar já é golpe (depois de um curso de 2.980 ser publicamente questionado, a empresa esclareceu que «o licenciamento em si é grátis»); a divisão «meio a meio» é o teto do discurso, e a pessoa física, via intermediário, fica com cerca de 30%; as plataformas de licenciamento têm metas duras (publicar em até 3 dias depois de licenciar, pelo menos 10 cortes por semana, e exclusão se o faturamento em 30 dias ficar abaixo de 500). [várias fontes]
- **Obtenção do material**: download da gravação oficial + gravação automática de código aberto; o padrão de fato é o DouyinLiveRecorder (grava assim que a live começa em mais de 40 plataformas, inclusive os comentários ao vivo). **O primeiro passo da jornada está fora da nossa ferramenta.** [várias fontes]
- **Edição**: de 47 minutos a 1 hora por corte, feito à mão; o preço de mercado do freelance é de 30 a 50 por corte; o CapCut é a base absoluta (a legenda por IA e o fatiamento têm a melhor reputação, e a reclamação é a cobrança chegando aos poucos nas funções); o ponto fraco do OpusClip em chinês é que a legenda precisa de revisão humana. [várias fontes]
- **Distribuição**: o gargalo saiu de «publicar rápido» para «**publicar sem parecer o mesmo vídeo**» — postar o mesmo material em várias contas é classificado como repetição de baixa qualidade (caso real: 5 contas postando junto, de mais de 100 mil visualizações para menos de 200 em uma semana; 20 contas de uma rede banidas em conjunto). [várias fontes; o suporte costuma ser conteúdo de marketing sobre controle de risco, mas a direção bate com as regras das plataformas]
- **Monetização**: o setor não morreu, mas «virou estúdio»; o incentivo de uma das plataformas caiu para algo como 3 a 8 por 10 mil visualizações, e ela diz explicitamente que vai reduzir o conteúdo de cortes de live. [várias fontes]

### 2.2 Ordem da disposição a pagar (provas cruzadas)

**Eficiência (lote e economia de tempo) > conformidade na distribuição (manter várias contas vivas) > resultado (qualidade do corte).** Quem paga por resultado não é o avulso, e sim o criador de locução e a equipe de transmissão do comerciante (uma ferramenta voltada a lojistas cobra de 99 a 199 por mês, com ticket corporativo de 40 a 50 mil). [várias fontes]

### 2.3 Encaixe por grupo

| Grupo | Encaixe com o HotClip | Observação |
|---|---|---|
| Criador de locução de conteúdo editando a si mesmo | **o maior** | legenda por palavra, escolha pelo texto e mesa de revisão acertam no centro do alvo; o que ele paga é o tempo economizado |
| Equipe do apresentador / comerciante que transmite (cortando a si mesmo) | alto | sem problema de licença, com disposição a pagar por qualidade, e o material já está na mão |
| Criador de cortes de jogo | formato do conteúdo é ótimo, mas a monetização encolheu | a cultura da piada interna é ponto cego da IA (ver seção 6) |
| Cortador avulso de vídeo de venda | metade errada | ele quer variação em massa que passe na moderação, não uma peça caprichada; e o grupo está sumindo |
| Recriação de entretenimento e programas de TV | baixo | zona de alta pressão de direitos autorais (casos de indenização de 100 mil a 1 milhão) |

---

## 3. Revisão: entregar o vídeo inteiro a um modelo nativo de vídeo (terceira frente)

### 3.1 Conta do custo (3 horas de live, preço oficial de 2026-08-09, 1 USD ≈ R$ 5,4)

Tokenização de vídeo do Gemini: 66 tokens por quadro em baixa resolução a 1 fps + 32 tokens/s de áudio ≈ **100 tok/s**; contexto de 1M = 3 horas em baixa resolução. 3 h ≈ 1,08M tokens:

| Opção | Custo por transmissão | Observação |
|---|---|---|
| qwen3-vl-flash (Bailian / 302.ai) | **R$ 0,3 a 0,7** | preço nacional a partir de US$ 0,022/M; a requisição única aceita no máximo 1 h, então precisa de 3 partes |
| GLM-4.6V (Zhipu) | ≈ R$ 1,3 | contexto de 128K, cerca de 9 partes; o **4.6V-Flash é grátis** e serve de faixa de nuvem sem custo para experimentar |
| doubao-seed-1.6/1.8 (Volcano) | ≈ R$ 1,6 | o 1.8 é oficialmente vendido como «compreensão de vídeo muito longo em baixa taxa de quadros», encaixe perfeito com corte de live |
| MiniMax M3 | ≈ R$ 2,3 | contexto de 1M + entrada de vídeo nativa e **código aberto** (o único candidato que também poderia rodar local, mas a exigência de computação é alta) |
| Gemini 3.5 Flash-Lite | US$ 0,32 (em lote, US$ 0,16) | sondar o piso na faixa internacional |
| Gemini 3.5 Flash | US$ 1,62 (em lote, US$ 0,81) | colchão de qualidade na faixa internacional |
| Gemini 3.1 Pro (fatiado para escapar da faixa dobrada acima de 200K) | US$ 2,16 | reservado para arbitrar as transmissões difíceis |
| TwelveLabs Pegasus | US$ 9 a 12 | **não entra**: de 6 a 10 vezes mais caro, sem pagamento nacional e sem prova pública em live em chinês |

Dá para apertar mais uma faixa: 0,5 fps + baixa resolução (preservando a trilha de áudio, porque risada e tom de voz são sinais essenciais) → 65 tok/s, e o custo cai para cerca de 65%.

### 3.2 Forma de engenharia recomendada: alimentar por partes

O ffmpeg corta em partes de 10 minutos (capacidade que já temos) × 18 partes → upload pela Files API ou pela via de cada fornecedor, com requisições em paralelo (cada parte leva no prompt o resumo do que veio antes) → a camada de texto funde e ordena (reaproveitando o resumo de seleção que já existe). Ganhos: ① escapa da faixa cara ② o paralelo faz a latência ser a de uma parte só ③ o desvio de marca de tempo cai da escala de horas para menos de 10 minutos ④ dá para repetir uma parte isolada.

### 3.3 Nível de prova do resultado (avaliação honesta)

- A favor: o Video-MME-v2 mostra o Gemini-3-Pro bem à frente em ordem temporal em vídeo longo, raciocínio entre partes e fusão de imagem com áudio (exatamente as capacidades centrais de escolher o pico); as avaliações de ferramentas confirmam que um modelo nativo de vídeo pega «o destaque que a transcrição não mostra», e que a pontuação só por texto perde o gancho em locução mais suave. [várias fontes]
- Água fria: o estado da arte em granularidade de ação e raciocínio físico ainda fica abaixo de 30 pontos (o pico de uma jogada rápida pode não ser pego direito); e **não existe nenhum A/B público rigoroso de «vídeo nativo contra escolha por transcrição»**. [várias fontes]
- **Veredito**: a prova sustenta «colocar no ar e fazer A/B», não «derrubar e recomeçar». A postura certa é a análise do vídeo inteiro entrar como **nona trilha de sinal** na camada de fusão que já existe (as oito trilhas heurísticas + o LLM de texto são a base da faixa grátis, e não saem); na faixa paga, deixar que ela **absorva a revisão em folha de nove quadros do VLM** (escolha e revisão em um passo só, economizando uma rodada de chamada). O HotClip ainda tem nas mãos os comentários ao vivo, um sinal que os modelos não têm — «modelo de vídeo + comentários ao vivo + transcrição no mesmo contexto» pode ser melhor que qualquer opção isolada.

### 3.4 Outras alavancas pagas (por custo-benefício)

- **Capa**: Nano Banana Pro (Gemini 3 Pro Image) a US$ 0,134 por imagem, **a melhor renderização de texto do mercado** — é a casa da capa de «letra grande cobrindo o rosto»; o Seedream 5.0 Lite a US$ 0,032 por imagem faz volume. Estratégia de duas faixas. [preço oficial]
- **Trilha segura em direitos**: ElevenLabs Music a US$ 0,30 por minuto (todos os dados de treino licenciados, risco jurídico mínimo); como a trilha de um corte tem no máximo 1 minuto, dá de R$ 1 a 2 por corte e elimina de vez o risco de o vídeo ser tirado do ar. [relato de terceiros]
- **Faixa opcional de ASR na nuvem**: Seed-ASR 2.0 da Volcano a **R$ 0,8 por hora**, comprando separação de quem fala + robustez a sotaque — reforço direto para a escolha pelo texto e o filtro por locutor da v0.12; é melhoria gradual, não salto, então a faixa padrão continua o SenseVoice local. [preço oficial]
- **Plataformas agregadoras**: no mercado nacional, 302.ai por padrão (em moeda local, preço alinhado ao oficial, cobrindo qwen3-vl, Doubao e Gemini); a interface unificada de video_url do OpenRouter serve para rotear a faixa internacional (a taxa de 5,5% na recarga entra no custo); o preço de tabela do Atlas é promocional, então fica com folga.
- **Não vale a pena**: GPT-5.x para escolher trechos (não tem API nativa de vídeo, e extrair quadros por conta própria é repetir a revisão por VLM que já existe); a faixa de áudio do Qwen-Omni (mais de 10 vezes o custo de ASR → texto); SaaS de movimento de câmera de terceiros (a detecção de rosto local + a composição fixa já cobrem 90% dos casos).

### 3.5 Combinação padrão na nuvem e custo por corte (uma transmissão de 3 h rendendo 10 cortes)

- **Faixa nacional**: qwen3-vl-flash ou doubao-seed-1.6 na transmissão inteira em partes (R$ 0,7 a 1,6) + Seed-ASR (R$ 2,4) + capa Seedream (R$ 2,3 por 10 imagens) ≈ **R$ 5,4 a 6,3 por transmissão, R$ 0,54 a 0,63 por corte**
- **Faixa internacional**: Gemini 3.5 Flash na transmissão inteira (US$ 1,05 a 1,62) + ASR local + capa Seedream ≈ **US$ 1,5 a 2,1 por transmissão**
- A regra de ferro da interface não muda: mostrar a estimativa de custo por corte, e a faixa local e grátis roda a cadeia inteira.

---

## 4. Cenário competitivo em 2026-08 (segunda frente)

- **OpusClip**: em digestão depois dos dez lançamentos de julho; o que veio de novo foi o Contextual Prompting (dizer em linguagem natural o que se quer e **excluir temas**) e o ClipAnything cortando direto de uma URL; 27 ferramentas de MCP, medido por minuto renderizado. A reputação não melhorou (processamento pendurado, hostilidade aos créditos, dificuldade de cancelar). [várias fontes]
- **Reap**: a mais radical na virada para agentes, US$ 9,99 por mês com API, CLI e MCP liberados; prompt clipping (uma frase e sai o trailer ou o corte temático); inventou a venda do «conjunto de dados rotulado por resultado realimentando a escolha» (diz que 1 em 5 atinge a meta, medição própria). [várias fontes]
- **Descript**: na NAB 2026 lançou API + automação por agentes, transformando em produto o pipeline sem supervisão de «a gravação cai no S3 → o corte sai sozinho → você abre o computador e o material está pronto». [várias fontes]
- **Espécies novas**: Mosaic (YC W25, fluxo de agentes em tela de nós + várias variantes do mesmo material em A/B, US$ 3,8 milhões de investimento-semente, já vendendo para empresas); ByteDance **Vidi2** (12B aberto em 2025-12, localização espaço-temporal + roteiro narrativo + linha do tempo completa, sustentando o Smart Split grátis do TikTok). [várias fontes]
- **O MCP deixou de ser argumento e virou item de lista** (em um ano, todo mundo tem um); o ponto de entrada de edição por agente que seja «grátis + local + privado» hoje é **uma vaga vazia no mercado**. [várias fontes]
- Conferência das lacunas (já com grep no código): a limpeza das tomadas ruins **nós já temos** (o retakes.ts já está ligado à exportação, e o relatório sobre concorrentes errou aí); as lacunas reais são ① escolha por prompt e exclusão de temas ② servidor MCP local ③ modelo de gancho em texto no primeiro quadro ④ pasta monitorada sem supervisão.

## 5. Algoritmo das plataformas e restrições duras de conformidade no segundo semestre de 2026 (quarta frente)

- **Plataforma de vídeo curto principal**: dizem que o peso da taxa de itens salvos passa de 40%, com avaliação de longo prazo do alcance lento em 7 dias (reforçar o convite a salvar entre o 4º e o 7º dia tem valor real); «utilidade e retorno pela busca» entraram no modelo; o rótulo da conta ficou mais preciso. [várias fontes; o limiar exato é de fonte única]
- **Canal de vídeo de mensageiro**: mais de 550 milhões de usuários diários, e o setor avalia que a janela para vender por cortes vai do segundo semestre de 2026 ao primeiro de 2027; as regras mudam de 2 a 3 vezes por ano → **os parâmetros de plataforma vão como configuração, nunca fixos no código**. [sistema de fonte única]
- **Outra plataforma de vídeo curto**: em 2026-07 saiu do «círculo próximo» para o «interesse amplo», e a precisão do rótulo do conteúdo substituiu o número de seguidores. [sistema de fonte única]
- **Reels**: **a detecção por impressão digital visual classifica como reaproveitamento quando «70% ou mais dos elementos audiovisuais da origem são preservados»**; 10 repostagens em 30 dias tiram a conta inteira da recomendação — ou seja, «quanto o corte foi transformado» é um indicador duro de sobrevivência, não só estética. [várias fontes]
- **YouTube Shorts**: o sinal de ranqueamento virou tempo assistido por impressão; a política de «conteúdo inautêntico» se ampliou e atinge modelo produzido em massa e corte reciclado (em janeiro foram limpos 4,7 bilhões de visualizações); marca-d'água de TikTok derruba o alcance na hora; o rótulo de conteúdo sintético é só um sinal de transparência, **não uma marca de punição**. [várias fontes]
- **TikTok**: Duet e Stitch não contam para o programa de recompensa — o corte precisa ser «upload original + trabalho de substância»; o valor de busca entra no cálculo de receita por mil. [várias fontes]
- **Conformidade**: em 2026-07 saiu a nova norma de rotulagem em vídeo curto, «conteúdo de IA, edição de material reaproveitado e divulgação comercial precisam de rótulo, e três infrações banem a conta»; uma das redes só recomenda quando pelo menos 50% do conteúdo é de gente real. **«Esconder a IA» é estratégia errada; o certo é «rotular a IA + mostrar o valor humano»** — a chave de rotulagem de IA é função obrigatória, não enfeite. [várias fontes]

## 6. As 5 maiores lacunas restantes no ofício do corte final (quarta frente, em ordem de impacto na taxa de viralização)

1. **Julgar o que descartar / portão de qualidade**: de 30 a 45% do que a IA entrega é refugo (pensamento incompleto, gancho fraco, final ruim), e em cena com vários locutores o acerto é de só 4 em 10; o fluxo profissional gasta de fato 71 minutos por episódio revisando. Em 2026, publicar refugo custa no nível da conta (o limiar de retenção do Shorts pune o canal inteiro). → Solução em três camadas: regras (integridade da borda da frase: a abertura não pode ficar solta em «então» ou «mas», o fim tem de fechar a frase com um ponto emocional; sobreposição de locutores acima do limiar perde peso) + segunda leitura de compreensibilidade sem contexto por LLM («dá para entender sem ter visto a live? o final parece um final?» → recomendar publicar / precisa de olho humano / descartar) + revisão rápida em uma tela na mesa de revisão (espremendo os 71 minutos para 10). [várias fontes]
2. **Desenho de valor orientado a salvar e a voltar pela busca**: a função-objetivo da escolha ainda é «o quanto é bom», mas o primeiro peso já é «útil / salvável / buscável» → entra um sinal de «densidade prática» (passo a passo, lista, número e frase de efeito somam pontos), o título da capa vira formato de termo de busca quando o sinal aparece, e a exportação acompanha uma sugestão de palavras-chave de busca.
3. **Profundidade da transformação para originalidade (anti-impressão digital)**: o que já temos (recomposição vertical, camada de legenda, zoom automático, flash-forward, efeitos sonoros) cobre boa parte; falta consolidar tudo em uma **nota de transformação** visível para quem usa (cartão amarelo abaixo do limiar: «este corte corre risco de ser classificado como reaproveitamento») + perturbação controlada do modelo dentro da conta (posição da legenda, paleta e combinação de efeitos diferentes entre os cortes da mesma conta — a impressão digital da produção em massa é a homogeneidade).
4. **Camada de contexto de comunidade e de piada interna**: a piada da partida e o jargão de quem apresenta decidem a taxa de compartilhamento (compartilhar por mensagem privada vale 3 vezes mais no TikTok e é o primeiro sinal no Reels). A ferramenta só localiza «onde dá para brincar» (marcando o pico de emoção, o contraste e o pico dos comentários ao vivo + uma vaga para inserir) e mantém uma biblioteca de piadas cuidada pela pessoa; o que brincar fica com ela.
5. **Conter o «cheiro de IA»**: a remoção de silêncio **preserva a respiração e a inspirada antes da risada** (79% dos ouvintes desconfiam inconscientemente de uma voz clonada sem respiração); sincronia da legenda no nível do fonema (o desvio é o que mais denuncia montagem); e o painel de exportação, com a chave de rotulagem de IA, gera o texto de conformidade conforme a plataforma.

Outras correções e aprendizados: corte de podcast em inglês vai de 45 a 90 s («20 a 40 s é o ideal» não vale para essa categoria, então a faixa é por categoria); **teto de 3 a 5 cortes por episódio** para o algoritmo não se canibalizar (é a razão do aviso de limite de produção por transmissão); «comando falado por quem apresenta» (clipping ativado por voz, detectando na gravação frases do tipo «corta esse trecho aqui») é tendência nova de 2026 e um sinal fortíssimo de seleção; a fórmula de três etapas da venda é dor → demonstração → preço (na essência é a junção de vários trechos, que combina naturalmente com o mecanismo de pieces e dá para virar um modelo narrativo); o estilo de legenda precisa de «faixas», não de um único ótimo (a alta densidade convive com o minimalismo na contramão).
Artigos e repositórios novos: Lighthouse (LINE, biblioteca unificada de MR + HD, primeira escolha para comparar com a linha de base), BEAT (ponto de corte guiado pela batida da música), KLive (conjunto de dados de três modalidades com 19 mil horas de live de uma plataforma chinesa, a maior referência pública de previsão de destaque juntando comentário e ASR) e montage-ai (implementação de referência de entrega para NLE via OTIO/EDL).

## 7. O que claramente não vamos fazer (acréscimo da terceira rodada)

Vale a lista da segunda rodada (B-roll de IA, nota absoluta, mixagem para fugir de duplicata, fundo verde fingindo presença), e acrescentamos:

- **Construir nosso próprio disparo para várias plataformas / administração de rede de contas**: mercado saturado (guerra de preço a 688 por ano) + zona cinza (banimento em conjunto) + conflito com o modelo de manutenção de uma ferramenta local e aberta. Basta entregar um pacote de publicação padrão que converse com as ferramentas que já existem.
- **Falsa originalidade no nível do pixel**: fazemos «variação na camada da expressão», não «fuga da detecção», acompanhando a rotulagem de IA em vez de brigar com a plataforma.
- **Entrar na disputa de correção de cor e efeitos de cinema**: o investimento em qualidade para em «legenda certa, corte fluido, abertura explosiva e aprovação na moderação».
- **Plataforma de intermediação de licenças**: já ocupada e pesada no jurídico.
- **TwelveLabs / GPT-5.x para escolher trechos / faixa de áudio do Qwen-Omni / SaaS de movimento de câmera de terceiros** (os motivos estão em 3.4).

## 8. Roteiro revisado

Ver a seção 9 do [PRODUCT-PLAN.md](./PRODUCT-PLAN.md) (onde houver conflito com a seção 8, vale a seção 9).

---

*Os quatro relatórios originais dos agentes (com todas as URLs das fontes) saíram da sessão de 2026-08-09; fontes principais: os preços oficiais e a documentação de vídeo do Gemini, as tabelas oficiais de Bailian, Volcano e Zhipu, os preços de tabela de 302.ai e OpenRouter, o Video-MME-v2 (arXiv 2604.05015), os testes do OpusClip pela BIGVU e pela Choppity, o relatório de referência da Reap (medição própria), o texto «agentic video editing» da a16z, o investimento-semente da Mosaic, o anúncio oficial do TikTok Smart Split, o GitHub e o artigo do Vidi2, a reportagem da Forbes sobre a economia dos cortes, as análises de algoritmo de TikTok, YouTube e Reels para 2026, os materiais sobre conformidade de IA, as reportagens da imprensa econômica sobre o setor de cortes, as enciclopédias colaborativas de piadas de e-sports e o cálculo de lixo de IA da Kapwing.*
