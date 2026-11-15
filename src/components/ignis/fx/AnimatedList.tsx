'use client';

// react-bits "AnimatedList" — staggered slide+fade entrance for feed items
// (GDACS authority alerts, ReliefWeb reports). Framer-motion, respects
// prefers-reduced-motion via the global CSS kill-switch.

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

type Props = {
  items: ReactNode[];
  className?: string;
  /** base delay seconds before the stagger starts */
  delay?: number;
  /** seconds between items */
  stagger?: number;
  /** re-animate whenever this key changes (feed refreshes) */
  refreshKey?: string | number;
};

export default function AnimatedList({ items, className, delay = 0, stagger = 0.07, refreshKey }: Props) {
  return (
    <div className={className} aria-live="polite">
      {items.map((node, i) => (
        <motion.div
          key={`${refreshKey ?? ''}-${i}`}
          initial={{ opacity: 0, x: -10, filter: 'blur(3px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.34, delay: delay + i * stagger, ease: [0.22, 1, 0.36, 1] }}
        >
          {node}
        </motion.div>
      ))}
    </div>
  );
}
