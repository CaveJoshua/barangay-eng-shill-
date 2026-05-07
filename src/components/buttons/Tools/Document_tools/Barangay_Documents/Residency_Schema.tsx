import type { DocumentSchema, DocumentPayload, RenderInstruction } from '../PDF_Algorithm';

import baguioLogo from '../icons/Baguio_city.png';
import brgyLogo from '../icons/Barangay_eng-hill.png';

export const ResidencySchema: DocumentSchema = {
  compile: (payload: DocumentPayload): RenderInstruction[] => {

    const dateObj = new Date(payload.dateIssued);
    const day = dateObj.getDate();
    const month = dateObj.toLocaleString('default', { month: 'long' });
    const year = dateObj.getFullYear();
    const suffix =
      day >= 11 && day <= 13
        ? 'th'
        : day % 10 === 1
        ? 'st'
        : day % 10 === 2
        ? 'nd'
        : day % 10 === 3
        ? 'rd'
        : 'th';

    return [
      // 1. Watermark
      { type: 'watermark', imageSrc: brgyLogo },

      // 2. Green dual-logo banner
      {
        type: 'image_banner',
        leftLogo: brgyLogo,
        rightLogo: baguioLogo,
        heightInMm: 22,
      },
      { type: 'spacer', heightInMm: 6 },

      // 3. Office label and main title
      {
        type: 'title',
        content: 'OFFICE OF THE PUNONG BARANGAY',
        fontSize: 12,
        align: 'center',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 6 },
      {
        type: 'title',
        content: 'CERTIFICATION OF RESIDENCY',
        fontSize: 20,
        align: 'center',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 10 },

      // 4. Salutation
      {
        type: 'text',
        content: 'TO WHOM IT MAY CONCERN:',
        fontSize: 12,
        isBold: true,
        align: 'left',
      },
      { type: 'spacer', heightInMm: 6 },

      // 5. Body paragraphs
      {
        type: 'text',
        content: `This is to certify that <b><u>&nbsp;${payload.residentName}&nbsp;</u></b>, Filipino Citizen, of legal age, male, is a bonafide resident of <b><u>&nbsp;${payload.address}&nbsp;</u></b>, Engineers Hill, Baguio City.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `This is also to certify that the above-named person is a resident of this Barangay since birth.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `This certification is issued upon the request of the above-named person for <b><u>&nbsp;${payload.purpose || 'medical'}&nbsp;</u></b> purposes.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 6 },

      {
        type: 'text',
        content: `Issued this <b><u>&nbsp;${day}${suffix}&nbsp;</u></b> of <b><u>&nbsp;${month}&nbsp;</u></b> ${year} at Engineers Hill, Baguio City, Philippines.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 18 },

      // 6. Signature block — captain centred in the right half
      {
        type: 'columns',
        heightInMm: 14,
        columns: [
          { align: 'left', lines: [] },
          {
            align: 'center',
            lines: [
              { content: payload.captainName.toUpperCase(), isBold: true, fontSize: 12 },
              { content: 'Punong Barangay', isBold: false, fontSize: 11 },
            ],
          },
        ],
      },
      { type: 'spacer', heightInMm: 8 },

      // 7. Documentary stamp box
      {
        type: 'stamp_box',
        content: '"DOCUMENTARY STAMP TAX PAID"',
        orNo: payload.orNo || 'OR123',
        date: `${day}${suffix} of ${month}, ${year}`,
        heightInMm: 25,
      },
      { type: 'spacer', heightInMm: 10 },

      // 8. Contact footer
      { type: 'line', heightInMm: 1 },
      { type: 'spacer', heightInMm: 4 },
      {
        type: 'text',
        content: '&#9993; enrgshill2600@gmail.com &nbsp;&nbsp;&nbsp; &#9742; 074-422-8228',
        align: 'center',
        fontSize: 9,
        isBold: true,
      },
      { type: 'spacer', heightInMm: 1.5 },
      {
        type: 'text',
        content: "&#128205; Engineer's Hill Barangay, Baguio City",
        align: 'center',
        fontSize: 9,
        isBold: true,
      },
    ];
  },
};