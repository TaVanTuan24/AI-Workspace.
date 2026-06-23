import {
  Activity,
  Bell,
  Cable,
  CalendarClock,
  ClipboardList,
  DatabaseBackup,
  Gauge,
  KeyRound,
  LifeBuoy,
  LayoutDashboard,
  Shield,
  SlidersHorizontal,
  TimerReset,
  UsersRound,
  PieChart
} from "lucide-react";

export const settingsNavItems = [
  {
    href: "/settings",
    label: "Overview",
    description: "Workspace status",
    icon: LayoutDashboard
  },
  {
    href: "/settings/workspace-overview",
    label: "Admin Overview",
    description: "Consolidated admin status",
    icon: ClipboardList,
    permission: "settings.read"
  },
  {
    href: "/settings/activity",
    label: "Activity",
    description: "Unified timeline",
    icon: Activity,
    permission: "settings.read"
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
    href: "/settings/provider-recovery",
    label: "Recovery Policies",
    description: "Safe automation",
    icon: LifeBuoy
  },
  {
    href: "/settings/users",
    label: "Users & Roles",
    description: "Admin boundaries",
    icon: UsersRound,
    permission: "users.read"
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
  },
  {
    href: "/settings/quota",
    label: "Quota & Limits",
    description: "Resource usage",
    icon: PieChart,
    permission: "settings.read"
  },
  {
    href: "/settings/schedulers",
    label: "Schedulers",
    description: "Background job status",
    icon: CalendarClock,
    permission: "settings.read"
  }
] as const;

