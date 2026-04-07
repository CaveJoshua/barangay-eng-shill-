import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * CAPTURE GENERATOR
 * Takes a snapshot of the HTML element with the given ID.
 */
export const generateBlotterPDF = async (elementId: string, data: any) => {
    // 1. Find the element
    const element = document.getElementById(elementId);
    if (!element) {
        alert(`Error: Could not find element with ID '${elementId}'. PDF failed.`);
        return;
    }

    try {
        // 2. Capture settings
        const canvas = await html2canvas(element, {
            scale: 2, // 2 is usually enough for A4, 3 is higher quality but slower
            useCORS: true, // Needed if you have external images
            backgroundColor: '#ffffff',
            logging: false,
        });

        // 3. Create PDF
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210; 
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        
        // 4. Download
        // Uses snake_case or camelCase fallback to ensure filename is never empty
        const filename = `BLOTTER_${data.case_number || data.caseNumber || 'REF'}.pdf`;
        pdf.save(filename);
        
    } catch (error) {
        console.error("PDF Generation Error:", error);
        alert("Failed to generate PDF. See console for details.");
    }
};