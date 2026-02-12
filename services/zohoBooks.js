const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getAccessToken } = require('./zohoAuth');

const BASE_URL = 'https://www.zohoapis.in/books/v3';
const ORG_ID = process.env.ZOHO_ORG_ID;

/**
 * Make an authenticated request to Zoho Books API.
 */
async function zohoRequest(method, endpoint, data = null, params = {}) {
    const token = await getAccessToken();
    const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json',
        },
        params: { organization_id: ORG_ID, ...params },
    };

    if (data) {
        config.data = data;
    }

    const response = await axios(config);
    return response.data;
}

// ──────────────────────────────────────────
// VENDORS
// ──────────────────────────────────────────

async function searchVendors(name) {
    const result = await zohoRequest('GET', '/contacts', null, {
        contact_type: 'vendor',
        search_text: name,
    });
    return result.contacts || [];
}

async function getVendors() {
    const result = await zohoRequest('GET', '/contacts', null, {
        contact_type: 'vendor',
        per_page: 200,
    });
    return result.contacts || [];
}

/**
 * Create a new vendor in Zoho Books.
 */
async function createVendor(vendorName, gstNo = null, gstTreatment = null) {
    const payload = {
        contact_name: vendorName,
        contact_type: 'vendor',
    };

    if (gstNo) {
        payload.gst_no = gstNo;
        payload.gst_treatment = gstTreatment || 'business_gst';
    } else {
        payload.gst_treatment = 'business_none';
    }

    const result = await zohoRequest('POST', '/contacts', payload);
    console.log('🔍 Raw Zoho createVendor response code:', result.code);
    console.log('🔍 Raw Zoho createVendor response message:', result.message);
    if (result.code !== 0) {
        throw new Error(`Zoho API error: ${result.message} (code: ${result.code})`);
    }
    return result.contact || result;
}

/**
 * Update an existing vendor in Zoho Books.
 */
async function updateVendor(vendorId, updateData) {
    const result = await zohoRequest('PUT', `/contacts/${vendorId}`, updateData);
    console.log('🔍 Raw Zoho updateVendor response code:', result.code);
    console.log('🔍 Raw Zoho updateVendor response message:', result.message);
    if (result.code !== 0) {
        throw new Error(`Zoho API error: ${result.message} (code: ${result.code})`);
    }
    return result.contact || result;
}

// ──────────────────────────────────────────
// CHART OF ACCOUNTS
// ──────────────────────────────────────────

/**
 * Get ALL chart of accounts, then filter by type on our side.
 */
async function getAllAccounts() {
    const result = await zohoRequest('GET', '/chartofaccounts', null, {
        per_page: 200,
    });
    return result.chartofaccounts || [];
}

/**
 * Get expense accounts (filtered client-side).
 */
async function getExpenseAccounts() {
    const allAccounts = await getAllAccounts();
    return allAccounts.filter(
        (a) =>
            a.account_type === 'expense' ||
            a.account_type === 'cost_of_goods_sold' ||
            a.account_type === 'other_expense'
    );
}

/**
 * Get bank accounts (filtered client-side).
 */
async function getBankAccounts() {
    const allAccounts = await getAllAccounts();
    return allAccounts.filter(
        (a) => a.account_type === 'bank' || a.account_type === 'cash'
    );
}

// ──────────────────────────────────────────
// TAXES
// ──────────────────────────────────────────

async function getTaxes() {
    const result = await zohoRequest('GET', '/settings/taxes');
    return result.taxes || [];
}

async function findMatchingTax(gstRate, gstType) {
    const taxes = await getTaxes();
    const keywords =
        gstType === 'inter_state' ? ['igst'] : ['gst', 'cgst', 'sgst'];

    let match = taxes.find((t) => {
        const name = t.tax_name.toLowerCase();
        const rateMatch = Math.abs(t.tax_percentage - gstRate) < 0.01;
        return rateMatch && keywords.some((kw) => name.includes(kw));
    });

    if (match) return match;

    match = taxes.find(
        (t) => Math.abs(t.tax_percentage - gstRate) < 0.01
    );

    return match || null;
}

// ──────────────────────────────────────────
// PAID THROUGH ACCOUNT
// ──────────────────────────────────────────

async function findPaidThroughAccount() {
    const accountName = process.env.PAID_THROUGH_ACCOUNT_NAME;
    const accounts = await getBankAccounts();

    let match = accounts.find(
        (a) => a.account_name.toLowerCase() === accountName.toLowerCase()
    );

    if (!match) {
        match = accounts.find((a) =>
            a.account_name
                .toLowerCase()
                .includes(accountName.toLowerCase().split(' ')[0])
        );
    }

    return match || null;
}

// ──────────────────────────────────────────
// BILLS
// ──────────────────────────────────────────

async function createBill(billData) {
    const result = await zohoRequest('POST', '/bills', billData);
    console.log('🔍 Raw Zoho createBill response code:', result.code);
    console.log('🔍 Raw Zoho createBill response message:', result.message);
    if (result.code !== 0) {
        throw new Error(`Zoho API error: ${result.message} (code: ${result.code})`);
    }
    return result.bill || result;
}

async function attachFileToBill(billId, filePath, fileName) {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('attachment', fs.createReadStream(filePath), fileName);

    const response = await axios.post(
        `${BASE_URL}/bills/${billId}/attachment`,
        form,
        {
            headers: {
                ...form.getHeaders(),
                Authorization: `Zoho-oauthtoken ${token}`,
            },
            params: { organization_id: ORG_ID },
        }
    );

    return response.data;
}

// ──────────────────────────────────────────
// EXPENSES
// ──────────────────────────────────────────

async function createExpense(expenseData) {
    const result = await zohoRequest('POST', '/expenses', expenseData);
    console.log('🔍 Raw Zoho createExpense response code:', result.code);
    console.log('🔍 Raw Zoho createExpense response message:', result.message);
    if (result.code !== 0) {
        throw new Error(`Zoho API error: ${result.message} (code: ${result.code})`);
    }
    return result.expense || result;
}

async function attachFileToExpense(expenseId, filePath, fileName) {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('attachment', fs.createReadStream(filePath), fileName);

    const response = await axios.post(
        `${BASE_URL}/expenses/${expenseId}/attachment`,
        form,
        {
            headers: {
                ...form.getHeaders(),
                Authorization: `Zoho-oauthtoken ${token}`,
            },
            params: { organization_id: ORG_ID },
        }
    );

    return response.data;
}

// ──────────────────────────────────────────
// LOOKUP DATA (for frontend dropdowns)
// ──────────────────────────────────────────

async function getLookupData() {
    // Fetch all accounts once, then filter client-side
    const [vendors, taxes, allAccounts] = await Promise.all([
        getVendors(),
        getTaxes(),
        getAllAccounts(),
    ]);

    const expenseAccounts = allAccounts.filter(
        (a) =>
            a.account_type === 'expense' ||
            a.account_type === 'cost_of_goods_sold' ||
            a.account_type === 'other_expense'
    );

    const bankAccounts = allAccounts.filter(
        (a) => a.account_type === 'bank' || a.account_type === 'cash'
    );

    console.log(
        `📊 Lookup: ${vendors.length} vendors, ${taxes.length} taxes, ${expenseAccounts.length} expense accounts, ${bankAccounts.length} bank accounts`
    );

    return { vendors, taxes, expenseAccounts, bankAccounts };
}

module.exports = {
    searchVendors,
    getVendors,
    createVendor,
    updateVendor,
    getExpenseAccounts,
    getBankAccounts,
    getTaxes,
    findMatchingTax,
    findPaidThroughAccount,
    createBill,
    attachFileToBill,
    createExpense,
    attachFileToExpense,
    getLookupData,
};
