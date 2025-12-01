import mongoose from "mongoose";

const BookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  car: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Car",
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  paymentStatus: {
    type: String,
    enum: ["Pending", "Paid", "Cancelled"],
    default: "Pending",
  },
}, { timestamps: true });

const Booking = mongoose.model("Booking", BookingSchema);
export default Booking;
