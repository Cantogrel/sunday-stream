# Plan Sunday Stream

Fusion de **Sunday Stream Bot** (Python) et **Couch Stream App** (Tauri + Node) en un seul projet, *Sunday Stream*, qui gère
tout ce qui touche au stream. Conversation de cadrage : session Claude Code `local_cf019feb-657f-43e1-9b4e-54d81000c4ef`
(« Sunday Stream unification plan »), export texte dans `docs/history/`.
Documents liés : `CONTRACT-ANDROID-V1.md`, `CONTRACT-DISCORD.md`, `BASELINE.md`.

## 1. Point de départ

- **Sunday Stream Bot** — `E:\Stream\Sunday Stream Bot`, Python, v1.1.4 (`bundle_defaults.py`), sous git local depuis la
  phase 0 (tag `v1.1.4`, aucun remote). Exe PyInstaller unique (`--bot`, `--stop`, `--confirm-dialog`, `--detect-id`),
  configuration Tkinter → `.env` à côté de l'exe + tâches planifiées `SundayStreamBot_Start/_Stop`. Le bot détecte l'arrivée du
  joueur dans le vocal pendant une plage horaire, propose 4 choix, lance OBS + stream + enregistrement. 4 amis, même bot et
  même token ; le salon de logs sert de journal et de verrou (pieds de message `sundaybot|<kind>|<YYYY-MM-DD>`). Clips :
  `signals.py` (score micro/voix/inputs) → Replay Buffer OBS → salon clips + vote d'admins (`sundaybot|clip|<id>|<statut>`,
  2 ✅ admins = validé, 1 ❌ = refusé). **La détection auto ne marche pas** (voix saturée à 1.00, inputs à 0.00).
- **Couch Stream App** — `E:\Stream\Couch Stream App`, git, public `github.com/Cantogrel/couch-stream-app`, tags
  `v0.1.0 → v0.1.4`, CI de release GitHub Actions. Appli Windows **Tauri v2** (tray, instance unique, autostart,
  updater signé via `latest.json`, NSIS par utilisateur, `com.binagames.couchstream`) qui supervise un **service Node**
  `pc-service` (OBS, Twitch IRC/Helix + Device Code + jetons DPAPI, audio téléphone WebRTC → VB-Cable, WebSocket 8765
  protocole v1, console `/desktop`, `/setup`, `/api/*`, `/app.apk`, mDNS `_couchstream._tcp`). Données `%APPDATA%\CouchStreamApp`.
  App Android **Capacitor** `com.lescopaings.couchstream` (jumelage `/api/pair`, redécouverte par `pcId`, MAJ de l'APK via
  `/app.apk` du PC).

## 2. Décisions actées (ne pas rediscuter)

1. **Base technique = Couch** (Tauri + un seul service Node). Le bot Discord est réécrit en Node (`discord.js`) dans ce service ;
   plus de Python ; plus de tâches planifiées (planification interne) ; vraie fenêtre d'appli avec menu latéral
   (**En direct · Stream & OBS · Chat Twitch · Téléphone · Discord · Clips · Réglages**), style de la console Couch.
2. **Les 4 amis installeront Sunday Stream** : modules activables (**Discord / Canapé / Clips**), code d'invitation de groupe
   (IDs de salons, jamais le token), mises à jour automatiques. **Compatibilité obligatoire avec l'ancien exe pendant la
   transition** (marqueurs Discord identiques — `CONTRACT-DISCORD.md`).
3. **L'app Android installée continue de marcher telle quelle** et reste mettable à jour : protocole v1 figé, évolutions
   additives seulement, même `applicationId`, même keystore, APK toujours servi par `/app.apk` (`CONTRACT-ANDROID-V1.md`).
4. **Clips : pas de refonte maintenant.** Reprise à l'identique en Node (Replay Buffer, post Discord, vote), détection auto
   via les VU-mètres OBS, déclencheurs manuels ; architecture en étapes (**source → moments → extraction → bibliothèque →
   vote → publication**) pour brancher plus tard l'import de VOD. ffmpeg téléchargé au premier usage. Dossier
   `E:\Stream\Clips\SteelSeries Moments` : plus tard, comme « dossier source » en lecture seule.
5. **Installeur léger** : ne pas dépasser la taille actuelle de Couch (39,8 Mo pour v0.1.0 en build local ; **40,18 Mo pour
   la v0.1.4 publiée** — voir `BASELINE.md`, budget retenu ≤ 39,8 Mo). `node.exe` 81,6 Mo et `node-web-audio-api` 40,4 Mo non
   compressés, APK 3,15 Mo. Leviers : binaires **win32-x64 seulement**, service **regroupé en un seul fichier**, pas
   d'extensions natives `discord.js`, rien de lourd embarqué.
6. **Nouveau dépôt public `Cantogrel/sunday-stream`** (créé en phase 1, pas avant), à partir de l'historique Couch, e-mail des
   commits `mathieu.cantogrel@gmail.com`. Le code Python n'y est **jamais** importé. Le dépôt `couch-stream-app` ne reçoit plus
   de release.
7. **Nouvelle identité** : produit « Sunday Stream », identifiant `com.binagames.sundaystream`, données `%APPDATA%\SundayStream`,
   dossier `E:\dev\Sunday Stream` (initialement `E:\Stream\Sunday Stream`, déplacé le 2026-10-23). **Migration au premier lancement** (phase 1/2) : fermer l'ancien Couch, copier ses données
   (sans les déplacer), importer le `.env` du bot, supprimer les tâches planifiées — toujours avec confirmation.

## 3. Points d'attention issus de la phase 0 (code réel)

- **Version et mise à jour de l'APK** : le téléphone compare `welcome.pcVersion` à sa version ; Sunday Stream doit donc
  démarrer à **≥ 0.1.4** et servir une APK `versionName == pcVersion`, `versionCode > 6`, même keystore.
- **Updater Windows** : l'ancien Couch interroge `…/couch-stream-app/releases/latest/download/latest.json`; comme ce dépôt
  ne reçoit plus de release, **un Couch installé ne se mettra jamais à jour vers Sunday Stream** — migration par installeur
  téléchargé, et nouvelle clé de signature d'updater propre à Sunday Stream (la clé Couch reste dans `couch-stream-signing`).
- **Secrets de signature** : le keystore Android **doit être réutilisé** (secrets Actions à recréer dans le nouveau dépôt).
- **Taille** : l'installeur publié (40,18 Mo) dépasse déjà 39,8 Mo ; le gain attendu de ≈ 33 Mo bruts sur
  `node-web-audio-api` (autres plateformes) couvre largement `discord.js`.
- **Verrou Discord** : non atomique, limité aux 30 derniers messages et à 12 h — reproduire à l'identique, ne pas « corriger »
  avant la fin de la compatibilité.
- **Données DPAPI** : `secrets.dat` n'est lisible que par le même compte Windows ; sur un autre PC, la connexion Twitch
  est à refaire (Device Code).

## 4. Phases et critères de validation

La phase est **terminée** quand tous ses critères sont cochés **et validée par l'utilisateur**. À chaque fin de phase :
mise à jour de la roadmap Studio OS, du `SUMMARY.md` du vault et de `BASELINE.md §4` (non-régression).

### Phase 0 — Préparation *(aucun code applicatif)*
Travail : sauvegardes, bot sous git local, vérification de Couch, contrats, mesures, plan, notes du vault.
- [ ] Sauvegardes dans `E:\Stream\_backups\2026-10-22-avant-fusion\` (hors de tout dépôt, secrets jamais affichés).
- [ ] Bot sous git **local** : commit « Snapshot v1.1.4 avant fusion », tag `v1.1.4`, aucun secret versionné, aucun remote.
- [ ] Couch : dépôt propre, `v0.1.4` tagué, **rien modifié**.
- [ ] `CONTRACT-ANDROID-V1.md` et `CONTRACT-DISCORD.md` extraits du code réel.
- [ ] `BASELINE.md` (tailles + checklist) et `PLAN.md` écrits.
- [ ] Vault : `projects/sunday-stream/SUMMARY.md` + note de décision de fusion ; ancienne décision `superseded`.
- [ ] Commit « Phase 0 : plan, contrats, mesures de départ » dans `E:\dev\Sunday Stream` (alors `E:\Stream\Sunday Stream`).
- [ ] Rien d'arrêté, désinstallé ou supprimé ; ancien Couch et ancien bot inchangés.

### Phase 1 — Squelette
Dépôt, fenêtre, console Couch intégrée, migration Couch, allègement.
- [ ] Dépôt public `Cantogrel/sunday-stream` créé depuis l'historique Couch (e-mail `mathieu.cantogrel@gmail.com`),
      secrets Actions recréés (keystore Android, clé d'updater propre) ; aucun code Python importé.
- [ ] Identité : `com.binagames.sundaystream`, « Sunday Stream », `%APPDATA%\SundayStream`, version ≥ 0.1.4.
- [ ] Fenêtre d'appli avec menu latéral (En direct · Stream & OBS · Chat Twitch · Téléphone · Discord · Clips · Réglages) ;
      console Couch intégrée dans la fenêtre ; sections Discord/Clips en « bientôt disponible ».
- [ ] Migration au premier lancement, **avec confirmation** : ancien Couch fermé, `identity.json` / `devices.json` /
      `secrets.dat` / `.env` / `setup.json` **copiés** (pas déplacés).
- [ ] Allègement : service regroupé en un fichier, binaires win32-x64 seulement ; **installeur ≤ 39,8 Mo**.
- [ ] Toute la checklist Couch (BASELINE §4.1) passe, y compris une **app Android 0.1.4 déjà installée** : jumelée,
      pilotée et mise à jour contre le nouveau service.

### Phase 2 — Module Discord
Bot Node (`discord.js`), modules activables, code d'invitation, clips à l'identique.
- [ ] Bot Node conforme à `CONTRACT-DISCORD.md` (4 choix, statuts, rappels, verrou, dédup, arrêt propre, délais).
- [ ] Planification interne (début −30 min, fin +30 min, filet +180 min) : plus aucune tâche planifiée nécessaire.
- [ ] Modules activables (Discord / Canapé / Clips) et **code d'invitation de groupe** (IDs de salons uniquement, jamais le token).
- [ ] Import du `.env` du bot et suppression des tâches planifiées **avec confirmation**.
- [ ] Clips à l'identique : Replay Buffer, post, vote (2 ✅ admins = validé, 1 ❌ = refusé), détection via VU-mètres OBS,
      déclencheurs manuels, ffmpeg téléchargé au premier usage.
- [ ] Coexistence testée : un PC « ancien exe » + un PC Sunday Stream sur le même salon (verrou, dédup, vote).
- [ ] Checklist bot (BASELINE §4.2) passe ; installeur toujours ≤ 39,8 Mo.

### Phase 3 — En direct
- [ ] Tableau de bord « En direct » : stream en cours, par qui, santé, chat, scènes, clips récents.
- [ ] Données issues du verrou/journal Discord et d'OBS ; aucune régression des autres sections.

### Phase 4 — Distribution
- [ ] CI de release (installeur, `latest.json`, APK servie), updater signé avec la clé propre à Sunday Stream.
- [ ] Guide d'installation pour les amis ; un ami installe et rejoint le groupe sans aide.
- [ ] Contrôle de taille automatisé (échec de CI si l'installeur dépasse 39,8 Mo).
- [ ] Documentation de migration depuis Couch et depuis l'ancien exe.

### Phase 5 — Bascule
- [ ] Migration des **4 PC** (données copiées, ancien exe et tâches planifiées retirés, avec confirmation).
- [ ] Période de coexistence sans incident, puis **fin de compatibilité avec l'ancien exe** (marqueurs de compat retirés si utile).
- [ ] Archivage des deux anciens projets (rien supprimé sans accord).

### Plus tard
Refonte des clips, import de VOD, dossier source `E:\Stream\Clips\SteelSeries Moments` (lecture seule).

## 5. Règles de travail

- Phase 0 = documentation et filets de sécurité uniquement. Jamais d'arrêt, de désinstallation ni de suppression sans
  confirmation. Pas de dépôt GitHub ni de push avant la phase 1.
- Ne jamais afficher, commiter ni noter un secret (token Discord, mot de passe OBS, jetons Twitch, `secrets.dat`).
- Les contrats prévalent sur toute « amélioration » tant que la compatibilité (ancien exe, app Android installée) existe.
- Graphify : sortie centralisée dans `E:\Super IA\Graphify\Sunday-Stream\graphify-out\` (aucun graphe en phase 0).
- Studio OS : projet `sunday-stream` (succède au projet « Couch Stream App », `290600cf-2210-43c0-ab38-57de009e7e72`, conservé).
