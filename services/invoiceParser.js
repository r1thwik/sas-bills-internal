const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You extract structured data from Indian invoices. Our company is SAUBHA AERIAL SYSTEMS PRIVATE LIMITED, Karnataka. Return ONLY valid JSON.

JSON schema:
{
  "vendor_name": "seller name (not our company)",
  "vendor_gstin": "GSTIN or null",
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "vendor_state": "state name",
  "gst_type": "inter_state if vendor outside Karnataka, else intra_state",
  "tax_treatment": "exclusive if tax added on top of subtotal, inclusive if prices include tax",
  "reverse_charge": false,
  "sub_total": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "line_items": [
    { "description": "exact text from invoice", "amount": 0, "gst_rate": 0 }
  ]
}

Rules:
- gst_rate per item = TOTAL GST (e.g. CGST 9% + SGST 9% = 18)
- Transcribe descriptions EXACTLY as printed. Do not guess or substitute product names.
- Every table row = one line_items entry. Do not skip or merge rows.`;

/** Parse image invoice via GPT-4o vision */
async function parseInvoiceImage(filePath) {
    const buf = fs.readFileSync(filePath);
    const ext = filePath.toLowerCase().split('.').pop();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'image/jpeg';

    const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'high' } },
                    { type: 'text', text: 'Extract invoice data. List every line item row — do not skip any.' },
                ],
            },
        ],
        max_tokens: 4096,
        temperature: 0,
    });

    const raw = res.choices[0].message.content;

    // Debug dump
    fs.writeFileSync(path.join(__dirname, '..', 'last_extraction.json'), JSON.stringify({ raw }, null, 2));
    console.log(`✅ Image parsed (${res.choices[0].finish_reason})`);

    return extractJSON(raw);
}

/** Parse PDF invoice — extract text first, then send to GPT */
async function parseInvoicePDF(filePath) {
    const buf = fs.readFileSync(filePath);
    const pdf = await pdfParse(buf);
    const text = pdf.text;

    if (!text || text.trim().length < 20) {
        throw new Error('PDF has no extractable text. Upload an image (JPG/PNG) instead.');
    }

    const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Extract invoice data from this text:\n\n${text}` },
        ],
        max_tokens: 4096,
        temperature: 0,
    });

    console.log('✅ PDF parsed');
    return extractJSON(res.choices[0].message.content);
}

/** Route to correct parser based on file type */
async function parseInvoice(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return parseInvoicePDF(filePath);
    return parseInvoiceImage(filePath);
}

/** Extract JSON from GPT response (strips markdown fences) */
function extractJSON(text) {
    let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    try { return JSON.parse(cleaned); } catch { }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
        try { return JSON.parse(match[0]); } catch { }
    }
    throw new Error('Could not parse AI response as JSON');
}

module.exports = { parseInvoice };
