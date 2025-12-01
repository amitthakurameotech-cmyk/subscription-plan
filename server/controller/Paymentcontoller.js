import Plan from "../model/Plan.js";
import Payment from "../model/Payment.js";
import Stripe from "stripe";

// Initialize Stripe
function getStripe() {
  const stripeSecret =
    process.env.STRIPE_SECRET_KEY ||
    process.env.secret_key ||
    process.env.SECRET_KEY;

  if (!stripeSecret) {
    console.error("❌ STRIPE_SECRET_KEY not found in environment");
    return null;
  }
  
  try {
    const stripe = new Stripe(stripeSecret);
    console.log("✅ Stripe initialized successfully");
    return stripe;
  } catch (err) {
    console.error("❌ Error initializing Stripe:", err.message);
    return null;
  }
}

// ============================================
// Create Stripe Checkout Session
// ============================================
export const createCheckoutSession = async (req, res) => {
  try {
    const { planId } = req.params;
    if (!planId) return res.status(400).json({ success: false, message: "planId is required" });

    const plan = await Plan.findById(planId);

    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe secret key missing" });

    const amount = Math.round(parseFloat(plan.Price) * 100);
    const currency = (process.env.STRIPE_CURRENCY || "inr").toLowerCase();
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    let stripePriceId = plan.stripePriceId;

    // If no Stripe price ID exists, create a recurring price
    if (!stripePriceId) {
      try {
        // Create or get Stripe product
        let stripeProductId = plan.stripeProductId;
        if (!stripeProductId) {
          const product = await stripe.products.create({
            name: plan.PlanName,
            description: plan.Description || `${plan.BillingPeriod} subscription plan`,
            metadata: {
              planId: plan._id.toString(),
              planNumber: plan.Id,
            },
          });
          stripeProductId = product.id;
          await Plan.findByIdAndUpdate(planId, { stripeProductId });
        }

        // Create recurring price
        const recurringPrice = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: amount,
          currency,
          recurring: {
            interval: plan.BillingPeriod.toLowerCase() === "monthly" ? "month" : "year",
            interval_count: plan.BillingInterval,
          },
          metadata: {
            planId: plan._id.toString(),
          },
        });

        stripePriceId = recurringPrice.id;
        await Plan.findByIdAndUpdate(planId, { stripePriceId });
      } catch (stripeError) {
        console.error("❌ Error creating Stripe price:", stripeError.message);
        console.error("❌ Stripe Error Details:", {
          type: stripeError.type,
          code: stripeError.code,
          param: stripeError.param,
          statusCode: stripeError.statusCode,
          message: stripeError.message
        });
        return res.status(500).json({ 
          success: false, 
          message: "Failed to create Stripe price",
          error: stripeError.message 
        });
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${frontendUrl}/success?planId=${planId}&sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/error?cancelled=true`,
      metadata: {
        planId: plan._id.toString(),
      },
    });

    return res.status(201).json({
      success: true,
      sessionUrl: session.url,
      sessionId: session.id,
    });

  } catch (err) {
    console.error("❌ createCheckoutSession:", err);
    return res.status(500).json({ success: false, message: "Failed to create Stripe session" });
  }
};

// ============================================
// Get Payment History
// ============================================
export const getPaymentHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    const payments = await Payment.find({ user: userId })
      .populate("plan", "PlanName Price BillingPeriod")
      .populate("user", "email fullName")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      payments,
      count: payments.length,
    });

  } catch (err) {
    console.error("❌ getPaymentHistory:", err);
    return res.status(500).json({ success: false, message: "Failed to retrieve payment history" });
  }
};

// ============================================
// Get Stripe Payment Session Details
// ============================================
export const getPaymentSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { planId } = req.query;

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    let plan = null;
    if (planId) {
      plan = await Plan.findById(planId);
    }

    return res.json({ success: true, session, plan });

  } catch (err) {
    console.error("❌ getPaymentSession:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch payment session" });
  }
};

// ============================================
// Save Frontend Stripe Session and Prevent Duplicates
// ============================================
export const saveFrontendSession = async (req, res) => {
  try {
    const { session, plan: planFromClient } = req.body || {};

    const planId =
      session?.metadata?.planId ||
      planFromClient?._id;

    if (!planId) {
      return res.status(400).json({ success: false, message: "planId missing" });
    }

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const stripe = getStripe();
    const sessionId = session?.id || null;
    const paymentIntentId = session?.payment_intent || null;

    const amount = session?.amount_total ? session.amount_total / 100 : plan.Price;
    const currency = session?.currency || process.env.STRIPE_CURRENCY || "inr";
    const status = session?.payment_status === "paid" ? "succeeded" : "pending";
    const userId = null;

    // Initialize paymentData with all required fields
    const paymentData = {
      plan: planId,
      amount: Number(amount) || 0,
      currency,
      status,
      stripeCheckoutSessionId: sessionId || null,
      stripePaymentIntentId: paymentIntentId || null,
      stripePaymentMethodId: session?.payment_method?.id || null,
      stripeChargeId: null,
      cardBrand: null,
      cardFunding: "unknown",
      cardLast4: null,
      cardExpMonth: null,
      cardExpYear: null,
      stripeRaw: session || {},
    };

    // Extract card details from session if available
    if (session?.payment_method?.card) {
      const card = session.payment_method.card;
      paymentData.cardBrand = card.brand || null;
      paymentData.cardFunding = card.funding ? normalizeFunding(card.funding) : "unknown";
      paymentData.cardLast4 = card.last4 || null;
      paymentData.cardExpMonth = card.exp_month || null;
      paymentData.cardExpYear = card.exp_year || null;
    }

    // If we have a payment intent, retrieve it to get full charge & card details
    if (stripe && paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi) {
          // Update amount and currency from PaymentIntent if available
          if (pi.amount) paymentData.amount = pi.amount / 100;
          if (pi.currency) paymentData.currency = pi.currency;
          if (pi.status === "succeeded") paymentData.status = "succeeded";

          const charge = pi.charges?.data?.[0];
          if (charge) {
            paymentData.stripeChargeId = charge.id;
            paymentData.stripePaymentMethodId = charge.payment_method || pi.payment_method;

            const card = charge.payment_method_details?.card;
            if (card) {
              paymentData.cardBrand = card.brand || paymentData.cardBrand;
              paymentData.cardFunding = card.funding ? normalizeFunding(card.funding) : paymentData.cardFunding;
              paymentData.cardLast4 = card.last4 || paymentData.cardLast4;
              paymentData.cardExpMonth = card.exp_month || paymentData.cardExpMonth;
              paymentData.cardExpYear = card.exp_year || paymentData.cardExpYear;
            }
          }
        }
      } catch (piErr) {
        console.warn(`⚠️ Could not retrieve PaymentIntent ${paymentIntentId}:`, piErr.message);
      }
    }

    // Prevent duplicate creation using atomic upsert
    const filter = {
      $or: [
        paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : null,
        sessionId ? { stripeCheckoutSessionId: sessionId } : null,
        { plan: planId, amount: paymentData.amount }
      ].filter(Boolean)
    };

    const payment = await Payment.findOneAndUpdate(
      filter,
      { $set: paymentData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`✅ Frontend save: Payment record ${payment._id ? "created" : "updated"} with all fields for plan ${planId}`);

    if (status === "succeeded") {
      // Optional: Update plan status if needed
      // await Plan.findByIdAndUpdate(planId, { planStatus: "Active" });
    }

    return res.json({ success: true, payment, plan });

  } catch (err) {
    console.error("❌ saveFrontendSession:", err);
    return res.status(500).json({ success: false, message: "Failed to save session", error: err.message });
  }
};

// Helper to normalize card funding
function normalizeFunding(f) {
  if (!f) return "unknown";
  const s = String(f).toLowerCase();
  if (["credit", "debit", "prepaid"].includes(s)) return s;
  return "unknown";
}

// Main webhook entry
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("❌ STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ success: false, message: "Webhook secret not configured" });
  }

  if (!sig) {
    console.error("❌ No Stripe signature in webhook request");
    return res.status(400).json({ success: false, message: "Missing Stripe signature" });
  }

  const stripe = getStripe(); // get Stripe instance here and pass into handlers if needed

  let event;
  try {
    // req.body must be the raw Buffer — ensure route used express.raw()
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    console.log(`✅ Webhook signature verified, event type: ${event.type}`);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err && err.message ? err.message : err}`);
    return res.status(400).json({ success: false, message: "Signature verification failed", error: err && err.message ? err.message : String(err) });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object, stripe);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object, stripe);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object);
        break;

      default:
        console.log(`ℹ️ Unhandled webhook event type: ${event.type}`);
    }

    return res.json({ success: true, received: true });
  } catch (err) {
    console.error(`❌ Error processing webhook event ${event.type}:`, err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: "Error processing webhook" });
  }
};

// Handle checkout.session.completed event
async function handleCheckoutSessionCompleted(session, stripe) {
  try {
    console.log(`📦 Processing checkout.session.completed: ${session.id}`);

    const planId = session.metadata?.planId;
    const paymentIntentId = session.payment_intent || null;

    if (!planId) {
      console.warn("⚠️ checkout.session.completed: no planId in metadata");
      // still upsert a payment row if you want, but return for now
      return;
    }

    // Fetch plan from DB
    const plan = await Plan.findById(planId);
    if (!plan) {
      console.warn(`⚠️ Plan ${planId} not found for checkout session ${session.id}`);
      return;
    }

    // Normalize payment data
    const amountMajor = typeof session.amount_total === "number" ? session.amount_total / 100 : (plan.Price || 0);
    const currency = (session.currency || process.env.STRIPE_CURRENCY || "inr").toLowerCase();
    const status = session.payment_status === "paid" ? "succeeded" : "pending";

    const paymentData = {
      plan: plan._id,
      amount: Number(amountMajor) || 0,
      currency,
      status,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      stripePaymentMethodId: null,
      stripeChargeId: null,
      cardBrand: null,
      cardFunding: "unknown",
      cardLast4: null,
      cardExpMonth: null,
      cardExpYear: null,
      stripeRaw: session,
    };

    // Enrich with PaymentIntent data if available
    if (paymentIntentId && stripe) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi) {
          if (typeof pi.amount === "number") paymentData.amount = pi.amount / 100;
          if (pi.currency) paymentData.currency = pi.currency;
          if (pi.status === "succeeded") paymentData.status = "succeeded";

          const charge = pi.charges?.data?.[0];
          if (charge) {
            paymentData.stripeChargeId = charge.id;
            paymentData.stripePaymentMethodId = charge.payment_method || pi.payment_method;
            const card = charge.payment_method_details?.card;
            if (card) {
              paymentData.cardBrand = card.brand || null;
              paymentData.cardLast4 = card.last4 || null;
              paymentData.cardExpMonth = card.exp_month || null;
              paymentData.cardExpYear = card.exp_year || null;
              paymentData.cardFunding = card.funding ? normalizeFunding(card.funding) : "unknown";
            }
          }
        }
      } catch (piErr) {
        console.warn(`⚠️ Could not retrieve PaymentIntent ${paymentIntentId}:`, piErr && piErr.message ? piErr.message : piErr);
      }
    }

    // Build filter only with defined keys
    const or = [];
    if (paymentIntentId) or.push({ stripePaymentIntentId: paymentIntentId });
    if (session.id) or.push({ stripeCheckoutSessionId: session.id });

    const filter = or.length ? { $or: or } : { stripeCheckoutSessionId: session.id };

    // Upsert payment
    const updated = await Payment.findOneAndUpdate(
      filter,
      { $set: paymentData, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (updated) {
      console.log(`✅ Webhook: Upserted Payment record for checkout session ${session.id} (id=${updated._id})`);
    }

    // Optionally update plan status if needed
    if (paymentData.status === "succeeded") {
      console.log(`✔ Webhook: Plan ${planId} payment succeeded`);
      // e.g. await Plan.findByIdAndUpdate(planId, { status: 'active' });
    }
  } catch (err) {
    console.error("❌ handleCheckoutSessionCompleted error:", err && err.stack ? err.stack : err);
  }
}

// Handle payment_intent.succeeded event
async function handlePaymentIntentSucceeded(paymentIntent, stripe) {
  try {
    console.log(`💳 Processing payment_intent.succeeded: ${paymentIntent.id}`);

    const chargeId = paymentIntent.charges?.data?.[0]?.id || null;

    let payment = await Payment.findOne({
      $or: [
        { stripePaymentIntentId: paymentIntent.id },
        ...(chargeId ? [{ stripeChargeId: chargeId }] : []),
      ],
    });

    // If no payment found, try to create basic payment from PI (use metadata if present)
    if (!payment) {
      console.warn(`⚠️ payment_intent.succeeded: Payment record not found for PI ${paymentIntent.id}. Creating new record from PI metadata if possible.`);

      const planId = paymentIntent.metadata?.planId || null;
      const amount = typeof paymentIntent.amount === "number" ? paymentIntent.amount / 100 : 0;
      const currency = paymentIntent.currency || process.env.STRIPE_CURRENCY || "inr";

      const newPayment = new Payment({
        plan: planId ? mongoose.Types.ObjectId(planId) : null,
        amount,
        currency,
        status: "succeeded",
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId: chargeId,
        stripePaymentMethodId: paymentIntent.payment_method || null,
        stripeRaw: paymentIntent,
      });

      const charge = paymentIntent.charges?.data?.[0];
      if (charge) {
        const card = charge.payment_method_details?.card;
        if (card) {
          newPayment.cardBrand = card.brand || null;
          newPayment.cardLast4 = card.last4 || null;
          newPayment.cardExpMonth = card.exp_month || null;
          newPayment.cardExpYear = card.exp_year || null;
          newPayment.cardFunding = card.funding ? normalizeFunding(card.funding) : "unknown";
        }
      }

      payment = await newPayment.save();
      console.log(`✅ Webhook: Created new Payment ${payment._id} from PaymentIntent ${paymentIntent.id}`);
      return;
    }

    // Update existing payment details
    payment.status = "succeeded";
    payment.stripePaymentIntentId = paymentIntent.id;
    if (!payment.amount && paymentIntent.amount) payment.amount = paymentIntent.amount / 100;
    if (!payment.currency && paymentIntent.currency) payment.currency = paymentIntent.currency;

    const charge = paymentIntent.charges?.data?.[0];
    if (charge) {
      payment.stripeChargeId = charge.id;
      payment.stripePaymentMethodId = charge.payment_method || paymentIntent.payment_method || payment.stripePaymentMethodId;
      const card = charge.payment_method_details?.card;
      if (card) {
        payment.cardBrand = card.brand || null;
        payment.cardLast4 = card.last4 || null;
        payment.cardExpMonth = card.exp_month || null;
        payment.cardExpYear = card.exp_year || null;
        payment.cardFunding = card.funding ? normalizeFunding(card.funding) : "unknown";
      }
    }

    await payment.save();
    console.log(`✅ Webhook: Updated Payment ${payment._id} to succeeded`);
  } catch (err) {
    console.error("❌ handlePaymentIntentSucceeded error:", err && err.stack ? err.stack : err);
  }
}

// Handle payment_intent.payment_failed event
async function handlePaymentIntentFailed(paymentIntent) {
  try {
    console.log(`❌ Processing payment_intent.payment_failed: ${paymentIntent.id}`);
    const payment = await Payment.findOne({ stripePaymentIntentId: paymentIntent.id });
    if (!payment) {
      console.warn(`⚠️ payment_intent.payment_failed: Payment record not found for PI ${paymentIntent.id}`);
      return;
    }
    payment.status = "failed";
    await payment.save();
    console.log(`✅ Webhook: Updated Payment ${payment._id} to failed status`);
  } catch (err) {
    console.error("❌ handlePaymentIntentFailed error:", err && err.stack ? err.stack : err);
  }
}

