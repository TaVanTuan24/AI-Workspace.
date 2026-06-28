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
  ]
} as const;
