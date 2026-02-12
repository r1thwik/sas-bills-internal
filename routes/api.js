const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseInvoice } = require('../services/invoiceParser');
const zoho = require('../services/zohoBooks');

const router = express.Router();

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not supported. Use JPG, PNG, WebP, or PDF.`));
        }
    },
});

// ──────────────────────────────────────────
// POST /api/upload — Upload file & extract data
// ──────────────────────────────────────────
router.post('/upload', upload.single('invoice'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`📄 Processing: ${req.file.originalname}`);

        // Parse invoice with AI
        const extractedData = await parseInvoice(req.file.path);

        // Format line items as notes text
        let notesText = '';
        if (extractedData.line_items && extractedData.line_items.length > 0) {
            notesText = 'Line Items:\n';
            extractedData.line_items.forEach((item, i) => {
                notesText += `${i + 1}. ${item.description}`;
                if (item.quantity) notesText += ` — Qty: ${item.quantity}`;
                if (item.rate) notesText += ` × ₹${item.rate}`;
                if (item.amount) notesText += ` = ₹${item.amount}`;
                notesText += '\n';
            });
        }

        console.log('✅ Invoice parsed successfully');

        res.json({
            success: true,
            data: {
                ...extractedData,
                notes: notesText,
                file_path: req.file.path,
                file_name: req.file.originalname,
            },
        });
    } catch (error) {
        console.error('❌ Upload/parse error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ──────────────────────────────────────────
// POST /api/confirm — Create bill in Zoho
// ──────────────────────────────────────────
router.post('/confirm', async (req, res) => {
    console.log('\n════════════════════════════════════════');
    console.log('📥 /api/confirm HIT at', new Date().toISOString());
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    console.log('════════════════════════════════════════\n');
    try {
        const {
            vendor_name,
            vendor_id,
            vendor_gstin,
            bill_number,
            invoice_date,
            due_date,
            gst_type,
            tax_treatment,
            gst_rate,
            sub_total,
            tax_amount,
            total_amount,
            account_id,
            tax_id,
            paid_through_account_id,
            reverse_charge,
            notes,
            file_path,
            file_name,
        } = req.body;

        console.log(`📤 Creating bill: ${bill_number} for ${vendor_name}`);

        // ── Resolve vendor_id: search or create ──
        let resolvedVendorId = vendor_id;

        if (!resolvedVendorId && vendor_name) {
            console.log(`🔍 Searching for vendor: "${vendor_name}"...`);
            const vendors = await zoho.searchVendors(vendor_name);

            // Try exact match first, then partial
            let match = vendors.find(
                (v) => v.contact_name.toLowerCase().trim() === vendor_name.toLowerCase().trim()
            );
            if (!match) {
                match = vendors.find(
                    (v) =>
                        v.contact_name.toLowerCase().includes(vendor_name.toLowerCase()) ||
                        vendor_name.toLowerCase().includes(v.contact_name.toLowerCase())
                );
            }

            if (match) {
                resolvedVendorId = match.contact_id;
                console.log(`✅ Found vendor: ${match.contact_name} (${match.contact_id})`);

                // If user provided a GSTIN, ensure the existing vendor has it updated
                if (vendor_gstin && vendor_gstin.length > 5) {
                    console.log(`🔄 Updating vendor ${resolvedVendorId} with GSTIN: ${vendor_gstin}...`);
                    try {
                        const updateResult = await zoho.updateVendor(resolvedVendorId, {
                            gst_no: vendor_gstin,
                            gst_treatment: 'business_gst'
                        });
                        console.log(`✅ Vendor updated successfully. Code: ${updateResult.code}`);
                    } catch (updateErr) {
                        console.error(`❌ FAILED to update vendor GSTIN: ${updateErr.message}`);
                        // Don't swallow error — let the user know why
                        return res.status(400).json({
                            error: `Failed to update vendor GSTIN. Ensure '${vendor_gstin}' is valid. Zoho says: ${updateErr.message}`
                        });
                    }
                }
            } else {
                // Create new vendor
                console.log(`➕ Creating new vendor: "${vendor_name}"...`);
                // Determine GST treatment for the new vendor
                const newVendorGstTreatment = vendor_gstin ? 'business_gst' : 'business_none';
                const newVendor = await zoho.createVendor(vendor_name, vendor_gstin, newVendorGstTreatment);
                resolvedVendorId = newVendor.contact_id;
                console.log(`✅ Vendor created: ${newVendor.contact_id}`);
            }
        }

        if (!resolvedVendorId) {
            return res.status(400).json({ error: 'Could not resolve vendor. Please enter a vendor name.' });
        }

        // Determine request handler rate for the line item
        const isInclusive = tax_treatment === 'inclusive';
        const lineRate = isInclusive ? total_amount : sub_total;

        // Determine GST treatment — use Zoho's accepted enum values (for the Expense itself)
        const isReverseCharge = reverse_charge === true || reverse_charge === 'true';
        let gstTreatment;
        if (gst_type === 'inter_state' && isReverseCharge) {
            gstTreatment = 'overseas';
        } else if (isReverseCharge) {
            gstTreatment = 'business_none';
        } else if (vendor_gstin) {
            gstTreatment = 'business_gst';
        } else {
            gstTreatment = 'business_none';
        }

        // Build the expense payload
        const expensePayload = {
            account_id: account_id,
            paid_through_account_id: paid_through_account_id,
            date: invoice_date,
            amount: lineRate,
            tax_id: tax_id || undefined,
            is_inclusive_tax: isInclusive,
            reference_number: bill_number,
            vendor_id: resolvedVendorId,
            description: notes || `Expense for Invoice #${bill_number}`,
            gst_treatment: gstTreatment,
            is_reverse_charge_applied: isReverseCharge,
        };

        // Expenses API requires gst_no directly on the payload (unlike Bills)
        if (vendor_gstin && gstTreatment === 'business_gst') {
            expensePayload.gst_no = vendor_gstin;
        }

        // Create the expense
        console.log('📝 Expense payload:', JSON.stringify(expensePayload, null, 2));
        const expense = await zoho.createExpense(expensePayload);
        console.log('📦 Full Zoho response:', JSON.stringify(expense, null, 2));

        // Attach the original file
        if (file_path && fs.existsSync(file_path)) {
            try {
                await zoho.attachFileToExpense(expense.expense_id, file_path, file_name || 'invoice');
                console.log('📎 File attached to expense');
            } catch (attachErr) {
                console.error('⚠️ File attach warning:', attachErr.message);
            }

            // Clean up uploaded file
            try {
                fs.unlinkSync(file_path);
            } catch (e) { }
        }

        res.json({
            success: true,
            bill: {
                bill_id: expense.expense_id, // Keep key compatible with frontend
                bill_number: expense.reference_number || bill_number,
                vendor_name: expense.vendor_name,
                total: expense.total,
            },
        });
    } catch (error) {
        console.error('\n❌ ═══ BILL CREATION ERROR ═══');
        console.error('Error message:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', JSON.stringify(error.response?.data, null, 2));
        console.error('Stack:', error.stack);
        console.error('═══════════════════════════\n');
        const errMsg = error.response?.data?.message || error.message;
        res.status(500).json({ error: errMsg });
    }
});

// ──────────────────────────────────────────
// GET /api/lookup — All lookup data
// ──────────────────────────────────────────
router.get('/lookup', async (req, res) => {
    try {
        const data = await zoho.getLookupData();
        res.json({ success: true, data });
    } catch (error) {
        console.error('❌ Lookup error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ──────────────────────────────────────────
// GET /api/vendors/search — Search vendors
// ──────────────────────────────────────────
router.get('/vendors/search', async (req, res) => {
    try {
        const { q } = req.query;
        const vendors = await zoho.searchVendors(q || '');
        res.json({ success: true, vendors });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

