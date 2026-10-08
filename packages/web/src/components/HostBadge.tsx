/** Petit badge qui signale l'hôte du salon (lui seul lance la partie, change les réglages et retire des joueurs). */
export function HostBadge() {
  return (
    <span className="host-badge" title="Hôte du salon : lance la partie, règle le minuteur, peut retirer un joueur">
      Hôte
    </span>
  );
}
