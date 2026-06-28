export const CHATGPT_SELECTORS = {
  composerCandidates: [
    'div[contenteditable="true"][data-testid="composer-text-input"]',
    'div[contenteditable="true"]#prompt-textarea',
    "textarea#prompt-textarea",
    '[data-testid="composer-text-input"]',
    'div[contenteditable="true"][role="textbox"]',
    "textarea"
  ],
  sendButtonCandidates: [
    '[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    "button:has(svg)"
  ],
  stopButtonCandidates: [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="Cancel"]'
  ],
  responseCandidates: [
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn"]',
    ".markdown",
    "article"
  ],
  loginIndicators: [
    "text=Log in",
    "text=Sign up",
    'button:has-text("Log in")',
    'button:has-text("Sign up")'
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
    "text=Too many requests",
    "text=rate limit",
    "text=limit",
    "text=Try again later"
  ],
  attachInputCandidates: [
    'input[type="file"][multiple]',
    'input[type="file"]'
  ]
} as const;
