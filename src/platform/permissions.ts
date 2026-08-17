import { ext } from './browser';

/** Generic optional-permission helper (used for `downloads` and `debugger`). */

interface PermissionsApi {
  contains(p: { permissions: string[] }): Promise<boolean>;
  request(p: { permissions: string[] }): Promise<boolean>;
}

function api(): PermissionsApi | undefined {
  return (ext as unknown as { permissions?: PermissionsApi }).permissions;
}

export async function hasPermissions(permissions: string[]): Promise<boolean> {
  const perms = api();
  if (!perms) return false;
  try {
    return await perms.contains({ permissions });
  } catch {
    return false;
  }
}

/** Must be called from a user gesture (a click in an extension page). */
export async function requestPermissions(permissions: string[]): Promise<boolean> {
  const perms = api();
  if (!perms) return false;
  try {
    return await perms.request({ permissions });
  } catch {
    return false;
  }
}
