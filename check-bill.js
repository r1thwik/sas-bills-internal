require('dotenv').config();
const auth = require('./services/zohoAuth');
const axios = require('axios');

(async () => {
    try {
        const token = await auth.getAccessToken();
        const billId = '2490070000000078003';

        console.log(`Checking details for bill ${billId}...`);

        const resp = await axios.get(`https://www.zohoapis.in/books/v3/bills/${billId}`, {
            headers: { Authorization: 'Zoho-oauthtoken ' + token },
            params: { organization_id: process.env.ZOHO_ORG_ID },
        });

        const bill = resp.data.bill;
        console.log('Bill Number:', bill.bill_number);
        console.log('Status:', bill.status);
        console.log('Attachment Name:', bill.attachment_name);
        console.log('Original File:', bill.documents ? bill.documents.map(d => d.file_name) : 'None');

    } catch (e) {
        console.error('ERROR:', e.response?.data || e.message);
    }
})();
