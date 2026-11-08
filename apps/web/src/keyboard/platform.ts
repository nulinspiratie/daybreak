/** True on macOS, where Mod is Option (altKey); elsewhere Mod is Ctrl. */
export function isMacPlatform(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  const uaData = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform || nav.platform || ''
  return /mac/i.test(platform)
}

/** Decided once at startup; the key map refers to Mod everywhere. */
export const IS_MAC = isMacPlatform()
