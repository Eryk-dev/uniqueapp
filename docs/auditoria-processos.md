# Auditoria de Processos — 15 de Abril de 2026

## 1. Escopo

Analise completa de todos os processos do sistema Unique Platform, que gerencia pedidos personalizados das marcas UniqueBox e UniqueKids desde o recebimento via Shopify ate a expedicao fisica.

O sistema integra-se com o Tiny (gestao empresarial), a SEFAZ (autorizacao de notas fiscais) e Supabase (banco de dados e armazenamento de arquivos).

---

## 2. Processos Identificados

### Processo 1 — Recebimento de Pedidos

**O que faz:** Recebe pedidos aprovados do Shopify (via Tiny) e registra no sistema.

**Frequencia:** Em tempo real, a cada pedido aprovado.

**Subprocessos:**
- Recebe notificacao do Tiny quando um pedido e criado ou atualizado
- Verifica se o pedido vem do Shopify (ignora Mercado Livre e outros)
- Registra o pedido no banco de dados como "recebido"
- Registra evento no historico

**Excecoes:**
- Pedidos de Mercado Livre e outros marketplaces sao ignorados silenciosamente
- Se o Tiny enviar o mesmo pedido duas vezes, o sistema atualiza ao inves de duplicar

---

### Processo 2 — Duplicacao Fiscal (NF 1/2)

**O que faz:** Cria uma copia do pedido original com precos reduzidos a 38% do valor e solicita emissao de nota fiscal para essa copia.

**Frequencia:** Automaticamente, logo apos o recebimento do pedido.

**Subprocessos:**
- Busca dados completos do pedido original no Tiny
- Cria pedido clonado com cada item a 38% do preco (minimo R$0,01 por item)
- Aplica desconto proporcional a 38% (minimo R$0,01)
- Adiciona observacao interna identificando que e uma copia
- Solicita emissao de nota fiscal modelo 55 para o pedido clonado
- Aplica etiquetas de controle no pedido original, no clone e na nota
- Registra a nota fiscal no banco de dados
- Muda o status do pedido para "aguardando nota fiscal"

**Excecoes:**
- Se a comunicacao com o Tiny falhar, o pedido vai para status "erro fiscal"
- Pedidos que ja passaram desta etapa sao ignorados automaticamente

---

### Processo 3 — Autorizacao da Nota Fiscal

**O que faz:** Recebe a confirmacao de que a SEFAZ autorizou a nota fiscal emitida.

**Frequencia:** Em tempo real, via notificacao do Tiny quando a SEFAZ responde.

**Subprocessos:**
- Marca a nota como autorizada com data e hora
- Registra evento no historico
- Dispara automaticamente o processo de preparacao dos dados

**Excecoes:**
- Notas nao encontradas no sistema sao ignoradas
- Notas ja autorizadas sao ignoradas automaticamente

---

### Processo 4 — Enriquecimento de Dados (Preparacao para Producao)

**O que faz:** Busca detalhes completos da nota fiscal e do pedido no Tiny, identifica cada item de producao com suas caracteristicas (molde, fonte, personalizacao).

**Frequencia:** Automaticamente, logo apos a autorizacao da nota fiscal.

**Subprocessos:**
- Busca detalhes da nota fiscal no Tiny
- Busca dados completos do pedido no Tiny (itens, cliente, frete)
- Para UniqueKids: decodifica o codigo do produto para determinar tipo de molde e fonte
- Expande itens com quantidade maior que 1 em registros individuais
- Remove o produto "Kit Surpresa" da lista de producao
- Cria os itens de producao individuais no banco de dados
- Atualiza o pedido com nome do cliente, dados de frete
- Muda status para "pronto para producao"

**Excecoes:**
- Se a comunicacao com o Tiny falhar, o pedido vai para "erro de enriquecimento"
- Pedidos sem nota fiscal sao rejeitados

---

### Processo 5 — Producao (Geracao de Lotes e Chapas)

**O que faz:** Agrupa pedidos prontos em lotes de producao e gera os arquivos necessarios: chapas de corte (SVG) e folhas de conferencia (PDF).

**Frequencia:** Sob demanda — o operador seleciona os pedidos e aciona a producao.

**Subprocessos:**
- Operador seleciona pedidos prontos para producao na interface
- Sistema agrupa os pedidos por tipo de frete e transportadora
- Cria um lote de producao e uma expedicao no banco de dados
- Vincula os itens de producao ao lote
- Muda os pedidos para status "em producao"
- Gera chapas de corte SVG (ate 28 itens por chapa)
- Gera folha de conferencia PDF com dados de cada pedido
- Salva os arquivos no armazenamento
- Marca itens como "produzidos" e lote como "concluido"

**Excecoes:**
- Se a geracao falhar para algum item, o lote fica com status "erro parcial"
- Itens com erro podem ser reprocessados individualmente (Processo 8)

---

### Processo 6 — Expedicao (Despacho)

**O que faz:** Cria um grupo de expedicao no Tiny vinculando as notas fiscais dos pedidos produzidos para despacho pela transportadora.

**Frequencia:** Sob demanda — o operador cria a expedicao apos a producao.

**Subprocessos:**
- Operador seleciona pedidos ja produzidos
- Sistema coleta os identificadores das notas fiscais
- Cria grupo de expedicao no Tiny com informacoes de logistica
- Registra a expedicao no banco de dados
- Muda os pedidos para status "expedido"

**Excecoes:**
- Se a comunicacao com o Tiny falhar, a expedicao fica com status "erro"
- Em caso de erro, os pedidos NAO mudam de status (permanecem "produzidos")

---

### Processo 7 — Pedidos Avulsos (Fora do Shopify)

**O que faz:** Permite criar pedidos manuais diretamente na interface, sem passar pelo Shopify nem pelo processo fiscal.

**Frequencia:** Sob demanda — o operador cria quando necessario.

**Subprocessos:**
- Operador informa nome do cliente e ate 3 linhas de personalizacao
- Sistema cria o pedido diretamente como "pronto para producao"
- Cria um item de producao
- Dispara geracao de lote e chapas imediatamente
- Retorna os links dos arquivos gerados

**Excecoes:**
- Nao passa por emissao de nota fiscal
- Nao tem tratamento robusto de erros na geracao

---

### Processo 8 — Reprocessamento de Itens com Erro

**O que faz:** Permite reprocessar itens que falharam na geracao de chapas.

**Frequencia:** Sob demanda — o operador identifica itens com erro e solicita reprocessamento.

**Subprocessos:**
- Operador identifica itens com erro no detalhe do lote
- Sistema reseta o status dos itens selecionados para "pendente"
- Muda o lote de volta para "processando"
- Dispara a geracao de chapas novamente

---

## 3. Acoes Criticas e Reversoes

| # | O que faz | Processo | Sistema afetado | Seguro repetir? | Tem reversao? | Consequencia se falhar |
|---|---|---|---|---|---|---|
| 1 | Cria pedido clonado a 38% do valor | Duplicacao Fiscal | Tiny | Nao — cria duplicata | **NAO** | Pedido indevido permanece no Tiny, requer exclusao manual |
| 2 | Solicita emissao de nota fiscal modelo 55 | Duplicacao Fiscal | Tiny + SEFAZ | Nao — emite NF duplicada | **NAO** | Nota fiscal indevida emitida, requer cancelamento manual na SEFAZ |
| 3 | Aplica etiquetas nos pedidos e notas | Duplicacao Fiscal | Tiny | Sim — idempotente | **NAO** | Etiquetas ficam permanentes, sem impacto grave |
| 4 | Cria grupo de expedicao | Expedicao | Tiny | Nao — cria duplicata | **NAO** | Expedicao com dados incorretos, requer correcao manual |
| 5 | Muda pedido para "em producao" | Producao | Banco de dados | Sim | Parcial — retry disponivel | Pedido travado em status intermediario |
| 6 | Gera chapas SVG e folhas PDF | Producao | Armazenamento | Sim | Sim — pode regerar | Producao parada ate reprocessamento |
| 7 | Muda pedido para "expedido" | Expedicao | Banco de dados | Sim | **NAO** — sem caminho de volta | Pedido marcado como enviado sem expedicao valida |

**Resumo:** Das 4 acoes externas criticas, **nenhuma possui reversao automatica**. Toda correcao de erro em sistemas externos requer intervencao manual no Tiny ou na SEFAZ.

---

## 4. Estados Esperados por Transicao

| Situacao do Pedido | Banco de Dados | Tiny | SEFAZ | Armazenamento |
|---|---|---|---|---|
| Recebido | Pedido criado, evento registrado | Pedido existe como aprovado | — | — |
| Aguardando NF | Nota fiscal registrada, pedido clone referenciado | Clone criado, NF solicitada, etiquetas aplicadas | NF em analise | — |
| Pronto para Producao | Itens de producao criados, dados de frete preenchidos | NF autorizada | NF autorizada | — |
| Em Producao | Lote criado, itens vinculados ao lote, expedicao (local) criada | Sem mudanca | — | — |
| Produzido | Itens marcados como produzidos, arquivos registrados, lote concluido | Sem mudanca | — | Chapas SVG e folhas PDF salvos |
| Expedido | Pedido finalizado, expedicao com identificador do Tiny | Expedicao criada com notas fiscais vinculadas | — | — |

---

## 5. Conexoes entre Processos

### Recebimento → Duplicacao Fiscal
- **O que dispara:** Pedido registrado com status "recebido" aciona automaticamente a duplicacao
- **Pre-condicoes:** Pedido com identificador valido do Tiny
- **Status:** **OK** — Disparo automatico confiavel com protecao contra duplicidade

### Duplicacao Fiscal → Autorizacao da NF
- **O que dispara:** A SEFAZ envia notificacao ao Tiny, que repassa ao sistema via webhook
- **Pre-condicoes:** Nota fiscal registrada no banco com identificador do Tiny
- **Status:** **RISCO** — Depende de um webhook externo que pode nao chegar. Nao existe verificacao periodica para notas que ficam esperando indefinidamente.

### Autorizacao da NF → Enriquecimento
- **O que dispara:** O processo de autorizacao faz uma chamada direta para o enriquecimento
- **Pre-condicoes:** Pedido em status "aguardando NF", nota com identificador valido
- **Status:** **PROBLEMA** — Se essa chamada interna falhar, o erro e silenciado. O pedido fica em "aguardando NF" sem que ninguem perceba e sem retentativa automatica.

### Enriquecimento → Producao
- **O que dispara:** Acao manual do operador na interface
- **Pre-condicoes:** Pedido em "pronto para producao", itens de producao existem
- **Status:** **OK** — Operador controla o momento, sem risco de disparo indevido

### Producao → Expedicao
- **O que dispara:** Acao manual do operador na interface
- **Pre-condicoes:** Pedidos com status "produzido", lote de producao vinculado
- **Status:** **PROBLEMA** — A producao ja cria uma expedicao no banco de dados. Quando o operador cria a expedicao, o sistema cria OUTRA. Resultado: dois registros de expedicao para o mesmo grupo. Alem disso, os identificadores usados como "notas fiscais" sao na verdade identificadores de PEDIDO, o que pode causar falha ou dados incorretos no Tiny.

---

## 6. Problemas Encontrados

### Problema 1 — IDs de pedido enviados como IDs de nota fiscal na expedicao
- **Gravidade**: ALTA
- **Processo afetado**: Expedicao (Despacho)
- **O que acontece**: Quando o sistema cria a expedicao no Tiny, envia os identificadores dos PEDIDOS originais como se fossem identificadores de NOTAS FISCAIS. O Tiny espera receber IDs de notas, nao de pedidos.
- **O que deveria acontecer**: O sistema deveria buscar os identificadores reais das notas fiscais (que estao armazenados no banco, no registro da nota) e envia-los ao Tiny.
- **Consequencia**: A expedicao pode ser criada com referencias incorretas, ou a comunicacao com o Tiny pode falhar completamente. As notas fiscais corretas nao ficam vinculadas ao grupo de envio.
- **Sugestao**: Alterar a logica de expedicao para buscar o identificador real da nota fiscal no banco de dados ao inves de usar o identificador do pedido.

### Problema 2 — Falha silenciosa na conexao entre autorizacao e enriquecimento
- **Gravidade**: ALTA
- **Processo afetado**: Conexao entre Autorizacao da NF e Enriquecimento
- **O que acontece**: Quando a nota fiscal e autorizada, o sistema tenta disparar o enriquecimento. Se essa chamada interna falhar, o erro e registrado apenas internamente e ignorado. O pedido fica travado em "aguardando NF" indefinidamente.
- **O que deveria acontecer**: O sistema deveria ter uma retentativa automatica ou, no minimo, mudar o pedido para um status de erro visivel ao operador.
- **Consequencia**: Pedidos podem ficar "perdidos" no sistema sem que ninguem perceba. O operador nao tem visibilidade sobre pedidos travados nesta etapa.
- **Sugestao**: Implementar retentativa automatica com limite de tentativas, ou criar um alerta quando um pedido fica em "aguardando NF" por mais de X horas.

### Problema 3 — Expedicao criada em duplicidade no banco de dados
- **Gravidade**: MEDIA
- **Processo afetado**: Producao e Expedicao
- **O que acontece**: Quando o operador inicia a producao, o sistema ja cria um registro de expedicao no banco. Quando o operador depois cria a expedicao formal, o sistema cria OUTRO registro. Resultado: dois registros de expedicao para o mesmo grupo de pedidos.
- **O que deveria acontecer**: A expedicao deveria ser criada apenas uma vez — ou na producao (como rascunho) ou na expedicao (como definitiva), mas nao nos dois momentos.
- **Consequencia**: Dados inconsistentes no banco. A interface pode mostrar expedicoes duplicadas. Relatorios podem contar envios em dobro.
- **Sugestao**: Remover a criacao da expedicao no momento da producao, e criar apenas quando o operador formalizar o envio. Ou, atualizar a expedicao existente ao inves de criar uma nova.

### Problema 4 — Sem verificacao periodica para notas fiscais nao autorizadas
- **Gravidade**: MEDIA
- **Processo afetado**: Autorizacao da Nota Fiscal
- **O que acontece**: O sistema depende exclusivamente do webhook da SEFAZ (via Tiny) para saber que a nota foi autorizada. Se esse webhook nao chegar por qualquer motivo (falha de rede, erro no Tiny, timeout), o pedido fica em "aguardando NF" para sempre.
- **O que deveria acontecer**: O sistema deveria verificar periodicamente no Tiny se existem notas pendentes que ja foram autorizadas pela SEFAZ.
- **Consequencia**: Pedidos podem ficar parados indefinidamente sem que o operador perceba a tempo.
- **Sugestao**: Criar uma verificacao periodica (por exemplo, a cada 30 minutos) que busca no Tiny o status das notas fiscais pendentes ha mais de 1 hora.

### Problema 5 — Nenhuma acao externa possui reversao automatica
- **Gravidade**: MEDIA
- **Processo afetado**: Duplicacao Fiscal e Expedicao
- **O que acontece**: Das 4 acoes que modificam o Tiny (criar clone, emitir NF, aplicar etiquetas, criar expedicao), nenhuma possui mecanismo de reversao automatica no sistema.
- **O que deveria acontecer**: Para pelo menos as acoes mais criticas (emissao de NF e criacao de expedicao), deveria existir um botao ou processo de estorno/cancelamento.
- **Consequencia**: Qualquer erro requer que alguem va manualmente ao Tiny para corrigir. Em caso de falha parcial (por exemplo, clone criado mas NF nao emitida), o sistema externo fica em estado inconsistente.
- **Sugestao**: Implementar ao menos uma acao de "cancelar duplicacao fiscal" que exclua o pedido clone no Tiny quando o processo falha no meio.

### Problema 6 — Status "avulso produzido" existe mas nunca e usado
- **Gravidade**: BAIXA
- **Processo afetado**: Pedidos Avulsos
- **O que acontece**: O sistema define um status especifico para pedidos avulsos produzidos, e a interface ate mostra esse status com cores proprias. Porem, nenhum processo do sistema marca um pedido avulso com esse status. Pedidos avulsos seguem o fluxo normal e terminam como "produzido".
- **O que deveria acontecer**: Ou o status deveria ser aplicado corretamente aos pedidos avulsos apos producao, ou deveria ser removido do sistema para evitar confusao.
- **Consequencia**: O operador pode esperar ver pedidos avulsos em uma aba especifica que sempre estara vazia.
- **Sugestao**: Implementar a transicao para "avulso produzido" no final da geracao de pedidos avulsos, ou remover o status se nao for necessario.

### Problema 7 — Pedidos avulsos usam timestamp como identificador unico
- **Gravidade**: BAIXA
- **Processo afetado**: Pedidos Avulsos
- **O que acontece**: Para preencher o campo obrigatorio de identificador do Tiny, o sistema usa o momento exato de criacao (milissegundos). Se dois pedidos avulsos forem criados no exato mesmo milissegundo, havera conflito.
- **O que deveria acontecer**: Usar um identificador garantidamente unico (por exemplo, um contador sequencial ou um codigo aleatorio).
- **Consequencia**: Em situacoes raras, a criacao do segundo pedido pode falhar.
- **Sugestao**: Trocar por um gerador de identificador unico que nao dependa do horario.

---

## 7. Sugestoes de Melhoria

### 7.1 — Painel de saude dos pedidos
Criar uma visao que mostre pedidos "travados" — ou seja, que estao em um status intermediario ha mais tempo que o esperado. Por exemplo: pedidos em "aguardando NF" ha mais de 24 horas, ou em "em producao" ha mais de 48 horas.

### 7.2 — Notificacoes de erro
Implementar notificacoes (email, Slack ou dentro do proprio sistema) quando um pedido cair em qualquer estado de erro. Hoje, o operador so descobre se olhar ativamente a aba de erros.

### 7.3 — Log de acoes externas com status de confirmacao
Para cada acao no Tiny (criar clone, emitir NF, criar expedicao), registrar nao apenas "tentou criar" mas tambem "confirmou que existe". Isso permite detectar falhas parciais onde o sistema acredita que criou algo mas o Tiny nao processou.

### 7.4 — Reconciliacao periodica com o Tiny
Criar um processo automatico que compara os dados do sistema com os dados do Tiny periodicamente (por exemplo, uma vez por dia). Verifica se pedidos marcados como "expedido" realmente tem expedicao no Tiny, se notas fiscais estao autorizadas, etc.

### 7.5 — Restaurar integracoes perdidas na migracao do n8n
O sistema anterior (baseado em workflows n8n) possuia integracoes que nao foram migradas:
- **Notificacoes no Slack** quando chapas eram geradas
- **Cards de tarefa no Notion** para rastreio de producao
- **Dados no Google Sheets** como backup intermediario
- **Integracao com CRM (Kommo)** para leads

Avaliar quais dessas integracoes ainda sao necessarias e implementar equivalentes no sistema atual.

---

## 8. Diagramas

### 8.1 — Visao Geral da Cadeia de Valor
Mostra os 5 grandes processos do pedido em sequencia, do Shopify ate a expedicao.
[Abrir no FigJam](https://www.figma.com/online-whiteboard/create-diagram/a91f2da4-001e-4e1d-8522-f477b740f8a4?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=848b883a-8a3c-46ca-a646-a3f8bd81c5fe)

### 8.2 — Fluxo Detalhado do Pedido
Mostra cada passo, decisao, caminho de erro e retentativa no ciclo completo do pedido.
[Abrir no FigJam](https://www.figma.com/online-whiteboard/create-diagram/980a8b5d-af26-47f5-98f3-e49594d37b9e?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=efed1855-bea6-4fac-89e3-895e81624e8f)

### 8.3 — Mapa de Riscos e Reversoes
Mostra as 4 acoes criticas externas, a ausencia de reversao em todas, e as lacunas operacionais.
[Abrir no FigJam](https://www.figma.com/online-whiteboard/create-diagram/b9607a76-cad2-47f2-a2f1-cc0d3332d09e?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=931bddc5-f5c7-4ec1-a6a4-066b776b4008)

### 8.4 — Mapa de Conexoes entre Processos
Mostra como os processos se conectam, com indicacao de qualidade: verde (solida), amarelo (risco), vermelho (problema).
[Abrir no FigJam](https://www.figma.com/online-whiteboard/create-diagram/bd2bce09-0c3c-4cd1-b7e3-48c88b6efb97?utm_source=other&utm_content=edit_in_figjam&oai_id=&request_id=5bae8726-8f56-476e-827d-1afa15cf84f8)

**Legenda de cores dos diagramas:**
- **Azul:** Acao automatica do sistema
- **Roxo:** Acao manual do operador
- **Laranja:** Acao em sistema externo (Tiny, SEFAZ)
- **Verde:** Conclusao com sucesso
- **Vermelho:** Erro ou lacuna
- **Amarelo:** Espera ou decisao
- **Cinza:** Ignorado/descartado
