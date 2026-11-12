'use client';

import { useEffect, useState } from 'react';

/** Registers the service worker and surfaces the PWA install prompt. */
export default function PwaRegister({
  onInstallPrompt,
}: {
  onInstallPrompt?: (event: BeforeInstallPromptEvent) => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setOffline(!navigator.onLine);

    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      onInstallPrompt?.(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [onInstallPrompt]);

  if (offline) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-900/90 text-amber-100 text-xs text-center py-1.5 font-mono">
        offline — cached shell only
      </div>
    );
  }
  return null;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
