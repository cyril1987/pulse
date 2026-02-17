// Vercel serverless function entry point
// Wraps the Express app for Vercel's serverless environment

const app = require('../server');

module.exports = app;
