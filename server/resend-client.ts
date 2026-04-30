import { Resend } from "resend";

let connectionSettings: any;

async function getCredentials(): Promise<{ apiKey: string; fromEmail: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (xReplitToken && hostname) {
    connectionSettings = await fetch(
      "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
      {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
      }
    )
      .then((res) => res.json())
      .then((data) => data.items?.[0]);

    if (connectionSettings?.settings?.api_key) {
      return {
        apiKey: connectionSettings.settings.api_key as string,
        fromEmail: (connectionSettings.settings.from_email as string | undefined) ?? "Maintena <onboarding@resend.dev>",
      };
    }
  }

  const envKey = process.env.RESEND_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      fromEmail: "Maintena <noreply@maintena-pro.fr>",
    };
  }

  throw new Error("Resend not connected");
}

export async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail,
  };
}
