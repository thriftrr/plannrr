// The magic-link email, ported from the Claude Design project's
// "Magic Link Email.html". That file was already authored email-safe —
// table layout, inline styles, MSO line-height guards, a hidden preheader —
// so this is a faithful transcription with the placeholders made real.
//
// Email-client constraints honored here:
// - inline styles only; no webfonts ('Nunito Sans' leads the stack but Arial/
//   Helvetica carry clients that don't have it installed)
// - bulletproof button: an <a> with padding + bgcolor on its own table cell

export interface MagicLinkEmailInput {
  link: string
  expiresMinutes: number
  /** The address that asked to sign in — shown in the body copy. */
  email?: string
}

export interface EmailTemplate {
  subject: string
  text: string
  html: string
}

const FONT = "'Nunito Sans', system-ui, 'Segoe UI', Arial, Helvetica, sans-serif"

// Interpolated values (the email address) are user-controlled;
// the link is ours (origin + base64url token) and is inserted verbatim.
function escapeHtml (value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}


export function magicLinkEmail (input: MagicLinkEmailInput): EmailTemplate {
  const { link, expiresMinutes } = input
  const emailSafe = input.email ? escapeHtml(input.email) : ''

  const askedLine = emailSafe
    ? `You asked to sign in as <strong style="color:#2b2a26;">${emailSafe}</strong>.`
    : 'You asked to sign in.'

  const subject = 'Sign in to Plannrr'

  const text = [
    'Sign in to Plannrr',
    '',
    (input.email ? `You asked to sign in as ${input.email}. ` : '') +
      'Open this link and you\'re in:',
    '',
    link,
    '',
    `Valid for ${expiresMinutes} minutes and works exactly once.`,
    '',
    'Didn\'t request this? You can safely ignore this email — no one can sign in ' +
      'without it, and nothing about your account has changed.',
    '',
    'Plannrr is a fan-made planning companion and isn\'t affiliated with YNAB.',
    'Made with ☕ — support tubstrr on Ko-fi: https://ko-fi.com/tubstrr'
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Sign in to Plannrr</title>
<!--[if mso]><style>table{border-collapse:collapse}td{mso-line-height-rule:exactly}</style><![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#faf6ef;">
<span style="display:none; font-size:1px; color:#faf6ef; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">Your sign-in link is inside &mdash; it works for the next ${expiresMinutes} minutes.</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf6ef;">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:100%;">
      <tr><td align="left" style="padding:0 8px 18px;">
        <span style="font-family:${FONT}; font-size:22px; font-weight:bold; letter-spacing:0.5px; color:#2b2a26;">Plannrr<span style="color:#12968b;">.</span></span>
        <span style="font-family:${FONT}; font-size:12px; color:#8b8577;">&nbsp;&nbsp;A YNAB planning companion</span>
      </td></tr>
      <tr><td style="background-color:#0e7c73; border-radius:14px 14px 0 0; padding:26px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="font-family:${FONT}; font-size:22px; font-weight:bold; color:#ffffff; mso-line-height-rule:exactly; line-height:28px;">Sign in to Plannrr</td></tr>
          <tr><td style="font-family:${FONT}; font-size:13px; color:#b5e2dc; padding-top:6px; mso-line-height-rule:exactly; line-height:19px;">No password needed &mdash; this link is your key.</td></tr>
        </table>
      </td></tr>
      <tr><td style="background-color:#ffffff; border-left:1px solid #e5dfd3; border-right:1px solid #e5dfd3; padding:30px 32px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="font-family:${FONT}; font-size:14px; color:#4a463c; mso-line-height-rule:exactly; line-height:22px;">
            ${askedLine} Tap the button and you're in &mdash; your budgets, the Tinkrr sandbox, and your debt burn-down will be right where you left them.
          </td></tr>
          <tr><td align="center" style="padding:26px 0 10px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" bgcolor="#12968b" style="border-radius:10px;">
                <a href="${link}" style="display:block; font-family:${FONT}; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; padding:14px 44px; border-radius:10px;">Sign in to Plannrr</a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td align="center" style="font-family:${FONT}; font-size:12px; color:#8b8577; padding-bottom:22px; mso-line-height-rule:exactly; line-height:18px;">
            Valid for <strong style="color:#4a463c;">${expiresMinutes} minutes</strong> and works exactly once.
          </td></tr>
          <tr><td style="border-top:1px solid #eee7d9; padding:18px 0 8px; font-family:${FONT}; font-size:12px; color:#8b8577; mso-line-height-rule:exactly; line-height:19px;">
            Button not working? Paste this link into your browser:<br>
            <a href="${link}" style="color:#12968b; word-break:break-all; font-size:12px;">${link}</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background-color:#fffdf8; border:1px solid #e5dfd3; border-top:1px solid #eee7d9; border-radius:0 0 14px 14px; padding:18px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="font-family:${FONT}; font-size:12px; color:#8b8577; mso-line-height-rule:exactly; line-height:19px;">
            <strong style="color:#4a463c;">Didn't request this?</strong> You can safely ignore this email &mdash; no one can sign in without it, and nothing about your account has changed.
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:22px 8px 0; font-family:${FONT}; font-size:11px; color:#a09a8b; mso-line-height-rule:exactly; line-height:17px;">
        Plannrr is a fan-made planning companion and isn't affiliated with YNAB.<br>
        Made with &#9749; &mdash; <a href="https://ko-fi.com/tubstrr" style="color:#12968b;">support tubstrr on Ko-fi</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`

  return { subject, text, html }
}

// ---- Feedback notification --------------------------------------------------
// Sent to the admins when someone submits feedback. Everything user-supplied
// (name, email, page, body) is escaped; the Markdown body is shown as plain
// preformatted text, not rendered — the inbox page does the rendering.

export interface FeedbackEmailInput {
  name: string
  email: string
  body: string
  page: string
  receivedAt: Date
  inboxUrl: string
}

export function feedbackEmail (input: FeedbackEmailInput): EmailTemplate {
  const name = escapeHtml(input.name)
  const email = escapeHtml(input.email)
  const page = escapeHtml(input.page || '—')
  const bodySafe = escapeHtml(input.body)
  const when = input.receivedAt.toUTCString()

  const subject = `Plannrr feedback from ${input.name}`

  const text = [
    `New feedback on Plannrr`,
    '',
    `From: ${input.name} <${input.email}>`,
    `Page: ${input.page || '—'}`,
    `When: ${when}`,
    '',
    input.body,
    '',
    `Inbox: ${input.inboxUrl}`
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plannrr feedback</title>
</head>
<body style="margin:0; padding:0; background-color:#faf6ef;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf6ef;">
  <tr><td align="center" style="padding:32px 16px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:100%;">
      <tr><td align="left" style="padding:0 8px 18px;">
        <span style="font-family:${FONT}; font-size:22px; font-weight:bold; letter-spacing:0.5px; color:#2b2a26;">Plannrr<span style="color:#12968b;">.</span></span>
      </td></tr>
      <tr><td style="background-color:#ffffff; border-radius:14px; padding:28px 28px 24px;">
        <div style="font-family:${FONT}; font-size:18px; font-weight:bold; color:#2b2a26; margin:0 0 14px;">New feedback</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT}; font-size:13px; color:#6f6a5c; line-height:1.6;">
          <tr><td style="padding-right:12px; font-weight:bold;">From</td><td style="color:#2b2a26;">${name} &lt;${email}&gt;</td></tr>
          <tr><td style="padding-right:12px; font-weight:bold;">Page</td><td style="color:#2b2a26;">${page}</td></tr>
          <tr><td style="padding-right:12px; font-weight:bold;">When</td><td style="color:#2b2a26;">${escapeHtml(when)}</td></tr>
        </table>
        <pre style="margin:18px 0 0; padding:14px 16px; background-color:#faf6ef; border:1px solid #e5dfd3; border-radius:10px; font-family:ui-monospace, Menlo, Consolas, monospace; font-size:12.5px; line-height:1.55; color:#2b2a26; white-space:pre-wrap; word-wrap:break-word;">${bodySafe}</pre>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
          <tr><td bgcolor="#12968b" style="border-radius:9px;">
            <a href="${input.inboxUrl}" style="display:inline-block; padding:10px 18px; font-family:${FONT}; font-size:13px; font-weight:bold; color:#ffffff; text-decoration:none;">Open the inbox</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  return { subject, text, html }
}
