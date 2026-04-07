import { jsPDF } from 'jspdf';

/**
 * PDF Generator for Document Requests
 * Fixes the "Juan Dela Cruz" bug and adds visual branding (Green Banner/Watermark)
 */
export const generateDocumentPDF = (data: any, officials: any[]) => {
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    const marginX = 25.4; 
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let currentY = 20;

    // --- 1. WATERMARK SEAL (Faint Background) ---
    // Note: To use real images, you'd convert them to Base64 first. 
    // Here we use a placeholder or a very light gray circle to mimic the seal.
    doc.setDrawColor(240);
    doc.setLineWidth(1);
    doc.circle(pageWidth / 2, pageHeight / 2, 70, 'S'); 

    // --- 2. THE GREEN HEADER BANNER ---
    doc.setFillColor(93, 138, 51); // Your Engineer's Hill Green (#5D8A33)
    doc.rect(marginX + 25, 15, pageWidth - (marginX * 2) - 50, 22, 'F');

    // Header Text (Inside the Green Banner)
    doc.setTextColor(255, 255, 255);
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.text("REPUBLIC OF THE PHILIPPINES", pageWidth / 2, 21, { align: "center" });
    doc.text("CITY OF BAGUIO", pageWidth / 2, 25, { align: "center" });
    
    doc.setFont("times", "italic");
    doc.setFontSize(14);
    doc.text("ENGINEER'S HILL BARANGAY", pageWidth / 2, 32, { align: "center" });

    // --- 3. LOGOS (Placeholders for addImage) ---
    doc.setTextColor(0, 0, 0); // Reset to black
    // If you have base64 strings: doc.addImage(brgyBase64, 'PNG', marginX, 15, 22, 22);
    doc.rect(marginX, 15, 22, 22); 
    doc.rect(pageWidth - marginX - 22, 15, 22, 22);

    currentY = 45;

    // --- 4. DOCUMENT TITLE ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(data.type.toUpperCase(), pageWidth / 2, currentY, { align: "center" });
    doc.setLineWidth(0.8);
    doc.line((pageWidth / 2) - 45, currentY + 2, (pageWidth / 2) + 45, currentY + 2);
    currentY += 25;

    // --- 5. BODY CONTENT ---
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    
    const dateIssued = new Date(data.dateIssued || new Date()).toLocaleDateString('en-US', { 
        year: 'numeric', month: 'long', day: 'numeric' 
    });
    const residentName = data.residentName.toUpperCase();
    const purpose = data.purpose.toUpperCase();

    let bodyText = `TO WHOM IT MAY CONCERN:\n\n`;

    if (data.type === 'Barangay Clearance') {
        bodyText += `This is to CERTIFY that ${residentName}, Filipino Citizen, of legal age, is a bona fide resident of Barangay Engineer's Hill, Baguio City.\n\n` +
                    `Certifying further that based on available records of this Barangay, there is no derogatory record nor has there been pending or criminal case filed against the above-named person as of this date.\n\n` +
                    `This clearance is being issued upon the request of the above-named person for ${purpose} purposes.\n\n` +
                    `Issued this ${dateIssued} at Engineer's Hill Barangay, Baguio City.`;
    } else {
        bodyText += `This is to certify that ${residentName} is a resident of this Barangay. This certification is issued for the purpose of ${purpose}.\n\n` +
                    `Issued this ${dateIssued}.`;
    }

    const splitBody = doc.splitTextToSize(bodyText, pageWidth - (marginX * 2));
    doc.text(splitBody, marginX, currentY, { align: "justify", lineHeightFactor: 1.5 });

    // --- 6. SIGNATURE LOGIC (FIXED) ---
    // Search for Captain/Punong Barangay to avoid hardcoded Juan Dela Cruz
    const captain = (officials || []).find(o => 
        o.position.toLowerCase().includes('captain') || 
        o.position.toLowerCase().includes('punong')
    );
    
    const officialName = captain?.full_name || 'AMADO M. FELIZARDO';
    const officialPos = captain?.position || 'Punong Barangay';

    currentY = pageHeight - 65; 
    const signX = pageWidth - marginX - 70;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(officialName.toUpperCase(), signX + 35, currentY, { align: "center" });
    doc.line(signX, currentY + 1, pageWidth - marginX, currentY + 1); 
    
    currentY += 6;
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.text(officialPos, signX + 35, currentY, { align: "center" });

    // --- 7. FOOTER METADATA ---
    currentY = pageHeight - 35;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`CTC NO: ${data.cedulaNumber || '________________'}`, marginX, currentY);
    doc.text(`Fees Paid: ${Number(data.price).toFixed(2)}`, pageWidth - marginX, currentY, { align: "right" });
    
    currentY += 6;
    doc.text(`Issued At: Engineer's Hill, Baguio`, marginX, currentY);
    doc.text(`O.R. No: ${data.orNumber || '________________'}`, pageWidth - marginX, currentY, { align: "right" });
    
    currentY += 6;
    doc.setFontSize(8);
    doc.text(`Doc Ref: ${data.referenceNo}`, marginX, currentY);

    // --- 8. SAVE ---
    doc.save(`${data.type.replace(/\s+/g, '_')}_${residentName}.pdf`);
};