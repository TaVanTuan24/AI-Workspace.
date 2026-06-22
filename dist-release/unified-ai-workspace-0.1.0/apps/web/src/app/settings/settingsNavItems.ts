import {
  Activity,
  Bell,
  Cable,
  DatabaseBackup,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Shield,
  SlidersHorizontal,
  TimerReset
} from "lucide-react";

export const settingsNavItems = [
  {
    href: "/settings",
    label: "Overview",
    description: "Workspace status",
    icon: LayoutDashboard
  },
  {
    href: "/settings/connections",
    label: "Connections",
    description: "Provider sessions",
    icon: Cable
  },
  {
    href: "/settings/models",
    label: "Models",
    description: "Defaults and availability",
    icon: SlidersHorizontal
  },
  {
    href: "/settings/api-keys",
    label: "API Keys",
    description: "External integrations",
    icon: KeyRound
  },
  {
    href: "/settings/api-usage",
    label: "API Usage",
    description: "Analytics and logs",
    icon: Gauge
  },
  {
    href: "/settings/provider-rate-limits",
    label: "Provider Limits",
    description: "Per-provider caps",
    icon: TimerReset
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    description: "Operational alerts",
    icon: Bell
  },
  {
    href: "/settings/provider-health",
    label: "Provider Health",
    description: "Session readiness",
    icon: Activity
  },
  {
    href: "/settings/conversations",
    label: "Conversations",
    description: "Exports and imports",
    icon: DatabaseBackup
  },
  {
    href: "/settings/security",
    label: "Security",
    description: "Local privacy controls",
    icon: Shield
  }
] as const;
