const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

function environment() {
  return new checkoutNodeJssdk.core.LiveEnvironment(
    process.env.AUMwMtXucbF0hp5UbnyclgPWeBUmzBpMLai9zxiwwJTkPSDkRgonjquFzHEfHUN6TH3O1bDvapgKXp7B,
    process.env.EE8vNC6f6DUXDZq5HH4SOt0pAeus0jMOLAV_8n5fK6sswJhwxyde7MXKIP98Ftj-HZFTyTI24W0_PLYq
  );
}

function client() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

module.exports = { client };