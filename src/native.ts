/**
 * Native shell integration.
 *
 * Every call degrades to a no-op on the web, so the same bundle runs as a PWA
 * and inside the Capacitor iOS/Android wrappers.
 */
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = (): boolean => Capacitor.isNativePlatform();

export interface NativeHandlers {
  /** Android hardware back. Return true if the app handled it. */
  onBack(): boolean;
}

export async function initNative(handlers: NativeHandlers): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch {
    /* status bar is unavailable on some devices; not worth failing over */
  }
  try {
    await CapApp.addListener('backButton', () => {
      if (!handlers.onBack()) void CapApp.minimizeApp();
    });
  } catch {
    /* not on Android */
  }
}

/** Called once the first screen has painted, so players never see a white flash. */
export function hideSplash(): void {
  if (!isNative()) return;
  setTimeout(() => void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => undefined), 120);
}
