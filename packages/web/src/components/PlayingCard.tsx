import { type Card, SUIT_NAME, SUIT_SYMBOL, type Suit, isRed, rankLabel } from '@durak/engine';
import { type HTMLMotionProps, motion } from 'motion/react';
import { forwardRef } from 'react';

/**
 * Symbole d'une couleur. Le lys et l'étoile sont dessinés en SVG : leurs caractères
 * s'affichent mal (ou en émoji) sur certains appareils.
 */
export function SuitGlyph({ suit }: { suit: Suit }) {
  if (suit === 'L')
    return (
      <svg className="suit-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 1.5c2.6 3.2 2.7 7.4.3 11.4h-.6C9.3 8.9 9.4 4.7 12 1.5zM10.9 13.4c-3 .2-7-1.3-7.7-4.9-.4-2.2 1.6-3.6 3.3-2.6-1.3.5-1.5 2.1-.3 3.1 1.3 1.1 3.2 1.4 4.6 1.9zm2.2 0c3 .2 7-1.3 7.7-4.9.4-2.2-1.6-3.6-3.3-2.6 1.3.5 1.5 2.1.3 3.1-1.3 1.1-3.2 1.4-4.6 1.9zM7.4 13.6h9.2v1.9H7.4zM12 15.6c-.4 2.6-1.9 4.5-3.9 5.4 2 .7 3.3 0 3.9-1.3.6 1.3 1.9 2 3.9 1.3-2-.9-3.5-2.8-3.9-5.4z"
        />
      </svg>
    );
  if (suit === 'E')
    return (
      <svg className="suit-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2.2l2.7 6.6 7.1.4-5.5 4.5 1.8 6.9L12 16.8l-6.1 3.8 1.8-6.9-5.5-4.5 7.1-.4z" />
      </svg>
    );
  return <>{SUIT_SYMBOL[suit]}</>;
}

type Props = HTMLMotionProps<'div'> & {
  card?: Card | null;
  trump?: string;
  /** Taille en px (largeur). */
  size?: number;
};

/** Une carte face visible, ou un dos si `card` est absent. */
export const PlayingCard = forwardRef<HTMLDivElement, Props>(function PlayingCard(
  { card, trump, size, className = '', style, ...rest },
  ref,
) {
  const sizeStyle = size ? ({ '--cw': `${size}px` } as React.CSSProperties) : undefined;
  if (!card) {
    return <motion.div ref={ref} className={`card back ${className}`} style={{ ...sizeStyle, ...style }} {...rest} />;
  }
  const sym = SUIT_SYMBOL[card.s];
  const label = rankLabel(card.r);
  const classes = ['card', isRed(card.s) ? 'red' : '', card.s === trump ? 'trump' : '', className].join(' ');
  return (
    <motion.div
      ref={ref}
      className={classes}
      style={{ ...sizeStyle, ...style }}
      role="img"
      aria-label={`${label}${sym}`}
      title={`${label} de ${SUIT_NAME[card.s]}`}
      {...rest}
    >
      <span className="r">{label}</span>
      <span className="s1">
        <SuitGlyph suit={card.s} />
      </span>
      <span className="c">
        <SuitGlyph suit={card.s} />
      </span>
      <span className="rb">{label}</span>
    </motion.div>
  );
});
