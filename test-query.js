require('dotenv').config();
const auth = require('./services/zohoAuth');
const axios = require('axios');
const fs = require('fs');

(async () => {
    try {
        console.log('Authenticating...');
        const token = await auth.getAccessToken();
        console.log('Token obtained.');

        const orgId = process.env.ZOHO_ORG_ID;
        console.log('Querying bills for Org ID:', orgId);

        const resp = await axios.get('https://www.zohoapis.in/books/v3/expenses', {
            headers: { Authorization: 'Zoho-oauthtoken ' + token },
            params: {
                organization_id: orgId,
                per_page: 10,
                sort_column: 'date',
                sort_order: 'D',
            },
        });

        const bills = resp.data.expenses || [];
        console.log(`Found ${bills.length} recent bills.`);

        const output = {
            org_id: orgId,
            timestamp: new Date().toISOString(),
            bill_count: bills.length,
            bills: bills.map(b => ({
                id: b.bill_id,
                number: b.bill_number,
                vendor: b.vendor_name,
                total: b.total,
                status: b.status,
                date: b.date,
                created_time: b.created_time
            }))
        };

        fs.writeFileSync('debug_bills.json', JSON.stringify(output, null, 2));
        console.log('Dumped bill list to debug_bills.json');

    } catch (e) {
        console.error('ERROR:', e.response?.data || e.message);
    }
})();
