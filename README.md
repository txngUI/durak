# Durak

Le jeu de cartes russe, jouable en ligne de 2 à 6 joueurs. On crée un salon, on donne le code de 6 caractères à ses amis, et le dernier avec des cartes en main est le *durak*.

Les règles suivent [le PDF d'origine](docs/maquettes.html#regles), avec ces lectures validées :

- **Relance** : uniquement avec la valeur de la dernière carte d'attaque ou de sa défense.
- **Tour suivant** : le voisin du dernier attaquant, côté opposé au défenseur, attaque le dernier attaquant (sens constant, même après un ramassage).
- **3 poses d'affilée** : une carte posée en attaque sur 2 plis consécutifs ne peut pas l'être au 3ᵉ.
- À 6 joueurs le talon est vide après la donne : la dernière carte distribuée donne l'atout.

## Démarrer

Prérequis : Node 22 ou plus récent.

```bash
npm install
npm run dev
```

Le front est sur http://localhost:5173, le serveur temps réel sur le port 3000 (Vite fait le proxy). Chaque onglet est un joueur différent : ouvre plusieurs onglets pour tester à plusieurs.

Pour remplir un salon avec de faux joueurs qui jouent au hasard (outil de dev, pas les bots de la V2) :

```bash
npx tsx packages/server/scripts/fake-players.ts ABC-123 2
```

## Tests

```bash
npm test
```

Le moteur est testé règle par règle, plus des centaines de parties aléatoires complètes de 2 à 6 joueurs qui vérifient que les 36 cartes sont toujours comptées et que chaque partie se termine.

## Production

```bash
npm run build
npm start
```

Ou avec Docker (les tests tournent pendant le build) :

```bash
docker build -t durak .
docker run -p 3000:3000 durak
```

Pour la mise en ligne sur le VPS (Caddy + déploiement automatique depuis GitHub), suis [deploy/README.md](deploy/README.md).

Un seul processus Node sert le front buildé et le temps réel sur le port `PORT` (3000 par défaut). Les salons sont en mémoire : un redémarrage du serveur les efface.

## Organisation

| Dossier | Rôle |
| --- | --- |
| `packages/engine` | Règles du jeu en TypeScript pur, sans dépendance. Partagé par le serveur et le front. |
| `packages/server` | Node + Socket.IO. Arbitre les parties : chaque joueur ne reçoit que sa main. |
| `packages/web` | React + Vite + Zustand + Motion. |
| `docs/maquettes.html` | Maquettes et choix techniques validés. |

## Prévu en V2

Bots, comptes et statistiques, matchmaking public.
