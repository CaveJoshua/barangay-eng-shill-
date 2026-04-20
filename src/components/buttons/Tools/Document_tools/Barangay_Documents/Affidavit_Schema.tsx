import type { DocumentSchema, DocumentPayload, RenderInstruction } from '../PDF_Algorithm';

// The Affidavit uses only the Barangay logo (left header logo + background watermark)
import brgyLogo from '../icons/Barangay_eng-hill.png';

export const AffidavitSchema: DocumentSchema = {
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
      // 1. Faded background watermark
      { type: 'watermark', imageSrc: brgyLogo },

      // 2. Logo + stacked text header (matches photo exactly — no green banner)
      {
        type: 'logo_text_header',
        logoSrc: brgyLogo,
        logoSize: 22,
        heightInMm: 26,
        headerLines: [
          { content: 'Republic of the Philippines', fontSize: 10, isBold: false },
          { content: "ENGINEER'S HILL BARANGAY",   fontSize: 13, isBold: true  },
          { content: 'Baguio City',                 fontSize: 10, isBold: false },
          { content: '074-422-8228',                fontSize: 10, isBold: false },
          { content: 'Email Address: engrshill2600@gmail.com', fontSize: 10, isBold: false },
        ],
      },
      { type: 'spacer', heightInMm: 8 },

      // 3. Two-line title (both bold, centered)
      {
        type: 'title',
        content: 'AFFIDAVIT OF BARANGAY OFFICIAL',
        fontSize: 13,
        align: 'center',
        isBold: true,
      },
      {
        type: 'title',
        content: 'THAT A PARENT IS A RESIDENT OF THIS BARANGAY',
        fontSize: 11,
        align: 'center',
        isBold: true,
      },
      { type: 'spacer', heightInMm: 8 },

      // 4. First body paragraph
      {
        type: 'text',
        content: `That <b>${payload.residentName.toUpperCase()}</b>, ____ years old, bonafide resident at <b>${payload.address}</b>, Engineers Hill, Baguio City is a Single Parent defined under Section 3a of The Solo Parent Welfare Act of RA 8972 as Expanded by RA 11861 (SOLOPARENT-DEATH OF SPOUSE)`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      // 5. Children section heading
      { type: 'text', content: 'His/Her Children', fontSize: 11, isBold: true, align: 'left' },
      { type: 'spacer', heightInMm: 3 },

      // 6. Bordered children table
      //    Columns: NAME (50%) | DATE OF BIRTH (35%) | AGE (15%)
      {
        type: 'table',
        heightInMm: 32,
        tableHeaders: ['NAME', 'DATE OF BIRTH', 'AGE'],
        columnWidths: [0.50, 0.35, 0.15],
        tableRows: [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
      },
      { type: 'spacer', heightInMm: 4 },

      // 7. Continuation paragraphs
      { type: 'text', content: 'Is/are under her custody.', fontSize: 11, align: 'left' },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: 'Upon verification, the solo parent applicant is not involved into a new relationship up to present which gives them consideration to be a certified solo parent.',
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `This affidavit is being issued upon the request of <b>${payload.residentName.toUpperCase()}</b> for the authentication of client present status as eligible Solo Parent and for Solo-Parent identification card.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 5 },

      {
        type: 'text',
        content: `Issued this <b>${day}${suffix}</b> day of <b>${month} ${year}</b> at Engineer's Hill Barangay, Baguio City, Philippines.`,
        fontSize: 11,
        align: 'justify',
      },
      { type: 'spacer', heightInMm: 14 },

      // 8. Signature block
      //    LEFT column:  ":" marker
      //    RIGHT column: captain name + title
     {
  type: 'columns',
  heightInMm: 14,
  columns: [
    {
      // 1. LEFT SIDE (The colon indicator)
      align: 'center',
      lines: [{ content: ':', fontSize: 11, isBold: false }],
    },
    {
      // 2. RIGHT SIDE (The Kapitan)
      // Changing this to 'center' makes the title stack perfectly under the name.
      align: 'center', 
      lines: [
        { 
          content: payload.captainName.toUpperCase(), 
          isBold: true,  
          fontSize: 12,
          // 👇 NOW YOU CAN USE MM HERE (Example: 5, 10, or -10)
          alignOffset: 0, 
          editableKey: 'captainName' 
        },
        { 
          content: 'Punong Barangay',                 
          isBold: false, 
          fontSize: 11,
          // 👇 KEEP THIS NUMBER THE SAME AS ABOVE to move them as one unit
          alignOffset: 0 
        },
      ],
    },
  ],
},
      { type: 'spacer', heightInMm: 10 },

      // 9. Witnesses block
      { type: 'text', content: 'Witnesses:', fontSize: 11, isBold: true, align: 'left' },
      { type: 'spacer', heightInMm: 3 },
      { type: 'text', content: '<b>Name:</b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; MARYELLA KRYZELLE L. ESLAVA', fontSize: 11, align: 'left' },
      { type: 'text', content: "<b>Address:</b>&nbsp;&nbsp;&nbsp; 125 Lagerra Alley, Engr's Hill",             fontSize: 11, align: 'left' },
      { type: 'text', content: '<b>Contact No:</b>&nbsp; 09676847922',                                          fontSize: 11, align: 'left' },
    ];
  },
};