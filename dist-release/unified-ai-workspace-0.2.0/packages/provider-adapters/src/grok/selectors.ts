export const GROK_URLS = {
  primaryLoginUrl: "https://grok.com",
  fallbackLoginUrls: ["https://grok.com/chat", "https://x.com/i/grok"]
} as const;

export const GROK_SELECTORS = {
  composerCandidates: [
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="Message"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    '[role="textbox"]',
    "textarea"
  ],
  sendButtonCandidates: [
    'button[aria-label*="Send"]',
    'button[type="submit"]',
    "button:has(svg)"
  ],
  stopButtonCandidates: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="Cancel"]'
  ],
  responseCandidates: [
    '[data-testid*="conversation"]',
    '[data-testid*="message"]',
    '[data-testid*="tweetText"]',
    "article",
    ".markdown",
    'div[dir="auto"]',
    'div[dir="ltr"]'
  ],
  loginIndicators: [
    "text=Log in",
    "text=Sign in",
    "text=Continue with X",
    "text=Sign up",
    'a[href*="/login"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")'
  ],
  manualActionIndicators: [
    "text=Verify",
    "text=verification",
    "text=challenge",
    "text=Confirm",
    "text=Enter your code",
    "text=Cloudflare"
  ],
  rateLimitIndicators: [
    "text=Too many requests",
    "text=rate limit",
    "text=limit reached",
    "text=Try again later"
  ]
} as const;
