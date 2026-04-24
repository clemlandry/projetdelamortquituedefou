# HxH RPG — Bot Discord + Activity

Architecture **découplée** : le bot et l'Activity communiquent **uniquement avec Supabase**, jamais entre eux.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Discord    │────▶│   BOT        │────▶│  Supabase           │
│  (slash     │     │  (Node.js)   │◀────│  (base de données)  │
│  commands)  │     └──────────────┘     └──────────▲──────────┘
│             │                                     │
│  (Activity) │────▶│  ACTIVITY          ──────────▶│
│             │     │  Frontend (Vite)              │
└─────────────┘     │  Backend (Vercel / Express)───┘
                    └──────────────────────┘
```

---

## 📁 Structure

```
hxh-rpg/
├── bot/               ← Bot Discord (hébergé séparément)
│   ├── src/
│   │   ├── index.js                  ← Point d'entrée : node src/index.js
│   │   ├── deploy-commands.js        ← Déploiement des slash commands
│   │   ├── handlers/
│   │   │   ├── commandHandler.js
│   │   │   └── eventHandler.js
│   │   ├── events/
│   │   │   ├── ready.js
│   │   │   ├── interactionCreate.js
│   │   │   └── guildMemberAdd.js
│   │   ├── commands/
│   │   │   ├── rpg/
│   │   │   │   ├── profil.js         ← /profil [joueur]
│   │   │   │   ├── inscription.js    ← /inscription
│   │   │   │   ├── stats.js          ← /stats voir|ajouter
│   │   │   │   ├── nen.js            ← /nen voir|type|maitrise|debloquer
│   │   │   │   ├── technique.js      ← /technique liste|ajouter|supprimer
│   │   │   │   └── classement.js     ← /classement [level|reputation|jenny]
│   │   │   └── admin/
│   │   │       └── admin.js          ← /admin jenny|xp|points|reputation|...
│   │   └── utils/
│   │       ├── supabase.js
│   │       ├── db.js
│   │       └── embeds.js
│   └── .env
│
└── activity/          ← Activity Discord (Vercel ou local)
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx                   ← UI complète (ton code existant amélioré)
    │   └── lib/supabase.js
    ├── api/
    │   ├── token.js                  ← POST /api/token  (échange OAuth)
    │   └── image.js                  ← GET  /api/image  (proxy images)
    ├── server.js                     ← Serveur Express local (dev + cloudflared)
    ├── vite.config.js
    ├── vercel.json
    └── .env
```

---

## 🤖 Partie Bot

### Installation
```bash
cd bot
npm install
```

### Déploiement des slash commands
```bash
npm run deploy
# Déploie sur le serveur GUILD_ID (instantané)
# Pour les rendre globales, retire le GUILD_ID dans deploy-commands.js
```

### Démarrage
```bash
npm start
# ou en mode watch (Node 18+)
npm run dev
```

### Hébergeurs gratuits recommandés
- **Railway** (500h/mois gratuit) — le plus simple, supporte `npm start`
- **Render** (free tier) — fonctionne bien pour les bots Discord
- **Fly.io** — free tier généreux
- **Discloud** — spécialisé bots Discord

> ⚠️ Le bot n'a **pas besoin d'URL publique** — il utilise le gateway Discord (WebSocket sortant).
> Les hébergeurs HTTP-only (Render free, etc.) fonctionnent parfaitement.

---

## 🎮 Partie Activity (Frontend + Backend)

### Option A — Test local avec cloudflared

```bash
cd activity
npm install

# Terminal 1 : frontend Vite + backend Express
npm run dev

# Terminal 2 : tunnel cloudflare (remplace l'URL dans le portail Discord)
cloudflared tunnel --url http://localhost:3000
```

Le frontend tourne sur `:5173` (Vite), le backend sur `:3000` (Express).
Vite proxifie automatiquement `/api/*` vers `:3000`.

**Dans le portail Discord (Applications → ton app → Activities) :**
- URL de l'Activity : `https://xxxx.trycloudflare.com`

> ⚠️ L'URL cloudflared change à chaque redémarrage. Mets-la à jour dans le portail Discord.

---

### Option B — Déploiement Vercel (production)

```bash
cd activity
npm install -g vercel   # si pas installé
npm run build
vercel deploy --prod
```

**Variables d'environnement à ajouter dans Vercel Dashboard :**
```
DISCORD_CLIENT_ID      = 1275182262534672444
DISCORD_CLIENT_SECRET  = MPfGWT3N_B8Ohfm1EQhZiFf5q_tjWgl1
SUPABASE_URL           = https://qarwvvkdfvffbgtzuqhn.supabase.co
SUPABASE_ANON_KEY      = eyJ...
```

Les fonctions `api/token.js` et `api/image.js` sont déployées automatiquement comme **Vercel Serverless Functions**.

**Dans le portail Discord :**
- URL de l'Activity : `https://ton-projet.vercel.app`

---

## 🗄️ Base de données Supabase

### Tables requises
```sql
-- Joueurs
create table players (
  discord_id text primary key,
  username text not null,
  char_name text default '',
  char_surname text default '',
  char_image text default '',
  nen_type text default 'Inconnu',
  location text default '',
  nen_mastery int default 0,
  reputation float default 0,
  xp int default 0,
  level int default 1,
  jenny int default 500,
  stat_points int default 999999,
  created_at timestamp default now()
);

create table stats (
  discord_id text primary key references players(discord_id),
  force int default 1, vitesse int default 1,
  resistance int default 1, technique int default 1
);

create table nen_abilities (
  discord_id text primary key references players(discord_id),
  ten int default 0, ren int default 0, zetsu int default 0,
  in_ int default 0, en int default 0, ken int default 0, gyo int default 0
);

create table techniques (
  id bigint generated always as identity primary key,
  discord_id text references players(discord_id),
  name text, description text default ''
);

create table hatsu_affinities (
  discord_id text primary key references players(discord_id),
  renforcement text default 'E', transformation text default 'E',
  materialisation text default 'E', specialisation text default 'E',
  manipulation text default 'E', emission text default 'E'
);
```

### RLS (Row Level Security)
Pour que les joueurs ne puissent modifier **que leur propre profil**, active RLS :

```sql
-- Dans Supabase → Authentication → Policies
alter table players enable row level security;
alter table stats enable row level security;
alter table nen_abilities enable row level security;
alter table hatsu_affinities enable row level security;
alter table techniques enable row level security;

-- Politique "chacun voit tout, modifie seulement le sien"
create policy "select_all" on players for select using (true);
create policy "update_own" on players for update using (auth.uid()::text = discord_id);
-- (répéter pour stats, nen_abilities, hatsu_affinities)
```

> Pour la version actuelle avec `anon_key`, les écritures sont autorisées librement.
> La RLS est recommandée si tu veux sécuriser les données côté Supabase.

---

## 🎯 Commandes disponibles

| Commande | Description | Permissions |
|---|---|---|
| `/inscription` | Crée/récupère ton profil | Tous |
| `/profil [joueur]` | Affiche le profil | Tous |
| `/stats voir [joueur]` | Affiche les stats | Tous |
| `/stats ajouter <stat> <pts>` | Dépense des points de stat | Tous |
| `/nen voir [joueur]` | Affiche le Nen | Tous |
| `/nen type <joueur> <type>` | Définit le type de Nen | Admin |
| `/nen maitrise <joueur> <val>` | Définit la maîtrise Nen | Admin |
| `/nen debloquer <joueur> <tech>` | Débloque une technique de base | Admin |
| `/technique liste [joueur]` | Liste les techniques | Tous |
| `/technique ajouter <joueur> <nom>` | Ajoute une technique | Admin |
| `/technique supprimer <joueur> <nom>` | Supprime une technique | Admin |
| `/classement [type]` | Classement général | Tous |
| `/admin jenny <joueur> <montant>` | Donne/retire des Jenny | Admin |
| `/admin xp <joueur> <montant>` | Donne de l'XP | Admin |
| `/admin points <joueur> <montant>` | Donne des points de stat | Admin |
| `/admin reputation <joueur> <val>` | Change la réputation | Admin |
| `/admin localisation <joueur> <lieu>` | Change la localisation | Admin |
| `/admin reset <joueur>` | Remet les stats à 1 | Admin |

---

## ➕ Ajouter une commande

1. Créer `bot/src/commands/<categorie>/macommande.js`
2. Exporter `data` (SlashCommandBuilder) et `execute(interaction, client)`
3. Relancer `npm run deploy` pour enregistrer la commande
4. Redémarrer le bot

Le handler la charge **automatiquement** — pas besoin de l'importer ailleurs.

---

## ➕ Ajouter un event

1. Créer `bot/src/events/monEvent.js`
2. Exporter `name`, `once` (optionnel), et `execute`
3. Redémarrer le bot — chargement automatique.
#   p r o j e t d e l a m o r t q u i t u e d e f o u  
 