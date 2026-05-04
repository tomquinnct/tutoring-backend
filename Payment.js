// models/Payment.js

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  paypalOrderId: {
    type: String,
    required: true,
    unique: true
  },
  paypalCaptureId: {
    type: String,
    required: true,
    unique: true
  },
  amount: {
    type: String,
    required: true
  },
  sessionsAdded: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', paymentSchema);