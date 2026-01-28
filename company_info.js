async function getCompanyInfo(accessToken, realmId) {
  try {
    const response = await oauthClient.makeApiCall({
      url: `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    console.log('Company Info:', response.json);
    return response.json;
  } catch (error) {
    console.error('Error getting company info:', error);
  }
}

