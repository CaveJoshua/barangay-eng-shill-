interface TemplateProps {
  name: string;
  address: string;
  purpose: string;
  dateIssued: string;
}

export const getCertificateOfResidencyTemplate = ({ name, address, purpose, dateIssued }: TemplateProps) => {
  const date = new Date(dateIssued);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return `
    <div style="font-family: 'Arial', sans-serif; color: #000; line-height: 1.5;">
      <div style="text-align: center; font-weight: 800; font-size: 14pt; margin-bottom: 5px;">
        OFFICE OF THE PUNONG BARANGAY
      </div>

      <p style="font-size: 13pt; font-weight: 800; margin-bottom: 20px;">
        TO WHOM IT MAY CONCERN:
      </p>

      <p style="font-size: 12pt; text-indent: 50px; margin-bottom: 15px; text-align: justify;">
        This is to certify that <b style="text-decoration: underline;">${name.toUpperCase()}</b>, Filipino Citizen, of legal age, is a bonafide resident of <b>${address || "Engineer's Hill, Baguio City"}</b>.
      </p>

      <p style="font-size: 12pt; text-indent: 50px; margin-bottom: 15px; text-align: justify;">
        This is also to certify that the above-named person is a resident of this Barangay since birth.
      </p>

      <p style="font-size: 12pt; text-indent: 50px; margin-bottom: 15px; text-align: justify;">
        This certification is issued upon the request of the above-named person for <b style="text-decoration: underline;">${purpose.toUpperCase()}</b> purposes.
      </p>

      <p style="font-size: 12pt; text-indent: 50px; margin-bottom: 40px;">
        Issued this <b>${getOrdinal(day)}</b> of <b>${month}</b>, <b>${year}</b> at Engineer's Hill, Baguio City, Philippines.
      </p>
    </div>
  `;
};