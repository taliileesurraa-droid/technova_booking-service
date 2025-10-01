const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGO_URI;

  if (!uri) throw new Error('MONGO_URI is not defined in .env');

  try {
    // v4 of mongoose no longer needs useNewUrlParser or useUnifiedTopology
    await mongoose.connect(uri);
    
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
}

module.exports = { connectMongo };
