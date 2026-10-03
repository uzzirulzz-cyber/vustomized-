"use client";

import { useEffect, useState } from "react";

/** Client-side access to the signed-in staff member's permissions. */
export function usePermissions() {
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [roleName, setRoleName] = useState("");
  const [me, setMe] = useState<{ id: string; name: string; email: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.kind === "staff") {
          setPermissions(d.staff.permissions);
          setRoleName(d.staff.roleName);
          setMe({ id: d.staff.id, name: d.staff.name, email: d.staff.email });
        }
      })
      .catch(() => {});
  }, []);

  return { permissions, roleName, me, can: (key: string) => !!permissions?.includes(key) };
}
