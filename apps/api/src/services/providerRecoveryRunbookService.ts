export type BuildProviderRunbookInput = {
  userId: string;
  provider: string;
  status: string;
  severity?: string;
  incidentId?: string;
  connectionId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type ProviderRecoveryAction =
  | {
      type: "open_connection_settings";
      label: string;
      href: string;
    }
  | {
      type: "start_reconnect";
      label: string;
      provider: string;
      connectionId?: string;
      href: string;
    }
  | {
      type: "run_safe_health_check";
      label: string;
      provider: string;
      connectionId?: string;
      endpoint: string;
      method: "POST";
    }
  | {
      type: "run_safe_ui_diagnostics";
      label: string;
      provider: string;
      connectionId?: string;
      endpoint: string;
      method: "POST";
    }
  | {
      type: "open_provider_health";
      label: string;
      href: string;
    }
  | {
      type: "open_model_settings";
      label: string;
      href: string;
    }
  | {
      type: "mark_incident_resolved";
      label: string;
      incidentId: string;
      endpoint: string;
      method: "POST";
    };

export type ProviderRecoveryRunbookView = {
  provider: string;
  incidentId?: string;
  status: string;
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  summary: string;
  likelyCauses: string[];
  recommendedSteps: Array<{
    id: string;
    label: string;
    description: string;
    action?: ProviderRecoveryAction;
    safetyNote?: string;
  }>;
  actions: ProviderRecoveryAction[];
  docs?: Array<{
    label: string;
    href: string;
  }>;
};

export function buildRunbook(input: BuildProviderRunbookInput): ProviderRecoveryRunbookView {
  const { provider, status, incidentId, connectionId } = input;
  const severity = (input.severity as "info" | "warning" | "error" | "critical") || "warning";

  const view: ProviderRecoveryRunbookView = {
    provider,
    incidentId,
    status,
    severity,
    title: "Troubleshoot Provider Issue",
    summary: "Follow these steps to restore provider connectivity.",
    likelyCauses: [],
    recommendedSteps: [],
    actions: []
  };

  const getHealthCheckAction = (): ProviderRecoveryAction => {
    return incidentId
      ? {
          type: "run_safe_health_check",
          label: "Run safe health check",
          provider,
          connectionId,
          endpoint: `/settings/provider-health/incidents/${incidentId}/actions/health-check`,
          method: "POST"
        }
      : {
          type: "run_safe_health_check",
          label: "Run safe health check",
          provider,
          connectionId,
          endpoint: `/settings/provider-health/refresh`,
          method: "POST"
        };
  };

  const getDiagnosticsAction = (): ProviderRecoveryAction => {
    return incidentId
      ? {
          type: "run_safe_ui_diagnostics",
          label: "Run safe UI diagnostics",
          provider,
          connectionId,
          endpoint: `/settings/provider-health/incidents/${incidentId}/actions/ui-diagnostics`,
          method: "POST"
        }
      : {
          type: "run_safe_ui_diagnostics",
          label: "Run safe UI diagnostics",
          provider,
          connectionId,
          endpoint: `/settings/provider-health/diagnostics`, // fallback endpoint
          method: "POST"
        };
  };

  const getResolveAction = (): ProviderRecoveryAction | undefined => {
    if (!incidentId) return undefined;
    return {
      type: "mark_incident_resolved",
      label: "Mark incident resolved",
      incidentId,
      endpoint: `/settings/provider-health/incidents/${incidentId}/resolve`,
      method: "POST"
    };
  };

  if (status === "requires_login" || status === "expired") {
    view.title = "Provider requires login";
    view.summary = "The session has expired or the provider requires re-authentication.";
    view.likelyCauses = [
      "Provider session expired",
      "User logged out in provider UI",
      "Provider requires re-authentication",
      "Cookies or storage state are no longer valid"
    ];
    
    view.recommendedSteps = [
      {
        id: "step1",
        label: "Reconnect provider",
        description: "Open the provider UI, complete the login process, and the workspace will capture the secure session.",
        action: {
          type: "start_reconnect",
          label: "Reconnect",
          provider,
          connectionId,
          href: `/settings/connections?provider=${provider}&action=connect`
        },
        safetyNote: "App will not ask for or store provider password."
      },
      {
        id: "step2",
        label: "Run safe health check",
        description: "After reconnecting, verify the provider connection status.",
        action: getHealthCheckAction(),
        safetyNote: "Health check does not send live prompts to the provider."
      },
      {
        id: "step3",
        label: "Run safe UI diagnostics",
        description: "If it's still failing, run UI diagnostics to determine if the provider UI has changed.",
        action: getDiagnosticsAction(),
        safetyNote: "Diagnostics do not send prompts and do not capture screenshots or raw DOM."
      }
    ];

  } else if (status === "manual_action" || status === "manual_action_required") {
    view.title = "Manual action required";
    view.summary = "The provider is asking for manual intervention such as a CAPTCHA, consent screen, or account safety prompt.";
    view.likelyCauses = [
      "CAPTCHA or security challenge",
      "New terms or consent screen",
      "Provider announcement or interstitial",
      "Account safety prompt"
    ];

    view.recommendedSteps = [
      {
        id: "step1",
        label: "Open connection settings",
        description: "Open the provider UI manually to clear the block.",
        action: {
          type: "open_connection_settings",
          label: "Open settings",
          href: `/settings/connections?provider=${provider}&action=connect`
        },
        safetyNote: "Do not attempt to bypass CAPTCHA. You must complete provider-required actions manually."
      },
      {
        id: "step2",
        label: "Run safe UI diagnostics",
        description: "Analyze the provider UI to identify the specific block.",
        action: getDiagnosticsAction()
      }
    ];

  } else if (status === "ui_changed") {
    view.title = "Provider UI changed";
    view.summary = "The provider interface appears to have changed. Our automation cannot find the expected elements.";
    view.likelyCauses = [
      "Provider changed selectors or layout",
      "Model picker moved",
      "Compose box changed",
      "Automation detection returned unexpected UI"
    ];

    view.recommendedSteps = [
      {
        id: "step1",
        label: "Run safe UI diagnostics",
        description: "Diagnose what has changed in the UI. This helps the system adapt or log the error safely.",
        action: getDiagnosticsAction(),
        safetyNote: "Diagnostics redact email, URL, JWT, UUID, and long text. No raw HTML/screenshots or session data."
      },
      {
        id: "step2",
        label: "Reconnect provider (if suspicious)",
        description: "If your session also feels suspicious, trying a clean reconnect may resolve the issue.",
        action: {
          type: "start_reconnect",
          label: "Reconnect",
          provider,
          href: `/settings/connections?provider=${provider}&action=connect`
        }
      }
    ];

  } else if (status === "error") {
    view.title = "Provider error";
    view.summary = "An unexpected error occurred while interacting with the provider.";
    view.likelyCauses = [
      "Transient provider outage",
      "Browser automation error",
      "Network or timeout issue",
      "Worker resource issue",
      "Adapter bug"
    ];

    view.recommendedSteps = [
      {
        id: "step1",
        label: "Run safe health check",
        description: "Check if the provider is back online and accessible.",
        action: getHealthCheckAction()
      },
      {
        id: "step2",
        label: "View provider health",
        description: "See the global health status for all your connected providers.",
        action: {
          type: "open_provider_health",
          label: "Provider Health",
          href: "/settings/provider-health"
        }
      },
      {
        id: "step3",
        label: "Run safe UI diagnostics",
        description: "If the error repeats, run UI diagnostics.",
        action: getDiagnosticsAction()
      }
    ];

  } else if (status === "no_usable_models") {
    view.title = "No usable models";
    view.summary = "There are no models available for this provider. This may block automations or chat functionality.";
    view.likelyCauses = [
      "All providers disabled or unavailable",
      "Model preferences disabled current models",
      "API key model scopes exclude usable models",
      "Providers require login"
    ];

    view.recommendedSteps = [
      {
        id: "step1",
        label: "Check model settings",
        description: "Ensure that models are enabled in your preferences.",
        action: {
          type: "open_model_settings",
          label: "Model Settings",
          href: "/settings/models"
        }
      },
      {
        id: "step2",
        label: "Check provider health",
        description: "Ensure the provider is connected and healthy.",
        action: {
          type: "open_provider_health",
          label: "Provider Health",
          href: "/settings/provider-health"
        }
      },
      {
        id: "step3",
        label: "Check connections",
        description: "Ensure the provider connection is configured properly.",
        action: {
          type: "open_connection_settings",
          label: "Connections",
          href: "/settings/connections"
        }
      }
    ];

  } else {
    // Unknown or other status
    view.title = "Unknown provider issue";
    view.summary = "An unidentified issue has been detected with the provider.";
    view.likelyCauses = ["Unknown internal status or unexpected condition"];
    view.recommendedSteps = [
      {
        id: "step1",
        label: "Run safe health check",
        description: "Check if the provider is healthy again.",
        action: getHealthCheckAction()
      },
      {
        id: "step2",
        label: "Check provider health",
        description: "View global health status.",
        action: {
          type: "open_provider_health",
          label: "Provider Health",
          href: "/settings/provider-health"
        }
      }
    ];
  }

  // Populate generic top-level actions
  view.actions = view.recommendedSteps
    .filter(s => s.action)
    .map(s => s.action as ProviderRecoveryAction);

  // Add resolve action if incidentId exists
  const resolveAction = getResolveAction();
  if (resolveAction) {
    view.recommendedSteps.push({
      id: "step_resolve",
      label: "Mark incident resolved",
      description: "If you have manually resolved the issue externally, mark this incident as resolved.",
      action: resolveAction
    });
    view.actions.push(resolveAction);
  }

  return view;
}
