# Phase 3 — En direct

Section « En direct » de la fenêtre : `pc-service/public/live.html`, alimentée par `GET /api/live`
(boucle locale, relevé toutes les 3 s) construit par `pc-service/src/live.js`.

| Donnée | Source |
|---|---|
| Qui diffuse, depuis quand, sur ce PC ou un autre | Verrou Discord (`bot.liveLock()`, cache 15 s, marqueurs `stream`/`end` du salon de logs) ; repli sur OBS si aucun marqueur |
| Stream en cours, scène, scènes, durée | OBS (`getState`) |
| Santé : débit, images/s, CPU, images perdues | OBS (`getHealth`) |
| Spectateurs, connectés au chat | Twitch (`ViewerStats`, relevé actif tant que la page est ouverte) |
| Chat | Historique du chat Twitch (20 derniers, sans les supprimés) |
| Clips récents | Module Clips (10 derniers de la session) |

Une source en panne n'empêche pas l'affichage des autres. Tests : `test/live.test.js`.

## Non vérifié

- Affichage réel dans la fenêtre Tauri avec un stream en cours, un token Discord et un salon de logs réels.
- Le nom du streamer vient du texte du marqueur « Stream lancé par **Nom** » (format du contrat Discord).
