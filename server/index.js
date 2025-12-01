
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { connectDB } from "./config/db.js";

import { createplan, getallplans, getplanbyid } from "./controller/Plancontroller.js";


import { authMiddleware } from "./middleware/authMiddleware.js";
import { login, register } from "./controller/Usercontroller.js";
import { createCheckoutSession, getPaymentHistory, getPaymentSession, handleWebhook, saveFrontendSession } from "./controller/Paymentcontoller.js";



dotenv.config();
const PORT = process.env.PORT || 8000;
const app = express();

// Read Stripe keys
const _stripeSecret = process.env.STRIPE_SECRET_KEY;
const _webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!_stripeSecret) {
  console.warn("⚠️ STRIPE_SECRET_KEY not set. Checkout session creation will fail.");
}

if (!_webhookSecret) {
  console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set. Webhooks will fail signature verification.");
}

app.use(cors());
app.use('/uploads', express.static('uploads')); 

// Webhook must be mounted BEFORE express.json() to preserve raw body for signature verification
// Use a permissive type to ensure raw body is available even if Stripe sends a charset
// MUST BE RAW BODY, MUST MATCH application/json
app.post("/payments/webhook", express.raw({ type: "application/json" }), handleWebhook);

// After webhook route:
app.use(express.json());

// =======================
// 🔐 AUTH ROUTES
// =======================
app.post("/register",  register);
app.post("/login", login);



// Create Plan
app.post("/createplan",createplan );

// Get All Plans
app.get("/getplans", getallplans);

// Get Plan by ID
app.get("/getplans/:id", getplanbyid );



app.post("/payments/create-intent/:planId", authMiddleware, createCheckoutSession);
app.get("/payments/user/:userId", authMiddleware, getPaymentHistory);
app.get("/payments/session/:sessionId", getPaymentSession);
app.post("/payments/save-frontend", saveFrontendSession);

// =======================
// 🚀 SERVER START
// =======================

app.listen(PORT, () => {
  connectDB();
  console.log(`Server is running on PORT: ${PORT}`);
});
