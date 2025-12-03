import Plan from "../model/Plan.js";
import Payment from "../model/Payment.js";
import Stripe from "stripe";
import User from "../model/User.js";

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
      payment_method_types: [ "card",
    "upi"
    
    ],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${frontendUrl}/success?planId=${planId}&sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/error?cancelled=true&sessionId={CHECKOUT_SESSION_ID}`,
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

// Create or retrieve a Stripe Customer for the logged-in user
export const createCustomer = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });

    // If user already has a Stripe customer id, return it
    if (user.stripeCustomerId) {
      return res.json({ success: true, customerId: user.stripeCustomerId });
    }

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured" });

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.fullName || user.name || undefined,
      metadata: { userId: user._id.toString() },
    });

    // Save customer id on user record
    user.stripeCustomerId = customer.id;
    await user.save();

    return res.json({ success: true, customerId: customer.id });
  } catch (err) {
    console.error("❌ createCustomer error:", err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: "Failed to create customer", error: err && err.message ? err.message : String(err) });
  }
};

// Create PaymentIntent with automatic payment methods enabled (Payment Element + wallets)
export const createPaymentIntent = async (req, res) => {
  try {
    const { planId } = req.params;
    if (!planId) return res.status(400).json({ success: false, message: "planId is required" });

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured" });

    const amount = Math.round(parseFloat(plan.Price) * 100);
    const currency = (process.env.STRIPE_CURRENCY || "inr").toLowerCase();

    // If user is logged in and has a Stripe customer, attach to the PaymentIntent
    let customerId = null;
    if (req.user && req.user.stripeCustomerId) {
      customerId = req.user.stripeCustomerId;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      customer: customerId || undefined,
      metadata: { planId: plan._id.toString() },
    });

    return res.json({ success: true, clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    console.error("❌ createPaymentIntent error:", err && err.message ? err.message : err);
    return res.status(500).json({ success: false, message: "Failed to create PaymentIntent", error: err && err.message ? err.message : String(err) });
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

// Mark a checkout session as cancelled (called from frontend cancel page)
export const markSessionCanceled = async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ success: false, message: "sessionId required" });

    const stripe = getStripe();
    if (!stripe) return res.status(500).json({ success: false, message: "Stripe not configured" });

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) return res.status(404).json({ success: false, message: "Session not found" });

    // Build a minimal payment record with canceled status
    const planId = session.metadata?.planId || null;
    const amount = typeof session.amount_total === "number" ? session.amount_total / 100 : null;
    const currency = session.currency || process.env.STRIPE_CURRENCY || "inr";

    const paymentData = {
      plan: planId || null,
      amount: amount || 0,
      currency,
      status: "canceled",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
      stripeRaw: session,
    };

    const filter = { stripeCheckoutSessionId: session.id };
    const payment = await Payment.findOneAndUpdate(filter, { $set: paymentData }, { upsert: true, new: true, setDefaultsOnInsert: true });

    return res.json({ success: true, message: "Session marked as canceled", payment });
  } catch (err) {
    console.error("❌ markSessionCanceled error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: "Failed to mark session canceled", error: err && err.message ? err.message : String(err) });
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
// ======================
// STRIPE WEBHOOK HANDLER
// ======================

export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    console.error("❌ Missing Stripe Signature");
    return res.status(400).send("Missing Stripe Signature");
  }

  if (!webhookSecret) {
    console.error("❌ STRIPE_WEBHOOK_SECRET missing");
    return res.status(500).send("Webhook secret missing");
  }

  const stripe = getStripe();
  let event;

  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}));

    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);

    console.log(`✅ Webhook verified → ${event.type}`);
  } catch (err) {
    console.error("❌ Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // REQUIRED PAYMENT EVENTS
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object, stripe);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object, stripe);
        break;

      case "charge.succeeded":
        await handleChargeSucceeded(event.data.object, stripe);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object, stripe);
        break;

      // OPTIONAL - subscription info
      case "customer.subscription.created":
        console.log("📅 Subscription created:", event.data.object.id);
        break;

      case "customer.subscription.updated":
        console.log("🔄 Subscription updated:", event.data.object.id);
        break;

      // Subscription Schedule events
      case "subscription_schedule.created":
        await handleSubscriptionScheduleCreated(event.data.object);
        break;

      case "subscription_schedule.completed":
        await handleSubscriptionScheduleCompleted(event.data.object);
        break;

      case "subscription_schedule.canceled":
        await handleSubscriptionScheduleCanceled(event.data.object);
        break;

      case "subscription_schedule.released":
        await handleSubscriptionScheduleReleased(event.data.object);
        break;

      case "subscription_schedule.updated":
        await handleSubscriptionScheduleUpdated(event.data.object);
        break;

      case "subscription_schedule.expiring":
        await handleSubscriptionScheduleExpiring(event.data.object);
        break;

      default:
        console.log(`ℹ️ Skipped event → ${event.type}`);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(`❌ Error processing event ${event.type}:`, err);
    return res.status(500).json({ success: false });
  }
};



// ======================
// PAYMENT HANDLERS
// ======================


// 1️⃣ invoice.payment_succeeded
async function handleInvoicePaymentSucceeded(invoice, stripe) {
  console.log("💰 invoice.payment_succeeded:", invoice.id);

  const paymentIntentId = invoice.payment_intent;

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  const charge = pi.charges.data[0];

  const paymentData = {
    amount: invoice.amount_paid / 100,
    currency: invoice.currency,
    status: "succeeded",
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: charge.id,
    stripeSubscriptionId: invoice.subscription,
    customerId: invoice.customer,
    cardBrand: charge.payment_method_details.card.brand,
    cardLast4: charge.payment_method_details.card.last4,
    createdAt: new Date(invoice.created * 1000),
    stripeRaw: invoice,
  };

  await Payment.findOneAndUpdate(
    { stripePaymentIntentId: paymentIntentId },
    paymentData,
    { upsert: true, new: true }
  );

  console.log("✅ Payment saved from invoice.payment_succeeded");
}



// 2️⃣ payment_intent.succeeded
async function handlePaymentIntentSucceeded(pi, stripe) {
  console.log("💳 payment_intent.succeeded:", pi.id);

  const charge = pi.charges.data[0];

  await Payment.findOneAndUpdate(
    { stripePaymentIntentId: pi.id },
    {
      amount: pi.amount / 100,
      currency: pi.currency,
      status: "succeeded",
      stripeChargeId: charge.id,
      cardBrand: charge.payment_method_details.card.brand,
      cardLast4: charge.payment_method_details.card.last4,
      stripeRaw: pi,
    },
    { upsert: true }
  );

  console.log("✅ Payment updated from payment_intent.succeeded");
}



// 3️⃣ charge.succeeded
async function handleChargeSucceeded(charge) {
  console.log("💸 charge.succeeded:", charge.id);

  await Payment.findOneAndUpdate(
    { stripeChargeId: charge.id },
    {
      stripePaymentIntentId: charge.payment_intent,
      status: "succeeded",
      cardBrand: charge.payment_method_details.card.brand,
      cardLast4: charge.payment_method_details.card.last4,
      stripeRaw: charge,
    },
    { upsert: true }
  );

  console.log("✅ Charge saved");
}



// 4️⃣ invoice.paid
async function handleInvoicePaid(invoice) {
  console.log("🧾 invoice.paid:", invoice.id);

  await Payment.findOneAndUpdate(
    { stripePaymentIntentId: invoice.payment_intent },
    { status: "succeeded" }
  );

  console.log("✅ Invoice marked as paid");
}

// ============================
// Subscription Schedule Handlers
// ============================

async function handleSubscriptionScheduleCreated(schedule) {
  try {
    console.log(`📘 subscription_schedule.created: id=${schedule.id}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // Extract current period dates if available in phases
      if (schedule.phases && schedule.phases.length > 0) {
        const currentPhase = schedule.phases[0];
        const updateData = {};
        
        if (currentPhase.start_date) {
          updateData.currentPeriodStart = new Date(currentPhase.start_date * 1000);
          console.log(`→ currentPeriodStart: ${updateData.currentPeriodStart.toISOString()}`);
        }
        
        if (currentPhase.end_date) {
          updateData.currentPeriodEnd = new Date(currentPhase.end_date * 1000);
          console.log(`→ currentPeriodEnd: ${updateData.currentPeriodEnd.toISOString()}`);
        }

        if (Object.keys(updateData).length > 0) {
          await Plan.findByIdAndUpdate(planId, updateData);
          console.log(`✅ Plan ${planId} updated with period dates`);
        }
      }
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleCreated error:", err && err.stack ? err.stack : err);
  }
}

async function handleSubscriptionScheduleCompleted(schedule) {
  try {
    console.log(`✅ subscription_schedule.completed: id=${schedule.id}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // On completion, update period dates from the released subscription
      if (schedule.phases && schedule.phases.length > 0) {
        const updateData = {};
        
        // Use the first phase's dates
        const phase = schedule.phases[0];
        if (phase.start_date) {
          updateData.currentPeriodStart = new Date(phase.start_date * 1000);
        }
        if (phase.end_date) {
          updateData.currentPeriodEnd = new Date(phase.end_date * 1000);
        }

        if (Object.keys(updateData).length > 0) {
          await Plan.findByIdAndUpdate(planId, updateData);
          console.log(`✅ Plan ${planId} updated with completed period dates`);
        }
      }
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleCompleted error:", err && err.stack ? err.stack : err);
  }
}

async function handleSubscriptionScheduleCanceled(schedule) {
  try {
    console.log(`❌ subscription_schedule.canceled: id=${schedule.id}`);
    if (schedule.canceled_at) console.log(`→ canceled_at: ${new Date(schedule.canceled_at * 1000).toISOString()}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // Optionally clear period dates on cancellation or mark a status field
      // For now, just log — you can add status field if needed
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleCanceled error:", err && err.stack ? err.stack : err);
  }
}

async function handleSubscriptionScheduleReleased(schedule) {
  try {
    console.log(`📤 subscription_schedule.released: id=${schedule.id}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // Extract period dates from the released subscription
      if (schedule.subscription) {
        // subscription field contains the active subscription; can query Stripe for billing period
        // For now, log the subscription ID
        console.log(`→ subscription: ${schedule.subscription}`);
      }
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleReleased error:", err && err.stack ? err.stack : err);
  }
}

async function handleSubscriptionScheduleUpdated(schedule) {
  try {
    console.log(`🔁 subscription_schedule.updated: id=${schedule.id}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // On update, refresh period dates
      if (schedule.phases && schedule.phases.length > 0) {
        const updateData = {};
        const phase = schedule.phases[0];
        
        if (phase.start_date) {
          updateData.currentPeriodStart = new Date(phase.start_date * 1000);
        }
        if (phase.end_date) {
          updateData.currentPeriodEnd = new Date(phase.end_date * 1000);
        }

        if (Object.keys(updateData).length > 0) {
          await Plan.findByIdAndUpdate(planId, updateData);
          console.log(`✅ Plan ${planId} updated with new period dates`);
        }
      }
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleUpdated error:", err && err.stack ? err.stack : err);
  }
}

async function handleSubscriptionScheduleExpiring(schedule) {
  try {
    console.log(`⏳ subscription_schedule.expiring: id=${schedule.id}`);
    const planId = schedule.metadata?.planId;
    if (planId) {
      console.log(`→ metadata.planId: ${planId}`);
      // 7 days before expiry — you can send customer notification here
      if (schedule.phases && schedule.phases.length > 0) {
        const phase = schedule.phases[schedule.phases.length - 1];
        if (phase.end_date) {
          const expiryDate = new Date(phase.end_date * 1000);
          console.log(`→ Subscription expiring at: ${expiryDate.toISOString()}`);
          // TODO: send renewal reminder email to customer
        }
      }
    }
  } catch (err) {
    console.error("❌ handleSubscriptionScheduleExpiring error:", err && err.stack ? err.stack : err);
  }
}