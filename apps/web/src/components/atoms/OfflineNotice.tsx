import { useEffect, useState } from 'react';

export function OfflineNotice() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); }; }, []);
  return online ? null : <div className="offline-notice" role="status">You’re offline. The app shell is available, but work data and changes need a connection.</div>;
}
