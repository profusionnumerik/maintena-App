const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey || !secretKey.trim()) {
    console.warn("[Stripe] STRIPE_SECRET_KEY manquante.");
    return null;
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-02-25.clover",
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/create-checkout-session", async (req, res) => {
  const stripe = getStripe();

  if (!stripe) {
    return res.status(503).json({
      error: "Stripe n'est pas configuré. Ajoutez STRIPE_SECRET_KEY dans functions/.env",
    });
  }

  try {
    const { coProId, userId, adminEmail, coProName, inviteCode } = req.body || {};

    if (!coProId || !userId) {
      return res.status(400).json({ error: "coProId et userId sont requis." });
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(503).json({
        error: "STRIPE_PRICE_ID manquant dans functions/.env",
      });
    }

    const successUrl =
      process.env.STRIPE_SUCCESS_URL || "http://localhost:19006/payment-success";
    const cancelUrl =
      process.env.STRIPE_CANCEL_URL || "http://localhost:19006/payment-cancel";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        coProId,
        userId,
        adminEmail: adminEmail || "",
        coProName: coProName || "",
        inviteCode: inviteCode || "",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("[Stripe checkout error]", error);
    return res.status(500).json({
      error: error.message || "Erreur Stripe",
    });
  }
});

exports.api = functions.https.onRequest(app);