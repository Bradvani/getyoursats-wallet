import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { getResolvedAppearance } from '@/services/presentationPreferences';
import { NavigationBar } from '@capgo/capacitor-navigation-bar';

/**
 * System bar color manager for native builds.
 *
 * Two independent LIFO stacks — one for the top status bar and one for
 * the bottom navigation bar — so a surface can push a color to only
 * one bar when the visual needs differ (e.g. a bottom sheet covering
 * the nav bar area while the wallet page is still visible behind the
 * top of the screen).
 *
 * Most callers use the default `target: 'both'` which pushes the same
 * color onto both stacks. Bottom sheets in particular split the push:
 * they request the nav-bar color while the sheet is open (at any snap
 * point, because the sheet always reaches the bottom of the viewport)
 * and only extend the push to the status bar once the sheet is fully
 * expanded and covers the top of the screen too.
 *
 * Empty stacks fall through to STATUS_BAR_WALLET_GLASS (#13131d = the
 * wallet page glass effective color). Other surfaces explicitly push
 * STATUS_BAR_SURFACE (#151520) when their flat background needs to
 * match the system bars.
 *
 * On iOS / web / Android 15+ edge-to-edge the native calls are no-ops
 * and .catch()-silenced — the stack is still maintained so consumer
 * code stays pure across platforms.
 */

/** Wallet page glass effective color. Default when the stack is empty. */
export const STATUS_BAR_WALLET_GLASS = '#13131d';

/** Solid spark-surface, matches SlideInPage / PageLayout / drawer / landing. */
export const STATUS_BAR_SURFACE = '#151520';

/** Solid spark-dark, matches HomePage's flat background. */
export const STATUS_BAR_DARK = '#0f0f18';

/**
 * Very dark tone used for modal dialog scrim overlays (logout confirm,
 * etc.). Computed by compositing #000000 at 85% opacity over the
 * #13131d wallet canvas — the same blend the React backdrop produces
 * visually, so the system bars fade in sync with the content area.
 */
export const STATUS_BAR_DIALOG_SCRIM = '#030304';

/**
 * Matches the GlobalLoadingOverlay's bg-spark-void/95 backdrop shown
 * during sdk.isLoading transitions (logout, reconnect). #0a0a0f is
 * spark-void itself — the 95% opacity is indistinguishable from the
 * solid tone on a dark UI.
 */
export const STATUS_BAR_LOADING = '#0a0a0f';

export type SystemBarTarget = 'status' | 'nav' | 'both';

const isAndroidNative =
  typeof window !== 'undefined' &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android';

type StackEntry = { color: string; token: symbol };
const statusBarStack: StackEntry[] = [];
const navBarStack: StackEntry[] = [];

/** Map legacy native dark bar values onto our Orange theme surfaces.
 * Scrims/loading remain dark and retain light icons. Never modify the
 * underlying stack so a theme change also updates already-open sheets. */
export function resolveSystemBarAppearance(color: string, orange = getResolvedAppearance()==='orange'):
  { color: string; darkButtons: boolean } {
  if (!orange) return { color, darkButtons: false };
  const surface: Record<string, string> = {
    '#13131d': '#F3ECE0', // home glass and bottom system strip
    '#151520': '#FFFCF7', // drawer, settings and sheet surfaces
    '#0f0f18': '#F3ECE0', // flat dark surfaces
    '#0a0a0f': '#FAF7F1', // ordinary void canvas
  };
  const mapped = surface[color.toLowerCase()];
  return mapped ? { color: mapped, darkButtons: true } : { color, darkButtons: false };
}

export function refreshSystemBarsForTheme(): void {
  applyStatusBar();
  applyNavBar();
}

function applyStatusBar(): void {
  if (!isAndroidNative) return;
  const color =
    statusBarStack.length > 0
      ? statusBarStack[statusBarStack.length - 1].color
      : STATUS_BAR_WALLET_GLASS;
  const result = resolveSystemBarAppearance(color);
  void StatusBar.setStyle({ style: result.darkButtons ? Style.Dark : Style.Light }).catch(() => {});
  StatusBar.setBackgroundColor({ color: result.color }).catch(() => {
    /* unsupported platform or Android 15+ edge-to-edge — ignore */
  });
}

function applyNavBar(): void {
  if (!isAndroidNative) return;
  const color =
    navBarStack.length > 0
      ? navBarStack[navBarStack.length - 1].color
      : STATUS_BAR_WALLET_GLASS;
  const result = resolveSystemBarAppearance(color);
  NavigationBar.setNavigationBarColor({ color: result.color, darkButtons: result.darkButtons }).catch(() => {
    /* unsupported platform or Android 15+ edge-to-edge — ignore */
  });
}

/**
 * Push a color onto the status bar stack, the nav bar stack, or both.
 * Returns a disposer that pops the entry from whichever stack(s) it
 * was pushed to and re-applies the new top.
 *
 * Default target is 'both' for convenience — most call sites want the
 * system bars to move in lockstep. Bottom sheets split the push into
 * a nav-bar-only request (on open) and a status-bar-only request
 * (on full expand) so each bar tracks the surface it visually meets.
 */
export function pushStatusBarColor(
  color: string,
  target: SystemBarTarget = 'both',
): () => void {
  const token = Symbol('statusBarColor');
  const entry: StackEntry = { color, token };

  const pushedStatus = target === 'status' || target === 'both';
  const pushedNav = target === 'nav' || target === 'both';

  if (pushedStatus) {
    statusBarStack.push(entry);
    applyStatusBar();
  }
  if (pushedNav) {
    navBarStack.push(entry);
    applyNavBar();
  }

  return () => {
    if (pushedStatus) {
      const idx = statusBarStack.findIndex((e) => e.token === token);
      if (idx >= 0) statusBarStack.splice(idx, 1);
      applyStatusBar();
    }
    if (pushedNav) {
      const idx = navBarStack.findIndex((e) => e.token === token);
      if (idx >= 0) navBarStack.splice(idx, 1);
      applyNavBar();
    }
  };
}
