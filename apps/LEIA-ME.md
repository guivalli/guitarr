# Apps do Guitarr (celular e computador)

O Guitarr é instalável como app (PWA). O app instalado abre em tela
cheia, com ícone próprio, sem barra de endereço, e sempre igual ao site: tema
novo, pedidos, importação de playlists e o que vier depois chegam sozinhos,
sem atualizar nada no celular.

Precisa de HTTPS (proxy reverso ou túnel) para o navegador oferecer a instalação.

## Android

1. Abra **https://guitarr.example.com** no **Chrome** e faça login.
2. Menu **⋮** → **Instalar app** (ou **Adicionar à tela inicial** → Instalar).
   Também aparece em **perfil (canto superior direito) → Instalar app**.
3. O ícone "Guitarr" vai para a gaveta de apps. Segure o ícone para os atalhos
   **Pedidos** e **Álbuns**.

A música continua tocando com a tela desligada, com controles na tela de
bloqueio, no fone Bluetooth e no relógio (Media Session).

## Android: APK com offline

Para ter **músicas, álbuns e playlists offline** (com limite de espaço e escolha de qualidade), controles na tela de
bloqueio e downloads com a tela apagada, existe um APK do mesmo app: veja `apps/android/README.md`
(`apps/android/build-apk.sh` gera o arquivo em `apps/android/dist/`).

## Linux

Opção A, pelo navegador: abra o servidor no Chrome, Brave, Edge ou Chromium →
menu **⋮** → **Transmitir, salvar e compartilhar** → **Instalar página como app**
(ou o ícone de instalar na barra de endereço). O Firefox não instala apps web.

Opção B, pelo script (cria o atalho no menu e, se quiser, na Steam para o Modo Jogo):

```bash
bash instalar-linux.sh https://guitarr.example.com
# para remover: bash instalar-linux.sh --remover
```

O script usa o Chrome/Brave/Edge/Chromium do Flatpak que você já tiver; se não
tiver nenhum, oferece instalar o Chromium do Flathub.

## Outros clientes

Guitarr fala a API Subsonic, então clientes prontos (Symfonium, Tempo, Substreamer, DSub...) também tocam a sua
biblioteca, com offline e Android Auto. O que eles não têm são os pedidos, a importação de playlists e as demais telas do
Guitarr: para isso use o app web/APK acima.
