import type { Env } from '../types';

export function captureEnv(): Env {
  if (typeof window === 'undefined') {
    return {
      userAgent: '', language: '', timezone: '', viewport: { width: 0, height: 0 },
      screen: { width: 0, height: 0 }, devicePixelRatio: 1, online: true,
    };
  }
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height },
    devicePixelRatio: window.devicePixelRatio,
    online: navigator.onLine,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
  };
}
