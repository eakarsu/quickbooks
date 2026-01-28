const XLSX = require('xlsx');
const moment = require('moment');

class GenericExcelUploadService {
  constructor(config = {}) {
    this.config = {
      // Default column mappings - can be overridden
      columnMappings: {
        date: ['Date', 'Transaction Date', 'date', 'DATE', 'TxnDate',"transaction period"],
        description: ['Description', 'Memo', 'description', 'DESC', 'Details'],
        amount: ['Amount', 'amount', 'AMOUNT', 'Total', 'Value'],
        category: ['Category', 'category', 'Type', 'type','account',"memo"],
        subcategory: ['Subcategory', 'subcategory', 'SubCategory', 'sub_category',"merchant categ"], // ✅ ADD THIS
        reference: ['Reference', 'Ref', 'ID', 'Transaction ID', 'id'],
        balance: ["remaining"]
      },
      
      dateFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD'],
      
      validation: {
        requireDate: true,
        requireDescription: false,
        requireAmount: true,
        allowNegativeAmounts: true
      },
      
      processors: [],
      
      ...config
    };
  }

  // ✅ FIXED: Case-insensitive field extraction
  extractField(row, possibleNames) {
    if (!possibleNames || !Array.isArray(possibleNames)) return null;
    
    // Get all actual column names from the row
    const actualColumns = Object.keys(row);
    
    // Try exact matches first
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        console.log(`✅ Found exact match: "${name}" = "${row[name]}"`);
        return row[name];
      }
    }
    
    // ✅ NEW: Try case-insensitive matches
    for (const targetName of possibleNames) {
      const targetLower = targetName.toLowerCase();
      
      // Find matching column by case-insensitive comparison
      const matchingColumn = actualColumns.find(colName => 
        colName.toLowerCase() === targetLower
      );
      
      if (matchingColumn && 
          row[matchingColumn] !== undefined && 
          row[matchingColumn] !== null && 
          row[matchingColumn] !== '') {
        console.log(`✅ Found case-insensitive match: "${matchingColumn}" = "${row[matchingColumn]}"`);
        return row[matchingColumn];
      }
    }
    
    console.log(`❌ No match found for field. Available columns: ${actualColumns.join(', ')} in ${possibleNames.join(', ')}`);
    return null;
  }

  // ✅ IMPROVED: Better row transformation with debugging
  transformRow(row, mappings, index) {
    console.log(`\n🔍 Processing row ${index + 1}:`, row);
    
    const transaction = {
      originalRowIndex: index + 1,
      date: this.extractField(row, mappings.date),
      description: this.extractField(row, mappings.description) || `Transaction ${index + 1}`,
      amount: this.extractField(row, mappings.amount),
      category: this.extractField(row, mappings.category),
      subcategory: this.extractField(row, mappings.subcategory), // ✅ ADD THIS
      reference: this.extractField(row, mappings.reference),
      originalData: row
    };

    console.log(`📊 Extracted fields:`, {
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      category: transaction.category,
      subcategory: transaction.subcategory
    });

    // Parse and validate date
    transaction.date = this.parseDate(transaction.date);
    
    // Parse and validate amount
    transaction.amount = this.parseAmount(transaction.amount);
    
    // Determine transaction type
    transaction.type = transaction.amount >= 0 ? 'income' : 'expense';
    transaction.absoluteAmount = Math.abs(transaction.amount);
    
    console.log(`✅ Final transaction:`, {
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      subcategory: transaction.subcategory
    });
    
    return transaction;
  }

  // ✅ IMPROVED: Better amount parsing
  parseAmount(amountValue) {
    console.log(`💰 Parsing amount: "${amountValue}"`);
    
    if (amountValue === null || amountValue === undefined || amountValue === '') {
      console.log(`❌ Amount is null/undefined/empty`);
      throw new Error('Amount is required');
    }
    
    // Remove currency symbols and parse
    const cleanAmount = String(amountValue)
      .replace(/[$,£€¥₹]/g, '')
      .replace(/[()]/g, '-') // Handle negative amounts in parentheses
      .trim();
    
    const amount = parseFloat(cleanAmount);
    if (isNaN(amount)) {
      console.log(`❌ Cannot parse amount: "${amountValue}" -> "${cleanAmount}"`);
      throw new Error(`Invalid amount: ${amountValue}`);
    }
    
    console.log(`✅ Parsed amount: "${amountValue}" -> ${amount}`);
    return amount;
  }

  // ✅ IMPROVED: Better date parsing
  parseDate(dateValue) {
  console.log(`📅 Parsing date: "${dateValue}"`);
  
  if (!dateValue) {
    console.log(`❌ Date is null/undefined`);
    return null;
  }
  
  // ✅ Handle Excel serial dates (your CSV has values like 45451.833333333336)
  if (typeof dateValue === 'number' && dateValue > 40000) {
    // Excel serial date conversion
    const excelEpoch = new Date(1899, 11, 30); // Excel epoch
    const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    const result = date.toISOString().split('T')[0];
    console.log(`✅ Converted Excel date: "${dateValue}" -> "${result}"`);
    return result;
  }
  
  // Try standard date formats
  for (const format of this.config.dateFormats) {
    const parsed = moment(dateValue, format, true);
    if (parsed.isValid()) {
      const result = parsed.format('YYYY-MM-DD');
      console.log(`✅ Parsed date: "${dateValue}" -> "${result}"`);
      return result;
    }
  }
  
  // Try automatic parsing as fallback
  const parsed = moment(dateValue);
  if (parsed.isValid()) {
    const result = parsed.format('YYYY-MM-DD');
    console.log(`✅ Auto-parsed date: "${dateValue}" -> "${result}"`);
    return result;
  }
  
  console.log(`❌ Failed to parse date: "${dateValue}"`);
  throw new Error(`Invalid date format: ${dateValue}`);
}


  // Rest of your methods stay the same...
  async processUpload(filePath, options = {}) {
    try {
      console.log(`📁 Processing file: ${filePath}`);
      
      // Parse the file
      const data = this.parseFile(filePath);
      console.log(`📊 Found ${data.length} rows to process`);
      console.log(`📋 Sample row:`, data[0]);
      
      // Transform and validate data
      const transactions = this.transformData(data, options);
      console.log(`✅ Transformed ${transactions.length} valid transactions`);
      
      // Process transactions through all configured processors
      const results = {
        totalProcessed: 0,
        successfulProcessors: 0,
        errors: [],
        processorResults: {}
      };
      
      for (const processor of this.config.processors) {
        try {
          const processorResult = await processor.process(transactions);
          results.processorResults[processor.name] = processorResult;
          results.successfulProcessors++;
          results.totalProcessed += processorResult.processed || 0;
        } catch (error) {
          console.error(`❌ Processor ${processor.name} failed:`, error);
          results.errors.push({
            processor: processor.name,
            error: error.message
          });
        }
      }
      
      return results;
      
    } catch (error) {
      throw new Error(`Upload processing failed: ${error.message}`);
    }
  }

  parseFile(filePath) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
  }

  transformData(rawData, options = {}) {
    const transactions = [];
    const mappings = { ...this.config.columnMappings, ...options.columnMappings };
    
    console.log(`🗂️  Using column mappings:`, mappings);
    
    for (const [index, row] of rawData.entries()) {
      try {
        const transaction = this.transformRow(row, mappings, index);
        if (transaction && this.validateTransaction(transaction)) {
            console.log(` next transactions:`, transaction)
          transactions.push(transaction);
        }
      } catch (error) {
        console.warn(`⚠️  Row ${index + 1} skipped: ${error.message}`);
      }
    }
    
    return transactions;
  }

  validateTransaction(transaction) {
    const { validation } = this.config;
    
    if (validation.requireDate && !transaction.date) {
      throw new Error('Date is required');
    }
    
    if (validation.requireDescription && !transaction.description) {
      throw new Error('Description is required');
    }
    
    if (validation.requireAmount && transaction.amount === null) {
      throw new Error('Amount is required');
    }
    
    if (!validation.allowNegativeAmounts && transaction.amount < 0) {
      throw new Error('Negative amounts not allowed');
    }
    
    return true;
  }

  addProcessor(processor) {
    this.config.processors.push(processor);
  }

  removeProcessor(processorName) {
    this.config.processors = this.config.processors.filter(p => p.name !== processorName);
  }
}

module.exports = GenericExcelUploadService;
