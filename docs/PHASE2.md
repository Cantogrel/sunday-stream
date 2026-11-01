# Phase 2 — Module Discord (bot Node)

Réécriture du bot Discord en Node dans le service (`pc-service/src/discord/`), conforme à
[CONTRACT-DISCORD.md](CONTRACT-DISCORD.md). Un seul process, une seule connexion OBS.

## Ce qui est fait

| Élément | Où |
|---|---|
| Logique pure du contrat (marqueurs, verrou, fenêtre, durée, vote, invitation, réglages) | `src/discord/logic.js` |
| Bot : vocal → fenêtre 4 choix → OBS, logs/marqueurs/dédup/verrou, watchdog 3 s, arrêt propre, « détecter mon ID » | `src/discord/bot.js` |
| Planification interne : connexion à début − 30 min, fermeture à fin + 30 min (plus de tâches `schtasks`) | `bot.js` (`startScheduler`) + `logic.js` (`botShouldRun`) |
| Fenêtre « Lancer le stream ? » (toujours au premier plan, 2 min = Non) | `confirm.js`, `public/confirm.html`, `desktop/src-tauri/src/main.rs` (`show_confirm`) |
| Clips : Replay Buffer, publication (envoi sans pied → édition → ✅❌), vote admins, copie locale | `src/discord/clips.js` |
| Détection auto par niveaux sonores OBS (`InputVolumeMeters`), bouton de l'app, `/clip` Discord | `clips.js`, `public/clips.html` |
| Modules activables (Couch / Discord / Clips) ; module Couch coupé = ni audio natif, ni Twitch, ni annonce réseau | `settings.js`, `src/index.js`, `audio/pcmPlayer.js` (import paresseux) |
| Code d'invitation de groupe `SS1-…` : IDs de salons uniquement, jamais le token | `logic.js` (`encodeInvite`/`decodeInvite`) |
| Token Discord chiffré (DPAPI, `secrets.dat`) | `settings.js` |
| Import de l'ancienne config + retrait des tâches planifiées (avec confirmation) | `legacy.js`, section Discord de l'app |
| Arrêt propre au « Quitter » de l'icône (`POST /api/shutdown`) | `main.rs` (`graceful_stop`), `staticServer.js` |

Tests : `npm test` dans `pc-service/` (32 tests avec faux Discord/OBS : textes et marqueurs exacts, verrou, dédup, 4 choix,
rappels, fin de stream, publication et vote des clips, détection OBS, planification, watchdog, invitation).

## Détection des clips (révisée après le stream du 31 oct.)

Le message de clip garde sa forme (`Micro / Voix / Inputs`), alimentée ainsi :

- **Micro** : émotions lues dans l'enveloppe sonore du micro (`moments.js`, niveaux OBS ~20/s, aucun audio capturé) —
  exclamation (montée brutale), cri (niveau très haut tenu > 1 s), rire (rafales régulières). Tout est relatif au
  niveau habituel de la voix (référence lente, 20 s de parole pour s'établir).
- **Voix** : même analyse sur le son du PC (capture de sortie d'OBS, repérée toute seule ; Discord y passe), ou sur les
  entrées cochées dans Discord → Clips. Un **filtre de voix** (`VoiceGate`) juge si l'enveloppe ressemble à de la parole
  (syllabes irrégulières, creux ≥ 12 dB, 1,3–9/s) : le score vaut ×1 si c'est de la voix, ×0,15 sinon (musique, explosions).
  Heuristique sur le niveau seul, sans audio brut : la musique rythmée ou un jeu très bavard peuvent la tromper.
- **Inputs** : activité manette / clavier / souris (`activity.js`, PowerShell persistant : compteurs par seconde,
  jamais les touches). Elle module le score de ±15 % mais ne déclenche jamais seule.
- Le son du jeu n'est plus pris en compte (toujours fort, c'était la cause des « Inputs à 100 % »).
- Score = max(micro, voix × 0,9) × (0,85 + 0,3 × activité) ; un seul tick suffit ; seuil et cooldown inchangés.
- Limites : sans hauteur de voix ni mots, on détecte la *dynamique* des émotions, pas leur nature ; les seuils
  (dB, durées) sont à ajuster sur de vrais streams. Une manette hors XInput (ex. via Steam Input) peut ne pas compter.

## Autres ajouts

- **Micro de stream** (`micGuard.js`) : micro d'OBS mémorisé (périphérique + pistes audio), vérifié toutes les 15 s,
  remis en place tout seul si OBS l'a changé ou supprimé ; avertissement si muet 5 min pendant le direct ; ne démute jamais.
  Affiché dans « En direct » et dans Discord → Micro de stream. Désactivable par une case à cocher (active par défaut).
- **Dossier des clips** réglable (défaut `Vidéos\Sunday Stream Clips`) : le clip y est déplacé dès que OBS a fini de l'écrire.
- **Lisibilité Discord** : tout clip non MP4/H.264/AAC est converti (sans perte si possible) par ffmpeg avant l'envoi ;
  attente de la fin d'écriture du fichier pour ne plus envoyer de clip tronqué.
- Bouton « Lancer le bot maintenant » (ex. « Connecter maintenant (test) ») : lancement officiel hors plage, sans arrêt automatique.

## Reste à faire / non vérifié

- **Essai réel** (critère de la phase) : un PC sous l'ancien exe + un sous Sunday Stream, un « dimanche »
  simulé (jour/heures réglables dans la section Discord) : verrou, messages, rappels. Non fait ici : il faut
  un token et des salons réels.
- **ffmpeg** (`src/ffmpeg.js`) : téléchargé au premier clip trop gros pour Discord (build gyan.dev « essentials »,
  SHA-256 vérifié, dans `%APPDATA%\SundayStream\ffmpeg`), puis réencodage H.264 sous la limite ; l'original reste la
  copie locale. Si la compression est impossible (hors ligne, clip trop long), repli : publication sans pièce jointe
  avec le chemin local, comme l'ancien exe. Testé en unitaire ; **téléchargement et encodage réels non essayés**.
  Rognage : non fait.
- **Raccourci clavier global** (modifiable dans Discord → Clips, défaut Ctrl+Alt+C) : fait. Le service écrit `hotkey.json`,
  l'app Windows (`watch_hotkey`) l'enregistre via `tauri-plugin-global-shortcut`. `!clip` Twitch : non fait.
- **Replay Buffer** démarré avec le stream quand Clips est actif ; option « arrêter enregistrement et Replay Buffer à l'arrêt du stream ».
- La commande `/clip` exige le scope `applications.commands` à l'invitation du bot ; sinon elle n'est pas
  enregistrée (journalisé) et le bouton reste disponible.
- Le choix des modules se fait dans la section Discord, pas encore dans l'assistant de premier lancement.
