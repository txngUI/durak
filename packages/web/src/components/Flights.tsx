import { motion } from 'motion/react';
import { PlayingCard } from './PlayingCard';

/** Une carte (face cachée) qui vole d'un point à un autre de l'écran. */
export interface Flight {
  id: string;
  from: DOMRect;
  to: DOMRect;
  /** Secondes avant le départ. */
  delay: number;
  /** Disparaît en arrivant (vers un adversaire) plutôt que de se poser. */
  fade: boolean;
  /** Carte de ta main révélée à l'arrivée. */
  reveal?: string;
}

export const FLIGHT_SECONDS = 0.42;

/** Calque au-dessus de la table où passent les cartes piochées. */
export function Flights({ flights, onLand }: { flights: Flight[]; onLand: (f: Flight) => void }) {
  return (
    <div className="flights" aria-hidden="true">
      {flights.map((f) => {
        const dx = f.to.left + f.to.width / 2 - (f.from.left + f.from.width / 2);
        const dy = f.to.top + f.to.height / 2 - (f.from.top + f.from.height / 2);
        const scale = Math.min(1.4, Math.max(0.35, f.to.width / f.from.width));
        return (
          <motion.div
            key={f.id}
            className="flight"
            style={{ left: f.from.left, top: f.from.top }}
            initial={{ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }}
            animate={{ x: dx, y: dy, scale, rotate: f.fade ? 0 : [0, -6, 0], opacity: f.fade ? [1, 1, 0] : 1 }}
            transition={{ delay: f.delay, duration: FLIGHT_SECONDS, ease: [0.3, 0, 0.2, 1] }}
            onAnimationComplete={() => onLand(f)}
          >
            <PlayingCard size={f.from.width} />
          </motion.div>
        );
      })}
    </div>
  );
}
