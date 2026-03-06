const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { getAccessToken } = require('./zohoAuth');

const domain = process.env.ZOHO_DOMAIN || '.in';
const BASE_URL = `https://www.zohoapis${domain}/books/v3`;
const ORG_ID = process.env.ZOHO_ORG_ID;

async function zohoRequest(method, endpoint, data = null, params = {}) {
    const token = await getAccessToken();
    const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
        params: { organization_id: ORG_ID, ...params },
    };
    if (data) config.data = data;
    return (await axios(config)).data;
}

// ── Vendors ──

async function searchVendors(name) {
    const r = await zohoRequest('GET', '/contacts', null, { contact_type: 'vendor', search_text: name });
    return r.contacts || [];
}

async function getVendors() {
    const r = await zohoRequest('GET', '/contacts', null, { contact_type: 'vendor', per_page: 200 });
    return r.contacts || [];
}

async function createVendor(vendorName, gstNo = null, gstTreatment = null) {
    const payload = { contact_name: vendorName, contact_type: 'vendor' };
    if (gstNo) {
        payload.gst_no = gstNo;
        payload.gst_treatment = gstTreatment || 'business_gst';
    } else {
        payload.gst_treatment = 'business_none';
    }
    const r = await zohoRequest('POST', '/contacts', payload);
    if (r.code !== 0) throw new Error(`Zoho: ${r.message}`);
    return r.contact || r;
}

async function updateVendor(vendorId, updateData) {
    const r = await zohoRequest('PUT', `/contacts/${vendorId}`, updateData);
    if (r.code !== 0) throw new Error(`Zoho: ${r.message}`);
    return r.contact || r;
}

// ── Accounts ──

async function getAllAccounts() {
    const r = await zohoRequest('GET', '/chartofaccounts', null, { per_page: 200 });
    return r.chartofaccounts || [];
}

function filterExpenseAccounts(accounts) {
    return accounts.filter(a => ['expense', 'cost_of_goods_sold', 'other_expense'].includes(a.account_type));
}

function filterBankAccounts(accounts) {
    return accounts.filter(a => a.account_type === 'bank' || a.account_type === 'cash');
}

// ── Taxes ──

async function getTaxes() {
    const r = await zohoRequest('GET', '/settings/taxes');
    return r.taxes || [];
}

// ── Expenses ──

async function createExpense(expenseData) {
    const r = await zohoRequest('POST', '/expenses', expenseData);
    if (r.code !== 0) throw new Error(`Zoho: ${r.message}`);
    return r.expense || r;
}

async function attachFileToExpense(expenseId, filePath, fileName) {
    const token = await getAccessToken();
    const form = new FormData();
    form.append('attachment', fs.createReadStream(filePath), fileName);
    const r = await axios.post(`${BASE_URL}/expenses/${expenseId}/attachment`, form, {
        headers: { ...form.getHeaders(), Authorization: `Zoho-oauthtoken ${token}` },
        params: { organization_id: ORG_ID },
    });
    return r.data;
}

// ── Lookup (single call, filter client-side) ──

async function getLookupData() {
    const [vendors, taxes, allAccounts] = await Promise.all([getVendors(), getTaxes(), getAllAccounts()]);
    return {
        vendors,
        taxes,
        expenseAccounts: filterExpenseAccounts(allAccounts),
        bankAccounts: filterBankAccounts(allAccounts),
    };
}

module.exports = {
    searchVendors, getVendors, createVendor, updateVendor,
    getAllAccounts, getTaxes, createExpense, attachFileToExpense, getLookupData,
};
