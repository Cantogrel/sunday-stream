# Sunday Stream

Appli Windows unique qui gère tout ce qui touche au stream Twitch/OBS : pilotage depuis le canapé
(app Android « Couch Stream App »), chat et modération, et — à venir — le bot Discord du dimanche soir
et la gestion des clips. Elle fusionne les anciens projets *Couch Stream App* et *Sunday Stream Bot*.

Plan, décisions et phases : [docs/PLAN.md](docs/PLAN.md). Contrats à ne pas casser :
[docs/CONTRACT-ANDROID-V1.md](docs/CONTRACT-ANDROID-V1.md) (app Android installée),
[docs/CONTRACT-DISCORD.md](docs/CONTRACT-DISCORD.md) (compatibilité avec l'ancien exe).
Mesures de départ et non-régression : [docs/BASELINE.md](docs/BASELINE.md).

## Architecture

```
[Téléphone Android — app Capacitor « Couch Stream App », inchangée]
        │ WebSocket (protocole v1 figé) + audio Opus/WebRTC, LAN
        ▼
[PC — Sunday Stream (Tauri v2)]            desktop/
   fenêtre d'appli + zone de notification · instance unique · démarrage avec Windows · mises à jour signées
        │ supervise
        ▼
   [service Node, un seul fichier]         pc-service/
   obs-websocket · Twitch IRC/Helix · audio micro → VB-Cable · serveur HTTP+WS · mDNS
   pages : /app (fenêtre), /desktop (console), /setup (assistant)
        │
        ▼
[OBS Studio] → source micro = VB-Cable → diffuse vers Twitch
```

- `desktop/` — application Windows (Tauri v2, Rust) : tray, fenêtre, migration depuis Couch, mises à jour.
- `pc-service/` — service Node supervisé (regroupé en un seul fichier par esbuild à l'installation).
- `mobile-app/` — app Android (UI web `www/` + plugins natifs). Même `applicationId`, même keystore que Couch.
- `docs/` — plan, contrats, mesures, guides.

## Identité

Produit « Sunday Stream » · identifiant `com.binagames.sundaystream` · données `%APPDATA%\SundayStream` ·
version `0.2.0` (le téléphone compare cette version à la sienne pour proposer sa mise à jour).

## Développement

```bash
# Service seul (données dans un dossier de test, port libre)
cd pc-service && npm ci
SUNDAY_DATA_DIR=/chemin/test LOCAL_WS_PORT=8790 node src/index.js
node scripts/conformance-android-v1.mjs 8790      # vérifie le contrat Android v1

# Application Windows (installeur)
cd desktop && npm ci && npm run build             # prépare le sidecar puis tauri build
```

APK Android : voir [mobile-app/README.md](mobile-app/README.md) (JDK 21, SDK Android, keystore hors dépôt).
Publication et signature : [docs/RELEASE.md](docs/RELEASE.md).
Installation côté utilisateur : [docs/INSTALLATION.md](docs/INSTALLATION.md).
Migration depuis Couch Stream App et l'ancien exe : [docs/MIGRATION.md](docs/MIGRATION.md).

## Historique

Le dépôt repart de l'historique de *Couch Stream App* (v0.1.0 → v0.1.4). Le code Python de *Sunday Stream Bot*
n'est jamais importé : le bot Discord est réécrit en Node dans le service (phase 2).
