import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * CAPTURE GENERATOR
 * Takes a snapshot of the HTML element and splits it into multiple A4 pages.
 */
export const generateBlotterPDF = async (elementId: string, data: any) => {
    const element = document.getElementById(elementId);
    if (!element) {
        alert(`Error: Could not find element with ID '${elementId}'. PDF failed.`);
        return;
    }

    try {
        const canvas = await html2canvas(element, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });

        const pdf = new jsPDF('p', 'mm', 'a4');

        const pageWidthMM = 210;
        const pageHeightMM = 297;

        // Calculate how tall one A4 page is in canvas pixels
        const pageHeightPx = (canvas.width * pageHeightMM) / pageWidthMM;

        const totalPages = Math.ceil(canvas.height / pageHeightPx);

        for (let page = 0; page < totalPages; page++) {
            if (page > 0) pdf.addPage();

            // Slice the canvas for this page
            const sourceY = page * pageHeightPx;
            const sliceHeight = Math.min(pageHeightPx, canvas.height - sourceY);

            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sliceHeight;

            const ctx = pageCanvas.getContext('2d')!;
            ctx.drawImage(
                canvas,
                0, sourceY,           // source x, y
                canvas.width, sliceHeight, // source width, height
                0, 0,                 // dest x, y
                canvas.width, sliceHeight  // dest width, height
            );

            const pageImgData = pageCanvas.toDataURL('image/png');
            const renderedHeightMM = (sliceHeight * pageWidthMM) / canvas.width;

            pdf.addImage(pageImgData, 'PNG', 0, 0, pageWidthMM, renderedHeightMM);
        }

        const filename = `BLOTTER_${data.case_number || data.caseNumber || 'REF'}.pdf`;
        pdf.save(filename);

    } catch (error) {
        console.error("PDF Generation Error:", error);
        alert("Failed to generate PDF. See console for details.");
    }
};