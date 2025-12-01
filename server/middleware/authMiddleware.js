import jwt from "jsonwebtoken";
import User from "../model/User.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid user" });
    }

    req.user = user; // attach logged-in user info to req
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Unauthorized", error: error.message });
  }
};



export const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied: Admins only"
    });
  }
  next();
};

