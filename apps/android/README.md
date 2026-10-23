# Guitarr para Android (APK)

O mesmo app de `/app/mobile` (fontes em `ui/mobile/`), empacotado com [Capacitor](https://capacitorjs.com)
como um app Android de verdade. Em relação à versão web, o APK tem:

- **Offline de verdade**: músicas, álbuns e playlists em arquivos no aparelho (`Directory.Data/offline/`), com
  **limite de espaço**, **qualidade** dos downloads e fila que continua sozinha. Detalhes abaixo.
- **Controles de música** na notificação, na tela de bloqueio, no fone/Bluetooth e no carro (sessão de mídia nativa).
- **Downloads com a tela apagada** (serviço em primeiro plano com notificação de progresso).
- Botão **voltar** do Android (fecha folha → player → tela → vai ao início → minimiza, a música continua).
- Ícone adaptativo, tela de abertura, barra de status escura, só retrato. Sem Google Play Services.
- Funciona com servidor `https://` (seu domínio) **e** `http://` (IP da rede local).

## Instalar no celular

1. Pegue `apps/android/dist/Guitarr-<versão>-release.apk` (pelo SMB, `scp`, USB ou o que preferir).
2. No celular, abra o arquivo e permita **"Instalar apps desconhecidos"** para o app que o abriu (Arquivos, Chrome...).
3. Abra o **Guitarr**, aceite as notificações (é o que mostra os controles de música), digite o **Servidor**
   (`https://guitarr.example.com`), usuário e senha.

Atualizar = instalar o APK novo por cima (a chave é a mesma, os downloads e o login ficam).

## Gerar o APK

```bash
cd apps/android
./build-apk.sh            # release assinado  -> dist/Guitarr-1.0.AAMMDD-release.apk
./build-apk.sh debug      # debug (WebView inspecionável)
```

Tudo roda no Docker (imagem `guitarr-android-builder`: JDK 21 + Android SDK 36 + Node 22; criada sozinha na primeira
vez, ~1 GB). A interface vem de `ui/mobile/` (`build_mobile.py`): mudou lá, rode o script de novo.

**Chave de assinatura**: criada na primeira vez em `apps/android/keystore/` (fora do git). **Faça backup dela.**
Sem a mesma chave o Android recusa atualizar o app instalado (teria que desinstalar e perder os downloads).

## Como o offline funciona

- **Onde**: álbum e playlist têm o botão **↓ Baixar offline** (⋮ numa música baixa só ela). A tela
  **Biblioteca → Offline** (e Auto → Gerenciar) lista tudo, mostra o espaço e permite apagar item por item.
- **Limite**: 1/2/5/10/20/50 GB, "outro valor" ou sem limite. A fila para quando o próximo download passaria do limite
  e mostra o motivo; o app também nunca deixa o aparelho com menos de 500 MB livres.
- **Qualidade**: original (FLAC etc.) ou MP3 320/192/128 kbps convertido pelo servidor (ffmpeg). Vale para
  os próximos downloads.
- **Só no Wi-Fi** (padrão): usa "rede sem franquia" do Android; desligue para baixar também no 4G/5G.
- **Segue o servidor**: álbum/playlist offline ganham as faixas novas e perdem as removidas quando o app abre com rede.
  Uma faixa só sai do aparelho quando nenhum álbum/playlist a usa e ela não foi baixada avulsa.
- **Sem rede**: o app abre direto na parte offline (álbuns, playlists, músicas), com capas guardadas.
- No navegador/PWA a mesma lógica existe, guardando no Cache Storage (sem capas e sem serviço em segundo plano).

## Testar sem celular (emulador + servidor descartável)

```bash
docker build -t guitarr-android-emu -f tools/Dockerfile.emulator tools   # precisa de /dev/kvm; ~3 GB
```

`tools/emu.sh` e `tools/cdp.js` são os ajudantes usados nos testes: instalar o APK de debug no emulador, abrir o
WebView por `localhost:9222` e rodar JavaScript nele (login, baixar álbum, limite, `dumpsys media_session`...).
O emulador acessa um servidor Guitarr por `http://10.0.2.2:<porta>`. A tela é lenta (sem GPU): o primeiro
quadro pode aparecer sem a tela de login por alguns segundos.

## Arquivos

| Caminho | O que é |
| --- | --- |
| `android/app/src/main/java/app/guitarr/` | `MainActivity`, `SeerNativePlugin` (espaço livre, rede, mídia) e `PlaybackService` (sessão de mídia + downloads) |
| `capacitor.config.json` | id `app.guitarr`, esquema `http` (evita bloqueio de imagem/áudio de servidor http) |
| `android/app/build.gradle` | versão por `-PguitarrVN/-PguitarrVC` e assinatura por `keystore/keystore.properties` |
| `tools/make-icons.sh` | gera ícones e a abertura a partir de `brand/` |
| `www/`, `dist/`, `keystore/`, `node_modules/` | gerados / segredos (no `.gitignore`) |

## Limites conhecidos

- A interface vai dentro do APK: mudou o app em `ui/mobile/`, é preciso gerar e instalar um APK novo
  (o PWA continua atualizando sozinho pelo servidor).
- Testado em emulador Android 14 (reprodução, tela apagada, teclas de mídia, downloads, limite, qualidade, sincronização,
  abrir sem rede, botão voltar, versão release). **Não testado em aparelho físico**: Bluetooth, Android Auto,
  economia de bateria agressiva de alguns fabricantes (se o download parar com a tela apagada, tire o Guitarr da
  otimização de bateria) e rotação (o app é só retrato).
- Podcasts não entram no offline (só música).
