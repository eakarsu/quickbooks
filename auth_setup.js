const OAuthClient = require('intuit-oauth');
const QuickBooks = require('node-quickbooks');

// OAuth Configuration
const oauthClient = new OAuthClient({
  clientId: process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  environment: 'sandbox', // or 'production'
  redirectUri: 'https://cashflowapp.app/oauth/callback',
  logging: true
});

// Generate authorization URL
const authUri = oauthClient.authorizeUri({
  scope: [OAuthClient.scopes.Accounting],
  state: 'testState'  // CSRF protection
});

console.log(`Visit this URL to authorize: ${authUri}`);

