'use client';

// react-bits "ShinyText" — a light sweep that glides across the text every few
// seconds. Pure CSS (background-clip), zero JS per frame. Used for live/badge
// accents where the content is already animated (CountUp) and shouldn't blur.

type Props = {
  text: string;
  className?: string;
  /** seconds between sweeps */
  period?: number;
  disabled?: boolean;
};

export default function ShinyText({ text, className, period = 4.5, disabled = false }: Props) {
  return (
    <span
      className={`ignis-shiny ${disabled ? 'ignis-shiny-off' : ''} ${className ?? ''}`}
      style={period !== 4.5 ? { animationDuration: `${period}s` } : undefined}
      aria-label={text}
    >
      {text}
    </span>
  );
}
