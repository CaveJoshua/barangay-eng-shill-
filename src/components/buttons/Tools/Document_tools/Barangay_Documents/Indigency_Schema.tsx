import type { DocumentSchema, DocumentPayload, RenderInstruction } from '../PDF_Algorithm';

import baguioLogo from '../icons/Baguio_city.png';
import brgyLogo from '../icons/Barangay_eng-hill.png';

export const IndigencySchema: DocumentSchema = {
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
      { type: 'spacer', heightInMm: 12 },

      // 3. Title
      {
        type: 'title',
        content: 'CERTIFICATE OF INDIGENCY',
        fontSize: 22,
        align: 'center',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 12 },

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
        content: `This is to certify that <b><u>${payload.residentName.toUpperCase()}</u></b>, Filipino Citizen, of legal age, is a bonafide resident of <b><u>${payload.address}</u></b>, Engineer's Hill, Baguio City.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `This is to further certify that the above-named person belongs to an <b><u>&nbsp;indigent family&nbsp;</u></b> in this barangay.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `This certification is issued upon the request of the above-named person for <b><u>&nbsp;${payload.purpose || 'financial/medical assistance'}&nbsp;</u></b> purposes.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `Issued this <b><u>&nbsp;${day}${suffix}&nbsp;</u></b> of <b><u>&nbsp;${month}&nbsp;</u></b> <b><u>&nbsp;${year}&nbsp;</u></b> at Engineer's Hill Barangay, Baguio City.`,
        fontSize: 12,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 35 },

      // 6. Signature block — same two-column layout as Clearance
    {
  type: 'columns',
  heightInMm: 25,
  columns: [
    { 
      // 1. Keep the whole block on the LEFT margin
      align: 'left', 
      lines: [
        { content: '________________________', isBold: true, fontSize: 12 }, 
        { 
          content: 'Signature', 
          isBold: false, 
          fontSize: 10,
          // 2. Use alignOffset to push the word to the right.
          // 25 to 30 is usually the "sweet spot" for centering under this line length.
          alignOffset: 18,
        }
      ] 
        },
             { 
      // 2. KAPITAN SIDE (The "Nudge" Fix)
      align: 'center', 
      lines: [
        { 
          content: payload.captainName.toUpperCase(), 
          isBold: true, 
          fontSize: 12,
          // 👈 We "push" the name 40mm to the right
          alignOffset: 18
        }, 
        { 
          content: 'Punong Barangay', 
          isBold: false, 
          fontSize: 11,
          // 👈 We "push" the title 40mm to keep it perfectly centered under the name
          alignOffset: 18
        }
      ] 
    }
  ]
},
      // 7. CTC / Fees table
      {
  type: 'columns',
  heightInMm: 22,
  columns: [
    {
      align: 'left',
      lines: [
        { content: `CTC NO: <b>${payload.ctcNo || 'N/A'}</b>`, isBold: true, fontSize: 10 },
        { content: `Issued At: <b>Engineers Hill, Baguio City</b>`, isBold: true, fontSize: 10 },
        { content: `Issued On: <b>${payload.dateIssued}</b>`, isBold: true, fontSize: 10 },
      ],
    },
    {
      align: 'left', 
      lines: [
        { 
          content: `Fees Paid: <b>${payload.feesPaid}</b>`, 
          isBold: true, 
          fontSize: 10,
          // 👈 INCREASED TO 45 to force a move
          alignOffset: 40
        },
        { 
          content: `O.R. No.: <b>${payload.orNo || 'Receipt Number'}</b>`, 
          isBold: true, 
          fontSize: 10,
          // 👈 MUST BE THE SAME 45
          alignOffset: 40
        },
        { content: '', fontSize: 10 }, 
      ],
    },
  ],
},
      { type: 'line', heightInMm: 1 },
      { type: 'spacer', heightInMm: 5 },

      // 8. Contact footer
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