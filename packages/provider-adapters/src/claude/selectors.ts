export const CLAUDE_URLS = {
  primaryLoginUrl: "https://claude.ai"
} as const;

export const CLAUDE_SELECTORS = {
  composerCandidates: [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"]',
    "textarea"
  ],
  sendButtonCandidates: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="message" i]',
    'button[type="submit"]',
    "button:has(svg)"
  ],
  stopButtonCandidates: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Cancel" i]'
  ],
  responseCandidates: [
    '[data-testid*="message"]',
    ".font-claude-message",
    'div[data-is-streaming]',
    ".prose",
    ".markdown",
    "article"
  ],
  loginIndicators: [
    "text=Log in",
    "text=Sign in",
    "text=Continue with Google",
    "text=Sign up",
    'button:has-text("Log in")',
    'button:has-text("Sign in")'
  ],
  manualActionIndicators: [
    "text=Verify",
    "text=verification",
    "text=Continue",
    "text=challenge",
    "text=Cloudflare",
    "text=Turnstile"
  ],
  rateLimitIndicators: [
    "text=message limit",
    "text=rate limit",
    "text=usage limit",
    "text=Too many requests",
    "text=Try again later"
  ],
  attachInputCandidates: [
    'input[type="file"][multiple]',
    'input[data-testid="file-upload"]',
    'input[type="file"]'
  ]
} as const;
