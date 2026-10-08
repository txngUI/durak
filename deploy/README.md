# Mettre Durak en ligne sur le VPS

Le principe : à chaque push sur `main`, GitHub Actions lance les tests, construit l'image Docker, la publie sur `ghcr.io/txngui/durak`, puis se connecte au VPS en SSH pour la mettre à jour. Caddy sert le jeu en HTTPS sur `durak.tanguydavid.fr`.

```
push main ──► GitHub Actions : tests ─► image ghcr.io ─► ssh VPS : docker compose pull && up -d
                                                          │
navigateur ──► https://durak.tanguydavid.fr ──► Caddy ──► 127.0.0.1:3010 ──► conteneur durak
```

À faire une seule fois, dans l'ordre.

## 1. DNS chez Hostinger

Dans hPanel → Domaines → `tanguydavid.fr` → DNS / Nameservers, ajoute :

| Type | Nom | Pointe vers | TTL |
| --- | --- | --- | --- |
| A | `durak` | l'IPv4 du VPS PulseHeberg | 3600 |
| AAAA (si le VPS a une IPv6) | `durak` | l'IPv6 du VPS | 3600 |

Vérifie depuis ton PC (quelques minutes peuvent être nécessaires) :

```bash
getent hosts durak.tanguydavid.fr
```

## 2. Vérifier Docker sur le VPS

```bash
docker --version && docker compose version
```

S'il manque, installe-le avec le script officiel : `curl -fsSL https://get.docker.com | sh`.

## 3. Un utilisateur et une clé SSH réservés au déploiement

Sur **ton PC**, crée une clé dédiée (sans phrase de passe, GitHub doit pouvoir l'utiliser seul) :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/durak_deploy -N "" -C "github-actions durak"
```

Sur **le VPS**, crée un utilisateur `deploy` qui peut piloter Docker, et autorise la clé :

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo -u deploy mkdir -p /home/deploy/.ssh /home/deploy/durak
echo 'COLLE_ICI_LE_CONTENU_DE_durak_deploy.pub' | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
sudo chmod 700 /home/deploy/.ssh && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

> Le groupe `docker` donne un accès équivalent à root sur le VPS. C'est le compromis habituel pour ce type de déploiement : garde la clé privée uniquement dans les secrets GitHub.

Teste depuis ton PC : `ssh -i ~/.ssh/durak_deploy deploy@IP_DU_VPS docker ps`

## 4. Le conteneur

Copie `deploy/docker-compose.yml` dans `/home/deploy/durak/docker-compose.yml` sur le VPS. Le jeu écoute sur `127.0.0.1:3010` (invisible depuis Internet, seul Caddy y accède). Si le port 3010 est déjà pris par ton autre projet, change-le ici et dans le Caddyfile.

## 5. Caddy

Regarde comment ton Caddy tourne :

```bash
systemctl status caddy        # installé directement sur le VPS ?
docker ps | grep -i caddy     # ou dans un conteneur ?
```

- **Caddy installé sur le VPS** : ajoute le bloc de `deploy/Caddyfile` à `/etc/caddy/Caddyfile`, puis `sudo systemctl reload caddy`.
- **Caddy dans Docker** : utilise la variante `reverse_proxy durak:3000` et branche les deux conteneurs sur le même réseau (par exemple `docker network connect <reseau_de_caddy> durak`, ou un réseau `external` déclaré dans les deux docker-compose). Puis recharge Caddy.

Caddy obtient le certificat HTTPS automatiquement dès que le DNS de l'étape 1 répond.

## 6. Configurer le dépôt GitHub

Sur https://github.com/txngUI/durak → Settings → Secrets and variables → Actions :

| Onglet | Nom | Valeur |
| --- | --- | --- |
| Secrets | `VPS_SSH_KEY` | tout le contenu de `~/.ssh/durak_deploy` (la clé **privée**, lignes BEGIN/END comprises) |
| Variables | `VPS_HOST` | l'IP du VPS |
| Variables | `VPS_USER` | `deploy` |
| Variables | `VPS_PORT` | seulement si SSH n'est pas sur le port 22 |

Tant que `VPS_HOST` n'est pas défini, l'étape de déploiement est simplement sautée (les tests et l'image tournent quand même).

## 7. Premier déploiement

Dans l'onglet Actions du dépôt, relance le workflow « Tests et déploiement » (Run workflow), ou pousse un commit sur `main`.

Si le VPS répond `unauthorized` ou `denied` au moment du `docker compose pull`, c'est que l'image est privée sur ghcr.io. Deux solutions :

- la rendre publique : github.com/txngUI → Packages → `durak` → Package settings → Change visibility → Public ;
- ou connecter le VPS au registre une fois : `docker login ghcr.io -u txngUI` avec un token GitHub ayant le droit `read:packages`.

Ensuite, ouvre https://durak.tanguydavid.fr.

## En cas de souci

```bash
docker compose -f ~/durak/docker-compose.yml logs -f     # journaux du jeu
docker compose -f ~/durak/docker-compose.yml ps          # état et healthcheck
curl -s localhost:3010/health                            # doit répondre "ok"
journalctl -u caddy -f                                   # journaux de Caddy (installé sur le VPS)
```

Les salons sont en mémoire : chaque déploiement redémarre le conteneur et coupe les parties en cours.
