# Guitarr · App mobile (`/app/mobile/`)

App de celular ligado à API **real** do servidor (nada de dados de exemplo). É um PWA hoje e a base do app Android/iOS (Capacitor) amanhã.

## O que tem

| Aba | O que faz |
| --- | --- |
| **Início** | Saudação, busca na biblioteca, filtros (Todas · Curtidas · FLAC · Offline), recentes, lista de músicas, Shuffle |
| **Guitarr** | Busca no MusicBrainz, **+ Pedir** (artista/álbum/faixa), fila de pedidos ao vivo (Soulseek/YouTube), tentar de novo, importar playlist Spotify/YT Music |
| **Biblioteca** | Álbuns · Artistas · Playlists (+ Músicas Curtidas) · Offline; páginas de álbum, artista e playlist |
| **Podcasts** | Canais YouTube/RSS, episódios, baixar, retenção, adicionar/remover canal |
| **Auto** | Controles gigantes, armazenamento do servidor, duplicatas (admin), offline do aparelho, sair |

Player: mini-player de vidro, tela cheia com capa, barra de busca, aleatório/repetir, fila, letras sincronizadas
(OpenSubsonic `getLyricsBySongId`), curtir, controles na tela de bloqueio/fones (MediaSession) e scrobble.
Menu ⋮ por faixa: curtir, tocar a seguir, fila, ir ao álbum/artista, **manter offline** e (admin) **editar tags**.

## Continuar de onde parou

Faixa, posição, fila, aleatório/repetir e a tela aberta são salvos no servidor (`/api/seer/state`, por usuário).
Recarregar, abrir em outro celular ou no navegador do computador retoma de onde estava (pausado: o navegador não
deixa tocar sozinho). A chave `playback` é compartilhada com o site; `mobile` guarda só a aba/tela deste app.

## Offline

"Manter offline" guarda o arquivo no Cache Storage (`seer-audio-offline-v1`) deste aparelho. Sem rede o app abre com
o que foi salvo. A "casca" do app fica no service worker (`sw.js`).

## Instalar (PWA)

Abra `https://SEU-SERVIDOR/app/mobile/` no Chrome/Safari → menu → *Instalar app* / *Adicionar à tela inicial*.

## Virar app Android / iOS (Capacitor)

```bash
npm i -g @capacitor/cli && cd apps/mobile
npm init -y && npm i @capacitor/core @capacitor/android @capacitor/ios
npx cap init "Guitarr" app.guitarr --web-dir .
npx cap add android && npx cap add ios
```

* Empacotado, o app não roda dentro do servidor: o login mostra o campo **Servidor** (`https://guitarr.seudominio.com`)
  e todas as chamadas usam esse endereço (`localStorage.nd_seer_server`).
* Chamadas `fetch` para outro domínio caem em CORS. Ative o `CapacitorHttp` em `capacitor.config.json`
  (`{"plugins":{"CapacitorHttp":{"enabled":true}}}`) para elas saírem pelo código nativo.
* Reprodução em segundo plano / Android Auto de verdade pedem um serviço de mídia nativo (Media3
  `MediaLibraryService`); o `<audio>` do WebView pausa com a tela desligada em alguns aparelhos.

## Arquivos

* Fontes: `ui/mobile/` (`shell.html`, `app.css`, `core.js`, `player.js`, `views.js`, `sw.js`, `smoke.js`).
* Build: `python3 ui/mobile/build_mobile.py` → gera `apps/mobile/index.html` (autônomo, sem CDN).
* Teste de fumaça (jsdom): `node ui/mobile/smoke.js apps/mobile/index.html`.
