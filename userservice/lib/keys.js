const fs = require('fs');
const path = require('path');

let PRIVATE_KEY = '';
let PUBLIC_KEY = '';

// Load from environment variables first (preferred and more secure for deployment)
// .replace(/\\n/g, '\n') is crucial for multi-line PEM strings from env vars
if (process.env.PRIVATE_KEY) {
  PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
}
if (process.env.PUBLIC_KEY) {
  PUBLIC_KEY = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
}

// Fallback: Load from files if environment variables are not set and paths are provided
// This can be useful for local development or if keys are managed as files
if (!PRIVATE_KEY && process.env.PRIVATE_KEY_PATH) {
  try {
    const privateKeyPath = path.resolve(process.env.PRIVATE_KEY_PATH);
    PRIVATE_KEY = fs.readFileSync(privateKeyPath, 'utf8');
    
  } catch (error) {
    console.error(`Error loading private key from file ${process.env.PRIVATE_KEY_PATH}:`, error.message);
  }
}

if (!PUBLIC_KEY && process.env.PUBLIC_KEY_PATH) {
  try {
    const publicKeyPath = path.resolve(process.env.PUBLIC_KEY_PATH);
    PUBLIC_KEY = fs.readFileSync(publicKeyPath, 'utf8');
    
  } catch (error) {
    console.error(`Error loading public key from file ${process.env.PUBLIC_KEY_PATH}:`, error.message);
  }
}

// Basic validation to ensure keys are loaded
if (!PRIVATE_KEY) {
  console.warn('Warning: SantimPay PRIVATE_KEY is not loaded. Transactions requiring it may fail.');
}
if (!PUBLIC_KEY) {
  console.warn('Warning: SantimPay PUBLIC_KEY is not loaded. Transactions requiring it may fail.');
}

module.exports = { PRIVATE_KEY, PUBLIC_KEY };