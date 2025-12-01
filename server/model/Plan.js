import mongoose from "mongoose";

const PlanSchema = new mongoose.Schema({

  Id: {
    type: Number,
    unique: true,
    sparse: true
  },

  PlanName: {
    type: String,
    required: true
  },

  Description: {
    type: String
  },

  Price: {
    type: Number,
    required: true
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

  IsActive: {
    type: Boolean,
    default: true
  }

},

{ timestamps: true }
);

// Auto-increment Id before saving
PlanSchema.pre("save", async function (next) {
  if (this.isNew && !this.Id) {
    try {
      const lastPlan = await mongoose.model("Plan").findOne().sort({ Id: -1 });
      this.Id = lastPlan && lastPlan.Id ? lastPlan.Id + 1 : 1;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

const Plan = mongoose.model("Plan", PlanSchema);
export default Plan;
