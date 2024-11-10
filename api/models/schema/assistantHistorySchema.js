// models/assistantHistory.js
const mongoose = require('mongoose');

const assistantHistorySchema = mongoose.Schema(
  {
    assistant_id: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    instructions: {
      type: String, // or an appropriate type based on the data structure of instructions
      required: true,
    },
    assistantName: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt timestamps
  }
);

const AssistantHistory = mongoose.model('assistantHistory', assistantHistorySchema);
module.exports = AssistantHistory;
