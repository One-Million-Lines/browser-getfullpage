import { ext } from './browser';
import { CaptureError } from '@/shared/errors';

/**
 * Downloads adapter. The `downloads` permission is optional (spec §6.2): manual
 * export from the preview uses a user-gesture anchor download and needs no
 * permission. This module is only used when the user opts into auto-download or
 * a Downloads subfolder, and it requests the permission at runtime.
 */

interface DownloadsApi {
  download(opts: { url: string; filename?: string; saveAs?: boolean }): Promise<number>;
}
interface PermissionsApi {
  contains(p: { permissions: string[] }): Promise<boolean>;
  request(p: { permissions: string[] }): Promise<boolean>;
}

function downloadsApi(): DownloadsApi | undefined {
  return (ext as unknown as { downloads?: DownloadsApi }).downloads;
}
function permissionsApi(): PermissionsApi | undefined {
  return (ext as unknown as { permissions?: PermissionsApi }).permissions;
}

export async function hasDownloadsPermission(): Promise<boolean> {
  const perms = permissionsApi();
  if (!perms) return false;
  try {
    return await perms.contains({ permissions: ['downloads'] });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (e.g. clicking a settings toggle). */
export async function requestDownloadsPermission(): Promise<boolean> {
  const perms = permissionsApi();
  if (!perms) return false;
  try {
    return await perms.request({ permissions: ['downloads'] });
  } catch {
    return false;
  }
}

/**
 * Download a blob. When the downloads permission is present, use the API (which
 * supports subfolders). Otherwise fall back to an anchor click, which works from
 * an extension page under a user gesture without any permission.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  opts?: { subfolder?: string; preferApi?: boolean },
): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const api = downloadsApi();
    const wantApi = opts?.preferApi ?? Boolean(opts?.subfolder);
    if (api && wantApi && (await hasDownloadsPermission())) {
      const path = opts?.subfolder ? `${opts.subfolder}/${filename}` : filename;
      await api.download({ url, filename: path, saveAs: false });
      // Revoke after a delay so the download can start reading the blob URL.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    // Anchor fallback (no permission required from an extension page gesture).
    if (typeof document === 'undefined') {
      throw new CaptureError('DOWNLOAD_DENIED', 'No downloads API and no DOM to anchor-download from.');
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    URL.revokeObjectURL(url);
    if (e instanceof CaptureError) throw e;
    throw new CaptureError('DOWNLOAD_DENIED', e instanceof Error ? e.message : String(e));
  }
}
