"use client";

import { useEffect } from "react";
import { syncPermissionState } from "@/lib/permissions";

/**
 * Reconciles our location/notification permission mirror toward the OS on
 * every app launch. Prompt-free — see lib/permissions.ts for why this exists.
 */
export function PermissionsSync() {
  useEffect(() => {
    syncPermissionState();
  }, []);
  return null;
}
