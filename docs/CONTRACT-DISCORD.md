# Contrat Discord (bot Sunday Stream Bot v1.1.4)

Extrait du code réel de **Sunday Stream Bot v1.1.4** (`E:\Stream\Sunday Stream Bot`, commit `37d84b6`,
tag `v1.1.4`) : `bot.py`, `clips.py`, `signals.py`, `confirm_dialog.py`, `config_gui.py`, `stop_bot.py`,
`detect_id.py`, `README.md`. Là où le README et le code divergent, **le code fait foi** (divergences notées).

**But** : le bot Node (discord.js) de Sunday Stream doit être indiscernable de l'ancien exe pour Discord
et pour les 3 autres PC pendant la transition : mêmes marqueurs, mêmes textes, mêmes règles de verrou et de
vote, de sorte qu'un PC « ancien exe » et un PC « Sunday Stream » partagent le même salon de logs sans
conflit.

## 0. Identité Discord

- **Un seul bot Discord, un seul token pour les 4 amis** (transmis à la main, jamais embarqué ni versionné).
  Donc `client.user.id` est le même sur les 4 PC : c'est ce qui permet à chaque instance de lire les marqueurs
  postés par les autres. **Le bot Node doit utiliser ce même token/application** (les marqueurs ne comptent
  que s'ils sont écrits par `client.user.id`).
- Intents : `Intents.default()` + `voice_states` (aucun intent privilégié). Le bot suit : changements d'état
  vocal, réactions brutes (`on_raw_reaction_add/remove`). Les réactions brutes exigent l'intent `GuildMessageReactions`
  (inclus par défaut).
- Permissions requises (README) sur le salon de logs : Voir le salon, Envoyer des messages, Voir l'historique
  des messages, Intégrer des liens. Sur le salon de clips (déduit du code) : Envoyer des messages, Joindre des
  fichiers, Intégrer des liens, Ajouter des réactions, Voir l'historique.
- Le bot ne réagit **qu'à l'état vocal de son propre utilisateur** (`MY_DISCORD_USER_ID`) ; chaque PC a donc sa
  propre instance « personnelle ».

## 1. Configuration (`.env`, clés et défauts)

| Clé | Défaut | Notes |
|---|---|---|
| `DISCORD_BOT_TOKEN` | – | **secret**, requis |
| `MY_DISCORD_USER_ID` | – | entier, requis |
| `TARGET_VOICE_CHANNEL_ID` | valeur embarquée (`bundle_defaults.py`) | entier, requis |
| `LOG_CHANNEL_ID` | valeur embarquée | entier ; **vide = ni logs ni verrou** (le bot fonctionne « comme avant ») |
| `ACTIVE_DAY` | `Sunday` | jour **anglais** (`Monday`…`Sunday`), comparé à `strftime("%A")` |
| `ACTIVE_HOUR_START` | `20` | entier 0-23 ; ⚠ `or` Python : une valeur `0` retombe sur `20` |
| `ACTIVE_HOUR_END` | `23` | entier 0-23, > début ; ⚠ `0` retombe sur `23` |
| `OBS_WS_HOST` | `localhost` | |
| `OBS_WS_PORT` | `4455` | 1-65535 |
| `OBS_WS_PASSWORD` | – | **secret**, requis par la GUI (ne jamais journaliser : bug connu `obsws_python` qui l'imprimait) |
| `OBS_EXECUTABLE_PATH` | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` | requis par la GUI |
| `CLIPS_CHANNEL_ID` | – | vide = **toute la détection de clips désactivée** |
| `CLIP_SCORE_THRESHOLD` | `0.65` | 0 < x ≤ 1 |
| `CLIP_WEIGHT_MIC` / `_SPEECH` / `_INPUT` | `0.3` / `0.3` / `0.4` | ≥ 0 |
| `CLIP_COOLDOWN_SECONDS` | `90` | entier ≥ 0 (compté en « ticks » de 1 s) |

Valeurs embarquées dans l'exe (`bundle_defaults.py`, non versionné, non secret) : `VERSION` et `DEFAULTS`
(`TARGET_VOICE_CHANNEL_ID`, `LOG_CHANNEL_ID`). Dans Sunday Stream elles deviennent le **code d'invitation de
groupe** (IDs de salons, jamais le token). Variables de test : `SSB_STARTUP_JITTER` (secondes), `SSB_FORCE_CLIP_TRIGGER=1`,
`SSB_DETECT_TIMEOUT` (secondes, défaut 120).

L'ancien `.env` est un fichier `CLE=valeur` (une par ligne, `#` = commentaire, encodage UTF-8, en-tête
`# Généré par config_gui.py`) **à côté de l'exe** (`dist\.env`). Le bot lit d'abord la variable d'environnement
du processus, puis `.env`, puis les valeurs embarquées, puis le défaut codé.

## 2. Fenêtre de détection et planification

- **Fenêtre active** : jour == `ACTIVE_DAY` **et** `ACTIVE_HOUR_START ≤ heure < ACTIVE_HOUR_END` (heure locale
  du PC, minutes ignorées). La fenêtre ne franchit jamais minuit.
- **Tâches planifiées Windows (à remplacer par une planification interne)** :
  - `SundayStreamBot_Start` : hebdomadaire, jour `ACTIVE_DAY`, à **début − 30 min**, commande `<exe> --bot`
    (jour décalé si −30 min franchit minuit).
  - `SundayStreamBot_Stop` : hebdomadaire, à **fin + 180 min** (`STOP_TASK_SAFETY_NET_MINUTES`), commande
    `<exe> --stop` ; le jour est décalé si +180 min franchit minuit. C'est un **filet de sécurité** : `--stop` ne
    fait rien si `bot.pid` n'existe plus.
  - La GUI supprime puis recrée les deux tâches à chaque enregistrement. La migration doit **supprimer ces deux
    tâches** (avec confirmation).
- **Plage −30/+30 min** : le bot est lancé 30 min avant le début de la fenêtre ; il s'arrête de lui-même à
  **fin + 30 min** (`STOP_BUFFER_MINUTES = 30`) si aucun stream lancé par lui n'est en cours.
- **Démarrage du bot** : écrit `bot.log` (`[HH:MM:SS] message`), puis vérifie token / ID utilisateur / ID salon
  vocal (sinon log « Config incomplète (…) » et sortie), écrit `bot.pid` (pid du vrai processus), supprime un
  éventuel `stop.flag` résiduel, attend un **jitter aléatoire de 0 à 30 s** (`STARTUP_JITTER_MAX = 30`) avant de
  se connecter à Discord (anti-collision entre les 4 PC ; remplaçable par `SSB_STARTUP_JITTER`).
- Journal : première ligne `=== Démarrage du bot v<VERSION> (JJ/MM/AAAA) ===` ; à l'arrêt
  `=== Bot arrêté (JJ/MM/AAAA) ===`.

## 3. Déclenchement : arrivée dans le vocal

`on_voice_state_update(member, before, after)` — dans cet ordre, on s'arrête au premier cas qui s'applique :

1. `member.id != MY_DISCORD_USER_ID` → ignoré.
2. « A rejoint le salon cible » = `after.channel.id == TARGET_VOICE_CHANNEL_ID` **et** (`before.channel` est
   `None` **ou** a un autre id). Sinon ignoré.
3. Hors fenêtre active → log « Tu as rejoint le salon cible, mais hors fenêtre active — rien à faire. »
4. Une fenêtre de confirmation est déjà ouverte (`_dialog_open`) → log, rien.
5. `_stop_asking_tonight` vrai → log « plus de rappel prévu ce soir… », rien.
6. Si **cette instance n'a pas lancé** le stream et que le **verrou** est tenu (§5) → log « Un stream est déjà en
   cours sur la chaîne (verrou Discord)… », pas de fenêtre.
7. Sinon : `_dialog_open = true`, ouverture de la fenêtre de confirmation (bloquant, dans un thread), puis
   `_dialog_open = false` et traitement du résultat (§4).

État par processus (donc « par soirée », remis à zéro à chaque lancement du bot) : `_dialog_open`,
`_stop_asking_tonight`, `_i_launched_stream`, `_stream_start_dt`, `_end_posted`, `_window_open_done`,
`_window_close_done`.

## 4. Fenêtre de confirmation : 4 choix et statuts

Fenêtre Tk au premier plan, titre « Session du dimanche », non redimensionnable, centrée 420×190, texte
« Tu viens de rejoindre le vocal.\nLancer le stream ? ». **Timeout 2 min (120 000 ms) = « Non »** ; fermer la
fenêtre = « Non ». Lancée en sous-processus (`--confirm-dialog`), le **code de sortie** est le choix :

| Code | Bouton | Constante |
|---|---|---|
| 0 | « Lancer le stream » (bouton accentué) | `CHOICE_STREAM` |
| 1 | « Juste ouvrir OBS » | `CHOICE_OBS_ONLY` |
| 2 | « Non » (défaut, fermeture, timeout) | `CHOICE_NO` |
| 3 | « Non, plus ce soir » | `CHOICE_NO_SESSION` |

Statuts renvoyés par `prompt_start_stream()` et leurs effets (`on_voice_state_update`) :

| Choix | Action | Statut | Effet sur l'état | Message Discord |
|---|---|---|---|---|
| 0 | `start_stream()` | `launched` | `_i_launched_stream=true`, `_stream_start_dt=now`, `_stop_asking_tonight=true` | `stream` (§6) |
| 0 | OBS diffusait déjà | `already` | `_stop_asking_tonight=true` | **aucun** (pas de marqueur ⇒ pas de verrou, pas de `end` plus tard) |
| 0 | OBS indisponible / échec | `failed` | rien (rappel possible) | `fail` (sans marqueur) |
| 1 | `ensure_obs_running()` ok | `obs_only` | rien (rappel possible) | aucun |
| 1 | OBS ne répond pas | `obs_failed` | rien | `fail` (sans marqueur) |
| 2 (ou timeout) | – | `declined` | rien (**nouveau rappel possible** si le vocal est rejoint de nouveau) | aucun |
| 3 | – | `declined_session` | `_stop_asking_tonight=true` | aucun |

**Règles de rappel** : seuls `launched`, `already` et `declined_session` coupent les rappels pour la soirée ;
`declined`, `obs_only`, `failed`, `obs_failed` laissent un nouveau rappel possible. `_dialog_open` n'empêche
que deux fenêtres simultanées.

### `start_stream()` (OBS via obs-websocket)

1. `ensure_obs_running(max_wait=40)` : `obs_is_reachable()` (connexion + `get_version`, timeout 3 s) ;
   sinon lance `OBS_EXECUTABLE_PATH` (cwd = dossier de l'exe) puis sonde **toutes les 2 s, jusqu'à 40 s**
   (« OBS prêt (après N s). » / « ÉCHEC : OBS ne répond pas après 40 s. »).
2. Si `get_stream_status().output_active` : log « OBS diffuse déjà — le stream n'est pas relancé. » (statut
   `already`). Sinon : scène `Démarrage` (`OBS_STARTING_SCENE`, échec simplement journalisé) puis `start_stream`.
3. Dans les deux cas : si l'enregistrement n'est pas actif, `start_record`.
4. Toute exception OBS ⇒ « ÉCHEC du démarrage du stream : … » et statut `failed`.

## 5. Salon de logs : marqueurs, déduplication, verrou

### 5.1 Format des messages et des marqueurs

Tous les messages de logs sont des **embeds** (couleur `0x5865F2`) dont la **description** est le texte ci-dessous.
Le marqueur est le **pied d'embed (`footer.text`)**, pas le contenu du message :

```
sundaybot|<kind>|<YYYY-MM-DD>
```
(date = date locale du poster, `strftime("%Y-%m-%d")`). Exactement **3 segments** séparés par `|`.

| `kind` | Description exacte | Quand | Marqueur ? |
|---|---|---|---|
| `window` | `📅 **Session du dimanche** — la détection est ouverte.` | premier tick du watchdog où la fenêtre est active (une fois par processus) | oui |
| `stream` | `🔴 Stream lancé par **<display_name>** à <HHhMM>.` | statut `launched` | oui |
| `fail` | `⚠️ <display_name> : échec du lancement du stream (OBS injoignable).` | statuts `failed` / `obs_failed` | **non** (`dedup=False` ⇒ pas de footer, jamais dédupliqué ni lu) |
| `end` | `⚪ Stream terminé à <HHhMM><durée>.` | fin de stream (§7) | oui |
| `close` | `🌙 Détection fermée. Bonne nuit.` | fenêtre fermée (§7) | oui |

- `HHhMM` = `strftime("%Hh%M")` (ex. `22h07`). `display_name` = `member.display_name` (pseudo serveur).
- `<durée>` : chaîne vide si le début est inconnu ; sinon ` (durée H h MM)` si H ≥ 1 (minutes sur 2 chiffres,
  ex. ` (durée 2 h 05)`), sinon ` (durée M min)` ; calculée depuis `_stream_start_dt` (secondes tronquées).
- Divergence : le README dit « 🌙 Détection fermée. » ; **le code ajoute « Bonne nuit. »**. Le texte `window`
  dit « Session du dimanche » quel que soit `ACTIVE_DAY`.

### 5.2 Lecture des marqueurs (`_find_markers`)

- Source : `channel.history(limit=30)` du salon de logs, du plus récent au plus ancien.
- On ne retient que les messages dont `author.id == client.user.id`, et on examine le **pied (`footer.text`) de chacun des embeds** du message (le footer doit commencer par `sundaybot|`).
- Un marqueur valide a exactement 3 segments, `kind` ∈ `wanted`, et (si `day` est donné) date == `day`.
- Pour un `kind` donné, on garde le **premier rencontré = le plus récent** : `found[kind] = message.created_at`
  (UTC, aware).
- Limite connue : seuls les **30 derniers messages** sont examinés ; un salon bavard peut « oublier » un
  marqueur ancien (verrou perdu, `window` reposté). À conserver tel quel (comportement de référence).
- Permissions manquantes : `Forbidden` ⇒ log « permission « Voir l'historique des messages » manquante —
  verrou/anti-doublon ignorés. » ; autre erreur ⇒ log, et on continue sans verrou.

### 5.3 Déduplication (`_post_log(kind, text, dedup=True)`)

- Si `dedup` : lit `_find_markers(ch, {kind}, day=aujourd'hui)` ; si le `kind` du jour est déjà présent, **rien
  n'est posté** (les 4 PC convergent donc sur un seul message `window`/`stream`/`end`/`close` par jour).
- Sinon : embed, et si `dedup` pose le footer `sundaybot|<kind>|<aujourd'hui>`.
- Salon introuvable (`get_channel` puis `fetch_channel`) ⇒ log « (logs) salon … introuvable » et on abandonne.
- Erreurs d'envoi : `Forbidden` ⇒ log « permission « Envoyer des messages / Intégrer des liens » manquante. » ;
  autre ⇒ log « échec de l'envoi ».
- Succès : log `(logs) message posté : <kind>`.

### 5.4 Sémantique du verrou (`_stream_lock_held`)

Lu **uniquement au moment où l'utilisateur rejoint le vocal** (étape 6 du §3), jamais en continu :

1. Pas de `LOG_CHANNEL_ID`/salon ⇒ verrou **libre** (`False`).
2. `m = _find_markers(ch, {"stream","end"})` **sans filtre de date** (robuste à minuit).
3. Pas de `stream` ⇒ libre.
4. `end` présent **et plus récent** que `stream` (`end > stream`) ⇒ libre.
5. Âge de `stream` (`now_utc − created_at`) **> 12 h** (`STREAM_LOCK_MAX_AGE`) ⇒ libre (log « verrou stream
   ignoré : marqueur 'stream' vieux de … sans 'end' (arrêt forcé probable). »).
6. Sinon ⇒ **tenu**.

Conséquences : le verrou n'est pas atomique (deux PC qui valident presque en même temps peuvent tous deux
lancer ; le jitter 0-30 s au démarrage ne le prévient pas à lui seul) ; un `taskkill` forcé sans `end` coince le
verrou jusqu'à 12 h ; un stream « déjà actif » (`already`) ne pose pas de marqueur donc ne verrouille pas.

## 6. Arrêt, surveillance, fin de stream

### Watchdog (`auto_shutdown_watchdog`, tick = 3 s, démarre à `on_ready`)

À chaque tick, dans cet ordre :

1. **`stop.flag` présent** → le supprimer, log « Arrêt demandé (--stop) — fermeture du bot. », appeler
   `_post_stream_end_if_needed()` (sans `force`), `client.close()`, sortie.
2. Si `!_window_open_done` et fenêtre active → `_window_open_done = true`, poster `window`.
3. Si `_window_open_done` et `!_window_close_done` et jour == `ACTIVE_DAY` et `heure ≥ ACTIVE_HOUR_END` →
   `_window_close_done = true`, poster `close`.
4. Si `_i_launched_stream` et `!_end_posted` : compteur ; **tous les 10 ticks (~30 s)**, si
   `!obs_is_streaming()` → `_post_stream_end_if_needed(force=True)`.
5. `stop_at = ACTIVE_HOUR_END:00 + 30 min` (date du jour, **sans test du jour de la semaine**). Si `now ≥ stop_at` :
   - si `_i_launched_stream` et `!_end_posted` → **ne rien faire** (on ne coupe pas la détection en plein stream) ;
   - sinon log « Fin de la fenêtre active (+30 min) — fermeture du bot. », `_post_stream_end_if_needed()`,
     `client.close()`, sortie.

### `_post_stream_end_if_needed(force=False)`

Ne fait rien si `!_i_launched_stream` ou `_end_posted`. Sans `force`, ne fait rien non plus si
`obs_is_streaming()` est vrai (ne déclare pas la fin tant qu'OBS diffuse). Sinon `_end_posted = true` et poste
`end` avec la durée (§5.1). Le `end` n'est donc posté que par l'instance qui a lancé le stream.

### Arrêt manuel : `--stop` (`stop_bot.py`)

- Pas de `bot.pid` ⇒ « Aucun bot.pid trouvé — le bot est probablement déjà arrêté. » et sortie.
- Sinon crée `stop.flag`, attend jusqu'à **15 s** (1 s × 15) que `bot.pid` disparaisse ; en cas de succès « Bot
  arrêté proprement. » ; sinon « Pas de réponse en 15 s — arrêt forcé (taskkill). » → `taskkill /PID <pid> /F`
  et suppression de `bot.pid`. Supprime ensuite `stop.flag`.
- Convention : **arrêt propre uniquement** ; le kill forcé ne poste pas `end` et la déconnexion Discord est
  lente. Un arrêt propre alors qu'OBS diffuse encore **ne poste pas `end`** (le verrou restera tenu jusqu'à 12 h).

## 7. Détection de clips (`signals.py`, `bot.py: clip_detector_watchdog`)

- Désactivée sans `CLIPS_CHANNEL_ID`. Boucle à **1 tick/s**. Tout le corps du tick est dans un `try/except` qui
  journalise « erreur inattendue dans la boucle de détection — on continue. » (1 fois par 30 s) — ne jamais
  laisser une exception tuer la tâche.
- **Sonde OBS toutes les 5 s** : la capture ne tourne que si **OBS diffuse sur cette machine** (une seule machine
  streame vers la chaîne, d'où pas de doublons entre PC).
  - Début de diffusion → `signals.start_capture()`, `scorer.reset_session()`, `ensure_replay_buffer_running()`
    (démarre le Replay Buffer s'il ne tourne pas ; il doit avoir été activé une fois à la main dans OBS : Réglages →
    Sortie → Enregistrement), log « (clips) détection démarrée — OBS diffuse sur cette machine. ».
  - Fin → `stop_capture()` + log de synthèse « Score max atteint sur la session : X (seuil T) — mic / voix / input ».
- **Signaux** (fenêtre d'1 s, remise à zéro à chaque lecture) : `mic` = pic RMS int16 ; `speech` = part de trames
  voisées (webrtcvad agressivité 2, 16 kHz, trames 30 ms) ; `input` = nombre d'évènements clavier / clic souris /
  molette / appuis manette XInput (poll 30 Hz, 4 manettes max).
- **Normalisation** (par signal) : `ceiling = max(raw, ceiling×0.999, baseline)` ; `baseline = baseline×0.99 +
  raw×0.01` ; valeur = `clamp((raw − baseline)/max(ceiling − baseline, 1e-6), 0, 1)` ; premier échantillon ⇒ 0.
- **Score** = `w_mic·mic + w_speech·speech + w_input·input`. **Déclenchement** quand le score est **> seuil**
  pendant **3 ticks consécutifs** (`min_duration_ticks`), puis **cooldown** de `CLIP_COOLDOWN_SECONDS` ticks
  (pendant lequel la série est remise à zéro). Journal de suivi toutes les 300 s.
- **État actuel : la détection auto ne marche pas** (voix saturée à 1.00, inputs à 0.00). Ce contrat décrit le
  comportement à reprendre « à l'identique » ; Sunday Stream le remplace par les VU-mètres OBS (décision 4) et
  des déclencheurs manuels, sans changer le format de publication/vote ci-dessous.
- **Sauvegarde** : `save_replay_buffer()` puis jusqu'à **5 sondages de 1 s** de `get_last_replay_buffer_replay`
  jusqu'à un chemin existant.

## 8. Publication et vote des clips (`clips.py`)

### 8.1 Message de clip

Embed dans `CLIPS_CHANNEL_ID` :
- titre / couleur par statut (`STATUS_LABELS`) :
  `pending` « ⏳ En attente de validation » `0x5865F2` ; `validated` « ✅ Clip validé » `0x57F287` ;
  `vetoed` « 🚫 Clip refusé » `0xED4245`.
- description :
  ```
  Score composite : **NN%**
  Micro NN% · Voix NN% · Inputs NN%
  ```
  (`NN` = valeur × 100 arrondie à l'entier, `f"{v*100:.0f}%"`).
- Fichier vidéo en pièce jointe si `taille < guild.filesize_limit` (10 Mo si indisponible). Sinon pas de pièce
  jointe et un champ (non inline) `Fichier trop volumineux pour Discord` / ``Récupère-le localement : `<chemin>` ``.
- Séquence : envoi **sans footer**, puis **édition** pour poser le footer, puis le bot ajoute lui-même les
  réactions **✅ puis ❌**. Tant que le footer n'est pas posé, le message n'est pas reconnu comme un clip.
- **Footer** : `sundaybot|clip|<id du message>|<statut>` — **4 segments** (statut ∈ `pending`, `validated`,
  `vetoed`). Statut illisible ou ≠ 4 segments ⇒ traité comme `pending`.
- Miroir local : copie du fichier vers `clips\<id du message><extension>` (créé à la demande).
- État **entièrement dérivé de Discord** (footer + réactions) : aucun fichier d'état, aucune base.

### 8.2 Règles de vote (`sync_clip_status`)

Déclenché par chaque réaction ajoutée/retirée sur ✅ ou ❌ dans le salon de clips, sur un message reconnu comme
clip :
- Seules comptent les réactions de **membres Administrateur** (`guild_permissions.administrator`) ; les bots sont
  exclus ; un membre introuvable est ignoré.
- **Veto** : au moins un ❌ d'un administrateur ⇒ `vetoed` (**définitif et absorbant**).
- **Validation** : sinon, et si le statut courant n'est pas `vetoed`, **≥ 2 ✅ d'administrateurs distincts**
  (`APPROVALS_NEEDED = 2`) ⇒ `validated`.
- **Monotone** : `pending → validated → vetoed` ou `pending → vetoed`. `validated` ne revient jamais à `pending`
  (retirer des ✅ n'annule pas) ; `vetoed` ne change plus.
- Si le statut change : titre, couleur et footer sont réécrits, **la description (score) est conservée**. Le
  message n'est **jamais supprimé**.
- **Idempotence entre instances** : les 4 bots (même token) reçoivent les mêmes évènements, recalculent depuis la
  même source de vérité et convergent vers la même édition. Le bot Node doit rester idempotent et ne jamais
  stocker d'état local concurrent.

## 9. Mode « détecter mon ID » (`--detect-id`)

Sous-processus lancé par la GUI : lit un JSON `{"token","channel_id"}` puis **le supprime aussitôt**, se connecte
avec le même bot en écoute seule, retient l'ID de la personne qui rejoint le salon vocal (ou de l'unique
occupant déjà présent), écrit `<fichier>.result` (`{"id","name"}` ou `{"error":"login|channel|timeout"}`) puis se
déconnecte (timeout 120 s). Ne touche jamais à OBS ni au stream. À reprendre dans l'assistant « Discord » de
Sunday Stream (le token ne doit jamais être écrit en clair dans un fichier persistant).

## 10. Fichiers d'exécution de l'ancien exe (compatibilité / nettoyage)

À côté de l'exe : `.env`, `bot.log`, `bot.pid`, `stop.flag`, `clips\`. Modes de l'exe : `(rien)` config,
`--bot`, `--stop`, `--confirm-dialog`, `--detect-id <json>`. Tâches planifiées : `SundayStreamBot_Start`,
`SundayStreamBot_Stop` (§2). La phase 1/2 importe le `.env` (avec confirmation) et supprime ces tâches
(avec confirmation) ; rien n'est supprimé en phase 0.

## 11. Checklist de conformité (à rejouer en phase 2 et en phase 5)

- [ ] Mêmes footers `sundaybot|window|stream|end|close|<date>` ; `fail` sans footer ; clip à 4 segments.
- [ ] Mêmes textes exacts (§5.1), y compris « Bonne nuit. » et les mises en forme `**…**`.
- [ ] Déduplication par `history(limit=30)` filtré sur `client.user.id`, plus récent d'abord.
- [ ] Verrou : `stream` sans `end` plus récent, sans filtre de date, ignoré au-delà de 12 h.
- [ ] 4 choix (codes 0-3), timeout 2 min = « Non », statuts et rappels du §4.
- [ ] Jitter 0-30 s, démarrage −30 min, fin +30 min, filet +180 min, attente OBS 40 s (sonde 2 s), poll OBS ~30 s.
- [ ] Arrêt propre (flag, 15 s) ; pas de `end` si OBS diffuse encore.
- [ ] Vote : admins uniquement, 2 ✅ distincts = validé, 1 ❌ = refusé définitif, monotone, jamais supprimé.
- [ ] Un PC « ancien exe » et un PC « Sunday Stream » sur le même salon se respectent mutuellement (verrou,
      dédup, vote).
