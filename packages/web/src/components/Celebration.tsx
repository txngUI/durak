import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';

const SYMBOLS = ['♠', '♥', '♦', '♣', '★'];

/** Pluie de symboles de cartes, pour fêter le Korol. */
export function Confetti({ count = 36 }: { count?: number }) {
  const reduce = useReducedMotion();
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        sym: SYMBOLS[i % SYMBOLS.length],
        left: Math.random() * 100,
        size: 14 + Math.random() * 22,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 720,
        red: i % 5 === 1 || i % 5 === 2,
      })),
    [count],
  );
  if (reduce) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b) => (
        <motion.span
          key={b.id}
          style={{ left: `${b.left}%`, fontSize: b.size, color: b.red ? '#e05a4f' : b.sym === '★' ? '#f2cf73' : '#f8f4ea' }}
          initial={{ y: -60, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: '110vh', x: b.drift, rotate: b.spin, opacity: [0, 1, 1, 0] }}
          transition={{ delay: b.delay, duration: b.duration, ease: 'easeIn', repeat: 1, repeatDelay: Math.random() }}
        >
          {b.sym}
        </motion.span>
      ))}
    </div>
  );
}

/** Médaillon animé en tête des fenêtres de résultat. */
export function Medal({ kind }: { kind: 'korol' | 'done' | 'durak' }) {
  const reduce = useReducedMotion();
  const label = kind === 'korol' ? '♛' : kind === 'durak' ? '✕' : '✓';
  const animate =
    kind === 'durak'
      ? { scale: 1, rotate: [0, -10, 10, -8, 8, 0] }
      : kind === 'korol'
        ? { scale: [0.4, 1.15, 1], rotate: [-20, 8, 0] }
        : { scale: [0.6, 1.08, 1] };
  return (
    <motion.div
      className={`medal ${kind}`}
      initial={reduce ? false : { scale: 0.4, rotate: 0 }}
      animate={reduce ? undefined : animate}
      transition={{ duration: kind === 'durak' ? 0.7 : 0.6, delay: 0.1 }}
      aria-hidden="true"
    >
      {label}
    </motion.div>
  );
}
