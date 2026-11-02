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
- **Calibration** : le niveau habituel des voix s'apprend pendant les 3 premières minutes du direct (médiane de 20 s de
  parole, seulement ce qui dépasse −45 dB, et pour les amis seulement ce que le filtre juge être de la voix) ; aucun
  clip automatique avant. Case « Détection automatique » pour couper la détection sans toucher au Replay Buffer ;
  un Replay Buffer arrêté dans OBS n'est jamais relancé par un clip automatique. Chaque déclenchement est journalisé
  (quel détecteur, quel type d'émotion, score) pour régler les seuils.
- Score = max(micro, voix × 0,9) × (0,85 + 0,3 × activité) ; un seul tick suffit ; seuil et cooldown inchangés.
- **Qualité des moments** (après les streams du 1er nov.) : seuil par défaut 0,75 ; le score doit rester au-dessus du seuil
  ~2 s (un pic isolé ne compte pas) ; micro et amis qui s'accordent valent plus qu'une source seule ; le rire exige 7 rafales
  plus fortes que la voix habituelle pour atteindre 1 ; l'exclamation seule plafonne à 0,7 (ne déclenche pas sans renfort) ;
  l'afflux de messages du chat Twitch renforce un moment déjà détecté (jamais seul).
- **Fin du moment** : le clip automatique attend que le score retombe (4 s mini, 15 s maxi, 2 s de calme), puis ffmpeg ne
  garde que `keepSeconds` (45) secondes, fenêtre terminée 4 s après la fin du moment (coupe sans réencodage). Le manuel garde tout.
- **Apprentissage** (`learning.js`, `learning.json`) : les ✅ / ❌ définitifs des admins sur un clip automatique ajustent la
  confiance par type d'émotion (poids 0,5–1,3) et le seuil (−0,10 / +0,15) ; un clip manuel renforce ce que les détecteurs
  voyaient et abaisse le seuil s'il était passé sous le radar ; le niveau habituel de la voix est mémorisé (calibration 90 s au
  lieu de 3 min, recalage rapide). Remise à zéro dans la page Clips. Les votes ne comptent que sur le PC qui a publié le clip,
  bot connecté.
- **Historique et norme** (`history.js`, `stream-history.json`) : les 20 derniers streams (durée, secondes de parole,
  distribution du score, événements d'émotion, pics de voix, clips auto/manuels, verdicts, réglages retenus). Après ~10 min de
  parole cumulées, le 97e centile du score « actif » définit l'habituel de la bande : le seuil monte de 0,12 au plus vers
  cette norme (poids plein à ~1 h de parole), pour ne retenir que ce qui sort vraiment de l'ordinaire. Un stream < 2 min n'est
  pas gardé ; une session interrompue (mise à jour, arrêt) est close à sa dernière sauvegarde (toutes les 5 min).
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
