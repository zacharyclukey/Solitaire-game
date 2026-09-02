/**
 * Haptics with three tiers: the Capacitor plugin on a packaged build, the
 * Vibration API on Android browsers, and silence everywhere else.
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './native.ts';
import { settings } from './storage.ts';

type Style = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'select';

const IMPACT: Record<string, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};

const NOTIFY: Record<string, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
};

const PATTERN: Record<Style, number | number[]> = {
  light: 8,
  medium: 14,
  heavy: 24,
  select: 5,
  success: [10, 40, 18],
  warning: [16, 60, 16],
  error: [24, 50, 24, 50, 24],
};

export function haptic(style: Style = 'light'): void {
  if (!settings().haptics) return;
  if (isNative()) {
    try {
      if (style === 'select') void Haptics.selectionStart().then(() => Haptics.selectionEnd());
      else if (NOTIFY[style]) void Haptics.notification({ type: NOTIFY[style] });
      else void Haptics.impact({ style: IMPACT[style] });
      return;
    } catch {
      /* fall through to the web API */
    }
  }
  try {
    navigator.vibrate?.(PATTERN[style]);
  } catch {
    /* not supported */
  }
}
