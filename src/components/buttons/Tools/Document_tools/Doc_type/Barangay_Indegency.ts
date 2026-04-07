/**
 * Utility for generating the Certificate of Indigency document content.
 * Allocated from Document_File to maintain modularity.
 */

export interface ICertificateOfIndigencyProps {
  name: string;
  purpose?: string; // Optional if you want to override the default "MEDICAL/FINANCIAL"
  dateIssued: string;
}

/**
 * Returns the specific HTML template for a Certificate of Indigency.
 * Formatting follows the bold-only style for dynamic fields.
 */
export const getCertificateOfIndigencyTemplate = ({
  name,
  purpose,
  dateIssued
}: ICertificateOfIndigencyProps): string => {
  const dateObj = new Date(dateIssued);
  const day = dateObj.getDate();
  const month = dateObj.toLocaleString('en-US', { month: 'long' });
  const year = dateObj.getFullYear();
  
  // Default purpose for Indigency is often Medical/Financial Assistance
  const displayPurpose = purpose ? purpose.toUpperCase() : "MEDICAL/FINANCIAL ASSISTANCE";

  return `
    <p style="text-align: justify; font-size: 13pt; line-height: 1.6; margin-bottom: 10px;"><b>TO WHOM IT MAY CONCERN:</b></p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      This is to <b>CERTIFY</b> that <b>${name}</b>, Filipino Citizen, of legal age, is a <b>bonafide</b> resident of Barangay Engineer's Hill, Baguio City.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      Certifying further that the above-named person belongs to an <b>INDIGENT FAMILY</b> in this Barangay and is known to be of good moral character and a law-abiding citizen in the community.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      This certification is being issued upon the request of the above-named person for <b>${displayPurpose}</b> requirements.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      Issued this &nbsp;&nbsp;<b>${day}</b>&nbsp;&nbsp; of &nbsp;&nbsp;<b>${month}</b>&nbsp;&nbsp; ${year} at Engineer's Hill Barangay, Baguio City.
    </p>
  `;
};