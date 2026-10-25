// Keep script-font declarations out of the initial Latin wallet stylesheet.
let loading: Promise<void> | undefined;
export function loadLocaleFonts(): Promise<void> {
  if (!loading) {
    loading = import('./fonts.css')
      .then(() => undefined)
      .catch(() => {
        // System fonts remain usable offline. A later visit can retry the download.
        loading = undefined;
      });
  }
  return loading;
}
