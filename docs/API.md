# Guitarr (on-demand acquisition)

Search the whole MusicBrainz catalog from Guitarr. Items you own are flagged
`inLibrary`; anything else can be requested and is fetched by YouTube (yt-dlp),
Soulseek (slskd) or Lidarr, then scanned into the library.

Code: `core/acquire` (engine, no server imports), `core/seer` (config,
library matching, scanner), `server/seerapi` (HTTP), migration
`db/migrations/20261010000000_create_acquire_request.sql`.

## Web UI

The UI is a single generated HTML file (`ui/build.py`), served at `/app/`, in English or
Brazilian Portuguese (Settings or the account menu). A **Requests** entry in the sidebar lists
the queue, where admins approve pending requests or retry failed ones. Searching from the top
bar shows the library results first and, below them, the MusicBrainz catalog (songs, albums,
artists with Cover Art Archive covers) with a Request button for what is not in the library yet.
Artist pages list the discography (albums, EPs, live...), album pages the tracklist.

## Importing playlists

On the Requests page, paste a Spotify or YouTube Music playlist/album link or
upload an export (Exportify CSV, Spotify data-export JSON, Google Takeout CSV,
or "Artist - Title" lines). Every song is matched to MusicBrainz (by ISRC when
Spotify gives one, else artist + title + length), songs already in the library
are kept, missing ones are requested, and a Guitarr playlist with the same
name is kept in order as songs arrive. Songs with no match can be picked by
hand. Linked playlists can be re-read every day ("Sync every day").

- Spotify public playlists work without setup (read from the embed page). For
  long playlists and ISRC matching, create an app at developer.spotify.com and
  set `Seer.Spotify.ClientID` / `ClientSecret`. Liked Songs are private:
  export them with Exportify and upload the CSV.
- YouTube Music public playlists are read with yt-dlp. For "Liked music"
  (`https://music.youtube.com/playlist?list=LM`) set `Seer.YouTube.Cookies` to
  a cookies.txt exported from a browser where you are logged in.

## Storage limit

The bottom of the sidebar shows how much the music takes (all libraries, from
the last scan) and the free space on the disk that holds `DestFolder`. Clicking
it opens a dialog where an admin sets a limit (or none). Once the library
reaches the limit, or the disk has less than `MinFreeSpace` free, new requests
answer 507 and queued ones fail with "storage limit reached"; retry them after
freeing space or raising the limit. Nothing is ever deleted. The limit set in
the UI is stored in the database and wins over `Seer.StorageLimit`.

## Duplicate songs

The same dialog lists songs that are in the library more than once (same
album, disc and title, lengths within 3 seconds) and, for admins, has a
"Clean up duplicates" button. The best copy of each song stays: a file outside
`DestFolder` (the user's own) always wins, then lossless, then bitrate. Only
copies inside `DestFolder` are removed; they are moved to
`<DataFolder>/seer-trash/<date>/` and purged after 7 days, then the library is
rescanned.

Guitarr also avoids making duplicates: a retried album request whose folder
already has audio files is not downloaded again (it just waits for the scan),
a Soulseek import replaces earlier copies of the same track in the folder, and
the library match ignores case, accents and punctuation in artist and album
names (MusicBrainz writes "blink‐182" with a Unicode hyphen).

## Look and apps

Themes: dark, OLED black and light (account menu or Settings). The web app is installable
(manifest "Guitarr", maskable icon, shortcuts): Chrome/Edge on Android or desktop offer
"Install app", also from the user menu.

## Configuration

```toml
[Seer]
Enabled = true
AutoApprove = false              # false: an admin must approve each request
Sources = "lidarr,soulseek,youtube,soundcloud"  # priority order; first one that succeeds wins
DestFolder = ""                  # default: <first library>/Seer. Must be inside a library
Workers = 2
ImportTimeout = "30m"            # how long to wait for the scan to find a download
StorageLimit = ""                # e.g. "500GB"; no new downloads past it (editable in the UI)
MinFreeSpace = "2GB"             # no new downloads when the disk has less free
UserAgent = ""                   # sent to MusicBrainz; please set one with your contact
MusicBrainzURL = "https://musicbrainz.org/ws/2"

[Seer.YouTube]                   # tracks only; lossy audio
Enabled = true
Path = "yt-dlp"
Format = "opus"
Cookies = ""                     # cookies.txt: private YouTube Music lists, and downloads YouTube blocks

[Seer.SoundCloud]                # tracks only, through the same yt-dlp
Enabled = true

[Seer.Spotify]                   # optional, for playlist imports
ClientID = ""
ClientSecret = ""

[Seer.Soulseek]                  # tracks and albums
Enabled = false
URL = "http://slskd:5030"
ApiKey = ""
DownloadFolder = "/slskd/downloads"  # slskd's downloads folder, as Guitarr sees it
PreferFLAC = true

[Seer.Lidarr]                    # albums only; Lidarr must import into a Guitarr library
Enabled = false
URL = "http://lidarr:8686"
ApiKey = ""
RootFolder = "/music"
QualityProfileID = 1
MetadataProfileID = 1
```

Environment variables work as usual, e.g. `ND_SEER_ENABLED=true`,
`ND_SEER_SOULSEEK_APIKEY=...`.

## API (authenticated, under `/api/seer`)

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/catalog?q=&limit=` | any user | catalog search: artists, albums, tracks, each flagged `inLibrary` |
| GET | `/catalog/artist/{mbid}` | any user | artist and discography |
| GET | `/catalog/album/{mbid}` | any user | album and tracklist |
| GET | `/requests` | any user | own requests; admins get all (`?mine=true` for own) |
| POST | `/requests` | any user | body: a catalog item. 409 if already in the library, 507 past the storage limit; returns the existing request if someone already asked for it |
| GET | `/requests/{id}` | owner or admin | one request |
| POST | `/requests/{id}/approve` | admin | queue a pending request, or retry a failed one |
| GET/POST | `/imports` | any user | list imports; start one (`{"url","sync"}` or multipart `file`) |
| GET/PUT/DELETE | `/imports/{id}` | owner or admin | import with its songs; `{"sync"}`; forget it |
| POST | `/imports/{id}/items/{pos}/resolve` | owner or admin | body: the catalog track picked for an unmatched song |
| GET | `/storage` | any user | `used`, `limit`, `diskTotal`, `diskFree`, `minFree`, `full`, `reason` (bytes) |
| PUT | `/storage` | admin | body: `{"limit": bytes}`, 0 removes the limit |
| GET | `/duplicates` | admin | `groups` (each with `files`, `remove` on the extra copies), `files`, `bytes` |
| POST | `/duplicates/clean` | admin | move the extra copies to the trash; same report plus `trash` |

Statuses: `pending` → `queued` → `searching` → `downloading` → `importing` →
`available`, or `failed` with `error`.

MusicBrainz responses are cached for 10 minutes and retried when MusicBrainz
answers 503/429; a 502 from the catalog endpoints means it still failed (the
cause is in the server log, "Seer: MusicBrainz request failed").

## How a request flows

1. Approved requests are queued; queued and in-progress requests survive restarts.
2. Sources are tried in order. YouTube files are named and tagged from
   MusicBrainz (title, artist, album, recording MBID) with ffmpeg, so the scan
   matches them by MBID. Soulseek downloads are polled until complete and moved
   to `DestFolder/Artist/Album/`. Albums come from a single folder (never mixing
   releases, one format); a track that fails is retried once and then taken from
   another peer's copy of the album. If at least half the album arrived it is
   imported and the missing tracks are listed on the request; otherwise it fails. Lidarr is asked to search and imports on its own.
   Web sources (YouTube, SoundCloud) search first and score the results
   against the request (title as whole words, artist, length within a few
   seconds, "live"/"cover"/"remix" uploads pushed down unless asked for).
   YouTube searches YouTube Music (official "Topic" audio) before regular
   YouTube; each of the 3 best results is tried with yt-dlp's default client
   and then two other player clients, and a try that takes over 4 minutes is
   dropped for the next result. If no album source gets an album, it is built
   track by track from the MusicBrainz tracklist through the web sources
   (source "tracks", progress "track N of M" on the request), kept if at
   least half arrived, with the missing tracks listed.
   Retrying a failed request (approve it again) goes another way: the sources
   that failed last time are tried last, web searches use another phrasing and
   start from other uploads, yt-dlp player clients are tried in reverse order,
   and Soulseek starts from the next peer (patch 0013). This is kept in memory,
   so a server restart forgets which sources failed.
3. A watcher (not the workers) waits for the library scan to find the item,
   rescanning every 2 minutes, and fails the request after `ImportTimeout`.

## Tags and near duplicates (patch 0014)

- Files that come from Soulseek are retagged after the download with the MusicBrainz data of the
  request (album, album artist, year, track titles/numbers and the MBIDs of release, release group,
  artist and recording). Tracks are matched to the tracklist by title, then by track number; a file
  that matches nothing only gets the album-level tags. A failed retag adds a warning and never fails
  the request.
- `GET /api/seer/library/metadata-report` (admin) lists albums and artists that are the same once
  case, accents and punctuation are ignored, albums without a MusicBrainz release id and tracks
  without tags. It changes nothing. `PUT /api/seer/library/album/{id}` also accepts `mbzAlbumId`,
  `mbzReleaseGroupId` and `mbzAlbumArtistId`.
- The "Organizar Metadados" screen uses both to merge albums, unify artist spellings and apply
  MusicBrainz suggestions (it rewrites the tags in the files).

## Not done yet

- Lidarr and slskd API shapes are untested against live instances.
- Per-user quotas, rate limits, reject/cancel requests.
- Subsonic clients (Symfonium, Feishin...) don't see catalog results yet.
