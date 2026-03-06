const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseInvoice } = require('../services/invoiceParser');
const zoho = require('../services/zohoBooks');

const router = express.Router();

// ── Multer ──
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
        allowed.includes(path.extname(file.originalname).toLowerCase())
            ? cb(null, true)
            : cb(new Error('File type not supported. Use JPG, PNG, WebP, or PDF.'));
    },
});

// ── Upload & Extract ──
router.post('/upload', upload.single('invoice'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const data = await parseInvoice(req.file.path);
        res.json({ success: true, data: { ...data, file_path: req.file.path, file_name: req.file.originalname } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Confirm & Create Expense ──
router.post('/confirm', async (req, res) => {
    try {
        const { vendor_name, vendor_id, vendor_gstin, bill_number, invoice_date,
            gst_type, tax_treatment, account_id, paid_through_account_id,
            reverse_charge, line_items, file_path, file_name } = req.body;

        if (!line_items?.length) return res.status(400).json({ error: 'No line items provided.' });

        // Resolve vendor
        let resolvedVendorId = vendor_id;
        if (!resolvedVendorId && vendor_name) {
            const vendors = await zoho.searchVendors(vendor_name);
            const nameLower = vendor_name.toLowerCase().trim();
            let match = vendors.find(v => v.contact_name.toLowerCase().trim() === nameLower)
                || vendors.find(v => v.contact_name.toLowerCase().includes(nameLower) || nameLower.includes(v.contact_name.toLowerCase()));

            if (match) {
                resolvedVendorId = match.contact_id;

                if (!match.gst_no && vendor_gstin?.length > 5) {
                    try { await zoho.updateVendor(resolvedVendorId, { gst_no: vendor_gstin, gst_treatment: 'business_gst' }); }
                    catch (e) { return res.status(400).json({ error: `Failed to update vendor GSTIN: ${e.message}` }); }
                }
            } else {
                const gstTreat = vendor_gstin ? 'business_gst' : 'business_none';
                const newVendor = await zoho.createVendor(vendor_name, vendor_gstin, gstTreat);
                resolvedVendorId = newVendor.contact_id;
            }
        }
        if (!resolvedVendorId) return res.status(400).json({ error: 'Could not resolve vendor.' });

        // GST treatment
        const isReverseCharge = reverse_charge === true || reverse_charge === 'true';
        let gstTreatment = vendor_gstin ? 'business_gst' : 'business_none';
        if (isReverseCharge) gstTreatment = gst_type === 'inter_state' ? 'overseas' : 'business_none';

        // Build line items
        const expenseLineItems = [];
        for (let i = 0; i < line_items.length; i++) {
            const item = line_items[i];
            const amount = Math.round((parseFloat(item.amount) || 0) * 100) / 100;
            if (amount <= 0) continue;
            const payload = {
                account_id,
                description: (item.description || `Line item ${i + 1}`).substring(0, 100),
                amount,
                item_order: i + 1,
            };
            if (item.tax_id?.trim()) payload.tax_id = item.tax_id;
            expenseLineItems.push(payload);
        }
        if (!expenseLineItems.length) return res.status(400).json({ error: 'All line items had invalid amounts.' });

        // Create expense
        const expensePayload = {
            account_id,
            date: invoice_date,
            vendor_id: resolvedVendorId,
            reference_number: bill_number,
            line_items: expenseLineItems,
            is_inclusive_tax: tax_treatment === 'inclusive',
            gst_treatment: gstTreatment,
        };
        if (paid_through_account_id) expensePayload.paid_through_account_id = paid_through_account_id;
        if (vendor_gstin && gstTreatment === 'business_gst') expensePayload.gst_no = vendor_gstin;

        const created = await zoho.createExpense(expensePayload);

        // Attach file
        if (file_path && fs.existsSync(file_path)) {
            try { await zoho.attachFileToExpense(created.expense_id, file_path, file_name || 'invoice'); } catch { }
            try { fs.unlinkSync(file_path); } catch { }
        }

        res.json({
            success: true,
            expense: {
                expense_id: created.expense_id,
                reference_number: created.reference_number || bill_number,
                vendor_name: created.vendor_name || vendor_name,
                total: created.total,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.response?.data?.message || err.message });
    }
});

// ── Lookup Data ──
router.get('/lookup', async (req, res) => {
    try {
        const data = await zoho.getLookupData();
        data.companyStateCode = process.env.COMPANY_STATE_CODE || '29';
        res.json({ success: true, data });
    }
    catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Vendor Search ──
router.get('/vendors/search', async (req, res) => {
    try { res.json({ success: true, vendors: await zoho.searchVendors(req.query.q || '') }); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
