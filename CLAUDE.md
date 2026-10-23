# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este diretório

Não é o código-fonte do Navidrome: é o **pacote de deploy** do Guitarr, um music server self-hosted baseado no Navidrome (a ideia dos pedidos vem do Seerr). O `Dockerfile` baixa o Navidrome upstream num commit fixo (`NAVIDROME_COMMIT`), aplica `patches/*.patch` com `git apply`, sobrepõe os arquivos de UI e de marca deste diretório e compila. O código Go do Guitarr **só existe dentro dos patches**; os testes Go dos patches rodam num clone temporário (ver "Backend Go").

Documentação: `README.md` (público, em inglês: o que é, créditos a Navidrome e Seerr, GPL-3.0 em `LICENSE`), `LEIA-ME.md` (instalação/operação), `docs/API.md` (API `/api/seer/*`, config, fluxo de pedidos, tags), `apps/LEIA-ME.md` (PWA/Linux). Repositório público: `github.com/guivalli/guitarr`.

**Segredos fora do `.env`** (patch 0032): o `.env` não precisa ter nada secreto. Chaves de API (slskd, Lidarr, Spotify) ficam seladas no banco; no primeiro start, `AdoptEnvSecrets` copia as que vierem do ambiente. Usuário/senha do Soulseek e do painel do slskd (e a chave `web.authentication.api_keys.guitarr`) ficam em `/srv/guitarr/slskd/slskd.yml`, montado no Guitarr em `/slskd/slskd.yml` (`ND_SEER_SOULSEEK_CONFIGFILE`) e editado pela tela Configurações; o slskd recarrega o arquivo sozinho e o Guitarr pede reconexão via API. Variáveis `SLSKD_SLSK_*`/`SLSKD_PASSWORD`/`SLSKD_API_KEY` no ambiente do slskd **passam na frente** do yml: não as recoloque no compose.

## Duas cópias: altere sempre nas duas ao mesmo tempo

O projeto vive em duas pastas irmãs, e **toda alteração tem de ir para as duas na mesma hora**:

- **`guitarr`**: o repositório limpo, o que vai para o GitHub (só arquivos versionados e o `.env.example`; sem `.env`, dados, músicas, chaves ou notas pessoais).
- **`guitarr dev`**: a cópia de trabalho e de produção (tem o `.env` real, os dados, o keystore do Android e é onde o container roda). Serve para testar.

Fluxo: edite e comite na `guitarr`; depois sincronize a `guitarr dev` (`cd "guitarr dev" && git fetch ../guitarr main && git reset --hard FETCH_HEAD`, que só mexe nos arquivos versionados), rebuild/deploy por ela e teste. Só então publique. Nunca rode `git clean` na `guitarr dev` (apagaria `.env`, dados e a chave do Android) e nunca coloque nada pessoal na `guitarr`. Se mexer primeiro na dev para testar, leve a mesma mudança para a limpa antes de terminar.

## Comandos

```bash
./setup.sh                                # primeira vez: pastas + slskd.yml (pergunta usuário/senha, gera a chave)
docker compose up -d --build              # primeira vez / depois de mudar patches
docker build -t guitarr:latest .  # só a imagem (UI/patch mudou; o resto vem de cache)
docker compose build --no-cache guitarr   # atualizar yt-dlp
docker compose logs -f guitarr
```

**Deploy**: o container e a imagem são `guitarr`. Recriar só o Guitarr, sem tocar no slskd (interromperia downloads):

```bash
docker tag guitarr:latest guitarr:before-<mudança>   # rollback
docker build -t guitarr:latest .
docker rm -f guitarr
docker compose up -d --no-deps --no-build guitarr
```

Rollback: `docker tag guitarr:before-<x> guitarr:latest` + os dois últimos comandos.

**Testar a UI sem mexer em produção:** imagem numa porta separada com dados descartáveis.

```bash
mkdir -p /tmp/ndtest && chmod 777 /tmp/ndtest
docker run -d --name nd-test --user 1000:1000 -p 4534:4533 -e ND_SEER_ENABLED=true \
  -v /tmp/ndtest:/data -v /srv/music:/music:ro guitarr:latest
curl -X POST localhost:4534/auth/createAdmin -H 'Content-Type: application/json' -d '{"username":"t","password":"t12345"}'
```

**Publicar:** rode o `gitleaks` na árvore e no histórico antes de qualquer push, e confira que nenhum endereço, usuário, caminho ou chave do seu servidor entrou nos arquivos versionados (use variáveis do `.env`).

## Backend Go (patches)

`patches/0001…0035` são uma série aplicada em ordem (alfabética: há dois `0013-*`) sobre o commit pinado; nunca edite um patch já implantado, crie o próximo número (o 0016 ainda foi reescrito na sessão em que nasceu, antes de ir para o git). Fluxo:

```bash
# clone temporário (não existe no repo): upstream no commit do Dockerfile + patches aplicados e commitados
git init . && git remote add origin https://github.com/navidrome/navidrome.git
git fetch --depth 1 origin <NAVIDROME_COMMIT> && git checkout FETCH_HEAD
for p in patches/*.patch; do git apply "$p"; done && git add -A && git commit -qm base
# ...editar... depois gerar o patch (inclui arquivos NOVOS, que `git diff` sozinho omite):
git add -A && git diff --cached HEAD > patches/00NN-descricao.patch
# testes, num container (sem Go no servidor):
docker run --rm -v "$PWD":/src -w /src -v navi-gomod:/go/pkg/mod -v navi-gocache:/root/.cache \
  golang:1.27-trixie sh -c 'gofmt -l core/seer core/acquire server/seerapi; go vet ./core/... ./server/seerapi/ && go test ./core/acquire/ ./core/seer/ ./server/seerapi/'
# (os volumes nomeados deixam o ciclo em segundos; gofmt -l já lista arquivos antigos não formatados: ignore-os;
#  `go build .` nesse clone pede -buildvcs=false por causa do dono dos arquivos)
# teste único: ... go test ./core/acquire/ -run TestRetryAvoidsTheSourceThatFailed
```

Só vale como pronto depois do `docker build` real: já aconteceu patch passar nos testes e não compilar na imagem por arquivo novo fora do diff.

Pacotes (todos nos patches):
- `core/acquire`: `Service` (fila, workers, watcher de importação), `Source` (soulseek, youtube, soundcloud, lidarr; interface `Fetch`), catálogo MusicBrainz, `retag.go`. `process()` tenta as fontes em ordem; falhou tudo → tenta álbum faixa a faixa. Estados: pending → queued → searching → downloading → importing → available | failed.
- **Retry "por outro caminho"**: `Approve` de um pedido `failed` chama `noteRetry` (em memória, some no restart): fontes que falharam vão pro fim, `Request.Attempt` faz as fontes web usarem outra busca/outros uploads/clientes yt-dlp em ordem inversa e o Soulseek começar do próximo peer.
- **Retag**: download que não vem de fonte web (`Result.Tagged == false`, ou seja Soulseek) é re-etiquetado via ffmpeg com nome/ano/faixa/MBIDs do MusicBrainz do pedido, pareando arquivo↔faixa por título e depois por número. Falha só vira aviso.
- `core/seer`: `Editor` (grava tags com TagLib e reescaneia as pastas; `TagChanges` também aceita `mbzAlbumId|mbzReleaseGroupId|mbzAlbumArtistId`), `report.go` (relatório de metadados, inclui `noCover`), podcasts, duplicatas, storage.
- **Capas** (`core/seer/covers.go` + `core/acquire/cover.go`): `albumHasCover` reproduz a `CoverArtPriority` do Navidrome **conferindo o disco** — `image_files`/`embed_art_path` do banco ficam velhos (arquivo renomeado) e miniaturas `10 - Faixa.jpg` não casam `cover.*|folder.*|front.*`, então nunca confie só no banco. `FetchCover` baixa (Cover Art Archive → iTunes → Deezer) e grava `cover.jpg` na pasta **só se ela é exclusiva do álbum**; senão embute com TagLib (`ImageWriter`).
- **Import de playlists** (`core/acquire/importer.go`, `import_read.go`): link Spotify/YouTube Music ou upload multipart de um ou mais `file` (CSV do Exportify/TuneMyMusic, JSON, TXT ou `.zip` do "Export All"; cada arquivo vira um job). `target` = `playlist|favorites|both|auto` (coluna `import_job.target`; `auto` manda "Liked Songs"/"Músicas Curtidas" para favoritos). Favoritos são estrelados por `playlistWriter.StarSongs` conforme as faixas chegam.
- **Outras versões** (`core/acquire/versions.go` + `core/seer/versions.go`, patch 0034): `GET /api/seer/library/song/{id}/versions` lista gravações do MusicBrainz (`MusicBrainz.Recordings`, uma por take: título+disambiguation+duração/5 s) e uploads das fontes web (busca do yt-dlp); `POST` com a versão escolhida baixa numa pasta temporária fora da biblioteca (`/data/cache/versions`) e `Editor.ReplaceAudio` troca o arquivo: **mesmo nome (só a extensão muda) e as tags do arquivo antigo**, então o PID do scanner bate e o Navidrome mantém o mesmo ID (favoritos, plays e playlists ficam; testado num container descartável com MP3→Opus). Job em memória, `GET …/versions/job`.
- **Letras** (`core/seer/lyrics.go`, patch 0033): o Navidrome lê `.lrc`/`.txt` ao lado do áudio a cada pedido (`LyricsPriority`), então salvar letra = gravar o sidecar, sem rescan. `GET /api/seer/lyrics/{id}/lrclib` (candidatos do lrclib.net), `PUT /api/seer/lyrics/{id}` (`{synced, plain}`; ambos vazios apaga), `POST|GET /api/seer/lyrics-batch` (busca as faltantes em segundo plano, pula podcasts, salva só com duração a ±3 s).
- `server/seerapi`: rotas; `/library/*` e `/duplicates` são admin-only. `Editor` e `Service` são interfaces com fakes nos `_test.go` (ao adicionar método, atualize os fakes). `state.go`: `GET/PUT /api/seer/state`, JSON opaco por usuário em `user_props`, **merge por chave de topo** (`null` apaga; `_at` = carimbo do servidor por chave).
- **Configurações em tempo de execução** (`core/seer/settings.go`, `secrets.go`): `GET/PUT /api/seer/settings` (auto-approve, propriedade `seer.autoapprove`) e `GET/PUT /api/seer/config` (admin; sobrescreve fontes, Soulseek, Lidarr, Spotify e espaço mínimo do `.env`, propriedade `seer.overrides`). Campo `nil` = vale o `.env`. Chaves do Soulseek/Lidarr e o secret do Spotify vão selados com AES-256-GCM usando `/data/seer.key` (0600, criado no primeiro uso): perder o arquivo deixa os segredos ilegíveis. Salvar chama `Seer.Reload`, que troca as fontes no `Service` (`SetSources`, ponteiro atômico) e o leitor de playlists (`swapReader`) sem reiniciar.

## UI "Guitarr" (`guitarr.html`, servido em `/app/`)

Arquivo único (HTML + Tailwind CDN + JS puro) que **substitui** o index da UI React (a UI React original não é mais exposta). É **gerado**, não edite à mão:

```bash
cd ui && python3 build.py guitarr.mock.html live.js ../guitarr.html
```

- `guitarr.mock.html`: design com dados falsos. `live.js`: zera os arrays do mock e liga tudo ao servidor (login, `/api/*`, `/rest/*`, `/api/seer/*`). `build.py` troca textos fixos do mock por ids/placeholders (aborta se um trecho não bater exatamente 1 vez) e injeta `live.js` antes de `</body>`.
- Marca: `build.py` troca `{{LOGO_MARK}}`, `{{FAVICON}}` e `{{LOGO_VERTICAL}}` pelos `ui/brand/inline_*.txt`. O logo azul vem de `ui/mkguitarr.py logo.jpeg PlusJakartaSans.ttf logo-guitarr.png` (verde → `#3b8cff`, texto "Guit"+"arr"); depois `mkbrand.py` roda numa pasta temporária com `logo-guitarr.png` salvo como `logo.jpeg` (ele lê `logo.jpeg` e grava em `brand/` relativo ao diretório atual); os ícones PWA/favicon vão de `brand/root/` para a raiz de `/app/` e os logos para `/app/brand/` (COPY no Dockerfile, depois do `npm run build`).
- Sessão: `POST /auth/login` → JWT (`x-nd-authorization: Bearer`, renovado a cada resposta) + `subsonicSalt/Token`. Capas/áudio pelo Subsonic (`/rest/getCoverArt|stream`), dados pela API nativa paginada (`_start/_end`, total em `x-total-count`). Episódio de podcast usa `?jwt=` porque `<audio>` não manda header.

**Sessão contínua**: `sessSnapshot/sessSave/sessRestore/sessApply` em `live.js` gravam em `/api/seer/state` as chaves `playback` (faixa, posição, fila — compartilhada com o app mobile) e `web` (tela); a restauração roda em `boot()` depois do `loadLibrary`, deixa **pausado** e é ignorada se a URL tem `#hash`.

Recursos que vivem só em `live.js` e se ligam ao mock por um gancho `${window.x ? window.x() : ''}` no template (mantenha o gancho ao mexer no mock):
- **Ordenar** na tela Músicas (`window.songsViewList` no mock + `seerSortSongs`/`seerSortControl`; chave `seer_song_sort`). `contextQueue()` usa essa mesma lista, então a fila segue a ordem da tela.
- **Discografia do artista** (`seerArtistDiscography`): MBID do artista (`/api/artist` → `mbzArtistId`, senão busca por nome), `/api/seer/catalog/artist/{mbid}`, casa com os álbuns locais por release group e depois por título sem "(Deluxe…)/(Remastered…)" (`foldTitle`); só Album/EP, sem coletânea/mixtape.
- **Letras** (`np-lyrics` no painel Tocando agora, `#lyrics-full` em tela cheia com a cor do álbum, `#lyrics-editor`; card do lote em Organizar Metadados). Ordem: `getLyricsBySongId` do Subsonic, depois LRCLIB; cache por sessão em `lyr.cache`.
- **SmartRadio e Daylist** na Home (`seerMixesHtml`; internos expostos em `window.seerMixInternals` para os testes). SmartRadio emenda lotes embrulhando `window.nextTrack`; histórico das últimas 50 em `seer_mix_recent`.
- **Outras versões** no editor de faixa (`openVersionsModal`, modal `#modal-versions` criado pelo `live.js`; botão "Buscar versões…" no mock).
- **Temas** escuro/OLED/claro: `ui/theme.js` vai no `<head>` (o `build.py` injeta a lista de todas as classes de cor do mock e do `live.js` no marcador `/*@@COLOR_CLASSES@@*/`) e gera CSS que remapeia essas classes sob `html[data-theme]`. Classe de cor nova entra sozinha no próximo build; cor dinâmica montada por concatenação não. `.th-keep` = área que fica escura no tema claro (letra em tela cheia, capa do Tocando agora). Escolha em `localStorage.seer_theme` + `/api/seer/state` chave `theme` (o app mobile usa as mesmas). Prints: `tools/themeshots.js` (Playwright, API fictícia).
- **Primeiro acesso e usuários**: como a UI React original não é mais exposta, o `live.js` cobre o que só ela fazia. `build.py` injeta `<meta name="guitarr-config" content="{{ .AppConfig }}">` (o servidor serve `index.html` como template e troca isso pelo JSON com `firstTime`); com `firstTime` a tela de login vira "criar conta de administrador" (`POST /auth/createAdmin`, depois login normal). Configurações → Usuários lista/cria/remove usuários (`/api/user`, só admin) e troca a própria senha. Não ponha `{{` em mais nenhum lugar do HTML (o template quebra).
- **Menu da conta** no avatar (`openServerModal(event)`, com o seletor de tema), **Limpar concluídos** na fila (`DELETE /api/seer/requests?status=available,failed`) e o modal de import com abas Link/Arquivo.

Telas que o mock não tinha, só em `live.js`: **Rádios** (busca em radio-browser.info + `POST/DELETE /api/radio`, só admin), **Organizar Metadados** (view `meta`, `renderMetaView`, `GET /api/seer/library/metadata-report`, grava por `PUT /api/seer/library/album|song/{id}`) e a playlist virtual **Músicas Curtidas** (`__favorites`, recalculada de `TRACKS[].fav`). Também **Configurações** (view `cfg`, `renderCfgView`, item `nav-cfg` só para admin; segredos só vão no `PUT` quando digitados) e o **passeio de primeiro login** (`seerTourStart`, chamado no fim do `boot()`; o "já visto" é a chave `tour` de `/api/seer/state`).

A cor de destaque é azul `#3b8cff` (hover `#5aa0ff`), no lugar do verde do protótipo original. Ela aparece também nas âncoras do `build.py`: qualquer troca de cor tem de ser feita no mock, no `live.js`, no `build.py` e em `ui/mobile/` juntos, senão o build aborta.

Convenções do mock que `live.js` respeita (quebrar gera bugs sutis):
- `TRACKS/ALBUMS/ARTISTS/PLAYLISTS` são `const` globais de outro `<script>`: não estão em `window` (`typeof TRACKS`, não `window.TRACKS`), só se mutam in-place. `state` é `let` global.
- Funções do mock são chamadas por nome: para mudar comportamento, reatribua `window.nome = ...` (ex.: `renderCurrentView` é embrulhado para a view `meta`).
- Textos em `TRACKS/ALBUMS/ARTISTS` já vêm **HTML-escapados** (`esc`); handlers com nome por argumento comparam com `esc(arg)`; para inputs/toasts use `rawTitle/rawArtist/rawAlbum` ou `unesc`.
- A fila é uma lista de índices de `TRACKS` (`queue`); a recarga da biblioteca (`loadLibrary`) remapeia por id. Rádio/podcast tocam em modo externo (`ext`), fora de `TRACKS`.
- Fora de `TRACKS/ALBUMS/ARTISTS` por design: registros `missing` (o admin os recebe da API; editar dá "not found") e episódios em `…/Podcasts/…` (ficam só na aba Podcasts).

### Idiomas (inglês padrão, português BR) e busca com catálogo
- O código e o mock da UI são escritos em **português**; no inglês, `ui/i18n.js` traduz o DOM em tempo de execução com o dicionário `ui/i18n-en.tsv` (mais `ui/i18n-mobile.tsv` só no app mobile), embutido no `<head>` por `ui/i18n_build.py` (usado por `build.py` e `mobile/build_mobile.py`). Formato por linha: `português ||| inglês`; `re: regex ||| troca` para casos com número. **Texto novo na UI precisa de uma linha no `.tsv`**, senão aparece em português no modo inglês.
- Como casa: chave = texto exato do nó (espaços colapsados). Chaves de várias palavras ou com pontuação nas pontas também valem como começo/fim de um texto montado com dados (`Tocando álbum "X"`); palavra solta só casa o nó inteiro, para não mexer em título de música. Dados do usuário nunca entram no dicionário. Não são traduzidos: `<textarea>`, `code`, `.lyr-line`, `[data-notr]`.
- A escolha fica em `localStorage.nd_seer_lang` e em `/api/seer/state` (`prefs.lang`); trocar de idioma recarrega a página (`seerSetLang`/`seerPickLang`). O seletor está no menu da conta, em Configurações, no 1º passo do passeio e no login (site e mobile). Os smoke tests gravam `nd_seer_lang=pt` para continuar afirmando textos em português.
- Achar o que falta traduzir: abra o HTML gerado no Playwright com a API fictícia (modelo em `ui/tools/themeshots.js`), `nd_seer_lang=en`, e liste os nós de texto com acento. `ui/tools/i18nsmoke.js` cobre idioma, primeiro acesso, usuários e a busca.
- **Busca do topo**: em Músicas/Álbuns/Artistas, `drawCatalogBlock()` (live.js) acrescenta abaixo da lista local o catálogo do MusicBrainz (`/api/seer/catalog`, só o que não está na biblioteca, com "+ Pedir"); `seerRefresh()` redesenha só esse bloco para não perder a rolagem.

### Verificação da UI
Testes do app mobile: `ui/mobile/smoke.js` e `smoke2.js`, rodados contra `apps/mobile/index.html` do mesmo jeito.

Testes de fumaça em `ui/tools/`, rodados contra o HTML gerado (precisam de `jsdom@24` instalado num diretório temporário: copie os scripts para lá e rode `docker run --rm -v /tmp/smk:/smk -v $PWD:/p -w /smk node:22 node X.js /p/guitarr.html`):
- `metasmoke.js` (Organizar Metadados: registros fantasmas, unificar artistas) — sai 1 por ruído de `canvas` do jsdom mesmo com tudo `ok`; olhe as linhas `FALHOU`.
- `metasmoke2.js` (capas, ignorados, códigos MusicBrainz), `discosmoke.js` (discografia/faltantes), `lyricsmoke.js` (letras, karaokê, editor, lote), `mixsmoke.js` (SmartRadio/Daylist, Smart Shuffle), `i18nsmoke.js` (idiomas, busca com catálogo, primeiro acesso, usuários), `versionsmoke.js` (outras versões).
Saem com código 1 se algo falhar. Para outros casos, sem runner: `jsdom` com `fetch` simulado (precisa `pretendToBeVisual`; o Tailwind CDN não carrega e gera `tailwind is not defined`, ignore) e Playwright/Chromium interceptando a rede (`page.route`) para servir o HTML e uma API fictícia, sem backend. Imagem: `mcr.microsoft.com/playwright:v1.49.1-noble` (`npm i playwright@1.49.1` dentro dela; `--ipc=host`). Cuidado ao apontar para o servidor real: `/api/seer/catalog` fala com o MusicBrainz e `POST /requests` dispara download real.

## Armadilhas

- yt-dlp precisa de `deno` (desafios JS do YouTube, `--remote-components ejs:github` do patch 0013) e de `mutagen` (tags e capa no pós-processamento), instalados pelo `pip` do Dockerfile, e de um cache gravável (`XDG_CACHE_HOME=/data/cache`, o container roda como 1000 sem home).
- `navidrome user create` (dentro do container, com `--datafolder /data`) pede a senha num TTY: rode por `ssh -tt` ou `script -qec`. Para testar a API com um admin: `POST /auth/login` e mande o token em `x-nd-authorization: Bearer …`.
- Não renomear os "seer" técnicos: `ND_SEER_*`, rotas `/api/seer/*`, seção `[Seer]` do toml, pacote `core/seer`, `/music/Seer`, `/srv/guitarr` (dados) e as chaves `nd_seer_*`/`seer_*` do localStorage. Só o nome de exibição é "Guitarr", e os rótulos da UI não repetem a marca ("Pedidos", não "Pedidos (Guitarr)"). O `applicationId` Android `app.guitarr` também fica: trocar quebra a atualização do app instalado.
- Dados: músicas em `/srv/music` (downloads em `Seer/<Artista>/<Álbum>/`, podcasts em `Seer/Podcasts/<canal>/`), dados do Navidrome e slskd em `/srv/guitarr`; usuário do container `1000:1000`.
- `apps/mobile/index.html` é **gerado**: edite `ui/mobile/` (`shell.html`, `app.css`, `core.js`, `player.js`, `views.js`, `extras.js`, `sw.js`) e rode `python3 ui/mobile/build_mobile.py` (saída autônoma, sem CDN). Teste: `node ui/mobile/smoke.js apps/mobile/index.html` e `smoke2.js` (jsdom + servidor falso; precisa `jsdom@24`). `extras.js` traz do site SmartRadio/Daylist, ordenar, discografia com faltantes e temas (variáveis CSS em `app.css`, `html[data-theme]`); ações novas vão em `S.extraActions` (o despachante de cliques do `views.js` procura lá). Letra: servidor e depois LRCLIB, tela cheia `#lyr-full`. Prints: `tools/mobileshots.js`. Mesma sessão do site (`nd_seer_pro_auth`); fora do servidor (Capacitor) pede o campo "Servidor".
- O `COPY apps/mobile/` do Dockerfile também gera `/app/mobile.html`: por isso o app é um arquivo único (caminhos relativos quebrariam lá).
- Placeholder da busca é cortado em janelas estreitas (padding do botão "Limpar"): mantenha textos curtos.
- `patches/fix_home.sh` e `patches/fix_menu.sh` não são patches: o Dockerfile só roda `git apply /patches/*.patch`, então esses scripts não são aplicados na imagem.

## App Android (`apps/android/`)

APK = o mesmo app mobile (`ui/mobile/`) dentro do Capacitor 8. `apps/android/build-apk.sh [debug|release]` faz tudo no Docker (imagem `guitarr-android-builder`) e grava `dist/Guitarr-<versão>-<modo>.apk`; leia `apps/android/README.md`. Pontos que custaram caro:
- O Capacitor limpa os listeners JS quando a página termina de carregar: `native.js` só registra depois do `load` (+800 ms), senão os comandos da notificação somem.
- Esquema do app é `http` (`capacitor.config.json`): com `https`, o WebView bloqueia imagem/áudio de servidor `http://` mesmo com `allowMixedContent`. CORS do Navidrome é `*`, então `fetch` direto funciona.
- Offline: `offline.js` (armazém nativo = `Filesystem.downloadFile`; navegador = Cache Storage). Faixa tem lista de coleções (`cols`) que a seguram; limite/qualidade/Wi-Fi em `S.off.settings`. O restante do app só usa `S.offlineHas/offlineSrc/offlineSave/offlineButton/offlineScreen`.
- `android/` é gerado pelo `cap add` mas está versionado com edições nossas (manifesto, Java, tema, `build.gradle` com assinatura e versão): não rode `cap add` de novo.
- Copiar `apps/android` entre pastas/máquinas com `cp -r` troca os symlinks de `node_modules/.bin` por arquivos e o `npx cap sync` quebra (`Cannot find module '../package.json'`): apague `node_modules` e `www` antes de rodar o `build-apk.sh`. O primeiro build depois de renomear os volumes de cache baixa o Gradle de novo (10 a 15 min).
- Os arquivos do `android/` pertencem ao root se o Docker os criou: `docker run --rm -v $PWD:/w alpine chown -R 1000:1000 /w`.
- Testar sem celular: `apps/android/tools/Dockerfile.emulator` + `apps/android/tools/emu.sh` + `apps/android/tools/cdp.js` (WebView via devtools); servidor descartável com `ND_SCANNER...` como em "Testar a UI sem mexer em produção". `.dockerignore` mantém `apps/android` fora do contexto do build da imagem do servidor.

