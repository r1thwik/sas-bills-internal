const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get a valid Zoho access token, refreshing if needed.
 * Caches the token and refreshes 60 seconds before expiry.
 */
async function getAccessToken() {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    console.log('🔄 Refreshing Zoho access token...');

    try {
        const response = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token',
            },
        });

        if (response.data.error) {
            throw new Error(`Zoho auth error: ${response.data.error}`);
        }

        cachedToken = response.data.access_token;
        // Expire 60 seconds early to avoid edge cases
        tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

        console.log('✅ Zoho access token refreshed successfully');
        return cachedToken;
    } catch (error) {
        cachedToken = null;
        tokenExpiry = null;
        throw new Error(`Failed to refresh Zoho token: ${error.message}`);
    }
}

module.exports = { getAccessToken };
