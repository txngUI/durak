import { type Card, SUIT_SYMBOL, isRed, rankLabel } from '@durak/engine';
import { type HTMLMotionProps, motion } from 'motion/react';
import { forwardRef } from 'react';

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
      {...rest}
    >
      <span className="r">{label}</span>
      <span className="s1">{sym}</span>
      <span className="c">{sym}</span>
      <span className="rb">{label}</span>
    </motion.div>
  );
});
