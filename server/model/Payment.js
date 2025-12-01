import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema({

  user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Plan",
    required: true
  },

  // Stripe Identifiers
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  stripePriceId: { type: String },
  stripeCheckoutSessionId: { type: String },
  stripePaymentIntentId: { type: String },
  stripePaymentMethodId: { type: String },
  stripeChargeId: { type: String },

  // Card Details
  cardBrand: { type: String },
  cardFunding: { type: String, default: "unknown" },
  cardLast4: { type: String },
  cardExpMonth: { type: Number },
  cardExpYear: { type: Number },

  // Amount
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },

  // Stripe Billing Cycle Dates
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },
  status: { type: String, enum: ["pending", "succeeded", "failed", "canceled"], default: "pending" },

  // Optional Extra Stripe Fields
  trialStart: { type: Date },
  trialEnd: { type: Date },

  // Raw Stripe data for debugging
  stripeRaw: { type: Object },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Payment = mongoose.model("Payment", PaymentSchema);
export default Payment;
