require('dotenv').config();
const mongoose = require('mongoose');
const { connectMongo } = require('../config/mongo');
const PaymentOption = require('../models/paymentOption');

async function main() {
  try {
    await connectMongo();
    const options = [
      { name: 'Telebirr', logo: 'https://cdn.app/logos/telebirr.png' },
      { name: 'Commercial Bank of Ethiopia (CBE)', logo: 'https://cdn.app/logos/cbe.png' },
      { name: 'Awash Bank', logo: 'https://cdn.app/logos/awash.png' },
      { name: 'Dashen Bank', logo: 'https://cdn.app/logos/dashen.png' },
      { name: 'Bank of Abyssinia', logo: 'https://cdn.app/logos/abyssinia.png' },
    ];

    let created = 0;
    for (const opt of options) {
      const exists = await PaymentOption.findOne({ name: opt.name });
      if (!exists) {
        await PaymentOption.create(opt);
        created++;
      }
    }
    console.log(`Payment options seeding complete. Inserted ${created} new option(s).`);
  } catch (e) {
    console.error('Failed to seed payment options:', e);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

main();

