export const GEMINI_SELECTORS = {
  composerCandidates: [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    '[role="textbox"]',
    "textarea",
    '[aria-label*="prompt" i]',
    '[aria-label*="message" i]',
    '[aria-label*="ask" i]'
  ],
  sendButtonCandidates: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button:has(mat-icon:has-text("send"))',
    'button:has([data-icon-name="send"])'
  ],
  responseCandidates: [
    "message-content",
    ".model-response-text",
    "[data-response-index]",
    "div.markdown",
    "div[dir='ltr']"
  ],
  stopButtonCandidates: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Cancel" i]',
    'button:has(mat-icon:has-text("stop"))'
  ],
  attachInputCandidates: [
    'input[type="file"][multiple]',
    'input[type="file"]'
  ],
  // Sign-in / account-wall cues, used for mid-stream login detection. Mirrors
  // the surfaces detectLoggedIn already trusts (Google accounts links + the
  // "Sign in" affordance), kept conservative to avoid false positives.
  loginIndicators: [
    'a[href*="accounts.google.com"]',
    'a:has-text("Sign in")',
    'button:has-text("Sign in")'
  ]
} as const;
