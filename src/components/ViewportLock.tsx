'use client';

import { useEffect } from 'react';

/**
 * Keep the PWA shell a fixed size on iOS.
 *
 * iOS shrinks the *visual* viewport when the on-screen keyboard opens, and
 * Safari then scrolls the page to reveal the focused field — which makes the
 * whole app jump and resize. The shell is pinned to the layout viewport (see
 * globals.css) so it never changes size; instead the keyboard's height is
 * published as `--kb` and the composer is lifted above it.
 */
export default function ViewportLock() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', `${Math.round(inset)}px`);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      document.documentElement.style.removeProperty('--kb');
    };
  }, []);

  return null;
}
