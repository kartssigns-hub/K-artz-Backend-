const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  // The Firebase UID of the user involved in this chat
  userId: {
    type: String,
    required: true,
    unique: true // One active chat thread per user for now
  },
  // Helpful for admin dashboard later
  userEmail: {
    type: String,
    required: true
  },
  // Status to help with human handoff later
  status: {
    type: String,
    enum: ['ai_active', 'human_needed', 'human_active', 'closed'],
    default: 'ai_active'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true }); // Adds createdAt and updatedAt automatically

module.exports = mongoose.model('Chat', ChatSchema);