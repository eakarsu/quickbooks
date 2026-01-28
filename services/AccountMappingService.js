const QuickBooks = require('node-quickbooks');

class AccountMappingService {
  constructor(accessToken, refreshToken, realmId) {
    this.qbo = new QuickBooks(
      process.env.QB_CLIENT_ID,
      process.env.QB_CLIENT_SECRET,
      accessToken,
      false,
      realmId,
      process.env.NODE_ENV !== 'production',
      true,
      null,
      '2.0',
      refreshToken
    );
    this.accountMap = {};
    this.subcategoryMap = {};
    this.createdAccounts = new Set();
  }

  async initializeAccountMapping() {
  try {
    const accounts = await new Promise((resolve, reject) => {
      this.qbo.findAccounts({}, (err, accounts) => {
        if (err) reject(err);
        else resolve(accounts.QueryResponse?.Account || []);
      });
    });

    // Create mapping from category names to account IDs
    accounts.forEach(account => {
      const name = account.Name.toLowerCase();
      this.accountMap[name] = {
        value: account.Id,
        name: account.Name,
        type: account.AccountType
      };
    });

    // ✅ ENHANCED: Map food categories to existing accounts
    this.accountMap['rent'] = this.findAccountByName(accounts, ['rent', 'rent or lease', 'lease']);
    this.accountMap['utilities'] = this.findAccountByName(accounts, ['utilities', 'utility']);
    this.accountMap['office supplies'] = this.findAccountByName(accounts, ['office supplies', 'supplies']);
    this.accountMap['payroll'] = this.findAccountByName(accounts, ['payroll', 'wages', 'salaries']);
    this.accountMap['marketing'] = this.findAccountByName(accounts, ['marketing', 'advertising']);
    
    // ✅ FIX: Map food categories to existing Cost of Goods Sold
    this.accountMap['food supplies'] = this.findAccountByName(accounts, ['cost of goods sold', 'supplies', 'purchases']);
    this.accountMap['food inventory'] = this.findAccountByName(accounts, ['cost of goods sold', 'inventory asset', 'purchases']);
    this.accountMap['beverage restock'] = this.findAccountByName(accounts, ['cost of goods sold', 'supplies', 'purchases']);
    
    // ✅ FIX: Map equipment to existing accounts
    this.accountMap['equipment purchase'] = this.findAccountByName(accounts, ['supplies', 'office expenses', 'purchases']);
    this.accountMap['maintenance'] = this.findAccountByName(accounts, ['repair & maintenance', 'supplies']);

    console.log('✅ Account mapping initialized:', Object.keys(this.accountMap));
    return this.accountMap;
  } catch (error) {
    console.error('Failed to initialize account mapping:', error);
    throw error;
  }
}

// ✅ ENHANCED: Better account finding with fallbacks
findAccountByName(accounts, searchNames) {
  for (const searchName of searchNames) {
    const account = accounts.find(acc =>
      acc.Name.toLowerCase().includes(searchName.toLowerCase())
    );
    if (account) {
      console.log(`✅ Mapped to existing account: ${account.Name} (ID: ${account.Id})`);
      return {
        value: account.Id,
        name: account.Name,
        type: account.AccountType
      };
    }
  }
  
  // Fallback to Uncategorized Expense
  console.log(`⚠️ No matching account found, using Uncategorized Expense`);
  return {
    value: "125",
    name: "Uncategorized Expense",
    type: "Expense"
  };
}
  

  // ✅ NEW: Enhanced method that creates accounts if they don't exist
  // ✅ ENHANCED: Handle both category and subcategory
  async getCategoryAccount(csvCategory, csvSubcategory, transactionType = 'expense') {
    if (!csvCategory) return this.getDefaultAccount(transactionType);
  
    const categoryKey = csvCategory.toLowerCase().trim();
    const subcategoryKey = csvSubcategory ? csvSubcategory.toLowerCase().trim() : null;
    
    console.log(`Looking up ${transactionType}: "${categoryKey}", subcategory: "${subcategoryKey}"`);
    
    // ✅ Handle both income and expense subcategories
    if (csvSubcategory && subcategoryKey) {
        const subcategoryAccount = await this.getOrCreateSubcategory(csvCategory, csvSubcategory, transactionType);
        if (subcategoryAccount) {
        return subcategoryAccount;
        }
    }

    
    // Fall back to main category
    if (this.accountMap[categoryKey]) {
      return this.accountMap[categoryKey];
    }
    
    // Create main category if it doesn't exist
    try {
      const newAccount = await this.createQuickBooksAccount(csvCategory, transactionType);
      this.accountMap[categoryKey] = newAccount;
      return newAccount;
    } catch (error) {
      console.error(`Failed to create account for "${csvCategory}":`, error.message);
      return this.getDefaultExpenseAccount();
    }
  }

  // ✅ NEW: Get or create subcategory account
  async getOrCreateSubcategory(parentCategory, subcategory, transactionType) {
    const subcategoryKey = `${parentCategory.toLowerCase()}:${subcategory.toLowerCase()}`;
    
    // Check if subcategory already exists
    if (this.subcategoryMap[subcategoryKey]) {
      return this.subcategoryMap[subcategoryKey];
    }
    
    try {
      // First ensure parent category exists
      const parentAccount = await this.getOrCreateParentCategory(parentCategory, transactionType);
      
      // Create subcategory under parent
      const subcategoryAccount = await this.createSubcategoryAccount(parentAccount, subcategory, transactionType);
      
      // Cache the subcategory
      this.subcategoryMap[subcategoryKey] = subcategoryAccount;
      this.createdAccounts.add(subcategoryAccount.name);
      
      console.log(`✅ Created subcategory: "${subcategoryAccount.name}" under "${parentAccount.name}"`);
      return subcategoryAccount;
      
    } catch (error) {
      console.error(`Failed to create subcategory "${subcategory}" under "${parentCategory}":`, error.message);
      return null;
    }
  }

  // ✅ NEW: Ensure parent category exists
  // ✅ Enhanced income account mapping
async getOrCreateParentCategory(categoryName, transactionType) {
  const categoryKey = categoryName.toLowerCase().trim();
  
  if (this.accountMap[categoryKey]) {
    return this.accountMap[categoryKey];
  }
  
  // ✅ Create appropriate parent account based on transaction type
  const parentAccount = await this.createQuickBooksAccount(categoryName, transactionType);
  this.accountMap[categoryKey] = parentAccount;
  return parentAccount;
}   

  // ✅ NEW: Create subcategory account in QuickBooks
 // ✅ FIXED: Create subcategory account in QuickBooks
async createSubcategoryAccount(parentAccount, subcategoryName, transactionType) {
  // ✅ Fix the account name formatting (remove special characters)
  const cleanSubcategoryName = subcategoryName
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters like ":"
    .replace(/\s+/g, ' ')          // Normalize spaces
    .trim();

  const accountData = {
    Name: this.formatAccountName(cleanSubcategoryName),
    AccountType: parentAccount.type,
    // ✅ Remove Classification - this is causing the validation error
    SubAccount: true,
    ParentRef: {
      value: parentAccount.value,
      name: parentAccount.name
    }
  };

  console.log(`Creating QB subcategory account:`, accountData);

  return new Promise((resolve, reject) => {
    this.qbo.createAccount(accountData, (err, result) => {
      if (err) {
        console.error('QuickBooks subcategory creation error:', err);
        reject(new Error(`Failed to create subcategory: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        console.log('Subcategory creation response:', result);
        
        let account;
        if (result.Account) {
          account = result.Account;
        } else if (result.QueryResponse?.Account?.[0]) {
          account = result.QueryResponse.Account[0];
        } else {
          reject(new Error('Unexpected response structure from QuickBooks'));
          return;
        }
        
        // ✅ FIXED: Response parsing in createSubcategoryAccount
        resolve({
            value: account.Id,        // ← The account object is correctly structured
            name: account.Name,
            type: account.AccountType,
            isSubcategory: true,
            parentName: parentAccount.name,
            subcategoryName: cleanSubcategoryName
        });

      }
    });
  });
}



  // ✅ NEW: Create account in QuickBooks
 // ✅ FIXED: Create account in QuickBooks
 // ✅ FIXED: Correct response parsing
async createQuickBooksAccount(categoryName, transactionType = 'expense') {
  const accountData = {
    Name: this.formatAccountName(categoryName),
    AccountType: this.getAccountTypeForCategory(categoryName, transactionType),
    Classification: this.getAccountClassification(categoryName, transactionType)
  };

  console.log(`Creating QB account:`, accountData);

  return new Promise((resolve, reject) => {
    this.qbo.createAccount(accountData, (err, result) => {
      if (err) {
        console.error('QuickBooks account creation error:', err);
        reject(new Error(`Failed to create account: ${err.Fault?.Error?.[0]?.Detail || err.message}`));
      } else {
        console.log('Account creation response:', result);
        
        // ✅ FIXED: Handle the actual response structure from your logs
        let account;
        if (result.Account) {
          account = result.Account; // ← This is what QB actually returns
        } else if (result.QueryResponse?.Account?.[0]) {
          account = result.QueryResponse.Account[0];
        } else {
          console.error('Unexpected response structure:', result);
          reject(new Error('Unexpected response structure from QuickBooks'));
          return;
        }
        
        // ✅ Now this won't crash because account is properly defined
        resolve({
          value: account.Id,        // ← Line 127 that was crashing
          name: account.Name,
          type: account.AccountType
        });
      }
    });
  });
}

 

  // ✅ NEW: Format category name for QuickBooks account
  formatAccountName(categoryName) {
    // Convert to proper case and clean up
    return categoryName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
      .replace(/[^a-zA-Z0-9\s\-&]/g, ''); // Remove special characters
  }

  // ✅ NEW: Determine account type based on category
  getAccountTypeForCategory(categoryName, transactionType) {
  const category = categoryName.toLowerCase();
  
  // ✅ Income-specific account types
  if (transactionType === 'income') {
    if (category.includes('sale') || category.includes('revenue') || category.includes('sales')) {
      return 'Income';
    }
    if (category.includes('service') || category.includes('fee')) {
      return 'Income';
    }
    if (category.includes('interest') || category.includes('investment')) {
      return 'Other Income';
    }
    return 'Income'; // Default for income transactions
  }
  
  // ✅ Expense-specific account types  
  if (transactionType === 'expense') {
    // Food/inventory items → Cost of Goods Sold
    if (category.includes('inventory') || category.includes('food') || 
        category.includes('beverage') || category.includes('supplies') && 
        (category.includes('food') || category.includes('restaurant'))) {
      return 'Cost of Goods Sold';
    }
    
    // Equipment, maintenance, repairs → Regular Expense
    if (category.includes('equipment') || category.includes('furniture') || 
        category.includes('machinery') || category.includes('maintenance') ||
        category.includes('repair')) {
      return 'Expense';
    }
    
    // Miscellaneous, penalties, etc. → Other Expense  
    if (category.includes('miscellaneous') || category.includes('penalty') ||
        category.includes('settlement') || category.includes('other')) {
      return 'Other Expense';
    }
    
    // Default for expense transactions
    return 'Expense';
  }
  
  // ✅ Fallback defaults
  return transactionType === 'income' ? 'Income' : 'Expense';
}


  // ✅ NEW: Get classification for account
  getAccountClassification(categoryName, transactionType) {
    const category = categoryName.toLowerCase();
    
    if (category.includes('inventory') || category.includes('food') || category.includes('beverage')) {
      return 'Cost of Goods Sold';
    }
    if (category.includes('equipment') || category.includes('furniture')) {
      return 'Fixed Asset';
    }
    
    return transactionType === 'income' ? 'Revenue' : 'Expense';
  }

  getDefaultExpenseAccount() {
    return {
      value: "125",
      name: "Uncategorized Expense",
      type: "Expense"
    };
  }

  // ✅ NEW: Get summary of created accounts
  getCreatedAccountsSummary() {
    return {
      totalCreated: this.createdAccounts.size,
      accountNames: Array.from(this.createdAccounts)
    };
  }
}

module.exports = AccountMappingService;
