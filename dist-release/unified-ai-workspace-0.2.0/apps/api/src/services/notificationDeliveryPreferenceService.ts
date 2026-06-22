import { prisma } from "./prisma.js";
import type { NotificationDeliveryChannel, NotificationDeliveryPreferenceView, WebhookDeliveryConfigView } from "@uaiw/shared/types/provider.js";
import { encryptSecretString } from "./secretBoxService.js";
import { randomBytes } from "node:crypto";
import { validateWebhookUrl } from "./webhookUrlValidator.js";

interface InternalWebhookConfig {
  url?: string;
  encryptedSigningSecret?: string;
  signingSecretRotatedAt?: string;
}

const CHANNELS: Array<{
  channel: NotificationDeliveryChannel;
  defaultEnabled: boolean;
  label: string;
  description: string;
}> = [
  {
    channel: "in_app",
    defaultEnabled: true,
    label: "In-app",
    description: "Show notifications inside Unified AI Workspace."
  },
  {
    channel: "email_noop",
    defaultEnabled: false,
    label: "Email",
    description: "Email delivery is scaffolded but not configured in this build. Enabling it will record skipped_not_configured attempts only."
  },
  {
    channel: "slack_noop",
    defaultEnabled: false,
    label: "Slack",
    description: "Slack delivery is scaffolded but not configured in this build. Enabling it will record skipped_not_configured attempts only."
  },
  {
    channel: "webhook_noop",
    defaultEnabled: false,
    label: "Webhook (Mock)",
    description: "Webhook delivery is scaffolded but not configured in this build. Enabling it will record skipped_not_configured attempts only."
  },
  {
    channel: "webhook",
    defaultEnabled: false,
    label: "Webhook",
    description: "Send signed JSON notification events to your endpoint."
  }
];

export async function getNotificationDeliveryPreferences(userId: string): Promise<NotificationDeliveryPreferenceView[]> {
  const prefs = await prisma.notificationDeliveryPreference.findMany({
    where: { userId }
  });
  
  const prefMap = new Map(prefs.map((p) => [p.channel, p]));

  return CHANNELS.map((def) => {
    const dbPref = prefMap.get(def.channel);
    
    // In-app is forcefully configured and enabled
    const isConfigured = def.channel === "in_app" || (def.channel === "webhook" ? !!dbPref?.configJson : false);
    const isEnabled = def.channel === "in_app" ? true : (dbPref?.enabled ?? def.defaultEnabled);

    let configView: WebhookDeliveryConfigView | undefined;
    if (def.channel === "webhook") {
      const config = parseWebhookConfig(dbPref?.configJson);
      configView = {
        enabled: isEnabled,
        configured: !!config?.url && !!config?.encryptedSigningSecret,
        urlPreview: config?.url ? obfuscateUrl(config.url) : null,
        hasSigningSecret: !!config?.encryptedSigningSecret,
        lastRotatedAt: config?.signingSecretRotatedAt || null
      };
    }

    return {
      channel: def.channel,
      enabled: isEnabled,
      configured: isConfigured || (configView?.configured ?? false),
      label: def.label,
      description: def.description,
      ...(configView ? { config: configView } : {})
    };
  });
}

function parseWebhookConfig(configJson: string | null | undefined): InternalWebhookConfig | null {
  if (!configJson) return null;
  try {
    return JSON.parse(configJson) as InternalWebhookConfig;
  } catch {
    return null;
  }
}

function obfuscateUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}/...`;
  } catch {
    return "...";
  }
}

export async function updateNotificationDeliveryPreference(
  userId: string,
  channel: NotificationDeliveryChannel,
  input: { enabled: boolean }
): Promise<NotificationDeliveryPreferenceView> {
  const def = CHANNELS.find((c) => c.channel === channel);
  if (!def) {
    throw new Error("Invalid channel");
  }

  if (channel === "in_app") {
    // In-app is forced enabled
    input.enabled = true;
  }

  await prisma.notificationDeliveryPreference.upsert({
    where: {
      userId_channel: {
        userId,
        channel
      }
    },
    update: {
      enabled: input.enabled
    },
    create: {
      userId,
      channel,
      enabled: input.enabled
    }
  });

  let isConfigured = channel === "in_app";
  let configView: WebhookDeliveryConfigView | undefined;

  if (channel === "webhook") {
    const record = await prisma.notificationDeliveryPreference.findUnique({
      where: { userId_channel: { userId, channel } }
    });
    const config = parseWebhookConfig(record?.configJson);
    configView = {
      enabled: input.enabled,
      configured: !!config?.url && !!config?.encryptedSigningSecret,
      urlPreview: config?.url ? obfuscateUrl(config.url) : null,
      hasSigningSecret: !!config?.encryptedSigningSecret,
      lastRotatedAt: config?.signingSecretRotatedAt || null
    };
    isConfigured = configView.configured;
  }

  return {
    channel: def.channel,
    enabled: input.enabled,
    configured: isConfigured,
    label: def.label,
    description: def.description,
    ...(configView ? { config: configView } : {})
  };
}

export async function updateWebhookConfig(userId: string, input: { enabled: boolean; url: string }) {
  await validateWebhookUrl(input.url);

  const existing = await prisma.notificationDeliveryPreference.findUnique({
    where: { userId_channel: { userId, channel: "webhook" } }
  });

  const existingConfig = parseWebhookConfig(existing?.configJson);
  let newSecret = null;
  let configToSave: InternalWebhookConfig = { ...existingConfig, url: input.url };

  if (!existingConfig?.encryptedSigningSecret) {
    const rawSecret = `uaiw_whsec_${randomBytes(32).toString("hex")}`;
    newSecret = rawSecret;
    configToSave.encryptedSigningSecret = encryptSecretString(rawSecret);
    configToSave.signingSecretRotatedAt = new Date().toISOString();
  }

  await prisma.notificationDeliveryPreference.upsert({
    where: { userId_channel: { userId, channel: "webhook" } },
    update: {
      enabled: input.enabled,
      configJson: JSON.stringify(configToSave)
    },
    create: {
      userId,
      channel: "webhook",
      enabled: input.enabled,
      configJson: JSON.stringify(configToSave)
    }
  });

  const configView: WebhookDeliveryConfigView = {
    enabled: input.enabled,
    configured: true,
    urlPreview: obfuscateUrl(input.url),
    hasSigningSecret: true,
    lastRotatedAt: configToSave.signingSecretRotatedAt
  };

  const def = CHANNELS.find((c) => c.channel === "webhook")!;
  return {
    preference: {
      channel: "webhook" as const,
      enabled: input.enabled,
      configured: true,
      label: def.label,
      description: def.description,
      config: configView
    },
    newSecret
  };
}

export async function rotateWebhookSigningSecret(userId: string) {
  const existing = await prisma.notificationDeliveryPreference.findUnique({
    where: { userId_channel: { userId, channel: "webhook" } }
  });

  const existingConfig = parseWebhookConfig(existing?.configJson);
  const rawSecret = `uaiw_whsec_${randomBytes(32).toString("hex")}`;
  const configToSave: InternalWebhookConfig = {
    ...existingConfig,
    encryptedSigningSecret: encryptSecretString(rawSecret),
    signingSecretRotatedAt: new Date().toISOString()
  };

  await prisma.notificationDeliveryPreference.upsert({
    where: { userId_channel: { userId, channel: "webhook" } },
    update: {
      configJson: JSON.stringify(configToSave)
    },
    create: {
      userId,
      channel: "webhook",
      enabled: false,
      configJson: JSON.stringify(configToSave)
    }
  });

  const configView: WebhookDeliveryConfigView = {
    enabled: existing?.enabled ?? false,
    configured: !!configToSave.url,
    urlPreview: configToSave.url ? obfuscateUrl(configToSave.url) : null,
    hasSigningSecret: true,
    lastRotatedAt: configToSave.signingSecretRotatedAt
  };

  const def = CHANNELS.find((c) => c.channel === "webhook")!;
  return {
    preference: {
      channel: "webhook" as const,
      enabled: existing?.enabled ?? false,
      configured: configView.configured,
      label: def.label,
      description: def.description,
      config: configView
    },
    signingSecret: rawSecret
  };
}
