const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");

function environment() {
  return new checkoutNodeJssdk.core.LiveEnvironment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  );
}

function client() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

module.exports = { client };