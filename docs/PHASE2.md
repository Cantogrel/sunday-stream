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

Tests : `npm test` dans `pc-service/` (17 tests : textes et marqueurs exacts, verrou, dédup, 4 choix,
rappels, fin de stream, vote, invitation).

## Mapping des scores de clips (OBS à la place du PC)

Le message de clip garde sa forme (`Micro / Voix / Inputs`), alimentée ainsi :
Micro = pic des entrées nommées micro/aux/voix · Voix = pic soudain (hausse brusque) · Inputs = pic des
autres entrées (audio du jeu). Pondérations 0,3 / 0,3 / 0,4, seuil, 3 ticks consécutifs et cooldown inchangés.

## Reste à faire / non vérifié

- **Essai réel** (critère de la phase) : un PC sous l'ancien exe + un sous Sunday Stream, un « dimanche »
  simulé (jour/heures réglables dans la section Discord) : verrou, messages, rappels. Non fait ici : il faut
  un token et des salons réels.
- **ffmpeg** téléchargé au premier usage (compression au-dessus de la limite Discord, rognage) : non fait.
  Un clip trop gros est publié sans pièce jointe avec son chemin local, comme l'ancien exe.
- **Raccourci clavier global** et `!clip` Twitch : non faits (bouton de l'app et `/clip` disponibles).
- La commande `/clip` exige le scope `applications.commands` à l'invitation du bot ; sinon elle n'est pas
  enregistrée (journalisé) et le bouton reste disponible.
- Le choix des modules se fait dans la section Discord, pas encore dans l'assistant de premier lancement.
