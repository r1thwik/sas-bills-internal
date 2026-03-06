// Project Bills Labs — Frontend Logic
const App = {
    // New Queue State
    state: { currentStage: 'upload', lookupData: null, billsQueue: [], currentBillIndex: 0 },

    els: {},

    init() {
        // Cache all DOM refs
        const q = (s) => document.querySelector(s);
        this.els = {
            dropzone: q('#dropzone'), fileInput: q('#file-input'), filePreview: q('#file-preview'),
            previewThumb: q('#preview-thumb'), previewName: q('#preview-name'),
            removeFileBtn: q('#remove-file-btn'), extractBtn: q('#extract-btn'),
            progressFill: q('#progress-fill'), processingText: q('.processing-text'),
            vendorName: q('#vendor_name'), vendorId: q('#vendor_id'), vendorGstin: q('#vendor_gstin'),
            vendorDropdown: q('#vendor-dropdown'),
            billNumber: q('#bill_number'), invoiceDate: q('#invoice_date'),
            gstType: q('#gst_type'), taxTreatment: q('#tax_treatment'), gstRate: q('#gst_rate'),
            accountId: q('#account_id'), paidThrough: q('#paid_through_account_id'),
            lineItemsBody: q('#line-items-body'), addLineItemBtn: q('#add-line-item-btn'),
            subtotal: q('#subtotal'), taxTotal: q('#tax-total'), grandTotal: q('#grand-total'),
            invoiceTotal: q('#invoice_total'), totalsMismatch: q('#totals-mismatch'), mismatchDiff: q('#mismatch-diff'),
            backBtn: q('#back-btn'), confirmBtn: q('#confirm-btn'), skipBtn: q('#skip-btn'), newBillBtn: q('#new-bill-btn'),
            queueStatus: q('#queue-status'),
            successDetails: q('#success-details'),
            errorBar: q('#error-bar'), errorMsg: q('#error-msg'), errorDismiss: q('#error-dismiss'),
        };
        this.bindEvents();
        this.loadLookupData();
    },

    bindEvents() {
        const dz = this.els.dropzone;
        dz.addEventListener('click', () => this.els.fileInput.click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files.length) this.handleFiles(e.dataTransfer.files); });
        this.els.fileInput.addEventListener('change', (e) => { if (e.target.files.length) this.handleFiles(e.target.files); });
        this.els.removeFileBtn.addEventListener('click', () => this.removeFiles());
        this.els.extractBtn.addEventListener('click', () => { this.startProcessingQueue(); this.goToStage('processing'); this.showNextBill(); });
        this.els.backBtn.addEventListener('click', () => this.reset());
        this.els.confirmBtn.addEventListener('click', () => this.confirmAndSubmit());
        this.els.skipBtn.addEventListener('click', () => this.skipCurrentBill());
        this.els.newBillBtn.addEventListener('click', () => this.reset());
        this.els.addLineItemBtn.addEventListener('click', () => this.addLineItemRow());
        this.els.errorDismiss.addEventListener('click', () => this.hideError());
        this.els.taxTreatment.addEventListener('change', () => this.updateTotals());
        this.els.gstType.addEventListener('change', () => this.recalculateAllLineItemTaxes());
        if (this.els.invoiceTotal) this.els.invoiceTotal.addEventListener('input', () => this.updateTotals());
        this.els.vendorGstin.addEventListener('input', (e) => this.updateGstTypeFromGstin(e.target.value));

        // Vendor autocomplete
        let debounce;
        this.els.vendorName.addEventListener('input', () => {
            clearTimeout(debounce);
            const q = this.els.vendorName.value.trim();
            if (q.length < 2) { this.els.vendorDropdown.classList.remove('show'); return; }
            debounce = setTimeout(() => this.searchVendors(q), 300);
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-dropdown') && e.target !== this.els.vendorName) {
                this.els.vendorDropdown.classList.remove('show');
            }
        });

        // Test hook
        const testBtn = document.getElementById('test-upload-btn');
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
                testBtn.textContent = 'Loading...';
                try {
                    const files = await Promise.all([
                        fetch('/invoice-1.png').then(r => r.blob()).then(b => new File([b], 'invoice-1.png', { type: 'image/png' })),
                        fetch('/invoice-2.png').then(r => r.blob()).then(b => new File([b], 'invoice-2.png', { type: 'image/png' })),
                        fetch('/invoice-3.png').then(r => r.blob()).then(b => new File([b], 'invoice-3.png', { type: 'image/png' }))
                    ]);
                    this.handleFiles(files);
                    testBtn.textContent = 'Loaded 3';
                    setTimeout(() => testBtn.style.display = 'none', 1000);
                } catch (e) {
                    console.error('Test load failed', e);
                    testBtn.textContent = 'Fail';
                }
            });
        }
    },

    handleFiles(fileList) {
        const files = Array.from(fileList).filter(f => f.size <= 15 * 1024 * 1024);
        if (!files.length) return this.showError('No valid files selected or files too large.');

        this.state.billsQueue = files.map(file => ({
            id: Math.random().toString(36).substr(2, 9),
            file: file,
            status: 'pending', // pending, extracting, ready, done, skipped, error
            extractedData: null,
            errorMsg: null,
            zohoExpense: null
        }));
        this.state.currentBillIndex = 0;

        this.els.dropzone.style.display = 'none';
        this.els.filePreview.style.display = 'flex';
        this.els.previewName.textContent = `${files.length} invoice${files.length > 1 ? 's' : ''} queued`;
        this.els.extractBtn.disabled = false;

        const firstFile = files[0];
        if (firstFile.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => { this.els.previewThumb.innerHTML = `<img src="${e.target.result}">`; };
            reader.readAsDataURL(firstFile);
        } else {
            this.els.previewThumb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
        }
    },

    removeFiles() {
        this.state.billsQueue = [];
        this.els.fileInput.value = '';
        this.els.dropzone.style.display = '';
        this.els.filePreview.style.display = 'none';
        this.els.extractBtn.disabled = true;
    },

    // Runs continually in the background to pre-extract next bills automatically
    async startProcessingQueue() {
        for (let i = 0; i < this.state.billsQueue.length; i++) {
            const bill = this.state.billsQueue[i];
            if (bill.status !== 'pending') continue;

            bill.status = 'extracting';

            // Re-render UI if user is waiting on THIS EXACT bill
            if (i === this.state.currentBillIndex && this.state.currentStage === 'processing') {
                this.els.processingText.textContent = `Analyzing bill ${i + 1} of ${this.state.billsQueue.length} (${bill.file.name})…`;
                // Fake progress bar
                let w = 0;
                this.els.progressFill.style.width = '0%';
                bill._progressInterval = setInterval(() => {
                    w += Math.random() * 8;
                    if (w < 85) this.els.progressFill.style.width = w + '%';
                }, 600);
            }

            try {
                const form = new FormData();
                form.append('invoice', bill.file);
                const res = await fetch('/api/upload', { method: 'POST', body: form });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Upload failed');

                bill.extractedData = json.data;
                bill.status = 'ready';
            } catch (err) {
                bill.errorMsg = err.message;
                bill.status = 'error';
            }

            // Cleanup fake progress bar if user was waiting on it
            if (bill._progressInterval) {
                clearInterval(bill._progressInterval);
                this.els.progressFill.style.width = '100%';
            }

            // If the user's screen is blocked waiting on this newly resolved bill, push them to the review screen
            if (i === this.state.currentBillIndex && this.state.currentStage === 'processing') {
                setTimeout(() => this.showNextBill(), 400);
            }
        }
    },

    showNextBill() {
        const idx = this.state.currentBillIndex;

        // If all done, go to final success
        if (idx >= this.state.billsQueue.length) {
            this.showFinalSuccess();
            return;
        }

        const currentBill = this.state.billsQueue[idx];
        this.updateQueueStatusUI(); // Show "Bill X of Y" flag

        if (currentBill.status === 'pending' || currentBill.status === 'extracting') {
            this.goToStage('processing');
        } else if (currentBill.status === 'ready') {
            this.populateReview(currentBill);
        } else if (currentBill.status === 'error') {
            // Bill extraction failed, gracefully force them to skip
            this.showError(`Extraction failed for ${currentBill.file.name}: ${currentBill.errorMsg}`);
            this.state.currentBillIndex++;
            this.showNextBill();
        } else {
            // done or skipped
            this.state.currentBillIndex++;
            this.showNextBill();
        }
    },

    updateQueueStatusUI() {
        const total = this.state.billsQueue.length;
        this.els.queueStatus.textContent = total > 1 ? `Bill ${this.state.currentBillIndex + 1} of ${total}` : '';
        this.els.queueStatus.style.display = total > 1 ? 'block' : 'none';

        if (total > 1) {
            this.els.confirmBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg> Submit & Next`;
            this.els.skipBtn.style.display = 'inline-flex';
        } else {
            this.els.confirmBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg> Upload to Zoho`;
            this.els.skipBtn.style.display = 'none';
        }
    },

    skipCurrentBill() {
        const bill = this.state.billsQueue[this.state.currentBillIndex];
        if (bill) bill.status = 'skipped';
        this.state.currentBillIndex++;
        this.showNextBill();
    },

    populateReview(bill) {
        const data = bill.extractedData;
        this.els.vendorName.value = data.vendor_name || '';
        this.els.vendorId.value = '';
        this.els.vendorGstin.value = data.vendor_gstin || '';
        this.els.billNumber.value = data.invoice_number || '';
        this.els.invoiceDate.value = data.invoice_date || '';
        this.els.invoiceTotal.value = data.total_amount || '';
        this.els.gstType.value = data.gst_type || 'intra_state';

        // Line items
        this.els.lineItemsBody.innerHTML = '';
        const items = data.line_items || [];
        items.forEach(item => this.addLineItemRow(item));

        this.inferTaxTreatment(data);
        this.updateTotals();

        // Auto-match vendor
        if (data.vendor_name && this.state.lookupData?.vendors) {
            const nameLower = data.vendor_name.toLowerCase().trim();
            const exactMatch = this.state.lookupData.vendors.find(v => v.contact_name.toLowerCase().trim() === nameLower);
            const match = exactMatch || this.state.lookupData.vendors.find(v =>
                v.contact_name.toLowerCase().includes(nameLower) ||
                nameLower.includes(v.contact_name.toLowerCase())
            );

            if (match) {
                this.els.vendorId.value = match.contact_id;
                this.els.vendorName.value = match.contact_name; // Use exact name from Zoho

                if (exactMatch && exactMatch.gst_no) {
                    if (data.vendor_gstin && data.vendor_gstin !== exactMatch.gst_no) {
                        this.els.vendorGstin.value = exactMatch.gst_no; // Auto-apply Zoho's GSTIN
                        setTimeout(() => this.showError(`⚠ Exact vendor match: Applied Zoho's GSTIN (${exactMatch.gst_no}). Invoice read: ${data.vendor_gstin}`), 600);
                    } else {
                        this.els.vendorGstin.value = exactMatch.gst_no;
                    }
                    this.updateGstTypeFromGstin(this.els.vendorGstin.value);
                } else if (!exactMatch && match.gst_no && !data.vendor_gstin) {
                    // Partial match, only use Zoho GSTIN if we didn't extract one
                    this.els.vendorGstin.value = match.gst_no;
                    this.updateGstTypeFromGstin(this.els.vendorGstin.value);
                } else if (data.vendor_gstin) {
                    // Partial match with extracted GSTIN intact
                    this.updateGstTypeFromGstin(data.vendor_gstin);
                }
            } else if (data.vendor_gstin) {
                this.updateGstTypeFromGstin(data.vendor_gstin);
            }
        } else if (data.vendor_gstin) {
            this.updateGstTypeFromGstin(data.vendor_gstin);
        }

        this.goToStage('review');
    },

    inferTaxTreatment(data) {
        const invoiceTotal = parseFloat(data.total_amount) || 0;
        if (invoiceTotal <= 0) {
            this.els.taxTreatment.value = data.tax_treatment || 'exclusive';
            return;
        }

        let sumAmounts = 0;
        let sumAmountsWithTax = 0;
        const items = data.line_items || [];

        items.forEach(item => {
            const amt = parseFloat(item.amount) || 0;
            const rate = parseFloat(item.gst_rate) || 0;
            sumAmounts += amt;
            sumAmountsWithTax += amt + (amt * rate / 100);
        });

        const diffInclusive = Math.abs(sumAmounts - invoiceTotal);
        const diffExclusive = Math.abs(sumAmountsWithTax - invoiceTotal);

        if (diffInclusive < diffExclusive && diffInclusive < 10) {
            this.els.taxTreatment.value = 'inclusive';
        } else {
            this.els.taxTreatment.value = 'exclusive';
        }
    },

    addLineItemRow(item = {}) {
        const taxes = this.state.lookupData?.taxes || [];
        const tr = document.createElement('tr');
        const gstRate = parseFloat(item.gst_rate) || 0;

        // Find matching tax
        const gstType = this.els.gstType?.value || 'intra_state';
        const keywords = gstType === 'inter_state' ? ['igst'] : ['gst', 'cgst', 'sgst'];
        let matchedTaxId = '';
        let matchedTax = taxes.find(t => Math.abs(t.tax_percentage - gstRate) < 0.01 && keywords.some(k => t.tax_name.toLowerCase().includes(k)));
        if (!matchedTax) matchedTax = taxes.find(t => Math.abs(t.tax_percentage - gstRate) < 0.01);
        if (matchedTax) matchedTaxId = matchedTax.tax_id;

        const taxOptions = taxes.map(t => `<option value="${t.tax_id}" ${t.tax_id === matchedTaxId ? 'selected' : ''}>${t.tax_name} (${t.tax_percentage}%)</option>`).join('');

        tr.innerHTML = `
      <td><input type="text" class="li-desc" value="${this.esc(item.description || '')}"></td>
      <td><input type="number" class="li-amount" step="0.01" value="${(Math.round((parseFloat(item.amount) || 0) * 100) / 100)}"></td>
      <td><input type="number" class="li-gst" step="0.01" value="${gstRate}" readonly></td>
      <td><select class="li-tax"><option value="">No Tax</option>${taxOptions}</select></td>
      <td><button type="button" class="btn-remove-row">✕</button></td>`;

        // Events
        tr.querySelector('.li-amount').addEventListener('input', () => this.updateTotals());
        tr.querySelector('.li-tax').addEventListener('change', (e) => {
            const sel = taxes.find(t => t.tax_id === e.target.value);
            tr.querySelector('.li-gst').value = sel ? sel.tax_percentage : 0;
            this.updateTotals();
        });
        tr.querySelector('.btn-remove-row').addEventListener('click', () => { tr.remove(); this.updateTotals(); });

        this.els.lineItemsBody.appendChild(tr);
        this.updateGstRateDisplay();
    },

    recalculateAllLineItemTaxes() {
        const taxes = this.state.lookupData?.taxes || [];
        const gstType = this.els.gstType?.value || 'intra_state';
        const keywords = gstType === 'inter_state' ? ['igst'] : ['gst', 'cgst', 'sgst'];

        this.els.lineItemsBody.querySelectorAll('tr').forEach(tr => {
            const gstRate = parseFloat(tr.querySelector('.li-gst').value) || 0;
            if (gstRate === 0) {
                tr.querySelector('.li-tax').value = '';
                return;
            }

            // 1. Find exact match for the rate + keywords (e.g. 18% + IGST)
            let matchedTax = taxes.find(t =>
                Math.abs(t.tax_percentage - gstRate) < 0.01 &&
                keywords.some(k => t.tax_name.toLowerCase().includes(k))
            );

            // 2. If no exact keyword match, find any tax with the exact same rate (needed because 'IGST9' doesn't exist, it's IGST18)
            if (!matchedTax) {
                matchedTax = taxes.find(t => Math.abs(t.tax_percentage - gstRate) < 0.01);
            }

            if (matchedTax) {
                tr.querySelector('.li-tax').value = matchedTax.tax_id;
                // Important: Update the hidden generic gst rate to match the grouped tax (e.g. 9+9=18 -> 18% IGST)
                tr.querySelector('.li-gst').value = matchedTax.tax_percentage;
            }
        });
        this.updateTotals();
    },

    updateGstTypeFromGstin(gstin) {
        if (!gstin || gstin.length < 2) return;
        const code = this.state.lookupData?.companyStateCode || '29';
        const newType = gstin.startsWith(code) ? 'intra_state' : 'inter_state';
        if (this.els.gstType.value !== newType) {
            this.els.gstType.value = newType;
            this.recalculateAllLineItemTaxes();
        }
    },

    collectLineItems() {
        return [...this.els.lineItemsBody.querySelectorAll('tr')].map(tr => ({
            description: tr.querySelector('.li-desc').value,
            amount: parseFloat(tr.querySelector('.li-amount').value) || 0,
            gst_rate: parseFloat(tr.querySelector('.li-gst').value) || 0,
            tax_id: tr.querySelector('.li-tax').value,
        }));
    },

    updateTotals() {
        const items = this.collectLineItems();
        const isInclusive = this.els.taxTreatment.value === 'inclusive';
        let subtotal = 0, taxAmt = 0;

        items.forEach(i => {
            const amt = Math.round(i.amount * 100) / 100;
            const rate = i.gst_rate / 100;
            if (isInclusive) {
                const base = Math.round((amt / (1 + rate)) * 100) / 100;
                subtotal += base;
                taxAmt += Math.round((amt - base) * 100) / 100;
            } else {
                subtotal += amt;
                taxAmt += Math.round((amt * rate) * 100) / 100;
            }
        });

        this.els.subtotal.textContent = `₹${subtotal.toFixed(2)}`;
        this.els.taxTotal.textContent = `₹${taxAmt.toFixed(2)}`;
        const grandTotal = subtotal + taxAmt;
        this.els.grandTotal.textContent = `₹${grandTotal.toFixed(2)}`;
        this.updateGstRateDisplay();

        const invoiceTotal = parseFloat(this.els.invoiceTotal.value);
        if (!isNaN(invoiceTotal) && invoiceTotal > 0) {
            const diff = grandTotal - invoiceTotal;
            if (Math.abs(diff) > 1) { // 1 rupee tolerance
                this.els.totalsMismatch.style.display = 'flex';
                this.els.mismatchDiff.textContent = `(₹${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'over' : 'under'})`;
            } else {
                this.els.totalsMismatch.style.display = 'none';
            }
        } else {
            this.els.totalsMismatch.style.display = 'none';
        }
    },

    updateGstRateDisplay() {
        const rates = [...new Set(this.collectLineItems().map(i => i.gst_rate).filter(r => r > 0))];
        this.els.gstRate.value = rates.length ? rates.map(r => r + '%').join(', ') : 'N/A';
    },

    async confirmAndSubmit() {
        const lineItems = this.collectLineItems().filter(i => i.amount > 0);
        if (!lineItems.length) return this.showError('No valid line items.');
        if (!this.els.vendorName.value.trim()) return this.showError('Vendor name is required.');
        if (!this.els.accountId.value) return this.showError('Select an expense account.');

        // Verify GSTIN matches Zoho vendor data if known (just warn, don't block)
        const vName = this.els.vendorName.value.trim().toLowerCase();
        const vGstin = this.els.vendorGstin.value.trim();
        if (this.state.lookupData?.vendors) {
            const vMatch = this.state.lookupData.vendors.find(v =>
                v.contact_id === this.els.vendorId.value ||
                v.contact_name.toLowerCase().trim() === vName
            );
            if (vMatch && vMatch.gst_no && vGstin && vMatch.gst_no !== vGstin) {
                this.showError(`⚠ Using GSTIN ${vGstin}. Zoho vendor has ${vMatch.gst_no}.`);
            }
        }

        this.els.confirmBtn.disabled = true;
        this.els.confirmBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="rocket-loader" style="margin:0; animation: rocketHover 1s infinite alternate">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
            </svg> Uploading…`;

        try {
            const currentBill = this.state.billsQueue[this.state.currentBillIndex];

            const payload = {
                vendor_name: this.els.vendorName.value.trim(),
                vendor_id: this.els.vendorId.value || null,
                vendor_gstin: this.els.vendorGstin.value.trim() || null,
                bill_number: this.els.billNumber.value.trim(),
                invoice_date: this.els.invoiceDate.value,
                gst_type: this.els.gstType.value,
                tax_treatment: this.els.taxTreatment.value,
                account_id: this.els.accountId.value,
                paid_through_account_id: this.els.paidThrough.value || null,
                reverse_charge: document.querySelector('input[name="reverse_charge"]:checked')?.value === 'true',
                line_items: lineItems,
                file_path: currentBill.extractedData.file_path,
                file_name: currentBill.extractedData.file_name,
            };

            const res = await fetch('/api/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Submission failed');

            // Success handling for queue
            currentBill.status = 'done';
            currentBill.zohoExpense = json.expense;

            this.els.confirmBtn.disabled = false;
            this.state.currentBillIndex++;
            this.showNextBill(); // Moves to the next one!

        } catch (err) {
            this.showError(err.message);
            this.els.confirmBtn.disabled = false;
            this.updateQueueStatusUI(); // Restores original innerHTML dynamically
        }
    },

    showFinalSuccess() {
        const successes = this.state.billsQueue.filter(b => b.status === 'done');
        const skips = this.state.billsQueue.filter(b => b.status === 'skipped');
        const errors = this.state.billsQueue.filter(b => b.status === 'error');

        this.els.successDetails.innerHTML = `
            <div class="detail-row"><span class="label">Total Processed</span><span class="value">${this.state.billsQueue.length}</span></div>
            <div class="detail-row"><span class="label" style="color:var(--success)">Successfully Uploaded</span><span class="value">${successes.length}</span></div>
            ${skips.length ? `<div class="detail-row"><span class="label" style="color:var(--text-muted)">Skipped</span><span class="value">${skips.length}</span></div>` : ''}
            ${errors.length ? `<div class="detail-row"><span class="label" style="color:var(--error)">Errors</span><span class="value">${errors.length}</span></div>` : ''}
        `;

        // Detailed list of successes
        if (successes.length) {
            this.els.successDetails.innerHTML += `
               <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border)">
                    <h4 style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem">Upload Summary</h4>
                    ${successes.map(b => `
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.3rem">
                            ${b.zohoExpense?.vendor_name || 'Vendor'} • ₹${parseFloat(b.zohoExpense?.total || 0).toFixed(2)}
                        </div>
                    `).join('')}
               </div>
            `;
        }

        this.goToStage('success');
    },

    async loadLookupData() {
        if (this.state.lookupData) return;
        try {
            const res = await fetch('/api/lookup');
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            this.state.lookupData = json.data;
            this.populateDropdowns(json.data);
        } catch (err) {
            this.showError('Lookup failed: ' + err.message);
        }
    },

    populateDropdowns(data) {
        this.els.accountId.innerHTML = '<option value="">Select account…</option>' +
            (data.expenseAccounts || []).map(a => {
                const sel = a.account_name.toLowerCase().includes('cost of goods sold') ? 'selected' : '';
                return `<option value="${a.account_id}" ${sel}>${a.account_name}</option>`;
            }).join('');

        const ptName = 'projectx labs';
        this.els.paidThrough.innerHTML = '<option value="">Select…</option>' +
            (data.bankAccounts || []).map(a => {
                const sel = a.account_name.toLowerCase().includes(ptName) ? 'selected' : '';
                return `<option value="${a.account_id}" ${sel}>${a.account_name}</option>`;
            }).join('');
    },

    async searchVendors(query) {
        try {
            const q = query.toLowerCase();
            let vendors = [];

            // Search cached vendors first (instant, sorted by relevance)
            if (this.state.lookupData?.vendors?.length) {
                const cached = this.state.lookupData.vendors;
                const exact = [], startsWith = [], contains = [];
                for (const v of cached) {
                    const name = v.contact_name.toLowerCase();
                    if (name === q) exact.push(v);
                    else if (name.startsWith(q)) startsWith.push(v);
                    else if (name.includes(q)) contains.push(v);
                }
                vendors = [...exact, ...startsWith, ...contains];
            }

            // Fall back to API if no cached matches
            if (!vendors.length) {
                const res = await fetch(`/api/vendors/search?q=${encodeURIComponent(query)}`);
                const json = await res.json();
                vendors = json.vendors || [];
            }

            if (!vendors.length) { this.els.vendorDropdown.classList.remove('show'); return; }

            this.els.vendorDropdown.innerHTML = vendors.slice(0, 8).map(v =>
                `<div class="autocomplete-item" data-id="${v.contact_id}" data-name="${this.esc(v.contact_name)}" data-gstin="${v.gst_no || ''}">
          <div class="vendor-name">${this.esc(v.contact_name)}</div>
          ${v.gst_no ? `<div class="vendor-sub">${v.gst_no}</div>` : ''}
        </div>`
            ).join('');
            this.els.vendorDropdown.querySelectorAll('.autocomplete-item').forEach(el => {
                el.addEventListener('click', () => {
                    this.els.vendorName.value = el.dataset.name;
                    this.els.vendorId.value = el.dataset.id;
                    const vGstin = el.dataset.gstin;
                    if (vGstin) {
                        const extGstin = this.state.extractedData?.vendor_gstin;
                        if (extGstin && extGstin !== vGstin) {
                            this.showError(`⚠ Applied Zoho's GSTIN (${vGstin}). Invoice read: ${extGstin}`);
                        }
                        this.els.vendorGstin.value = vGstin;
                        this.updateGstTypeFromGstin(vGstin);
                    }
                    this.els.vendorDropdown.classList.remove('show');
                });
            });
            this.els.vendorDropdown.classList.add('show');
        } catch { }
    },

    goToStage(stage) {
        this.state.currentStage = stage;
        document.querySelectorAll('.stage').forEach(s => s.classList.remove('active'));
        document.getElementById(`${stage}-stage`).classList.add('active');

        // Update indicators
        const steps = { upload: 1, processing: 1, review: 2, success: 3 };
        const current = steps[stage] || 1;
        for (let i = 1; i <= 3; i++) {
            const step = document.getElementById(`step-${i}`);
            step.classList.remove('active', 'completed');
            if (i < current) step.classList.add('completed');
            else if (i === current) step.classList.add('active');
        }
        for (let i = 1; i <= 2; i++) {
            document.getElementById(`line-${i}`).classList.toggle('active', i < current);
        }
    },

    showError(msg) {
        this.els.errorMsg.textContent = msg;
        this.els.errorBar.classList.add('show');
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 8000);
    },

    hideError() { this.els.errorBar.classList.remove('show'); },

    reset() {
        this.state = { currentStage: 'upload', file: null, extractedData: null, lookupData: this.state.lookupData, filePath: null, fileName: null, lineItems: [] };
        this.els.fileInput.value = '';
        this.els.dropzone.style.display = '';
        this.els.filePreview.style.display = 'none';
        this.els.extractBtn.disabled = true;
        this.els.vendorName.value = '';
        this.els.vendorId.value = '';
        this.els.vendorGstin.value = '';
        this.els.billNumber.value = '';
        this.els.invoiceDate.value = '';
        this.els.lineItemsBody.innerHTML = '';
        this.els.progressFill.style.width = '0%';
        this.els.confirmBtn.disabled = false;
        this.els.confirmBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Upload to Zoho';
        this.hideError();
        this.goToStage('upload');
    },

    esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
};

document.addEventListener('DOMContentLoaded', () => App.init());
