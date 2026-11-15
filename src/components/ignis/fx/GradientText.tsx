'use client';

// react-bits "GradientText" — animated multi-stop gradient clipped to text
// (background-clip: text). The pan positions drift on a slow loop, giving
// headline accents that embers-through-smoke feel. Static gradient under
// prefers-reduced-motion.

type Props = {
  children: React.ReactNode;
  className?: string;
  colors?: string[];
  /** seconds for one full gradient drift */
  period?: number;
};

export default function GradientText({
  children,
  className,
  colors = ['#F97316', '#FBBF24', '#38BDF8', '#F97316'],
  period = 7,
}: Props) {
  return (
    <span
      className={`ignis-gradient-text ${className ?? ''}`}
      style={{
        backgroundImage: `linear-gradient(90deg, ${colors.join(',')})`,
        backgroundSize: '220% 100%',
        animationDuration: `${period}s`,
      }}
    >
      {children}
    </span>
  );
}
