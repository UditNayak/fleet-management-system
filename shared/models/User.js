const mongoose = require('mongoose');

const ROLES = ['admin', 'fleet_manager', 'driver'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false → never loaded from the DB unless a query explicitly asks for it
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'driver', index: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
    toJSON: {
      // Shape sent to clients: `id` instead of `_id`, no internal or secret fields
      transform: (_doc, { _id, __v, passwordHash, ...rest }) => ({ id: _id.toString(), ...rest }),
    },
  },
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
