'use client';

import { useEffect, useSyncExternalStore } from 'react';

/** Online/offline as an external store — no setState inside an effect. */
function subscribeConnectivity(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Registers the service worker and surfaces the PWA install prompt. */
export default function PwaRegister({
  onInstallPrompt,
}: {
  onInstallPrompt?: (event: BeforeInstallPromptEvent) => void;
}) {
  const offline = useSyncExternalStore(
    subscribeConnectivity,
    () => !navigator.onLine,
    () => false,
  );

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
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
