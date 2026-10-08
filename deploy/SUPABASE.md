# Activer les comptes (V2) avec Supabase

Sans cette configuration, le jeu fonctionne exactement comme la V1 : tout le monde joue en invité. Une fois les trois clés en place, la connexion Discord / Google / e-mail, les statistiques et le classement s'activent tout seuls.

Aucune clé secrète ne doit passer par le chat, un commit ou GitHub : elles vont dans un fichier `.env`, en local et sur le VPS.

## 1. Créer le projet

Sur https://supabase.com → New project :

- **Nom** : `durak`
- **Région** : Europe (Paris ou Francfort), au plus près du VPS
- **Mot de passe de la base** : génère-le et garde-le dans ton gestionnaire de mots de passe (on n'en a pas besoin ensuite).

## 2. Créer les tables

Supabase → **SQL Editor** → New query → colle tout le contenu de `supabase/migrations/20261008120000_comptes_et_stats.sql` → **Run**.

Vérifie dans **Table Editor** que `profiles`, `games` et `game_players` existent.

## 3. Adresses autorisées

Supabase → **Authentication → URL Configuration** :

| Réglage | Valeur |
| --- | --- |
| Site URL | `https://durak.tanguydavid.fr` |
| Redirect URLs | `https://durak.tanguydavid.fr/**` et `http://localhost:5173/**` |

## 4. Connexion par e-mail

Activée par défaut (**Authentication → Sign In / Providers → Email**). Laisse « Confirm email » activé : chaque inscription reçoit un lien à cliquer.

> Le service d'e-mail fourni par Supabase est limité à quelques messages par heure. Suffisant entre amis ; si ça bloque un jour, on branchera un SMTP (Brevo, Resend…) dans **Authentication → Emails → SMTP Settings**.

## 5. Connexion Discord

1. https://discord.com/developers/applications → **New Application** → nom `Durak`.
2. Onglet **OAuth2** → **Redirects** → ajoute l'adresse de rappel que Supabase affiche dans **Authentication → Sign In / Providers → Discord** (de la forme `https://xxxx.supabase.co/auth/v1/callback`).
3. Copie le **Client ID** et le **Client Secret** (Reset Secret) de Discord dans ce même écran Supabase, active Discord, enregistre.

## 6. Connexion Google

1. https://console.cloud.google.com → crée un projet `Durak`.
2. **APIs & Services → OAuth consent screen** : type External, nom de l'application `Durak`, ton e-mail de contact. Publie l'application (sinon seuls les comptes de test peuvent se connecter).
3. **Credentials → Create credentials → OAuth client ID** → type *Web application* :
   - Authorized JavaScript origins : `https://durak.tanguydavid.fr`
   - Authorized redirect URIs : la même adresse de rappel Supabase qu'à l'étape 5.
4. Copie le **Client ID** et le **Client secret** dans Supabase → **Authentication → Sign In / Providers → Google**, active, enregistre.

## 7. Les clés

Supabase → **Project Settings → API Keys** (et **Data API** pour l'URL) :

| Variable | Où la trouver | Secrète ? |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) | non |
| `SUPABASE_ANON_KEY` | clé publique (*anon* ou *publishable*) | non : elle est envoyée aux navigateurs |
| `SUPABASE_SERVICE_ROLE_KEY` | clé *service_role* ou *secret* | **oui** : elle donne tous les droits sur la base |

### En local

Copie `.env.example` en `.env` à la racine du projet et remplis les trois valeurs, puis relance `npm run dev`. Le serveur affiche « comptes activés ».

### Sur le VPS

```bash
cd /home/deploy/durak
nano .env            # colle les trois lignes SUPABASE_…
chmod 600 .env
```

Remplace aussi `docker-compose.yml` par la nouvelle version de `deploy/docker-compose.yml` (elle ajoute le fichier `.env` et le volume qui sauvegarde les salons pendant les mises à jour), puis :

```bash
docker compose up -d
docker compose logs --tail 5    # doit afficher « comptes activés »
```
