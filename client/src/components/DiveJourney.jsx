import { useState } from 'react';

/**
 * The dive journey as a slim rail fixed to the right edge — an ocean-themed
 * "scrollbar" for the lesson. Surface waves on top, treasure at the bottom,
 * one glowing station per step, the diver bobbing at the current one.
 * Hover a station for its title; click to swim there.
 */
export default function DiveJourney({ steps, current, onJump }) {
  const [hover, setHover] = useState(null);
  const kindOf = (s) => (s.block?.type === 'check' ? '❓' : s.block ? '🧪' : '📖');

  return (
    <nav className="jrail" aria-label="Lesson journey">
      <div className="jrail-track">
        <div className="jrail-waves">〰</div>
        <div className="jrail-fill" style={{ height: `${(current / Math.max(1, steps.length - 1)) * 100}%` }} />
        <div className="jrail-stops">
          {steps.map((s, i) => {
            const done = i < current;
            const now = i === current;
            return (
              <button
                key={`${i}-${s.title}`}
                className={`jrail-stop ${now ? 'now' : done ? 'done' : ''}`}
                onClick={() => onJump(i)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={now ? 'step' : undefined}
              >
                <span className="jrail-dot">{now ? '🤿' : done ? '✓' : kindOf(s)}</span>
                {(hover === i || now) && (
                  <span className="jrail-tip">
                    <b>{i + 1}.</b> {s.title.length > 42 ? `${s.title.slice(0, 41)}…` : s.title}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="jrail-treasure" title="Your dive log awaits at the end">🪙</div>
      </div>
    </nav>
  );
}
