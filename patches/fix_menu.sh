#!/bin/sh
# 1. Adiciona a ordenação de resources para que 'song' seja o primeiro
sed -i "/const resources = useSelector(getResources)/a \  resources.sort((a, b) => (a.name.toLowerCase() === 'song' ? -1 : b.name.toLowerCase() === 'song' ? 1 : 0));" /src/ui/src/layout/Menu.jsx

# 2. Substitui a renderização do Menu por uma versão com a ordem correta (Songs -> Álbuns)
# Usamos um arquivo temporário para evitar problemas de escape do shell
cat > /tmp/menu_render_block.txt <<'INNER_EOF'
    <div
      className={clsx(classes.root, {
        [classes.open]: open,
        [classes.closed]: !open,
      })}
    >
      {open && <LibrarySelector />}
      {resources.filter(subItems(undefined)).map(renderResourceMenuItemLink)}
      <SubMenu
        handleToggle={() => handleToggle('menuAlbumList')}
        isOpen={state.menuAlbumList}
        sidebarIsOpen={open}
        name="menu.albumList"
        icon={<AlbumIcon />}
        dense={dense}
      >
        {Object.keys(albumLists).map((type) =>
          renderAlbumMenuItemLink(type, albumLists[type]),
        )}
      </SubMenu>
      {config.devSidebarPlaylists && open ? (
        <>
          <Divider />
          <PlaylistsSubMenu
            state={state}
            setState={setState}
            sidebarIsOpen={open}
            dense={dense}
          />
        </>
      ) : (
        resources.filter(subItems('playlist')).map(renderResourceMenuItemLink)
      )}
    </div>
INNER_EOF

# Removemos a div antiga e inserimos a nova após o 'return ('
# Primeiro, removemos tudo desde a abertura da div até o fechamento da div final
sed -i '/<div\n      className={clsx(classes.root, {/,/<\/div>/d' /src/ui/src/layout/Menu.jsx

# Agora inserimos o novo bloco após a linha do return
# Usamos o comando 'r' do sed para ler o arquivo temporário de forma segura
sed -i '/return (/r /tmp/menu_render_block.txt' /src/ui/src/layout/Menu.jsx
