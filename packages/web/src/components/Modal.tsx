import { motion } from 'motion/react';
import { type ReactNode, useEffect } from 'react';

export function Modal({
  children,
  onClose,
  wide,
  label,
}: {
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  label: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <motion.div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ y: 16, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
