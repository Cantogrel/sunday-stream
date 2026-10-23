# Migrer vers Sunday Stream

Deux chemins, indépendants. Rien n'est jamais supprimé sans ta confirmation : les données de l'ancien programme sont
**copiées**, jamais déplacées.

## Depuis Couch Stream App

Un Couch déjà installé **ne se met pas à jour** vers Sunday Stream (son updater interroge l'ancien dépôt) : on passe par
l'installeur de Sunday Stream.

1. Installe Sunday Stream (voir [INSTALLATION.md](INSTALLATION.md)).
2. Au premier lancement, si des données de Couch existent dans `%APPDATA%\CouchStreamApp`, une fenêtre propose de les
   reprendre. En acceptant :
   - Couch est fermé (un live en cours piloté par Couch serait interrompu : choisis le bon moment) ;
   - `identity.json`, `devices.json`, `secrets.dat`, `.env`, `setup.json` et `obs-path.txt` sont **copiés** dans
     `%APPDATA%\SundayStream` (un fichier déjà présent est gardé sous `<nom>.avant-import`) ;
   - le démarrage automatique de Couch est retiré, pour que les deux ne se disputent pas le port.
3. Plus rien à refaire : **le téléphone reste jumelé** (même identité de PC), l'app Android installée continue de
   fonctionner et propose sa mise à jour depuis le PC. Les jetons Twitch (`secrets.dat`) sont chiffrés avec ton compte
   Windows : **sur un autre PC ou un autre compte Windows, la connexion Twitch est à refaire** (assistant, étape 3).
4. Tu peux relancer la reprise à tout moment : menu de l'icône → « Reprendre les données de Couch ».
5. Une fois satisfait, désinstalle Couch Stream App toi-même (Paramètres Windows → Applications). Ses données restent
   dans `%APPDATA%\CouchStreamApp` tant que tu ne les supprimes pas.

## Depuis l'ancien Sunday Stream Bot (l'exe Python)

Les deux versions **cohabitent** sans problème tant que la compatibilité dure : mêmes messages, mêmes marqueurs, même
verrou, même vote des clips (voir [CONTRACT-DISCORD.md](CONTRACT-DISCORD.md)). Un PC peut donc migrer avant les autres.

1. Installe Sunday Stream et ouvre la section **Discord**.
2. **Reprendre l'ancien Sunday Stream Bot → Importer la configuration** : l'appli retrouve l'ancien exe grâce à sa
   tâche planifiée et lit son `.env` (token, salons, jour et heures, seuil des clips, accès OBS si OBS n'est pas encore
   configuré). Le token et le mot de passe ne s'affichent jamais ; le token est stocké chiffré.
3. Vérifie la configuration, puis **Connecter maintenant (test)**.
4. Seulement quand tout est bon : **Arrêter l'ancien bot et supprimer ses 2 tâches planifiées**. L'ancien bot est
   arrêté proprement (`--stop`), puis `SundayStreamBot_Start` et `SundayStreamBot_Stop` sont supprimées : la
   planification est désormais interne à Sunday Stream (début − 30 min, fin + 30 min).
5. Le dossier de l'ancien exe n'est pas touché : tu le supprimes toi-même plus tard.

Ne lance **pas** l'ancien bot et Sunday Stream en même temps *sur le même PC* : ils se connecteraient tous les deux à
Discord avec le même token. Entre PC différents, aucun souci.

## En cas de retour en arrière

Couch et l'ancien exe n'ont pas été modifiés : relance-les et arrête Sunday Stream (clic droit sur l'icône → Quitter).
Pour l'ancien bot, recrée simplement les deux tâches planifiées avec son installeur.
