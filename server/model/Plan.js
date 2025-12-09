import mongoose from "mongoose";

const PlanSchema = new mongoose.Schema({

  PlanName: {
    type: String,
    required: true
  },

  Description: {
    type: String
  },

  Price: {
    type: Number,
    required: false,
    default: 0
  },

  Currency: {
    type: String,
    default: "INR"
  },

  BillingPeriod: {
    type: String, // Monthly, Yearly
    required: true
  },

  BillingInterval: {
    type: Number, // 1, 12, etc.
    required: true
  },

  // Stripe recurring price ID for subscriptions
  stripePriceId: {
    type: String,
    default: null
  },

  // Stripe product ID
  stripeProductId: {
    type: String,
    default: null
  },

  MaxUsers: {
    type: Number
  },

  AllowCustomDomain: {
    type: Boolean,
    default: false
  },

  currentPeriodStart: {
    type: Date,
    default: null
  },

  currentPeriodEnd: {
    type: Date,
    default: null
  },

  // Optional explicit plan-level start/end dates (keeps last known activation window)
  planStartDate: {
    type: Date,
    default: null
  },

  planEndDate: {
    type: Date,
    default: null
  },

  IsActive: {
    type: Boolean,
    default: true
  }

},

  { timestamps: true }
);


const Plan = mongoose.model("Plan", PlanSchema);
export default Plan;
