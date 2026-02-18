const config = require('../config');

let sgMail;
let nodemailer;
let transporter;

function useSendGrid() {
  return !!config.sendgrid.apiKey;
}

function getSendGridClient() {
  if (!sgMail) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(config.sendgrid.apiKey);
  }
  return sgMail;
}

function getNodemailerTransporter() {
  if (!transporter) {
    nodemailer = require('nodemailer');
    const opts = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
    };
    if (config.smtp.user) {
      opts.auth = { user: config.smtp.user, pass: config.smtp.pass };
    }
    transporter = nodemailer.createTransport(opts);
  }
  return transporter;
}

/**
 * Send an email using the configured provider (SendGrid or nodemailer SMTP).
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
async function sendEmail({ to, subject, text, html }) {
  const from = config.email.from;

  if (useSendGrid()) {
    const msg = { to, from, subject, text };
    if (html) msg.html = html;
    await getSendGridClient().send(msg);
  } else {
    const mailOpts = { from, to, subject, text };
    if (html) mailOpts.html = html;
    await getNodemailerTransporter().sendMail(mailOpts);
  }
}

/**
 * Returns the name of the current email provider.
 */
function getProviderName() {
  return useSendGrid() ? 'SendGrid' : 'SMTP';
}

/**
 * Check if email sending is configured.
 */
function isConfigured() {
  if (useSendGrid()) return true;
  return !!(config.smtp.host && config.smtp.user);
}

module.exports = { sendEmail, getProviderName, isConfigured };
