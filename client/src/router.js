import { useEffect, useState, useCallback } from 'react';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw.split('/').filter(Boolean); // e.g. "#/session/3" → ["session","3"]
}

export function useHashRoute() {
  const [parts, setParts] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setParts(parseHash());
      // a new view always starts at its top (views used to inherit the old scroll offset)
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((path) => {
    window.location.hash = path.startsWith('/') ? `#${path}` : `#/${path}`;
  }, []);
  return { parts, navigate };
}
