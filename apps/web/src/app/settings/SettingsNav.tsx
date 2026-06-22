"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSettingsOverview, hasPermission, type WorkspacePermission } from "../../lib/api";
import { settingsNavItems } from "./settingsNavItems";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function SettingsNav() {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);

  useEffect(() => {
    let cancelled = false;
    getSettingsOverview()
      .then((overview) => {
        if (!cancelled) setPermissions(overview.currentUser.permissions);
      })
      .catch(() => {
        if (!cancelled) setPermissions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <WorkspaceSwitcher />
      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-100">Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Manage local workspace controls.</p>
        </div>
        <nav className="grid gap-1">
          {settingsNavItems.filter((item) => !("permission" in item) || hasPermission(permissions, item.permission)).map((item) => {
            const active = item.href === "/settings" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors ${
                  active
                    ? "border border-indigo-500/30 bg-indigo-500/10 text-indigo-200"
                    : "border border-transparent text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                }`}
              >
                <item.icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-xs text-slate-500">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
