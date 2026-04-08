export interface ITemplateProps {
  name: string;
  address: string;
  purpose: string;
  dateIssued: string;
}

const getDaySuffix = (n: number) => {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

export const getJobseekerTemplate = (props: ITemplateProps) => {
  const d = new Date(props.dateIssued);
  const day = d.getDate();
  const month = d.toLocaleString('default', { month: 'long' });
  const year = d.getFullYear();
  const dayWithSuffix = `${day}${getDaySuffix(day)}`;

  return `
    <p style="text-indent: 50px; text-align: justify; margin-bottom: 25px; font-size: 11.5pt; line-height: 1.6;">
      This is to certify that <b>${props.name}</b>, a resident of ${props.address} for One Year, is a qualified availee of RA 11261 or the <b>First time Jobseekers Act of 2019.</b>
    </p>
    
    <p style="text-indent: 50px; text-align: justify; margin-bottom: 25px; font-size: 11.5pt; line-height: 1.6;">
      I further certify that the holder/bearer was informed of his/her rights, including the duties and responsibilities accorded by RA 11261 through the <b>Oath of Undertaking</b> he/she has signed and executed in the presence of our Barangay Official.
    </p>
    
    <p style="text-indent: 50px; text-align: justify; margin-bottom: 25px; font-size: 11.5pt; line-height: 1.6;">
      Signed this ${dayWithSuffix} day of ${month} ${year} at Engineer's Hill Barangay, Baguio City.
    </p>
    
    <p style="text-indent: 50px; text-align: justify; margin-bottom: 25px; font-size: 11.5pt; line-height: 1.6;">
      This certification is valid only One (1) year from the issuance.
    </p>
  `;
};