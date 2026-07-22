# Full System Audit v1 — 3dprint-generator

- **Data:** 2026-07-21 · **Commit:** `cbb5edc` · **Método:** full-system-audit (layered agents + verificação adversarial)
- **Ambiente:** local — build de produção em :3001 (`AUTH_URL=http://localhost:3001`), dev em :3000 para probes read-only
- **Conta de teste:** gustavo.b.paris@gmail.com (test-login; dados locais do dono — nada foi excluído)
- **Foco pedido:** usabilidade, performance percebida ("bem lento, ruinzinho de usar") e coerência funcional
- **Custo real:** 2 gerações de IA (1 sem cronômetro por corrida de driver), 2 fatiamentos
- **Baseline:** nenhum (primeira auditoria graded)

## Veredito executivo

**O app não é lento — ele é confuso, e em produção está quebrado no fluxo principal.** As medições contradizem a percepção de lentidão: Lighthouse 10/10 nas páginas, viewer a ~120 fps girando malha de 1M+ triângulos, pintura em worker sem travar frame, abertura de projeto em <3 s. A "lentidão" percebida vem de outra coisa:

1. **P0 — gerar → ver está quebrado em build de produção**: a malha gerada é salva em `public/meshes/` em runtime, e `next start` só serve o `public/` congelado no build → **toda peça nova retorna 404**; o chat diz "Pronto" e o viewer mostra erro técnico. Em deploy self-host sem Blob, 100% das gerações falham na entrega. (Confirmado 2×, por dois agentes independentes.)
2. **P0 — as duas features principais ficam literalmente inclicáveis**: os painéis flutuantes absolutos se sobrepõem ("Posição do logo" cobre "Pintar cores"/"Logo aqui"; no mobile 5 controles ficam cobertos) — o usuário clica e nada acontece, que é exatamente a sensação de "app ruim/lento".
3. **Coerência da jornada nota 2.5**: pintar não persiste e o Fatiar sai sem a pintura (silenciosamente); fatiar faz o chat esquecer o design anterior; 3 exports paralelos sem hierarquia; subir um .3mf prende o projeto pra sempre no modo importado.
4. A espera real de IA (~10 s) não tem progresso definido — parado + sem barra = percebido como lento.

A infra técnica (renderização, workers, auth, Lighthouse) é sólida — **notas 9+**. O problema está na camada de PRODUTO: jornada, sobreposição de painéis, persistência da pintura e o 404 de produção.

## Scorecard

| Área | Peso | Nota | Itens |
|---|---|---|---|
| Fluxos live | 25 | **7.7** | login/sessão **10.0** · abertura de projeto existente **9.0** · geração paramétrica e2e **4.0** · fatiar+download e2e **8.0** · pintura responsiva **5.5** · settings persistem **10.0** · qualidade das mensagens de erro **7.5** |
| UX live | 20 | **6.6** | Estados loading/vazio/erro **3.5** · Affordances/descobribilidade **5.0** · Feedback de ações **8.0** · Copy PT-BR **6.0** · Mobile 390px **6.0** · A11y básico **9.0** · Hierarquia/CTA **8.5** |
| Performance live | 15 | **9.3** | Lighthouse /sign-in **10.0** · Lighthouse home logada **10.0** · Peso de rede do estúdio **6.5** · Main-thread na abertura **10.0** · Interatividade do viewer **10.0** · Caching **9.5** |
| Performance (código) | 15 | **7.8** | Peso do bundle inicial do estúdio **10.0** · Main-thread **7.5** · Transporte de malha **5.5** · Re-render/memória do viewer **8.0** · Waterfall de abertura do projeto **8.0** |
| Coerência de produto | 15 | **5.3** | Descobribilidade das features **7.5** · Coerência da jornada **2.5** · Consistência de nomenclatura/copy **4.0** · Estados de gating **4.5** · Ausência de becos sem saída **8.0** |
| Backend/confiabilidade | 10 | **7.3** | clareza de erros ao usuário **6.0** · robustez de estados presos **6.5** · eficiência de transporte **7.0** · degradação slicer/IA offline **7.0** · consistência auth **10.0** |

**Nota geral ponderada: 7.3/10**


## P0 (4)

- **[Fluxos live]** Toda peça gerada em build de produção nunca aparece: mesh salva em public/meshes/ em runtime e o next start responde 404
  - Evidência: POST /api/generate 200 → GET /meshes/be561ad0-5b7d-48ad-bc60-74a48a6f16bc.stl 404; arquivo existe em /Users/gustavoparis/www/3dprint-generator/public/meshes/ (mtime 22:52, pós-build) enquanto fdc5fc78-….stl (17:07, pré-build) responde 200. Reproduzido em 2 projetos (43563d5f e 1d9861df). Viewer trava em 'Error: Mesh fetch 404' sem botões de ação nem retry.
  - Correção sugerida: Servir malhas por route handler (ex. /api/meshes/[file] com fs.readFile + content-type) ou mover storage para fora de public/; next start não serve arquivos adicionados a public/ após o build.
- **[UX live]** Toda malha gerada em runtime retorna 404 no build de produção — o estúdio abre vazio com 'Erro: Error: Mesh fetch 404' apesar do status 'Pronto'
  - Evidência: curl http://localhost:3001/meshes/be561ad0-5b7d-48ad-bc60-74a48a6f16bc.stl → 404, mas o arquivo existe (public/meshes/, 38KB, gravado 22:52 hoje); malha existente no momento do build (iter-imported-1.stl) → 200. Reproduzido nos 2 projetos do flow-tester (43563d5f, 1d9861df). persist.ts:35-38 grava em public/meshes/ e serve como asset estático — Next prod não serve arquivos adicionados a public/ após o build.
  - Correção sugerida: Servir malhas via route handler (ex.: app/meshes/[file]/route.ts lendo do disco/blob) em vez de public/ estático; e no viewer, trocar o beco sem saída por mensagem PT-BR + botão 'Tentar novamente'.
- **[UX live]** Botões 'Logo aqui' e 'Pintar cores' ficam cobertos pelo painel 'Posição do logo' — clique não faz nada; as duas features principais estão inacessíveis
  - Evidência: Em 1496×725, elementFromPoint no centro dos dois botões retorna LEGEND/FIELDSET 'Posição do logo (teclado)'; clique real em 'Pintar cores' não mudou nada no a11y tree nem na tela. ProjectWorkspace.tsx:613 (toolbar flex-wrap max-w-[min(100%,28rem)] → sempre quebra em 2 linhas, botões somam ~580px) vs :758 (fieldset absolute top-[4.5rem] z-10 cobre a 2ª linha).
  - Correção sugerida: Mover o fieldset para baixo da toolbar com layout em fluxo (flex-col) em vez de dois absolutes com offset fixo; ou esconder o painel de posição até 'Logo aqui' ser ativado.
- **[UX live]** No mobile, 5 controles do viewer (Make it flexi, Logo aqui, Pintar cores, spinner Y, Aplicar posição) têm o centro coberto por painéis sobrepostos — estúdio inutilizável para pintar/logo
  - Evidência: Emulação 390×844 + elementFromPoint: 5 controles retornam outro elemento no centro; screenshot mostra 'Cores de Impressão', 'Posição do logo' e 'Fatiar' empilhados em 3 camadas e botão laranja cortado na borda direita.
  - Correção sugerida: Em <lg, empilhar os painéis do viewer num drawer/accordion único (bottom sheet) em vez de múltiplos absolutes.

## P1 (33)

- **[Performance (código)]** Exportar 3MF multi-cor congela a UI por ~4s em malha de 700k tris (weld + XML + zip na main thread)
  - Evidência: Medido em node: weldBodiesMultiColor=899ms, serialize3mf total=3957ms/38MB (src/lib/3mf/serialize-3mf.ts:140-233, chamado de ProjectWorkspace.tsx:544 no clique). vLines/tLines montam milhões de strings → pico de memória de centenas de MB.
  - Correção sugerida: Mover exportPainted3mf inteiro (weld+serialize+zip) para um worker (o paint-worker já existe como padrão); postMessage do Uint8Array final com transfer list.
- **[Performance (código)]** Upload de .3mf re-baixa os mesmos bytes do servidor logo após subir (~100MB movidos por import)
  - Evidência: Chat.tsx:160 sobe via /api/upload; ProjectWorkspace.tsx:293 faz fetch(meshUrl) do mesmo arquivo. Meshes reais em public/meshes têm 50-67MB.
  - Correção sugerida: onMeshUploaded já tem o File no cliente — parsear via file.arrayBuffer() direto e usar a URL só como referência p/ o servidor.
- **[Performance (código)]** /api/generate carrega TODAS as iterations com colunas completas (incl. _previews base64 ~806KB/linha) a cada mensagem de chat
  - Evidência: src/app/api/generate/route.ts:81-85 `db.select().from(iterations)` sem projeção; com 20-30 iterações imported são dezenas de MB do Postgres por request — latência de chat cresce com o histórico.
  - Correção sugerida: Usar historyColumns (projeção que já existe) para a lista e um select pontual da última linha imported quando precisar dos caches.
- **[Performance (código)]** Slice sem BLOB token devolve 3MF fatiado como base64 dentro de JSON (setup self-host/local = o do dono)
  - Evidência: src/app/api/slice/route.ts:126 inline_base64; SliceButton.tsx:91-93 decodifica com loop atob char-a-char. Sliced de malha 50MB → resposta JSON de ~40MB+.
  - Correção sugerida: Servir o resultado como resposta binária (Content-Disposition) ou gravar em public/ como persistMesh já faz e devolver URL.
- **[Performance (código)]** Mesma malha retida 4× no heap do cliente (~150-200MB p/ 1M tris) + cópia no worker
  - Evidência: ProjectWorkspace.tsx:198-200 (positions, bodies, stl em useState) + :220 paintMeshRef (positions+normals+extruders). STL de 50MB → stl 50MB + positions 36MB + bodies 36MB + paintMesh ~50MB.
  - Correção sugerida: bodies já contém positions — derivar positions de bodies (ou guardar só o BaseMesh rotulado) e manter stl como Blob/URL em vez de Uint8Array vivo.
- **[Performance (código)]** Abertura de projeto: download de 50-67MB só começa após hydrate + chunk dinâmico, e re-valida a cada abertura (max-age=0)
  - Evidência: ProjectWorkspace.tsx:222-263 (fetch no useEffect); persistMesh grava em public/meshes (persist.ts:35-38) que o Next serve com Cache-Control max-age=0; next.config.ts headers só adiciona security headers.
  - Correção sugerida: Header Cache-Control immutable p/ /meshes/:id (nome é UUID por iteração, conteúdo imutável) + <link rel=preload> ou fetch iniciado no Server Component/route handler.
- **[Coerência de produto]** Fatiar quebra a continuidade de iteração: depois do slice, o chat perde o design anterior
  - Evidência: /api/slice muda status ready→sliced (src/app/api/slice/route.ts:114-122); o generate busca previousDesign apenas em h.status==='ready' (src/app/api/generate/route.ts:223-225). Repro: gerar chaveiro → Fatiar → mandar 'logo maior' → quick-modifier recebe prev=null e o LLM parte do zero (ou pega silenciosamente um design mais antigo).
  - Correção sugerida: Incluir status 'sliced' na busca de lastReadyWithDesign (mesma condição já usada no lastPaintedMesh do próprio route, linha 252-259).
- **[Coerência de produto]** Pintura manual não entra no fluxo Fatiar: usuário pinta, fatia e recebe 3MF sem pintura
  - Evidência: Paint é 100% client-side e não persiste ('Pintura local — ainda não salva no servidor', src/components/ProjectWorkspace.tsx:466-500); SliceButton fatia a malha persistida no servidor (src/components/SliceButton.tsx:68-74). Nenhum aviso conecta os dois.
  - Correção sugerida: Quando paintDirty, desabilitar/avisar no SliceButton ('pintura local não incluída — use Exportar 3MF multi-cor') ou oferecer persistência opcional do mesh pintado antes do slice.
- **[Coerência de produto]** Modo importado é armadilha sem saída: após subir .3mf o projeto nunca volta ao fluxo paramétrico
  - Evidência: Banner '.3mf carregado' não tem dismiss (src/components/Chat.tsx:414-423); pendingMeshUrl nunca é limpo em ProjectWorkspace; o route recupera effectiveMeshUrl da história imported mesmo sem meshUrl fresco (src/app/api/generate/route.ts:172-183). Repro: subir um .3mf, depois pedir 'um cubo de 30mm' → cai em parseImportEdit, que só emite kind='imported'.
  - Correção sugerida: Botão X no banner pra limpar pendingMeshUrl + heurística/flag no route pra sair do modo importado quando o pedido é claramente uma peça nova (ou toggle explícito 'nova peça' na UI).
- **[Coerência de produto]** Painel 'Cores de Impressão' não afeta a impressão — só o viewer
  - Evidência: bodyColor/logoColor alimentam apenas o MeshViewer (src/components/ProjectWorkspace.tsx:600-601); exportPainted3mf usa printConfig do Settings do admin pros hex do 3MF (linhas 536-546). O nome do painel (841-870) promete o que não faz.
  - Correção sugerida: Ou usar bodyColor/logoColor no export (colors: {aHex: bodyColor, bHex: logoColor}), ou renomear o painel pra 'Cores do viewer (pré-visualização)'.
- **[Coerência de produto]** Três caminhos de export paralelos sem hierarquia; fatiar multi-cor achata pra mono em silêncio
  - Evidência: Download STL/3MF raw (DownloadStlButton), Fatiar→'Baixar 3MF fatiado (perfil genérico)' que faz flatten A∪B pra STL mono (src/app/api/slice/route.ts:66-84), e 'Exportar 3MF multi-cor' só dentro do painel de pintura após paintDirty (ProjectWorkspace.tsx:736-745). O único export com perfil de impressora + multi-cor é o terceiro, o menos visível.
  - Correção sugerida: Um único menu 'Exportar' com as 3 opções nomeadas pelo resultado (STL cru / 3MF multi-cor com perfil / 3MF fatiado mono-cor p/ estimativa), com aviso quando a peça tem 2 cores.
- **[Coerência de produto]** Erros de API aparecem como JSON cru no chat e nos banners
  - Evidência: Chat faz `throw new Error(`API ${res.status}: ${await res.text()}`)` e exibe a string (src/components/Chat.tsx:205,241) → usuário vê 'Erro: API 500: {"error":{"code":...}}'. Mesmo padrão em ProjectWorkspace.tsx:436 e SliceButton.tsx:75, apesar do envelope apiError já carregar message PT-BR (src/lib/http/api-error.ts).
  - Correção sugerida: Helper client-side que parseia o envelope e mostra error.message; fallback genérico PT-BR quando o body não for JSON.
- **[Coerência de produto]** Ops de malha importada (furo, texto, escala, regiões de pintura, jscad) só existem se o usuário adivinhar a frase
  - Evidência: O parser aceita scale/hole/emboss_text/jscad_raw/paint_region por região/faceIds/zFraction (src/lib/design/parse-import.ts:159-175), mas nenhuma superfície da UI as menciona; os 4 chips de exemplo são todos paramétricos (src/components/Chat.tsx:8-13) e o placeholder cita só 'porta-lata cilíndrico com logo'.
  - Correção sugerida: Chips contextuais quando há malha importada ('fazer um furo', 'escrever texto', 'pintar o topo') + um '?' com a lista de comandos suportados.
- **[Coerência de produto]** Malha freeform (Meshy) não pode ser pintada nem receber logo — botões escondidos e chat sem rota
  - Evidência: hasImportedBase exige validationReport.kind==='imported' (src/components/ProjectWorkspace.tsx:59-68) → 'Logo aqui'/'Pintar cores' somem pra freeform; importContext no route só resolve de história imported (src/app/api/generate/route.ts:172-183) → pedido 'pintar o capacete' num personagem Meshy não tem caminho, embora o paint client-side funcione em qualquer malha carregada.
  - Correção sugerida: Habilitar paintMode pra qualquer malha com bodies carregados; tratar meshBlobUrl de freeform como base importável no route (ou converter freeform→imported na primeira edição).
- **[Coerência de produto]** 'Logo aqui' deixa aplicar sem imagem anexada e falha com erro técnico em inglês depois do round-trip
  - Evidência: applyLogoPlacement não valida imagem; o route usa `imageUrl: effectiveImageUrl ?? 'logo'` (src/app/api/generate/route.ts:292); add-logo tenta `fetch('logo')` (src/lib/import/ops/add-logo.ts:55) → warning 'add_logo: logo fetch failed…' vira banner vermelho (ProjectWorkspace.tsx:443-445).
  - Correção sugerida: Gatear o botão 'Logo aqui' (ou o Aplicar) em attachedImageUrl != null, com hint 'anexe a imagem do logo primeiro'.
- **[Coerência de produto]** Projetos não têm renomear nem excluir; auto-título existe no código mas nada o consome
  - Evidência: actions/projects.ts só tem createProject (linhas 8-18); nenhuma UI de rename/delete em src/app/page.tsx; deriveProjectTitle (src/lib/projects/derive-title.ts) tem zero consumidores apesar do comentário afirmar que o generate renomeia no 1º prompt.
  - Correção sugerida: Ligar deriveProjectTitle no generate quando title==='Projeto sem título' + ações rename/delete com menu no card do projeto.
- **[Coerência de produto]** Sem navegação de versões: nenhuma forma de reabrir/restaurar uma iteração antiga ou desfazer um edit ruim
  - Evidência: O viewer sempre hidrata lastReady (src/components/ProjectWorkspace.tsx:188-263); as bolhas do chat carregam iterationId mas não têm handler de clique (Chat.tsx:273-405). Um add_logo mal posicionado é irreversível na UI.
  - Correção sugerida: Clicar numa bolha assistant carrega aquela iteração no viewer; botão 'voltar pra esta versão' que seta currentIterationId.
- **[Coerência de produto]** Copy do anexo de imagem descreve comportamento que o backend não tem
  - Evidência: '🆕 upload novo — vai regenerar do zero via image-to-3D (texto será ignorado)' (src/components/Chat.tsx:440): no fluxo paramétrico comum a imagem vira logo e o texto dirige o design (generate/route.ts + parse.ts); image-to-3D só acontece se o LLM emitir freeform com sourceImageUrl. '↻ imagem de referência — seu texto modifica via text-to-3D' tem o mesmo problema.
  - Correção sugerida: Copy neutra e verdadeira: 'imagem anexada — será usada como logo ou referência de cores' / distinguir só quando o design resultante for freeform.
- **[Backend/confiabilidade]** Cliente exibe o envelope JSON cru dos erros da API em vez da mensagem PT-BR que o servidor preparou
  - Evidência: Chat.tsx:205 `throw new Error(\`API ${res.status}: ${await res.text()}\`)` → :241 renderiza 'Erro: API 500: {"error":{"code":"design_parse_failed","message":"..."}}' no chat. Mesmo padrão em SliceButton.tsx:75 e ProjectWorkspace.tsx:436. O apiError (api-error.ts:9-16) já entrega message user-safe que nunca chega limpa ao usuário.
  - Correção sugerida: Helper único no cliente: parsear res.json(), exibir error.message quando presente, fallback genérico caso contrário. 3 call sites.
- **[Backend/confiabilidade]** IA não configurada/offline vira 500 'design_parse_failed' genérico; a mensagem acionável NO_CREDS é engolida e não existe health-check de IA análogo ao do slicer
  - Evidência: model.ts:34-42 lança NO_CREDS ('Nenhum modelo de IA configurado. Defina o Provider... em Configurações') → capturado em generate/route.ts:337-342 que responde 500 + 'Não foi possível interpretar o pedido.' — o texto útil vai só pro log/DB row. Slicer tem probe proativo (/api/slicer-health), IA não tem.
  - Correção sugerida: Detectar o erro NO_CREDS (classe/código dedicado) e responder 503 'ai_unconfigured' com a mensagem acionável; opcional: /api/ai-health p/ avisar no Studio antes do submit.
- **[Backend/confiabilidade]** Flexify: persistMesh + finalização fora do try/catch — falha de persistência deixa iteração presa em 'generating' e retorna 500 cru (não-apiError)
  - Evidência: flexify/route.ts:160-172: `const meshUrlOut = await persistMesh(...)` e os dois db.update ficam DEPOIS do catch (linhas 151-158). Um throw ali não marca status:'failed' nem devolve o envelope. Cleanup depende do reaper, que só roda em POST /api/generate (única call site).
  - Correção sugerida: Envolver persistMesh+updates num try/catch espelhando o tail-guard do generate (generate/route.ts:409-460).
- **[Backend/confiabilidade]** Generate freeform: chamada Meshy sem try/catch — falha de REDE (não-HTTP) lança, deixa row 'generating' presa e responde 500 genérico em vez do 502 'meshy_failed'
  - Evidência: generate/route.ts:359-361: `const meshy = design.sourceImageUrl ? await generateMeshFromImage(...) : await generateMesh(...)` fora de try. meshy/client.ts trata status HTTP ({ok:false}, linhas 51,75,105) mas um fetch rejeitado (ECONNREFUSED/DNS) propaga a exceção.
  - Correção sugerida: try/catch em volta da chamada Meshy que marca a iteração 'failed' e retorna apiError(502,'meshy_failed'), igual ao branch !meshy.ok (linhas 362-368).
- **[Backend/confiabilidade]** Cada POST /api/generate carrega o histórico COMPLETO do projeto com todas as colunas, incluindo jsonb multi-MB (_previews base64 duplicados por iteração importada) — latência e memória crescem linear com o histórico a cada interação
  - Evidência: generate/route.ts:81-85 `db.select().from(iterations).where(projectId)` sem projeção de colunas nem limit; route.ts:414-421 grava `_previews: importContext.previewDataUrls` (cap 4×8MB, body-schema.ts:13) no validationReport de CADA iteração importada — N paints/logos = N cópias do bundle, todas lidas de novo a cada generate.
  - Correção sugerida: Projeção de colunas leves no SELECT do histórico + query separada apenas da última row com validationReport necessário; gravar _previews uma vez (na primeira import) e referenciar por iterationId.
- **[Fluxos live]** Botões '🎨 Pintar cores' e '📍 Logo aqui' ficam cobertos pelo fieldset 'Posição do logo (teclado)' — inclicáveis por mouse
  - Evidência: elementFromPoint no centro do botão (rect x=531 y=62 w=122 h=44, viewport 1496×725) retorna 'FIELDSET Posição do logo (teclado)…'; isButtonOnTop=false. Só ativei paint mode via JS .click().
  - Correção sugerida: Reposicionar o fieldset flutuante (ou z-index/fluxo em coluna) para não sobrepor a segunda linha de botões do viewer.
- **[Fluxos live]** Painéis flutuantes se sobrepõem: resultado do slice cobre 'Fatiar para impressão' e 'Cores de Impressão'; toolbar de pintura cobre 'Aplicar posição'
  - Evidência: Screenshots em viewport 1496px: painel 'Tempo de impressão…' renderiza sobre o painel Cores; botão 'Fatiar para impressão' sobrepõe o swatch da Cor 2; toolbar 'Pintura manual' esconde o botão laranja 'Aplicar posição'.
  - Correção sugerida: Empilhar os painéis do canto do viewer num único container flex/coluna com espaçamento em vez de posições absolutas independentes.
- **[Fluxos live]** Status do chat diz 'Pronto' enquanto o viewer exibe erro técnico 'Erro: Error: Mesh fetch 404' — contraditório e sem ação
  - Evidência: Snapshot pós-reload do projeto 43563d5f: chat 'Pronto' + badge PARAMÉTRICO; viewer alert 'Erro: Error: Mesh fetch 404'; nenhum botão de retry/download renderizado.
  - Correção sugerida: Propagar falha de carregamento da malha para o estado do chat, mensagem em PT acionável ('não conseguimos carregar a peça — tentar de novo') com botão de retry.
- **[Fluxos live]** Pintura manual não persiste no servidor — reload perde todo o trabalho; único caminho é exportar o 3MF na hora
  - Evidência: Copy da própria UI: 'Pintura local — ainda não salva no servidor (evita crash).' Estado pintado vive só em paintMeshRef no browser (src/components/ProjectWorkspace.tsx:220,491).
  - Correção sugerida: Persistir o paint-bin por iteração (endpoint /api/paint já existe na árvore) ou ao menos avisar antes de sair da página com pintura dirty.
- **[Fluxos live]** Pincelada sem nenhuma confirmação visual quando pinta região já da mesma cor ou área encoberta — usuário não sabe se pintou
  - Evidência: 3 cliques de pincel (Cor 2/B) em pontos do modelo sem qualquer mudança visível nem indicador de stroke; só com Cor 1 (A) a mudança apareceu — junto com um salto de câmera.
  - Correção sugerida: Mostrar marcador do hit + contagem de faces pintadas (toast 'x faces → cor B'), e não re-enquadrar a câmera após pintura (fitKey não deveria mudar em repaint).
- **[UX live]** Não existe renomear nem excluir projeto; cards sem preview real — a lista degrada em 13 'Projeto sem título' com thumbnail idêntico em 2 páginas
  - Evidência: Zero matches para Excluir/Renomear/Deletar em src/app/page.tsx e ProjectWorkspace.tsx; nenhuma rota DELETE em src/app/api; snapshot da home: 13 de 20 cards 'Projeto sem título', todos com o mesmo cubo azul.
  - Correção sugerida: Auto-nomear o projeto com o 1º prompt do chat; menu de card (renomear/excluir) + thumbnail do último render.
- **[UX live]** Disclosure 'COMO INTERPRETAMOS SEU PEDIDO' expande para JSON cru da API em vez de resumo humano
  - Evidência: Ao expandir no projeto fb03224b: '{"kind":"imported","edits":[{"op":"paint_region","region":"upper_half","extruder":"B"}],"baseMeshUrl":"/uploads/b3b72d92....3mf"}' renderizado como texto ao usuário; título já vaza enum 'UPPER_HALF→B'.
  - Correção sugerida: Renderizar os edits como frases PT-BR ('Metade superior pintada com a cor 2'); manter JSON só atrás de um modo dev.
- **[UX live]** Inglês misturado nas ações principais do estúdio e tooltips 100% em inglês
  - Evidência: 'Download 3MF (Multi-Color)', '🦴 Make it flexi', tooltips 'Download raw 3MF for your own slicer' e 'Turn this mesh into an articulated, print-in-place toy (~1-20s)' (snapshot a11y do estúdio); erro 'Erro: Error: Mesh fetch 404' (ProjectWorkspace.tsx:881 prefixa 'Erro:' numa string que já começa com 'Error:').
  - Correção sugerida: Passar strings do viewer para PT-BR e normalizar mensagens de erro (strip 'Error:' + traduzir).
- **[Performance live]** Malhas criadas depois do build retornam 404 no build de produção — recarregar um projeto novo quebra o viewer ('Error: Mesh fetch 404')
  - Evidência: GET http://localhost:3001/meshes/be561ad0-5b7d-48ad-bc60-74a48a6f16bc.stl → 404, mas o arquivo existe em public/meshes/ (38084 bytes, mtime 21/jul 22:52) — .next/BUILD_ID é de 22:25. Malha anterior ao build (52499d53...stl) → 200. Reprodução: gerar peça, recarregar a página do projeto. Causa: src/lib/storage/persist.ts:35-38 grava em public/meshes/ em runtime, mas `next start` só serve o snapshot de public/ do momento do build.
  - Correção sugerida: Servir malhas via route handler (ex.: app/meshes/[file]/route.ts lendo do disco com stream) em vez de estático do public/, ou mover storage local pra fora de public/ atrás de uma rota — o path do Vercel blob (prod) não é afetado.
- **[Performance live]** Abrir um projeto pintado transfere 49.4MB (malha .bin de 50MB sem compressão nem formato compacto)
  - Evidência: Waterfall do projeto 70a239e8: /meshes/f3769fd3-bf55-40a8-ae0a-278db8b926db.bin com transferSize 50.171.646 ≈ decodedBodySize 50.171.346 (sem content-encoding; probe com Accept-Encoding: gzip devolve corpo integral). gzip -c do arquivo → 14.150.406 bytes (3.5×). Em localhost baixa em 188ms; a 50Mbps reais seriam ~8s por abertura. O .bin pintado (50MB) é ~3× o 3MF do mesmo modelo (17MB, d9cf5c8c).
  - Correção sugerida: Comprimir a resposta (gzip/br) pros formatos de malha e/ou gravar o paint-bin comprimido; avaliar quantização/meshopt. Ganho imediato de 3.5× só com gzip.

## P2 (25)

- **[Performance (código)]** Captura de previews usa delay fixo de 500ms + 4 renders/toDataURL síncronos
  - Evidência: ProjectWorkspace.tsx:268-280 (setTimeout 500) e MeshViewer.tsx:147-162; atraso artificial de meio segundo no fluxo de import antes de liberar o envio.
  - Correção sugerida: Capturar num requestAnimationFrame após o primeiro frame renderizado (onAfterRender/useFrame once) em vez de timer.
- **[Performance (código)]** Canvas R3F inteiro re-renderiza a cada tick do slider de raio de pintura (MeshViewer sem memo + onPick inline)
  - Evidência: ProjectWorkspace.tsx:727-731 (setPaintRadiusMm por onChange) + :595-612 (onPick arrow recriada); geometries useMemo segura o rebuild caro, mas a árvore R3F reconcilia a cada tick.
  - Correção sugerida: React.memo no MeshViewer + useCallback no onPick (raio não é prop do viewer, o re-render é puro desperdício).
- **[Performance (código)]** page.tsx do estúdio faz 4 awaits sequenciais no servidor
  - Evidência: src/app/projects/[id]/page.tsx:39-60 — auth → project → history → resolveConfig; history e resolveConfig são independentes.
  - Correção sugerida: Promise.all([historyQuery, resolveConfig()]) após validar o project.
- **[Coerência de produto]** Mistura PT/EN nos controles principais do viewer
  - Evidência: 'Download STL' / 'Download 3MF (Multi-Color)' + tooltip EN (src/components/DownloadStlButton.tsx:38-40); '🦴 Make it flexi' / 'Flexifying… (~1-20s)' + tooltip EN (FlexifyButton.tsx:75-77); bolhas do usuário '(image only)' e 'edited design directly' (Chat.tsx:180,389).
  - Correção sugerida: Traduzir: 'Baixar STL', 'Baixar 3MF (multi-cor)', 'Articular (flexi)', '(só imagem)', 'parâmetros editados manualmente'.
- **[Coerência de produto]** Três vocabulários pra o mesmo conceito de cor/extrusora
  - Evidência: 'Cor 1 (A)'/'Cor 2 (B)' no painel de pintura (ProjectWorkspace.tsx:707-720), 'Cor da Base (A)'/'Cor 2 / Logo (B)' nos pickers (852-865), 'Cor do corpo'/'Cor do detalhe/logo' no Settings (settings/page.tsx:177-187); 'extrusora' só em aria-labels.
  - Correção sugerida: Padronizar em 'Cor 1 (corpo)' / 'Cor 2 (detalhe)' em todas as superfícies.
- **[Coerência de produto]** Hint referencia botão que não existe ('Pintar cor 2' vs 'Pintar cores')
  - Evidência: src/components/ProjectWorkspace.tsx:868 ('Ou use 🎨 Pintar cor 2 no modelo') vs rótulo real na linha 659 ('🎨 Pintar cores').
  - Correção sugerida: Alinhar o hint ao rótulo real do botão.
- **[Coerência de produto]** Rótulos de resultado divergem entre sessão ao vivo e reload; resultLabel só cobre 4 dos 11 kinds
  - Evidência: LABEL_BY_KIND cobre só hollow_cylinder/flat_plate/disc/box (src/lib/chat/result-label.ts:6-11) — mug/pin/bookmark/custom_keychain/composite/imported/freeform viram 'Modelo gerado'; após reload o mesmo item vira 'Pronto'/'Modelo paramétrico gerado' (ProjectWorkspace.tsx:147-164).
  - Correção sugerida: Completar LABEL_BY_KIND e reusar resultLabel no mapHistoryToMessages (kind está no validationReport).
- **[Coerência de produto]** paintPlacement é caminho morto na API do generate — nenhum cliente envia
  - Evidência: Implementado em body-schema.ts:43 + generate/route.ts:238-275; grep em src/components não acha nenhum remetente (o paint roda 100% client-side no worker).
  - Correção sugerida: Remover o branch ou documentá-lo como API futura de persistência de pintura (que resolveria o issue paint-vs-slice).
- **[Coerência de produto]** Painel 'Cores de Impressão' e botão 'Fatiar para impressão' disputam o mesmo canto direito do viewer
  - Evidência: Painel em top-4 right-4 com ~200px de altura (ProjectWorkspace.tsx:841) e SliceButton em top-[4.5rem] right-4 (SliceButton.tsx:110), ambos z-10 — sobreposição provável quando mesh+stl presentes. Confirmar no teste live.
  - Correção sugerida: Empilhar num único container flex à direita, como já é feito à esquerda.
- **[Coerência de produto]** Banner '.3mf carregado — aguardando previews…' pode ficar preso pra sempre se a captura falhar
  - Evidência: Falha de capturePreviews só faz console.error (ProjectWorkspace.tsx:268-280); o banner (Chat.tsx:414-423) nunca sai do estado 'aguardando', embora o envio funcione com stub previews no servidor (generate/route.ts:187-194).
  - Correção sugerida: Timeout no estado do banner ('pode enviar mesmo assim') ou setar pendingPreviews com stub no cliente após falha.
- **[Coerência de produto]** Usuário não-admin não vê nem sabe que existem configurações de impressora/cores que afetam o 3MF dele
  - Evidência: Gear só pra admin (src/app/page.tsx:66-74); settings redirect não-admin (settings/page.tsx:19); o hint pós-export 'abre no Bambu Studio já com perfil de impressão' depende dessa config invisível (ProjectWorkspace.tsx:557-561).
  - Correção sugerida: Mostrar read-only no workspace qual impressora/perfil está ativo ('Perfil: Bambu H2D 0.4 · configurado pelo admin').
- **[Backend/confiabilidade]** Body JSON inválido derruba a rota com 500 (SyntaxError não tratado) em vez de 400 'invalid_body'
  - Evidência: generate/route.ts:60, slice/route.ts:27 e flexify/route.ts:91 fazem `Body.safeParse(await req.json())` sem try no req.json(); upload/route.ts:26 idem com req.formData().
  - Correção sugerida: Helper `safeJson(req)` que captura o throw e devolve apiError(400,'invalid_body').
- **[Backend/confiabilidade]** Reaper sem cron: só dispara quando alguém faz POST /api/generate — rows presas de flexify podem ficar 'generating' indefinidamente
  - Evidência: grep: reapStuckIterations tem 1 única call site (generate/route.ts:58); sem vercel.json, sem cron em package.json. O próprio comentário admite 'A cron job can call reapStuckIterations() directly too' mas nenhum existe.
  - Correção sugerida: Chamar o reaper também em flexify e slice (best-effort), ou expor rota /api/cron/reap com agendamento.
- **[Backend/confiabilidade]** STL vai pro slicer como base64 dentro de JSON: +33% de bytes e string de ~47MB em memória para malha de 700k tris
  - Evidência: slicer/client.ts:95 `Buffer.from(stl).toString('base64')` + JSON.stringify; comentário nas linhas 91-93 confirma 'tens-of-MB upload' e 1-2 min de slice. Comentário das linhas 86-88 está stale (fala 120s/180s; real é 280s/300s).
  - Correção sugerida: multipart/form-data ou application/octet-stream no serviço slicer; atualizar o comentário.
- **[Backend/confiabilidade]** Slice local-dev (sem BLOB token) devolve o 3MF inteiro como inline_base64 num JSON — até ~67MB serializados e atob no cliente
  - Evidência: slice/route.ts:106-112 + :126 `inline_base64: slicedUrl ? null : Buffer.from(result.bytes).toString('base64')`; SliceButton.tsx:91-95 decodifica com atob byte a byte.
  - Correção sugerida: Persistir em public/ como o persistMesh já faz (persist.ts:35-38) e devolver URL também no caminho local.
- **[Backend/confiabilidade]** Health probe do slicer roda uma única vez por mesh — se o slicer voltar ao ar, o botão Fatiar continua desabilitado até recarregar/regenerar
  - Evidência: SliceButton.tsx:36-60 useEffect com deps [iterationId, stl]; slicerOk===false trava disabled (linha 113) sem re-check nem botão 'tentar de novo'.
  - Correção sugerida: Re-probe com backoff enquanto slicerOk===false, ou o aviso âmbar virar botão de re-checagem.
- **[Fluxos live]** Câmera re-enquadra e salta de ângulo após cada pincelada; e no load inicial o modelo aparece cortado/gigante
  - Evidência: Screenshot pós-pincelada mostra cena reposicionada (gizmo girado, modelo visto de outro ângulo); no load, a peça extrapola o viewport (screenshots do projeto fb03224b).
  - Correção sugerida: Não disparar FitCameraToObject quando positions muda por pintura; ajustar fit inicial com margem (zoom-out ~20%).
- **[Fluxos live]** 16 de 20 projetos aparecem como 'Projeto sem título' — lista irreconhecível
  - Evidência: Snapshot da home: 16 links 'Projeto sem título', só 4 com nome real.
  - Correção sugerida: Auto-titular projeto com o primeiro prompt (truncado) quando o usuário não define título.
- **[Fluxos live]** Arquivos baixados nomeados por UUID em vez do nome do projeto
  - Evidência: Downloads gerados: 'dfbaac3c-38e5-41ad-aa38-c7b3cc65c0c4.3mf' e 'fb03224b-painted.3mf' (~/Downloads, 22:54/22:57).
  - Correção sugerida: Usar slug do título do projeto no atributo download do anchor.
- **[Fluxos live]** Warnings recorrentes: THREE.Clock deprecado + campo de formulário sem id/name (issue de a11y/autofill) em toda página de projeto
  - Evidência: Console em fb03224b e 43563d5f: '[warn] THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' e '[issue] A form field element should have an id or name attribute (count: 3)'.
  - Correção sugerida: Migrar para THREE.Timer (ou atualizar drei); adicionar id/name aos inputs do chat e spinbuttons do logo.
- **[UX live]** Skeleton do estúdio é claro sobre página escura (flash branco→dark) e o da home não corresponde ao layout final
  - Evidência: src/app/projects/[id]/loading.tsx usa bg-gray-200/gray-100/gray-50 enquanto o estúdio é studio-dark; src/app/loading.tsx é lista max-w-3xl h-16 vs grid real de cards 3 colunas.
  - Correção sugerida: Skeleton do estúdio com tokens dark; skeleton da home em grid de cards.
- **[UX live]** Erro de envio recarrega a página e apaga o e-mail digitado; campo sem label visível
  - Evidência: Submissão com e-mail não autorizado → redirect ?error=EnvioFalhou, textbox volta vazio (snapshot pós-erro); único rótulo visível é o placeholder 'voce@exemplo.com'.
  - Correção sugerida: Preservar o valor no redirect (query/param) ou submeter via fetch; adicionar label visível.
- **[UX live]** Painel 'Posição do logo' aparece sem logo ativo com spinners de range zero, e texto auxiliar de 10px
  - Evidência: Spinbuttons X/Y com valuemin=0/valuemax=0 (a11y snapshot); 'Melhor: anexe o render de cores...' com fontSize computado 10px.
  - Correção sugerida: Mostrar o painel só com logo ativo; mínimo 12px para texto auxiliar.
- **[Performance live]** /meshes/* e /uploads/* com Cache-Control: public, max-age=0 apesar de URLs imutáveis por UUID — revalidação (304) a cada abertura
  - Evidência: curl -I /meshes/f3769fd3...bin → 'Cache-Control: public, max-age=0' + ETag fraco; warm reload gera conditional GET (304, 300 bytes). URLs incluem o UUID da iteração e nunca mudam de conteúdo.
  - Correção sugerida: max-age longo + immutable para /meshes e /uploads (conteúdo é content-addressed por iteração).
- **[Performance live]** public/meshes acumula 5.5GB em 899 arquivos (iterações antigas nunca coletadas) e o histórico de chat com 140+ iterações é renderizado inteiro no DOM (sem virtualização)
  - Evidência: du -sh public/meshes → 5.5G, 899 arquivos. Projeto 70a239e8: snapshot a11y com ~550 nós só de histórico de chat (140+ entradas 'pintar radius/fill...' idênticas). Sem long task >89ms medida no hardware atual, mas o custo de hidratação/DOM cresce linear com o histórico.
  - Correção sugerida: GC de malhas órfãs (já existe src/lib/storage/orphans.ts — agendar/executar) e virtualizar/paginar o histórico do chat.

## Verificação adversarial (8/8 confirmados)

- **CONFIRMED** — CONFIRMADO (re-medido do zero em cbb5edc). Causa-raiz: 6 arquivos de rota da API retornam o envelope `apiError()` com mensagens PT-BR prontas pra exibir (src/lib/http/api-error.ts:9-16; ex.: src/app/api/slice/route.ts:97 'O fatiador está indisponível no momento.', src/app/api/generate/route.ts:342 'Não foi possível interpretar o pedido.'), mas NENHUM display site do client parseia o envelope — todos concatenam `await res.text()` cru. 4 pontos exatos: (1) src/components/Chat.tsx:205 `throw new Error(\`API ${res.status}: ${await res.text()}\`)` exibido verbatim em Chat.tsx:241 como bolha de assistant `Erro: API 500: {"error":{"code":"design_parse_failed","message":"..."}}`; (2) Chat.tsx:161 mesmo padrão pro upload (`Upload 413: {...}`); (3) src/components/SliceButton.tsx:75 `throw new Error(await res.text())` → setError em :78 renderiza o JSON cru no banner (:129-131), ex. `{"error":{"code":"slicer_unavailable",...}}`; (4) src/components/ProjectWorkspace.tsx:436 idem, agravado por `setError(String(e))` em :455 que ainda prefixa 'Error: ' → banner mostra `Error: API 409: {"error":...}`. O comentário do próprio envelope (api-error.ts:4-5) diz que clients 'may show error.message' — a intenção existia e o client nunca a implementou. P1 mantido; a evidência original citava 3 sites, são 4 (Chat.tsx:161 também). Fix hint do auditor é o correto.
- **CONFIRMED** — CONFIRMADO com causa-raiz exata e cadeia completa: (1) src/app/api/slice/route.ts:114-122 — o slice faz UPDATE na MESMA row da iteração e seta status:'sliced' (linha 120), mas NÃO apaga validationReport (só seta slicedBlobUrl/slicedMeta/slicedAt/status) — ou seja, o design estruturado continua no banco; só o filtro de status o perde. (2) src/app/api/generate/route.ts:223-225 — lastReadyWithDesign = [...history].reverse().find(h => h.status === 'ready' && h.validationReport) exclui 'sliced'; num projeto com 1 design fatiado, previousDesign (linha 228) = null. (3) Consequência dupla: src/lib/design/quick-modifier.ts:24 — tryQuickModify começa com `if (!prev) return null`, então 'logo maior'/'aumenta' NUNCA casa o caminho determinístico após slice; cai no parseDesign LLM (route.ts:320-326) com previousDesign:null — o LLM re-deriva só do texto do histórico (allMessages, linha 232), não do Design estruturado — não-determinístico e pode divergir do que estava na tela. Se houver rows 'ready' mais antigas, pega silenciosamente um design STALE. (4) Prova de inconsistência interna (causa-raiz = omissão, não decisão): o MESMO arquivo já corrigiu esse exato bug para o caminho de paint — route.ts:248-258 inclui (h.status === 'ready' || h.status === 'sliced') com comentário literal "'sliced' is mesh-backed too (POST /api/slice flips 'ready' → 'sliced' while keeping meshBlobUrl) — skipping it would discard prior paint". (5) Enum confirma 'sliced' como estado terminal válido: src/db/schema.ts:98 enum ['generating','ready','failed','sliced']. Fix de 1 linha: incluir 'sliced' no predicado da linha 225. P1 mantido.
- **CONFIRMED** — bodyColor/logoColor (ProjectWorkspace.tsx:217-218) têm exatamente 4 consumidores no src/: props do MeshViewer (600-601) e os inputs do painel (847, 858); em MeshViewer.tsx:257 viram só cor de material three.js — nenhuma chamada de rede, nenhuma persistência. exportPainted3mf usa exclusivamente printConfig (ProjectWorkspace.tsx:536-546 → serialize3mf colors aHex/bHex), com fallback pra EXTRUDER_COLOURS hardcoded (serialize-3mf.ts:144-145). Causa-raiz: printConfig vem do server em projects/[id]/page.tsx:61-65 via resolveConfig() (Settings singleton filamentColorBody/filamentColorAccent), que é admin-gated (commit f135146) — logo usuário não-admin NÃO tem nenhuma UI pra mudar a cor real do 3MF, enquanto o painel "Cores de Impressão" (linha 842) promete exatamente isso. Agravante: os pickers são semeados do _paintPalette persistido (generate/route.ts:420,424 → ProjectWorkspace.tsx:215-218), então após pintar-com-imagem o painel COINCIDE com a impressão, reforçando a ilusão de controle — mas edições do usuário nunca fluem pro export. P1 mantido.
- **CONFIRMED** — CONFIRMADO com escopo corrigido (P1 mantém). Causa-raiz: o catálogo de 8 ops de malha importada existe SOMENTE dentro do system prompt do LLM (src/lib/design/parse-import.ts:159-176 — scale, hole, add_logo, emboss_text, paint_region, paint_from_image, paint_brush, jscad_raw), uma string server-side jamais renderizada ao usuário. Superfícies verificadas: (a) os 4 chips EXAMPLE_PROMPTS são todos paramétricos (src/components/Chat.tsx:8-13) e são um const estático mostrado só quando messages.length===0, sem qualquer contextualização por pendingMeshUrl — quem sobe um .3mf num projeto vazio vê sugestões que não se aplicam à malha; (b) placeholder do composer é paramétrico (Chat.tsx:496); (c) o banner pós-upload .3mf diz apenas '.3mf carregado — pode enviar uma mensagem' sem listar nenhum comando (Chat.tsx:414-423); (d) grep em src/components/*.tsx por hole/emboss_text/scale/jscad: ZERO menções em UI — nenhum botão, hint ou ajuda. CORREÇÃO ao achado original: pintura e logo TÊM UI direta quando há base importada — '📍 Logo aqui' (ProjectWorkspace.tsx:643), '🎨 Pintar cores' com balde/pincel/extrusor/raio (ProjectWorkspace.tsx:645-753) e posicionamento de logo por teclado (linha 757+) — portanto 'regiões de pintura' deve sair do sumário. Placar exato: das 8 ops, 4 têm superfície de UI (add_logo, paint_brush, paint_from_image via imagem anexada, paint_region coberta funcionalmente pelo balde) e 4 são adivinháveis apenas por frase no chat: hole, emboss_text, scale, jscad_raw. Sumário sugerido: 'Furo, texto em relevo, escala e jscad em malha importada só existem se o usuário adivinhar a frase — o catálogo de ops vive só no system prompt'.
- **CONFIRMED** — Confirmado em cbb5edc com causa-raiz mais funda: (1) pintura é 100% client-side por design — src/components/ProjectWorkspace.tsx:461-464 ("The Next server is NEVER called on click") e hint na linha 495 "Pintura local — ainda não salva no servidor"; (2) paintDirty (linha 369) tem exatamente 1 consumidor — linha 736, só pra exibir "Exportar 3MF multi-cor" — e NÃO é passado ao SliceButton (linha 873 recebe só iterationId+stl); (3) SliceButton.tsx:70-74 POSTa só {iterationId} e src/app/api/slice/route.ts:47-59 fatia a malha persistida no servidor; (4) CAUSA-RAIZ ARQUITETURAL DUPLA: src/app/api/paint/route.ts:1-17 é tombstone deliberado retornando 410 "paint_client_only" (persistência removida por OOM em malhas 1M+ tris), e mesmo cor persistida seria descartada — /api/slice/route.ts:66-79 achata multi-body para STL single-material antes de fatiar ("Slicing is single-material anyway (multi-colour is the separate Download-3MF path)", linha 69); (5) zero aviso conecta os fluxos: os únicos avisos do SliceButton são slicer-offline (124-127) e malha-pesada (121), e os dois painéis ficam visíveis simultaneamente na tela (paint top-left z-20, slice top-right z-10). Resultado: pintar → Fatiar → 3MF monocolor, silenciosamente. P1 correto; fix_hint do auditor (gate/aviso quando paintDirty) é viável só com prop-drill de paintDirty pro SliceButton — a persistência opcional sugerida esbarra no motivo do tombstone (OOM) e no flatten single-material do slice.
- **CONFIRMED** — CONFIRMADO em cbb5edc (working tree limpo vs HEAD), e a re-medição achou 2 agravantes além do que o auditor registrou.

Os 3 caminhos, re-medidos:
(1) src/components/ProjectWorkspace.tsx:614 — DownloadStlButton no overlay top-left; baixa a prop `stl` = bytes persistidos no servidor (setStl só é chamado nas linhas 235/249/299/329/347, todas em fluxos de generate/import/logo — NUNCA no paint).
(2) ProjectWorkspace.tsx:873 + SliceButton.tsx:148 — 'Fatiar para impressão' (overlay top-right) → 'Baixar 3MF fatiado (perfil genérico — pré-visualização)'. O route src/app/api/slice/route.ts:73-84 detecta zip (magic 0x50 0x4b), roda flattenMeshForSlice (A∪B via Manifold) e re-serializa como STL binário mono; o comentário nas linhas 66-70 ADMITE a decisão: 'Slicing is single-material anyway (multi-colour is the separate Download-3MF path)'. O tipo SliceResponse (SliceButton.tsx:9) não tem campo de aviso e a UI só mostra tempo/filamento — flatten 2-cores→mono é 100% silencioso; a única pista é '(perfil genérico)' no label, que não menciona cor.
(3) ProjectWorkspace.tsx:736-745 — 'Exportar 3MF multi-cor', o ÚNICO export que embute perfil de impressora (getPrinter/buildProjectSettings/planStandingOrientation, linhas 514-546, com projectSettings do modelo configurado + orientação em pé), está aninhado DENTRO do painel `paintMode && positions` (linha 664) E gated por `paintDirty` (linha 736).

Agravante A (causa-raiz do gate): clicar '🎨 Parar de pintar' (linha 659) desmonta o painel inteiro — o único export com perfil de impressora DESAPARECE da tela mesmo com paintMeshRef ainda segurando a malha pintada. E uma peça 2-cores vinda do fluxo de logo que não foi pintada nesta sessão NUNCA vê esse botão (paintDirty só vira true em applyPaintBrush, linha 494).

Agravante B (incoerência entre caminhos após pintar): depois de pintar, 2 dos 3 exports entregam a malha SEM a pintura em silêncio — o DownloadStlButton rotulado 'Download 3MF (Multi-Color)' (DownloadStlButton.tsx:40) baixa os bytes pré-paint do servidor, e o slice re-busca meshBlobUrl (route.ts:49-63), que nunca recebe o paint (exportPainted3mf é download puro no browser, linhas 544-556; comentário na linha 462-464: 'The Next server is NEVER called on click'). Rótulo promete multi-color, arquivo entrega o estado antigo.

P1 mantido; a dedução do auditor está, se algo, conservadora — são 3 superfícies espalhadas em 2 cantos do viewer, sem menu único, com o melhor export escondido atrás de um modo transiente e dois exports que mentem sobre cor após o paint.
- **CONFIRMED** — Confirmado com causa-raiz mais profunda que o achado original — são 5 elos independentes, todos one-way: (1) ProjectWorkspace.tsx:207/288 — setPendingMeshUrl só é chamado com URL (linha 288), nunca com null (0 ocorrências no arquivo); pior: Chat.tsx:200 reenvia `meshUrl: pendingMeshUrl ?? undefined` em TODA mensagem subsequente, re-afirmando o import como upload fresco. (2) Chat.tsx:414-423 — banner tem só 2 <span>, nenhum botão/dismiss. (3) route.ts:172-179 — `[...history].reverse().find(vr?.kind==='imported')` varre TODO o histórico do projeto e ressuscita effectiveMeshUrl mesmo sem meshUrl fresco, logo nem reload da página escapa (estado do cliente some, servidor recupera do banco). (4) parse.ts:42-51 — `if (input.importContext) return parseImportEdit(...)` incondicional; a cláusula de escape do prompt paramétrico ('COMPLETELY DIFFERENT object → start fresh', parse.ts:163) fica no branch inalcançável. (5) parse-import.ts:155 (SYSTEM 'Always emit a JSON object with kind=imported') + linha 84 (user prompt) + linha 117 (repair re-ask) hard-codam kind='imported' — 'um cubo de 30mm' vira edit na malha importada. Nuance: Design.safeParse (parse-import.ts:144) valida a union inteira, então um LLM desobediente PODERIA devolver kind='box', mas é sorte, não saída projetada — e pelo elo 3 a mensagem seguinte reentra no modo importado de qualquer jeito. body-schema.ts:15-50 não tem nenhuma flag de saída. Única fuga real: criar projeto novo. P1 mantido (forte: a armadilha sobrevive a reload e é permanente por projeto).
- **CONFIRMED** — CONFIRMADO com evidência mais afiada (tudo medido em cbb5edc via git show; HEAD == cbb5edc):

1) Gate da UI — src/components/ProjectWorkspace.tsx:621 `{positions && importedBaseAvailable && (` esconde AMBOS os botões "📍 Logo aqui" (linha 643) e "🎨 Pintar cores" (linha 659). `importedBaseAvailable = hasImportedBase(initialHistory, pendingMeshUrl)` (linha 358); `hasImportedBase` (linhas 59-68) só retorna true com pendingMeshUrl (upload .3mf fresco) ou história com `validationReport.kind === 'imported'`. Iteração freeform persiste `kind:'freeform'` (o finalize em src/app/api/generate/route.ts:414-425 faz spread do design; Design.kind é literal 'freeform' em src/lib/design/schema.ts:384) → num projeto só-Meshy os botões nunca renderizam.

2) O paint client-side FUNCIONARIA na malha freeform: o mesh carrega via `runInWorker({type:'stl'})` e seta `bodies` (ProjectWorkspace.tsx:241-252, comentário na linha 241 admite "covers generative, imported, freeform, flexified"), e `applyPaintBrush` (linha 466) só exige `bodies.length > 0` — roda 100% no worker do browser (banner: "Roda no seu PC — o server não processa"). Ou seja: capacidade existe, só o gate esconde.

3) Chat sem rota: src/app/api/generate/route.ts:172-176 — `lastImported` filtra `vr?.kind === 'imported' && !!vr.baseMeshUrl`; linha freeform falha nos dois (kind errado E sem campo baseMeshUrl). effectiveMeshUrl fica null → importContext undefined → parse.ts:42 só despacha pro prompt de edição importada (onde vivem paint_region/paint_from_image/add_logo) quando importContext existe. "Pintar o capacete" num personagem Meshy cai no prompt paramétrico → re-gera do zero ou colapsa num primitivo.

4) CAUSA-RAIZ mais funda que o fix_hint: o Meshy é persistido como STL binário (src/lib/meshy/client.ts:91-92 e 164-165, `objToBinarySTL`), e `loadBaseMeshFromUrl` só parseia 3MF/paint-bin (src/lib/import/load-base-mesh.ts:29-32, `parse3mf`). Logo o fix_hint "tratar meshBlobUrl de freeform como base importável no route" quebraria no parse — precisa também de conversão STL→3MF (ou suporte a STL no load-base-mesh). Já o fix da UI (habilitar paintMode pra qualquer malha com bodies) é trivial e independente: mover os dois botões pra fora do gate `importedBaseAvailable` (paint) e manter só "Logo aqui" atrás dele.

Severidade P1 mantida: feature inteira (pintura + logo) inacessível pra toda malha Meshy, sem workaround na UI e sem rota no chat; não há perda de dados (não é P0).
## Não mensurável hoje
- Geração paramétrica e2e cronometrada de ponta a ponta no primeiro run (corrida de driver de navegador — a 2ª geração foi cronometrada: ~10 s até resposta; malha nunca apareceu pelo P0 do 404).
- Freeform/Meshy e2e (sem créditos Meshy).
- Fluxo de e-mail real de login (test-login usado).

## Timings medidos (build de produção)
- Login → home logada: 5,0 s (page load pós-redirect 0,04 s) · Home 20 projetos: SSR imediato
- Abrir projeto existente → malha visível: ~3 s (cold, malha 50 MB: canvas em 0,35 s; warm: 0,08 s, 304)
- Geração IA: ~10 s até resposta do chat · Fatiar: ~10,5 s até estimativas · Export 3MF pintado: <3 s
- Viewer: rotação ~120 fps (pior frame 82 ms) · pintura em worker: zero frames >200 ms · LCP 0,17 s · CLS 0

## Limpeza / artefatos da auditoria
- Projetos criados (podem ser excluídos à mão — app não tem delete): `1d9861df` ("Auditoria flow-tester — chaveiro 40mm"), `43563d5f` ("Auditoria v2 — chaveiro flow-tester"), `8fd48610` ("Auditoria UX — projeto vazio")
- Downloads locais: `~/Downloads/dfbaac3c-….3mf`, `~/Downloads/fb03224b-painted.3mf`
- Infra: build de produção em :3001 foi derrubado ao fim; dev :3000 permanece; settings do admin restauradas pelo flow-tester
