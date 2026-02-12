/* ═══════════════════════════════════════════
   ZOHO BILL UPLOAD PORTAL — Frontend Logic
   ═══════════════════════════════════════════ */

const App = {
    // ── State ──
    state: {
        currentStage: 'upload',
        file: null,
        extractedData: null,
        lookupData: null,
        filePath: null,
        fileName: null,
    },

    // ── DOM Refs ──
    els: {},

    // ── Initialize ──
    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadLookupData();
    },

    cacheElements() {
        this.els = {
            // Stages
            uploadStage: document.getElementById('upload-stage'),
            processingStage: document.getElementById('processing-stage'),
            reviewStage: document.getElementById('review-stage'),
            uploadingStage: document.getElementById('uploading-stage'),
            successStage: document.getElementById('success-stage'),
            // Upload
            dropzone: document.getElementById('dropzone'),
            fileInput: document.getElementById('file-input'),
            browseLink: document.getElementById('browse-link'),
            filePreview: document.getElementById('file-preview'),
            previewImg: document.getElementById('preview-img'),
            pdfIcon: document.getElementById('pdf-icon'),
            previewName: document.getElementById('preview-name'),
            removeFile: document.getElementById('remove-file'),
            extractBtn: document.getElementById('extract-btn'),
            // Processing
            progressFill: document.getElementById('progress-fill'),
            processingText: document.getElementById('processing-text'),
            // Review Form
            reviewForm: document.getElementById('review-form'),
            vendorName: document.getElementById('vendor_name'),
            vendorId: document.getElementById('vendor_id'),
            vendorGstin: document.getElementById('vendor_gstin'),
            vendorDropdown: document.getElementById('vendor-dropdown'),
            invoiceNumber: document.getElementById('invoice_number'),
            invoiceDate: document.getElementById('invoice_date'),
            gstRate: document.getElementById('gst_rate'),
            subTotal: document.getElementById('sub_total'),
            taxAmount: document.getElementById('tax_amount'),
            totalAmount: document.getElementById('total_amount'),
            taxSelect: document.getElementById('tax_select'),
            accountSelect: document.getElementById('account_select'),
            paidThroughSelect: document.getElementById('paid_through_select'),
            notes: document.getElementById('notes'),
            reverseCharge: document.getElementById('reverse_charge'),
            backBtn: document.getElementById('back-btn'),
            confirmBtn: document.getElementById('confirm-btn'),
            // Success
            successBillNumber: document.getElementById('success-bill-number'),
            successVendor: document.getElementById('success-vendor'),
            successTotal: document.getElementById('success-total'),
            uploadAnotherBtn: document.getElementById('upload-another-btn'),
            // Steps
            step1: document.getElementById('step-1'),
            step2: document.getElementById('step-2'),
            step3: document.getElementById('step-3'),
            line1: document.getElementById('line-1'),
            line2: document.getElementById('line-2'),
            // Toast
            toast: document.getElementById('toast'),
            toastMessage: document.getElementById('toast-message'),
        };
    },

    bindEvents() {
        const { dropzone, fileInput, browseLink, removeFile, extractBtn, reviewForm, backBtn, uploadAnotherBtn, vendorName } = this.els;

        // Drag and drop
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('drag-over');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) this.handleFileSelect(e.dataTransfer.files[0]);
        });
        dropzone.addEventListener('click', () => fileInput.click());
        browseLink.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.handleFileSelect(e.target.files[0]);
        });

        // File management
        removeFile.addEventListener('click', () => this.removeFile());
        extractBtn.addEventListener('click', () => this.uploadAndExtract());

        // Review form
        reviewForm.addEventListener('submit', (e) => { e.preventDefault(); this.confirmAndSubmit(); });
        backBtn.addEventListener('click', () => this.goToStage('upload'));

        // Vendor autocomplete
        vendorName.addEventListener('input', () => this.handleVendorInput());
        vendorName.addEventListener('focus', () => this.handleVendorInput());
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-wrapper')) {
                this.els.vendorDropdown.classList.remove('show');
            }
        });

        // Upload another
        uploadAnotherBtn.addEventListener('click', () => this.reset());
    },

    // ── File Handling ──
    handleFileSelect(file) {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowed.includes(file.type)) {
            this.showToast('Please upload a JPG, PNG, WebP, or PDF file.');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            this.showToast('File size must be under 15 MB.');
            return;
        }

        this.state.file = file;
        this.els.previewName.textContent = file.name;

        if (file.type === 'application/pdf') {
            this.els.previewImg.style.display = 'none';
            this.els.pdfIcon.style.display = 'flex';
        } else {
            this.els.pdfIcon.style.display = 'none';
            this.els.previewImg.style.display = 'block';
            const reader = new FileReader();
            reader.onload = (e) => { this.els.previewImg.src = e.target.result; };
            reader.readAsDataURL(file);
        }

        this.els.filePreview.style.display = 'flex';
        this.els.dropzone.style.display = 'none';
        this.els.extractBtn.disabled = false;
    },

    removeFile() {
        this.state.file = null;
        this.els.fileInput.value = '';
        this.els.filePreview.style.display = 'none';
        this.els.dropzone.style.display = 'block';
        this.els.extractBtn.disabled = true;
    },

    // ── Upload & Extract ──
    async uploadAndExtract() {
        if (!this.state.file) return;

        this.goToStage('processing');
        this.animateProgress();

        const formData = new FormData();
        formData.append('invoice', this.state.file);

        try {
            this.els.processingText.textContent = 'Uploading file...';
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to process invoice');
            }

            this.els.processingText.textContent = 'Data extracted! Loading review form...';
            this.els.progressFill.style.width = '100%';

            this.state.extractedData = result.data;
            this.state.filePath = result.data.file_path;
            this.state.fileName = result.data.file_name;

            // Short delay for the progress bar to complete
            await this.delay(600);
            this.populateReviewForm(result.data);
            this.goToStage('review');
        } catch (error) {
            console.error('Extract error:', error);
            this.showToast(error.message);
            this.goToStage('upload');
        }
    },

    animateProgress() {
        this.els.progressFill.style.width = '0%';
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 85) { clearInterval(interval); return; }
            this.els.progressFill.style.width = `${progress}%`;
            if (progress > 30) this.els.processingText.textContent = 'AI is reading your invoice...';
            if (progress > 60) this.els.processingText.textContent = 'Extracting line items and tax details...';
        }, 800);
        this._progressInterval = interval;
    },

    // ── Populate Review Form ──
    populateReviewForm(data) {
        this.els.vendorName.value = data.vendor_name || '';
        this.els.vendorGstin.value = data.vendor_gstin || '';
        this.els.invoiceNumber.value = data.invoice_number || '';
        this.els.invoiceDate.value = data.invoice_date || '';
        this.els.gstRate.value = data.gst_rate || '';
        this.els.subTotal.value = data.sub_total || '';
        this.els.taxAmount.value = data.tax_amount || '';
        this.els.totalAmount.value = data.total_amount || '';
        this.els.notes.value = data.notes || '';

        // Set GST type radio
        const gstRadios = document.querySelectorAll('input[name="gst_type"]');
        gstRadios.forEach((r) => {
            r.checked = r.value === (data.gst_type || 'intra_state');
        });

        // Set tax treatment radio
        const taxRadios = document.querySelectorAll('input[name="tax_treatment"]');
        taxRadios.forEach((r) => {
            r.checked = r.value === (data.tax_treatment || 'exclusive');
        });

        // Set reverse charge checkbox
        this.els.reverseCharge.checked = data.reverse_charge === true || data.reverse_charge === 'true';

        // Auto-match vendor from lookup data
        if (this.state.lookupData && data.vendor_name) {
            this.matchVendor(data.vendor_name);
        }

        // Auto-match tax
        if (this.state.lookupData && data.gst_rate) {
            this.matchTax(data.gst_rate, data.gst_type);
        }
    },

    // ── Vendor Autocomplete ──
    handleVendorInput() {
        const query = this.els.vendorName.value.trim().toLowerCase();
        if (!this.state.lookupData || query.length < 1) {
            this.els.vendorDropdown.classList.remove('show');
            return;
        }

        const vendors = this.state.lookupData.vendors.filter(
            (v) => v.contact_name.toLowerCase().includes(query)
        );

        if (vendors.length === 0) {
            this.els.vendorDropdown.classList.remove('show');
            return;
        }

        this.els.vendorDropdown.innerHTML = vendors
            .slice(0, 8)
            .map(
                (v) => `
        <div class="autocomplete-item" data-id="${v.contact_id}" data-name="${v.contact_name}">
          <div class="vendor-name">${v.contact_name}</div>
          ${v.gst_no ? `<div class="vendor-sub">GSTIN: ${v.gst_no}</div>` : ''}
        </div>
      `
            )
            .join('');

        this.els.vendorDropdown.querySelectorAll('.autocomplete-item').forEach((item) => {
            item.addEventListener('click', () => {
                this.els.vendorName.value = item.dataset.name;
                this.els.vendorId.value = item.dataset.id;
                this.els.vendorDropdown.classList.remove('show');
            });
        });

        this.els.vendorDropdown.classList.add('show');
    },

    matchVendor(name) {
        if (!this.state.lookupData) return;
        const vendors = this.state.lookupData.vendors;
        const normalName = name.toLowerCase().trim();

        // Try exact match
        let match = vendors.find(
            (v) => v.contact_name.toLowerCase().trim() === normalName
        );

        // Try partial match
        if (!match) {
            match = vendors.find(
                (v) =>
                    v.contact_name.toLowerCase().includes(normalName) ||
                    normalName.includes(v.contact_name.toLowerCase())
            );
        }

        if (match) {
            this.els.vendorId.value = match.contact_id;
            this.els.vendorName.value = match.contact_name;
        }
    },

    matchTax(rate, gstType) {
        if (!this.state.lookupData) return;
        const taxes = this.state.lookupData.taxes;
        const keywords = gstType === 'inter_state' ? ['igst'] : ['gst', 'cgst', 'sgst'];

        // Find matching tax
        let match = taxes.find((t) => {
            const name = t.tax_name.toLowerCase();
            return (
                Math.abs(t.tax_percentage - rate) < 0.01 &&
                keywords.some((kw) => name.includes(kw))
            );
        });

        if (!match) {
            match = taxes.find((t) => Math.abs(t.tax_percentage - rate) < 0.01);
        }

        if (match) {
            this.els.taxSelect.value = match.tax_id;
        }
    },

    // ── Confirm & Submit ──
    async confirmAndSubmit() {
        // Validate that vendor name is provided (backend will resolve vendor_id)
        if (!this.els.vendorName.value.trim()) {
            this.showToast('Please enter a vendor name.');
            this.els.vendorName.focus();
            return;
        }

        this.goToStage('uploading');

        const gstType = document.querySelector('input[name="gst_type"]:checked')?.value || 'intra_state';
        const taxTreatment = document.querySelector('input[name="tax_treatment"]:checked')?.value || 'exclusive';
        const reverseCharge = this.els.reverseCharge.checked;

        const payload = {
            vendor_name: this.els.vendorName.value,
            vendor_id: this.els.vendorId.value,
            vendor_gstin: this.els.vendorGstin.value,
            bill_number: this.els.invoiceNumber.value,
            invoice_date: this.els.invoiceDate.value,
            gst_type: gstType,
            tax_treatment: taxTreatment,
            gst_rate: parseFloat(this.els.gstRate.value) || 0,
            sub_total: parseFloat(this.els.subTotal.value) || 0,
            tax_amount: parseFloat(this.els.taxAmount.value) || 0,
            total_amount: parseFloat(this.els.totalAmount.value) || 0,
            account_id: this.els.accountSelect.value,
            tax_id: this.els.taxSelect.value,
            paid_through_account_id: this.els.paidThroughSelect.value,
            reverse_charge: reverseCharge,
            notes: this.els.notes.value,
            file_path: this.state.filePath,
            file_name: this.state.fileName,
        };

        try {
            const response = await fetch('/api/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to create expense');
            }

            // Show success
            this.els.successBillNumber.textContent = result.bill.bill_number;
            this.els.successVendor.textContent = result.bill.vendor_name;
            this.els.successTotal.textContent = `₹${(result.bill.total).toLocaleString('en-IN')}`;

            // Update success heading (via DOM manipulation or just leave as is if hardcoded)
            document.querySelector('#success-stage h2').textContent = 'Expense Created Successfully!';
            document.querySelectorAll('.detail-label')[0].textContent = 'Ref Number';

            this.goToStage('success');
        } catch (error) {
            console.error('Submit error:', error);
            this.showToast(error.message);
            this.goToStage('review');
        }
    },

    // ── Lookup Data ──
    async loadLookupData() {
        try {
            const response = await fetch('/api/lookup');
            const result = await response.json();

            if (result.success && result.data) {
                this.state.lookupData = result.data;
                this.populateDropdowns(result.data);
            }
        } catch (error) {
            console.error('Failed to load lookup data:', error);
        }
    },

    populateDropdowns(data) {
        // Tax dropdown
        this.els.taxSelect.innerHTML = '<option value="">Select tax...</option>';
        (data.taxes || []).forEach((t) => {
            const opt = document.createElement('option');
            opt.value = t.tax_id;
            opt.textContent = `${t.tax_name} (${t.tax_percentage}%)`;
            this.els.taxSelect.appendChild(opt);
        });

        // Expense account dropdown
        this.els.accountSelect.innerHTML = '<option value="">Select account...</option>';
        (data.expenseAccounts || []).forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.account_id;
            opt.textContent = a.account_name;
            this.els.accountSelect.appendChild(opt);

            // Auto-select "Cost of Goods" if found
            if (a.account_name.toLowerCase().includes('cost of goods')) {
                opt.selected = true;
            }
        });

        // Paid through dropdown
        this.els.paidThroughSelect.innerHTML = '<option value="">Select account...</option>';
        const paidThroughName = 'saubha aerial systems';
        (data.bankAccounts || []).forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.account_id;
            opt.textContent = a.account_name;
            this.els.paidThroughSelect.appendChild(opt);

            // Auto-select the default paid through account
            if (a.account_name.toLowerCase().includes(paidThroughName)) {
                opt.selected = true;
            }
        });
    },

    // ── Stage Management ──
    goToStage(stage) {
        // Hide all stages
        document.querySelectorAll('.stage').forEach((s) => s.classList.remove('active'));

        // Show target stage
        const stageEl = document.getElementById(`${stage}-stage`);
        if (stageEl) stageEl.classList.add('active');

        // Update step indicator
        this.updateStepIndicator(stage);
        this.state.currentStage = stage;
    },

    updateStepIndicator(stage) {
        const { step1, step2, step3, line1, line2 } = this.els;

        // Reset all
        [step1, step2, step3].forEach((s) => {
            s.classList.remove('active', 'completed');
        });
        [line1, line2].forEach((l) => l.classList.remove('active'));

        switch (stage) {
            case 'upload':
                step1.classList.add('active');
                break;
            case 'processing':
                step1.classList.add('completed');
                line1.classList.add('active');
                step2.classList.add('active');
                break;
            case 'review':
                step1.classList.add('completed');
                line1.classList.add('active');
                step2.classList.add('active');
                break;
            case 'uploading':
                step1.classList.add('completed');
                step2.classList.add('completed');
                line1.classList.add('active');
                line2.classList.add('active');
                step3.classList.add('active');
                break;
            case 'success':
                step1.classList.add('completed');
                step2.classList.add('completed');
                step3.classList.add('completed');
                line1.classList.add('active');
                line2.classList.add('active');
                break;
        }
    },

    // ── Reset ──
    reset() {
        this.state = {
            currentStage: 'upload',
            file: null,
            extractedData: null,
            lookupData: this.state.lookupData, // preserve lookup data
            filePath: null,
            fileName: null,
        };

        this.els.fileInput.value = '';
        this.els.filePreview.style.display = 'none';
        this.els.dropzone.style.display = 'block';
        this.els.extractBtn.disabled = true;
        this.els.progressFill.style.width = '0%';
        this.els.reviewForm.reset();

        // Re-populate dropdowns with auto-select
        if (this.state.lookupData) {
            this.populateDropdowns(this.state.lookupData);
        }

        this.goToStage('upload');
    },

    // ── Toast Notifications ──
    showToast(message) {
        this.els.toastMessage.textContent = message;
        this.els.toast.classList.add('show');
        if (this._toastTimeout) clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            this.els.toast.classList.remove('show');
        }, 5000);
    },

    // ── Utility ──
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },
};

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => App.init());
