import { Modal } from './Modal';

export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Modal wide onClose={onClose} label="Règles du Durak">
      <h2>Règles du Durak</h2>
      <p>
        Jeu de cartes russe, de 2 à 6 joueurs, avec 36 cartes (du 6 à l’As). Le dernier joueur avec des cartes en main est
        le <i>durak</i> : l’idiot.
      </p>
      <h3>Valeur des cartes</h3>
      <p>6 · 7 · 8 · 9 · 10 · J · Q · K · A. L’atout bat toujours une carte non-atout.</p>
      <h3>À 5 ou 6 joueurs</h3>
      <p>
        On ajoute deux couleurs de 9 cartes (du 6 à l’As) : le <b>lys ⚜︎</b>, noir, et l’<b>étoile ★</b>, rouge. Le jeu
        passe à 54 cartes, ce qui laisse une vraie pioche. Elles se jouent exactement comme les autres couleurs, et l’une
        d’elles peut être l’atout.
      </p>
      <h3>Mise en place</h3>
      <ul>
        <li>6 cartes par joueur, distribuées 2 par 2.</li>
        <li>La carte suivante est retournée sous la pioche : sa couleur est l’atout.</li>
        <li>
          Le durak de la partie précédente défend en premier, sinon le joueur ayant l’atout le plus faible. Il choisit
          lequel de ses deux voisins l’attaque.
        </li>
      </ul>
      <h3>Un pli</h3>
      <ul>
        <li>L’attaquant pose une carte devant le défenseur.</li>
        <li>
          Le défenseur la bat avec une carte de même couleur et plus forte, ou avec un atout (un atout ne bat un atout que
          s’il est plus fort).
        </li>
        <li>
          L’attaquant peut relancer avec une carte de même valeur que l’une des deux cartes qui viennent d’être posées. S’il
          ne peut ou ne veut pas, les autres joueurs peuvent prendre le relais dans l’ordre de la table. Un joueur qui passe
          son tour, ou qui n’a pas pu relancer, ne peut plus relancer pendant ce pli.
        </li>
        <li>6 attaques contrées, ou plus personne ne relance : les cartes vont à la défausse.</li>
        <li>Si le défenseur ne peut ou ne veut pas battre une carte, il ramasse toutes les cartes en jeu.</li>
        <li>Une même carte ne peut pas être posée en attaque sur 3 plis d’affilée.</li>
      </ul>
      <h3>Pioche et tour suivant</h3>
      <ul>
        <li>
          Chacun complète sa main à 6 cartes : attaquant, puis les autres joueurs, puis le défenseur s’il a tout battu.
        </li>
        <li>
          Le prochain attaquant est le voisin du dernier attaquant, du côté opposé au défenseur ; il attaque le dernier
          attaquant.
        </li>
      </ul>
      <h3>Fin de partie</h3>
      <ul>
        <li>Pioche vide : on continue avec les cartes en main. Le premier à vider sa main gagne : c’est le Korol.</li>
        <li>
          Le dernier joueur à avoir encore des cartes est le durak. Il n’y a pas d’égalité : si l’attaquant et le
          défenseur se vident sur le même pli, le défenseur est le durak.
        </li>
        <li>
          Partie bloquée : si la pioche est vide, que plus aucune carte en jeu ne peut en battre une autre et que la
          même situation revient, la partie s’arrête. Le joueur qui a le plus de cartes est le durak (à égalité, celui
          qui défendait).
        </li>
      </ul>
      <div className="buttons">
        <button type="button" className="btn primary" onClick={onClose}>
          Compris
        </button>
      </div>
    </Modal>
  );
}
