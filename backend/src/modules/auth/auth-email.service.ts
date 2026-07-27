import type { AuthUser } from "./auth.types.js";

export type AuthEmailProvider = "console" | "resend";

export interface AuthEmailServiceOptions {
  provider: AuthEmailProvider;
  apiKey: string;
  from: string;
  backendPublicUrl: string;
  frontendUrl: string;
  isProduction: boolean;
}

export class AuthEmailService {
  constructor(private readonly options: AuthEmailServiceOptions) {}

  async sendVerificationEmail(user: AuthUser, token: string): Promise<void> {
    const verificationUrl = this.buildUrl(
      this.options.frontendUrl,
      "/auth/verify-email",
      token
    );

    await this.send({
      to: user.email,
      subject: "Verify your Synapse Workspace email",
      text:
        `Hi ${user.name},\n\n` +
        `Verify your Synapse Workspace email here:\n${verificationUrl}\n\n` +
        "This link expires soon and can only be used once.",
      html:
        `<p>Hi ${this.escapeHtml(user.name)},</p>` +
        `<p>Verify your Synapse Workspace email:</p>` +
        `<p><a href="${verificationUrl}">Verify email</a></p>` +
        "<p>This link expires soon and can only be used once.</p>",
      logLabel: "Email verification link",
      logUrl: verificationUrl,
    });
  }

  async sendPasswordResetEmail(user: AuthUser, token: string): Promise<void> {
    const resetUrl = this.buildUrl(
      this.options.frontendUrl,
      "/auth/reset-password",
      token
    );

    await this.send({
      to: user.email,
      subject: "Reset your Synapse Workspace password",
      text:
        `Hi ${user.name},\n\n` +
        `Reset your Synapse Workspace password here:\n${resetUrl}\n\n` +
        "If you did not request this, you can ignore this email.",
      html:
        `<p>Hi ${this.escapeHtml(user.name)},</p>` +
        `<p>Reset your Synapse Workspace password:</p>` +
        `<p><a href="${resetUrl}">Reset password</a></p>` +
        "<p>If you did not request this, you can ignore this email.</p>",
      logLabel: "Password reset link",
      logUrl: resetUrl,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    logLabel: string;
    logUrl: string;
  }): Promise<void> {
    if (this.options.provider === "console") {
      if (this.options.isProduction) {
        throw new Error("Console email delivery is not allowed in production");
      }

      console.info(`[auth-email] ${input.logLabel}: ${input.logUrl}`);
      return;
    }

    if (!this.options.apiKey || !this.options.from) {
      throw new Error("Resend email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM");
    }

    if (this.options.from.includes("tu-dominio.com")) {
      throw new Error(
        "AUTH_EMAIL_FROM still uses the example domain; configure a sender verified in Resend"
      );
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!response.ok) {
      const responseText = (await response.text()).trim();
      const detail = responseText ? `: ${responseText.slice(0, 300)}` : "";
      throw new Error(`Email delivery failed with status ${response.status}${detail}`);
    }
  }

  private buildUrl(baseUrl: string, pathname: string, token: string): string {
    const url = new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      };

      return entities[character];
    });
  }
}