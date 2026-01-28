const OAuthClient = require('intuit-oauth');
const QuickBooks = require('node-quickbooks');

class QuickBooksService {
  constructor() {
    // Initialize OAuth Client
    this.oauthClient = new OAuthClient({
      clientId: process.env.QB_CLIENT_ID,
      clientSecret: process.env.QB_CLIENT_SECRET,
      environment: 'sandbox',
      redirectUri: process.env.QB_REDIRECT_URI,
      logging: true
    });
  }

  // ✅ ADD THIS METHOD (this was missing!)
  getAuthUri() {
    try {
      const authUri = this.oauthClient.authorizeUri({
        scope: [OAuthClient.scopes.Accounting],
        state: this.generateState() // CSRF protection
      });
      
      console.log('Generated Auth URI:', authUri);
      return authUri;
    } catch (error) {
      console.error('Error generating auth URI:', error);
      throw new Error(`Failed to generate QuickBooks auth URI: ${error.message}`);
    }
  }

  // Helper method for secure state generation
  generateState() {
    // Generate secure random state for CSRF protection
    return require('crypto').randomBytes(16).toString('hex');
  }

  // Handle OAuth callback
  async handleCallback(callbackUrl) {
    try {
      const authResponse = await this.oauthClient.createToken(callbackUrl);
      const token = authResponse.getToken();
      
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        realmId: token.realmId,
        expiresIn: token.expires_in
      };
    } catch (error) {
      console.error('OAuth callback error:', error);
      throw error;
    }
  }

  // Get cash flow data for your dashboard
  async getCashFlowData(accessToken, realmId) {
    const qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      accessToken,
      false,
      realmId,
      process.env.NODE_ENV !== 'production',
      true
    );

    try {
      // Get data needed for your Cash Flow Manager
      const [accounts, items, customers] = await Promise.all([
        this.getAccounts(qbo),
        this.getItems(qbo),
        this.getCustomers(qbo)
      ]);

      return {
        accounts,
        items, 
        customers,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching QB data:', error);
      throw error;
    }
  }

  // Helper methods
  getAccounts(qbo) {
    return new Promise((resolve, reject) => {
      qbo.findAccounts({}, (err, accounts) => {
        if (err) reject(err);
        else resolve(accounts.QueryResponse?.Account || []);
      });
    });
  }

  getItems(qbo) {
    return new Promise((resolve, reject) => {
      qbo.findItems({}, (err, items) => {
        if (err) reject(err);
        else resolve(items.QueryResponse?.Item || []);
      });
    });
  }

  getCustomers(qbo) {
    return new Promise((resolve, reject) => {
      qbo.findCustomers({}, (err, customers) => {
        if (err) reject(err);
        else resolve(customers.QueryResponse?.Customer || []);
      });
    });
  }
}

module.exports = QuickBooksService;

