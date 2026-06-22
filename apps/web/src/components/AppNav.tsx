"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bot, Cable, MessageSquare, Settings } from "lucide-react";
import { getOnboardingStatus, getWorkspaceNotifications } from "../lib/api";
export function AppNav() {
  const notifications = useQuery({
    queryKey: ["workspaceNotifications"],
    queryFn: getWorkspaceNotifications,
    refetchInterval: 60_000
  });
  const onboarding = useQuery({
    queryKey: ["onboardingStatus"],
    queryFn: getOnboardingStatus,
    refetchInterval: 60_000
  });

  const unreadCount = notifications.data?.unreadCount ?? 0;

  const items = [
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/connections", label: "Connections", icon: Cable },
    { href: "/dashboard", label: "Dashboard", icon: Bot },
    { href: "/settings", label: "Settings", icon: Settings }
  ];

  return (
    <header className="border-b border-border bg-white">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/chat" className="mr-4 font-semibold">
          Unified AI Workspace
        </Link>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-ink"
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
            {item.label}
            {item.href === "/settings" && unreadCount > 0 ? (
              <span className="ml-1 rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500 border border-indigo-500/30">
                {unreadCount}
              </span>
            ) : null}
            {item.href === "/settings" && onboarding.data && !onboarding.data.completed ? (
              <span className="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Setup
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </header>
  );
}
