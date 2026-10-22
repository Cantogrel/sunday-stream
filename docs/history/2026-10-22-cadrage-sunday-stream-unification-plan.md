# Cadrage Sunday Stream (session « Sunday Stream unification plan », 2026-10-22)

_Export texte des échanges utilisateur/assistant uniquement (résultats d'outils omis). Source : session `local_cf019feb-657f-43e1-9b4e-54d81000c4ef`._


## Utilisateur

J'ai un sujet complexe :
je pense qu'il pourrait etre bien de fusionner Sunday Stream Bot et Couch Stream App.
Il faudrait qu'on regroupe tout dans un projet qui s'appellerai juste Sunday Stream, qui s'occuperai de gérer tout ce qui est en rapport avec la gestion du stream.
Il faut qu'on ai une interface, si possible applicative, avec différentes parties pour gérer les différentes fonctionnalités, tel que : le bot discord, avec les fonctionnalités actuels de Sunday Stream Bot, cad formulaires de config, mais pourquoi pas aussi d'autres éléments de gestion et de visualisation de ce qu'il se passe (par exemple, stream en cours, par qui, etc.. ), toute la gestion des clips aussi (grosse refonte a revoir la dessus d'ailleurs, car pas au point), et la partie correspondant à Couch Stream App, qui doit reprendre toutes ses fonctionnalités actuelles, cad son tableau de bord, la possibilité de télécharger l'app android (qu'on ne change pas, toujours appelé Couch Stream App) et de jumeler, on garde des design et façon de procédé similaire, la gestion des mises a jours, le demarrage auto, etc...
Il faut que ça respecte les existants, avec analyse de ce a quoi ça ressemble et comment ça fonctionne, pour les 2 projets existants. Et autant que possible que ce soit non régressif, et ne casse pas trop les trucs actuels, comme par exemple l'app android que j'ai sur mon smartphone qui doit toujours fonctionner avec la nouveau projet.

ne code rien, fais moi un plan détaillé pour voir si tout est compris et comment tu procéderais


## Assistant

J'ai lu les notes du vault sur Sunday Stream Bot. Je lis maintenant celles de Couch Stream App, puis le code des deux projets.


## Assistant

Notes Couch Stream lues. Je passe au code réel des deux projets (le vault date de septembre, le code a évolué depuis : `clips.py`, `signals.py`…).


## Assistant

Je termine l'analyse de Couch Stream : je vérifie comment l'app Android se connecte, se jumelle et se met à jour, pour savoir exactement ce qu'il ne faut pas casser.


## Assistant

# Plan : fusionner les deux projets en « Sunday Stream »

## 1. Ce que j'ai compris de l'existant

**Sunday Stream Bot** (v1.1.4, Python, pas sous git)
- Un seul exe (PyInstaller) avec plusieurs modes : config, `--bot`, `--stop`, `--confirm-dialog`, `--detect-id`.
- La config se fait dans une fenêtre Tkinter. Elle écrit un `.env` à côté de l'exe et crée 2 tâches planifiées (Start / Stop).
- Pendant la plage horaire : quand **toi** tu rejoins le vocal, une fenêtre propose 4 choix, puis OBS lance le stream et l'enregistrement. Le bot s'arrête seul 30 min après la fin de la plage, sauf si un stream tourne encore.
- **Les 4 PC des amis** utilisent le même bot et le même token. Le salon de logs sert à la fois de journal et de verrou anti-double-stream, grâce aux pieds de message `sundaybot|<type>|<date>`. Un délai aléatoire au démarrage évite que les 4 se connectent en même temps.
- **Clips** : `signals.py` capte le micro, la voix, le clavier, la souris et la manette, et calcule un score. Au-dessus du seuil, le Replay Buffer d'OBS sauvegarde un clip, posté dans le salon clips. Les admins votent (2 ✅ = validé, 1 ❌ = refusé).
- Distribution : l'exe est envoyé à la main aux amis, sans mise à jour automatique.

**Couch Stream App** (v0.1.4, dépôt git public, compilation automatique sur GitHub)
- **Appli Windows** (Tauri, en Rust) : icône près de l'horloge, une seule instance à la fois, démarrage avec Windows, mises à jour signées via `latest.json` sur GitHub, installation par utilisateur. Elle lance et surveille le service Node.
- **Service Node** : pilote OBS, gère le chat Twitch (lecture, envoi, modération), la connexion Twitch par code avec jetons chiffrés, et l'audio du téléphone vers VB-Cable. Il expose le port 8765 avec le protocole v1, la console `/desktop`, l'assistant `/setup`, les routes `/api/*`, le fichier `/app.apk`, et s'annonce sur le réseau local.
- **Données** : `%APPDATA%\CouchStreamApp` (`identity.json`, `devices.json`, `secrets.dat`, `setup.json`…).
- **Android** (`com.lescopaings.couchstream`) : le jumelage passe par `/api/pair`. Le téléphone retrouve le PC sur le réseau grâce à son identifiant (`id`), et se met à jour en téléchargeant `/app.apk` sur le PC.

**Ce que montrent tes journaux de clips** : la voix est presque toujours à 1.00 (vous parlez en continu, donc ce signal ne distingue rien). Les inputs restent à 0.00 toute la soirée : la capture ne voit pas la manette, probablement à cause de Moonlight/Sunshine. Le seul dépassement du seuil arrive 15 s après le début : le calcul n'est pas encore calibré à ce moment-là. Le scoring actuel ne marche donc pas, ce qui confirme ton ressenti.

## 2. Ce qu'il ne faut pas casser

**A. L'app Android déjà installée sur ton téléphone, sans la mettre à jour**
- Le port 8765 et le protocole v1 restent identiques : même message de connexion, mêmes messages en retour, mêmes commandes.
- Les routes `/api/pair`, `/app.apk` et `/` restent en place.
- L'annonce réseau `_couchstream._tcp` garde **le même `id`** : on reprend `identity.json` tel quel, sinon le téléphone ne retrouve plus le PC.
- `devices.json` est repris, donc **pas de re-jumelage**.
- Même identifiant d'appli et même clé de signature de l'APK, pour que les futures mises à jour s'installent par-dessus.
- Bon point : l'app ignore les messages qu'elle ne connaît pas (vérifié dans le code). On pourra donc ajouter des fonctions côté PC sans la casser.

**B. Côté PC, pour Couch**
- Les jetons Twitch de `secrets.dat` sont chiffrés pour ton compte Windows uniquement : on peut les copier tant qu'on reste sur ce compte.
- On garde aussi l'identifiant public de l'app Twitch, la source micro OBS et le chemin d'OBS.

**C. Discord et les amis**
- Les pieds de message (`sundaybot|…`, `sundaybot|clip|id|statut`) restent **identiques**. Les amis encore sur l'ancien exe pendant la transition fonctionnent ainsi avec la nouvelle app : même verrou, mêmes votes.
- Le comportement reste le même : 4 choix, délai de 2 min, mêmes règles de rappel, arrêt automatique, message « Stream terminé ».

## 3. Architecture cible

```
Sunday Stream (appli Windows : vraie fenêtre + icône près de l'horloge, démarrage auto, mises à jour)
 └─ un seul service Node
     ├─ OBS (une seule connexion, une seule config OBS au lieu de deux)
     ├─ Module Discord   (ancien bot réécrit en Node)
     ├─ Module Canapé    (téléphone, micro VB-Cable, Twitch : ce que fait Couch aujourd'hui)
     ├─ Module Clips     (refondu)
     └─ État commun : stream en cours, lancé par qui, depuis quand, état Twitch, qui est dans le vocal
```

**Choix structurants, avec ma recommandation**
1. **Partir de Couch** : il a déjà l'installeur, l'icône près de l'horloge, le démarrage auto, les mises à jour signées et la console web. Ce sont précisément les fonctions qui manquent au bot.
2. **Réécrire le bot en Node (discord.js)** plutôt que garder Python à côté. Environ 60 % du code du bot sert au fonctionnement autour (fenêtre Tkinter, tâches planifiées, fichier `stop.flag`, sous-processus, exe PyInstaller) et disparaît de toute façon. Le cœur (plage horaire, verrou, 4 choix) est court et bien défini. Un seul process donne un seul état « qui stream », et les clips sont refaits de toute façon.
   - Alternative : garder le bot Python et le faire tourner comme second service lancé par l'appli. C'est moins risqué à court terme, mais on garde deux langages, il faut les faire communiquer, OBS a deux connexions et il y a deux chaînes de compilation.
   - Garde-fous si on réécrit : tests sur le format des marqueurs, plus un essai réel avec un PC sous l'ancien exe et un PC sous la nouvelle app.
3. **Modules activables** : un ami active Discord (et éventuellement Clips), toi tu actives tout. L'assistant de premier lancement demande quels modules utiliser.
4. **Plus de tâches planifiées** : l'appli démarre avec Windows, et le module Discord se connecte et se déconnecte seul selon la plage (30 min avant / 30 min après, comme aujourd'hui).
5. **Une vraie fenêtre d'appli** au lieu du navigateur, avec un menu latéral : *En direct* · *Stream & OBS* · *Chat Twitch* · *Téléphone (Couch Stream App)* · *Discord* · *Clips* · *Réglages* (modules, OBS, démarrage auto, mises à jour, journaux, diagnostic). On garde le style sombre de la console Couch. `/desktop` reste accessible dans un navigateur.
6. **« Lancer le stream ? »** devient une petite fenêtre toujours au premier plan, avec les mêmes 4 boutons et le même délai de 2 min.
7. **Token Discord chiffré** comme les jetons Twitch, alors qu'il est aujourd'hui en clair dans `.env`.
8. **Nouvelle identité** : `com.binagames.sundaystream`, données dans `%APPDATA%\SundayStream`, nouveau dossier `E:\Stream\Sunday Stream`, nouveau dépôt qui garde l'historique de Couch. Les anciens projets restent intacts, ce qui permet de revenir en arrière.

## 4. Migration au premier lancement (avec ta confirmation à chaque étape)
1. Sauvegarde des données existantes.
2. **Couch** : fermer l'ancienne appli, sinon on aurait deux fois le port 8765 et deux fois le même `id` sur le réseau. Ensuite, copier ses données sans les déplacer, retirer son démarrage auto et proposer de la désinstaller.
3. **Sunday Stream Bot** : retrouver l'exe via la tâche `SundayStreamBot_Start`, ce qui donne aussi son `.env`. Importer la config, arrêter le bot proprement avec `--stop`, puis supprimer les 2 tâches.
4. Test de validation : ton téléphone se reconnecte **sans rien faire**.

## 5. Phases (chacune validée par toi avant la suivante)

| Phase | Contenu | Critère de validation |
|---|---|---|
| **0. Sécurité** | Mettre le bot sous git, figer Couch v0.1.4, sauvegardes, écrire les deux contrats (téléphone et marqueurs Discord), note de décision dans le vault | Retour arrière possible à tout moment |
| **1. Squelette** | Nouveau dépôt, nom « Sunday Stream », fenêtre et menu, console Couch intégrée telle quelle, migration des données Couch | Téléphone actuel reconnecté sans re-jumelage, toutes les fonctions Couch OK |
| **2. Module Discord** | Réécriture en Node, formulaires de config (token, bouton Détecter, salons, plage horaire, OBS partagé), planification interne, fenêtre 4 choix, arrêt propre, import de l'ancienne config et suppression des tâches | Essai réel avec un PC sous l'ancien exe et un sous la nouvelle app un « dimanche » simulé : verrou, messages et rappels identiques |
| **3. En direct** | Tableau de bord : fenêtre de détection, qui est dans le vocal, qui stream et depuis quand, Twitch (live, spectateurs), santé, historique de la soirée | Une soirée réelle suivie de bout en bout |
| **4. Clips** | Refonte (section 6), à cadrer avec toi avant | Clips pertinents sur une vraie soirée |
| **5. Distribution** | Compilation automatique (installeur, `latest.json`, APK), nouveau guide de démarrage pour les amis, IDs de salon ajoutés à la compilation (hors dépôt) | Un ami installe et se met à jour seul |
| **6. Bascule** | Retrait de l'ancien Couch, archivage des anciens dépôts, mise à jour du vault et de Graphify | — |

Point technique à corriger dès la phase 1 : aujourd'hui, « Quitter » dans le menu de l'icône **tue** le service. Avec Discord, il faut un arrêt propre, sinon il n'y a pas de message « Stream terminé ».

## 6. Clips : pistes pour la refonte
- **Déclenchement manuel** :
  - un raccourci clavier global ;
  - un bouton dans l'appli ;
  - `/clip` sur Discord (pratique pour les amis) ;
  - `!clip` dans le chat Twitch ;
  - éventuellement un bouton sur le téléphone, mais il faudrait une mise à jour de l'APK.
- **Déclenchement automatique** :
  - utiliser les **niveaux sonores d'OBS** (son du jeu et micros déjà mixés) au lieu de capter le PC, ce qui supprime aussi le problème de la manette ;
  - repérer les **pics** de son plutôt que le niveau moyen ;
  - tenir compte de l'activité du chat Twitch ;
  - attendre que le calcul soit calibré au démarrage.
- **Calibrage sur données réelles** : une soirée en mode « observation », où l'appli note les scores sans clipper et où tu marques les vrais moments forts.
- **Bibliothèque** : liste, lecture, statut du vote synchronisé avec Discord, renommer, rogner, compression automatique si le fichier dépasse la limite Discord. Rangement dans `E:\Stream\Clips`, avec un lien vers `/tiktok` pour la publication.

## 7. Risques principaux
- L'ancien Couch qui tourne encore en parallèle (conflit de port et de nom sur le réseau) : traité par la migration.
- La cohabitation avec les amis restés sur l'ancien exe : traitée par les contrats et l'essai réel.
- Il n'y a aucun test automatique aujourd'hui : j'en ajouterai pour les deux contrats. Pratique : le PC sert l'interface du téléphone sur `/`, ce qui permet de la tester ici.
- L'installeur n'est pas signé : SmartScreen avertira, comme aujourd'hui.

## 8. Mes questions
1. **Les amis** installent-ils Sunday Stream (avec seulement le module Discord), ou restent-ils sur l'ancien exe ?
2. **L'app Android** : aucune modification du tout, ou des mises à jour de l'APK plus tard sont acceptables (même nom, même design) ?
3. **Clips** : qu'est-ce qui ne va pas pour toi, et qu'est-ce qui compte le plus (déclenchement manuel, pertinence de l'automatique, bibliothèque, publication) ?
4. **Réécriture du bot en Node** : ça te va, ou tu préfères garder Python ?
5. **Dépôt** : nouveau `Cantogrel/sunday-stream` public, comme Couch ?
6. **SteelSeries Moments**, qui est dans `E:\Stream\Clips` : faut-il l'intégrer à la bibliothèque ?

Une fois le plan validé, j'enregistrerai la décision de fusion dans le vault. Elle remplace l'ancienne note qui disait de garder les projets séparés.


## Utilisateur

Voici mes réponses aux 6 questions :


## Assistant

Ton message s'arrête après « Voici mes réponses aux 6 questions : » et je ne vois aucune réponse : le bouton a sans doute envoyé le texte de départ avant que tu aies écrit la suite.

Tu peux me les renvoyer ? Une ligne par question suffit, par exemple :

1. Amis : …
2. App Android : …
3. Clips : …
4. Bot en Node : …
5. Dépôt : …
6. SteelSeries Moments : …

J'ai déjà consulté le cerveau global du vault plus tôt dans cette session, et aucune note ne remet le plan en cause. Dès que j'ai tes réponses, je finalise le plan.


## Utilisateur

1. Mes amis installeront Sunday Stream
2. l'app android doit toujours pouvoir fonctionner tel quel, mais des mises a jours futurs doivent evidement etre toujours possible.
3. pour ce qui est des clips on ameliorera ça en temps voulu. on ajoutera probablement aussi la possibilité d'importer une vidéo (tel qu'une vod d'un live par exemple) à un endroit dans l'app et que ça génère des clips à partir de celle-ci.
4. la réécriture en node me va. mais faisons en sorte autant que possible que l'app finale, via l'installer reste légère.
5. Oui, tu peux faire un depot Cantogrel/sunday-stream public
6. je ne sais pas, ce qui te semble pertinent


## Assistant

Voici ce que tes réponses changent dans le plan.

## 1. Les amis installent Sunday Stream
- **Choix des modules dans l'assistant de premier lancement.** Un ami ne coche que **Discord** (et Clips). Il ne voit alors aucune étape VB-Cable, Twitch ou téléphone.
- **Rien du module Canapé ne se charge s'il est désactivé** (audio, micro). Sur le PC d'un ami, une bibliothèque audio qui ne trouve pas son matériel ne pourra donc rien bloquer.
- **Code d'invitation de groupe.** Tu le génères depuis ton app : il contient les IDs des salons (vocal, logs, clips), sans le token. L'ami le colle, puis saisit le token que tu lui transmets en privé, comme aujourd'hui. Avec un dépôt public, c'est plus propre que d'intégrer les IDs dans l'installeur.
- **Transition progressive.** La compatibilité avec l'ancien exe reste obligatoire tant que les 4 n'ont pas migré : les marqueurs Discord restent identiques et un essai réel avec les deux versions en même temps est prévu en phase 2.
- **Gros gain pour eux :** les mises à jour deviennent automatiques. Plus d'exe envoyé à la main, plus de SHA-256 à vérifier.

## 2. L'app Android marche telle quelle, et pourra évoluer
- Le **protocole v1 est figé**. Toute évolution se fera en *ajoutant* des commandes ou des événements, sans rien modifier ni retirer. L'app actuelle ignore déjà les messages inconnus, je l'ai vérifié.
- Mêmes identifiant d'app (`com.lescopaings.couchstream`) et clé de signature. Les secrets de signature seront recopiés dans le nouveau dépôt, et la sauvegarde privée `couch-stream-signing` est conservée.
- L'APK reste fourni par le PC (`/app.apk`). Le bouton « Mettre à jour » de l'app continue donc de marcher après la fusion.

## 3. Clips : on ne refond pas maintenant, mais on prépare la suite
- **Phase 2 : on reprend l'existant en Node.** Sauvegarde du Replay Buffer, post dans Discord et vote des admins ✅/❌ à l'identique.
- **Détection automatique : remplacement à coût quasi nul.** La capture micro/clavier/manette de `signals.py` demanderait des modules natifs lourds en Node. On la remplace par les **niveaux sonores qu'OBS fournit déjà**. Aucun ajout de poids, et c'est au moins aussi bon que l'actuel, qui ne détecte presque rien.
- **Déclenchements manuels**, peu coûteux : un raccourci clavier global, un bouton dans l'app et `/clip` sur Discord.
- **Le module est découpé en étapes indépendantes :** source → repérage des moments → extraction → bibliothèque → vote → publication. Ajouter plus tard **l'import d'une VOD** revient alors à brancher une nouvelle source, sans tout refaire.
- **ffmpeg** sera nécessaire pour les VOD et pour rogner les clips. Il sera **téléchargé au premier usage** (comme VB-Cable aujourd'hui), pas inclus dans l'installeur.

## 4. Node, avec un installeur léger
Point de départ mesuré : l'installeur Couch fait **39,8 Mo**. Le runtime Node pèse 82 Mo avant compression. `node-web-audio-api` pèse 41 Mo à lui seul, sans doute parce qu'il contient les versions pour toutes les plateformes.

Les leviers :
- **Ne garder que les binaires Windows x64** des modules natifs. C'est probablement le gain le plus important ; je le vérifierai.
- **Regrouper le code du service** en un seul fichier JavaScript compact et retirer de l'installeur tout ce qui ne sert pas à l'exécution.
- **discord.js sans ses extensions natives facultatives.** Le bot n'a pas besoin de la voix, ce qui ajoute seulement quelques Mo.
- **Un seul runtime**, puisqu'il n'y a plus de Python.
- **Rien de lourd embarqué** : ffmpeg et VB-Cable sont téléchargés à la demande, et les visuels de scènes (10 Mo de PNG) restent hors de l'installeur.

Objectif fixé : **ne pas dépasser la taille actuelle de Couch**, et viser en dessous. La taille sera mesurée à chaque version.

## 5. Dépôt `Cantogrel/sunday-stream` public
- Créé en phase 1 à partir de l'historique de Couch. Les commits gardent l'e-mail `mathieu.cantogrel@gmail.com`, comme le dépôt actuel.
- Le **code Python du bot n'y sera pas importé.** Il reste dans son dossier, sous un git local, comme référence et solution de retour. Comme ça, ni `Sunday Stream Bot Token.txt`, ni `.env`, ni `bundle_defaults.py` ne peuvent fuiter dans un dépôt public.
- Le dépôt `couch-stream-app` reste tel quel, sans nouvelle version. L'ancienne app installée ne se mettra donc jamais à jour toute seule vers Sunday Stream : la bascule passe uniquement par la migration, que tu contrôles.

## 6. SteelSeries Moments
Le dossier contient 30 clips de 2024 (859 Mo), nommés par jeu et par date. Ce n'est **pas à faire au départ**. En revanche, la bibliothèque gérera des « dossiers sources » qu'elle lit sans copier les fichiers. Ajouter Moments plus tard sera alors une simple case à cocher. Ces clips pourront ensuite passer par le vote Discord ou la chaîne TikTok sans dupliquer 859 Mo.

## Phases mises à jour
| Phase | Ce qui change |
|---|---|
| **0. Préparation** | git local pour le bot, sauvegardes, rédaction des contrats (Android v1, marqueurs Discord), mesure de la taille de départ, note de décision dans le vault (elle remplace la note « projets séparés ») |
| **1. Squelette** | + dépôt public, + suppression des binaires inutiles dans l'installeur |
| **2. Discord** | + choix des modules, + code d'invitation, + clips repris à l'identique avec détection via OBS et déclenchements manuels |
| **3. En direct** | inchangée |
| **4. Distribution** | nouveau guide pour les amis, contrôle de la taille de l'installeur |
| **5. Bascule** | migration des 4 PC, puis fin de la compatibilité avec l'ancien exe |
| **Plus tard** | refonte des clips, import de VOD, dossier Moments |

La phase 0 ne touche à aucun code. Elle prépare seulement les filets de sécurité et la documentation des contrats.


## Utilisateur

fais un prompt adequat pour une nouvelle session clode caude avec le modèle sonnet 5.5, dans aucun projet, qui aura pour but démarrer le projet, en l'initialisant via les outils studi'os, en créant le dossier du projet, mettant la conversation concerné dans le dis projet, et de lancer la phase 0


## Assistant

Le prompt est prêt dans [PROMPT-Sunday-Stream-Phase0.md](PROMPT-Sunday-Stream-Phase0.md). Pour l'utiliser : ouvre une nouvelle session Code sans dossier, choisis **Sonnet 5.5** dans le sélecteur de modèle, puis colle tout le contenu du fichier.

**Ce que le prompt demande à la nouvelle session :**
- **Le contexte complet.** L'état des deux projets et les 7 décisions déjà prises avec toi y figurent, avec la consigne de ne pas les rediscuter. La nouvelle session n'a pas accès à cette conversation, donc tout ce qui est utile y est écrit.
- **Le démarrage :**
  - consulter le vault ;
  - créer `E:\Stream\Sunday Stream\` (avec `git init`, sans dépôt distant) ;
  - initialiser le projet dans Studio OS avec la roadmap des phases 0 à 5, en le présentant comme successeur de Couch Stream App. Elle doit te montrer l'aperçu avant de l'appliquer.
- **Rattacher cette conversation :** créer un groupe « Sunday Stream » dans la barre latérale et y déplacer cette session (`local_cf019feb-…`) ainsi que la nouvelle. Elle exporte aussi ce transcript dans `docs/history/`, et ne le versionne pas s'il contient un secret.
- **La phase 0 :**
  - sauvegardes dans `E:\Stream\_backups\…` ;
  - mise sous git local du bot, avec contrôle qu'aucun secret n'est versionné ;
  - deux contrats tirés du code réel : protocole Android v1 et marqueurs Discord ;
  - mesures de départ (taille de l'installeur) et checklist de non-régression ;
  - `PLAN.md` ;
  - notes dans le vault, dont la décision de fusion qui remplace l'ancienne note « projets séparés ».
- **Les limites :** aucun code, rien d'arrêté ni de supprimé, pas de création du dépôt GitHub ni de push avant la phase 1, aucun secret affiché. La roadmap Studio OS n'est mise à jour qu'après ta validation de la phase 0.

Le prompt est assez long, et c'est voulu : Sonnet part sans aucun contexte.
