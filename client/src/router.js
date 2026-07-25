import { useEffect, useState, useCallback } from 'react';

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw.split('/').filter(Boolean); // e.g. "#/session/3" → ["session","3"]
}

export function useHashRoute() {
  const [parts, setParts] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setParts(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((path) => {
    window.location.hash = path.startsWith('/') ? `#${path}` : `#/${path}`;
  }, []);
  return { parts, navigate };
}
