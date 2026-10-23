# Installer Sunday Stream

Sunday Stream est l'application Windows du groupe pour le stream du dimanche soir. Selon ce que tu veux en faire,
tu actives un ou plusieurs **modules** :

| Module | Pour qui | Ce que ça fait |
|---|---|---|
| **Discord** | Tous ceux qui peuvent lancer le stream | Détecte ton arrivée dans le salon vocal, propose « Lancer le stream ? », évite que deux personnes streament en même temps |
| **Clips** | Idem (optionnel) | Sauvegarde le Replay Buffer d'OBS, publie le clip sur Discord, vote des admins |
| **Canapé** | Le diffuseur (chaîne Twitch) | Pilote OBS et le chat Twitch depuis le téléphone Android, avec le micro du téléphone |

> **Tu viens juste rejoindre le groupe Discord ?** Va directement au [parcours « ami »](#parcours-ami--rejoindre-le-groupe-discord).
> Tu n'as besoin ni d'Android, ni de compte Twitch, ni de VB-Cable.

## Ce qu'il te faut

- Un PC **Windows 10 ou 11** avec **OBS Studio 28 ou plus récent** ([obsproject.com](https://obsproject.com/fr/download)),
  déjà configuré avec ta scène de stream (le serveur WebSocket est intégré à OBS depuis la version 28).
- Pour le module Canapé seulement : un compte **Twitch** (celui de la chaîne) et un téléphone **Android** sur le
  **même Wi-Fi** que le PC.

## Parcours ami — rejoindre le groupe Discord

1. Installe l'application (étape 1 ci-dessous). La page « Bienvenue » du premier lancement concerne le module Canapé : tu peux la fermer.
2. L'administrateur du groupe t'envoie **deux choses, séparément** : le **code d'invitation** (`SS1-…`) et le
   **token du bot**. Le code ne contient que des identifiants de salons, jamais le token : ne les envoie pas dans le
   même message.
3. Dans la fenêtre : **Discord → Rejoindre un groupe**, colle le code, **Appliquer**.
4. Colle le token dans **Configuration → Token du bot**, puis **Détecter** à côté de « Mon ID Discord » (rejoins le
   salon vocal quand l'appli te le demande) et **Enregistrer**.
5. Dans **Modules de cette installation**, laisse **Discord** coché (et **Clips** si tu veux), décoche **Canapé**.
6. Ouvre OBS (WebSocket activé) puis **Connecter maintenant (test)** : l'état doit passer à « connecté ».

À partir de là, le dimanche soir, l'appli se connecte toute seule 30 min avant le début et se ferme 30 min après la
fin : rien d'autre à lancer.

## Étape 1 — Installer l'application Windows

1. Lance `Sunday Stream_x.y.z_x64-setup.exe`. Aucun droit administrateur
   n'est demandé.
2. Windows SmartScreen peut afficher « Windows a protégé votre ordinateur »
   (l'installeur n'est pas encore signé par un éditeur reconnu) : clique sur
   **Informations complémentaires → Exécuter quand même**.
3. Une icône apparaît dans la zone de notification (près de l'horloge, parfois
   derrière la flèche `^`). Le service démarre tout seul, y compris à chaque
   démarrage de Windows.

## Étape 2 — L'assistant de configuration (module Canapé)

Au premier lancement, une page « Bienvenue dans Sunday Stream » s'ouvre. Tu
peux la rouvrir à tout moment : clic droit sur l'icône → **Assistant de
configuration**. Chaque étape se vérifie toute seule.

1. **OBS Studio** — lance OBS. L'assistant retrouve tout seul le mot de passe
   du serveur WebSocket ; clique sur « Connecter avec les réglages détectés ».
   Si le serveur est désactivé : dans OBS, *Outils → Paramètres du serveur
   WebSocket → Activer*.
2. **Audio du téléphone (VB-Cable)** — un câble audio virtuel gratuit. Clique
   sur « Installer VB-Cable » : le pilote est téléchargé depuis le site officiel
   de VB-Audio, sa signature est vérifiée, puis Windows te demande **une seule
   autorisation administrateur**. VB-CABLE est un logiciel *donationware*
   ([vb-cable.com](https://vb-cable.com)) : une participation est la bienvenue
   si tu le trouves utile.
3. **Compte Twitch** — « Se connecter avec Twitch » : un code s'affiche et la
   page `twitch.tv/activate` s'ouvre. Connecte-toi avec le compte **de la
   chaîne**, entre le code, autorise. Aucun mot de passe n'est saisi dans
   l'application.
4. **Micro dans OBS** — « Créer la source micro » ajoute une source
   « Micro Téléphone » dans tes scènes, sans toucher à tes sources existantes.
5. **Ton téléphone** — deux QR codes : le premier télécharge l'application
   Android, le second la jumelle avec ce PC.

## Étape 3 — L'application Android (module Canapé)

1. Scanne le premier QR avec l'appareil photo du téléphone : le fichier
   `CouchStream.apk` se télécharge.
2. Android demande d'autoriser l'installation depuis ton navigateur
   (« Installer des applis inconnues ») : c'est normal, l'application n'est pas
   sur le Play Store.
3. Ouvre l'application, va dans **Réglages → « Jumeler avec le PC »**, et scanne
   le second QR. Si la mise au point est capricieuse, touche l'image pour la
   refaire, ou utilise le curseur de zoom.
4. Autorise le micro et les notifications quand Android le demande.

C'est fini. Tu retrouves le tableau de bord, les scènes, le chat et le micro.

## Au quotidien

- L'icône de la zone de notification : clic gauche = **console PC** (aperçu du
  live, démarrer/arrêter, scènes, santé, chat). Clic droit = menu (jumelage,
  assistant, dossier de données, mise à jour, démarrage avec Windows, quitter).
- OBS n'a pas besoin d'être ouvert avant le service : il se reconnecte tout
  seul, et la console propose un bouton « Ouvrir OBS ».
- Si le PC change d'adresse sur ton réseau, l'application Android le retrouve
  toute seule.
- **Oublier un téléphone** : console → « Téléphone & infos » → « Oublier ».

## En cas de problème

Console → « Téléphone & infos » → **Copier le rapport de diagnostic**, puis
colle-le dans un message à la personne qui t'aide. Le rapport contient les
versions, l'état d'OBS/Twitch/VB-Cable et un extrait du journal ; **aucun mot de
passe ni jeton** n'y figure.

| Symptôme | Piste |
|---|---|
| « OBS n'est pas connecté » | OBS est fermé, ou son serveur WebSocket est désactivé (*Outils → Paramètres du serveur WebSocket*). |
| Pas de son du téléphone dans OBS | VB-Cable absent (étape 2) ou source micro non créée (étape 4). Si l'installation de VB-Cable vient d'être faite, redémarre le PC. |
| Le téléphone ne trouve pas le PC | Même Wi-Fi ? Le pare-feu Windows a-t-il autorisé « Sunday Stream » sur les réseaux privés ? Bouton « Chercher le PC sur le réseau » dans les Réglages de l'app. |
| « Jumelage refusé par le PC » | Le téléphone a été oublié côté PC : rejumelle-le par QR. |
| « Connexion Discord impossible » | Token du bot incorrect ou collé avec un espace : recopie-le sans espace ni guillemets. |
| Aucune fenêtre « Lancer le stream ? » | Hors fenêtre active (jour/heures du groupe), ou un stream est déjà en cours (verrou Discord), ou « plus de rappel ce soir » a été choisi. Journal dans Discord → État. |
| Le chat Twitch ne se connecte pas | Étape 3 de l'assistant à refaire (le jeton a peut-être expiré ou été révoqué). |

## Confidentialité

Aucune télémétrie. Le téléphone parle directement au PC, sur ton réseau local. Les jetons Twitch sont chiffrés avec ton compte Windows. Le token Discord est chiffré de la même façon. Les
seules connexions sortantes sont Discord, Twitch (chat/modération), le téléchargement de
VB-Cable (et de ffmpeg pour les clips) et la vérification des mises à jour.
