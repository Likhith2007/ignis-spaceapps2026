'use client';

// react-bits "SplitText" — staggered word/char reveal for headlines, driven by
// framer-motion (already in the stack). Respects prefers-reduced-motion.

import { motion } from 'framer-motion';

type Props = {
  text: string;
  className?: string;
  by?: 'word' | 'char';
  delay?: number; // seconds before the stagger starts
  once?: boolean;
};

export default function SplitText({ text, className, by = 'word', delay = 0, once = true }: Props) {
  const parts = by === 'word' ? text.split(/(\s+)/) : Array.from(text);
  return (
    <span className={className} aria-label={text} role="text">
      {parts.map((p, i) => (
        <motion.span
          key={`${p}-${i}`}
          aria-hidden
          initial={{ opacity: 0, y: '0.35em', filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: delay + i * 0.035, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: 'inline-block', whiteSpace: /^\s+$/.test(p) ? 'pre' : undefined }}
        >
          {p}
        </motion.span>
      ))}
    </span>
  );
}
