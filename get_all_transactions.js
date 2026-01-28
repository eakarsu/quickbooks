async function getAllTransactions(accessToken, realmId) {
  const qbo = new QuickBooks(
    process.env.QB_CLIENT_ID,
    process.env.QB_CLIENT_SECRET,
    accessToken,
    false, // no token secret for OAuth 2.0
    realmId,
    true,  // use sandbox
    true,  // enable debugging
    null,  // minor version
    '2.0', // OAuth version
    refreshToken
  );

  try {
    // Get all payments (cash inflows)
    const payments = await new Promise((resolve, reject) => {
      qbo.findPayments({}, (err, payments) => {
        if (err) reject(err);
        else resolve(payments);
      });
    });

    // Get all bills (cash outflows) 
    const bills = await new Promise((resolve, reject) => {
      qbo.findBills({}, (err, bills) => {
        if (err) reject(err);
        else resolve(bills);
      });
    });

    // Get bank accounts (for balance tracking)
    const accounts = await new Promise((resolve, reject) => {
      qbo.findAccounts({ AccountType: 'Bank' }, (err, accounts) => {
        if (err) reject(err);
        else resolve(accounts);
      });
    });

    return {
      payments: payments.QueryResponse?.Payment || [],
      bills: bills.QueryResponse?.Bill || [],
      bankAccounts: accounts.QueryResponse?.Account || []
    };

  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }
}

