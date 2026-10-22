# Contrat Android v1 (PC ↔ téléphone)

Extrait du code réel de Couch Stream App **v0.1.4** (commit `1b49b1d`, tag `v0.1.4`), pas des notes.
Sources : `pc-service/src/wsServer.js`, `staticServer.js`, `devices.js`, `version.js`, `discovery.js`,
`secureStore.js`, `config.js`, `obs.js`, `twitch/irc.js`, `twitch/viewerStats.js`, `updater.js`,
`mobile-app/www/app.js`, plugins Java de `mobile-app/android/…/com/lescopaings/couchstream/`.

**But** : l'app Android déjà installée chez l'utilisateur doit continuer de marcher telle quelle avec le
service de Sunday Stream, et rester mettable à jour. Tout ce qui suit est donc **figé**.

## 0. Règle de gouvernance

- **Additif uniquement.** `PROTOCOL` reste `1`, `MIN_APP_PROTOCOL` reste `1`.
- Interdit : renommer/supprimer un message, une commande, un événement, une route, un champ ; changer le
  sens ou le type d'un champ ; rendre obligatoire un champ nouveau côté téléphone.
- Autorisé : nouveaux champs optionnels dans les messages existants, nouvelles commandes, nouveaux
  événements (le téléphone ignore les `event` inconnus : `default: log(...)`), nouvelles routes.
- Un champ ajouté à `state`/`event` ne doit jamais casser `Object.assign(app.obs, state)` (le téléphone
  fusionne l'état tel quel).
- Incrémenter `PROTOCOL` = rupture : seulement avec une nouvelle app Android ET un plan de bascule.

## 1. Identité Android (immuable)

| Élément | Valeur |
|---|---|
| `applicationId` | `com.lescopaings.couchstream` (`capacitor.config.json` `appId`, `build.gradle`) |
| `appName` | « Couch Stream App » (le nom de l'app Android ne change pas) |
| Version actuelle | `versionName "0.1.4"`, `versionCode 6` |
| Schéma WebView | `server.androidScheme = "http"` ; `usesCleartextTraffic="true"` (ws:// et http:// LAN) |
| Signature | keystore release `couchstream-release.keystore` (via `mobile-app/android/keystore.properties`, hors dépôt) |

**Keystore** : le même, sans exception. Android refuse d'installer par-dessus une APK signée autrement ;
une clé perdue = plus aucune mise à jour possible. Sauvegardes : secrets Actions `ANDROID_KEYSTORE_B64` /
`ANDROID_KEYSTORE_PASSWORD`, dépôt privé `Cantogrel/couch-stream-signing`, copie locale
`%USERPROFILE%\.couchstream-signing\`. **Le nouveau dépôt `sunday-stream` doit recevoir ces mêmes secrets
Actions** (phase 4) ; ne jamais en régénérer.

Permissions manifeste (à conserver) : INTERNET, ACCESS_NETWORK_STATE, RECORD_AUDIO,
MODIFY_AUDIO_SETTINGS, CAMERA (QR), POST_NOTIFICATIONS, FOREGROUND_SERVICE,
FOREGROUND_SERVICE_MICROPHONE, FOREGROUND_SERVICE_DATA_SYNC, WAKE_LOCK, REQUEST_INSTALL_PACKAGES,
ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE, ACCESS_NOTIFICATION_POLICY.

Plugins natifs présents dans l'APK (le contrat serveur n'en dépend pas, mais l'APK les appelle) :
`Discovery.find({timeoutMs})` → `{services:[{host,port,id,name}]}` ; `AppUpdate.downloadAndInstall({url})`,
`AppUpdate.install()`, `AppUpdate.openInstallSettings()`, évènement `progress {percent}` ;
`KeepAlive.start/stop/setKeepScreenOn/ensureAlarmChannel/postAlert`.

## 2. Transport et ports

- **Un seul port** pour HTTP et WebSocket (upgrade sur le même serveur HTTP). Défaut **8765**
  (`LOCAL_WS_PORT`, `config.localWs.port`).
- **Repli** (`_listenWithFallback`) : essaie `8765 … 8774` (10 ports) ; au premier libre il l'utilise,
  l'écrit dans `.env` (`LOCAL_WS_PORT`) et annonce le port réel par mDNS et `/hello`.
  Erreur fatale seulement si aucun port libre.
- Le téléphone stocke `host`, `port` (chaîne), `token`, `pcId`, `pcName` ; il se connecte à
  `ws://<host>:<port>` (clé `localStorage` `couchStreamApp.settings`).
- Écoute LAN (pas seulement loopback) ; pas de TLS.
- Après ≥ 2 échecs de suite, le téléphone lance une redécouverte (mDNS puis balayage /24 sur `/hello`,
  port = dernier connu ou 8765, **valeur lue ensuite dans `info.port`**), puis retente toutes les 3 s.

## 3. Messages WebSocket (JSON texte)

### 3.1 Téléphone → PC

**`auth`** (obligatoire, premier message, dans les **5000 ms** sinon fermeture `4001 "auth timeout"`)
```json
{ "type": "auth", "token": "<token>", "appVersion": "0.1.4", "protocol": 1 }
```
- `token` = token propre à un appareil jumelé (vérifié par SHA-256 contre `devices.json`) **ou** token
  partagé historique `LOCAL_WS_TOKEN` (console PC en boucle locale, anciens jumelages).
- `appVersion` : chaîne, tronquée à 20 caractères, stockée dans `devices.json`.
- `protocol` : entier. Absent = accepté sans avertissement.
- Token invalide ⇒ fermeture **`4003 "auth invalide"`**. Le téléphone efface alors son token et demande de
  rescanner le QR (ne retente pas).
- Tout autre message avant authentification est ignoré.

**`command`**
```json
{ "type": "command", "id": 1, "action": "obs.switchScene", "payload": { "sceneName": "Jeu" } }
```
Les commandes d'une même connexion sont **sérialisées** (file par client). `payload` absent ⇒ `{}`.

**`webrtc-offer`** `{ "type":"webrtc-offer", "sdp":"<SDP>" }` — remplace tout flux audio précédent du client.
**`webrtc-ice`** `{ "type":"webrtc-ice", "candidate": <RTCIceCandidateInit> }`.
**`webrtc-hangup`** `{ "type":"webrtc-hangup" }`.

JSON invalide ⇒ `{ "type":"error", "error":"JSON invalide" }`.

### 3.2 PC → téléphone

| `type` | Quand | Champs |
|---|---|---|
| `welcome` | juste après auth réussie | `pcVersion` (version du service, ex. `"0.1.4"`), `protocol` (=1) |
| `incompatible` | auth OK mais `msg.protocol < MIN_APP_PROTOCOL` (jamais bloquant) | `pcVersion`, `minProtocol` |
| `state` | après `welcome`, et à chaque (re)connexion/perte d'OBS | état OBS complet (§3.3) |
| `chat-history` | une fois après auth | `messages: [<message de chat>]` (cap 300, mémoire du process) |
| `event` | diffusé à tous les clients authentifiés | `name` + champs (§3.4) |
| `result` | réponse à `command` | `id`, `ok` (bool), `data` (si ok, `null` par défaut) ou `error` (chaîne) |
| `webrtc-answer` | réponse à une offre | `sdp` |
| `webrtc-ice` | candidat ICE côté PC | `candidate` |
| `error` | erreur hors commande | `error` (chaîne) : « JSON invalide », « état OBS indisponible: … », « sortie audio indisponible: … », « offre WebRTC refusée: … » |

Séquence exacte après auth réussie : [`incompatible`?] → `welcome` → `state` (ou `error`) → `chat-history` →
`event twitch.viewers` → `event update.status`. Le téléphone s'appuie sur `welcome.protocol > 1` pour
afficher « PC plus récent que l'app », et sur **`welcome.pcVersion`** pour décider de la mise à jour de l'APK
(voir §6).

### 3.3 Objet `state` (message `state` et résultat de `state.get`)

```
obsConnected: bool
scenes: string[]            // ordre inversé par rapport à OBS
currentScene: string|null
streaming: bool
streamDurationMs: number|null
droppedFrames: number|null
totalFrames: number|null
congestion: number|null
micMuted: bool|null
micVolume: number|null      // multiplicateur OBS (inputVolumeMul)
```
OBS fermé ⇒ `{obsConnected:false, scenes:[], currentScene:null, streaming:false, streamDurationMs:null,
droppedFrames:null, totalFrames:null, congestion:null, micMuted:null, micVolume:null}` (jamais une erreur).
La source micro OBS s'appelle `MIC_INPUT_NAME` = `Micro Téléphone (Couch Stream App)` par défaut (`MIC_INPUT_NAME` en variable d'environnement) ; les scènes OBS des utilisateurs la contiennent déjà : **ne pas la renommer** sans migration.

### 3.4 Évènements (`type:"event"`, champ `name`)

| `name` | Champs | Émis par |
|---|---|---|
| `obs.scene_changed` | `sceneName` | OBS |
| `obs.stream_state` | `active` (bool) | OBS |
| `obs.mic_mute_changed` | `muted` | OBS |
| `obs.mic_volume_changed` | `volume` | OBS |
| `obs.connection` | `connected` (bool) | OBS (suivi d'un `state` complet) |
| `twitch.connection` | `connected` (bool), `reason?` | IRC |
| `twitch.viewers` | `live` (bool), `viewers` (int\|null), `chatters` (int\|null) | poll 30 s ; aussi à l'auth |
| `update.status` | `state`, `current?`, `version?`, `notes?`, `progress?`, `message?` | relais MAJ Windows ; aussi à l'auth |
| `chat.message` | message de chat (ci-dessous) | IRC |
| `chat.message_deleted` | `id`, `reason` (`delete`\|`timeout`\|`ban`), `duration?` (s) | IRC (CLEARMSG/CLEARCHAT) |
| `webrtc.connection` | `state` (`failed`/`closed`/`stalled` déclenchent un redémarrage micro côté téléphone) | audio |

`update.status.state` ∈ `unknown | idle | checking | available | uptodate | downloading | installing | error`.

**Message de chat** : `{ id, userId, username, displayName, text, self (bool), isMod (bool),
isBroadcaster (bool), timestamp (ms), deleted (bool) }` ; après modération : `deleted:true`, `reason`,
`duration?`.

### 3.5 Commandes (`action` → `payload` → `data`)

Toutes répondent `result {id, ok, data|error}`. « Util. » = appelée par `mobile-app/www/app.js` v0.1.4.

| `action` | `payload` | `data` (si ok) | Util. |
|---|---|---|---|
| `state.get` | – | objet `state` | non |
| `obs.switchScene` | `sceneName` | `null` | oui |
| `obs.startStream` | – | `null` | oui |
| `obs.stopStream` | – | `null` | oui |
| `obs.toggleMic` | – | `{muted}` | oui |
| `obs.setMicMuted` | `muted` (bool) | `null` | non |
| `obs.setMicVolume` | `volume` (number, multiplicateur) | `null` | oui |
| `obs.getHealth` | – | `{streaming, bitrateKbps\|null, fps, cpuPct, renderMs, skippedRender, droppedFrames, totalFrames, congestion}` | oui |
| `obs.getScreenshot` | `width?` (borné 160–1280, défaut 480) | `{dataUrl}` (JPEG qualité 55) | oui |
| `obs.launch` | – | `{ok:true,…}` ou erreur | oui |
| `audio.setJitterBuffer` | `ms` (10–200) | `{ms}` ; sinon erreur « jitter buffer hors plage (10-200 ms) » | oui |
| `audio.getSettings` | – | `{jitterBufferMs}` | non |
| `twitch.getChatters` | – | `{total, names[≤500, tri fr], truncated, partial, reason\|null}` | oui |
| `chat.send` | `message` | – | oui |
| `chat.delete` | `messageId` | – | oui |
| `chat.timeout` | `username`, `duration?` (défaut 600), `reason?` | – | oui |
| `chat.ban` | `username`, `reason?` | – | oui |
| `chat.unban` | `username` | – | non |
| `update.getStatus` | – | `update.status` | oui |
| `update.check` | – | – | oui |
| `update.install` | – | – ; refuse si pas `available` ; **jamais de `force` depuis le téléphone** | oui |

Action inconnue ⇒ `{ok:false, error:"Action inconnue: <action>"}`. Erreurs OBS typiques :
« OBS n'est pas connecté ». `update.*` hors app Windows ⇒ « Les mises à jour ne sont gérées que par
l'application Windows installée. »

### 3.6 Audio micro (WebRTC)

Le téléphone envoie une offre ; le PC répond `webrtc-answer`, échange des `webrtc-ice`, décode l'Opus et
l'injecte dans la sortie « CABLE Input (VB-Audio Virtual Cable) » (`VBCABLE_OUTPUT_DEVICE_LABEL`), tampon de
gigue 30 ms par défaut (`AUDIO_JITTER_BUFFER_MS`). La sortie n'est ouverte que tant qu'au moins un client
envoie (`activeMicCount`). À la reconnexion, le téléphone relance seul le micro et réapplique son tampon.
Contrainte de remplacement : tout autre moteur WebRTC doit accepter le SDP/ICE d'un WebView Chrome Android.

## 4. Routes HTTP utilisées par le téléphone

Même port que le WS. CORS : `Access-Control-Allow-Origin: *`, `Allow-Headers: Content-Type`, `OPTIONS ⇒ 204`.

| Route | Méthode | Accès | Contrat |
|---|---|---|---|
| `/hello` | GET | LAN, sans token | `{ app:"couch-stream", id, name, version, protocol, port }` — **`app` doit rester `"couch-stream"`** (le téléphone rejette toute autre valeur). `id` = `identity.id`. |
| `/api/pair` | POST | LAN | corps JSON (envoyé en `text/plain`) `{ code, name }` → 200 `{ token, pcId, name }` ; 403 `{ error:"code invalide ou expiré" }`. Code à usage unique, **consommé même en cas d'échec**, valable 10 min, 5 codes vivants max. Corps ≤ 4096 caractères. `name` ≤ 60 car. (défaut « Téléphone »). |
| `/app.apk` | GET | LAN | APK servi en `application/vnd.android.package-archive`, `Content-Length`, `Content-Disposition: attachment; filename="CouchStream.apk"`. 404 si absent. |
| `/` | GET | LAN | sert `index.html` (UI web du téléphone, `mobile-app/www`, repli sur `pc-service/public/`) — utilisé par le navigateur du téléphone et la console `/desktop`. |

Routes **loopback uniquement** (Host `127.0.0.1`/`localhost`/`[::1]` + IP source locale ; hors périmètre
téléphone mais dont la console dépend) : `/desktop`, `/setup`, `/pair`, `/api/status`, `/api/diagnostics`,
`/api/session` (révèle `LOCAL_WS_TOKEN`), `/api/pairing`, `/api/devices` (GET, `DELETE /api/devices/<id>`),
`/api/update`, `/api/update/check`, `/api/update/install`, `/api/obs/launch`, `/api/setup/*`.

**Format du QR** (affiché par la console) : `{ "v":2, "host":"<IP LAN>", "port":<n>, "pcId":"<uuid>",
"name":"<nom PC>", "code":"<32 hex>" }`. L'app accepte aussi l'ancien format `{host,port,token}` (sans `code`).
Le téléphone échange ensuite `code` contre son token via `POST http://host:port/api/pair`.

## 5. Découverte mDNS

- Type de service : **`_couchstream._tcp`** (Android : `"_couchstream._tcp."`, DNS-SD).
- Nom d'instance annoncé : `Couch Stream (<nom du PC>)` (libre, non lu par l'app).
- Port : port réel du serveur.
- TXT : **`id`** = `identity.id` (UUID du PC), **`name`** = nom du PC. Le téléphone retrouve « son » PC en
  comparant `id` avec le `pcId` mémorisé.
- Repli : balayage /24 + `GET /hello`. L'annonce peut échouer sans être fatale.
- Sunday Stream **réutilise ce type de service et cet `id`** (la migration copie `identity.json`) ; ne pas
  annoncer un autre type pour le téléphone (un type additionnel est permis).

## 6. Mise à jour de l'APK (point critique)

Le téléphone compare **`welcome.pcVersion`** à sa propre version (`App.getInfo().version`) avec un compare
semver tolérant (`cmpVersion`). Si `pcVersion > appVersion` et plugin `AppUpdate` présent, il propose
« Mettre à jour » et télécharge `http://<host>:<port>/app.apk`, puis Android installe par-dessus.

Conséquences impératives pour Sunday Stream :

1. **`pcVersion` doit être ≥ `0.1.4` et croissante** (ne pas repartir à `0.1.0`/`1.0.0` incohérent) : sinon
   le téléphone ne proposera jamais de mise à jour, ou en proposera une à tort.
2. L'APK servi par `/app.apk` doit avoir **`versionName == pcVersion`** et un `versionCode` **strictement
   supérieur** à 6 (valeur courante), même `applicationId`, même keystore.
3. L'APK est copié dans `sidecar/app.apk` par le build (`desktop/scripts/stage-sidecar.mjs`) ; candidats de
   recherche : `<sidecar>/../app.apk`, `…/app-release.apk`, `…/app-debug.apk`.
4. L'ancienne app Windows Couch met à jour via `…/couch-stream-app/releases/latest/download/latest.json`
   (clé publique Tauri dans `tauri.conf.json`). **Comme `couch-stream-app` ne recevra plus de release, un Couch
   installé ne se mettra jamais à jour vers Sunday Stream** : la migration est manuelle (installeur Sunday
   Stream téléchargé). Sunday Stream utilisera son propre endpoint et sa propre clé de signature d'updater.
5. Le canal de MAJ du **PC** vers le téléphone (`update.*`) passe par `update-status.json` /
   `update-request.json` dans le dossier de données — à conserver tel quel côté service.

## 7. Fichiers de données à migrer (`%APPDATA%\CouchStreamApp` → `%APPDATA%\SundayStream`)

Copie (sans déplacer), ancien Couch fermé, avec confirmation :

| Fichier | Rôle | Remarques |
|---|---|---|
| `identity.json` | `{id (UUID), name (hostname)}` — identité du PC | **À copier tel quel** : le téléphone retrouve le PC par `pcId`. |
| `devices.json` | téléphones jumelés : `[{id, name, tokenHash (SHA-256), createdAt, lastSeenAt, appVersion?}]` | **À copier** : sinon tous les jumelages sont perdus (rescan QR). Seul le hash est stocké. |
| `secrets.dat` | jetons Twitch, Base64 de `ProtectedData.Protect(UTF8(json), null, 'CurrentUser')` (DPAPI, **portée utilisateur Windows, sans entropie**) | Déchiffrable seulement par le même compte Windows sur le même PC. Copie binaire directe OK ; sur un autre PC/compte il faut refaire la connexion Twitch (Device Code). Format de lecture/écriture à conserver. |
| `.env` | `LOCAL_WS_PORT`, `LOCAL_WS_TOKEN` (token partagé historique), `OBS_WEBSOCKET_URL`/`PASSWORD`, `TWITCH_CHANNEL_LOGIN`, … | Contient des secrets : ne jamais afficher. `LOCAL_WS_TOKEN` doit être conservé (anciens jumelages par token partagé). |
| `setup.json` | état de l'assistant de premier lancement | |
| `obs-path.txt` | chemin d'OBS détecté | |
| `update-status.json` | écrit par l'app Windows | non migré (recréé). |
| `service.log`, `service.old.log`, `updater.log`, `starting.html`, `update.html` | journaux / pages internes | non migrés. |

L'ancienne variable `COUCH_DATA_DIR` (fixée par l'app Windows) devient le dossier de données de Sunday Stream.
`migrateLegacyEnv` n'écrase jamais un `.env` existant.

## 8. Identité Windows (rappel, hors protocole téléphone)

Couch : produit « Couch Stream App », identifiant Tauri `com.binagames.couchstream`, NSIS `currentUser`,
sidecar `externalBin: binaries/node` + ressources `sidecar/`. Sunday Stream : « Sunday Stream »,
`com.binagames.sundaystream`, `%APPDATA%\SundayStream`. Ces valeurs ne touchent pas le protocole téléphone.

## 9. Checklist de conformité (à rejouer à chaque phase)

- [ ] `GET /hello` renvoie `app:"couch-stream"`, `id` stable, `port` réel.
- [ ] `POST /api/pair` : code valide → token ; code réutilisé/expiré → 403.
- [ ] Auth par token d'appareil jumelé **et** par token partagé ; mauvais token ⇒ 4003 ; silence 5 s ⇒ 4001.
- [ ] Séquence `welcome`→`state`→`chat-history`→`twitch.viewers`→`update.status`.
- [ ] Les 21 commandes du §3.5 répondent selon le tableau ; action inconnue ⇒ erreur lisible.
- [ ] Les 11 évènements du §3.4 gardent leurs noms et champs.
- [ ] mDNS `_couchstream._tcp` + TXT `id`/`name` visibles ; le téléphone retrouve le PC après changement d'IP.
- [ ] Repli de port 8765→8774 + annonce du port réel.
- [ ] `/app.apk` sert une APK signée par le keystore d'origine, `versionName == pcVersion`, `versionCode > 6`.
- [ ] `pcVersion ≥ 0.1.4` et croissante.
- [ ] Une app 0.1.4 installée se jumelle, pilote OBS/chat/micro et se met à jour contre le nouveau service.
