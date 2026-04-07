/**
 * Utility for generating the Barangay Clearance document content.
 * Allocated from Document_File to maintain modularity.
 */

export interface IBarangayClearanceProps {
  name: string;
  address: string;
  purpose: string;
  dateIssued: string;
}

/**
 * Returns the specific HTML template for a Barangay Clearance.
 * Formatting follows the bold-only style without underlines for dynamic fields.
 */
export const getBarangayClearanceTemplate = ({
  name,
  address,
  purpose,
  dateIssued
}: IBarangayClearanceProps): string => {
  const dateObj = new Date(dateIssued);
  const day = dateObj.getDate();
  const month = dateObj.toLocaleString('en-US', { month: 'long' });
  const year = dateObj.getFullYear();
  const displayAddress = address.trim() ? address : "____________________";
  const displayPurpose = purpose.toUpperCase() || "_________________";

  return `
    <p style="text-align: justify; font-size: 13pt; line-height: 1.6; margin-bottom: 10px;"><b>TO WHOM IT MAY CONCERN:</b></p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      This is to <b>CERTIFY</b> that <b>${name}</b> Filipino Citizen, male, is a <b>bonafide</b> resident at # <b>${displayAddress}</b>, Engineer's Hill, Baguio City.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      Certifying further that based on available records of this Barangay, there is no derogatory record nor has there been pending or criminal case filed against the above-named person as of this date.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      This clearance is being issued upon the request of the above-named person for <b>${displayPurpose}</b> purposes.
    </p>
    <br/>
    <p style="text-align: justify; text-indent: 40px; font-size: 13pt; line-height: 1.6;">
      Issued this &nbsp;&nbsp;<b>${day}</b>&nbsp;&nbsp; of &nbsp;&nbsp;<b>${month}</b>&nbsp;&nbsp; ${year} at Engineer's Hill Barangay, Baguio City.
    </p>
  `;
};