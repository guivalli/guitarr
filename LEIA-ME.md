# Guitarr: instalação e uso

Guitarr é um servidor de música self-hosted com pedidos: você pesquisa no catálogo do MusicBrainz, pede, e a música é
baixada, etiquetada e aparece na sua biblioteca. Este guia sobe tudo com Docker Compose.

Você precisa de: um servidor Linux (ou qualquer máquina) com **Docker** e **Docker Compose**, uma pasta para a música e
uma conta no Soulseek (grátis, criada no primeiro login).

## 1. Baixe o projeto

```bash
git clone https://github.com/guivalli/guitarr.git && cd guitarr
```

## 2. Escolha onde ficam os arquivos (opcional)

Por padrão os dados ficam em `./data` e a música em `./music`, ao lado do `docker-compose.yml`. Para usar outras pastas
(outro disco, por exemplo), crie o `.env` e diga onde:

```bash
cp .env.example .env
nano .env        # GUITARR_DATA=/srv/guitarr   MUSIC_DIR=/srv/music   PUBLIC_URL=https://guitarr.seudominio.com   TZ=...
```

## 3. Prepare as pastas e as chaves internas

```bash
./setup.sh
```

Ele cria as pastas com o dono certo (pede a senha do sudo uma vez), pergunta o usuário e a senha do Soulseek e a senha
do painel do slskd, e gera a chave entre o Guitarr e o slskd. Depois, essas senhas se mudam em **Configurações**.

## 4. Suba

```bash
docker compose up -d --build   # a primeira vez compila, leva alguns minutos
```

O primeiro acesso mostra a tela **Criar conta de administrador**: abra `http://IP-DO-SERVIDOR:4533` na rede de casa e crie
o seu **antes** de expor o servidor na internet. Outros usuários se adicionam em **Configurações → Usuários**. Para acessar de fora, ponha um proxy reverso com HTTPS na frente da porta 4533
(Caddy, Nginx, Traefik) ou um túnel (Cloudflare Tunnel, Tailscale). O app de celular precisa de HTTPS para instalar.

## Conferir

```bash
docker compose ps                    # os 2 devem estar "Up" (guitarr e slskd "healthy")
docker compose logs slskd | grep -i -E "logged in|invalid"   # login no Soulseek
docker compose logs -f guitarr     # pedidos e downloads
```

Se o slskd disser que a senha é inválida, o nome de usuário do Soulseek já tem dono: escolha outro em **Configurações**.

Opcional: libere a porta **50300** (TCP) no roteador para o servidor. O Soulseek acha mais arquivos assim.

## Atualizar

```bash
git pull
docker compose up -d --build
```

O `.env` e as pastas de dados não mudam.

## Extras opcionais

- Em **Configurações**: `Client ID`/`Client secret` do Spotify (app criado em developer.spotify.com) deixam a importação
  de playlists longas mais rápida e precisa. Playlists públicas funcionam sem isso.
- `YOUTUBE_COOKIES=/data/cookies.txt` no `.env`: para importar suas "Músicas curtidas" do YouTube Music. Exporte o
  cookies.txt do navegador logado e salve em `GUITARR_DATA/guitarr/cookies.txt`. Depois: `docker compose up -d`.

## App no celular e no computador

Veja `apps/LEIA-ME.md`. Resumo: no Android, abra o endereço do Guitarr no Chrome → ⋮ → Instalar app. No Linux:
`bash apps/instalar-linux.sh https://seu-servidor`.

## Editar metadados e excluir músicas ou álbuns

Como administrador:
- **Álbum**: na barra superior da página do álbum ou no menu de 3 pontinhos (`⋮`) de qualquer álbum, há o botão **Editar Metadados** (para alterar nome do álbum, artista do álbum, ano e gênero de todas as faixas) e o botão **Excluir Álbum** (remove com confirmação os arquivos do disco e da biblioteca).
- **Música**: no menu de 3 pontinhos (`⋮`) de qualquer música, há o botão **Editar Metadados** (título, artista, álbum, artista do álbum, nº da faixa, disco, ano e gênero) e o botão **Excluir Música** (remove com confirmação o arquivo do disco e da biblioteca).
- As alterações são gravadas diretamente nas tags dos arquivos de áudio (via TagLib) e a biblioteca é sincronizada na hora por uma varredura rápida das pastas afetadas.

## Aba de Podcasts e downloads automáticos (YouTube e RSS)

No menu lateral, agora há a aba dedicada **Podcasts** (ícone de microfone):
- **Pesquisa e Adição**: você pode buscar podcasts do mundo todo diretamente (usando o diretório público do Apple Podcasts ou buscando no YouTube), ou colar qualquer link direto de feed RSS ou canal/playlist/vídeo do YouTube.
- **Busca unificada no Guitarr (Pedidos)**: ao pesquisar qualquer termo na barra de busca do Guitarr, além de músicas e álbuns, os podcasts relevantes do YouTube e feeds RSS são exibidos com botão direto de inscrição.
- **Política de Retenção Personalizada**:
  - **Manter apenas o último episódio**: ao sair um episódio novo, o Guitarr baixa o novo e apaga automaticamente o anterior do disco, poupando espaço.
  - **Manter os 3 últimos episódios**: mantém no máximo os 3 episódios mais recentes baixados, descartando os mais antigos.
  - **Baixar todos e manter todos**: baixa e preserva todo o histórico de episódios.
- **Download Periódico Semanal**: o agendador em segundo plano verifica periodicamente novos episódios dos canais inscritos. Você também pode clicar em **Verificar agora** ou **Verificar todos** a qualquer momento.
- **Player integrado**: cada episódio pode ser reproduzido diretamente no player do Guitarr com suporte a streaming contínuo, barra de progresso e controles de áudio.

## Dia a dia

| O quê | Comando |
|---|---|
| Atualizar o yt-dlp (quando o YouTube parar) | `docker compose build --no-cache guitarr && docker compose up -d` |
| Parar tudo | `docker compose down` |
| Backup | copie a pasta `GUITARR_DATA` e o arquivo `.env` |
| Limite de espaço | clique no quadro de armazenamento no canto de baixo do menu |
| Interface do slskd | `http://IP-DO-SERVIDOR:5030` (usuário e senha do painel, definidos no `setup.sh`) |

