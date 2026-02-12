const OpenAI = require('openai');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an expert Indian invoice data extraction AI. Analyze the provided invoice and extract all relevant billing information with precision.

CONTEXT:
- Our company (the buyer) is SAUBHA AERIAL SYSTEMS PRIVATE LIMITED, based in Karnataka, India.
- We need to determine GST type based on vendor location relative to Karnataka.

EXTRACTION RULES:
1. VENDOR: Extract the seller/supplier company name (NOT our company).
2. INVOICE NUMBER: The bill/invoice reference number.
3. INVOICE DATE: Date in YYYY-MM-DD format.
4. VENDOR STATE: The state where the vendor/supplier is located. Look for the vendor's address, GSTIN (first 2 digits indicate state), or any other clue.
5. GST DETERMINATION:
   - Vendor from Karnataka → "intra_state" (CGST + SGST apply)
   - Vendor from outside Karnataka → "inter_state" (IGST applies)
6. TAX TREATMENT — determine whether tax is INCLUSIVE or EXCLUSIVE:
   - "exclusive" = The line item prices are BEFORE tax. Tax is calculated separately and ADDED to the subtotal to get the total. (subtotal + tax = total)
   - "inclusive" = The line item prices ALREADY INCLUDE tax. The total shown is the final amount with tax baked in.
   - LOOK FOR: If tax amounts (CGST, SGST, IGST) are shown as separate line items added to a subtotal → EXCLUSIVE.
   - If the invoice says "inclusive of GST" or "tax included" → INCLUSIVE.
   - If unsure, check if subtotal + tax = total. If yes → EXCLUSIVE.
7. GST RATE — this MUST be the TOTAL/COMBINED GST percentage:
   - If CGST 9% + SGST 9% are shown → gst_rate = 18 (the combined total)
   - If IGST 18% is shown → gst_rate = 18
   - If CGST 2.5% + SGST 2.5% → gst_rate = 5
   - NEVER return just the individual CGST or SGST rate; always return the TOTAL GST rate.
8. AMOUNTS:
   - sub_total: Amount BEFORE any tax
   - tax_amount: Total tax amount (CGST + SGST combined, or IGST)
   - total_amount: Final payable amount
9. LINE ITEMS: ALL items with description, quantity, unit price, and line total.

Return ONLY a valid JSON object (no markdown, no backticks):
{
  "vendor_name": "string",
  "vendor_gstin": "GSTIN number if visible, or null",
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "vendor_state": "string",
  "is_registered": true if vendor has a GSTIN/is GST registered, false if unregistered,
  "reverse_charge": true if reverse charge applies (unregistered vendor or import of services), false otherwise,
  "gst_type": "inter_state" or "intra_state",
  "tax_treatment": "inclusive" or "exclusive",
  "sub_total": number,
  "tax_amount": number,
  "total_amount": number,
  "gst_rate": number,
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "rate": number,
      "amount": number
    }
  ]
}`;

/**
 * Parse an invoice image using OpenAI Vision.
 */
async function parseInvoiceImage(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Image = fileBuffer.toString('base64');

    const ext = filePath.toLowerCase().split('.').pop();
    const mimeMap = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`,
                            detail: 'high',
                        },
                    },
                    {
                        type: 'text',
                        text: 'Extract all invoice data from this image. Return ONLY valid JSON.',
                    },
                ],
            },
        ],
        max_tokens: 3000,
        temperature: 0,
    });

    return extractJSON(response.choices[0].message.content);
}

/**
 * Parse a PDF invoice — extract text, then use GPT-4o to structure it.
 */
async function parseInvoicePDF(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(fileBuffer);
    const extractedText = pdfData.text;

    if (!extractedText || extractedText.trim().length < 20) {
        throw new Error(
            'This PDF appears to be a scanned image with no extractable text. Please upload an image (JPG/PNG) of the invoice instead.'
        );
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: `Here is the extracted text from an invoice PDF. Extract all invoice data and return ONLY valid JSON.\n\n--- INVOICE TEXT ---\n${extractedText}\n--- END ---`,
            },
        ],
        max_tokens: 3000,
        temperature: 0,
    });

    return extractJSON(response.choices[0].message.content);
}

/**
 * Main entry point — detect file type and route accordingly.
 */
async function parseInvoice(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();

    if (ext === 'pdf') {
        return await parseInvoicePDF(filePath);
    } else {
        return await parseInvoiceImage(filePath);
    }
}

/**
 * Extract JSON from GPT response (handles markdown fences).
 */
function extractJSON(text) {
    // Try direct parse first
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try extracting from markdown code block
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            return JSON.parse(match[1].trim());
        }
        // Try finding JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Failed to parse invoice data from AI response');
    }
}

module.exports = { parseInvoice };
