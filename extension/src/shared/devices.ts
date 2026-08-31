/** Mobile device emulation profiles (spec addition: capture as mobile). */

export interface DeviceProfile {
  key: string;
  label: string;
  /** CSS-pixel viewport width/height to emulate. */
  width: number;
  height: number;
  /** Device pixel ratio to emulate. */
  dpr: number;
  /** Mobile user-agent string applied during capture. */
  userAgent: string;
}

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export const DEVICE_PROFILES: DeviceProfile[] = [
  { key: 'iphone13', label: 'iPhone 13 / 14 (390×844)', width: 390, height: 844, dpr: 3, userAgent: IOS_UA },
  { key: 'iphonese', label: 'iPhone SE (375×667)', width: 375, height: 667, dpr: 2, userAgent: IOS_UA },
  { key: 'pixel7', label: 'Pixel 7 (412×915)', width: 412, height: 915, dpr: 2.625, userAgent: ANDROID_UA },
  { key: 'galaxys8', label: 'Galaxy S8 (360×740)', width: 360, height: 740, dpr: 3, userAgent: ANDROID_UA },
  { key: 'ipadmini', label: 'iPad mini (768×1024)', width: 768, height: 1024, dpr: 2, userAgent: IPAD_UA },
];

export const DEFAULT_DEVICE = 'iphone13';

export function resolveDevice(key: string | undefined): DeviceProfile {
  return DEVICE_PROFILES.find((d) => d.key === key) ?? DEVICE_PROFILES[0];
}
