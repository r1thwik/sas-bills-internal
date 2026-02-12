require('dotenv').config();
const auth = require('./services/zohoAuth');
const axios = require('axios');
const fs = require('fs');

const out = [];
function log(msg) { console.log(msg); out.push(msg); }

(async () => {
    try {
        log('=== Zoho Diagnostics ===');
        const token = await auth.getAccessToken();
        const orgId = process.env.ZOHO_ORG_ID;
        log('Auth OK. Org: ' + orgId);

        // 1. Recent expenses
        log('\n--- Recent Expenses ---');
        const expResp = await axios.get('https://www.zohoapis.in/books/v3/expenses', {
            headers: { Authorization: 'Zoho-oauthtoken ' + token },
            params: { organization_id: orgId, per_page: 10, sort_column: 'created_time', sort_order: 'D' },
        });
        const expenses = expResp.data.expenses || [];
        log('Count: ' + expenses.length);
        expenses.forEach((e, i) => {
            log(`  ${i + 1}. ${e.date} | ${e.vendor_name || 'N/A'} | Rs${e.total} | Ref:${e.reference_number || 'N/A'} | ID:${e.expense_id} | Created:${e.created_time}`);
        });

        // 2. Recent bills
        log('\n--- Recent Bills ---');
        const billResp = await axios.get('https://www.zohoapis.in/books/v3/bills', {
            headers: { Authorization: 'Zoho-oauthtoken ' + token },
            params: { organization_id: orgId, per_page: 10, sort_column: 'created_time', sort_order: 'D' },
        });
        const bills = billResp.data.bills || [];
        log('Count: ' + bills.length);
        bills.forEach((b, i) => {
            log(`  ${i + 1}. ${b.date} | ${b.vendor_name} | Rs${b.total} | Bill#:${b.bill_number} | ID:${b.bill_id} | Created:${b.created_time}`);
        });

        // 3. Test expense create
        log('\n--- Test Expense Create ---');
        const acctResp = await axios.get('https://www.zohoapis.in/books/v3/chartofaccounts', {
            headers: { Authorization: 'Zoho-oauthtoken ' + token },
            params: { organization_id: orgId },
        });
        const expAcct = (acctResp.data.chartofaccounts || []).find(a => a.account_type === 'expense');

        if (expAcct) {
            log('Account: ' + expAcct.account_name + ' (' + expAcct.account_id + ')');
            const testPayload = {
                account_id: expAcct.account_id,
                date: '2026-02-12',
                amount: 1.00,
                description: 'DIAGNOSTIC TEST - DELETE ME',
                gst_treatment: 'business_none',
            };

            const createResp = await axios.post('https://www.zohoapis.in/books/v3/expenses', testPayload, {
                headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' },
                params: { organization_id: orgId },
            });

            log('Create response code: ' + createResp.data.code);
            log('Create response msg: ' + createResp.data.message);
            const expId = createResp.data.expense?.expense_id;
            log('Expense ID: ' + expId);

            if (expId) {
                await axios.delete(`https://www.zohoapis.in/books/v3/expenses/${expId}`, {
                    headers: { Authorization: 'Zoho-oauthtoken ' + token },
                    params: { organization_id: orgId },
                });
                log('Test expense deleted.');
            }
        }

        log('\n=== Done ===');
    } catch (e) {
        log('FATAL: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    }

    fs.writeFileSync('diagnose_output.txt', out.join('\n'));
    log('Output saved to diagnose_output.txt');
})();
