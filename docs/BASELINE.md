# Mesures de départ et checklist de non-régression

Mesuré le **2026-10-22** sur ce PC. `Mo` = mébioctet (1 048 576 octets), comme l'explorateur Windows.
Sources : API GitHub `Cantogrel/couch-stream-app/releases` (assets réels), dépôt local
`E:\Stream\Couch Stream App` (tag `v0.1.4`, propre), `desktop/src-tauri/target/release/…` (build local).

## 1. Taille de l'installeur

| Version | Installeur NSIS (asset de release) | APK | Note |
|---|---|---|---|
| v0.1.0 | 42 122 845 o = **40,17 Mo** | 3,14 Mo | build local de la même version : **39,84 Mo** (« 39,8 Mo » du brief) |
| v0.1.1 | 42 115 243 o = 40,16 Mo | 3,14 Mo | |
| v0.1.2 | 42 117 093 o = 40,17 Mo | 3,14 Mo | |
| v0.1.3 | 42 135 431 o = 40,18 Mo | 3,15 Mo | |
| **v0.1.4** | **42 130 295 o = 40,18 Mo** | **3 300 417 o = 3,15 Mo** | référence actuelle publiée |

- **Constat** : la valeur « 39,8 Mo » citée dans la décision 5 est le build local de v0.1.0 ; l'installeur
  **réellement publié** (v0.1.4) pèse 40,18 Mo. **Budget retenu pour Sunday Stream : ≤ 39,8 Mo** (plus strict,
  donc ≤ taille publiée). À confirmer par l'utilisateur si 40,2 Mo était plutôt visé.
- Le build local 0.1.0 donne `couch-stream-app.exe` = 12,2 Mo (coquille Tauri), `node.exe` embarqué = 81,6 Mo,
  sidecar = 78,3 Mo non compressé.
- Installeur compressé (NSIS/LZMA) : ≈ 40 Mo pour ≈ 12,2 + 81,6 + 78,3 ≈ 172 Mo bruts → ratio ≈ 0,23.

## 2. Poids des composants (non compressé)

| Composant | Taille | Remarque |
|---|---|---|
| `node.exe` (Node 22.20.0, `externalBin: binaries/node`) | **81,62 Mo** (85 588 976 o) | le plus gros bloc ; levier : version/ build plus léger ou SEA (à étudier en phase 1) |
| `pc-service/node_modules` (94 paquets) | **74,6 Mo** | idem dans `desktop/sidecar` (copie d'embarquement) |
| `pc-service/src` + `public` (code du service) | 0,18 Mo | négligeable |
| `app.apk` embarqué dans le sidecar | 3,14 Mo (v0.1.4 publiée : 3,15 Mo) | |
| `couch-stream-app.exe` (Tauri) | 12,2 Mo | |

### `node_modules` — modules les plus lourds

| Module | Taille | Levier probable |
|---|---|---|
| **`node-web-audio-api`** | **40,36 Mo** | contient les binaires natifs de **7 plateformes**; seul `win32-x64-msvc.node` (**6,90 Mo**) sert → **≈ 33,5 Mo récupérables** (darwin ×2 = 10,9 ; linux ×2 + arm-gnueabihf = 16,7 ; win32-arm64 = 5,4) |
| `mediabunny` | 10,26 Mo | tiré par une dépendance (vue dans `werift`) ; à vérifier si réellement utilisé |
| `web-streams-polyfill` | 8,62 Mo | polyfill probablement inutile sous Node 22 (déjà natif) ; à vérifier |
| `werift` | 4,05 Mo | WebRTC du micro téléphone (nécessaire) |
| `@noble/curves` | 1,96 Mo | dépendance transitive de `werift` |
| `@noble/hashes` | 1,09 Mo | idem |
| `pngjs` | 0,97 Mo | |
| `opusscript` | 0,90 Mo | décodage Opus (nécessaire) |
| `@msgpack/msgpack` | 0,62 Mo | |
| `@peculiar/x509` | 0,53 Mo | |
| `obs-websocket-js` | 0,47 Mo | nécessaire |
| `crypto-js` | 0,46 Mo | |
| `asn1js` | 0,28 Mo | |
| `type-fest` | 0,26 Mo | types seuls : retirable |

Lecture : retirer les binaires non win32-x64 de `node-web-audio-api` fait gagner ≈ 33 Mo bruts (≈ 8-13 Mo
compressés), largement de quoi absorber la bibliothèque `discord.js` **sans** extension native (décision 5) et rester
sous 39,8 Mo. Regrouper le service en un seul fichier (bundle) supprime aussi l'essentiel des ~90 paquets JS.
Rien de lourd ne doit être embarqué (ffmpeg est téléchargé au premier usage, décision 4).

### Bot Python (référence, ne sera pas repris)
`dist\SundayStreamBot.exe` : exe PyInstaller onefile unique (taille non mesurée ici, non pertinente pour le budget
de Sunday Stream).

## 3. Métadonnées de version relevées

| Élément | Valeur |
|---|---|
| Couch (`pc-service/package.json`, Cargo, tauri.conf) | `0.1.4` |
| APK `versionName` / `versionCode` | `0.1.4` / `6` |
| Sunday Stream Bot (`bundle_defaults.py`) | `1.1.4` (tag `v1.1.4` posé en phase 0) |
| Node (embarqué) | 22.20.0 |
| Installeur | NSIS `currentUser` (aucune élévation UAC) |

## 4. Checklist de non-régression

À rejouer à la fin de **chaque phase** concernée (cocher dans le journal de phase). « [A] » = couvre le contrat
Android (`CONTRACT-ANDROID-V1.md`), « [D] » = contrat Discord (`CONTRACT-DISCORD.md`).

### 4.1 Couch (téléphone + console PC)
- [ ] **Jumelage** [A] : QR → `POST /api/pair` → token propre ; code usage unique (rejeu = 403) ; révocation depuis
      la console ⇒ téléphone déconnecté (4003) et invité à rescanner.
- [ ] **Redécouverte** [A] : changer l'IP du PC → le téléphone retrouve le PC (mDNS puis balayage /24 via `/hello`).
- [ ] **Scènes / stream** [A] : liste des scènes, bascule en un tap, démarrer/arrêter le live, durée du live qui
      avance, repli propre quand OBS est fermé (« OBS non connecté », commandes grisées, reconnexion auto OBS 5 s).
- [ ] **Chat + modération** [A] : lecture live, envoi (retour « toi »), historique conservé au rechargement,
      suppression / timeout 10 min / ban (rendus « [message supprimé] / [timeout Ns] / [banni] »), pas de boutons sur
      ses propres messages, liste des connectés (`twitch.getChatters`), compteurs spectateurs/connectés.
- [ ] **Micro** [A] : capture téléphone → WebRTC/Opus → VB-Cable → source OBS ; fonctionne écran éteint
      (foreground service) ; mute / volume / gain / limiteur / tampon de gigue (10–200 ms) ; relance auto après coupure.
- [ ] **Santé** [A] : débit, fps, CPU, frames perdues/congestion, alertes de santé avec cooldown.
- [ ] **Notifications** [A] : premier message + cooldown, mentions, alerte santé, alerte déconnexion OBS/Twitch,
      pseudos ignorés ; uniquement en live ; canal alarme (son + vibration).
- [ ] **Mises à jour** [A] : (a) `welcome.pcVersion` > version de l'app ⇒ bandeau « Mettre à jour » ⇒ téléchargement
      de `/app.apk` ⇒ installation par-dessus, réglages conservés ; (b) MAJ du PC annoncée (`update.status`) et
      installable depuis le téléphone hors live ; (c) mise à jour automatique de l'app Windows (updater signé).
- [ ] **Console PC** : `/desktop` (aperçu, start/stop, scènes, santé, chat), `/setup` (OBS auto, VB-Cable, Twitch
      Device Code, source micro), diagnostic exportable (secrets masqués), instance unique, tray, autostart `--autostart`.
- [ ] **Compat app installée** [A] : une app Android **0.1.4 installée** se jumelle, pilote et se met à jour contre le
      nouveau service sans réinstallation (même `applicationId`, même keystore, `pcVersion ≥ 0.1.4`).
- [ ] **Données** [A] : `identity.json`, `devices.json`, `secrets.dat`, `.env` migrés sans perte ; ancien Couch
      fermé avant copie ; rien déplacé.

### 4.2 Bot Discord (ancien exe → module Discord)
- [ ] **4 choix** [D] : « Lancer le stream », « Juste ouvrir OBS », « Non » (rappel possible), « Non, plus ce soir »
      (plus de rappel) ; timeout 2 min = « Non ».
- [ ] **Lancement** [D] : OBS lancé si besoin (attente ≤ 40 s), scène « Démarrage », stream + enregistrement ; cas
      « OBS diffuse déjà » (`already`, pas de marqueur) ; cas échec ⇒ message `⚠️` sans footer.
- [ ] **Verrou** [D] : second PC rejoignant le vocal n'ouvre pas de fenêtre tant que `stream` sans `end` plus
      récent (< 12 h) ; un `end` le libère.
- [ ] **Anti-doublon** [D] : `window` / `stream` / `end` / `close` postés une seule fois par jour entre les 4 PC.
- [ ] **Rappels** [D] : voir §4 du contrat (statuts → coupe ou non les rappels).
- [ ] **Arrêt auto** [D] : fenêtre fermée ⇒ `close` ; bot coupé à fin +30 min seulement si pas de stream lancé par
      lui ; sinon surveillance OBS ~30 s puis `end` (durée correcte) puis arrêt ; filet +180 min ; `--stop` propre.
- [ ] **Coexistence** [D] : un PC « ancien exe » et un PC « Sunday Stream » partagent le même salon (verrou, dédup).
- [ ] **Clips** [D] : déclenchement (auto VU-mètres OBS et manuel) ⇒ sauvegarde Replay Buffer ⇒ message `pending`
      avec fichier (ou champ « trop volumineux ») + réactions ✅ ❌ posées par le bot ⇒ vote : 2 ✅ d'admins distincts
      = validé, 1 ❌ d'admin = refusé définitif ; non-admins ignorés ; message jamais supprimé ; miroir local.
- [ ] **Planification** [D] : plage −30 min / +30 min respectée **sans** tâche planifiée Windows.

### 4.3 Transverse
- [ ] Taille de l'installeur ≤ **39,8 Mo** (mesurée sur l'asset de release).
- [ ] Installation par utilisateur sans UAC ; désinstallation propre.
- [ ] Aucun secret dans le dépôt, les journaux, les diagnostics, les notes.
- [ ] Les deux anciens projets restent utilisables jusqu'à la bascule (phase 5).
