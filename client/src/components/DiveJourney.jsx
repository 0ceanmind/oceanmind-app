import { useEffect, useRef, useState } from 'react';

// Where a station's tip starts: rail at left 16px, station centre 20px in,
// tip 40px right of the station's left edge (see .jrail / .jrail-tip).
const TIP_LEFT = 66;
const TIP_GAP = 16; // breathing room before the lesson's content edge

/**
 * Free width between the rail's tips and the lesson content (px), so the
 * arrival announcement never covers the lesson. Re-measured on resize.
 */
function useGutterRoom(ref) {
  const [room, setRoom] = useState(null);
  useEffect(() => {
    const measure = () => {
      const page = ref.current?.closest('.page');
      if (!page) return;
      const left = page.getBoundingClientRect().left + parseFloat(getComputedStyle(page).paddingLeft || '0');
      setRoom(Math.floor(left - TIP_LEFT - TIP_GAP));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ref]);
  return room;
}

/**
 * The dive journey as a slim rail fixed to the left edge — an ocean-themed
 * "scrollbar" for the lesson. Surface waves on top, treasure at the bottom,
 * one glowing station per step, the diver bobbing at the current one.
 * Hover a station for its title; click to swim there.
 * `fresh` ({ from, count }) marks stations Lulu just inserted: they pop in and pulse.
 */
export default function DiveJourney({ steps, current, onJump, fresh = null }) {
  const [hover, setHover] = useState(null);
  const railRef = useRef(null);
  const room = useGutterRoom(railRef);
  // arrival announcement: the full title when the gutter has room, "3 / 8"
  // when it is narrow, nothing when even that would touch the lesson
  const announce = room === null || room >= 180 ? 'full' : room >= 58 ? 'compact' : 'none';
  const kindOf = (s) => (s.block?.type === 'check' ? '❓' : s.block ? '🧪' : '📖');
  const isFresh = (i) => Boolean(fresh) && i >= fresh.from && i < fresh.from + fresh.count;
  // fill runs from the first station's centre to the current one's
  const f = current / Math.max(1, steps.length - 1);

  return (
    <nav className="jrail" ref={railRef} aria-label="Lesson journey" data-demo="rail" data-current={current} data-count={steps.length}
      style={room !== null ? { '--room': `${Math.max(0, room)}px` } : undefined}>
      <div className="jrail-track">
        {/* light rays + drifting bubble live in their own clipped layer, so the
            station tips can reach outside the track */}
        <div className="jrail-deco" aria-hidden="true" />
        <div className="jrail-waves">〰</div>
        <div className="jrail-fill" style={{ '--f': f }} />
        <div className="jrail-stops">
          {steps.map((s, i) => {
            const done = i < current;
            const now = i === current;
            return (
              <button
                key={`${i}-${s.title}`}
                className={`jrail-stop ${now ? 'now' : done ? 'done' : ''}${isFresh(i) ? ' om-v-new' : ''}`}
                onClick={() => onJump(i)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={now ? 'step' : undefined}
                data-demo="rail-stop"
                data-idx={i}
              >
                <span className="jrail-dot">{now ? '🤿' : done ? '✓' : kindOf(s)}</span>
                {/* hover: tip stays; arriving at a station: tip announces it, then fades */}
                {hover === i ? (
                  <span className="jrail-tip" key={`hover-${i}`}>
                    <b>{i + 1}.</b> {s.title.length > 42 ? `${s.title.slice(0, 41)}…` : s.title}
                  </span>
                ) : now && announce !== 'none' ? (
                  <span className={`jrail-tip om-v-announce${announce === 'compact' ? ' om-v-compact' : ''}`} key={`now-${i}-${s.title}`}>
                    {announce === 'compact'
                      ? <><b>{i + 1}</b> / {steps.length}</>
                      : <><b>{i + 1}.</b> {s.title.length > 42 ? `${s.title.slice(0, 41)}…` : s.title}</>}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="jrail-treasure" title="Your dive log awaits at the end">🪙</div>
      </div>
    </nav>
  );
}
